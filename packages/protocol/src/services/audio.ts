/**
 * `ctx.audio`, `ctx.player`, `ctx.dsp`.
 * See docs/05-audio-playback.md.
 *
 * The `ctx.audio` contract *is* the Web Audio API — `react-native-audio-api`
 * satisfies it on iOS and Android, and its web build (or the browser's own
 * implementation) satisfies it in the Electron renderer. That is what makes a
 * single DSP chain run on all three targets.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type { Disposable, Uri } from '../common.js'
import type {
  PlayHistoryHeatmapDay,
  PlayHistoryStats,
  PlayMode,
  PlayRecord,
  QueueItem,
  QueueSourceContext,
  RepeatMode,
  TransportState,
} from '../entities/playback.js'
import type { StreamHandle } from '../entities/media.js'

/* ── ctx.audio ──────────────────────────────────────────────────────────── */

export interface AudioSourceHandle {
  readonly node: AudioNode
  readonly durationMs: number
  play(atMs?: number): void
  pause(): void
  stop(): void
  readonly positionMs: number
  seek?(atMs: number): void
  /** Fires when the source reaches its natural end. */
  onEnded(cb: () => void): Disposable
  /**
   * Fires with `true` when playback runs out of buffered audio, and with
   * `false` when it recovers.
   *
   * This is what makes `stalled` distinguishable from `paused` (docs/05 §2):
   * an underrun is not a user decision, so the UI shows a spinner rather than a
   * play button and the lock screen keeps reporting *playing*. A source that
   * cannot underrun — a fully decoded buffer — never fires and says so by
   * registering nothing, rather than by lacking the member.
   */
  onStalled(cb: (stalled: boolean) => void): Disposable
  dispose(): void
}

export interface LoadOptions {
  /** Streaming keeps memory flat; buffered enables sample-accurate gapless. */
  strategy: 'stream' | 'buffer'
  headers?: Record<string, string>
  signal?: AbortSignal
  onBuffered?: (seconds: number) => void
}

export interface OutputDevice {
  id: string
  label: string
  isDefault: boolean
  isVirtual?: boolean
}

export interface InterruptionEvent {
  type: 'began' | 'ended'
  shouldResume: boolean
}

export interface RouteChangeEvent {
  reason: 'device-removed' | 'device-added' | 'override'
}

export interface AudioService {
  readonly context: BaseAudioContext
  readonly destination: AudioNode
  readonly sampleRate: number
  readonly outputLatencyMs: number

  load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle>

  /**
   * Where `ctx.dsp` splices its chain. Sources connect here, never to
   * `destination`, so sources and effects have independent lifetimes.
   */
  readonly chainInput: AudioNode
  /** Where `ctx.dsp` connects the end of its chain. Connects to master volume. */
  readonly chainOutput?: AudioNode
  /** Smoothly dip master volume to avoid clicks during graph rewiring. */
  dipVolume?(durationMs?: number): Promise<Disposable>

  /** 0..1, applied post-chain. */
  setVolume(v: number): void
  setMuted(m: boolean): void

  listOutputDevices(): Promise<OutputDevice[]>
  setOutputDevice(id: string): Promise<void>
  /** Configure exclusive mode for native audio backend (e.g. MPV WASAPI exclusive). */
  setAudioExclusive?(exclusive: boolean): Promise<void>

  /**
   * Native-engine health, for engines backed by a separate process.
   *
   * `running` is the engine process itself; `mpvAvailable` says whether its
   * libmpv actually loaded. When either is false the engine silently
   * degrades to the media element — audible, but with no FFT frames and no
   * native device switching — and the settings UI surfaces exactly that
   * instead of pretending the native engine is running.
   *
   * `pcmTapAvailable` says whether the loaded libmpv exports the PCM tap
   * (`mpv_set_pcm_callback`) the FFT frames ride on. A libmpv without the
   * tap yields silence on every frame even though everything else works, so
   * the visualizer must fall back to the Web Audio analyser instead of
   * polling zero frames forever. Absent means available: an engine binary
   * predating the field is not proof of absence.
   */
  getEngineStatus?(): Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }>

  /**
   * Preload or append next track for gapless playback transitions.
   *
   * Optional on purpose, and the optionality is the contract: an engine that
   * implements it owns the playlist boundary itself (mpv advances inside its
   * own decoder), so callers must hand it the uri and never load a second
   * source for the same file — on a single-core engine `load` is a
   * `loadfile replace`, which kills the track that is still sounding.
   */
  preloadNext?(src: string | Uri, opts?: { headers?: Record<string, string> }): Promise<void>
  /** Outcome of the most recent `preloadNext`, for gapless diagnostics. */
  readonly lastPreloadStatus?: { uri: string; ok: boolean; at: number }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable
  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable

   /**
   * Publish a platform interruption to the listeners above.
   *
   * The *shell* calls this: it is the place the platform's own events arrive —
   * `AudioManager` on mobile, the `AudioContext`'s own state transitions on
   * desktop. The *policy* — what to pause, what to resume — belongs to
   * `ctx.player` (docs/05 §5), which is why the flow is split across the two
   * members: the shell publishes, the player decides.
   */
  emitInterruption(e: InterruptionEvent): void
  /** Publish a route change. Same reasoning as `emitInterruption`. */
  emitRouteChange(e: RouteChangeEvent): void

  /** Desktop-only: dynamic audio engine hot-switching. */
  switchEngine?(engine: 'mpv' | 'wasapi' | 'webaudio'): Promise<void>
  readonly activeEngineName?: 'mpv' | 'wasapi' | 'webaudio'

  /** Active hardware output specifications negotiated with physical audio DAC. */
  readonly hardwareBitDepth?: number
  readonly hardwareChannels?: number
  readonly currentDeviceLabel?: string
}

