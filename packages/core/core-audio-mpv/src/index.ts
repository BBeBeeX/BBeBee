/**
 * `ctx.audio` — Desktop MPV Audio Engine (@BBeBee/core-audio-mpv).
 *
 * One of the interchangeable desktop engines (settings-switchable with `core-audio-webaudio`).
 * Powered by official libmpv running in an independent native audio-engine process for
 * crash isolation.
 *
 * Core Architecture Invariants:
 * 1. Crash Isolation: Native libmpv and WASAPI driver run in a separate subprocess.
 *    Any driver or native crash is trapped by the supervisor without affecting UI/main.
 * 2. Zero-IPC PCM Output: Decoded audio PCM directly streams to WASAPI (ao=wasapi)
 *    within the native process. PCM bytes NEVER cross IPC boundaries.
 * 3. In-process DSP/EQ: 10-band EQ, preamp, and compressor filters are evaluated
 *    natively in the audio-engine and hot-updated dynamically.
 * 4. FFT Spectrum Output: FFT frequency analysis is computed in-process and delivered
 *    as compact byte arrays via IPC / Shared Memory for WebGL Canvas rendering.
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
  StreamedHandle,
  defaultMediaElementFactory,
  type MediaElementLike,
} from '@BBeBee/core-audio-webaudio'
import {
  closeContextQuietly,
  ensureAudioContextRunning,
  enumerateOutputDevices,
  rebuildGraphAtRate,
  resolveBridgeCall,
  resolveNativeOutputDevice,
  sanitizeSinkId,
  ContextInterruptionObserver,
  type BridgeCall,
} from '@BBeBee/core-audio-webaudio'

export type { AudioLogger, BridgeCall } from '@BBeBee/core-audio-webaudio'

export interface AudioMpvConfig {
  createContext?: (options?: AudioContextOptions) => BaseAudioContext
  bridgeCall?: BridgeCall
  createMediaElement?: () => MediaElementLike
  emitContextInterruptions?: boolean
  /**
   * How long the engine may report `paused` while a source handle believes it
   * is sounding before the handle reports a stall — or, for a track that
   * never started, the end. 2000 ms by default; a test against a scripted
   * bridge lowers it to keep real-timer waits short.
   */
  pausedStallMs?: number
}

export interface FftSpectrumFrame {
  frequencyData: number[]
  timeDomainData: number[]
}

export class MpvSourceHandle implements AudioSourceHandle {
  readonly node: AudioNode
  readonly durationMs: number
  private position = 0
  private isPlaying = false
  private startTime = 0
  private timer?: ReturnType<typeof setInterval>
  private readonly endedListeners = new Set<() => void>()
  private readonly stalledListeners = new Set<(stalled: boolean) => void>()
  /** When the engine was first seen `paused` during the current play, if it is. */
  private pausedSince?: number
  private stallReported = false
  private readonly pausedStallMs: number

  constructor(
    private readonly context: BaseAudioContext,
    durationMs: number,
    private readonly bridge?: BridgeCall,
    private readonly logger?: Context['logger'],
    /** The engine was already sounding this file (gapless re-bind). */
    private readonly resumed = false,
    pausedStallMs?: number,
  ) {
    this.durationMs = durationMs
    this.pausedStallMs = pausedStallMs ?? 2_000
    this.node = this.context.createGain()
  }

