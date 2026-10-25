/**
 * `ctx.js` on QuickJS — a real realm, not a `vm` context.
 *
 * The distinction is the whole point. `node:vm` shares an object graph with
 * the host: a script that reaches `this.constructor.constructor` is out, and
 * every published mitigation for that is a blocklist someone eventually walks
 * around. QuickJS is a separate interpreter compiled to WebAssembly — there is
 * no host object graph to reach, because there are no host objects in it. What
 * crosses the boundary crosses as data.
 *
 * That buys three things the source model needs (docs/06 §8):
 *
 *  - **Interruptible.** A `while(1)` is stopped by an interrupt handler the
 *    host polls. Nothing in JavaScript's own semantics can do this, which is
 *    why `source-rules` has to refuse catastrophic regexes rather than time
 *    them out.
 *  - **Bounded memory.** A per-realm heap ceiling, enforced by the allocator.
 *  - **Nothing ambient.** No `fetch`, no `require`, no timers. A realm reaches
 *    exactly the host functions the caller exposed and nothing else.
 *
 * ⚠️ The sandbox bounds *reach*, not *intent*. A script still sees everything
 * passed in and can send it anywhere an exposed function allows, which is why
 * the source runtime pairs this with a per-source egress allowlist.
 *
 * See docs/04-core-services.md §19.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import {
  DEFAULT_JS_LIMITS,
  JsBridgeError,
  JsMemoryError,
  JsRealmDisposedError,
  JsScriptError,
  JsTimeoutError,
} from '@BBeBee/protocol'
import type { Disposable, JsLimits, JsRealm, JsService } from '@BBeBee/protocol'

import variant from '@jitl/quickjs-singlefile-browser-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  type JSPromiseState,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'

/*
 * Opt-in handle tracing, for hunting `JS_FreeRuntime` aborts.
 *
 * The assertion (`list_empty(&rt->gc_obj_list)`) means a JSValue still had a
 * host reference when its runtime was freed — some handle, somewhere, was
 * created and never disposed. The engine cannot say whose; the count is only
 * visible at the moment of teardown, in a process that is about to die. So
 * this ledger exists: with `BBEBEE_QUICKJS_TRACE_HANDLES=1`, every handle
 * class that can outlive the synchronous section that created it is
 * registered at creation and unregistered at its (single, real) dispose
 * site, and `dispose()` reports whatever is left before it tears down.
 *
 * Registered kinds, and why only these: a handle created and disposed inside
 * one synchronous stretch (an exposed function's own handle, an `eval`
 * scope value, a bridge result on its way into a deferred) cannot straddle
 * a teardown, so registering it would be noise, not signal. What can
 * straddle is what is registered: the runtime and its context, an eval's
 * result while its settle is parked, the state handles `getPromiseState`
 * hands out (each one a fresh reference the caller owns), and a deferred
 * promise whose resolvers the binding frees only when it settles.
 *
 * Off (the default), the ledger is a boolean check per call — no map, no
 * stack capture, no behaviour change.
 */
const TRACE_HANDLES = ((): boolean => {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env
    return env?.['BBEBEE_QUICKJS_TRACE_HANDLES'] === '1'
  } catch {
    return false
  }
})()

interface TrackedHandle {
  id: number
  kind: string
  /** Creation stack, trimmed to the frames that identify the site. */
  stack: string
}

export interface JsQuickJsConfig {
  /** Applied where a caller does not override. */
  limits?: Partial<JsLimits>
}

export class JsQuickJsNode extends Service implements JsService {
  readonly engine = { name: 'quickjs-emscripten', version: '0.32.0' }

  private module?: QuickJSWASMModule
  private modulePromise?: Promise<QuickJSWASMModule>
  /** Every live realm, so unloading the service cannot leak a native handle. */
  private readonly realms = new Set<QuickJsRealm>()

  constructor(
    ctx: Context,
    private readonly config: JsQuickJsConfig = {},
  ) {
    super(ctx, 'js')
  }

