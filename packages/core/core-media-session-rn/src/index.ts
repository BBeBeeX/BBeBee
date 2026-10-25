/**
 * `ctx.mediaSession` on iOS and Android.
 *
 * One surface where desktop has two: `react-native-audio-api`'s playback
 * notification *is* the lock screen on iOS and the media notification on
 * Android, including the Android 14+ foreground service behind it. So this
 * package is thinner than `core-media-session-tauri` and has the harder
 * job, because on mobile the OS surface is the primary way people control
 * playback rather than a convenience.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * - **Artwork must be a local Uri.** So metadata is published *immediately*
 *   with whatever artwork is already local, and updated when an image lands.
 *   Delaying the whole update on an image fetch means a lock screen that stays
 *   blank for as long as the network takes (docs/11 §4.4).
 * - **`setSupportedCommands` must genuinely change the buttons.** A disabled
 *   control is `enableControl(name, false)`, not an ignored press: a button
 *   that does nothing is worse than a button that is not there.
 *
 * ⚠️ Everything is feature-detected. A build where the native module is not
 * linked — a test, an Expo Go run — must degrade to *no OS surface* rather
 * than to a crashed player.
 *
 * See docs/04 §12 and docs/11 §4.4.
 */

import { PlaybackNotificationManager } from 'react-native-audio-api'
import type { PlaybackControlName, PlaybackNotificationInfo } from 'react-native-audio-api'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Disposable,
  MediaSessionService,
  NowPlaying,
  TransportCommand,
} from '@BBeBee/protocol'

/** The slice of the notification manager used, so a test can supply its own. */
export interface NotificationManagerLike {
  show(info: PlaybackNotificationInfo): Promise<void>
  hide(): Promise<void>
  enableControl(control: PlaybackControlName, enabled: boolean): Promise<void>
  addEventListener(
    name: string,
    callback: (event: { value?: number }) => void,
  ): { remove(): void } | undefined
}

export interface MediaSessionRnConfig {
  /** Injected in tests. Defaults to the native manager. */
  notifications?: NotificationManagerLike
}

/** The notification's event names, as the protocol names the commands. */
const EVENT_TO_COMMAND: Record<string, TransportCommand['type']> = {
  playbackNotificationPlay: 'play',
  playbackNotificationPause: 'pause',
  playbackNotificationStop: 'stop',
  playbackNotificationNextTrack: 'next',
  playbackNotificationPreviousTrack: 'previous',
  playbackNotificationSeekTo: 'seek',
  playbackNotificationSkipForward: 'seek-relative',
  playbackNotificationSkipBackward: 'seek-relative',
}

/** Which native controls a contract command turns on. */
const COMMAND_TO_CONTROLS: Record<TransportCommand['type'], PlaybackControlName[]> = {
  play: ['play'],
  pause: ['pause'],
  stop: ['stop'],
  next: ['nextTrack'],
  previous: ['previousTrack'],
  seek: ['seekTo'],
  'seek-relative': ['skipForward', 'skipBackward'],
  // Not a transport control on either OS surface; the app rates in its own UI.
  rate: [],
}

const EVERY_CONTROL: PlaybackControlName[] = [
  'play', 'pause', 'stop', 'nextTrack', 'previousTrack',
  'skipForward', 'skipBackward', 'seekTo',
]

export class MediaSessionRn extends Service implements MediaSessionService {
  private readonly notifications?: NotificationManagerLike
  private readonly listeners = new Set<(c: TransportCommand) => void>()
  private subscriptions: { remove(): void }[] = []

  /*
   * What we told the OS. Kept because the surface cannot be read back, and the
   * contract is about what was published — a caller (and the conformance
   * suite) has to be able to ask.
   */
  private nowPlaying?: NowPlaying
  private playbackState: 'playing' | 'paused' | 'stopped' = 'stopped'
  private supported: TransportCommand['type'][] = ['play', 'pause', 'next', 'previous']

