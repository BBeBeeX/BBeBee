/**
 * `ctx.player` — transport, queue, resolution, history.
 *
 * Decides *what* plays. `ctx.dsp` decides how it sounds and `ctx.audio` owns
 * the graph; this plugin touches neither beyond `chainInput`.
 *
 * The load-bearing detail is that it does not know where bytes come from. A
 * track is resolved through the `player/before-resolve` waterfall, whose
 * terminal asks `ctx.sources`. In M1 nothing else hooks it — which is
 * deliberate: it is the control arm for M3's test that playback is identical
 * with and without `plugin-download` (docs/09 §6).
 *
 * See docs/05-audio-playback.md §2 and §5.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NetworkError, NotFoundError, ProviderError, SourceError } from '@BBeBee/protocol'
import type {
  AudioSourceHandle,
  Disposable,
  NowPlayingMeta,
  PlayHistoryHeatmapDay,
  PlayHistoryStats,
  PlayMode,
  PlayNowOptions,
  PlayRecord,
  PlayerService,
  QueueItem,
  RepeatMode,
  StreamHandle,
  StreamPrefs,
  StreamQuality,
  TransportState,
} from '@BBeBee/protocol'
import { QueueModel, type QueueEntry } from './queue.js'
import { PlayerStore } from './store.js'
import { PLAYER_COMMANDS } from './contributions.js'

export function derivePlayMode(shuffle: boolean, repeat: RepeatMode): PlayMode {
  if (shuffle) return 'shuffle'
  if (repeat === 'one') return 'single-loop'
  if (repeat === 'all') return 'list-loop'
  return 'sequence'
}

export const PLAY_MODES: readonly PlayMode[] = ['sequence', 'list-loop', 'single-loop', 'shuffle']

export type Transition = 'gapless' | 'crossfade' | 'neither'

export interface PlayerConfig {
  /** `previous()` restarts the current track past this point. */
  previousThresholdMs?: number
  /**
   * Gapless and crossfade are mutually exclusive: doing both produces an
   * audible double-fade, so the setting is a three-way choice (docs/05 §2).
   */
  transition?: Transition
  crossfadeMs?: number
  /** How often position is published, and the state machine re-examined. */
  tickMs?: number
  /** `playback_state` is written no more often than this while playing. */
  saveThrottleMs?: number
  /** Base delay for the network-error backoff. */
  retryBackoffMs?: number
  /**
   * How much of a local file may be decoded into memory.
   *
   * Buffered playback holds *decoded PCM*: a two-hour FLAC is ~2.5 GB at
   * 44.1 kHz stereo, which the phone kills the app for. Past this budget the
   * track streams instead, losing gapless for that one track rather than the
   * process.
   */
  bufferMaxBytes?: number
  /** Consecutive failed tracks before the player stops trying. */
  maxSkipStreak?: number
  /**
   * How long a buffer underrun may last before it becomes an error.
   *
   * `stalled --> error: timeout exceeded` in docs/05 §2. Without a bound the
   * state is absorbing: a stream whose server went away spins a spinner
   * forever, which is the one outcome worse than saying so.
   */
  stallTimeoutMs?: number
  /**
   * The quality preference handed to sources when they resolve a stream.
   *
   * A source reads it as `prefs.quality` and maps it onto the tiers its
   * backend actually has, degrading downwards — asking for `lossless` on a
   * backend without one plays the best stream that *can* be decoded, not
   * nothing. `lossless` is the default because it costs nothing where the
   * backend has no lossless tier, and it is what a music player means by
   * "best" everywhere it does.
   */
  quality?: StreamQuality
  /** Which device wrote `playback_state`, for future sync. */
  deviceId?: string
}

const DEFAULTS = {
  previousThresholdMs: 3000,
  transition: 'gapless' as Transition,
  crossfadeMs: 0,
  tickMs: 1000,
  saveThrottleMs: 5000,
  retryBackoffMs: 500,
  // ~150 MB of source bytes; comfortably a long album, not an audiobook.
  bufferMaxBytes: 150 * 1024 * 1024,
  maxSkipStreak: 10,
  // Long enough that a tunnel or a lift is survived, short enough that a dead
  // connection is reported while the user still remembers pressing play.
  stallTimeoutMs: 30_000,
  // "Best that plays": sources degrade the tier themselves when the backend
  // has no lossless stream (or the account lacks the entitlement for one).
  quality: 'lossless',
}

/** Prefetch starts here, per docs/05 §2. */
function prefetchWindowMs(transition: Transition, crossfadeMs: number): number {
  return Math.max(15_000, transition === 'crossfade' ? crossfadeMs + 5000 : 0)
}

interface ActivePlay {
  id: string
  trackUrn: string
  itemId: string
  startedAt: number
  msPlayed: number
  lastPositionMs: number
}

export class Player extends Service implements PlayerService {
  static inject = ['audio', 'sources', 'db']

  private readonly config: Required<PlayerConfig>
  private readonly model = new QueueModel()
  private store!: PlayerStore

  private transport: TransportState = {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    bufferedMs: 0,
    volume: 0.8,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
  }

  private source?: AudioSourceHandle
  private currentHandle?: StreamHandle
  private sourceEnded?: Disposable
  private sourceStalled?: Disposable
  /** Runs while `status === 'stalled'`; firing turns the stall into an error. */
  private stallTimer?: ReturnType<typeof setTimeout>
  private prefetched?: { itemId: string; handle: AudioSourceHandle; streamHandle?: StreamHandle }
  private prefetchAbort?: AbortController
  private prefetching = false
  private crossfading = false

  /**
   * The scoped context an optional service arrived on.
   *
   * Held rather than re-injected per call: `ctx.inject()` registers a fiber,
   * so calling it on every state change (as an "if available" helper) creates
   * one per publish and leaks every single one. The *context* is held rather
   * than the service object, so the service is still read through `ctx` at
   * call time and an isolated or replaced implementation is honoured.
   */
  private mediaCtx?: Context
  /** The scoped context `ctx.background` arrived on. See `mediaCtx`. */
  private bgCtx?: Context
  /** The scoped context `ctx.device` arrived on. See `mediaCtx`. */
  private deviceCtx?: Context
  /** The scoped context `ctx.codec` arrived on. See `mediaCtx`. */
  private codecCtx?: Context
  /** Held while playing, so the machine does not sleep mid-track (MD-6). */
  private wakeLock?: Disposable
  /** An acquire in flight. The status can change before it lands. */
  private wakeLockPending = false
  private ticker?: ReturnType<typeof setInterval>
  private activePlay?: ActivePlay
  private lastSaveAt = 0
  /** Set when *we* paused for an interruption, cleared by any user action. */
  private pausedByInterruption = false
  private attempts = 0
  /**
   * What the *user* last asked for.
   *
   * Resolving and decoding are async, so "press play, immediately pause" would
   * otherwise finish loading and start playing anyway: `attach` acted on the
   * autoplay flag captured when the load began, not on what was wanted by the
   * time it finished.
   */
  private playIntent = false
  /** Consecutive tracks that failed to start. Reset by any success. */
  private skipStreak = 0
  /** The outgoing source of a crossfade, kept alive until its fade finishes. */
  private fading?: { handle: AudioSourceHandle; timer: ReturnType<typeof setTimeout> }
  /**
   * The catalogue's duration for the track being started, as a floor.
   */
  private fallbackDurationMs = 0
  private disposed = false
  /** Monotonically increasing start token to cancel superseded in-flight loads. */
  private startToken = 0