  private async getModule(): Promise<QuickJSWASMModule> {
    if (!this.module) {
      this.modulePromise ??= newQuickJSWASMModuleFromVariant(variant)
      this.module = await this.modulePromise
    }
    return this.module
  }

  async [Service.init]() {
    // QuickJS WASM module is compiled lazily on first `createRealm` call,
    // keeping startup instantaneous.
    return () => {
      for (const realm of [...this.realms]) realm.dispose()
    }
  }

  async createRealm(limits: Partial<JsLimits> = {}): Promise<JsRealm> {
    const module = await this.getModule()
    const resolved: JsLimits = { ...DEFAULT_JS_LIMITS, ...this.config.limits, ...limits }
    const realm = new QuickJsRealm(module, resolved, () => this.realms.delete(realm), TRACE_HANDLES)
    if (TRACE_HANDLES) {
      realm.onLeakReport = (text) => {
        this.ctx.logger.warn(text)
      }
    }
    // An unhandled rejection inside a realm is the sandbox's business to
    // surface: nothing else can see it, and the caller has already moved on.
    realm.onJobError = (error) => {
      this.ctx.logger.warn(`js: a script left a rejection unhandled: ${error.message}`)
    }
    this.realms.add(realm)
    return realm
  }
}

/** How long a poisoned realm is given to unwind its parked frames. */
const UNWIND_MS = 50

/** Why a realm stopped being usable. `undefined` means it still is. */
type Poison = 'disposed' | 'timeout' | 'memory'

class QuickJsRealm implements JsRealm {
  private vm: QuickJSContext | undefined

  /** See `JsRealm.disposed`: a caller that caches a realm needs to know. */
  get disposed(): boolean {
    return this.vm === undefined
  }
  private poison: Poison | undefined
  /**
   * Set while an eval is running, so the interrupt handler knows its deadline.
   *
   * On the realm rather than in a closure because `preload` and `eval` share
   * one handler — installing a second would replace the first, and a `jsLib`
   * with an infinite loop would then run unbounded.
   */
  private deadline = 0
  private readonly disposers = new Set<() => void>()
  /** Host bridges awaiting settlement. Rejected before a poisoned teardown. */
  private readonly pending = new Set<() => void>()
  /** Set by `pump` when a queued job failed. Read on the next turn of `settle`. */
  private jobFailure: unknown
  /** Where an unhandled realm-side rejection goes. Set by the service. */
  onJobError: ((error: Error) => void) | undefined
  /** Set by `pump` when a queued job was interrupted. */
  private interrupted = false
  /** Set while `dispose()` runs, so a re-entrant call cannot interleave two teardowns. */
  private tearingDown = false
  /**
   * Result handles of evals whose settle is still in flight. `run` owns
   * them and releases them from its own `finally`, but a teardown that
   * lands mid-settle makes that `finally` skip the release — so `dispose`
   * sweeps whatever is still here. Always tracked, tracing or not: this
   * set is part of the fix, not of the diagnostics.
   */
  private readonly inFlightResults = new Set<QuickJSHandle>()
  /** Where a handle-tracing leak report goes. Set by the service when tracing. */
  onLeakReport: ((text: string) => void) | undefined
  /**
   * The handle ledger (see TRACE_HANDLES). Allocated on first registration,
   * and only ever populated when tracing — off, these are empty calls.
   */
  private tracked?: Map<object, TrackedHandle>
  private trackSeq = 0

  constructor(
    module: QuickJSWASMModule,
    private readonly limits: JsLimits,
    private readonly onDispose: () => void,
    private readonly trace = false,
  ) {
    const runtime = module.newRuntime()
    this.track('runtime', runtime)
    runtime.setMemoryLimit(limits.memoryBytes)
    /*
     * Two ceilings, not one. `setMemoryLimit` caps the heap; the stack cap
     * catches unbounded recursion, which exhausts the *native* stack and
     * would take the host process down with it rather than throwing.
     */
    runtime.setMaxStackSize(512 * 1024)
    /*
     * The engine calls this on its own schedule while a script runs; there is
     * no exposed cycle count to tune, so it must stay cheap — it is on the hot
     * path of every loop iteration a script performs.
     */
    runtime.setInterruptHandler(() => this.deadline !== 0 && Date.now() > this.deadline)
    this.vm = runtime.newContext()
    this.track('context', this.vm)
  }

