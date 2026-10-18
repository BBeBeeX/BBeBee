/**
 * Desktop bootstrap — the composition root.
 *
 * This file wires up the desktop app: which core services to register,
 * which plugins to enable. Everything after it is platform-agnostic.
 *
 * Conventions:
 * - Each boot phase is a named async function; `boot()` orchestrates them.
 * - Failures are logged with `[boot:<phase>]` prefix; non-fatal phases
 *   degrade gracefully instead of aborting the boot.
 * - No domain logic here — only wiring.
 */

import { createApp, type App, type PluginRegistry, type RegistryEntry } from '@BBeBee/kernel'
import { Service, type Context, type Fiber } from 'cordis'
import type {
  AppSettings,
  AudioService,
  AudioSourceHandle,
  Disposable,
  InterruptionEvent,
  LoadOptions,
  OutputDevice,
  PluginManagerService,
  PluginManifest,
  RouteChangeEvent,
  Uri,
} from '@BBeBee/protocol'
import {
  DbBridge,
  FsBridge,
  PathsBridge,
  bridgeFetch,
  fetchPaths,
  safeStorageCodec,
} from '@BBeBee/core-desktop-bridge'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DeviceTauri } from '@BBeBee/core-device-tauri'
import { BackgroundTauri } from '@BBeBee/core-background-tauri'
import { MediaSessionTauri } from '@BBeBee/core-media-session-tauri'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import { JsQuickJsNode } from '@BBeBee/core-js-quickjs-node'
import { CodecNode } from '@BBeBee/core-codec-node'
import { HttpNode } from '@BBeBee/core-http-node'
import { AudioWebAudio, type AudioWebAudioConfig } from '@BBeBee/core-audio-webaudio'
import { AudioMpv, type AudioMpvConfig } from '@BBeBee/core-audio-mpv'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logConsole from '@BBeBee/plugin-log-console'
import logFile from '@BBeBee/plugin-log-file'

import { BOOTSTRAP_SERVICES, INITIAL_ENABLED } from './plugins.js'
import {
  getBuiltinPluginRegistry,
  installAndActivatePlugin,
  loadExternalPluginRegistry,
  uninstallExternalPlugin,
} from './dynamic-loader.js'
import { setScheme } from '@BBeBee/ui-kit-desktop'
import { toServableFileUrl } from '@BBeBee/toolkit'

const APP_VERSION = '0.0.0'
const BOOT_TIMEOUT_MS = 15_000

// =============================================================================
// Environment helpers
// =============================================================================

/** True when running under Vite dev server (http) vs packaged build. */
function isDevelopment(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:'
}

function isDebug(): boolean {
  if (typeof window.BBeBee?.isDebug === 'boolean') return window.BBeBee.isDebug
  return isDevelopment() || new URLSearchParams(location.search).has('debug')
}

/** Desktop host platform, normalized to protocol names. */
function hostPlatform(): 'macos' | 'windows' | 'linux' {
  const raw = window.BBeBee?.platform ?? 'linux'
  return raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : 'linux'
}

/** Audio formats the renderer can decode (probed, not assumed). */
function decodableFormats(): string[] {
  const probe = document.createElement('audio')
  const candidates: [string, string][] = [
    ['mp3', 'audio/mpeg'],
    ['flac', 'audio/flac'],
    ['m4a', 'audio/mp4; codecs="mp4a.40.2"'],
    ['aac', 'audio/aac'],
    ['wav', 'audio/wav'],
    ['ogg', 'audio/ogg; codecs="vorbis"'],
    ['opus', 'audio/ogg; codecs="opus"'],
  ]
  const supported = candidates
    .filter(([, mime]) => probe.canPlayType(mime) !== '')
    .map(([name]) => name)
  // The native engine handles these even when Chromium cannot
  for (const extra of ['alac', 'wma', 'ape', 'wv', 'dsf', 'dff', 'm4b']) {
    if (!supported.includes(extra)) supported.push(extra)
  }
  return supported
}

// =============================================================================
// DesktopAudioService
// =============================================================================

export interface DesktopAudioConfig {
  initialEngine?: 'mpv' | 'wasapi' | 'webaudio'
  initialAudioExclusive?: boolean
  fetchBytes: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
}

type EngineKey = 'mpv' | 'wasapi' | 'webaudio'

export class DesktopAudioService extends Service implements AudioService {
  static inject = []

