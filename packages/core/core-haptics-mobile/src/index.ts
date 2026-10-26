/**
 * `ctx.haptics` on iOS and Android, over `expo-haptics`.
 *
 * The smallest core service and the only one whose whole job is to *lose*
 * information: a caller names a cue — `impact`, `notification`, `selection`,
 * `tap` — and everything past that (which native generator, which platform's
 * semantics, whether the device has an engine at all) is decided here and
 * never surfaces again. A view package calls `ctx.haptics.tap()` the same way
 * on both shells; on desktop nothing answers the key, and that is the feature
 * (docs/ui/architecture.md §7 names haptics one of the mobile-only surfaces).
 * See the contract: packages/protocol/src/services/integration.ts.
 *
 * Four things are load-bearing and easy to get wrong:
 *
 * - **Everything is fire-and-forget.** The contract methods return `void`
 *   because feedback accompanies a gesture, it never gates one: awaiting the
 *   native call would tie the caller's next frame to a bridge round-trip.
 * - **A device without an engine is normal, not an error.** Expo Go, the
 *   Android emulator, system-settings haptics off — the first rejected call
 *   marks the engine unavailable, warns exactly once, and every later cue is
 *   a silent no-op. A user who never feels anything must not also own a log
 *   full of the fact, and a player that crashed over a missing vibrator
 *   would have its priorities inverted.
 * - **The default triggers observe; they do not inject.** This is Layer 2,
 *   `ctx.player` is Layer 4, so the cues listen on the event bus and nothing
 *   here names the player service — a core service injecting a feature would
 *   invert the layer model the import matrix exists to keep. The trigger set
 *   is deliberately sparse, because haptics punish over-firing faster than
 *   any other surface: `player/state-changed` carries the whole transport —
 *   status, position and all — and fires for seeks and status flips too, so
 *   only the *discrete* user-visible toggles (`repeat`, `shuffle`,
 *   `playMode`) tick, and only when they actually changed.
 * - **No favorite trigger, on purpose.** `library/changed` carries the URN's
 *   kind and nothing else — no direction — and the same `('track', urns)`
 *   shape arrives from un-favoriting, pin toggles, and the local scanner's
 *   bulk batches (one walk of a large directory can emit hundreds). Nothing
 *   in the payload distinguishes "the user just tapped the heart", so wiring
 *   it would buzz the phone for every file scanned. `tap()` is what the
 *   heart button's own press handler calls, where the intent is
 *   unambiguous. Revisit only if the protocol grows a directional
 *   `library/saved` event.
 */

import * as Haptics from 'expo-haptics'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  HapticsImpactStyle,
  HapticsNotificationType,
  HapticsService,
  TransportState,
} from '@BBeBee/protocol'

/**
 * Protocol cue names onto the SDK enums, exhaustively.
 *
 * The two vocabularies agree today ('light'…'soft', 'success'…'error'), so a
 * cast would work — until an SDK bump renamed a member and the cast kept
 * compiling while the phone buzzed the wrong cue. The record turns any
 * divergence into a compile error, which is where a wrong haptic is cheapest.
 */
const IMPACT_STYLE: Record<HapticsImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
}

const NOTIFICATION_TYPE: Record<HapticsNotificationType, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
}

export interface HapticsExpoConfig {
  /**
   * The master switch at boot. `setEnabled` flips it at runtime; a user who
   * turned feedback off gets silence, not an uninstall.
   */
  enabled?: boolean
  /**
   * Whether the player-event cues are wired (default yes). Off for a caller
   * that wants only direct cues — a settings screen previewing intensities,
   * for instance, must not tick because something is playing.
   */
  triggers?: boolean
}

export class HapticsExpo extends Service implements HapticsService {
  /**
   * The plugin's own context, captured at construction: inside a method
   * reached through the service proxy Cordis shadows `this.ctx` to the
   * *caller's* context. See the note in `plugin-library`.
   */
  private readonly ownCtx: Context

  /** In-memory only: the persisted setting is `ctx.settings`'s to keep. */
  private on: boolean

  /** Set the first time native rejects a cue; see the file header. */
  private unavailable = false

  /**
   * The mode fields of the last seen `player/state-changed`. The first event
   * is a baseline, not a change — booting must not tap.
   */
  private seenModes?: Pick<TransportState, 'repeat' | 'shuffle' | 'playMode'>

  constructor(
    ctx: Context,
    private readonly config: HapticsExpoConfig = {},
  ) {
    super(ctx, 'haptics')
    this.ownCtx = ctx
    this.on = config.enabled ?? true
  }

  get enabled(): boolean {
    return this.on
  }

  setEnabled(on: boolean): void {
    this.on = on
  }

  impact(style: HapticsImpactStyle = 'light'): void {
    this.fire('impact', () => Haptics.impactAsync(IMPACT_STYLE[style]))
  }

  notification(type: HapticsNotificationType = 'success'): void {
    this.fire('notification', () => Haptics.notificationAsync(NOTIFICATION_TYPE[type]))
  }

  selection(): void {
    this.fire('selection', () => Haptics.selectionAsync())
  }

  /** The contract's one-tap cue is a light impact — its own word, not a style. */
  tap(): void {
    this.impact('light')
  }

  /* ── the default triggers ──────────────────────────────────────────────── */

  async [Service.init]() {
    if (this.config.triggers === false) return

    const offs = [
      this.ownCtx.on('player/track-changed', (trackUrn) => {
        // `undefined` is the queue emptying, not a pick the user made — a
        // tick for "nothing now playing" is the phone complaining.
        if (trackUrn !== undefined) this.selection()
      }),
      this.ownCtx.on('player/state-changed', (state) => this.onStateChanged(state)),
    ]

    return () => {
      for (const off of offs) off()
      // A restart re-baselines: the "first event after boot" rule applies
      // again, so reloading this plugin cannot resurrect a stale diff.
      this.seenModes = undefined
    }
  }

  /**
   * Tap only when a play-mode toggle actually flipped.
   *
   * The event fires for the whole transport, so a seek or a pause arrives
   * with the modes unchanged; without the diff every one of those would
   * buzz, and a buzz per position update is a device that feels broken.
   */
  private onStateChanged(state: TransportState): void {
    const modes = {
      repeat: state.repeat,
      shuffle: state.shuffle,
      playMode: state.playMode,
    }
    const seen = this.seenModes
    this.seenModes = modes
    if (!seen) return
    if (
      seen.repeat !== modes.repeat ||
      seen.shuffle !== modes.shuffle ||
      seen.playMode !== modes.playMode
    ) {
      this.tap()
    }
  }

  /* ── the native edge ───────────────────────────────────────────────────── */

  /**
   * Dispatch one cue without waiting for it, and stop trying the moment the
   * native side proves it cannot serve one.
   */
  private fire(cue: string, call: () => Promise<void>): void {
    if (!this.on || this.unavailable) return
    let promise: Promise<void>
    try {
      promise = call()
    } catch {
      // An unlinked module throws synchronously rather than rejecting; the
      // degradation is the same one.
      this.markUnavailable(cue)
      return
    }
    void promise.catch(() => this.markUnavailable(cue))
  }

  private markUnavailable(cue: string): void {
    // The flag goes up before the warn: two cues in flight when the engine
    // dies race to report it, and the loser must find the flag already set
    // rather than warn a second time.
    if (this.unavailable) return
    this.unavailable = true
    this.ownCtx.logger.warn(
      `haptics: native engine refused the "${cue}" cue — feedback is off for the rest of this session`,
    )
  }
}

export default HapticsExpo
