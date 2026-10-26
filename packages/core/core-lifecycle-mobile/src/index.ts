/**
 * `ctx.lifecycle` on iOS and Android, over `AppState` and `expo-splash-screen`.
 *
 * Two jobs nothing else in the stack has a way to do:
 *
 * - **Phases.** `AppState` is the only foreground-ness signal either platform
 *   offers, and this service is its one translation onto the contract's three
 *   phases. The OS re-sends statuses it has already reported, so a transition
 *   that does not change the phase is dropped here rather than re-broadcast —
 *   "the app became active" must mean that, not "some event arrived". A real
 *   transition is published exactly once, to the `lifecycle/phase-changed`
 *   event and to `onPhaseChange` subscribers, from one code path so the two
 *   cannot disagree.
 *
 *   ⚠️ **`inactive` is iOS's transient state** — the control centre, the
 *   notification shade, an incoming-call sheet. It is *not* backgrounded, and
 *   consumers must not checkpoint or pause on it; only `background` means the
 *   process is about to stop being scheduled. The event canon carries the same
 *   warning on `lifecycle/phase-changed` (packages/protocol/src/events.ts).
 *   `launchKind` encodes that distinction: only an `active` arrival *after*
 *   the app has actually been to `background` makes the session `'resume'`, so
 *   the `active → inactive → active` bounce of an app-switcher peek stays
 *   `'cold'` — and because iOS may route a real return through `inactive`
 *   (`background → inactive → active`), the flip is keyed on having been
 *   backgrounded at all, not on the literal last hop.
 *
 * - **The splash.** `preventAutoHideAsync` is called during `init` and *not*
 *   awaited — a splash module that hangs must not hang the boot — and its
 *   rejection is a warn-and-continue: the app has to come up even if the
 *   splash screen argues. `hideSplash` is what the composition root calls once
 *   the first screen is ready to draw; it waits for the prevent to have
 *   settled first, because a hide landing before the prevent is the exact
 *   flash the splash exists to prevent, and it is idempotent, so two callers
 *   racing to reveal the app cannot double-hide.
 *
 * `unknown` and `extension` statuses (RN reports the former before the app has
 * a state, the latter from iOS share extensions) are not phases the contract
 * knows and are ignored.
 *
 * See the contract: packages/protocol/src/services/integration.ts.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native'
import { hideAsync, preventAutoHideAsync } from 'expo-splash-screen'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Disposable, LifecyclePhase, LifecycleService } from '@BBeBee/protocol'

/**
 * Map an RN status onto the contract's phases, or `undefined` where RN reports
 * something the contract has no word for (`unknown`, `extension`). `currentState`
 * is typed loosely by RN (`string | null | undefined`), hence the wide input.
 */
function toPhase(status: AppStateStatus | string | null | undefined): LifecyclePhase | undefined {
  if (status === 'active' || status === 'inactive' || status === 'background') return status
  return undefined
}

export class LifecycleExpo extends Service implements LifecycleService {
  /**
   * The plugin's own context, captured at construction: inside a method
   * reached through the service proxy Cordis shadows `this.ctx` to the
   * *caller's* context. See the note in `core-haptics-mobile`.
   */
  private readonly ownCtx: Context

  /** `'active'` until `init` replaces it from `AppState.currentState`. */
  private current: LifecyclePhase = 'active'
  /** `'unknown'` only before `init`; `'cold'` from then until the first resume. */
  private launch: 'cold' | 'resume' | 'unknown' = 'unknown'
  /** The `active`-after-`background` flip's memory; see the file header. */
  private hasBackgrounded = false
  /** Set on the first `hideSplash` call — the idempotence flag. */
  private hidden = false
  /** Guards the prevent-rejection warn to exactly once. */
  private preventWarned = false
  /** The prevent call, already caught — `hideSplash` awaits it for ordering. */
  private prevented?: Promise<void>

  private readonly phaseListeners = new Set<(phase: LifecyclePhase, previous: LifecyclePhase) => void>()