  private activeEngineKey: EngineKey = 'webaudio'
  private activeEngine!: AudioService
  private activeFiber?: Fiber
  private lastNativeDsp?: {
    af: string
    replaygain?: string
    replaygainClip?: boolean
    replaygainPreamp?: string
    replaygainFallback?: string
  }
  private currentVolume = 0.8
  private currentMuted = false
  private currentAudioExclusive = false
  private currentDeviceId = 'default'

  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private offActiveInterruption?: Disposable
  private offActiveRoute?: Disposable
  private isSwitching = false

  constructor(
    ctx: Context,
    private readonly config: DesktopAudioConfig,
  ) {
    super(ctx, 'audio')
    this.currentAudioExclusive = config.initialAudioExclusive ?? false
  }

  async [Service.init]() {
    this.ctx.on('dsp/af-changed', (e) => {
      this.lastNativeDsp = e
      this.pushNativeDsp()
    })

    const target = this.config.initialEngine ?? 'mpv'
    await this.mountEngine(target)

    return async () => {
      this.ctx.logger?.info('[audio] disposing desktop audio service')
      this.offActiveInterruption?.()
      this.offActiveRoute?.()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      if (this.activeFiber) {
        await this.activeFiber.dispose().catch(() => undefined)
        this.activeFiber = undefined
      }
    }
  }

  get activeEngineName(): EngineKey {
    return (this.activeEngine as unknown as { activeEngineName?: EngineKey })
      ?.activeEngineName ?? this.activeEngineKey
  }

  get engine(): EngineKey {
    return this.activeEngineKey
  }

  // --- Delegated getters ---
  get context(): BaseAudioContext { return this.activeEngine.context }
  get destination(): AudioNode { return this.activeEngine.destination }
  get sampleRate(): number { return this.activeEngine.sampleRate }
  get outputLatencyMs(): number { return this.activeEngine.outputLatencyMs }
  get chainInput(): AudioNode { return this.activeEngine.chainInput }
  get chainOutput(): AudioNode | undefined { return this.activeEngine.chainOutput }

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

