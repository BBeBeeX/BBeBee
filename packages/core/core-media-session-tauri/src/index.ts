/**
 * `ctx.mediaSession` on desktop.
 *
 * Two surfaces, one contract. Chromium's `navigator.mediaSession` in the
 * renderer drives the browser-level integration and, on macOS, the Now Playing
 * centre; `main` drives MPRIS on Linux and SMTC on Windows, which have no
 * renderer-side API at all. Both are fed from the same `update()`, so a
 * divergence between what the two show is not expressible.
 *
 * ⚠️ Neither surface is available under test, and both are optional at
 * runtime: a Linux box with no MPRIS daemon, or a renderer whose
 * `navigator.mediaSession` is undefined, must degrade to *no OS surface*
 * rather than to a crashed player. Everything here is therefore
 * feature-detected, and the service keeps its own view of what it published so
 * the contract is honoured even when nothing is listening.
 *
 * See docs/04 §12 and docs/11 §4.4.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  Disposable,
  MediaSessionService,
  NowPlaying,
  TransportCommand,
} from '@BBeBee/protocol'
import { requireBridge } from '@BBeBee/core-desktop-bridge'
import type { BridgeApi } from '@BBeBee/core-desktop-bridge'

/** The slice of `navigator.mediaSession` used, structurally so tests can fake it. */
export interface MediaSessionLike {
  metadata: unknown
  playbackState: 'none' | 'paused' | 'playing'
  setActionHandler(action: string, handler: ((details?: unknown) => void) | null): void
  setPositionState?(state: { duration: number; position: number; playbackRate: number }): void
}

export interface MediaSessionTauriConfig {
  /** Injected in tests. Defaults to the renderer's own. */
  session?: MediaSessionLike
  /** Injected in tests. Defaults to the preload bridge. */
  bridge?: BridgeApi
  /** Construct a `MediaMetadata`. Absent in a test realm, present in Chromium. */
  metadataFactory?: (init: Record<string, unknown>) => unknown
}

export type MediaSessionElectronConfig = MediaSessionTauriConfig

/** Commands the OS can raise, mapped from Chromium's action names. */
const ACTION_TO_COMMAND: Record<string, TransportCommand['type']> = {
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  nexttrack: 'next',
  previoustrack: 'previous',
  seekto: 'seek',
  seekforward: 'seek-relative',
  seekbackward: 'seek-relative',
}

const COMMAND_TO_ACTION: Record<TransportCommand['type'], string[]> = {
  play: ['play'],
  pause: ['pause'],
  stop: ['stop'],
  next: ['nexttrack'],
  previous: ['previoustrack'],
  seek: ['seekto'],
  'seek-relative': ['seekforward', 'seekbackward'],
  rate: [],
}

export class MediaSessionTauri extends Service implements MediaSessionService {
  private readonly session?: MediaSessionLike
  private readonly bridge?: BridgeApi
  private readonly metadataFactory?: (init: Record<string, unknown>) => unknown

  private readonly listeners = new Set<(c: TransportCommand) => void>()
  /** Actions currently bound on the session, so `clear()` can unbind exactly those. */
  private bound = new Set<string>()
  private offBridge?: () => void

  /*
   * What we told the OS. Kept because neither surface can be read back, and
   * the contract is about what was published — a caller (and the conformance
   * suite) has to be able to ask.
   */
  private nowPlaying?: NowPlaying
  private playbackState: 'playing' | 'paused' | 'stopped' = 'stopped'
  private supported: TransportCommand['type'][] = ['play', 'pause', 'next', 'previous']
  /** The metadata currently published, so a position tick does not rebuild it. */
  private metadataKey?: string

  constructor(ctx: Context, config: MediaSessionElectronConfig = {}) {
    super(ctx, 'mediaSession')
    this.session = config.session ?? nativeSession()
    this.bridge = config.bridge ?? tryBridge()
    this.metadataFactory = config.metadataFactory ?? nativeMetadataFactory()
  }