  /* ── handle ledger (opt-in; see TRACE_HANDLES) ─────────────────────── */

  private track(kind: string, handle: object): void {
    if (!this.trace) return
    this.tracked ??= new Map()
    if (this.tracked.has(handle)) return
    const frames = (new Error().stack ?? '').split('\n')
    this.tracked.set(handle, {
      id: ++this.trackSeq,
      kind,
      // Skip the `Error` header and this frame: what identifies a site is
      // the wrapper method that asked for the handle, and its caller.
      stack: frames.slice(2, 5).join('\n'),
    })
  }

  private untrack(handle: object): void {
    if (!this.trace) return
    this.tracked?.delete(handle)
  }

  /** Release the handle a promise-state read carries, if it carries one. */
  private releaseState(state: JSPromiseState): void {
    if (state.type === 'fulfilled' && !state.notAPromise) {
      this.untrack(state.value)
      state.value.dispose()
    } else if (state.type === 'rejected') {
      this.untrack(state.error)
      state.error.dispose()
    }
  }

  /** Register the handle a promise-state read carries, if it carries one. */
  private trackState(state: JSPromiseState): void {
    if (!this.trace) return
    // `notAPromise` hands back the caller's own handle, not a fresh one —
    // that reference belongs to whoever passed the promise in.
    if (state.type === 'fulfilled' && !state.notAPromise) this.track('promise-state', state.value)
    else if (state.type === 'rejected') this.track('promise-state', state.error)
  }

  /**
   * What is still registered, grouped, at the moment teardown begins.
   *
   * The runtime and context are excluded by kind: they are alive because
   * `dispose()` is the thing about to free them, not because anyone leaked
   * them. Everything else in the ledger at this point is a handle whose
   * dispose site never ran — which is the leak, named.
   */
  private reportLeaks(): void {
    if (!this.trace || !this.tracked) return
    const leaked = [...this.tracked.values()].filter(
      (t) => t.kind !== 'runtime' && t.kind !== 'context',
    )
    if (!leaked.length) return
    const byKind = new Map<string, TrackedHandle[]>()
    for (const t of leaked) {
      const group = byKind.get(t.kind) ?? []
      group.push(t)
      byKind.set(t.kind, group)
    }
    const lines = [
      `js: realm disposed with ${leaked.length} unreleased handle(s) still registered — ` +
        'each is a JSValue whose reference reaches JS_FreeRuntime (gc_obj_list assertion):',
    ]
    for (const [kind, items] of byKind) {
      lines.push(`  ${kind} ×${items.length}`)
      for (const item of items.slice(0, 3)) {
        lines.push(`    #${item.id} created at:`)
        for (const frame of item.stack.split('\n')) lines.push(`      ${frame.trim()}`)
      }
    }
    // The service wires this to `ctx.logger` whenever tracing is on; a
    // realm without a reporter has nowhere legitimate to write (Layer 2
    // does not touch the console), so the report is simply dropped.
    this.onLeakReport?.(lines.join('\n'))
  }

  async preload(code: string): Promise<void> {
    await this.run(code)
  }