  // --- Delegated methods ---
  load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    return this.activeEngine.load(src, opts)
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
    this.currentAudioExclusive = exclusive
    await this.config.bridgeCall?.('audio', 'mpvSetAudioExclusive', [exclusive]).catch(() => {})
    const engine = this.activeEngine as unknown as { setAudioExclusive?: (e: boolean) => Promise<void> }
    await engine.setAudioExclusive?.(exclusive).catch(() => {})
  }

  async getFftSpectrum(): Promise<unknown> {
    const engine = this.activeEngine as unknown as { getFftSpectrum?: () => Promise<unknown> }
    return engine.getFftSpectrum ? engine.getFftSpectrum() : null
  }

  async setVisualizer(enabled: boolean, fftSize?: number): Promise<void> {
    await this.config.bridgeCall?.('audio', 'mpvSetVisualizer', [enabled, fftSize]).catch(() => {})
    const engine = this.activeEngine as unknown as { setVisualizer?: (e: boolean, s?: number) => Promise<void> }
    await engine.setVisualizer?.(enabled, fftSize).catch(() => {})
  }

  async getEngineStatus(): Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }> {
    const engine = this.activeEngine as unknown as {
      getEngineStatus?: () => Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }>
    }
    try {
      if (engine.getEngineStatus) return await engine.getEngineStatus()
    } catch { /* fall through */ }
    return { running: false, mpvAvailable: false, pcmTapAvailable: false }
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
    if (typeof this.activeEngine?.dipVolume === 'function') {
      return this.activeEngine.dipVolume(durationMs)
    }
    return () => {}
  }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable {
    this.interruptionListeners.add(cb)
    return () => { this.interruptionListeners.delete(cb) }
  }

  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable {
    this.routeListeners.add(cb)
    return () => { this.routeListeners.delete(cb) }
  }

  emitInterruption(e: InterruptionEvent): void {
    this.activeEngine?.emitInterruption(e)
  }

  emitRouteChange(e: RouteChangeEvent): void {
    this.activeEngine?.emitRouteChange(e)
  }

  // --- Engine lifecycle ---

  private dispatchInterruption(e: InterruptionEvent): void {
    for (const listener of this.interruptionListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('[audio] interruption listener error: %s', String(err))
      }
    }
  }

  private dispatchRouteChange(e: RouteChangeEvent): void {
    for (const listener of this.routeListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('[audio] route change listener error: %s', String(err))
      }
    }
  }

  private pushNativeDsp(): void {
    if (this.activeEngineKey === 'mpv' && this.lastNativeDsp && this.config.bridgeCall) {
      void this.config.bridgeCall('audio', 'mpvSetDspConfig', [this.lastNativeDsp]).catch(() => {})
    }
  }

  private async mountEngine(engineKey: EngineKey): Promise<void> {
    this.ctx.logger?.info('[audio] mounting engine [%s]', engineKey)
    const scoped = this.ctx.isolate('audio')
    const effectiveKey: 'mpv' | 'webaudio' = engineKey === 'wasapi' ? 'mpv' : engineKey

    let fiber: Fiber
    try {
      if (effectiveKey === 'mpv') {
        const cfg: AudioMpvConfig = {
          bridgeCall: this.config.bridgeCall,
          emitContextInterruptions: true,
        }
        fiber = await scoped.plugin(AudioMpv, cfg)
      } else {
        const cfg: AudioWebAudioConfig = {
          fetchBytes: this.config.fetchBytes,
          bridgeCall: this.config.bridgeCall,
          emitContextInterruptions: true,
        }
        fiber = await scoped.plugin(AudioWebAudio, cfg)
      }
    } catch (err) {
      if (effectiveKey === 'mpv') {
        this.ctx.logger?.warn('[audio] mpv mount failed, falling back to webaudio: %s', String(err))
        return this.mountEngine('webaudio')
      }
      throw err
    }

    // Read the mounted engine from the fiber's store (not via scoped.audio,
    // which would resolve to this wrapper and recurse).
    let mounted: AudioService | undefined
    try {
      mounted = (fiber as unknown as { store?: Record<string, { value?: AudioService }> })
        .store?.audio?.value
      if (!mounted || mounted === this) {
        throw new Error('mounted fiber did not provide an audio service')
      }
    } catch (err) {
      this.ctx.logger?.warn('[audio] engine [%s] unusable (%s), falling back', engineKey, String(err))
      if (effectiveKey === 'mpv') return this.mountEngine('webaudio')
      throw err
    }

    this.activeEngine = mounted
    this.activeFiber = fiber
    this.activeEngineKey = engineKey

    this.offActiveInterruption?.()
    this.offActiveRoute?.()
    this.offActiveInterruption = this.activeEngine.onInterruption((e) => this.dispatchInterruption(e))
    this.offActiveRoute = this.activeEngine.onRouteChange((e) => this.dispatchRouteChange(e))

    this.activeEngine.setVolume(this.currentVolume)
    this.activeEngine.setMuted(this.currentMuted)
    if (this.currentDeviceId !== 'default') {
      await this.activeEngine.setOutputDevice(this.currentDeviceId).catch(() => {})
    }
    if (effectiveKey === 'mpv') {
      this.pushNativeDsp()
      if (this.currentAudioExclusive && this.config.bridgeCall) {
        void this.config.bridgeCall('audio', 'mpvSetAudioExclusive', [this.currentAudioExclusive]).catch(() => {})
      }
    }
  }

  async switchEngine(target: EngineKey): Promise<void> {
    if (this.isSwitching) {
      this.ctx.logger?.warn('[audio] switch already in progress, skipping')
      return
    }
    if (this.activeEngineKey === target) return

    this.isSwitching = true
    this.ctx.logger?.info('[audio] switching from [%s] to [%s]', this.activeEngineKey, target)
    try {
      await this.dipVolume(20).catch(() => {})

      this.offActiveInterruption?.()
      this.offActiveInterruption = undefined
      this.offActiveRoute?.()
      this.offActiveRoute = undefined

      if (this.activeFiber) {
        await this.activeFiber.dispose().catch((err) => {
          this.ctx.logger?.warn('[audio] dispose failed: %s', String(err))
        })
        this.activeFiber = undefined
      }

      await this.mountEngine(target)
      this.ctx.logger?.info('[audio] switched to [%s]', target)
      this.ctx.emit('audio/engine-changed', { engine: target })
    } finally {
      this.isSwitching = false
    }
  }
}

// =============================================================================
// Boot phases
// =============================================================================