  async [Service.init]() {
    // `main` raises MPRIS/SMTC presses; Chromium raises its own. Both land in
    // the same dispatch, so a listener cannot tell which surface was pressed —
    // which is the point.
    this.offBridge = this.bridge?.on((event) => {
      if (event.topic !== 'transport') return
      const command = commandFromBridge(event.command, event.positionMs)
      if (command) this.dispatch(command)
    })
    this.applySupportedCommands()

    return () => {
      this.offBridge?.()
      this.clear()
      this.listeners.clear()
    }
  }

  update(np: NowPlaying): void {
    this.nowPlaying = np

    /*
     * ⚠️ The metadata is rebuilt only when it actually changed.
     *
     * `plugin-player` republishes on its 1 Hz position tick, and a fresh
     * `MediaMetadata` per tick is not merely wasteful: Chromium tries to load
     * the artwork on every assignment, so a cached `file:` cover produced one
     * "MediaImage src can only be of http/https/data/blob scheme" warning every
     * second, forever. Position is separate from metadata in the browser API
     * precisely so a scrubber can move without republishing the track.
     */
    const key = metadataKey(np)
    const changed = key !== this.metadataKey
    this.metadataKey = key

    if (changed && this.session && this.metadataFactory) {
      this.session.metadata = this.metadataFactory({
        title: np.title,
        artist: np.artist ?? '',
        album: np.album ?? '',
        // Chromium wants a sized list; one entry is enough and the OS scales.
        // Only a scheme it accepts — a local file is dropped, never attempted.
        artwork: artworkFor(np),
      })
    }
    // Position is separate from metadata in the browser API, and it is what
    // makes a lock-screen scrubber move. Guarded because a bad duration —
    // NaN, or a position past the end — throws rather than being ignored.
    if (this.session?.setPositionState && isUsablePosition(np)) {
      this.session.setPositionState({
        duration: np.durationMs! / 1000,
        position: Math.min(np.positionMs ?? 0, np.durationMs!) / 1000,
        playbackRate: np.playbackRate ?? 1,
      })
    }

    if (!changed) return
    void this.bridge?.call('system', 'publishNowPlaying', [np]).catch(() => {
      // No MPRIS daemon, or an older host. The renderer surface still works,
      // and a missing OS integration must not fail a track change.
    })
  }

  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void {
    this.playbackState = state
    if (this.session) {
      this.session.playbackState = state === 'stopped' ? 'none' : state
    }
    void this.bridge?.call('system', 'publishPlaybackState', [state]).catch(() => {})
  }

  setSupportedCommands(types: TransportCommand['type'][]): void {
    this.supported = [...types]
    this.applySupportedCommands()
  }