  async eval<T = unknown>(code: string, scope: Record<string, unknown> = {}): Promise<T> {
    const vm = this.live()
    // Globals, not a wrapper function: `jsLib` declares helpers at top level
    // and a rule expects to see them, so scope has to land in the same place.
    for (const [name, value] of Object.entries(scope)) {
      const handle = this.toHandle(vm, value)
      vm.setProp(vm.global, name, handle)
      handle.dispose()
    }
    return (await this.run(code)) as T
  }

  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable {
    const vm = this.live()
    const handle = vm.newFunction(name, (...args) => {
      const decoded = args.map((arg) => vm.dump(arg) as unknown)
      let result: unknown
      try {
        result = fn(...decoded)
      } catch (error) {
        // A host function throwing is the host's problem, but the script has
        // to see *something* — silently returning undefined would make a
        // failed auth call look like an empty token.
        return { error: this.toHandle(vm, String(error)) }
      }
      if (isThenable(result)) {
        /*
         * A host promise is bridged into a realm promise, and the realm's job
         * queue is pumped when it settles.
         *
         * Without the pump, a script that `await`s a host call deadlocks: the
         * promise resolves on the host side and the realm never runs the
         * continuation, because nothing asked it to. This is the single most
         * common way to get a QuickJS embedding wrong, which is why the
         * contract calls it out.
         */
        const deferred = vm.newPromise()
        this.track('deferred', deferred)

        /*
         * Registered so a poisoned teardown can reject it.
         *
         * A realm disposed while an async frame is parked on one of these
         * makes QuickJS abort the whole WASM instance. Rejecting first lets
         * the frame unwind, which is the difference between a `JsTimeoutError`
         * and a native abort that bricks the module.
         */
        const abandon = () => {
          if (this.vm !== vm) return
          const h = vm.newString('the realm was torn down before this call returned')
          deferred.reject(h)
          h.dispose()
          // Rejecting frees the deferred's resolver handles (the binding
          // disposes them on settle); the promise handle itself was
          // transferred to the engine when this function returned it.
          this.untrack(deferred)
        }
        this.pending.add(abandon)

        const settle = (make: () => QuickJSHandle, how: 'resolve' | 'reject') => {
          this.pending.delete(abandon)
          if (this.vm !== vm) return
          const h = make()
          try {
            deferred[how](h)
          } finally {
            h.dispose()
          }
          // As in abandon: settling freed the resolvers, and the promise
          // handle belongs to the engine since it was returned.
          this.untrack(deferred)
          // ⚠️ Pumped with the deadline armed. A continuation is as capable of
          // looping for ever as the script that queued it, and this pump runs
          // outside `run`'s own — an unarmed one here is a freeze.
          try {
            this.pump(vm)
          } catch {
            // The rejection reaches the script through its own promise; there
            // is no caller here to hand an error to.
          }
        }

        void result.then(
          (value) => settle(() => this.toHandle(vm, value), 'resolve'),
          (error: unknown) => settle(() => vm.newString(String(error)), 'reject'),
        )
        return deferred.handle
      }
      return this.toHandle(vm, result)
    })
    vm.setProp(vm.global, name, handle)
    handle.dispose()

    const remove = () => {
      if (this.vm !== vm) return
      vm.setProp(vm.global, name, vm.undefined)
    }
    this.disposers.add(remove)
    // `Disposable` is a bare function in this protocol, not `{ dispose() }`.
    return () => {
      this.disposers.delete(remove)
      remove()
    }
  }

