/**
 * `ctx.js` on mobile — a pure-JS interpreter realm, because Hermes has no
 * WebAssembly.
 *
 * The desktop build (`core-js-quickjs-desktop`) runs QuickJS compiled to WASM:
 * a separate interpreter with no host object graph, so nothing crosses the
 * boundary except as data. React Native's Hermes implements neither
 * `WebAssembly` nor `eval`/`new Function`, so the same realm cannot be built
 * on an in-process engine — the sandbox has to be an interpreter *written* in
 * JavaScript, evaluated by Hermes like any other module code.
 *
 * The engine is `@nyariv/sandboxjs`: it parses the script into an
 * intermediate tree and executes that tree with every property access and
 * prototype method call checked against a whitelist. That model survives the
 * escapes that sink the other pure-JS candidates:
 *
 *  - `sval`: object literals are host objects, so `({}).constructor.constructor`
 *    walks straight to the host `Function` and compiles host code. Unfixable
 *    without mutating host globals.
 *  - `js-interpreter`: safe object graph, but parses ES5 only — no `const`,
 *    no arrow bodies, no `async`/`await`. Source rules are async IIFEs.
 *
 * With sandboxjs the constructor chain *reaches* a `Function`, but the value
 * the script gets back is the interpreter's own sandboxed replacement —
 * calling it evaluates the code inside the sandbox. Verified empirically for
 * direct calls, `.call`, `.apply`, `.bind` and the `AsyncFunction` twin.
 *
 * What this build cannot honour of the desktop contract (see README.md):
 *
 *  - **No heap ceiling.** There is no allocator to fail; `memoryBytes` is
 *    accepted and never enforced. Allocation blow-ups are still stopped —
 *    the loop driving them breaches the execution quota — but as a timeout,
 *    not a `JsMemoryError`.
 *  - **`timeoutMs` is enforced as a tick quota, not a wall clock.** A
 *    synchronous stretch cannot be interrupted from a single-threaded host;
 *    the quota bounds the worst-case overshoot to roughly the deadline.
 *  - **Async work the script does not return or await is unobservable** — the
 *    desktop realm pumps its job queue and reports unhandled rejections; here
 *    a fire-and-forget promise's failure is simply never linked to the caller.
 *  - **A language subset.** No `class` syntax, no get/set accessors in object
 *    literals, and a whitelist-guarded builtin surface — see README.md.
 *
 * ⚠️ Like the desktop realm, the sandbox bounds *reach*, not *intent*: a
 * script sees everything passed in and can send it anywhere an exposed
 * function allows. The source runtime pairs this with a per-source egress
 * allowlist; this package only guarantees the realm itself reaches nothing.
 *
 * See docs/04-core-services.md §19 and docs/06-music-sources.md §8.
 */

import { parse as acornParse } from 'acorn'
import type { Program as AcornProgram } from 'acorn'
import { Sandbox, SandboxExecutionQuotaExceededError } from '@nyariv/sandboxjs'
import type { IOptionParams } from '@nyariv/sandboxjs'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import {
  DEFAULT_JS_LIMITS,
  JsBridgeError,
  JsRealmDisposedError,
  JsScriptError,
  JsTimeoutError,
} from '@BBeBee/protocol'
import type { Disposable, JsLimits, JsRealm, JsService } from '@BBeBee/protocol'

/**
 * Keep in sync with the `@nyariv/sandboxjs` pin in package.json — the engine
 * report is what a source author reads when a document runs on desktop but
 * not on mobile.
 */
const SANDBOXJS_VERSION = '0.9.7'

export interface JsMobileConfig {
  /** Applied where a caller does not override. */
  limits?: Partial<JsLimits>
}

export class JsSandboxMobile extends Service implements JsService {
  readonly engine = { name: '@nyariv/sandboxjs', version: SANDBOXJS_VERSION }

  /** Every live realm, so unloading the service cannot leak one. */
  private readonly realms = new Set<SandboxJsRealm>()

  constructor(
    ctx: Context,
    private readonly config: JsMobileConfig = {},
  ) {
    super(ctx, 'js')
  }

  async [Service.init]() {
    // Nothing to compile ahead of time — a realm is built on first use.
    return () => {
      for (const realm of [...this.realms]) realm.dispose()
    }
  }