  play(atMs?: number): void {
    // The player's attach always passes a position (its default 0). On a
    // re-bound file the engine is already sounding it — there a 0 is the
    // caller's default, not an intent, and seeking would restart the track
    // mid-glide (the exact "jumps to 0:00" the gapless handoff exists to
    // prevent). An explicit non-zero position is always honoured.
    const seekAt = this.resumed && atMs === 0 ? undefined : atMs
    if (seekAt !== undefined && seekAt >= 0) {
      this.position = seekAt
    }
    this.isPlaying = true
    this.startTime = Date.now() - this.position
    this.pausedSince = undefined
    this.stallReported = false
    // A position argument makes the engine seek. When the caller did not ask
    // for one, omit it: a fresh track starts from the engine's own zero, a
    // paused engine resumes from its own clock, and a playlist-advanced file
    // (the gapless handoff) keeps sounding instead of being seeked back to
    // the handle's zero.
    this.bridge?.('audio', 'mpvPlay', [seekAt]).catch(() => undefined)

    if (!this.timer) {
      this.timer = setInterval(async () => {
        if (!this.isPlaying) return
        if (this.bridge) {
          try {
            const state = (await this.bridge('audio', 'mpvGetState', [])) as
              | { positionMs?: number; durationMs?: number; status?: string }
              | undefined
            if (state && typeof state.positionMs === 'number') {
              this.position = state.positionMs
              if (state.status === 'ended') {
                this.isPlaying = false
                if (this.timer) {
                  clearInterval(this.timer)
                  this.timer = undefined
                }
                for (const cb of this.endedListeners) cb()
                return
              }
              if (state.status === 'error') {
                // A fatal engine error mid-track (network cut, dead URL).
                // Without this branch the handle kept polling a frozen
                // "playing" — silent forever, the mpv twin of reporting a
                // failure as a natural end. Once the track has sounded, an
                // underrun is what the protocol can express: the player's
                // stall watchdog turns it into a retryable network error at
                // the frozen position. A track that never started is a dead
                // link: report the end so the queue skips it.
                this.isPlaying = false
                if (this.timer) {
                  clearInterval(this.timer)
                  this.timer = undefined
                }
                if (this.position > 0) {
                  for (const cb of this.stalledListeners) cb(true)
                } else {
                  for (const cb of this.endedListeners) cb()
                }
                return
              }
              // The wedge detector: an engine reporting `paused` while this
              // handle believes it is sounding was paused out-of-band — a
              // pause through the handle would have cleared `isPlaying`. Left
              // alone, the poller watches a silent engine forever. After a
              // grace window (long enough to ride out a play that races the
              // loader, or the pause flag of a file still mounting), report a
              // stall at the frozen position; a wedge at zero never sounded,
              // so it reports the end, per the same convention the error
              // branch uses for a dead link. A return to `playing` reports
              // the recovery, exactly like a buffer underrun's.
              if (state.status === 'paused') {
                if (this.pausedSince === undefined) {
                  this.pausedSince = Date.now()
                } else if (
                  !this.stallReported &&
                  Date.now() - this.pausedSince >= this.pausedStallMs
                ) {
                  this.stallReported = true
                  if (this.position > 0) {
                    for (const cb of this.stalledListeners) cb(true)
                  } else {
                    this.isPlaying = false
                    if (this.timer) {
                      clearInterval(this.timer)
                      this.timer = undefined
                    }
                    for (const cb of this.endedListeners) cb()
                    return
                  }
                }
                return
              }
              this.pausedSince = undefined
              if (state.status === 'playing' && this.stallReported) {
                this.stallReported = false
                for (const cb of this.stalledListeners) cb(false)
              }
            }
          } catch {
            this.position = Date.now() - this.startTime
          }
        } else {
          this.position = Date.now() - this.startTime
          if (this.durationMs > 0 && this.position >= this.durationMs) {
            this.position = this.durationMs
            this.isPlaying = false
            if (this.timer) {
              clearInterval(this.timer)
              this.timer = undefined
            }
            for (const cb of this.endedListeners) cb()
          }
        }
      // 200 ms: the progress bar and lyrics read positionMs at their own
      // cadence, and each poll crosses the bridge — 50 ms was 40 log pairs/s
      // for no visible gain.
      }, 200)
    }
  }

  pause(): void {
    this.isPlaying = false
    this.position = Date.now() - this.startTime
    this.bridge?.('audio', 'mpvPause', []).catch(() => undefined)
  }

  stop(): void {
    this.isPlaying = false
    this.position = 0
    this.pausedSince = undefined
    this.stallReported = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.bridge?.('audio', 'mpvStop', []).catch(() => undefined)
  }

