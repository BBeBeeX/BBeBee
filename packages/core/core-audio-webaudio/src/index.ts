/**
 * `ctx.audio` — one implementation for all three targets.
 *
 * Per ADR-4 the contract *is* the Web Audio API: `react-native-audio-api`
 * satisfies it on iOS and Android, and the same package's web build (or the
 * renderer's own `AudioContext`) satisfies it on desktop. So this package
 * talks to the standard interface and nothing else, and the shells hand it the
 * context their platform provides.
 *
 * Everything platform-shaped is a config seam rather than an import:
 * `createContext`, `createMediaElement`, `fetchBytes` and `bridgeCall`. That
 * keeps the package inside the invariant of docs/02 §1 — no platform SDK
 * outside `core-*` — and, just as usefully, makes the graph testable without a
 * sound card.
 *
 * Where the desktop bridge is available the engine matches the context to the
 * track's native sample rate — probed ahead of a streamed load, taken from the
 * bridge's PCM when it decodes a buffer — so the graph never resamples Hi-Res
 * material internally (`plugin-dsp` and `plugin-visualizer` resplice on the
 * `audio/context-rebuilt` event that follows). Realms without a bridge simply
 * never rebuild.
 *
 * See docs/05-audio-playback.md §1.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { assertGranted } from '@BBeBee/kernel'
import type {
  AudioService,
  AudioSourceHandle,
  Disposable,
  InterruptionEvent,
  LoadOptions,
  OutputDevice,
  RouteChangeEvent,
  Uri,
} from '@BBeBee/protocol'
import {
  closeContextQuietly,
  ensureAudioContextRunning,
  enumerateOutputDevices,
  rebuildGraphAtRate,
  resolveBridgeCall,
  resolveNativeOutputDevice,
  sanitizeSinkId,
  ContextInterruptionObserver,
  type AudioLogger,
  type BridgeCall,
} from './shared.js'

/**
 * Shared engine machinery, public so `core-audio-mpv` — which is built on
 * this package — can reuse it instead of forking it.
 */
export {
  closeContextQuietly,
  ensureAudioContextRunning,
  enumerateOutputDevices,
  rebuildGraphAtRate,
  resolveBridgeCall,
  resolveNativeOutputDevice,
  sanitizeSinkId,
  ContextInterruptionObserver,
} from './shared.js'
export type {
  AudioLogger,
  AudioProbeInfo,
  BridgeCall,
} from './shared.js'

/* ── The platform seams ─────────────────────────────────────────────────── */

/**
 * The slice of `HTMLMediaElement` streaming needs.
 *
 * Declared structurally so this package compiles with no DOM lib and no
 * react-native types: whatever the platform hands over needs these members and
 * nothing more.
 */
export interface MediaElementLike {
  src: string
  /**
   * The CORS mode the element loads in.
   *
   * Load-bearing, not cosmetic: an element wrapped by
   * `createMediaElementSource` and fetched cross-origin without CORS makes
   * the node output silence, so a remote track "plays" with no sound.
   */
  crossOrigin?: string | null
  currentTime: number
  duration: number
  paused: boolean
  seeking?: boolean
  error?: { code?: number; message?: string } | null
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface AudioWebAudioConfig {
  /**
   * Defaults to `globalThis.AudioContext`. Takes the standard options object,
   * `sampleRate` among them — the seam a sample-rate rebuild goes through.
   */
  createContext?: (options?: AudioContextOptions) => BaseAudioContext
  /** Defaults to `new Audio()`. Streaming is refused where there is none. */
  createMediaElement?: () => MediaElementLike
  /** Bytes for buffered loads. Defaults to `fetch`. */
  fetchBytes?: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  /** Reported as `outputLatencyMs` where the platform does not know. */
  fallbackLatencyMs?: number
  /** The desktop main-process bridge: probe, decodePcm, output devices. */
  bridgeCall?: BridgeCall
  /**
   * Translate the `AudioContext`'s own state transitions into interruption
   * events. See `ContextInterruptionObserver` for when to opt in.
   */
  emitContextInterruptions?: boolean
}

/* ── Source handles ─────────────────────────────────────────────────────── */

/**
 * A decoded buffer, played through a persistent output node.
 *
 * `AudioBufferSourceNode` is one-shot — it cannot be paused and restarted — so
 * the handle keeps a `GainNode` as its stable `node` and builds a fresh source
 * behind it on every `play()`, tracking the offset itself. That is also what
 * makes gapless possible: the next buffer is queued behind the same output
 * node while the current one is still sounding.
 */
export class BufferedHandle implements AudioSourceHandle {
  readonly node: GainNode
  readonly durationMs: number