  async createRealm(limits: Partial<JsLimits> = {}): Promise<JsRealm> {
    const resolved: JsLimits = { ...DEFAULT_JS_LIMITS, ...this.config.limits, ...limits }
    const realm = new SandboxJsRealm(resolved)
    this.realms.add(realm)
    return realm
  }
}

/**
 * Ticks per millisecond a loop body costs on the interpreter, used to size
 * the per-eval quota from `timeoutMs`.
 *
 * Measured on Node at 250–540 ticks/ms for loop-shaped work; a phone runs the
 * same interpreter several times slower. 500 keeps the interrupt within
 * roughly one `timeoutMs` of the deadline on both — the quota is a bound on
 * the overshoot, not the clock itself (see the header).
 */
const TICKS_PER_MS = 500

const MIN_TICKS = 50_000n
const MAX_TICKS = 50_000_000n

function quotaFor(timeoutMs: number): bigint {
  const quota = BigInt(Math.round(timeoutMs * TICKS_PER_MS))
  return quota < MIN_TICKS ? MIN_TICKS : quota > MAX_TICKS ? MAX_TICKS : quota
}

/**
 * The builtin globals, tightened from the library defaults.
 *
 * One adjustment, in the direction of less reach: `console` is removed. The
 * desktop realm has none — a script narrates through `src.log`, and a stray
 * `console.log` must not write into the host's log stream. Everything else
 * the defaults already answer: `Function`, `eval` and friends resolve to the
 * interpreter's sandboxed replacements, and host globals like `fetch` or
 * `process` are not in the surface at all.
 */
function realmGlobals(): Record<string, unknown> {
  const globals: Record<string, unknown> = { ...Sandbox.SAFE_GLOBALS }
  globals['console'] = undefined
  return globals
}

/**
 * The prototype whitelist, widened only where the source model needs it.
 *
 * `Object.freeze`/`isFrozen`/`assign` are not in the default statics, and
 * the runtime's own shim (`SRC_SHIM`) opens with `Object.freeze` — without
 * these, every scripted source fails at realm setup. Everything else the
 * defaults already answer.
 */
function realmPrototypes(): NonNullable<IOptionParams['prototypeWhitelist']> {
  const map: NonNullable<IOptionParams['prototypeWhitelist']> = new Map(Sandbox.SAFE_PROTOTYPES)
  const objectStatics = map.get(Object) ?? new Set<string>()
  map.set(
    Object,
    new Set([...objectStatics, 'freeze', 'isFrozen', 'assign']),
  )
  return map
}

/**
 * The iterator prototypes `for…of` over strings and Map/Set entries walks.
 *
 * The engine's default whitelist covers array iterators but not the string,
 * Map and Set ones, so a rule iterating a page of titles over `for…of` dies
 * with a `SandboxAccessError` halfway through.
 *
 * ⚠️ These are added to the *built* realm's whitelist, not to the options:
 * the constructor maps every option entry by `ctor.prototype`, which turns
 * a raw prototype key into `undefined`. The built map is keyed by the
 * prototype objects themselves.
 */
function iteratorPrototypes(): object[] {
  const protos = [
    ''[Symbol.iterator](),
    new Map()[Symbol.iterator](),
    new Set()[Symbol.iterator](),
  ].map((it) => Object.getPrototypeOf(it))
  protos.push(Object.getPrototypeOf(protos[0]!))
  return protos
}

function buildRealm(limits: JsLimits): Sandbox {
  const sandbox = new Sandbox({
    executionQuota: quotaFor(limits.timeoutMs),
    globals: realmGlobals(),
    prototypeWhitelist: realmPrototypes(),
  })
  const whitelist = sandbox.context.prototypeWhitelist
  for (const proto of iteratorPrototypes()) whitelist.set(proto, new Set())
  return sandbox
}

/**
 * Prepare a script for the engine.
 *
 * Two jobs, both dictated by the contract's `eval`:
 *
 *  - **The grammar gate.** The engine's parser is lenient in places the spec
 *    is not (`function (` parses!), so acorn — a spec-faithful ES2022 parser
 *    — decides what is JavaScript at all. Code it refuses is a script error,
 *    the same answer the QuickJS realm gives, not an engine quirk.
 *  - **The completion value.** The engine compiles a script as a function
 *    body, so a trailing expression statement has no value and
 *    `eval("1 + 41")` would answer `undefined`. `eval` resolves with the
 *    completion value, which is the value of the last expression statement —
 *    so `return` is spliced in front of it.
 */