  /*
   * The native calls are serialised.
   *
   * `update()` and `clear()` are synchronous by contract and the calls behind
   * them are not, so an unsequenced implementation races: `clear()` hides the
   * notification while the `show()` it interrupted is still in flight, that
   * `show()` lands afterwards, and the lock screen keeps a track the player
   * has stopped — the ghost surface docs/11 §4.4 names, arriving from the one
   * direction nobody looks.
   */
  private queue: Promise<void> = Promise.resolve()

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch(() => undefined)
  }

  constructor(ctx: Context, config: MediaSessionRnConfig = {}) {
    super(ctx, 'mediaSession')
    this.notifications = config.notifications ?? nativeNotifications()
  }

  async [Service.init]() {
    for (const [event, type] of Object.entries(EVENT_TO_COMMAND)) {
      const subscription = this.notifications?.addEventListener(event, (payload) => {
        this.dispatch(toCommand(event, type, payload?.value))
      })
      if (subscription) this.subscriptions.push(subscription)
    }
    await this.applySupportedCommands()

    return () => {
      for (const subscription of this.subscriptions) subscription.remove()
      this.subscriptions = []
      this.clear()
      this.listeners.clear()
    }
  }

  update(np: NowPlaying): void {
    this.nowPlaying = np
    this.enqueue(() => this.publish())
  }

  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void {
    /*
     * ⚠️ `stopped` is a transport state, not `clear()`.
     *
     * This used to hide the notification and drop the metadata, which is a
     * different thing from what `core-media-session-tauri` does with the
     * same call — it sets the session to `none` and keeps the track. Two
     * implementations of one contract disagreeing is the drift docs/10's
     * second-loudest risk names, and the divergence had a user-visible shape:
     * a queue that ran to the end lost its lock screen on mobile and kept it
     * on desktop, so pressing play again showed nothing on one platform.
     *
     * Removing the surface is `clear()`, and it has its own member for exactly
     * this reason.
     */
    this.playbackState = state
    this.enqueue(() => this.publish())
  }

  setSupportedCommands(types: TransportCommand['type'][]): void {
    this.supported = [...types]
    this.enqueue(() => this.applySupportedCommands())
  }

  onCommand(cb: (cmd: TransportCommand) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  clear(): void {
    // Dropped *now*, not when the native call lands: `published()` is
    // synchronous and a caller that just cleared must not be told the surface
    // is still up. The queued `hide()` catches the native side up.
    this.nowPlaying = undefined
    this.playbackState = 'stopped'
    // A disabled `plugin-player` must leave no ghost notification behind.
    this.enqueue(async () => {
      await this.notifications?.hide().catch(() => undefined)
    })
  }

  /**
   * What was published, in the shape the conformance suite and the inspector
   * agree on — the same one `core-media-session-tauri` returns. Nothing
   * published answers `undefined`, so a caller cannot tell which shell it
   * asked.
   */
  published(): { nowPlaying?: NowPlaying; state?: string; commands?: string[] } | undefined {
    if (!this.nowPlaying) return undefined
    return {
      nowPlaying: this.nowPlaying,
      state: this.playbackState,
      commands: [...this.supported],
    }
  }

  private async publish(): Promise<void> {
    const np = this.nowPlaying
    // Re-read rather than captured: by the time this runs, a `clear()` queued
    // behind the `update()` that scheduled it may have dropped the track.
    if (!np || !this.notifications) return

    const info: PlaybackNotificationInfo = {
      title: np.title,
      ...(np.artist ? { artist: np.artist } : {}),
      ...(np.album ? { album: np.album } : {}),
      /*
       * Artwork only when it is already a local Uri.
       *
       * A remote one is dropped rather than fetched here: caching it is
       * `plugin-player`'s job, and the update that carries the cached copy
       * arrives moments later. Blocking this call on a download would hold the
       * whole lock screen hostage to the network.
       */
      ...(np.artworkUri && isLocal(np.artworkUri) ? { artwork: { uri: np.artworkUri } } : {}),
      ...(np.durationMs !== undefined ? { duration: np.durationMs / 1000 } : {}),
      ...(np.positionMs !== undefined ? { elapsedTime: np.positionMs / 1000 } : {}),
      ...(np.playbackRate !== undefined ? { speed: np.playbackRate } : {}),
      state: this.playbackState === 'playing' ? 'playing' : 'paused',
    }

    try {
      await this.notifications.show(info)
    } catch {
      // No notification permission, or the module is not linked. The app plays
      // on without an OS surface, which is a lost feature and not a crash.
    }
  }

  private async applySupportedCommands(): Promise<void> {
    if (!this.notifications) return
    const wanted = new Set(this.supported.flatMap((type) => COMMAND_TO_CONTROLS[type]))
    for (const control of EVERY_CONTROL) {
      // Every control is set explicitly, including the ones being turned off:
      // a control left enabled from a previous track is a button that presses
      // into nothing.
      await this.notifications.enableControl(control, wanted.has(control)).catch(() => undefined)
    }
  }

  private dispatch(command: TransportCommand | undefined): void {
    if (!command) return
    for (const listener of [...this.listeners]) listener(command)
  }
}

/** `seekTo` and the skips carry a value; everything else is a bare press. */
function toCommand(
  event: string,
  type: TransportCommand['type'],
  value: number | undefined,
): TransportCommand | undefined {
  if (type === 'seek') {
    return value === undefined ? undefined : { type: 'seek', positionMs: value * 1000 }
  }
  if (type === 'seek-relative') {
    const seconds = value ?? 15
    const sign = event === 'playbackNotificationSkipBackward' ? -1 : 1
    return { type: 'seek-relative', deltaMs: sign * seconds * 1000 }
  }
  return { type } as TransportCommand
}

/**
 * Whether artwork can be handed to the OS as-is.
 *
 * Both platforms need a local file; a remote URL is silently ignored by the
 * native side, which looks exactly like artwork that failed to load.
 */
function isLocal(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:')
}

function nativeNotifications(): NotificationManagerLike | undefined {
  try {
    return PlaybackNotificationManager as unknown as NotificationManagerLike
  } catch {
    return undefined
  }
}

export const name = 'core-media-session-rn'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.mediaSession` is usable.
 */
export async function apply(ctx: Context, config: MediaSessionRnConfig = {}) {
  ctx.logger.info('core-media-session-rn: loaded')
  const fiber = await ctx.plugin(MediaSessionRn, config)
  return () => void fiber.dispose()
}

export default { name, apply }