  seek(atMs: number): void {
    this.position = Math.max(0, Math.min(this.durationMs, atMs))
    this.startTime = Date.now() - this.position
    this.bridge?.('audio', 'mpvSeek', [this.position]).catch(() => undefined)
  }

  get positionMs(): number {
    return this.position
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => this.endedListeners.delete(cb)
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stalledListeners.add(cb)
    return () => this.stalledListeners.delete(cb)
  }

  dispose(): void {
    this.stop()
    this.endedListeners.clear()
    this.stalledListeners.clear()
    try {
      this.node.disconnect()
    } catch {
      // ignore
    }
  }
}

/**
 * A degraded (media-element) source handle that keeps the native engine's
 * visualizer alive while Chromium decodes.
 *
 * The engine produces FFT frames only while something is actually sounding,
 * and a track the engine could not load never reaches mpv `playing` — so a
 * degraded track would otherwise sit at zero forever. The wrapper forwards
 * this handle's playback state to the engine (`setStreamPlayback`), which
 * drives the synthetic spectrum there. Only the state crosses the bridge;
 * the PCM never does.
 */
class DegradedStreamHandle implements AudioSourceHandle {
  readonly node: AudioNode
  readonly durationMs: number

  constructor(
    private readonly inner: StreamedHandle,
    private readonly bridge?: BridgeCall,
  ) {
    this.node = inner.node
    this.durationMs = inner.durationMs
  }

  private notify(playing: boolean): void {
    this.bridge?.('audio', 'mpvSetStreamPlayback', [playing]).catch(() => undefined)
  }

  play(atMs?: number): void {
    this.inner.play(atMs)
    this.notify(true)
  }

  pause(): void {
    this.inner.pause()
    this.notify(false)
  }

  stop(): void {
    this.inner.stop()
    this.notify(false)
  }

  seek(atMs: number): void {
    this.inner.seek(atMs)
  }

  get positionMs(): number {
    return this.inner.positionMs
  }

  onEnded(cb: () => void): Disposable {
    return this.inner.onEnded(() => {
      this.notify(false)
      cb()
    })
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    return this.inner.onStalled(cb)
  }

  dispose(): void {
    this.notify(false)
    this.inner.dispose()
  }
}

export class AudioMpv extends Service implements AudioService {
  static inject = []

  context: BaseAudioContext
  chainInput: GainNode
  chainOutput: GainNode
  private master: GainNode
  private targetVolume = 0.8
  private mutedAt?: number
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private readonly config: AudioMpvConfig
  private activeHardwareSampleRate?: number
  private activeHardwareBitDepth?: number
  private activeHardwareChannels?: number
  private activeDeviceLabel?: string
  private selectedDeviceId = 'default'
  private readonly interruptions: ContextInterruptionObserver
  private readonly bridge?: BridgeCall

  constructor(ctx: Context, config: AudioMpvConfig = {}) {
    super(ctx, 'audio')
    this.config = config
    this.bridge = resolveBridgeCall(config.bridgeCall)

    this.interruptions = new ContextInterruptionObserver({
      logger: ctx.logger,
      emitInterruptions: config.emitContextInterruptions === true,
      onInterruption: (e) => this.emitInterruption(e),
    })

    const create = config.createContext ?? defaultContextFactory()
    this.context = create()

    this.chainInput = this.context.createGain()
    this.master = this.context.createGain()
    this.master.gain.value = this.targetVolume
    this.chainOutput = this.master
    this.chainInput.connect(this.master)
    this.master.connect(this.context.destination)

    this.ctx.logger?.info('core-audio-mpv: initialized (sampleRate: %d)', this.sampleRate)
  }

  get activeEngineName(): 'mpv' {
    return 'mpv'
  }

  get destination(): AudioNode {
    return this.master
  }

  get sampleRate(): number {
    return this.activeHardwareSampleRate ?? this.context.sampleRate
  }

  get hardwareBitDepth(): number {
    return this.activeHardwareBitDepth ?? 24
  }

  get hardwareChannels(): number {
    return this.activeHardwareChannels ?? 2
  }

  get currentDeviceLabel(): string | undefined {
    return this.activeDeviceLabel
  }