function prepare(code: string): string {
  let program: AcornProgram
  try {
    program = acornParse(code, { ecmaVersion: 'latest' })
  } catch (error) {
    throw new JsScriptError(`syntax error: ${(error as Error).message}`)
  }
  const last = program.body[program.body.length - 1]
  if (last?.type === 'ExpressionStatement') {
    return code.slice(0, last.start) + 'return ' + code.slice(last.start)
  }
  return code
}

/** Why a realm stopped being usable. `undefined` means it still is. */
type Poison = 'disposed' | 'timeout'

/**
 * Resolves the budget race when the wall clock runs out. A sentinel object
 * rather than a value: a script's own completion value can never be it, and
 * a promise resolved with it can never reject, so the losing branch of the
 * race is never an unhandled rejection.
 */
const BUDGET_FIRED: { readonly budget: true } = Object.freeze({ budget: true })

class SandboxJsRealm implements JsRealm {
  /**
   * The realm's interpreter. `undefined` once disposed or poisoned — every
   * later call rejects, and the reference is dropped for the GC, which is
   * the whole teardown: unlike the QuickJS build there are no native handles
   * to free, only object graphs to unlink.
   */
  private sandbox: Sandbox | undefined

  /** See `JsRealm.disposed`: a caller that caches a realm needs to know. */
  get disposed(): boolean {
    return this.sandbox === undefined
  }
  private poison: Poison | undefined