function createAudioFetchBytes(
  transport?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return async (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<ArrayBuffer> => {
    const isLocal =
      src.startsWith('file:') ||
      src.startsWith('bbebee-file:') ||
      src.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(src)

    if (isLocal) {
      opts?.signal?.throwIfAborted()
      const bridge = window.BBeBeeBridge
      if (bridge) {
        try {
          const fsUri = src.startsWith('bbebee-file:')
            ? src.replace(/^bbebee-file:\/*/, 'file:///')
            : src
          const raw = await bridge.call('fs', 'readBytes', [fsUri])
          opts?.signal?.throwIfAborted()
          if (raw instanceof ArrayBuffer) return raw
          const bytes = raw as Uint8Array
          const sliced = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          // `slice` on a non-shared buffer never yields SharedArrayBuffer, but
          // the type does not know that — narrow instead of casting.
          if (sliced instanceof SharedArrayBuffer) throw new Error('[audio] unexpected shared buffer')
          return sliced
        } catch { /* fall through to fetch */ }
      }
      const response = await window.fetch(toServableFileUrl(src) ?? src, {
        signal: opts?.signal,
      })
      if (!response.ok) throw new Error(`[audio] ${response.status} loading ${src}`)
      return response.arrayBuffer()
    }

    const fetchFn = transport ?? fetch
    const response = await fetchFn(src, { headers: opts?.headers, signal: opts?.signal })
    if (!response.ok) throw new Error(`[audio] ${response.status} loading ${src}`)
    return response.arrayBuffer()
  }
}

interface PreloadedPrefs {
  audioOutputEngine?: EngineKey
  audioExclusive?: boolean
  userAgent?: string
  storeData?: Record<string, unknown>
}

/** Read persisted prefs from store.json before the app starts. */
async function preloadPreferences(pathSnapshot: Record<string, string | undefined>): Promise<PreloadedPrefs> {
  const result: PreloadedPrefs = {}
  const appData = pathSnapshot['appData']
  if (!appData) return result
  try {
    const storeUri = `${appData}/store.json`
    const raw = await window.BBeBeeBridge?.call('fs', 'readFile', [storeUri])
    if (typeof raw !== 'string' || !raw) return result

    const data = JSON.parse(raw) as Record<string, unknown>
    result.storeData = data
    const prefs = (data['preferences'] ??
      data['@BBeBee/plugin-settings:preferences']) as
      | { audioOutputEngine?: EngineKey; audioExclusive?: boolean; userAgent?: string }
      | undefined

    if (prefs?.audioOutputEngine === 'mpv' ||
        prefs?.audioOutputEngine === 'wasapi' ||
        prefs?.audioOutputEngine === 'webaudio') {
      result.audioOutputEngine = prefs.audioOutputEngine === 'wasapi' ? 'mpv' : prefs.audioOutputEngine
    }
    if (typeof prefs?.audioExclusive === 'boolean') result.audioExclusive = prefs.audioExclusive
    if (typeof prefs?.userAgent === 'string') result.userAgent = prefs.userAgent
  } catch (err) {
    console.warn('[boot] failed to preload preferences:', err)
  }
  return result
}

/** Build the plugin registry (builtin + external). */
async function buildRegistry(): Promise<{
  registry: PluginRegistry
  manifests: Record<string, PluginManifest>
}> {
  const external = await loadExternalPluginRegistry().catch(() => ({}))
  const merged: Record<string, { manifest?: PluginManifest }> = {
    ...getBuiltinPluginRegistry(),
    ...external,
  }
  // An entry without a manifest cannot be loaded; drop it here rather than
  // handing `createApp` a registry it cannot honour.
  const registry: PluginRegistry = {}
  const manifests: Record<string, PluginManifest> = {}
  for (const [id, entry] of Object.entries(merged)) {
    if (!entry.manifest) continue
    registry[id] = entry as RegistryEntry
    manifests[id] = entry.manifest
  }
  return { registry, manifests }
}

/** Compute effective plugin enablement (initial + user overrides). */
function computeEnabledPlugins(
  storeData: Record<string, unknown> | undefined,
): typeof INITIAL_ENABLED {
  const effective = { ...INITIAL_ENABLED }
  const overrides = (
    storeData?.['@BBeBee/plugin-manager:enabled'] ??
    storeData?.['plugin-manager:enabled']
  ) as Record<string, boolean> | undefined

  if (!overrides) return effective
  for (const [id, enabled] of Object.entries(overrides)) {
    if (enabled === false && effective[id]) {
      effective[id] = { ...effective[id], enabled: false }
    } else if (enabled === true) {
      effective[id] = { ...(effective[id] ?? {}), enabled: true }
    }
  }
  return effective
}

// =============================================================================
// Main boot
// =============================================================================

export async function boot(): Promise<App> {
  const keychain = await safeStorageCodec()
  const pathSnapshot = await fetchPaths()
  const transport = bridgeFetch()
  const prefs = await preloadPreferences(pathSnapshot)
  const { registry, manifests } = await buildRegistry()
  const enabledPlugins = computeEnabledPlugins(prefs.storeData)

  const app = createApp({
    target: 'desktop',
    bootstrap: [
      [PathsBridge, pathSnapshot],
      FsBridge,
      [StoreFs, { initialData: prefs.storeData }],
      DbBridge,
      [DeviceTauri, { appVersion: APP_VERSION, platform: hostPlatform() }],
      BackgroundTauri,
      MediaSessionTauri,
      [SecretsNode, keychain ? { crypto: keychain } : {}],
      JsQuickJsNode,
      [CodecNode, { supportedFormats: decodableFormats() }],
      [HttpNode, {
        ...(transport ? { fetch: transport } : {}),
        ...(prefs.userAgent ? { userAgent: prefs.userAgent } : {}),
      }],
      [DesktopAudioService, {
        initialEngine: prefs.audioOutputEngine ?? 'mpv',
        initialAudioExclusive: prefs.audioExclusive,
        bridgeCall: window.BBeBeeBridge?.call,
        fetchBytes: createAudioFetchBytes(transport),
      }],
      [logBuffer, {}],
      ...(isDevelopment()
        ? ([[logConsole, { level: 3, debug: isDebug() }]] as const)
        : ([[logFile, { level: 2 }]] as const)),
    ],
    registry,
    config: { plugins: enabledPlugins },
  })

  await app.start()
  await app.ready([...BOOTSTRAP_SERVICES], { timeoutMs: BOOT_TIMEOUT_MS })

  wireSettingsSync(app)
  wireThemeSync(app)
  wirePluginManager(app, manifests)

  return app
}

// =============================================================================
// Post-boot wiring
// =============================================================================

function wireSettingsSync(app: App): void {
  app.ctx.inject(['settings', 'audio', 'http'], (scoped) => {
    const sync = (s: AppSettings | undefined) => {
      if (!s) return
      if (s.closeToTray !== undefined) {
        void window.BBeBee?.window?.setCloseToTray?.(s.closeToTray)
      }
      if (s.proxy) {
        void window.BBeBee?.proxy?.set?.(s.proxy)
      }
      if (s.audioOutputEngine && typeof scoped.audio?.switchEngine === 'function') {
        const target = s.audioOutputEngine === 'wasapi' ? 'mpv' : s.audioOutputEngine
        if (scoped.audio.activeEngineName && scoped.audio.activeEngineName !== target) {
          scoped.logger?.info('[boot] switching audio engine to "%s"', target)
          void scoped.audio.switchEngine(target).catch((err) => {
            scoped.logger?.error('[boot] engine switch failed: %s', String(err))
          })
        }
      }
      if (s.audioOutputDeviceId) {
        void scoped.audio?.setOutputDevice?.(s.audioOutputDeviceId).catch(() => {})
      }
      if (s.audioExclusive !== undefined) {
        void scoped.audio?.setAudioExclusive?.(s.audioExclusive).catch(() => {})
      }
      if (s.userAgent !== undefined) {
        scoped.http?.setUserAgent?.(s.userAgent)
      }
    }
    void scoped.settings.get().then(sync)
    scoped.on('settings/changed', sync)
  })
}

function wireThemeSync(app: App): void {
  app.ctx.inject(['theme'], (scoped) => {
    setScheme(scoped.theme.getEffectiveScheme())
    scoped.on('theme/changed', (_theme, scheme) => {
      setScheme(scheme ?? scoped.theme.getEffectiveScheme())
    })
  })
}

function wirePluginManager(
  app: App,
  manifests: Record<string, PluginManifest>,
): void {
  app.ctx.inject(['plugin-manager'], (scoped) => {
    const pm = (scoped as unknown as { 'plugin-manager'?: PluginManagerService })['plugin-manager']
    pm?.registerManifests(manifests)
    pm?.setLifecycleBridge({
      loadPlugin: (id: string) => app.loadPlugin(id),
      unloadPlugin: (id: string) => app.unloadPlugin(id),
      uninstallPlugin: (id: string) => uninstallExternalPlugin(app, id),
    })
  })

  app.ctx.inject(['contentRegistry'], (scoped) => {
    scoped.contentRegistry.setPluginInstaller(async (bundle) => {
      await installAndActivatePlugin(app, bundle.manifest.id, bundle.files, bundle.manifest)
      const pm = (app.ctx as unknown as { 'plugin-manager'?: PluginManagerService })['plugin-manager']
      pm?.registerManifests({ [bundle.manifest.id]: bundle.manifest })
    })
  })
}