  /**
   * The plugin's own context, captured at construction.
   *
   * ⚠️ Inside a Service method reached through the service proxy (`ctx.player`),
   * Cordis shadows `this.ctx` to be the *caller's* context. If `this.ctx` were
   * used at call time for audio or db calls, capability checks (such as
   * `assertGranted(..., "audio")`) would run against the caller's budget (e.g.
   * UI packages which are granted no capabilities) and throw. Internal player
   * operations must run under `this.ownCtx`. See docs/03 §7 and plugin-sources.
   */
  private readonly ownCtx: Context

  constructor(ctx: Context, config: PlayerConfig = {}) {
    super(ctx, 'player')
    this.ownCtx = ctx
    this.config = {
      ...DEFAULTS,
      deviceId: config.deviceId ?? 'this-device',
      ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    } as Required<PlayerConfig>
  }

  async [Service.init]() {
    this.store = new PlayerStore(this.ownCtx.db, this.config.deviceId)
    await this.restore()
    this.ownCtx.logger.info(
      'player: initialized (currentItem: %s, status: %s, queueSize: %d)',
      this.transport.currentItemId ?? 'none',
      this.transport.status,
      this.model.items.length,
    )

    this.ticker = setInterval(() => void this.refresh(), this.config.tickMs)

    // The whole interruption policy, in one place, over ctx.audio's events —
    // every platform's rules differ, the policy does not (docs/05 §5).
    const offInterruption = this.ownCtx.audio.onInterruption((event) => {
      if (event.type === 'began') {
        // Logged only when it actually does something: a suspension while
        // idle (desktop powers down, nothing playing) is not a pause, and a
        // line saying "pausing" that paused nothing reads as a lost cause.
        if (isPlayingLike(this.transport.status)) {
        this.ownCtx.logger.info('player: audio interruption began, pausing')
          this.pause()
          this.pausedByInterruption = true
        }
        return
      }
      // Resume only if we paused for this, and only if the user has not
      // intervened since.
      if (event.shouldResume && this.pausedByInterruption) {
        this.ownCtx.logger.info('player: audio interruption ended, resuming')
        this.pausedByInterruption = false
        void this.play()
      }
    })

    const offRoute = this.ownCtx.audio.onRouteChange((event) => {
      // Headphones out, Bluetooth gone: pause immediately, and never resume
      // on our own. This one is not configurable — it is the audio behaviour
      // users never forgive.
      if (event.reason === 'device-removed') {
        this.ownCtx.logger.info('player: audio route changed (device-removed), pausing')
        this.pause()
        this.pausedByInterruption = false
      }
    })

    const offEngine = this.ownCtx.on('audio/engine-changed', async () => {
      this.ownCtx.logger.info('player: audio engine changed, migrating playback')
      const wasPlaying = isPlayingLike(this.transport.status)
      const currentPos = this.transport.positionMs
      this.detachSource()
      if (wasPlaying && this.transport.currentItemId) {
        this.set({ status: 'loading' })
        const current = this.model.entry(this.transport.currentItemId)
        if (current) {
          await this.start(current, { positionMs: currentPos, autoplay: true }).catch((err) => {
            this.ownCtx.logger.error('player: failed to resume track on new audio engine: %s', String(err))
          })
        }
      }
    })

    // Optional platform services. The player works without them, which is what
    // makes it testable and what keeps a missing OS surface from being fatal.
    this.ownCtx.inject(['mediaSession'], (scoped) => {
      this.mediaCtx = scoped
      scoped.mediaSession.setSupportedCommands(['play', 'pause', 'next', 'previous', 'seek'])
      this.publishNowPlaying()
      const off = scoped.mediaSession.onCommand((command) => {
        // Info, not debug: a pause that arrives here comes from the OS —
        // media keys, a lock-screen button, another app taking the media
        // session — and in a shipped build the file transport runs at info.
        // At debug the most common "why did it stop" record never existed.
        this.ownCtx.logger.info('player: mediaSession command: %s', command.type)
        switch (command.type) {
          case 'play':
            void this.play()
            break
          case 'pause':
            this.pause()
            break
          case 'stop':
            this.stop()
            break
          case 'next':
            void this.next()
            break
          case 'previous':
            void this.previous()
            break
          case 'seek':
            void this.seek(command.positionMs)
            break
          case 'seek-relative':
            void this.seek(this.transport.positionMs + command.deltaMs)
            break
          default:
            break
        }
      })
      return () => {
        /*
         * Take the OS surface down with us.
         *
         * The lock screen outlives the plugin unless something says
         * otherwise, so a disabled `plugin-player` used to leave a track
         * showing with buttons that no longer did anything — the ghost
         * §4.9 says disabling must not leave. `clear()` only ran from
         * `stop()`, which a disable does not go through.
         *
         * Optional: on a full shutdown the session may already be gone, and
         * a teardown that throws would strand the disposers after it.
         */
        scoped.mediaSession?.clear()
        this.mediaCtx = undefined
        off()
      }
    })

    // Commands only now: the surfaces that were once contributed here — the
    // now-playing page and bar, the queue — moved to `plugin-now-playing` and
    // `plugin-queue`, and their view ids moved with them. The transport's own
    // verbs need no view: the palette and the more-menu are enough (docs/08 §3).
    // Arrow functions, so `this` is captured lexically: a generator passed to
    // `ctx.effect` is called without a receiver, and aliasing `this` into a
    // local would work but says less about why.
    const togglePlay = () => this.togglePlay()
    const next = () => void this.next()
    const previous = () => void this.previous()

    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        // Commands work with no view at all: they reach the command palette on
        // desktop and the more-menu on mobile, which is the cheapest way to
        // make a feature reachable on both targets (docs/08 §3).
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.togglePlay,
          title: 'Play / pause',
          defaultKeybinding: 'Space',
          run: togglePlay,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.next,
          title: 'Next track',
          run: next,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: PLAYER_COMMANDS.previous,
          title: 'Previous track',
          run: previous,
        })
      }, 'player-ui-contributions'),
    )

    this.ownCtx.inject(['background'], (scoped) => {
      this.bgCtx = scoped
      // Checkpoint before the host suspends: on mobile there may be no later.
      const off = scoped.background.onWillSuspend(() => this.persist(true))
      // A status may already be playing — the service can arrive after the
      // first track does.
      this.syncWakeLock()
      return () => {
        this.bgCtx = undefined
        this.dropWakeLock()
        off()
      }
    })

    this.ownCtx.inject(['device'], (scoped) => {
      this.deviceCtx = scoped
      return () => {
        this.deviceCtx = undefined
      }
    })

    this.ownCtx.inject(['codec'], (scoped) => {
      this.codecCtx = scoped
      return () => {
        this.codecCtx = undefined
      }
    })

    const logger = this.ownCtx.logger
    return async () => {
      try {
        logger?.info('player: disposing')
      } catch {
        // teardown logging best-effort
      }
      this.disposed = true
      if (this.ticker) clearInterval(this.ticker)
      offInterruption()
      offRoute()
      offEngine()
      this.cancelPrefetch()
      this.clearFading()
      await this.finishPlay({ completed: false, skipped: false })
      this.detachSource()
      this.dropWakeLock()
      await this.persist(true).catch(() => undefined)
    }
  }

  /* ── state ─────────────────────────────────────────────────────────── */

  get state(): Readonly<TransportState> {
    return this.transport
  }

  get currentStream(): Readonly<StreamHandle> | undefined {
    return this.currentHandle
  }

  get queue(): readonly QueueItem[] {
    return this.model.items
  }

  private set(patch: Partial<TransportState>): void {
    const wasPlaying = isPlayingLike(this.transport.status)
    this.transport = { ...this.transport, ...patch }
    if (isPlayingLike(this.transport.status) !== wasPlaying) this.syncWakeLock()
    this.ownCtx.emit('player/state-changed', this.transport)
  }

  /* ── the wake lock ─────────────────────────────────────────────────── */

  /**
   * Hold the machine awake exactly while audio is meant to be coming out.
   *
   * MD-6's other half. Close-to-tray keeps the renderer — and the audio graph
   * — alive when the window goes, but a process that survives a hidden window
   * still stops when the machine sleeps, so "playback survives window-hide"
   * needs both. `ctx.background` is optional, so a build without it plays
   * exactly as before and simply does not hold the lock.
   *
   * ⚠️ `stalled` counts as playing here too. A lock dropped and re-taken on
   * every buffer underrun is a lock the OS sees flapping, and the track is
   * still playing as far as the user and the lock screen are concerned.
   */
  private syncWakeLock(): void {
    if (isPlayingLike(this.transport.status)) void this.takeWakeLock()
    else this.dropWakeLock()
  }

  private async takeWakeLock(): Promise<void> {
    const background = this.bgCtx?.background
    if (!background || this.wakeLock || this.wakeLockPending) return
    this.wakeLockPending = true
    try {
      const lock = await background.acquireWakeLock('playback')
      /*
       * Playback may have stopped while this was in flight — a track that
       * failed to load, or a user who pressed pause immediately. Releasing it
       * on arrival is what stops a paused player from holding the machine
       * awake for ever, which is the failure nobody notices until a laptop
       * runs its battery down in a bag.
       */
      if (this.disposed || !isPlayingLike(this.transport.status)) lock()
      else this.wakeLock = lock
    } catch {
      // A host that refuses a blocker is not a reason to stop playing; the
      // service already reports that case rather than throwing on its own.
    } finally {
      this.wakeLockPending = false
    }
  }

  private dropWakeLock(): void {
    this.wakeLock?.()
    this.wakeLock = undefined
  }

  private emitQueueChanged(): void {
    this.ownCtx.emit('queue/changed', this.model.items)
  }

  /* ── transport ─────────────────────────────────────────────────────── */

  async play(): Promise<void> {
    this.ownCtx.logger.info(
      'player: play requested (status: %s, currentItemId: %s)',
      this.transport.status,
      this.transport.currentItemId ?? 'none',
    )
    this.pausedByInterruption = false
    this.playIntent = true
    if (this.transport.status === 'playing' || this.transport.status === 'loading') return

    const current = this.transport.currentItemId
      ? this.model.entry(this.transport.currentItemId)
      : this.model.first()
    if (!current) return

    if (this.source && this.transport.currentItemId === current.item.id) {
      this.ownCtx.audio.setVolume(this.transport.volume)
      this.ownCtx.audio.setMuted(this.transport.muted)
      this.source.play()
      this.set({ status: 'playing' })
      this.publishNowPlaying()
      return
    }
    await this.start(current, { positionMs: this.transport.positionMs, autoplay: true })
  }

  pause(): void {
    this.ownCtx.logger.info(
      'player: pause requested (status: %s, currentItemId: %s, positionMs: %d)',
      this.transport.status,
      this.transport.currentItemId ?? 'none',
      this.transport.positionMs,
    )
    this.pausedByInterruption = false
    // Recorded before the early return: a pause during `loading` must still be
    // honoured when the in-flight load lands.
    this.playIntent = false
    // `stalled` counts as playing here: the user pressed pause on a spinner,
    // and refusing them because no audio happens to be coming out would leave
    // the transport claiming to play a track that is going nowhere.
    if (!this.source || !isPlayingLike(this.transport.status)) {
      if (this.transport.status === 'loading') this.set({ status: 'paused' })
      return
    }
    this.clearStall()
    this.source.pause()
    this.set({ status: 'paused', positionMs: this.source.positionMs })
    this.publishNowPlaying()
    void this.persist(true)
  }

  togglePlay(): void {
    this.ownCtx.logger.info('player: togglePlay requested (current status: %s)', this.transport.status)
    if (isPlayingLike(this.transport.status)) this.pause()
    else void this.play()
  }

  stop(): void {
    this.ownCtx.logger.info('player: stop requested')
    ++this.startToken
    this.pausedByInterruption = false
    this.playIntent = false
    void this.finishPlay({ completed: false, skipped: false })
    this.cancelPrefetch()
    this.detachSource()
    // `currentItemId` is cleared too, so a load still in flight recognises
    // that it is no longer wanted rather than matching its own guard.
    this.set({
      status: 'idle',
      currentItemId: undefined,
      trackUrn: undefined,
      positionMs: 0,
      durationMs: 0,
      nowPlaying: undefined,
    })
    this.mediaCtx?.mediaSession.clear()
    void this.persist(true)
  }

  async seek(positionMs: number): Promise<void> {
    const target = Math.max(0, positionMs)
    this.ownCtx.logger.info('player: seek requested to %dms', target)
    if (!this.source) {
      this.set({ positionMs: target })
      return
    }
    if (typeof this.source.seek === 'function') {
      this.source.seek(target)
    } else {
      const wasPlaying = isPlayingLike(this.transport.status)
      if (wasPlaying) this.source.play(target)
      else {
        this.source.pause()
        this.source.play(target)
        this.source.pause()
      }
    }
    this.set({ positionMs: target })
    this.ownCtx.emit('player/position', target, this.transport.durationMs)
    if (this.activePlay) this.activePlay.lastPositionMs = target
    this.publishNowPlaying()
  }

  async next(): Promise<void> {
    this.ownCtx.logger.info(
      'player: next requested (current: %s, repeat: %s)',
      this.transport.trackUrn ?? 'none',
      this.transport.repeat,
    )
    const entry = this.model.next(this.transport.currentItemId, this.transport.repeat)
    await this.finishPlay({ completed: false, skipped: true })
    if (!entry) {
      this.stop()
      return
    }
    await this.start(entry, { autoplay: this.transport.status !== 'paused' })
  }

  async previous(): Promise<void> {
    this.ownCtx.logger.info(
      'player: previous requested (current: %s, positionMs: %d)',
      this.transport.trackUrn ?? 'none',
      this.transport.positionMs,
    )
    // Past the threshold, "previous" means "start this one again" — which is
    // what every other player does, and what users reach for.
    if (this.source && this.transport.positionMs > this.config.previousThresholdMs) {
      await this.seek(0)
      return
    }
    const entry = this.model.previous(this.transport.currentItemId, this.transport.repeat)
    if (!entry) {
      await this.seek(0)
      return
    }
    await this.finishPlay({ completed: false, skipped: true })
    await this.start(entry, { autoplay: this.transport.status !== 'paused' })
  }

  setVolume(v: number): void {
    const volume = Math.max(0, Math.min(1, v))
    this.ownCtx.logger.debug('player: setVolume to %d', volume)
    this.ownCtx.audio.setVolume(volume)
    this.set({ volume })
    void this.persist()
  }

  setMuted(m: boolean): void {
    this.ownCtx.logger.debug('player: setMuted to %s', m)
    this.ownCtx.audio.setMuted(m)
    this.set({ muted: m })
    void this.persist()
  }

  setRepeat(mode: RepeatMode): void {
    this.ownCtx.logger.info('player: setRepeat to %s', mode)
    const playMode = derivePlayMode(this.transport.shuffle, mode)
    this.set({ repeat: mode, playMode })
    void this.persist(true)
  }

  setShuffle(on: boolean): void {
    this.ownCtx.logger.info('player: setShuffle to %s', on)
    this.model.setShuffle(on)
    const playMode = derivePlayMode(on, this.transport.repeat)
    this.set({ shuffle: on, playMode })
    this.emitQueueChanged()
    void this.persist(true)
  }

  setPlayMode(mode: PlayMode): void {
    this.ownCtx.logger.info('player: setPlayMode to %s', mode)
    switch (mode) {
      case 'shuffle':
        this.model.setShuffle(true)
        this.set({ shuffle: true, repeat: 'all', playMode: 'shuffle' })
        this.emitQueueChanged()
        break
      case 'sequence':
        this.model.setShuffle(false)
        this.set({ shuffle: false, repeat: 'off', playMode: 'sequence' })
        this.emitQueueChanged()
        break
      case 'single-loop':
        this.model.setShuffle(false)
        this.set({ shuffle: false, repeat: 'one', playMode: 'single-loop' })
        this.emitQueueChanged()
        break
      case 'list-loop':
        this.model.setShuffle(false)
        this.set({ shuffle: false, repeat: 'all', playMode: 'list-loop' })
        this.emitQueueChanged()
        break
    }
    void this.persist(true)
  }

  cyclePlayMode(): PlayMode {
    const current = this.transport.playMode ?? derivePlayMode(this.transport.shuffle, this.transport.repeat)
    const idx = PLAY_MODES.indexOf(current)
    const next = PLAY_MODES[(idx + 1) % PLAY_MODES.length]!
    this.setPlayMode(next)
    return next
  }

  /* ── queue ─────────────────────────────────────────────────────────── */

  async playNow(urns: string[], opts: PlayNowOptions = {}): Promise<void> {
    this.ownCtx.logger.info('player: playNow with %d track(s), first: %s', urns.length, urns[0] ?? 'none')
    const accepted = this.beforeEnqueue(urns)
    if (accepted.length === 0) return

    const targetUrn = opts.startIndex !== undefined ? accepted[opts.startIndex] : undefined
    const seen = new Set<string>()
    const deduplicated: string[] = []
    for (const u of accepted) {
      if (!seen.has(u)) {
        seen.add(u)
        deduplicated.push(u)
      }
    }
    let startIndex = opts.startIndex ?? 0
    if (targetUrn) {
      const found = deduplicated.indexOf(targetUrn)
      if (found >= 0) startIndex = found
    }

    const items = deduplicated.map((urn) => this.newItem(urn, 'user', opts.context))
    const token = ++this.startToken
    this.cancelPrefetch()
    this.detachSource()
    this.model.replace(items)
    await this.store.replaceQueue(this.model.all)
    if (this.disposed || this.startToken !== token) return
    this.emitQueueChanged()

    this.playIntent = true
    const startAt = Math.max(0, Math.min(items.length - 1, startIndex))
    const targetItem =
      opts.startIndex !== undefined || targetUrn !== undefined ? items[startAt] : undefined

    if (targetItem && this.transport.shuffle) {
      this.model.rotateShuffle(targetItem.id)
    }

    const entry = targetItem ? this.model.entry(targetItem.id) : this.model.first()
    if (entry) await this.start(entry, { autoplay: true })
  }

  async playFromContext(
    urn: string,
    contextUrns: readonly string[] = [],
    opts: PlayNowOptions = {},
  ): Promise<void> {
    // When context is provided and contains the tapped track (e.g. tapping in an album,
    // a playlist, or search results), replace the queue with the context and play the track.
    const at = contextUrns.indexOf(urn)
    if (contextUrns.length > 0 && at >= 0) {
      await this.playNow([...contextUrns], { ...opts, ...(opts.startIndex === undefined ? { startIndex: at } : {}) })
      return
    }

    // When the track is already in the queue and no context list was provided
    // (e.g. tapping inside the Queue view), jump to that item in the queue.
    const queued = this.entryForUrn(urn)
    if (queued) {
      this.ownCtx.logger.info('player: playFromContext jumps to queued %s (itemId: %s)', urn, queued.item.id)
      this.pausedByInterruption = false
      this.playIntent = true
      await this.start(queued, { autoplay: true })
      return
    }

    await this.playNow([urn], opts)
  }

  /** The first queue entry for a track, in play order — not row order. */
  private entryForUrn(urn: string): QueueEntry | undefined {
    for (const id of this.model.order()) {
      const entry = this.model.entry(id)
      if (entry?.item.trackUrn === urn) return entry
    }
    return undefined
  }

  enqueueNext(urns: string[]): void {
    const existingUrns = new Set(this.model.items.map((item) => item.trackUrn))
    const seen = new Set<string>()
    const deduplicated: string[] = []
    for (const u of this.beforeEnqueue(urns)) {
      if (!existingUrns.has(u) && !seen.has(u)) {
        seen.add(u)
        deduplicated.push(u)
      }
    }
    const items = deduplicated.map((urn) => this.newItem(urn, 'user'))
    if (items.length === 0) return
    this.ownCtx.logger.info('player: enqueueNext with %d track(s)', items.length)
    const added = this.model.insertAfter(this.transport.currentItemId, items)
    void this.store.insertQueue(added)
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  enqueueLast(urns: string[]): void {
    const existingUrns = new Set(this.model.items.map((item) => item.trackUrn))
    const seen = new Set<string>()
    const deduplicated: string[] = []
    for (const u of this.beforeEnqueue(urns)) {
      if (!existingUrns.has(u) && !seen.has(u)) {
        seen.add(u)
        deduplicated.push(u)
      }
    }
    const items = deduplicated.map((urn) => this.newItem(urn, 'user'))
    if (items.length === 0) return
    this.ownCtx.logger.info('player: enqueueLast with %d track(s)', items.length)
    const added = this.model.append(items)
    void this.store.insertQueue(added)
    this.emitQueueChanged()
  }

  removeItems(ids: string[]): void {
    this.ownCtx.logger.info('player: removeItems with %d item(s)', ids.length)
    const removed = this.model.remove(ids)
    if (removed.length === 0) return
    void this.store.removeQueue(removed)
    if (this.transport.currentItemId && removed.includes(this.transport.currentItemId)) {
      // The playing item was removed: stop rather than silently jumping.
      this.stop()
    }
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  moveItem(id: string, toIndex: number): void {
    this.ownCtx.logger.info('player: moveItem %s to index %d', id, toIndex)
    const moved = this.model.move(id, toIndex)
    if (!moved) return
    // One row, because the position is a fractional index (docs/07 §4.6).
    void this.store.moveQueueItem(moved)
    this.cancelPrefetch()
    this.emitQueueChanged()
  }

  clearQueue(): void {
    this.ownCtx.logger.info('player: clearQueue')
    this.model.clear()
    void this.store.replaceQueue([])
    this.cancelPrefetch()
    this.detachSource()
    this.set({ status: 'idle', currentItemId: undefined, trackUrn: undefined, positionMs: 0, durationMs: 0, nowPlaying: undefined })
    this.emitQueueChanged()
  }

  /* ── history ───────────────────────────────────────────────────────── */

  async getHistory(opts?: { limit?: number; offset?: number; date?: string }): Promise<PlayRecord[]> {
    return this.store.listHistory(opts)
  }

  async getHistoryStats(): Promise<PlayHistoryStats> {
    return this.store.getHistoryStats()
  }

  async getHistoryHeatmap(days?: number): Promise<PlayHistoryHeatmapDay[]> {
    return this.store.getHistoryHeatmap(days)
  }

  async clearHistory(): Promise<void> {
    this.ownCtx.logger.info('player: clearHistory')
    await this.store.clearHistory()
    this.ownCtx.emit('player/history-changed')
  }

  async removeHistory(idOrUrn: string): Promise<void> {
    this.ownCtx.logger.info('player: removeHistory %s', idOrUrn)
    await this.store.removeHistory(idOrUrn)
    this.ownCtx.emit('player/history-changed')
  }

  /** The upcoming order, which under shuffle is the permutation, not the rows. */
  upcoming(): QueueItem[] {
    const order = this.model.order()
    const at = this.transport.currentItemId ? order.indexOf(this.transport.currentItemId) : -1
    return order
      .slice(at + 1)
      .map((id) => this.model.entry(id)?.item)
      .filter((item): item is QueueItem => item !== undefined)
  }

  private beforeEnqueue(urns: string[]): string[] {
    // A waterfall so a plugin can filter or expand what is about to be queued
    // (a radio plugin, a "skip explicit" policy) without the player knowing.
    //
    // Listeners rewrite by mutating the array in place — `next(other)` is
    // silently ignored by Cordis, so the signature takes no arguments and the
    // kernel pins that behaviour (docs/07 §5).
    const accepted = [...urns]
    this.ownCtx.waterfall('player/before-enqueue', accepted, () => {})
    return accepted
  }

  private newItem(
    trackUrn: string,
    addedBy: QueueItem['addedBy'],
    context?: QueueItem['sourceContext'],
  ): QueueItem {
    return {
      id: `q_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      trackUrn,
      addedBy,
      addedAt: Date.now(),
      ...(context ? { sourceContext: context } : {}),
    }
  }

  /* ── loading and resolution ────────────────────────────────────────── */

  private async start(
    entry: QueueEntry,
    opts: { positionMs?: number; autoplay: boolean },
  ): Promise<void> {
    const token = ++this.startToken
    this.ownCtx.logger.info(
      'player: starting track %s (itemId: %s, autoplay: %s, positionMs: %d, token: %d)',
      entry.item.trackUrn,
      entry.item.id,
      opts.autoplay,
      opts.positionMs ?? 0,
      token,
    )
    const previousUrn = this.transport.trackUrn
    await this.finishPlay({ completed: false, skipped: true })
    if (this.disposed || this.startToken !== token) return
    this.detachSource()

    this.set({
      status: 'loading',
      currentItemId: entry.item.id,
      trackUrn: entry.item.trackUrn,
      nowPlaying: undefined,
      positionMs: opts.positionMs ?? 0,
      durationMs: 0,
      bufferedMs: 0,
      error: undefined,
    })
    this.ownCtx.emit('player/track-changed', entry.item.trackUrn, previousUrn)
    this.publishNowPlaying()

    // A prefetched buffer for exactly this item is the gapless path: no
    // resolve, no decode, no I/O between the two tracks.
    const ready = this.takePrefetched(entry.item.id)
    if (ready) {
      if (this.disposed || this.startToken !== token) {
        ready.handle.dispose()
        return
      }
      this.ownCtx.logger.info('player: using prefetched source for %s', entry.item.trackUrn)
      this.attach(ready.handle, entry, opts, ready.streamHandle)
      return
    }

    // A buffer for some *other* item is stale from here on — it would sit in
    // memory and block prefetching until the next queue mutation, which a
    // jump to an out-of-order item never performs.
    this.cancelPrefetch()

    try {
      // Started before the resolve, not after the load: the catalogue read is
      // a database lookup and the resolve is a network round trip, so awaiting
      // it beside the load costs nothing.
      const knownDuration = this.knownDurationMs(entry.item.trackUrn)
      const handle = await this.resolveStream(entry.item.trackUrn)
      if (this.disposed || this.startToken !== token || this.transport.currentItemId !== entry.item.id) return
      const source = await this.load(handle)
      const known = await knownDuration
      // Checked again after the second await: a start that begins while this
      // one is in flight has already claimed `currentItemId`, and attaching
      // here would play the wrong source.
      if (this.disposed || this.startToken !== token || this.transport.currentItemId !== entry.item.id) {
        source.dispose()
        return
      }
      this.attempts = 0
      // Only for a stream the provider says can be seeked: a live stream's
      // catalogue duration (when it has one at all) is not a position the
      // scrubber could ever reach, and offering one would be a lie.
      this.fallbackDurationMs = handle.seekable ? known : 0
      this.attach(source, entry, opts, handle)
    } catch (error) {
      if (this.disposed || this.startToken !== token) return
      await this.handleError(error, entry, token)
    }
  }

  private attach(
    source: AudioSourceHandle,
    entry: QueueEntry,
    opts: { positionMs?: number; autoplay: boolean },
    handle?: StreamHandle,
  ): void {
    if (this.source && this.source !== source) {
      this.detachSource()
    }
    this.currentHandle = handle
    this.ownCtx.logger.info(
      'player: attached source for %s (durationMs: %d, willPlay: %s)',
      entry.item.trackUrn,
      source.durationMs,
      opts.autoplay && this.playIntent,
    )
    this.source = source
    source.node.connect(this.ownCtx.audio.chainInput)
    this.sourceEnded = source.onEnded(() => void this.onEnded())
    this.sourceStalled = source.onStalled((stalled) => this.onStalled(stalled))

    // A track that started is a track that worked.
    this.skipStreak = 0

    const positionMs = opts.positionMs ?? 0
    // The element's own duration when it has one; the catalogue's otherwise —
    // a streamed source reports 0 until (or unless) it learns the real value,
    // and a zero duration is a progress bar that cannot move.
    const durationMs = source.durationMs || this.fallbackDurationMs
    if (opts.autoplay && this.playIntent) {
      this.ownCtx.audio.setVolume(this.transport.volume)
      this.ownCtx.audio.setMuted(this.transport.muted)
      source.play(positionMs)
      this.set({ status: 'playing', durationMs, positionMs })
      this.beginPlay(entry, positionMs)
    } else {
      // Either this was a deliberate load-without-play, or the user paused or
      // stopped while the load was in flight. Their intent wins.
      this.set({ status: 'paused', durationMs, positionMs })
    }
    this.publishNowPlaying()
    void this.persist(true)
  }

  /**
   * The duration the catalogue already holds for a track, or 0.
   *
   * Search rules usually know how long a track is long before the media
   * element does, and some streams never tell the element at all. A failure
   * here is not worth failing a track over: the transport simply reports no
   * duration, exactly as it did before.
   */
  private async knownDurationMs(urn: string): Promise<number> {
    try {
      const [track] = await this.ownCtx.sources.getTracks([urn])
      return track?.durationMs ?? 0
    } catch (error) {
      this.ownCtx.logger.warn(`player: could not read duration for ${urn}: ${String(error)}`)
      return 0
    }
  }

  private async load(handle: StreamHandle): Promise<AudioSourceHandle> {
    if (
      handle.headers &&
      typeof window !== 'undefined' &&
      typeof (window as unknown as { BBeBee?: { stream?: { setHeaders: (entry: { url: string; headers: Record<string, string> }) => Promise<void> } } }).BBeBee?.stream?.setHeaders === 'function'
    ) {
      void (window as unknown as { BBeBee: { stream: { setHeaders: (entry: { url: string; headers: Record<string, string> }) => Promise<void> } } }).BBeBee.stream.setHeaders({
        url: handle.target,
        headers: handle.headers,
      })
    }
    return this.ownCtx.audio.load(handle.target, {
      strategy: this.strategyFor(handle),
      ...(handle.headers ? { headers: handle.headers } : {}),
      onBuffered: (seconds) => this.set({ bufferedMs: Math.round(seconds * 1000) }),
    })
  }

  /**
   * Buffered or streamed.
   *
   * Local files decode fully — that is what makes a gapless handoff possible —
   * but only within a budget: decoded PCM is roughly ten times the file, so an
   * unbounded rule turns a long audiobook into a 2.5 GB allocation and an
   * out-of-memory kill on a phone. Past the budget the track streams and loses
   * gapless, which is the right thing to lose.
   */
  private strategyFor(handle: StreamHandle): 'buffer' | 'stream' {
    if (handle.kind !== 'local') return 'stream'
    const bytes = handle.byteLength
    if (bytes !== undefined && bytes > this.config.bufferMaxBytes) return 'stream'
    return 'buffer'
  }

  /**
   * URN → bytes, through the waterfall.
   *
   * The terminal is the only part that knows about providers. Everything else
   * — a downloaded file, a linked URN on another provider — arrives as a
   * listener that never has to touch this method.
   */
  private async resolveStream(urn: string): Promise<StreamHandle> {
    const prefs = await this.streamPrefs()
    const terminal = async (): Promise<StreamHandle> => {
      const provider = this.ownCtx.sources.forUrn(urn)
      if (!provider) throw new NotFoundError(`no provider for ${urn}`)
      const { id } = parseUrnId(urn)
      return provider.resolveStream(id, prefs)
    }
    return this.ownCtx.waterfall('player/before-resolve', urn, prefs, terminal)
  }

  private async streamPrefs(): Promise<StreamPrefs> {
    let saveData = false
    let acceptFormats: string[] = []

    // Both are optional in M1; their absence degrades the request, never the
    // playback.
    const device = this.deviceCtx?.device
    if (device) {
      try {
        saveData = (await device.network()).metered
      } catch {
        saveData = false
      }
    }
    const codec = this.codecCtx?.codec
    if (codec) {
      try {
        acceptFormats = codec.supportedFormats()
      } catch {
        acceptFormats = []
      }
    }
    return { quality: this.config.quality, saveData, acceptFormats }
  }

  /* ── the clock ─────────────────────────────────────────────────────── */

  /**
   * Recompute position and everything driven by it.
   *
   * The ticker calls this at 1 Hz — `player/position` at 60 Hz would dominate
   * the event bus for no benefit, and the UI interpolates between ticks
   * (docs/07 §5). Public because a shell wants it on regaining focus, and
   * because tests drive it directly rather than waiting on wall-clock time.
   */
  async refresh(): Promise<void> {
    if (this.disposed || !this.source) return
    const positionMs = this.source.positionMs
    const durationMs = this.source.durationMs || this.transport.durationMs

    if (this.transport.status === 'playing') {
      if (this.activePlay) {
        this.activePlay.msPlayed += Math.max(0, positionMs - this.activePlay.lastPositionMs)
        this.activePlay.lastPositionMs = positionMs
      }
      this.set({ positionMs, durationMs })
      this.ownCtx.emit('player/position', positionMs, durationMs)
      this.publishPosition(positionMs)
      await this.maybePrefetch(positionMs, durationMs)
      await this.maybeCrossfade(positionMs, durationMs)
      await this.persist()
    }
  }

  /* ── stalls ────────────────────────────────────────────────────────── */

  /**
   * A buffer underrun, and its recovery.
   *
   * `stalled` is deliberately not `paused`: the user did not ask for this, so
   * the UI shows a spinner rather than a play button and `ctx.mediaSession`
   * goes on reporting *playing*, which is what stops the lock screen
   * flickering every time a train goes into a tunnel (docs/05 §2).
   *
   * Only a track that was actually playing can stall. A `waiting` that arrives
   * while the user has it paused — a media element still filling its buffer,
   * say — is not a stall in any sense the transport cares about.
   */
  private onStalled(stalled: boolean): void {
    this.ownCtx.logger.warn('player: playback %s', stalled ? 'stalled' : 'recovered from stall')
    if (stalled) {
      if (this.transport.status !== 'playing') return
      this.set({ status: 'stalled' })
      this.publishNowPlaying()
      this.stallTimer = setTimeout(() => {
        this.stallTimer = undefined
        if (this.transport.status !== 'stalled') return
        // Retryable: the queue is intact and pressing play is all it takes,
        // which is the same shape as the out-of-attempts network failure.
        this.fail(new NetworkError('playback stalled and did not recover'), true)
      }, this.config.stallTimeoutMs)
      return
    }

    this.clearStall()
    if (this.transport.status !== 'stalled') return
    this.set({ status: 'playing' })
    this.publishNowPlaying()
  }

  private clearStall(): void {
    if (this.stallTimer === undefined) return
    clearTimeout(this.stallTimer)
    this.stallTimer = undefined
  }

  private async maybePrefetch(positionMs: number, durationMs: number): Promise<void> {
    if (this.config.transition === 'neither' || this.prefetching || this.prefetched) return
    if (!durationMs) return
    const window = prefetchWindowMs(this.config.transition, this.config.crossfadeMs)
    if (durationMs - positionMs > window) return

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next || next.item.id === this.transport.currentItemId) return

    this.prefetching = true
    const abort = new AbortController()
    this.prefetchAbort = abort
    try {
      const handle = await this.resolveStream(next.item.trackUrn)
      if (abort.signal.aborted) return

      // Preload next track if the audio engine supports gapless preload (e.g. mpv append)
      if (typeof this.ownCtx.audio.preloadNext === 'function') {
        void this.ownCtx.audio.preloadNext(handle.target, handle.headers ? { headers: handle.headers } : undefined)
      }

      // Buffered, because a handoff with no gap cannot wait on a network read.
      // A track too large to buffer is simply not prefetched: it will stream
      // when its turn comes, and gapless was never available for it anyway.
      if (this.strategyFor(handle) !== 'buffer') return
      const source = await this.ownCtx.audio.load(handle.target, {
        strategy: 'buffer',
        ...(handle.headers ? { headers: handle.headers } : {}),
        signal: abort.signal,
      })
      if (abort.signal.aborted) {
        source.dispose()
        return
      }
      this.prefetched = { itemId: next.item.id, handle: source, streamHandle: handle }
      this.ownCtx.logger.debug('player: prefetched %s', next.item.trackUrn)
    } catch {
      // A prefetch that fails is not an error the user should see: the track
      // is loaded again, normally, when it is actually its turn.
    } finally {
      this.prefetching = false
      if (this.prefetchAbort === abort) this.prefetchAbort = undefined
    }
  }

  private async maybeCrossfade(positionMs: number, durationMs: number): Promise<void> {
    if (this.config.transition !== 'crossfade' || this.config.crossfadeMs <= 0) return
    if (this.crossfading || !durationMs) return
    if (durationMs - positionMs > this.config.crossfadeMs) return

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next) return
    const incoming = this.takePrefetched(next.item.id)
    if (!incoming) return

    this.crossfading = true
    this.ownCtx.logger.info('player: crossfading to %s (%dms)', next.item.trackUrn, this.config.crossfadeMs)
    const outgoing = this.source
    const seconds = this.config.crossfadeMs / 1000

    // Equal-power in spirit: the outgoing node fades out while the incoming
    // one fades in over the same window, so the sum stays roughly constant.
    ramp(outgoing?.node, 1, 0, seconds, this.ownCtx.audio.context.currentTime)
    incoming.handle.node.connect(this.ownCtx.audio.chainInput)
    ramp(incoming.handle.node, 0, 1, seconds, this.ownCtx.audio.context.currentTime)

    await this.finishPlay({ completed: true, skipped: false })

    // The outgoing source is kept alive for the length of its fade. Disposing
    // it here — as `detachSource` would — stops it instantly, so the ramp
    // never sounds and a "crossfade" is only ever a fade-in.
    this.clearStall()
    this.sourceEnded?.()
    this.sourceEnded = undefined
    this.sourceStalled?.()
    this.sourceStalled = undefined
    this.source = undefined
    if (outgoing) this.fadeOut(outgoing, this.config.crossfadeMs)

    // The identity moves with the audio. `attach` only wires a source; the
    // track a crossfade hands over to is a *track change*, and without this
    // the transport, the lock screen, the history and `next()` all went on
    // believing the previous track was still playing.
    const previousUrn = this.transport.trackUrn
    this.set({
      currentItemId: next.item.id,
      trackUrn: next.item.trackUrn,
      nowPlaying: undefined,
      positionMs: 0,
      bufferedMs: 0,
      error: undefined,
    })
    this.ownCtx.emit('player/track-changed', next.item.trackUrn, previousUrn)

    this.attach(incoming.handle, next, { autoplay: true }, incoming.streamHandle)
    this.crossfading = false
  }

  private fadeOut(handle: AudioSourceHandle, ms: number): void {
    this.clearFading()
    const timer = setTimeout(() => {
      this.fading = undefined
      handle.dispose()
    }, ms)
    this.fading = { handle, timer }
  }

  private clearFading(): void {
    if (!this.fading) return
    clearTimeout(this.fading.timer)
    this.fading.handle.dispose()
    this.fading = undefined
  }

  private takePrefetched(
    itemId: string,
  ): { handle: AudioSourceHandle; streamHandle?: StreamHandle } | undefined {
    if (!this.prefetched) return undefined
    if (this.prefetched.itemId !== itemId) return undefined
    const ready = this.prefetched
    this.prefetched = undefined
    return { handle: ready.handle, streamHandle: ready.streamHandle }
  }

  private cancelPrefetch(): void {
    this.prefetchAbort?.abort()
    this.prefetchAbort = undefined
    this.prefetched?.handle.dispose()
    this.prefetched = undefined
  }

  private async onEnded(): Promise<void> {
    if (this.disposed) return
    this.ownCtx.logger.info('player: track ended %s', this.transport.trackUrn ?? 'unknown')
    await this.finishPlay({ completed: true, skipped: false })

    const next = this.model.next(this.transport.currentItemId, this.transport.repeat)
    if (!next) {
      this.detachSource()
      this.set({ status: 'idle', positionMs: 0 })
      void this.persist(true)
      return
    }
    await this.start(next, { autoplay: true })
  }

  /* ── history ───────────────────────────────────────────────────────── */

  private beginPlay(entry: QueueEntry, positionMs: number): void {
    this.activePlay = {
      id: `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      trackUrn: entry.item.trackUrn,
      itemId: entry.item.id,
      startedAt: Date.now(),
      msPlayed: 0,
      lastPositionMs: positionMs,
    }
  }

  private async finishPlay(outcome: { completed: boolean; skipped: boolean }): Promise<void> {
    const play = this.activePlay
    this.activePlay = undefined
    if (!play) return

    if (this.source && this.transport.status === 'playing') {
      play.msPlayed += Math.max(0, this.source.positionMs - play.lastPositionMs)
    }

    const record: PlayRecord = {
      id: play.id,
      trackUrn: play.trackUrn,
      startedAt: play.startedAt,
      endedAt: Date.now(),
      msPlayed: play.msPlayed,
      completed: outcome.completed,
      skipped: outcome.skipped,
      deviceId: this.config.deviceId,
      ...(this.model.entry(play.itemId)?.item.sourceContext
        ? { source: this.model.entry(play.itemId)!.item.sourceContext }
        : {}),
    }

    // History and the derived stats land in one transaction, so "most played"
    // can be a single indexed read without ever disagreeing with the record.
    await this.store.recordPlay(record).catch((error: unknown) => {
      this.ownCtx.logger.warn(`player: could not record play: ${String(error)}`)
    })
    // Scrobblers, stats and anything else run in parallel; one failing does
    // not block the others (docs/07 §5).
    await this.ownCtx.parallel('player/track-completed', record).catch(() => undefined)
    this.ownCtx.emit('player/history-changed')
  }

  /* ── errors ────────────────────────────────────────────────────────── */

  private async handleError(error: unknown, entry: QueueEntry, token: number): Promise<void> {
    const sourceError =
      error instanceof SourceError
        ? error
        : new ProviderError(error instanceof Error ? error.message : String(error))

    this.ownCtx.logger.error(
      'player: error playing %s: %s (code: %s)',
      entry.item.trackUrn,
      sourceError.message,
      sourceError.code,
    )
    this.ownCtx.emit('player/error', sourceError, entry.item.trackUrn)

    switch (sourceError.code) {
      case 'auth':
        // Stop and let the source plugin re-authenticate. The queue survives.
        await this.ownCtx.serial('source/auth-expired', instanceOf(entry.item.trackUrn))
        if (this.disposed || this.startToken !== token) return
        this.fail(sourceError, false)
        return

      case 'rate-limit': {
        const retryAfterMs = (sourceError as { retryAfterMs?: number }).retryAfterMs ?? 1000
        if (this.attempts === 0) {
          this.attempts++
          await delay(retryAfterMs)
          if (this.disposed || this.startToken !== token || this.transport.currentItemId !== entry.item.id) return
          await this.start(entry, { autoplay: true })
          return
        }
        this.attempts = 0
        if (this.disposed || this.startToken !== token) return
        await this.skip(entry)
        return
      }

      case 'network': {
        if (this.attempts < 3) {
          this.attempts++
          await delay(this.config.retryBackoffMs * 2 ** (this.attempts - 1))
          if (this.disposed || this.startToken !== token || this.transport.currentItemId !== entry.item.id) return
          await this.start(entry, { autoplay: true })
          return
        }
        // Out of attempts: pause with the queue intact so pressing play is all
        // it takes once connectivity is back.
        this.attempts = 0
        if (this.disposed || this.startToken !== token) return
        this.fail(sourceError, true)
        return
      }

      case 'not-found':
        await this.store.markUnavailable(entry.item.trackUrn).catch(() => undefined)
        if (this.disposed || this.startToken !== token) return
        await this.skip(entry)
        return

      // `unavailable` is where plugin-source-failover hooks the resolve
      // waterfall at M2; with nothing hooked, the honest response is to skip.
      case 'unavailable':
      case 'provider':
      default:
        if (this.disposed || this.startToken !== token) return
        await this.skip(entry)
    }
  }

  private fail(error: SourceError, retryable: boolean): void {
    this.ownCtx.logger.error('player: playback failed: %s (retryable: %s)', error.message, retryable)
    this.detachSource()
    this.set({
      status: 'error',
      error: { code: error.code, message: error.message, retryable },
    })
  }

  private async skip(entry: QueueEntry): Promise<void> {
    this.ownCtx.logger.warn(
      'player: skipping track %s (streak: %d)',
      entry.item.trackUrn,
      this.skipStreak + 1,
    )
    // Under repeat-all the queue never runs out, so a queue in which every
    // track fails would skip forever — an event storm, a write per track, and
    // a UI stuck on "skipping" until the battery goes. Give up after a run of
    // failures instead; any track that starts resets the count.
    if (++this.skipStreak >= this.config.maxSkipStreak) {
      this.skipStreak = 0
      this.fail(
        new ProviderError(
          `${this.config.maxSkipStreak} tracks in a row failed to play; stopping`,
        ),
        true,
      )
      return
    }

    const next = this.model.next(entry.item.id, this.transport.repeat)
    if (!next || next.item.id === entry.item.id) {
      this.set({ status: 'idle' })
      return
    }
    await this.start(next, { autoplay: true })
  }

  /* ── media session ─────────────────────────────────────────────────── */

  /**
   * The cover URL a browser media session can render.
   *
   * Chromium's `MediaMetadata` refuses `file:` outright and logs a warning on
   * every assignment, so a cached local cover must never be handed to it —
   * least of all once a second from the position tick. `artworkUri` still
   * carries the local file for the surfaces that need one (an Android
   * notification), and each media-session implementation picks what it can
   * render (docs/04 §7).
   */
  private sessionArtworkUrl(meta: NowPlayingMeta | undefined): string | undefined {
    const url = meta?.artwork?.sourceUrl
    return url && /^(https?:|data:|blob:)/i.test(url) ? url : undefined
  }

  private publishNowPlaying(): void {
    const urn = this.transport.trackUrn
    const session = this.mediaCtx?.mediaSession
    if (!urn) {
      if (this.transport.nowPlaying) {
        this.set({ nowPlaying: undefined })
      }
      session?.clear()
      return
    }

    void this.store
      .nowPlaying(urn)
      .then((meta) => {
        if (this.transport.trackUrn === urn && meta) {
          this.set({ nowPlaying: meta })
        }
        if (session) {
          const artworkUrl = this.sessionArtworkUrl(meta)
          session.update({
            // Never the URN: a lock screen showing a track's key is a bug
            // report, not metadata. An unresolved row says it is loading.
            title: meta?.title ?? 'Loading…',
            ...(meta?.artist ? { artist: meta.artist } : {}),
            ...(meta?.album ? { album: meta.album } : {}),
            ...(meta?.artworkUri ? { artworkUri: meta.artworkUri } : {}),
            ...(artworkUrl ? { artworkUrl } : {}),
            durationMs: this.transport.durationMs,
            positionMs: this.transport.positionMs,
          })
        }
      })
      .catch(() => undefined)

    if (session) {
      // `stalled` keeps reporting `playing`, so the lock screen does not
      // flicker on a buffer underrun (docs/05 §2).
      session.setPlaybackState(
        this.transport.status === 'playing' || this.transport.status === 'stalled'
          ? 'playing'
          : this.transport.status === 'paused'
            ? 'paused'
            : 'stopped',
      )
    }
  }

  private publishPosition(positionMs: number): void {
    const session = this.mediaCtx?.mediaSession
    if (!session) return
    // The metadata comes from the last resolution, never from the URN: this
    // tick used to overwrite the lock screen's title with the track's key
    // once a second, for every remote track.
    const meta = this.transport.nowPlaying
    const artworkUrl = this.sessionArtworkUrl(meta)
    session.update({
      title: meta?.title ?? 'Loading…',
      ...(meta?.artist ? { artist: meta.artist } : {}),
      ...(meta?.album ? { album: meta.album } : {}),
      ...(meta?.artworkUri ? { artworkUri: meta.artworkUri } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      durationMs: this.transport.durationMs,
      positionMs,
    })
  }

  /* ── persistence ───────────────────────────────────────────────────── */

  private async persist(immediate = false): Promise<void> {
    const now = Date.now()
    if (!immediate && now - this.lastSaveAt < this.config.saveThrottleMs) return
    this.lastSaveAt = now
    await this.store
      .saveState({
        currentItemId: this.transport.currentItemId,
        positionMs: this.transport.positionMs,
        repeat: this.transport.repeat,
        shuffle: this.model.shuffle,
        shuffleSeed: this.model.shuffleSeed,
        volume: this.transport.volume,
        muted: this.transport.muted,
      })
      .catch((error: unknown) => {
        this.ownCtx.logger.warn(`player: could not save playback state: ${String(error)}`)
      })
  }

  /**
   * Restore the queue and position — and do **not** start playing.
   *
   * Resuming into playback on launch is startling, particularly on a phone
   * that just came out of a pocket (docs/05 §2).
   */
  private async restore(): Promise<void> {
    const [entries, state] = await Promise.all([this.store.loadQueue(), this.store.loadState()])
    this.model.load(entries, { shuffle: state?.shuffle ?? false, seed: state?.shuffleSeed ?? 1 })

    if (state) {
      this.transport = {
        ...this.transport,
        repeat: state.repeat,
        shuffle: state.shuffle,
        playMode: derivePlayMode(state.shuffle, state.repeat),
        volume: state.volume,
        muted: state.muted,
      }
    }

    // Always synchronize the audio engine volume and mute with transport state upon restore
    this.ownCtx.audio.setVolume(this.transport.volume)
    this.ownCtx.audio.setMuted(this.transport.muted)

    const current = state?.currentItemId ? this.model.entry(state.currentItemId) : undefined
    if (current) {
      this.transport = {
        ...this.transport,
        status: 'paused',
        currentItemId: current.item.id,
        trackUrn: current.item.trackUrn,
        positionMs: state?.positionMs ?? 0,
      }
    }
    if (entries.length > 0) this.emitQueueChanged()
    this.ownCtx.emit('player/state-changed', this.transport)
    this.ownCtx.logger.info(
      'player: restored state (entries: %d, currentItem: %s, positionMs: %d, volume: %d)',
      entries.length,
      current?.item.trackUrn ?? 'none',
      state?.positionMs ?? 0,
      this.transport.volume,
    )
  }

  /* ── teardown ──────────────────────────────────────────────────────── */

  private detachSource(): void {
    this.clearStall()
    this.sourceEnded?.()
    this.sourceEnded = undefined
    this.sourceStalled?.()
    this.sourceStalled = undefined
    this.source?.dispose()
    this.source = undefined
    this.currentHandle = undefined
    this.fallbackDurationMs = 0
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * Statuses in which audio is meant to be coming out.
 *
 * `stalled` is one of them: it is a starved `playing`, not a `paused`, so
 * pause, seek, an interruption and a route change all treat it as playing.
 * `plugin-player`'s hooks export the same predicate for the UI, and the two
 * agreeing is the whole point of docs/05 §2's distinction.
 */
function isPlayingLike(status: TransportState['status']): boolean {
  return status === 'playing' || status === 'stalled'
}

/** Ramp a handle's own gain, where the platform gives us one to ramp. */
function ramp(node: AudioNode | undefined, from: number, to: number, seconds: number, now: number): void {
  const gain = (node as { gain?: AudioParam } | undefined)?.gain
  if (!gain) return
  gain.setValueAtTime?.(from, now)
  if (gain.linearRampToValueAtTime) gain.linearRampToValueAtTime(to, now + seconds)
  else gain.value = to
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/** The provider-local id inside a URN, without importing the parser twice. */
function parseUrnId(urn: string): { sourceId: string; id: string } {
  const parts = urn.split(':')
  return { sourceId: parts[1] ?? '', id: parts.slice(3).join(':') }
}

function instanceOf(urn: string): string {
  return parseUrnId(urn).sourceId
}

export const name = 'plugin-player'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.player` is usable.
 */
export async function apply(ctx: Context, config: PlayerConfig = {}) {
  ctx.logger.info('plugin-player: loaded')
  const fiber = await ctx.plugin(Player, config)
  return () => void fiber.dispose()
}

export default { name, apply }
export { QueueModel } from './queue.js'
export { permute } from '@BBeBee/toolkit'
export { PlayerStore } from './store.js'
export { PLAYER_COMMANDS } from './contributions.js'