  get outputLatencyMs(): number {
    const ctx = this.context as AudioContext
    return typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0
      ? ctx.outputLatency * 1000
      : 15
  }

  async getFftSpectrum(): Promise<FftSpectrumFrame | null> {
    if (!this.bridge) return null
    try {
      const frame = (await this.bridge('audio', 'mpvGetFftFrame', [])) as FftSpectrumFrame | null
      return frame
    } catch {
      return null
    }
  }

  async setVisualizer(enabled: boolean, fftSize?: number): Promise<void> {
    if (!this.bridge) return
    try {
      await this.bridge('audio', 'mpvSetVisualizer', [enabled, fftSize])
    } catch {
      // ignore
    }
  }

  async getEngineStatus(): Promise<{ running: boolean; mpvAvailable: boolean }> {
    if (!this.bridge) return { running: false, mpvAvailable: false }
    try {
      const status = (await this.bridge('audio', 'mpvEngineStatus', [])) as
        | { running?: boolean; mpvAvailable?: boolean }
        | undefined
      // `mpvAvailable` defaults to true: an engine binary predating the
      // explicit field is not proof of degradation.
      return {
        running: status?.running === true,
        mpvAvailable: status?.mpvAvailable !== false,
      }
    } catch {
      return { running: false, mpvAvailable: false }
    }
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
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

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    this.gate()
    const srcStr = String(src)
    this.ctx.logger?.info('mpv: loading %s (strategy: %s)', srcStr, opts.strategy ?? 'stream')

    const bridge = resolveBridgeCall(this.config.bridgeCall)

    // Primary route: the native audio-engine — libmpv decodes every format
    // itself, so there is no external decoder in this engine's chain. Only
    // cloneable fields cross the bridge: the full LoadOptions carries an
    // `onBuffered` function and an `AbortSignal`, which structured clone
    // rejects ("An object could not be cloned").
    if (bridge) {
      try {
        const result = (await bridge('audio', 'mpvLoad', [
          srcStr,
          { strategy: opts.strategy, headers: opts.headers },
        ])) as
          | {
              durationMs?: number
              resumed?: boolean
              sampleRate?: number
              channels?: number
              bitDepth?: number
            }
          | undefined
        if (result && typeof result.durationMs === 'number' && result.durationMs > 0) {
          this.ctx.logger?.info(
            'mpv: loaded via native audio-engine (%dms%s)',
            result.durationMs,
            result.resumed ? ', already sounding (gapless re-bind)' : '',
          )
          await this.ensureContextSampleRate(result.sampleRate)
          this.activeHardwareSampleRate = result.sampleRate
          this.activeHardwareChannels = result.channels
          this.activeHardwareBitDepth = result.bitDepth
          opts.onBuffered?.(result.durationMs / 1000)
          return new MpvSourceHandle(
            this.context,
            result.durationMs,
            bridge,
            this.ctx.logger,
            result.resumed === true,
            this.config.pausedStallMs,
          )
        }
        this.ctx.logger?.warn(
          'mpv: native mpvLoad returned no duration — degrading to the media element',
        )
      } catch (err) {
        this.ctx.logger?.warn('mpv: native mpvLoad failed: %s — degrading to the media element', String(err))
      }
    } else {
      this.ctx.logger?.warn(
        'mpv: no audio bridge available — the media element (Chromium decode) is the only path for %s',
        srcStr,
      )
    }

    // Degradation: the media element (Chromium decode) when the engine cannot take the track
    return this.loadStreamed(srcStr, opts)
  }

