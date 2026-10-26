/**
 * `ctx.liveActivity` on iOS — the Dynamic Island and the lock-screen Live
 * Activity.
 *
 * This package is a contract waiting for its other half. The JS side is done
 * and final; the Swift ActivityKit wrapper is not, so every build today — a
 * test, an Expo Go run, a dev client without the module linked — answers
 * `supported: false` and every method resolves as a no-op. That degradation
 * is deliberate, and it is the same bargain `core-media-session-mobile`
 * makes: a missing native surface must cost the Dynamic Island, never a boot.
 *
 * THE NATIVE CONTRACT — spelled out here because the code below enforces it:
 *
 * - A Swift object named `BBeBeeLiveActivity` on the RN bridge —
 *   `NativeModules.BBeBeeLiveActivity` — exposing `start(state)`,
 *   `update(state)` and `end()`. Each may return a promise or nothing; JS
 *   wraps the return in `Promise.resolve`, so the Swift side chooses freely.
 * - `state` is plain, JSON-able — `{ title, artist?, artworkUri?, status:
 *   'playing' | 'paused', positionMs, durationMs }` — `LiveActivityState`
 *   verbatim: the object the caller built, no field synthesized or dropped,
 *   optional fields present by their presence and absent by their absence.
 * - The native side owns the running clock. JS pushes *discrete* state
 *   changes only — play, pause, seek, track change — and Swift animates
 *   `positionMs` forward between them and holds ActivityKit's stale-date
 *   that keeps the activity alive. A 1 Hz position stream from JS is a
 *   contract violation, not an optimisation: it would spend the bridge to
 *   keep a clock the island already has.
 * - `artworkUri` must be a local file Uri, the same policy as
 *   `NowPlaying.artworkUri` in `packages/protocol/src/services/platform.ts`:
 *   the native side cannot fetch, so remote artwork is cached by the caller
 *   first, and an absent `artworkUri` means "draw without a cover", never
 *   "wait for one".
 *
 * The state machine is forgiving in both directions, on purpose. `start` when
 * already live is an update — ActivityKit has no "replace", and ending one
 * island to begin an identical other would blink it for nothing. `update`
 * before any `start` is a start — the player publishes state the same way on
 * either side of a track boundary, and "the island was not up yet" is not a
 * reason to drop the track's first paint. `end` with nothing live resolves as
 * a no-op, so a caller never has to care which side it landed on.
 *
 * A native rejection demotes the service to the not-supported state for the
 * rest of the session: one `ctx.logger.warn`, then silence. The stale-date
 * the native side owns is the backstop for an activity whose handle JS has
 * just lost — and poking a module that refused once would turn one lost
 * island into a log-spamming failure loop.
 */

import { NativeModules, Platform } from 'react-native'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { LiveActivityService, LiveActivityState } from '@BBeBee/protocol'

/**
 * The slice of the Swift object this service drives, so a test can supply
 * its own. Every member may return a promise or nothing — a native module
 * that has nothing to report back should not have to invent a `void` promise
 * to be heard.
 */
export interface LiveActivityNativeLike {
  start(state: LiveActivityState): Promise<void> | void
  update(state: LiveActivityState): Promise<void> | void
  end(): Promise<void> | void
}

export class LiveActivityIos extends Service implements LiveActivityService {
  private readonly native?: LiveActivityNativeLike
  /** `supported`'s live value: computed once at construction, only ever narrowed after. */
  private available: boolean = false
  /*
   * Whether *we* put an activity up. The native side cannot be asked, so this
   * bookkeeping is what makes `end` idempotent and a double `start` collapse
   * into an update.
   */
  private active: boolean = false
  /** Guards the one-and-only warn of a degraded session. */
  private warned: boolean = false

  constructor(ctx: Context) {
    super(ctx, 'liveActivity')
    /*
     * Computed once, here, and never re-probed: `Platform.OS` does not change
     * under a running app, and re-reading `NativeModules` per call would let
     * `supported` flap mid-session — a caller that branched on it a line ago
     * would be told something different a line later.
     */
    let native: LiveActivityNativeLike | undefined
    if (Platform.OS === 'ios') {
      try {
        native = NativeModules['BBeBeeLiveActivity'] as LiveActivityNativeLike | undefined
      } catch {
        /* a bare JS runtime in a test has no native modules at all */
      }
    }
    this.native = native
    this.available = native !== undefined
  }

  /** True only where the Swift object is linked — and stays false once a native error said so. */
  get supported(): boolean {
    return this.available
  }

  async start(state: LiveActivityState): Promise<void> {
    const native = this.gate()
    if (!native) return
    // ActivityKit has no "replace": a second start on a live activity is the
    // same update, and ending one island to begin an identical other would
    // blink it off and on for nothing.
    if (this.active) return this.update(state)
    // Set before the await: which native verb a call uses is decided at call
    // time, not at promise-settlement time.
    this.active = true
    await this.invoke(() => native.start(state))
  }

  async update(state: LiveActivityState): Promise<void> {
    const native = this.gate()
    if (!native) return
    if (!this.active) return this.start(state)
    // The state crosses the bridge verbatim — the caller's object, unmoved.
    await this.invoke(() => native.update(state))
  }

  async end(): Promise<void> {
    const native = this.gate()
    if (!native) return
    if (!this.active) return
    // Down *now*, not when the native call lands: a rapid double `end` must
    // reach the island exactly once, and waiting for the bridge would let
    // both through.
    this.active = false
    await this.invoke(() => native.end())
  }

  async [Service.init]() {
    return () => {
      /*
       * An unloaded plugin must not leave an island running into its stale
       * date with no JS side left to end it. `end()` is already a resolved
       * no-op when nothing is active, and the call is fire-and-forget on
       * purpose — the fiber is going away, nothing is left to observe the
       * result — but it catches its own rejections, so nothing is left
       * pending either.
       */
      void this.end()
    }
  }

  /**
   * One gate for both "never detected" and "marked unavailable": a caller
   * cannot tell which it met, and the cost is the same — a session without
   * an island. The unavailable case is additionally silent, by contract.
   */
  private gate(): LiveActivityNativeLike | undefined {
    return this.available ? this.native : undefined
  }

  private async invoke(call: () => Promise<void> | void): Promise<void> {
    try {
      // `Promise.resolve` is what lets the Swift side return a promise or
      // nothing at all — whichever it hands back becomes awaitable here.
      await Promise.resolve(call())
    } catch (err) {
      this.markUnavailable(err)
    }
  }

  private markUnavailable(err: unknown): void {
    this.available = false
    // The activity's real state is unknowable after a refusal; claiming we
    // still own one would be a bookkeeping lie. The stale-date the native
    // side holds is what actually retires it.
    this.active = false
    if (this.warned) return
    this.warned = true
    this.ctx.logger.warn(
      `core-live-activity-mobile: native Live Activity call rejected ` +
        `(${err instanceof Error ? err.message : String(err)}); ` +
        'Live Activity disabled for the rest of this session',
    )
  }
}

export default LiveActivityIos