  private source?: AudioBufferSourceNode
  private startedAt = 0
  private offsetSeconds = 0
  private playing = false
  private disposed = false
  private readonly endedListeners = new Set<() => void>()

  constructor(
    private readonly context: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    opts: {
      logger?: AudioLogger
      ensureRunning?: () => void
      /**
       * Overrides `buffer.duration` — the bridge reports the track's real
       * length, which a truncated decode would otherwise mask.
       */
      durationMs?: number
    } = {},
  ) {
    const { logger, ensureRunning, durationMs } = opts
    this.logger = logger
    this.ensureRunning = ensureRunning
    this.node = context.createGain()
    this.durationMs = durationMs ?? Math.round(buffer.duration * 1000)
    this.logger?.debug?.('webaudio: [buffered] handle created (duration: %dms)', this.durationMs)
  }

  private readonly logger?: AudioLogger
  private readonly ensureRunning?: () => void

  get positionMs(): number {
    if (!this.playing) return Math.round(this.offsetSeconds * 1000)
    const elapsed = this.context.currentTime - this.startedAt
    return Math.round(Math.min(this.offsetSeconds + elapsed, this.buffer.duration) * 1000)
  }

  play(atMs?: number): void {
    if (this.disposed) return
    // A context the OS left suspended or interrupted would swallow this start
    // silently — sources queued on it wait for a resume nobody had scheduled.
    this.ensureRunning?.()
    if (atMs !== undefined) this.offsetSeconds = Math.max(0, atMs / 1000)
    this.logger?.debug?.('webaudio: [buffered] play (offsetSeconds: %s)', this.offsetSeconds)
    this.stopSource()

    const source = this.context.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.node)
    source.onended = () => {
      // A source stopped by seek or pause also fires `onended`; only a source
      // that reached the end of the buffer is a track ending.
      if (source !== this.source || !this.playing) return
      this.logger?.debug?.('webaudio: [buffered] playback ended')
      this.playing = false
      this.offsetSeconds = this.buffer.duration
      for (const listener of this.endedListeners) listener()
    }
    source.start(0, this.offsetSeconds)

    this.source = source
    this.startedAt = this.context.currentTime
    this.playing = true
  }

  pause(): void {
    if (!this.playing) return
    this.offsetSeconds = Math.min(
      this.offsetSeconds + (this.context.currentTime - this.startedAt),
      this.buffer.duration,
    )
    this.playing = false
    this.logger?.debug?.('webaudio: [buffered] pause (position: %dms)', Math.round(this.offsetSeconds * 1000))
    this.stopSource()
  }

  seek(atMs: number): void {
    if (this.disposed) return
    this.logger?.debug?.('webaudio: [buffered] seek to %dms', atMs)
    this.offsetSeconds = Math.max(0, Math.min(atMs / 1000, this.buffer.duration))
    if (this.playing) {
      this.play(atMs)
    }
  }

