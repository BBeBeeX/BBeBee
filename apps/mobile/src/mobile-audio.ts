import { Service, type Fiber, type Plugin } from '@BBeBee/kernel'
import type { Context } from 'cordis'
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

export interface FftSpectrumFrame {
  frequencyData: number[] | Uint8Array
  timeDomainData: number[] | Uint8Array
}

/**
 * In-process bridge for mobile libmpv (Route B).
 *
 * Checks if React Native TurboModule / JSI binding `globalThis.bbebeeMobileMpv` is available;
 * falls back to high-fidelity in-process simulation when running in Expo Go or test runners.
 */
export function createMobileMpvBridge(): (service: string, method: string, args: unknown[]) => Promise<unknown> {
  const globalMpv = (globalThis as unknown as { bbebeeMobileMpv?: Record<string, (...args: unknown[]) => unknown> }).bbebeeMobileMpv

  let currentVolume = 0.8
  let currentMuted = false
  let currentPositionMs = 0
  const durationMs = 180_000
  let isPlaying = false
  let status: 'idle' | 'playing' | 'paused' | 'ended' = 'idle'
  let endedCount = 0
  let pendingNext: { uri: string } | undefined
  let rolledOverTo: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
  const startTimer = () => {
    if (timer) return
    timer = setInterval(() => {
      if (!isPlaying) return
      currentPositionMs += 100
      if (currentPositionMs < durationMs) return
      if (pendingNext) {
        // Gapless handoff: mpv advances inside its own playlist, so the
        // position rolls over to the appended file instead of ending.
        currentPositionMs = 0
        endedCount += 1
        rolledOverTo = pendingNext.uri
        pendingNext = undefined
        return
      }
      isPlaying = false
      status = 'ended'
      stopTimer()
    }, 100)
  }

  return async (_service: string, method: string, args: unknown[]) => {
    if (globalMpv && typeof globalMpv[method] === 'function') {
      return globalMpv[method](...args)
    }

    switch (method) {
      case 'mpvLoad': {
        const uri = String(args[0])
        // Loading exactly the file the engine just rolled over onto is the
        // gapless re-bind: the engine is already sounding it, so the load
        // must not reset the clock.
        if (rolledOverTo === uri && isPlaying) {
          rolledOverTo = undefined
          return { durationMs, uri, resumed: true, endedCount }
        }
        currentPositionMs = 0
        isPlaying = false
        status = 'idle'
        endedCount = 0
        pendingNext = undefined
        rolledOverTo = undefined
        stopTimer()
        return { durationMs, uri, endedCount: 0 }
      }
      case 'mpvPlay': {
        const atMs = args[0] as number | undefined
        if (atMs !== undefined && atMs >= 0) currentPositionMs = atMs
        if (status === 'ended') currentPositionMs = 0
        isPlaying = true
        status = 'playing'
        startTimer()
        return undefined
      }
      case 'mpvPause': {
        isPlaying = false
        status = 'paused'
        stopTimer()
        return undefined
      }
      case 'mpvStop': {
        isPlaying = false
        currentPositionMs = 0
        status = 'idle'
        pendingNext = undefined
        rolledOverTo = undefined
        stopTimer()
        return undefined
      }
      case 'mpvSeek': {
        currentPositionMs = Math.max(0, Math.min(durationMs, Number(args[0] ?? 0)))
        if (status === 'ended' && currentPositionMs < durationMs) status = 'paused'
        return undefined
      }
      case 'mpvAppend': {
        pendingNext = { uri: String(args[0]) }
        return undefined
      }
      case 'mpvGetState': {
        return { positionMs: currentPositionMs, durationMs, status, endedCount }
      }
      case 'mpvEngineStatus': {
        // The simulation is not the native engine; report honestly so the
        // visualizer falls back to the Web Audio analyser.
        return { running: false, mpvAvailable: false, pcmTapAvailable: false }
      }
      case 'mpvSetVolume': {
        currentVolume = Number(args[0] ?? 0.8)
        return undefined
      }
      case 'mpvSetMuted': {
        currentMuted = Boolean(args[0])
        return undefined
      }
      case 'mpvSetOutputDevice': {
        return undefined
      }
      case 'mpvSetDspConfig': {
        return undefined
      }
      case 'mpvGetFftFrame':
      case 'mpvGetFftSpectrum': {
        const binCount = 64
        const frequencyData = new Array(binCount).fill(0)
        const timeDomainData = new Array(binCount).fill(128)
        if (isPlaying && !currentMuted) {
          const t = currentPositionMs / 1000.0
          for (let i = 0; i < binCount; i++) {
            const mag = Math.sin(t * 5 + i * 0.2) * 0.5 + 0.5
            frequencyData[i] = Math.round(mag * 255 * currentVolume)
            timeDomainData[i] = Math.round(128 + Math.sin(t * 20 + i) * 127 * currentVolume)
          }
        }
        return { frequencyData, timeDomainData }
      }
      default:
        return undefined
    }
  }
}