  /**
   * Evaluations are serialized per realm. The interpreter's tick counter and
   * halt flag are shared by every execution on the same engine instance, so
   * two interleaved evals would blur each other's limits — the desktop realm
   * tolerates concurrency, this one queues it.
   */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly limits: JsLimits) {
    this.sandbox = buildRealm(limits)
  }

  async preload(code: string): Promise<void> {
    await this.run(code)
  }

  async eval<T = unknown>(code: string, scope: Record<string, unknown> = {}): Promise<T> {
    const sandbox = this.live()
    // Globals, not call arguments: `jsLib` declares helpers at top level and
    // a rule expects to see them, and scope values written here stay visible
    // to later evals on this realm — the same shape as the desktop build.
    for (const [name, value] of Object.entries(scope)) {
      sandbox.context.sandboxGlobal[name] = crossIntoRealm(value)
    }
    return (await this.run(code)) as T
  }

  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable {
    const sandbox = this.live()
    sandbox.context.sandboxGlobal[name] = (...args: unknown[]) => {
      // Arguments arrive as plain data, and the host function's answer goes
      // back the same way. A host promise is returned as a promise — the
      // interpreted `await` picks it up through the engine's async executor.
      const decoded = args.map((arg) => crossOutOfRealm(arg))
      const result = fn(...decoded)
      if (isThenable(result)) return Promise.resolve(result).then((value) => crossOutOfRealm(value))
      return crossOutOfRealm(result)
    }
    // `Disposable` is a bare function in this protocol, not `{ dispose() }`.
    return () => {
      if (this.sandbox !== sandbox) return
      delete sandbox.context.sandboxGlobal[name]
    }
  }

  dispose(): void {
    // Idempotent by contract: a disposer may legitimately run from a fiber
    // teardown *and* an explicit call, and the second must not throw.
    this.poison ??= 'disposed'
    this.sandbox = undefined
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  private live(): Sandbox {
    if (!this.sandbox) throw new JsRealmDisposedError(this.poison ?? 'disposed')
    return this.sandbox
  }

  /**
   * Run one evaluation, serialized, with the limits armed.
   *
   * The engine's tick counter is the only thing that can stop a synchronous
   * loop, so it is reset per eval — a realm's evaluations are independent
   * stretches, each bounded by its own `timeoutMs`. The wall-clock budget
   * bounds the call as a whole: it cannot interrupt a running stretch (the
   * host is single-threaded and the quota covers that case) but it ends a
   * script that yields for ever in individually-legal slices, matching the
   * desktop build's budget semantics.
   */
  private run(code: string): Promise<unknown> {
    const previous = this.queue.catch(() => undefined)
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    return previous.then(() => this.runExclusive(code)).finally(release)
  }

  private async runExclusive(code: string): Promise<unknown> {
    const sandbox = this.live()
    sandbox.context.ticks.ticks = 0n

    const execution = sandbox
      .compileAsync(prepare(code))()
      .run() as Promise<unknown>
    /*
     * A rejection that arrives after the budget already ended this call —
     * the quota firing inside a continuation the halt just abandoned — has
     * nobody left to reach. Swallowed here so it cannot surface as an
     * unhandled rejection on the host.
     */
    execution.catch(() => undefined)

    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<typeof BUDGET_FIRED>((resolve) => {
      timer = setTimeout(() => {
        // Halt, not throw: the engine stops at its next suspension point,
        // the in-flight execution never settles, and the rejection the
        // caller sees is the budget's. The realm retires with it.
        sandbox.haltExecution()
        resolve(BUDGET_FIRED)
      }, Math.max(0, this.limits.budgetMs))
    })

    let outcome: unknown
    try {
      outcome = await Promise.race([execution, budget])
    } catch (error) {
      clearTimeout(timer)
      if (error instanceof SandboxExecutionQuotaExceededError) {
        // The quota is the mobile word for the engine deadline: the realm's
        // state after it is abandoned mid-execution, so it retires the same
        // way a desktop realm does after an interrupt.
        this.poisonWith('timeout')
        throw new JsTimeoutError(this.limits.timeoutMs)
      }
      // Everything else is the script's own failure — a throw, a denied
      // builtin access, a parse error. The realm is still sound.
      throw scriptError(error)
    }
    clearTimeout(timer)

    if (outcome === BUDGET_FIRED) {
      this.poisonWith('timeout')
      throw new JsTimeoutError(this.limits.budgetMs)
    }
    return this.bounded(crossOutOfRealm(outcome))
  }

  /** Retire a realm that breached a limit; every later call rejects. */
  private poisonWith(reason: Poison): void {
    this.poison = reason
    this.sandbox = undefined
  }

  /**
   * A value on its way out, size-checked.
   *
   * `maxResultBytes` is not about memory — there is no heap ceiling here to
   * speak of — but about what crosses into the host, where it is no longer
   * bounded by anything.
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
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Host value → realm value, as data. Never a live host reference.
 *
 * The shape mirrors the desktop build's `toHandle`: plain objects and arrays
 * are deep-copied (so a script mutating a scope value cannot reach back into
 * the host), `undefined` properties are dropped, and values that are not
 * data — functions, symbols, BigInts — are refused rather than silently
 * corrupted.
 */
function crossIntoRealm(value: unknown): unknown {
  switch (typeof value) {
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'string':
      return value
    case 'bigint':
      // No BigInt bridge in: silently narrowing to a Number would corrupt an
      // id past 2^53, which is exactly what a backend uses them for.
      throw new JsBridgeError('a BigInt cannot cross into the realm')
    case 'function':
    case 'symbol':
      throw new JsBridgeError(`a ${typeof value} cannot cross into the realm`)
    default:
      break
  }
  if (value === null) return null
  if (Array.isArray(value)) return value.map((entry) => crossIntoRealm(entry))
  const object: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue
    object[key] = crossIntoRealm(entry)
  }
  return object
}

/**
 * Realm value → host value, as data.
 *
 * The desktop build's `dump()` answers the same question: what does this
 * value look like as plain host data? Functions and symbols become
 * `undefined`, a BigInt crosses whole (the desktop dump produces one too),
 * and anything without a data shape — a Map, a Date — degrades to its
 * enumerable surface, which is what `dump` produced as well.
 */
function crossOutOfRealm(value: unknown): unknown {
  switch (typeof value) {
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'string':
    case 'bigint':
      return value
    case 'function':
    case 'symbol':
      return undefined
    default:
      break
  }
  if (value === null) return null
  if (Array.isArray(value)) return value.map((entry) => crossOutOfRealm(entry))
  const object: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    object[key] = crossOutOfRealm(entry)
  }
  return object
}

/** A script's own failure, with no host stack attached. */
function scriptError(error: unknown): JsScriptError {
  if (error instanceof Error) return new JsScriptError(error.message)
  return new JsScriptError(String(error))
}

export default JsSandboxMobile