  stop(): void {
    this.logger?.debug?.('webaudio: [buffered] stop')
    this.playing = false
    this.offsetSeconds = 0
    this.stopSource()
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  /**
   * A decoded buffer holds the whole track in memory, so there is nothing left
   * to wait for and this never fires. The member exists because the contract
   * has it; registering the callback and never calling it would be the same
   * silence with a listener leaked behind it.
   */
  onStalled(): Disposable {
    return () => {}
  }

  dispose(): void {
    if (this.disposed) return
    this.logger?.debug?.('webaudio: [buffered] handle disposed')
    this.disposed = true
    // Freeze the position first. Stopping the source without clearing
    // `playing` left `positionMs` computing from a clock that keeps running,
    // so a disposed handle reported a track still advancing.
    this.pause()
    this.stopSource()
    this.endedListeners.clear()
    this.node.disconnect()
  }

  private stopSource(): void {
    if (!this.source) return
    const source = this.source
    this.source = undefined
    source.onended = null
    try {
      source.stop()
    } catch {
      // Already stopped; `stop()` on a finished source throws in some engines.
    }
    source.disconnect()
  }
}

/** A media element wrapped as a graph node: constant memory, no seek-ahead. */
/**
 * Element events that mean "the buffer ran dry" and "it filled again".
 *
 * `waiting` is the one that always fires; `stalled` is the network-level
 * cousin that some engines send instead, and neither is guaranteed on its own.
 * On the way back, `playing` is the honest signal — `canplay` fires while
 * still paused, so recovering on it would report `playing` for a track the
 * user had stopped.
 */
const STALL_EVENTS = ['waiting', 'stalled'] as const
const RECOVER_EVENTS = ['playing', 'canplaythrough'] as const

/**
 * The streaming handle, shared with `core-audio-mpv`: the MPV service
 * reaches the element path through the exact same class rather than a fork,
 * so stall/seek semantics cannot drift between the two `ctx.audio`
 * implementations (the same sharing pattern as `core-http-rn` ←
 * `core-http-node`).
 */
export class StreamedHandle implements AudioSourceHandle {
  readonly node: AudioNode

  private readonly endedListeners = new Set<() => void>()
  private readonly onEndedNative = () => {
    this.logger?.debug?.('webaudio: [streamed] playback ended')
    this.pendingSeekSeconds = undefined
    for (const listener of this.endedListeners) listener()
  }

  private readonly stallListeners = new Set<(stalled: boolean) => void>()
  private stalled = false
  /** Set once the element has actually produced sound (`playing`/`canplaythrough`). */
  private started = false
  private readonly onStallNative = () => {
    if ((this.element as { error?: unknown }).error) return
    this.setStalled(true)
  }
  private readonly onRecoverNative = () => {
    /*
     * The element's own clock is authoritative as soon as it can play,
     * unless an explicit seek is still in flight (element.seeking).
     *
     * A `play(atMs)` issued before metadata is stored by the element as its
     * *default playback start position*, and that path does not fire `seeked`
     * — so a pending marker recorded there would never clear. `attach` plays
     * every streamed track with `play(0)`, which is exactly that call, and the
     * position then reported 0 for the whole track while the audio played.
     */
    if (!this.element.seeking) {
      this.pendingSeekSeconds = undefined
    }
    this.started = true
    this.setStalled(false)
  }
  private readonly onSeekedNative = () => {
    this.pendingSeekSeconds = undefined
  }
  private readonly onErrorNative = () => {
    this.logger?.error?.('webaudio: [streamed] playback error', this.element.error)
    this.setStalled(false)
    /*
     * A fatal element error after the track has begun sounding is a network
     * failure, not a natural end. Reporting it as `ended` made the player
     * record the track as completed and skip ahead — the "position suddenly
     * jumps to 0:00 with no sound" report — and the next track, facing the
     * same broken network, sat silent at 0:00 too. An underrun is what the
     * protocol can express: the player's stall watchdog turns this into a
     * retryable network error at the frozen position instead.
     */
    if (this.started) {
      this.pendingSeekSeconds = undefined
      this.setStalled(true)
      return
    }
    this.onEndedNative()
  }

  private pendingSeekSeconds?: number

  constructor(
    private readonly element: MediaElementLike,
    node: AudioNode,
    private readonly logger?: AudioLogger,
    private readonly ensureRunning?: () => void,
  ) {
    this.node = node
    this.logger?.debug?.('webaudio: [streamed] handle created (src: %s)', element.src)
    element.addEventListener('ended', this.onEndedNative)
    element.addEventListener('seeked', this.onSeekedNative)
    element.addEventListener('error', this.onErrorNative)
    for (const type of STALL_EVENTS) element.addEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) element.addEventListener(type, this.onRecoverNative)
  }

  /**
   * Only an actual change is published.
   *
   * An element under a slow network sends `waiting` repeatedly, and a player
   * that took each one as a fresh stall would restart its recovery timeout on
   * every one of them — turning "gave up after 30 seconds" into "never gives
   * up".
   */
  private setStalled(stalled: boolean): void {
    if (this.stalled === stalled) return
    this.stalled = stalled
    if (stalled) {
      this.logger?.warn?.('webaudio: [streamed] playback stalled')
    } else {
      this.logger?.info?.('webaudio: [streamed] playback recovered from stall')
    }
    for (const listener of [...this.stallListeners]) listener(stalled)
  }

