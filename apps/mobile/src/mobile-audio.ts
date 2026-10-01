import { Service, type Fiber, type Plugin } from '@BBeBee/kernel'
import type { Context } from 'cordis'
import type {
  AppSettings,
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
  let timer: ReturnType<typeof setInterval> | undefined

  return async (_service: string, method: string, args: unknown[]) => {
    if (globalMpv && typeof globalMpv[method] === 'function') {
      return globalMpv[method](...args)
    }

    switch (method) {
      case 'mpvLoad': {
        const uri = String(args[0])
        currentPositionMs = 0
        isPlaying = false
        if (timer) clearInterval(timer)
        return { durationMs, uri }
      }
      case 'mpvPlay': {
        const atMs = args[0] as number | undefined
        if (atMs !== undefined && atMs >= 0) currentPositionMs = atMs
        isPlaying = true
        if (timer) clearInterval(timer)
        timer = setInterval(() => {
          if (isPlaying) {
            currentPositionMs += 100
            if (currentPositionMs >= durationMs) {
              isPlaying = false
              clearInterval(timer)
            }
          }
        }, 100)
        return undefined
      }
      case 'mpvPause': {
        isPlaying = false
        if (timer) clearInterval(timer)
        return undefined
      }
      case 'mpvStop': {
        isPlaying = false
        currentPositionMs = 0
        if (timer) clearInterval(timer)
        return undefined
      }
      case 'mpvSeek': {
        currentPositionMs = Number(args[0] ?? 0)
        return undefined
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
  initialEngine?: 'webaudio' | 'mpv'
  mpvPlugin: Plugin
  webAudioPlugin: Plugin
  createContext?: () => BaseAudioContext
  fallbackLatencyMs?: number
  fetchBytes: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
}

/**
 * Mobile Audio Service Orchestrator.
 *
 * Sits as the singleton `ctx.audio` service on mobile, providing dynamic switching
 * between Route A (WebAudio via react-native-audio-api) and Route B (MPV Hi-Fi via in-process libmpv JNI/JSI).
 */
export class MobileAudioService extends Service implements AudioService {
  static inject = []

  private activeEngineKey: 'webaudio' | 'mpv' = 'webaudio'
  private activeEngine!: AudioService
  private activeFiber?: Fiber
  private currentVolume = 0.8
  private currentMuted = false
  private currentDeviceId = 'default'

  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private isSwitching = false

  constructor(
    ctx: Context,
    private readonly config: MobileAudioConfig,
  ) {
    super(ctx, 'audio')
  }

  async [Service.init]() {
    const target = this.config.initialEngine ?? 'webaudio'
    await this.mountEngine(target)

    // Listen to settings changes to dynamically switch engine
    const offSettings = this.ctx.on('settings/changed', (settings: AppSettings) => {
      const target = settings.audioOutputEngine === 'mpv' ? 'mpv' : 'webaudio'
      if (target !== this.activeEngineKey) {
        void this.switchEngine(target)
      }
    })

    return async () => {
      offSettings()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      if (this.activeFiber) {
        await this.activeFiber.dispose().catch(() => undefined)
        this.activeFiber = undefined
      }
    }
  }

  get activeEngineName(): 'webaudio' | 'mpv' {
    return this.activeEngineKey
  }

  get engine(): 'webaudio' | 'mpv' {
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

  private async mountEngine(engineKey: 'webaudio' | 'mpv'): Promise<void> {
    // If mpv is requested on mobile without an available native module or bridge, fall back to webaudio
    let actualEngine = engineKey
    if (engineKey === 'mpv') {
      const hasNativeBridge =
        Boolean((globalThis as unknown as { bbebeeMobileMpv?: unknown }).bbebeeMobileMpv) ||
        Boolean(this.config.bridgeCall)
      if (!hasNativeBridge) {
        this.ctx.logger?.warn(
          'mobile-audio: native libmpv module is not available on mobile; falling back to WebAudio',
        )
        actualEngine = 'webaudio'
      }
    }

    this.ctx.logger?.info('mobile-audio: mounting backend engine [%s]', actualEngine)
    const scoped = this.ctx.isolate('audio')

    let fiber: Fiber
    try {
      if (actualEngine === 'mpv') {
        const mpvConfig = {
          createContext: this.config.createContext,
          bridgeCall: this.config.bridgeCall ?? createMobileMpvBridge(),
          emitContextInterruptions: false,
        }
        fiber = await scoped.plugin(this.config.mpvPlugin, mpvConfig)
      } else {
        const webAudioConfig = {
          createContext: this.config.createContext,
          fetchBytes: this.config.fetchBytes,
          fallbackLatencyMs: this.config.fallbackLatencyMs ?? 100,
          emitContextInterruptions: false,
        }
        fiber = await scoped.plugin(this.config.webAudioPlugin, webAudioConfig)
      }
    } catch (err) {
      this.ctx.logger?.error('mobile-audio: failed to mount engine [%s]: %s', actualEngine, String(err))
      throw err
    }

    this.activeFiber = fiber
    this.activeEngine = (scoped as unknown as { audio: AudioService }).audio
    this.activeEngineKey = actualEngine
  }

  async switchEngine(targetEngine: 'webaudio' | 'mpv' | 'wasapi'): Promise<void> {
    const effectiveTarget: 'webaudio' | 'mpv' = targetEngine === 'mpv' ? 'mpv' : 'webaudio'
    if (this.activeEngineKey === effectiveTarget || this.isSwitching) return
    this.isSwitching = true
    try {
      this.ctx.logger?.info('mobile-audio: switching audio engine from [%s] to [%s]', this.activeEngineKey, effectiveTarget)
      
      const prevHandle = this.currentHandle
      const prevSrc = this.currentTrackSrc
      const prevOpts = this.currentTrackOpts
      const prevPosition = prevHandle?.positionMs ?? 0

      if (prevHandle) {
        try {
          prevHandle.pause()
          prevHandle.dispose()
        } catch {
          // ignore
        }
        this.currentHandle = undefined
      }

      if (this.activeFiber) {
        await this.activeFiber.dispose()
        this.activeFiber = undefined
      }

      await this.mountEngine(effectiveTarget)
      this.activeEngine.setVolume(this.currentVolume)
      this.activeEngine.setMuted(this.currentMuted)
      if (this.currentDeviceId !== 'default') {
        await this.activeEngine.setOutputDevice(this.currentDeviceId).catch(() => undefined)
      }

      // Seamless playback state migration: re-load track on new engine
      if (prevSrc && prevOpts) {
        try {
          const newHandle = await this.activeEngine.load(prevSrc, prevOpts)
          this.currentHandle = newHandle
          if (prevPosition > 0) {
            newHandle.play(prevPosition)
          }
        } catch (err) {
          this.ctx.logger?.warn('mobile-audio: failed to restore track on new engine: %s', String(err))
        }
      }

      this.ctx.emit('audio/engine-changed', { engine: effectiveTarget })
    } finally {
      this.isSwitching = false
    }
  }

  async getFftSpectrum(): Promise<FftSpectrumFrame | null> {
    if (typeof (this.activeEngine as unknown as { getFftSpectrum?: () => Promise<FftSpectrumFrame | null> | FftSpectrumFrame | undefined }).getFftSpectrum === 'function') {
      const res = await (this.activeEngine as unknown as { getFftSpectrum: () => Promise<FftSpectrumFrame | null> | FftSpectrumFrame | undefined }).getFftSpectrum()
      return res ?? null
    }
    return null
  }
}