  private async loadStreamed(src: string, _opts: LoadOptions): Promise<AudioSourceHandle> {
    const createElement = this.config.createMediaElement ?? defaultMediaElementFactory()
    if (!createElement) {
      throw new Error(
        'audio: the mpv native bridge could not take this track and there is no media element to degrade to.',
      )
    }

    const element = createElement()
    try {
      element.crossOrigin = 'anonymous'
      element.src = src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src

      const context = this.context as BaseAudioContext & {
        createMediaElementSource?: (el: unknown) => AudioNode
      }
      if (!context.createMediaElementSource) {
        throw new Error('audio: this AudioContext cannot wrap a media element')
      }
      const node = context.createMediaElementSource(element)
      const handle = new StreamedHandle(element, node, this.ctx.logger, this.ensureContextRunning)
      // The degradation is visible to the engine only if we tell it: the
      // wrapper forwards play/pause so the visualizer keeps moving.
      return new DegradedStreamHandle(handle, resolveBridgeCall(this.config.bridgeCall))
    } catch (err) {
      try {
        element.pause()
        element.src = ''
      } catch {
        // ignore
      }
      throw err
    }
  }

  private async ensureContextSampleRate(targetRate?: number): Promise<void> {
    if (!targetRate || targetRate === this.context.sampleRate) return
    const rebuilt = rebuildGraphAtRate({
      create: this.config.createContext ?? defaultContextFactory(),
      targetRate,
      mutedAt: this.mutedAt,
      targetVolume: this.targetVolume,
    })
    if (!rebuilt) return

    const oldCtx = this.context
    this.context = rebuilt.context
    this.chainInput = rebuilt.chainInput
    this.master = rebuilt.master
    this.chainOutput = rebuilt.master
    this.interruptions.attach(this.context)

    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (typeof sink === 'function' && this.selectedDeviceId !== 'default') {
      void sink.call(this.context, sanitizeSinkId(this.selectedDeviceId)).catch(() => {})
    }

    this.ctx.emit('audio/context-rebuilt')
    closeContextQuietly(oldCtx)
  }

  private readonly ensureContextRunning = (): void => {
    ensureAudioContextRunning(this.context, this.ctx.logger)
  }