  get durationMs(): number {
    const seconds = this.element.duration
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
  }

  get positionMs(): number {
    if (this.pendingSeekSeconds !== undefined) {
      return Math.round(this.pendingSeekSeconds * 1000)
    }
    return Math.round(this.element.currentTime * 1000)
  }

  seek(atMs: number): void {
    const seconds = Math.max(0, atMs / 1000)
    this.logger?.debug?.('webaudio: [streamed] seek to %dms', atMs)
    /*
     * Only a seek that moves the element can be pending.
     *
     * Setting `currentTime` to where the element already is fires no
     * `seeked` event, so recording the target as pending would never clear
     * it — and `positionMs` would report that target for the whole track.
     * A fresh element is at 0, so `play(0)` is precisely the case that used
     * to stick: the progress bar sat at zero while the audio played.
     */
    if (seconds !== this.element.currentTime) {
      this.pendingSeekSeconds = seconds
      this.element.currentTime = seconds
    }
  }

  play(atMs?: number): void {
    // Same reasoning as the buffered handle: a suspended context wraps the
    // element in silence, and the element's own `play()` would resolve while
    // producing nothing.
    this.ensureRunning?.()
    if (atMs !== undefined) {
      this.seek(atMs)
    }
    this.logger?.debug?.('webaudio: [streamed] play (atMs: %s)', atMs)
    const res = this.element.play()
    if (res && typeof (res as Promise<void>).catch === 'function') {
      ;(res as Promise<void>).catch((err: Error) => {
        this.logger?.warn?.('webaudio: [streamed] play() rejected: %s', err.message)
        this.setStalled(false)
        if (err.name === 'NotSupportedError' || (this.element as { error?: unknown }).error) {
          this.onEndedNative()
        }
      })
    }
  }

  pause(): void {
    this.logger?.debug?.('webaudio: [streamed] pause (position: %dms)', this.positionMs)
    this.element.pause()
  }

  stop(): void {
    this.logger?.debug?.('webaudio: [streamed] stop')
    this.pendingSeekSeconds = undefined
    this.element.pause()
    this.element.currentTime = 0
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stallListeners.add(cb)
    return () => void this.stallListeners.delete(cb)
  }

  dispose(): void {
    this.logger?.debug?.('webaudio: [streamed] handle disposed')
    this.pendingSeekSeconds = undefined
    this.element.removeEventListener('ended', this.onEndedNative)
    this.element.removeEventListener('seeked', this.onSeekedNative)
    this.element.removeEventListener('error', this.onErrorNative)
    for (const type of STALL_EVENTS) this.element.removeEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) this.element.removeEventListener(type, this.onRecoverNative)
    this.endedListeners.clear()
    this.stallListeners.clear()
    this.element.pause()
    try {
      this.element.src = ''
    } catch {
      // ignore in environments where setting src throws
    }
    this.node.disconnect()
  }
}

/* ── The service ────────────────────────────────────────────────────────── */

export class AudioWebAudio extends Service implements AudioService {
  static inject = []

  context: BaseAudioContext
  chainInput: GainNode
  private master: GainNode
  private targetVolume = 0.8
  private mutedAt?: number
  private selectedDeviceId = 'default'
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private readonly activeMediaElements = new Set<MediaElementLike>()
  private activeHardwareBitDepth?: number
  private activeHardwareChannels?: number
  private activeDeviceLabel?: string
  /** Watches the context's own state; follows it across a rate rebuild. */
  private readonly interruptions: ContextInterruptionObserver

  constructor(
    ctx: Context,
    private readonly config: AudioWebAudioConfig = {},
  ) {
    super(ctx, 'audio')

    const create = config.createContext ?? defaultContextFactory()
    this.context = create()

    this.interruptions = new ContextInterruptionObserver({
      logger: ctx.logger,
      emitInterruptions: config.emitContextInterruptions === true,
      onInterruption: (e) => this.emitInterruption(e),
    })

    // chainInput → [effects, spliced in at M4] → master → destination.
    //
    // The empty splice point is deliberate: sources connect to `chainInput`
    // and never to `destination`, so effects can be built and torn down
    // without touching a playing source, and vice versa (docs/05 §1). M1
    // ships no chain at all rather than a pass-through one that would later
    // have to be un-built.
    this.chainInput = this.context.createGain()
    this.master = this.context.createGain()
    this.master.gain.value = this.targetVolume
    this.chainInput.connect(this.master)
    this.master.connect(this.context.destination)
    this.ctx.logger?.info('core-audio-webaudio: initialized (sampleRate: %d)', this.sampleRate)
  }