  onCommand(cb: (cmd: TransportCommand) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  clear(): void {
    this.nowPlaying = undefined
    this.playbackState = 'stopped'
    this.metadataKey = undefined
    if (this.session) {
      this.session.metadata = null
      this.session.playbackState = 'none'
      // Unbinding matters as much as clearing metadata: a bound handler on a
      // cleared session is a lock-screen button that reaches a dead player.
      for (const action of this.bound) this.session.setActionHandler(action, null)
    }
    this.bound.clear()
    void this.bridge?.call('system', 'clearNowPlaying', []).catch(() => {})
  }

  /** What the OS surface currently shows. Used by the conformance suite. */
  published():
    | { nowPlaying?: NowPlaying; state?: string; commands?: string[] }
    | undefined {
    if (!this.nowPlaying) return undefined
    return {
      nowPlaying: this.nowPlaying,
      state: this.playbackState,
      commands: [...this.supported],
    }
  }

  /** Drive a command as the OS would. Exposed for tests and the debug console. */
  press(command: TransportCommand): void {
    this.dispatch(command)
  }

  private applySupportedCommands(): void {
    if (!this.session) return
    const wanted = new Set(this.supported.flatMap((type) => COMMAND_TO_ACTION[type] ?? []))

    for (const action of this.bound) {
      if (!wanted.has(action)) this.session.setActionHandler(action, null)
    }
    for (const action of wanted) {
      if (this.bound.has(action)) continue
      this.session.setActionHandler(action, (details?: unknown) => {
        const command = commandFromAction(action, details)
        if (command) this.dispatch(command)
      })
    }
    this.bound = wanted

    void this.bridge?.call('system', 'setSupportedCommands', [this.supported]).catch(() => {})
  }

  private dispatch(command: TransportCommand): void {
    // A copy, so a listener disposing itself mid-dispatch cannot skip another.
    for (const listener of [...this.listeners]) {
      try {
        listener(command)
      } catch (error) {
        this.ctx.logger.warn(`mediaSession: a command listener threw: ${String(error)}`)
      }
    }
  }
}

/** The schemes Chromium's `MediaMetadata` accepts, per its own error message. */
const BROWSER_ARTWORK = /^(https?:|data:|blob:)/i

/**
 * The artwork Chromium may load, if any.
 *
 * A `file:` or `content:` cover is dropped rather than passed: the browser
 * cannot render it in a media session and warns for every assignment. The
 * renderer's in-app views render the same local file through `<img>`, which
 * is not subject to this restriction.
 */
function artworkFor(np: NowPlaying): { src: string }[] {
  const src =
    np.artworkUrl ??
    (np.artworkUri && BROWSER_ARTWORK.test(np.artworkUri) ? np.artworkUri : undefined)
  return src ? [{ src }] : []
}

/** What `update` compares to decide whether the OS metadata must be rebuilt. */
function metadataKey(np: NowPlaying): string {
  return [np.title, np.artist ?? '', np.album ?? '', np.artworkUrl ?? '', np.artworkUri ?? ''].join(
    '\u0000',
  )
}

/** A duration a scrubber can actually use. */
function isUsablePosition(np: NowPlaying): boolean {
  return (
    typeof np.durationMs === 'number' && Number.isFinite(np.durationMs) && np.durationMs > 0
  )
}

function commandFromAction(action: string, details?: unknown): TransportCommand | undefined {
  const type = ACTION_TO_COMMAND[action]
  if (!type) return undefined
  if (type === 'seek') {
    const seekTime = (details as { seekTime?: number } | undefined)?.seekTime
    return typeof seekTime === 'number' ? { type: 'seek', positionMs: seekTime * 1000 } : undefined
  }
  if (type === 'seek-relative') {
    const offset = (details as { seekOffset?: number } | undefined)?.seekOffset ?? 10
    return { type: 'seek-relative', deltaMs: (action === 'seekbackward' ? -offset : offset) * 1000 }
  }
  return { type } as TransportCommand
}

function commandFromBridge(command: string, positionMs?: number): TransportCommand | undefined {
  switch (command) {
    case 'play':
    case 'pause':
    case 'stop':
    case 'next':
    case 'previous':
      return { type: command }
    case 'seek':
      return typeof positionMs === 'number' ? { type: 'seek', positionMs } : undefined
    default:
      return undefined
  }
}

function nativeSession(): MediaSessionLike | undefined {
  const nav = globalThis.navigator as { mediaSession?: MediaSessionLike } | undefined
  return nav?.mediaSession
}

function nativeMetadataFactory(): ((init: Record<string, unknown>) => unknown) | undefined {
  const Ctor = (globalThis as { MediaMetadata?: new (init: unknown) => unknown }).MediaMetadata
  return Ctor ? (init) => new Ctor(init) : undefined
}

/** The bridge is absent in tests and in a renderer whose preload failed. */
function tryBridge(): BridgeApi | undefined {
  try {
    return requireBridge()
  } catch {
    return undefined
  }
}

export const MediaSessionElectron = MediaSessionTauri
export const name = 'core-media-session-tauri'

export async function apply(ctx: Context, config: MediaSessionTauriConfig = {}) {
  ctx.logger.info('core-media-session-tauri: loaded')
  const fiber = await ctx.plugin(MediaSessionTauri, config)
  return () => void fiber.dispose()
}

export default { name, apply }