  dispose(): void {
    // Idempotent by contract: a disposer may legitimately run from a fiber
    // teardown *and* an explicit call, and the second must not throw.
    const vm = this.vm
    if (!vm) return
    // A re-entrant call — a host function disposing its own realm from
    // inside a job the unwind below is pumping — must not interleave two
    // teardowns. The outer call is already doing the whole job.
    if (this.tearingDown) return
    this.tearingDown = true
    this.poison ??= 'disposed'
    this.disposers.clear()

    /*
     * ⚠️ Unwind the in-flight bridges BEFORE the context is marked gone —
     * the order is the fix, not a detail.
     *
     * Rejecting them matters for the reason the older comment here gave:
     * an `eval` parked on a host call should fail as `JsRealmDisposedError`,
     * not as whatever the engine throws next. But `abandon` refuses to run
     * once `this.vm` is cleared — that guard is what stops a *late* host
     * settle from touching a dead deferred — and this method used to clear
     * `this.vm` first, which made every reject below a silent no-op. The
     * deferreds were never settled, so the binding never freed their
     * resolver handles, and the parked frames never unwound. Those handles
     * are precisely what `JS_FreeRuntime` asserts about
     * (`list_empty(&rt->gc_obj_list)`): disposing a realm that a script was
     * still parked inside aborted the WASM instance and took the process
     * hosting it down with it.
     *
     * So reject while the context is still this realm's live one, then
     * pump — the same choreography `poisonWith` uses. The rejection lands,
     * the frame unwinds, the resolvers are freed. Rounds, because a
     * continuation woken by one rejection can park on a fresh bridge that
     * the next round must reject in turn; bounded, with the unwind
     * deadline armed, so a script `finally` that loops cannot hold
     * teardown hostage.
     */
    if (this.pending.size > 0) {
      const armed = this.deadline
      this.deadline = Date.now() + UNWIND_MS
      try {
        for (let round = 0; round < 8 && this.pending.size > 0; round++) {
          for (const reject of [...this.pending]) {
            try {
              reject()
            } catch {
              // Past saving; the teardown below is what matters.
            }
          }
          this.pending.clear()
          try {
            const jobs = vm.runtime.executePendingJobs()
            if (jobs.error) jobs.error.dispose()
          } catch {
            // As above.
          }
        }
      } finally {
        this.deadline = armed
      }
    }

    this.vm = undefined

    /*
     * Release the results of evals whose settle is still parked host-side.
     *
     * Their frames unwound above, but the result handle is a host
     * reference `run` owns, released from its own `finally` — which skips
     * the release once the realm is marked gone (correctly: freeing into
     * a dead context is worse). Here the context is alive for one more
     * moment and the reference is this realm's to drop. Left held, it
     * alone trips the assertion.
     */
    for (const handle of this.inFlightResults) {
      if (handle.alive) {
        try {
          handle.dispose()
        } catch {
          // Best effort; the teardown below proceeds either way.
        }
      }
      this.untrack(handle)
    }
    this.inFlightResults.clear()

    // Tracing only: name what is about to reach JS_FreeRuntime still held.
    this.reportLeaks()

    /*
     * ⚠️ Guarded, and the guard is load-bearing.
     *
     * Tearing down a context that still holds a suspended frame makes QuickJS
     * abort the WASM instance from inside `dispose()`. Letting that propagate
     * left the realm in `this.realms` — so the service's unload loop hit the
     * same abort again and cascaded, and the runtime allocation leaked. The
     * contract says `dispose()` returns void and never throws; this is what
     * makes that true rather than aspirational.
     */
    const runtime = vm.runtime
    try {
      vm.dispose()
    } catch {
      // Nothing to recover: the instance is gone either way.
    }
    try {
      runtime.dispose()
    } catch {
      // As above.
    }
    this.onDispose()
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  private live(): QuickJSContext {
    if (!this.vm) throw new JsRealmDisposedError(this.poison ?? 'disposed')
    return this.vm
  }

  /**
   * Run code with the limits armed, and translate what comes back.
   *
   * A realm that breached a limit is **poisoned**: QuickJS's state after an
   * interrupt is undefined — a half-finished frame, a lock never released —
   * so continuing to use it is how a sandbox turns into a crash months later.
   * The realm is torn down and every later call rejects.
   */
  private async run(code: string): Promise<unknown> {
    const vm = this.live()

    /*
     * ⚠️ One deadline, armed across the *whole* call — not just `evalCode`.
     *
     * The interrupt handler only fires while the engine is executing, and
     * `evalCode` returns as soon as the script hits its first `await`. Arming
     * the deadline only around that call left every continuation unbounded:
     * `(async () => { await 1; while (true) {} })()` returned from `evalCode`
     * immediately, and the infinite loop then ran inside `executePendingJobs`
     * with the deadline disarmed. It never came back — no timeout, no
     * interrupt, a permanently frozen process. The same held for anything
     * chained onto a host call: `src.get(...).then(() => { while (1) {} })`.
     *
     * `budgetMs` rather than `timeoutMs` because a rule that makes network
     * calls legitimately takes longer than one that does not (docs/06 §8): the
     * *engine* is bounded by `timeoutMs` of continuous execution, and the call
     * as a whole by this.
     */
    const budget = Date.now() + this.limits.budgetMs
    this.deadline = Date.now() + this.limits.timeoutMs
    this.jobFailure = undefined
    this.interrupted = false

    try {
      let result: ReturnType<QuickJSContext['evalCode']>
      try {
        result = vm.evalCode(code)
      } catch (error) {
        // A throw from `evalCode` itself is the memory limit: the allocator
        // fails inside the engine rather than producing an error value.
        await this.poisonWith('memory')
        throw wrapOutOfMemory(error, this.limits)
      }

      if (result.error) {
        const detail = vm.dump(result.error) as unknown
        result.error.dispose()
        // An interrupt surfaces as an error QuickJS wrote itself — telling it
        // apart from a script's own throw is what makes "your rule is wrong"
        // different from "your rule is too slow".
        if (isInterrupt(detail)) {
          await this.poisonWith('timeout')
          throw new JsTimeoutError(this.limits.timeoutMs)
        }
        if (isOutOfMemory(detail)) {
          await this.poisonWith('memory')
          throw new JsMemoryError(this.limits.memoryBytes)
        }
        throw scriptError(detail)
      }

      // Registered for the ledger: this handle is alive across the whole
      // settle, which is exactly the span a teardown can land inside.
      this.track('eval-result', result.value)
      // And held for the teardown sweep in `dispose`, which releases it
      // if this settle is still parked when the realm goes away.
      this.inFlightResults.add(result.value)
      try {
        return await this.settle(vm, result.value, budget)
      } finally {
        this.inFlightResults.delete(result.value)
        // ⚠️ Only if the context still exists. A limit breach tears the realm
        // down from inside `settle`, and freeing a handle afterwards throws
        // `Lifetime not alive` — which would replace the `JsTimeoutError` the
        // caller needs with an internal one that means nothing to them.
        if (this.vm === vm) {
          this.untrack(result.value)
          result.value.dispose()
        }
      }
    } finally {
      this.deadline = 0
    }
  }

  /**
   * Drive the realm until `handle` settles, or the budget runs out.
   *
   * `jsLib` helpers routinely `await` a host call, so the completion value of
   * a rule is a promise more often than not — and every one of those
   * continuations runs *here*, inside `executePendingJobs`, rather than inside
   * `evalCode`. That is why the engine deadline is re-armed before each pump:
   * a continuation is as capable of looping for ever as the top-level script.
   *
   * ⚠️ Ownership: this frees only handles it did not receive. Asking QuickJS
   * for the promise state of a *non*-promise hands back a fulfilled state
   * carrying the very same handle (`notAPromise`), so disposing it here as
   * well as in the caller is a double free — which surfaces as
   * `QuickJSUseAfterFree` from somewhere unrelated, several calls later.
   */
  private async settle(
    vm: QuickJSContext,
    handle: QuickJSHandle,
    budget: number,
  ): Promise<unknown> {
    const initial = vm.getPromiseState(handle)
    this.trackState(initial)
    if (initial.type === 'fulfilled' && initial.notAPromise) {
      return this.bounded(vm.dump(handle) as unknown)
    }
    /*
     * ⚠️ This look may already hold the settled value — and the handle it
     * carries is a fresh reference this call owns (`getPromiseState` dups
     * the result). Dropping it leaked one handle per promise-valued eval:
     * the result object of every async rule, held until the realm's
     * dispose carried it into `JS_FreeRuntime`'s assertion. The
     * authoritative read below takes its own handle; release this one.
     * (`pending` carries no handle, so this is a no-op there.)
     */
    this.releaseState(initial)

    if (initial.type === 'pending') {
      for (;;) {
        // The realm can be disposed while this loop is parked on its
        // sleep. Fail as the contract's word for that, rather than
        // letting the next engine call throw an internal name.
        if (this.vm !== vm) throw new JsRealmDisposedError(this.poison ?? 'disposed')
        this.pump(vm)
        if (this.interrupted) {
          await this.poisonWith('timeout')
          throw new JsTimeoutError(this.limits.timeoutMs)
        }
        const check = vm.getPromiseState(handle)
        this.trackState(check)
        if (check.type !== 'pending') {
          // The transitioning look owns a fresh reference too — the same
          // leak as the first look, on the ordinary parked-then-settled
          // path every awaited host call takes. The read after the loop
          // takes its own; release this one.
          this.releaseState(check)
          break
        }
        if (Date.now() > budget) {
          await this.poisonWith('timeout')
          throw new JsTimeoutError(this.limits.budgetMs)
        }
        // Yield to the host loop so a pending host promise can settle.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    const state = vm.getPromiseState(handle)
    this.trackState(state)
    if (state.type === 'rejected') {
      const detail = vm.dump(state.error) as unknown
      this.untrack(state.error)
      state.error.dispose()
      /*
       * ⚠️ An interrupted *continuation* rejects the promise rather than
       * failing the evaluation, so the interrupt arrives here — and reporting
       * it as a script error would tell the author their code threw when in
       * fact the engine stopped it. The realm is equally unusable either way.
       */
      if (isInterrupt(detail)) {
        await this.poisonWith('timeout')
        throw new JsTimeoutError(this.limits.timeoutMs)
      }
      if (isOutOfMemory(detail)) {
        await this.poisonWith('memory')
        throw new JsMemoryError(this.limits.memoryBytes)
      }
      throw scriptError(detail)
    }
    if (state.type === 'fulfilled') {
      const value = vm.dump(state.value) as unknown
      // Only if it is a handle of its own; `notAPromise` means it is ours.
      if (!state.notAPromise) {
        this.untrack(state.value)
        state.value.dispose()
      }
      return this.bounded(value)
    }
    return this.bounded(vm.dump(handle) as unknown)
  }

  /**
   * Run the realm's queued jobs, bounded.
   *
   * The deadline is re-armed here because it was cleared by whatever ran last,
   * and because each pump is a fresh stretch of *continuous* execution: a
   * script that awaits ten times gets `timeoutMs` per continuation, which is
   * what "wall clock per rule" means for code that yields.
   *
   * `executePendingJobs()` runs the queue to exhaustion, so a job that queues
   * another job for ever would never return control — the interrupt handler is
   * what breaks that, and it needs the deadline armed to fire.
   */
  private pump(vm: QuickJSContext): void {
    this.deadline = Date.now() + this.limits.timeoutMs
    const jobs = vm.runtime.executePendingJobs()
    // ⚠️ A job's error is not the completion value's error, and dropping it
    // makes an unhandled rejection inside the realm vanish silently.
    if (jobs.error) {
      const detail = vm.dump(jobs.error) as unknown
      jobs.error.dispose()
      // Flagged rather than thrown: `pump` is called from a host-promise
      // callback with no caller to catch, and from `settle` which needs to
      // poison first. `settle` reads this on its next turn.
      this.jobFailure = detail
      if (isInterrupt(detail)) this.interrupted = true
      else {
        /*
         * ⚠️ Reported, not merely recorded.
         *
         * A job error that is neither an interrupt nor the completion value's
         * own failure is an *unhandled rejection inside the realm* — a
         * side-effect promise nobody awaited. Recording it in a field the
         * happy path never reads is the same as dropping it, and the symptom
         * is a source that quietly does half its work.
         */
        this.onJobError?.(scriptError(detail))
      }
    }
  }

  /**
   * Retire a realm that breached a limit.
   *
   * ⚠️ Disposing a context with a *suspended frame* — an async function parked
   * on an `await` that will now never resume — makes QuickJS abort the whole
   * WASM instance: `RuntimeError: Aborted(...)`, thrown from inside `dispose`,
   * which then leaves the runtime allocated for ever and the realm registered.
   * Measured with three sequential 800ms awaits against a 2s budget.
   *
   * So the pending host bridges are rejected first, the queue is pumped to let
   * those rejections unwind the parked frames, and only then is the context
   * torn down. `dispose` itself is wrapped, because a realm that will not die
   * cleanly must still stop being reachable.
   */
  private async poisonWith(reason: Poison): Promise<void> {
    this.poison = reason
    const vm = this.vm
    if (vm) {
      for (const reject of [...this.pending]) {
        try {
          reject()
        } catch {
          // A bridge that cannot be rejected is one whose realm is already
          // past saving; the dispose below is what matters.
        }
      }
      this.pending.clear()
      // Unwinding, not running: the deadline stays armed so a `finally` that
      // loops cannot hold the teardown open.
      this.deadline = Date.now() + UNWIND_MS
      try {
        // The result's error branch is a handle like any other: an unwind
        // pump that itself faults leaks it if the result is dropped here.
        const jobs = vm.runtime.executePendingJobs()
        if (jobs.error) jobs.error.dispose()
      } catch {
        // Expected where the frames are already unrecoverable.
      }
      this.deadline = 0
    }
    this.dispose()
    this.poison = reason
  }

  /**
   * A value on its way out, size-checked.
   *
   * `maxResultBytes` is not about memory — the heap ceiling covers that — but
   * about what crosses into the host, where it is no longer bounded by
   * anything. A rule returning a 200MB string would otherwise become a 200MB
   * string in the app.
   */
  private bounded(value: unknown): unknown {
    let json: string | undefined
    try {
      json = JSON.stringify(value)
    } catch {
      throw new JsBridgeError('the script returned a value that cannot cross the boundary')
    }
    if (json !== undefined && json.length > this.limits.maxResultBytes) {
      throw new JsBridgeError(
        `the script returned ${json.length} bytes, over the ${this.limits.maxResultBytes}-byte limit`,
      )
    }
    return value
  }

  /** Host value → realm handle, as data. Never a live host reference. */
  private toHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
    switch (typeof value) {
      case 'undefined':
        return vm.undefined
      case 'boolean':
        return value ? vm.true : vm.false
      case 'number':
        return vm.newNumber(value)
      case 'string':
        return vm.newString(value)
      case 'bigint':
        // No BigInt bridge: silently narrowing to a Number would corrupt an
        // id past 2^53, which is exactly what a backend uses them for.
        throw new JsBridgeError('a BigInt cannot cross into the realm')
      case 'function':
      case 'symbol':
        throw new JsBridgeError(`a ${typeof value} cannot cross into the realm`)
      default:
        break
    }
    if (value === null) return vm.null

    if (Array.isArray(value)) {
      const array = vm.newArray()
      for (const [i, entry] of value.entries()) {
        const handle = this.toHandle(vm, entry)
        vm.setProp(array, i, handle)
        handle.dispose()
      }
      return array
    }

    const object = vm.newObject()
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue
      const handle = this.toHandle(vm, entry)
      vm.setProp(object, key, handle)
      handle.dispose()
    }
    return object
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Whether a dumped error is an interrupt rather than a script's own throw.
 *
 * QuickJS reports it as `InternalError: interrupted`, and there is no
 * structured marker to test instead.
 */
function isInterrupt(detail: unknown): boolean {
  const text = messageOf(detail)
  return /interrupt/i.test(text)
}

function isOutOfMemory(detail: unknown): boolean {
  return /out of memory|allocation failed/i.test(messageOf(detail))
}

function messageOf(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const { name, message } = detail as { name?: unknown; message?: unknown }
    return `${typeof name === 'string' ? name : ''}: ${typeof message === 'string' ? message : ''}`
  }
  return String(detail)
}

function wrapOutOfMemory(error: unknown, limits: JsLimits): Error {
  if (isOutOfMemory(error) || /memory/i.test(String(error))) {
    return new JsMemoryError(limits.memoryBytes)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** A script's own throw, with its realm-side stack kept as untrusted text. */
function scriptError(detail: unknown): JsScriptError {
  if (detail && typeof detail === 'object') {
    const { message, stack } = detail as { message?: unknown; stack?: unknown }
    return new JsScriptError(
      typeof message === 'string' ? message : messageOf(detail),
      typeof stack === 'string' ? stack : undefined,
    )
  }
  return new JsScriptError(String(detail))
}

export default JsQuickJsNode