  get chainOutput(): GainNode {
    return this.master
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
    this.ctx.logger?.debug?.('webaudio: dipVolume duration %dms', durationMs)
    const dipSeconds = Math.max(0.005, durationMs / 1000)
    const now = this.context.currentTime
    if (typeof this.master.gain.cancelScheduledValues === 'function') {
      this.master.gain.cancelScheduledValues(now)
    }
    if (typeof this.master.gain.setTargetAtTime === 'function') {
      this.master.gain.setTargetAtTime(0, now, dipSeconds / 3)
    } else {
      this.master.gain.value = 0
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs))
    return () => {
      const target = this.mutedAt !== undefined ? 0 : this.targetVolume
      const resumeNow = this.context.currentTime
      if (typeof this.master.gain.cancelScheduledValues === 'function') {
        this.master.gain.cancelScheduledValues(resumeNow)
      }
      if (typeof this.master.gain.setTargetAtTime === 'function') {
        this.master.gain.setTargetAtTime(target, resumeNow, dipSeconds / 3)
      } else {
        this.master.gain.value = target
      }
    }
  }

  get destination(): AudioNode {
    return this.context.destination
  }

  get sampleRate(): number {
    return this.context.sampleRate
  }

  get outputLatencyMs(): number {
    const context = this.context as BaseAudioContext & {
      outputLatency?: number
      baseLatency?: number
    }
    const seconds = context.outputLatency ?? context.baseLatency
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return Math.round(seconds * 1000)
    return this.config.fallbackLatencyMs ?? 0
  }

  /** The source's bit depth, not the endpoint's — the OS mixer owns that. */
  get hardwareBitDepth(): number {
    return this.activeHardwareBitDepth ?? 16
  }

  get hardwareChannels(): number {
    return this.activeHardwareChannels ?? 2
  }

  get currentDeviceLabel(): string | undefined {
    return this.activeDeviceLabel
  }

  /**
   * Put the graph at the track's native rate: build a fresh context there,
   * swap the fields, tell graph consumers, retire the old context. A no-op
   * when the context already runs at the rate; a kept graph with a warning
   * when the realm refused to.
   */
  private async ensureContextSampleRate(targetRate?: number): Promise<void> {
    if (!targetRate || targetRate === this.context.sampleRate) {
      return
    }

    this.ctx.logger?.info(
      'webaudio: track sample rate (%dHz) differs from context (%dHz) — recreating AudioContext to keep the graph at the native rate',
      targetRate,
      this.context.sampleRate,
    )

    const rebuilt = rebuildGraphAtRate({
      create: this.config.createContext ?? defaultContextFactory(),
      targetRate,
      mutedAt: this.mutedAt,
      targetVolume: this.targetVolume,
    })
    if (!rebuilt) {
      this.ctx.logger?.warn(
        'webaudio: failed to rebuild AudioContext with sampleRate %d — keeping the current graph',
        targetRate,
      )
      return
    }

    const oldCtx = this.context
    this.context = rebuilt.context
    this.chainInput = rebuilt.chainInput
    this.master = rebuilt.master

    // Elements are bound to the old context through createMediaElementSource;
    // on the new graph they are silent, so stop tracking them for sink
    // switches. Live handles are the player's to dispose on the track change
    // that precedes any load.
    this.activeMediaElements.clear()

    // The state observer watches a context, not the service — follow it.
    this.interruptions.attach(this.context)

    // A fresh context knows nothing of the endpoint the user picked — put the
    // selection back, best effort.
    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> })
      .setSinkId
    if (typeof sink === 'function' && this.selectedDeviceId !== 'default') {
      void sink.call(this.context, sanitizeSinkId(this.selectedDeviceId)).catch(() => {})
    }

    // Notify DSP, visualizer, and other graph consumers to resplice nodes to
    // the new context.
    this.ctx.emit('audio/context-rebuilt')

    // Safely close previous context after new graph is attached
    closeContextQuietly(oldCtx)
  }

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    // `audio` is a flag capability: holding it means "may contribute nodes to
    // the audio graph" (docs/03 §7). Gated here rather than on `chainInput`
    // because this is where a caller actually acquires a node.
    this.gate()
    this.ctx.logger?.info('webaudio: loading %s (strategy: %s)', String(src), opts.strategy ?? 'stream')
    if (opts.strategy === 'buffer') {
      try {
        return await this.loadBuffered(src, opts)
      } catch (err) {
        // If buffered decoding fails (e.g. 24-bit FLAC, ID3v2-prefixed FLAC, or unsupported bit depth),
        // fallback to streamed HTMLMediaElement if available rather than aborting playback!
        this.ctx.logger?.warn('webaudio: buffered decoding failed, attempting stream fallback: %s', String(err))
        const canStream = Boolean(this.config.createMediaElement ?? defaultMediaElementFactory())
        if (canStream) {
          this.ctx.logger?.info('webaudio: falling back to streamed media element for %s', String(src))
          return await this.loadStreamed(src, opts)
        }
        throw err
      }
    }
    return this.loadStreamed(src, opts)
  }

  /** Ungated callers pass through; a plugin is held to its manifest. */
  private gate(): void {
    assertGranted(this[Service.resolveConfig](), 'audio')
  }

  private async loadBuffered(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const fetchBytes = this.config.fetchBytes ?? defaultFetchBytes
    const targetSrc =
      typeof src === 'string' && src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src
    this.ctx.logger?.debug?.('webaudio: fetching %s for buffered load', targetSrc)
    const bytes = await fetchBytes(targetSrc, { headers: opts.headers, signal: opts.signal })
    opts.signal?.throwIfAborted()
    this.ctx.logger?.debug?.('webaudio: fetched %d bytes, decoding audio data', bytes.byteLength)

    const decode = (this.context as BaseAudioContext & { decodeAudioData: DecodeFn }).decodeAudioData
    let buffer: AudioBuffer
    try {
      buffer = await decode.call(this.context, bytes)
      this.ctx.logger?.info(
        'webaudio: decodeAudioData succeeded (%dms, %d channels, %dHz)',
        Math.round(buffer.duration * 1000),
        buffer.numberOfChannels,
        buffer.sampleRate,
      )

      // Chromium resamples a decoded buffer to the context's own rate, so the
      // rates agree there; realms that do not resample get the context moved
      // to the buffer's rate instead of in-graph resampling on playback.
      if (buffer.sampleRate !== this.context.sampleRate) {
        await this.ensureContextSampleRate(buffer.sampleRate)
      }
      this.activeHardwareChannels = buffer.numberOfChannels
      this.activeHardwareBitDepth = 16
    } catch (decodeErr) {
      // No external decoder: what Chromium cannot decode is rethrown here and
      // load()'s caller degrades to the media element, whose decoder coverage
      // differs from decodeAudioData's.
      this.ctx.logger?.warn('webaudio: decodeAudioData failed for %s: %s', src, String(decodeErr))
      throw decodeErr
    }
    opts.signal?.throwIfAborted()

    // A decoded buffer is fully available, so the whole track is buffered.
    opts.onBuffered?.(buffer.duration)
    return new BufferedHandle(this.context, buffer, {
      logger: this.ctx.logger,
      ensureRunning: this.ensureContextRunning,
    })
  }

  private async loadStreamed(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const createElement = this.config.createMediaElement ?? defaultMediaElementFactory()
    if (!createElement) {
      throw new Error(
        'audio: streaming needs a media element, which this platform did not provide. ' +
          "Pass `createMediaElement`, or load with strategy 'buffer'.",
      )
    }

    const element = createElement()
    element.crossOrigin = 'anonymous'

    const elWithSink = element as unknown as { setSinkId?: (id: string) => Promise<void> }
    if (this.selectedDeviceId && typeof elWithSink.setSinkId === 'function') {
      void elWithSink.setSinkId(sanitizeSinkId(this.selectedDeviceId)).catch(() => {})
    }
    const targetSrc =
      typeof src === 'string' && src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src
    element.src = targetSrc

    const context = this.context as BaseAudioContext & {
      createMediaElementSource?: (el: unknown) => AudioNode
    }
    if (!context.createMediaElementSource) {
      throw new Error('audio: this AudioContext cannot wrap a media element')
    }
    const node = context.createMediaElementSource(element)

    if (opts.onBuffered) {
      // Reported from the element's own buffered ranges where it has them.
      const buffered = (element as { buffered?: { length: number; end(i: number): number } }).buffered
      if (buffered && buffered.length > 0) opts.onBuffered(buffered.end(buffered.length - 1))
    }

    this.activeMediaElements.add(element)
    this.ctx.logger?.info('webaudio: streamed source ready for %s', targetSrc)
    const handle = new StreamedHandle(element, node, this.ctx.logger, this.ensureContextRunning)
    const originalDispose = handle.dispose.bind(handle)
    handle.dispose = () => {
      this.activeMediaElements.delete(element)
      originalDispose()
    }

    return handle
  }

  /**
   * Kick a suspended or interrupted context before a source starts on it.
   * The shared implementation; bound late so it reads the context a rate
   * rebuild may have replaced.
   */
  private readonly ensureContextRunning = (): void => {
    ensureAudioContextRunning(this.context, this.ctx.logger)
  }

  setVolume(v: number): void {
    this.gate()
    const clamped = Math.max(0, Math.min(1, v))
    this.targetVolume = clamped
    this.ctx.logger?.debug?.('webaudio: setVolume %d', clamped)
    if (this.mutedAt !== undefined) {
      // Remember the level so unmuting restores it rather than jumping to 1.
      this.mutedAt = clamped
      return
    }
    if (typeof this.master.gain.cancelScheduledValues === 'function') {
      this.master.gain.cancelScheduledValues(this.context.currentTime)
    }
    if (typeof this.master.gain.setValueAtTime === 'function') {
      this.master.gain.setValueAtTime(clamped, this.context.currentTime)
    } else {
      this.master.gain.value = clamped
    }
  }

  setMuted(m: boolean): void {
    this.gate()
    this.ctx.logger?.debug?.('webaudio: setMuted %s', m)
    if (m) {
      if (this.mutedAt !== undefined) return
      this.mutedAt = this.targetVolume
      if (typeof this.master.gain.cancelScheduledValues === 'function') {
        this.master.gain.cancelScheduledValues(this.context.currentTime)
      }
      this.master.gain.value = 0
      return
    }
    if (this.mutedAt === undefined) return
    const restore = this.mutedAt
    this.mutedAt = undefined
    this.targetVolume = restore
    if (typeof this.master.gain.cancelScheduledValues === 'function') {
      this.master.gain.cancelScheduledValues(this.context.currentTime)
    }
    if (typeof this.master.gain.setValueAtTime === 'function') {
      this.master.gain.setValueAtTime(restore, this.context.currentTime)
    } else {
      this.master.gain.value = restore
    }
  }

  /**
   * ⚠️ Enumeration is a desktop capability. On mobile the OS owns routing, so
   * this reports a single default device rather than throwing — the UI hides
   * the picker when there is only one entry (docs/05 §1).
   */
  async listOutputDevices(): Promise<OutputDevice[]> {
    this.ctx.logger?.info('webaudio: listOutputDevices() started')
    const devices = await enumerateOutputDevices({
      logger: this.ctx.logger,
      bridgeCall: resolveBridgeCall(this.config.bridgeCall),
    })
    if (!this.activeDeviceLabel) {
      const def = devices.find((d) => d.isDefault) ?? devices[0]
      if (def) this.activeDeviceLabel = def.label
    }
    return devices
  }

  async setOutputDevice(id: string): Promise<void> {
    this.gate()
    this.selectedDeviceId = id
    this.ctx.logger?.info('webaudio: setOutputDevice("%s")', id)

    // The native side learns the OS device the Chromium id stands for — the
    // id Chromium understands and the id the OS understands are different.
    const bridge = resolveBridgeCall(this.config.bridgeCall)
    if (bridge) {
      const { nativeId, label } = await resolveNativeOutputDevice({ id, bridge, logger: this.ctx.logger })
      if (label) this.activeDeviceLabel = label
      try {
        await bridge('audio', 'setOutputDevice', [nativeId])
        this.ctx.logger?.info('webaudio: bridge audio.setOutputDevice("%s") succeeded', nativeId)
      } catch (err) {
        this.ctx.logger?.warn('webaudio: bridge audio.setOutputDevice("%s") failed: %s', nativeId, String(err))
      }
    }

    // Safety guard: never pass OS IDs (PnP InstanceId, MMDevice ID, ALSA hw) to Chromium setSinkId
    const targetId = sanitizeSinkId(id)

    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> })
      .setSinkId
    if (sink) {
      try {
        await sink.call(this.context, targetId)
        this.ctx.logger?.info('webaudio: AudioContext.setSinkId("%s") succeeded', targetId)
      } catch (err) {
        this.ctx.logger?.error('webaudio: AudioContext.setSinkId("%s") failed: %s', targetId, String(err))
      }
    } else {
      this.ctx.logger?.debug?.('webaudio: AudioContext.setSinkId is not supported in this runtime')
    }

    for (const element of this.activeMediaElements) {
      const elWithSink = element as unknown as { setSinkId?: (id: string) => Promise<void> }
      if (typeof elWithSink.setSinkId === 'function') {
        try {
          await elWithSink.setSinkId(targetId)
          this.ctx.logger?.debug?.('webaudio: MediaElement.setSinkId("%s") succeeded', targetId)
        } catch (err) {
          this.ctx.logger?.warn('webaudio: MediaElement.setSinkId("%s") failed: %s', targetId, String(err))
        }
      }
    }
  }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable {
    this.interruptionListeners.add(cb)
    return () => void this.interruptionListeners.delete(cb)
  }

  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable {
    this.routeListeners.add(cb)
    return () => void this.routeListeners.delete(cb)
  }

  /**
   * Publish an interruption.
   *
   * Called by the shell, which is where the platform's session events arrive:
   * `AVAudioSession` and `AudioManager` on mobile, device-change events on
   * desktop. The *policy* — what to pause, what to resume — is `ctx.player`'s
   * and is written once (docs/05 §5).
   */
  emitInterruption(event: InterruptionEvent): void {
    this.ctx.logger?.info('webaudio: emitInterruption (type: %s, shouldResume: %s)', event.type, event.shouldResume)
    for (const listener of this.interruptionListeners) listener(event)
  }

  /** Publish a route change. Same reasoning as `emitInterruption`. */
  emitRouteChange(event: RouteChangeEvent): void {
    this.ctx.logger?.info('webaudio: emitRouteChange (reason: %s)', event.reason)
    for (const listener of this.routeListeners) listener(event)
  }

  async [Service.init]() {
    this.interruptions.attach(this.context)
    return async () => {
      this.ctx.logger?.info('webaudio: disposing audio service')
      // Before `close()`: closing fires a final statechange, and a listener
      // outliving its service logs through an inactive context.
      this.interruptions.detach()
      this.chainInput.disconnect()
      this.master.disconnect()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      this.activeMediaElements.clear()
      closeContextQuietly(this.context)
    }
  }
}

type DecodeFn = (data: ArrayBuffer) => Promise<AudioBuffer>

function defaultContextFactory(): (options?: AudioContextOptions) => BaseAudioContext {
  return (options?: AudioContextOptions) => {
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      throw new Error(
        'audio: no AudioContext in this runtime. The shell must pass `createContext` — ' +
          'react-native-audio-api on mobile, the renderer’s own on desktop.',
      )
    }
    return new Ctor(options)
  }
}

export function defaultMediaElementFactory(): (() => MediaElementLike) | undefined {
  const Ctor = (globalThis as { Audio?: new () => MediaElementLike }).Audio
  return Ctor ? () => new Ctor() : undefined
}

async function defaultFetchBytes(
  src: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const response = await fetch(src, { headers: opts.headers, signal: opts.signal })
  if (!response.ok) throw new Error(`audio: ${response.status} loading ${src}`)
  return response.arrayBuffer()
}

export const name = 'core-audio-webaudio'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.audio` is usable.
 */
export async function apply(ctx: Context, config: AudioWebAudioConfig = {}) {
  ctx.logger.info('core-audio-webaudio: loaded')
  const fiber = await ctx.plugin(AudioWebAudio, config)
  return () => void fiber.dispose()
}

export default { name, apply }