/* ── ctx.player ─────────────────────────────────────────────────────────── */

export interface PlayNowOptions {
  startIndex?: number
  context?: QueueSourceContext
}

export interface PlayerService {
  readonly state: Readonly<TransportState>
  readonly currentStream?: Readonly<StreamHandle>

  play(): Promise<void>
  pause(): void
  togglePlay(): void
  stop(): void
  seek(positionMs: number): Promise<void>
  next(): Promise<void>
  /** Restarts the current track if position is past the threshold. */
  previous(): Promise<void>

  setVolume(v: number): void
  setMuted(m: boolean): void
  setRepeat(m: RepeatMode): void
  setShuffle(on: boolean): void
  setPlayMode(mode: PlayMode): void
  cyclePlayMode(): PlayMode

  readonly queue: readonly QueueItem[]
  /**
   * The items after the current one, in real play order.
   *
   * Under shuffle this is the seeded permutation, not the queue's row order —
   * the order a "up next" view must show for anything to agree with what
   * actually plays next.
   */
  upcoming(): QueueItem[]
  playNow(urns: string[], opts?: PlayNowOptions): Promise<void>
  /**
   * Play one track the way a tap in a list means it.
   *
   * If the queue already holds `urn`, the queue is kept and playback jumps to
   * that entry. If it does not, the queue is replaced by `contextUrns` — the
   * list the tapped row belongs to (an album, the local library) — and
   * playback starts at `urn` within it. With no usable context the track
   * plays alone.
   */
  playFromContext(urn: string, contextUrns?: readonly string[], opts?: PlayNowOptions): Promise<void>
  enqueueNext(urns: string[]): void
  enqueueLast(urns: string[]): void
  removeItems(ids: string[]): void
  moveItem(id: string, toIndex: number): void
  clearQueue(): void

  getHistory(opts?: { limit?: number; offset?: number; date?: string }): Promise<PlayRecord[]>
  getHistoryStats(): Promise<PlayHistoryStats>
  getHistoryHeatmap(days?: number): Promise<PlayHistoryHeatmapDay[]>
  clearHistory(): Promise<void>
  removeHistory(idOrUrn: string): Promise<void>
}

/* ── ctx.dsp ────────────────────────────────────────────────────────────── */

export type EffectParamValue = number | string | boolean | number[]

/** One effect's contribution to the chain: a sub-graph with an in and an out. */
export interface EffectSegment {
  input: AudioNode
  output: AudioNode
  /** Called when a persisted parameter changes. Must be allocation-free. */
  setParam(name: string, value: EffectParamValue): void
  /** Added to the reported chain latency, for A/V sync and visualiser alignment. */
  latencyMs?: number
  dispose(): void
}

export interface EffectPreset<P = Record<string, unknown>> {
  name: string
  params: P
  builtin?: boolean
}

/**
 * Minimal schema shape, structurally compatible with Standard Schema.
 *
 * Declared locally rather than importing `@standard-schema/spec` so that
 * `@BBeBee/protocol` keeps zero runtime dependencies.
 */
export interface ParamSchema<Out = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => { value: Out } | { issues: readonly { message: string }[] } | PromiseLike<unknown>
  }
}

export interface EffectDefinition<P = Record<string, unknown>> {
  id: string
  displayName: string
  /** Lower runs earlier. Users may override. */
  defaultOrder: number
  Params: ParamSchema<P>
  presets?: EffectPreset<P>[]
  build(ctx: BaseAudioContext, params: P): EffectSegment
  /**
   * Native-engine adapter (mpv): serialize this effect's params into a
   * libavfilter fragment for the engine's `af` chain — one or more filters,
   * comma-separated. Effects without an adapter are skipped (with a log
   * line) on engines that cannot run Web Audio graphs. `params` is the
   * effect's current parameter record, defaults merged.
   */
  buildLavfi?(params: Record<string, unknown>): string
}

export interface ChainEntry {
  effectId: string
  enabled: boolean
  ordinal: number
}

export interface DspService {
  register(def: EffectDefinition<never>): Disposable
  readonly definitions: readonly EffectDefinition<never>[]

  readonly chain: readonly ChainEntry[]
  setEnabled(effectId: string, on: boolean): Promise<void>
  setOrder(effectId: string, ordinal: number): Promise<void>
  /** Never rebuilds the graph — a rebuild on every slider drag is audible. */
  setParam(effectId: string, name: string, value: EffectParamValue): Promise<void>
  applyPreset(effectId: string, presetName: string): Promise<void>
  getParams?(effectId: string): Record<string, unknown>

  /** Total added latency, so the visualiser and lyrics can compensate. */
  readonly latencyMs: number
}

declare module 'cordis' {
  interface Context {
    audio: AudioService
    player: PlayerService
    dsp: DspService
  }
}