export interface MobileAudioConfig {
  mpvPlugin: Plugin
  createContext?: () => BaseAudioContext
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
}

/**
 * Mobile Audio Service Orchestrator.
 *
 * Sits as the singleton `ctx.audio` service on mobile, mounting the single
 * MPV engine (`@bbebee/core-audio-mpv`) over the in-process libmpv JNI/JSI
 * bridge — or the high-fidelity simulation when no native module is present
 * (Expo Go, test runners).
 */
export class MobileAudioService extends Service implements AudioService {
  static inject = []

  private readonly activeEngineKey = 'mpv' as const
  private activeEngine!: AudioService
  private activeFiber?: Fiber
  private currentVolume = 0.8
  private currentMuted = false
  private currentDeviceId = 'default'
  private lastNativeDsp?: {
    af: string
    replaygain?: string
    replaygainClip?: boolean
    replaygainPreamp?: string
    replaygainFallback?: string
  }
  private bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>

  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()

  constructor(
    ctx: Context,
    private readonly config: MobileAudioConfig,
  ) {
    super(ctx, 'audio')
  }

  async [Service.init]() {
    // Same native-DSP push as the desktop shell: the lavfi chain the engine
    // evaluates lives behind the bridge, so a `dsp/af-changed` emission has
    // to be forwarded there to be heard at all.
    this.ctx.on('dsp/af-changed', (e) => {
      this.lastNativeDsp = e
      this.pushNativeDsp()
    })

    await this.mountEngine('mpv')

    return async () => {
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      if (this.activeFiber) {
        await this.activeFiber.dispose().catch(() => undefined)
        this.activeFiber = undefined
      }
    }
  }

  get activeEngineName(): 'mpv' {
    return this.activeEngineKey
  }

  get engine(): 'mpv' {
    return this.activeEngineKey
  }

  get context(): BaseAudioContext {
    return this.activeEngine.context
  }

  get destination(): AudioNode {
    return this.activeEngine.destination
  }

  get sampleRate(): number {
    return this.activeEngine.sampleRate
  }

  get hardwareBitDepth(): number | undefined {
    return (this.activeEngine as unknown as { hardwareBitDepth?: number }).hardwareBitDepth
  }

  get hardwareChannels(): number | undefined {
    return (this.activeEngine as unknown as { hardwareChannels?: number }).hardwareChannels
  }

  get currentDeviceLabel(): string | undefined {
    return (this.activeEngine as unknown as { currentDeviceLabel?: string }).currentDeviceLabel
  }

  get preloadNext(): AudioService['preloadNext'] {
    return this.activeEngine?.preloadNext?.bind(this.activeEngine)
  }

  get lastPreloadStatus(): AudioService['lastPreloadStatus'] {
    return this.activeEngine?.lastPreloadStatus
  }

  get outputLatencyMs(): number {
    return this.activeEngine.outputLatencyMs
  }

  get chainInput(): AudioNode {
    return this.activeEngine.chainInput
  }

  get chainOutput(): AudioNode | undefined {
    return this.activeEngine.chainOutput
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
    if (typeof this.activeEngine?.dipVolume === 'function') {
      return this.activeEngine.dipVolume(durationMs)
    }
    return () => {}
  }