  private appStateSubscription?: NativeEventSubscription

  constructor(ctx: Context) {
    super(ctx, 'lifecycle')
    this.ownCtx = ctx
  }

  get phase(): LifecyclePhase {
    return this.current
  }

  get launchKind(): 'cold' | 'resume' | 'unknown' {
    return this.launch
  }

  /**
   * Subscribe to phase transitions from the same path that emits
   * `lifecycle/phase-changed`, for callers that prefer a handle over the event
   * bus — `core-background-mobile`'s suspend checkpoint is the shape this
   * mirrors. Disposing the returned `Disposable` stops exactly this callback.
   */
  onPhaseChange(cb: (phase: LifecyclePhase, previous: LifecyclePhase) => void): Disposable {
    this.phaseListeners.add(cb)
    return () => {
      this.phaseListeners.delete(cb)
    }
  }

  /**
   * Reveal the app under the splash screen. The composition root calls this
   * once the first screen is ready to draw — never earlier, because a splash
   * hidden over a blank frame is the flash it exists to prevent.
   *
   * Idempotent: the first call wins and later calls return immediately, so
   * several boot-time callers cannot double-hide. The prevent from `init` is
   * awaited first, so a hide can never overtake it however slow the native
   * side was. A rejection warns and resolves — revealing the app is not
   * optional, and a splash that refuses to go is a cosmetic defect, not a
   * boot failure.
   */
  async hideSplash(): Promise<void> {
    if (this.hidden) return
    this.hidden = true
    await this.prevented
    try {
      await hideAsync()
    } catch {
      this.ownCtx.logger.warn('lifecycle: hideAsync rejected — the splash may linger over a ready app')
    }
  }

  /**
   * The one `AppState` listener for the service's lifetime.
   *
   * `emit` does not isolate the emitter from a throwing listener — Cordis
   * dispatches synchronously, so a throw propagates into this handler and from
   * there into the OS's event dispatch (packages/protocol/src/events.ts). The
   * emit and each callback are therefore guarded: one misbehaving consumer
   * must not take the phase signal away from the others.
   */
  private onAppStateChange(status: AppStateStatus): void {
    const next = toPhase(status)
    if (!next) return
    const previous = this.current
    if (next === previous) return

    if (next === 'background') this.hasBackgrounded = true
    if (next === 'active' && this.hasBackgrounded) this.launch = 'resume'
    this.current = next

    try {
      this.ownCtx.emit('lifecycle/phase-changed', next, previous)
    } catch {
      /* a throwing listener is the listener's defect, not the OS signal's */
    }
    for (const listener of [...this.phaseListeners]) {
      try {
        listener(next, previous)
      } catch {
        /* one failing callback must not stop the others */
      }
    }
  }

  async [Service.init]() {
    // RN reports `unknown` before the app has a state; a launching app is
    // heading to `active`, and the first change event corrects this anyway.
    this.current = toPhase(AppState.currentState) ?? 'active'
    this.launch = 'cold'

    // Swallowed here rather than in `hideSplash`'s `catch`: the promise this
    // stores is awaited on the hide path, and a rejection left in it would
    // surface there as a hide failure, which it is not — the prevent failed.
    this.prevented = (async () => {
      try {
        await preventAutoHideAsync()
      } catch {
        // Warn exactly once: a build where the module argues will argue for
        // every caller, and the user's log should say so once, not per call.
        if (this.preventWarned) return
        this.preventWarned = true
        this.ownCtx.logger.warn(
          'lifecycle: preventAutoHideAsync rejected — booting continues, the splash may flash',
        )
      }
    })()

    this.appStateSubscription = AppState.addEventListener('change', (next) => {
      this.onAppStateChange(next)
    })

    return () => {
      this.appStateSubscription?.remove()
      this.appStateSubscription = undefined
      this.phaseListeners.clear()
    }
  }
}

export default LifecycleExpo