  private gate(): void {
    assertGranted(this[Service.resolveConfig](), 'audio')
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v))
    this.targetVolume = clamped
    if (this.mutedAt !== undefined) {
      this.mutedAt = clamped
    } else {
      this.master.gain.value = clamped
    }
    this.bridge?.('audio', 'mpvSetVolume', [clamped]).catch(() => undefined)
  }

  setMuted(m: boolean): void {
    if (m) {
      if (this.mutedAt !== undefined) return
      this.mutedAt = this.targetVolume
      this.master.gain.value = 0
    } else {
      const restore = this.mutedAt ?? this.targetVolume
      this.mutedAt = undefined
      this.targetVolume = restore
      this.master.gain.value = restore
    }
    this.bridge?.('audio', 'mpvSetMuted', [m]).catch(() => undefined)
  }

  private lastPreload?: { uri: string; ok: boolean; at: number }

  /** Outcome of the most recent `preloadNext`, for gapless diagnostics. */
  get lastPreloadStatus(): { uri: string; ok: boolean; at: number } | undefined {
    return this.lastPreload
  }

  async preloadNext(src: string | Uri, opts?: { headers?: Record<string, string> }): Promise<void> {
    const bridge = resolveBridgeCall(this.config.bridgeCall)
    if (!bridge) {
      this.lastPreload = { uri: String(src), ok: false, at: Date.now() }
      return
    }
    try {
      // Headers ride along: the appended file is opened by the engine at the
      // playlist boundary, where only these options reach it (main's
      // stream interception covers the media element, not the engine).
      await bridge('audio', 'mpvAppend', [
        String(src),
        false,
        opts?.headers ? { headers: opts.headers } : undefined,
      ])
      this.lastPreload = { uri: String(src), ok: true, at: Date.now() }
      this.ctx.logger?.info('mpv: preloaded next track for gapless handoff: %s', String(src))
    } catch (err) {
      this.lastPreload = { uri: String(src), ok: false, at: Date.now() }
      this.ctx.logger?.debug?.('mpv: failed to preload next track: %s', String(err))
    }
  }

  async listOutputDevices(): Promise<OutputDevice[]> {
    const bridge = resolveBridgeCall(this.config.bridgeCall)
    if (bridge) {
      try {
        const mpvDevices = (await bridge('audio', 'mpvGetAudioDevices', [])) as Array<{ name: string; description: string }>
        if (Array.isArray(mpvDevices) && mpvDevices.length > 0) {
          const mapped: OutputDevice[] = mpvDevices.map((d) => ({
            id: d.name,
            label: d.description || d.name,
            isDefault: d.name === 'auto' || d.name === 'default',
          }))
          if (!this.activeDeviceLabel) {
            const def = mapped.find((d) => d.isDefault) ?? mapped[0]
            if (def) this.activeDeviceLabel = def.label
          }
          return mapped
        }
      } catch (err) {
        this.ctx.logger?.debug?.('mpv: native getAudioDevices query failed, falling back to standard enumeration: %s', String(err))
      }
    }

    const devices = await enumerateOutputDevices({
      logger: this.ctx.logger,
      bridgeCall: bridge,
    })
    if (!this.activeDeviceLabel) {
      const def = devices.find((d) => d.isDefault) ?? devices[0]
      if (def) this.activeDeviceLabel = def.label
    }
    return devices
  }

  async setOutputDevice(id: string): Promise<void> {
    this.selectedDeviceId = id
    const bridge = resolveBridgeCall(this.config.bridgeCall)
    if (bridge) {
      // An id already in the engine's own vocabulary (`<ao>/<device>`, the
      // WASAPI GUID form, or `auto`) passes through untouched: mpv names
      // devices `pipewire/…`, `alsa/…`, `coreaudio/…` and so on — far more
      // prefixes than any hardcoded list can carry. Anything else is a
      // Chromium/WebAudio id and goes through the label-based translation.
      if (id === 'auto' || id.includes('{') || /^[a-z][a-z0-9]*\//i.test(id)) {
        await bridge('audio', 'setOutputDevice', [id]).catch(() => undefined)
        this.activeDeviceLabel = id
      } else {
        const { nativeId, label } = await resolveNativeOutputDevice({ id, bridge, logger: this.ctx.logger })
        if (label) this.activeDeviceLabel = label
        await bridge('audio', 'setOutputDevice', [nativeId]).catch(() => undefined)
      }
    }
    const targetId = sanitizeSinkId(id)
    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (typeof sink === 'function') {
      await sink.call(this.context, targetId).catch(() => undefined)
    }
  }

  async setAudioExclusive(exclusive: boolean): Promise<void> {
    const bridge = resolveBridgeCall(this.config.bridgeCall)
    if (bridge) {
      await bridge('audio', 'mpvSetAudioExclusive', [exclusive]).catch(() => undefined)
    }
  }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable {
    this.interruptionListeners.add(cb)
    return () => {
      this.interruptionListeners.delete(cb)
    }
  }

  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable {
    this.routeListeners.add(cb)
    return () => {
      this.routeListeners.delete(cb)
    }
  }

  emitInterruption(event: InterruptionEvent): void {
    this.ctx.logger?.info('mpv: emitInterruption (type: %s, shouldResume: %s)', event.type, event.shouldResume)
    for (const listener of this.interruptionListeners) listener(event)
  }

  emitRouteChange(event: RouteChangeEvent): void {
    this.ctx.logger?.info('mpv: emitRouteChange (reason: %s)', event.reason)
    for (const listener of this.routeListeners) listener(event)
  }

  async [Service.init]() {
    this.interruptions.attach(this.context)
    return async () => {
      this.interruptions.detach()
      this.chainInput.disconnect()
      this.master.disconnect()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      closeContextQuietly(this.context)
    }
  }
}

function defaultContextFactory(): (options?: AudioContextOptions) => BaseAudioContext {
  return (options?: AudioContextOptions) => {
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      throw new Error('audio-mpv: no AudioContext available in global scope')
    }
    return new Ctor(options)
  }
}

export const name = 'core-audio-mpv'

export async function apply(ctx: Context, config: AudioMpvConfig = {}) {
  ctx.logger?.info('core-audio-mpv: loaded')
  const fiber = await ctx.plugin(AudioMpv, config)
  return () => void fiber.dispose()
}

export default AudioMpv