  private currentTrackSrc?: string | Uri
  private currentTrackOpts?: LoadOptions
  private currentHandle?: AudioSourceHandle

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    this.currentTrackSrc = src
    this.currentTrackOpts = opts
    const handle = await this.activeEngine.load(src, opts)
    this.currentHandle = handle
    return handle
  }

  setVolume(v: number): void {
    this.currentVolume = Math.max(0, Math.min(1, v))
    this.activeEngine?.setVolume(this.currentVolume)
  }

  setMuted(m: boolean): void {
    this.currentMuted = m
    this.activeEngine?.setMuted(m)
  }

  listOutputDevices(): Promise<OutputDevice[]> {
    return this.activeEngine.listOutputDevices()
  }

  async setOutputDevice(id: string): Promise<void> {
    this.currentDeviceId = id
    await this.activeEngine.setOutputDevice(id)
  }

  async setAudioExclusive(exclusive: boolean): Promise<void> {
    const engine = this.activeEngine as unknown as { setAudioExclusive?: (e: boolean) => Promise<void> }
    await engine.setAudioExclusive?.(exclusive).catch(() => undefined)
  }

  async setVisualizer(enabled: boolean, fftSize?: number): Promise<void> {
    const engine = this.activeEngine as unknown as { setVisualizer?: (e: boolean, s?: number) => Promise<void> }
    await engine.setVisualizer?.(enabled, fftSize).catch(() => undefined)
  }

  async getEngineStatus(): Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }> {
    const engine = this.activeEngine as unknown as {
      getEngineStatus?: () => Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }>
    }
    try {
      if (engine.getEngineStatus) return await engine.getEngineStatus()
    } catch {
      // fall through to the honest "not running" answer
    }
    return { running: false, mpvAvailable: false, pcmTapAvailable: false }
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

  emitInterruption(e: InterruptionEvent): void {
    this.dispatchInterruption(e)
    ;(this.activeEngine as unknown as { emitInterruption?(event: InterruptionEvent): void })?.emitInterruption?.(e)
  }

  emitRouteChange(e: RouteChangeEvent): void {
    this.dispatchRouteChange(e)
    ;(this.activeEngine as unknown as { emitRouteChange?(event: RouteChangeEvent): void })?.emitRouteChange?.(e)
  }

  private dispatchInterruption(e: InterruptionEvent): void {
    for (const listener of this.interruptionListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('mobile-audio: interruption listener error: %s', String(err))
      }
    }
  }

  private dispatchRouteChange(e: RouteChangeEvent): void {
    for (const listener of this.routeListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('mobile-audio: route change listener error: %s', String(err))
      }
    }
  }

  private pushNativeDsp(): void {
    if (this.lastNativeDsp && this.bridgeCall) {
      void this.bridgeCall('audio', 'mpvSetDspConfig', [this.lastNativeDsp]).catch(() => undefined)
    }
  }

  private async mountEngine(engineKey: 'mpv'): Promise<void> {
    const hasNativeBridge = Boolean(
      (globalThis as unknown as { bbebeeMobileMpv?: unknown }).bbebeeMobileMpv,
    )
    if (!hasNativeBridge && !this.config.bridgeCall) {
      this.ctx.logger?.info(
        'mobile-audio: no native libmpv module; using the in-process simulation bridge',
      )
    }

    this.ctx.logger?.info('mobile-audio: mounting backend engine [%s]', engineKey)
    const scoped = this.ctx.isolate('audio')

    let fiber: Fiber
    try {
      this.bridgeCall = this.config.bridgeCall ?? createMobileMpvBridge()
      const mpvConfig = {
        createContext: this.config.createContext,
        bridgeCall: this.bridgeCall,
        emitContextInterruptions: false,
      }
      fiber = await scoped.plugin(this.config.mpvPlugin, mpvConfig)
    } catch (err) {
      this.ctx.logger?.error('mobile-audio: failed to mount engine [%s]: %s', engineKey, String(err))
      throw err
    }

    this.activeFiber = fiber
    /*
     * Take the engine's raw implementation from the fiber's impl store.
     * Resolving the service by name (`scoped.audio`) reads through whoever
     * is asking — and since the engine unification both this service and
     * AudioMpv register as `audio`, the gate re-binds that read to the
     * app-level provider, this very service: `setVolume` recursed into
     * itself and blew the native stack the moment Player#restore touched
     * volume on a device with saved playback state. The store entry is the
     * unproxied instance the plugin mounted, unreachable by interception.
     */
    const impl = (fiber as unknown as { store: Record<string, { value?: AudioService } | undefined> })
      .store['audio']
    if (!impl?.value) {
      throw new Error('mobile-audio: mounted engine did not provide the audio service')
    }
    this.activeEngine = impl.value
    // The engine mounted after any `dsp/af-changed` that already fired; push
    // the current chain so it starts in step with the Web Audio graph.
    this.pushNativeDsp()
  }

  async switchEngine(targetEngine: 'mpv' | 'wasapi'): Promise<void> {
    // Single-engine build: every historical value resolves to mpv, which is
    // already mounted. Kept for the settings-sync call shape.
    this.ctx.logger?.debug?.('mobile-audio: switchEngine(%s) — single mpv engine, no-op', targetEngine)
  }

  async getFftSpectrum(): Promise<FftSpectrumFrame | null> {
    if (typeof (this.activeEngine as unknown as { getFftSpectrum?: () => Promise<FftSpectrumFrame | null> | FftSpectrumFrame | undefined }).getFftSpectrum === 'function') {
      const res = await (this.activeEngine as unknown as { getFftSpectrum: () => Promise<FftSpectrumFrame | null> | FftSpectrumFrame | undefined }).getFftSpectrum()
      return res ?? null
    }
    return null
  }
}
