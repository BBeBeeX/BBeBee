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

import {
  createApp,
  createShellGrantResolver,
  type App,
  type PluginRegistry,
  type RegistryEntry,
} from '@BBeBee/kernel'
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
import { isCriticalServiceKey, PLUGIN_MANAGER_ID } from '@BBeBee/protocol'
import {
  DbBridge,
  FsBridge,
  PathsBridge,
  bridgeFetch,
  fetchPaths,
  safeStorageCodec,
  CodecBridge,
} from '@BBeBee/core-desktop-bridge'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DeviceTauri } from '@BBeBee/core-device-tauri'
import { BackgroundTauri } from '@BBeBee/core-background-tauri'
import { MediaSessionTauri } from '@BBeBee/core-media-session-tauri'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import { JsQuickJsNode } from '@BBeBee/core-js-quickjs-node'
import { HttpNode } from '@BBeBee/core-http-node'
import { AudioMpv, type AudioMpvConfig } from '@BBeBee/core-audio-mpv'
import logBuffer from '@BBeBee/plugin-log-buffer'
import logConsole from '@BBeBee/plugin-log-console'
import logFile from '@BBeBee/plugin-log-file'

import { version as reactVersion } from 'react'
import { version as reactDomVersion } from 'react-dom'
import { BOOTSTRAP_SERVICES, INITIAL_ENABLED, SHELL_MANIFEST } from './plugins.js'
import {
  getBuiltinPluginRegistry,
  installAndActivatePlugin,
  loadExternalPluginRegistry,
  resolveActiveProviders,
  uninstallExternalPlugin,
  type PluginLockRecord,
} from './dynamic-loader.js'
import { setScheme } from '@BBeBee/ui-kit-desktop'

const APP_VERSION = '0.1.0'
const BOOT_TIMEOUT_MS = 15_000

// =============================================================================
// Environment helpers
// =============================================================================

/** True when running under Vite dev server (http) vs packaged build. */
function isDevelopment(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:'
}

function isDebug(): boolean {
  // The shim always reports a boolean, but it cannot detect `tauri dev`
  // from inside the webview (no `process`), so its `false` must not veto
  // the dev-server / `?debug` fallbacks below — otherwise the console log
  // transport stays disabled and every ctx.logger call goes nowhere.
  if (window.BBeBee?.isDebug === true) return true
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
  initialEngine?: 'mpv' | 'wasapi'
  initialAudioExclusive?: boolean
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
  /** Test seam (and embedder override): the AudioContext the engine builds its graph on. */
  createContext?: (options?: AudioContextOptions) => BaseAudioContext
}

type EngineKey = 'mpv' | 'wasapi'

export class DesktopAudioService extends Service implements AudioService {
  static inject = []

  private activeEngineKey: EngineKey = 'mpv'
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
    if (this.lastNativeDsp && this.config.bridgeCall) {
      void this.config.bridgeCall('audio', 'mpvSetDspConfig', [this.lastNativeDsp]).catch(() => {})
    }
  }

  private async mountEngine(engineKey: EngineKey): Promise<void> {
    this.ctx.logger?.info('[audio] mounting engine [%s]', engineKey)
    const scoped = this.ctx.isolate('audio')

    let fiber: Fiber
    try {
      const cfg: AudioMpvConfig = {
        bridgeCall: this.config.bridgeCall,
        emitContextInterruptions: true,
        ...(this.config.createContext ? { createContext: this.config.createContext } : {}),
      }
      fiber = await scoped.plugin(AudioMpv, cfg)
    } catch (err) {
      this.ctx.logger?.error('[audio] mpv mount failed: %s', String(err))
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
      this.ctx.logger?.error('[audio] engine [%s] unusable (%s)', engineKey, String(err))
      throw err
    }

    this.activeEngine = mounted
    this.activeFiber = fiber
    // 'wasapi' is the legacy settings value for the same mpv engine.
    this.activeEngineKey = engineKey === 'wasapi' ? 'mpv' : engineKey

    this.offActiveInterruption?.()
    this.offActiveRoute?.()
    this.offActiveInterruption = this.activeEngine.onInterruption((e) => this.dispatchInterruption(e))
    this.offActiveRoute = this.activeEngine.onRouteChange((e) => this.dispatchRouteChange(e))

    this.activeEngine.setVolume(this.currentVolume)
    this.activeEngine.setMuted(this.currentMuted)
    if (this.currentDeviceId !== 'default') {
      await this.activeEngine.setOutputDevice(this.currentDeviceId).catch(() => {})
    }
    this.pushNativeDsp()
    if (this.currentAudioExclusive && this.config.bridgeCall) {
      void this.config.bridgeCall('audio', 'mpvSetAudioExclusive', [this.currentAudioExclusive]).catch(() => {})
    }
  }

  async switchEngine(target: EngineKey): Promise<void> {
    // 'wasapi' is the legacy settings value for the same mpv engine — there
    // is nothing to switch to anymore.
    const normalized: EngineKey = target === 'wasapi' ? 'mpv' : target
    if (this.isSwitching) {
      this.ctx.logger?.warn('[audio] switch already in progress, skipping')
      return
    }
    if (this.activeEngineKey === normalized) return

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

      await this.mountEngine(normalized)
      this.ctx.logger?.info('[audio] switched to [%s]', normalized)
      this.ctx.emit('audio/engine-changed', { engine: normalized })
    } finally {
      this.isSwitching = false
    }
  }
}

// =============================================================================
// Boot phases
// =============================================================================

interface PreloadedPrefs {
  audioOutputEngine?: EngineKey
  audioExclusive?: boolean
  userAgent?: string
  storeData?: Record<string, unknown>
}

/** Read persisted prefs from store.json before the app starts. Exported for tests. */
export async function preloadPreferences(pathSnapshot: Record<string, string | undefined>): Promise<PreloadedPrefs> {
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
      | { audioOutputEngine?: EngineKey | 'webaudio'; audioExclusive?: boolean; userAgent?: string }
      | undefined

    // 'wasapi' is the legacy settings value for the mpv engine; 'webaudio'
    // is the removed engine — both resolve to mpv.
    if (prefs?.audioOutputEngine === 'mpv' ||
        prefs?.audioOutputEngine === 'wasapi' ||
        prefs?.audioOutputEngine === 'webaudio') {
      result.audioOutputEngine = 'mpv'
    }
    if (typeof prefs?.audioExclusive === 'boolean') result.audioExclusive = prefs.audioExclusive
    if (typeof prefs?.userAgent === 'string') result.userAgent = prefs.userAgent
  } catch (err) {
    console.warn('[boot] failed to preload preferences:', err)
  }
  return result
}

/**
 * Recall records for the dynamic loader, from plugin-manager's npm
 * records in the store snapshot. The boot-time tamper chain was removed
 * 2026-10-24, so this forwards ONLY the two recall channels — a
 * persisted delisting (audit W3) and a registry ban (audit W5) — so the
 * loader quarantines a recalled plugin before its code runs. Any
 * `fileHashes`/`entrySha256` on old records are ignored, and the
 * bridge's registry.lock.json is no longer consulted here at all.
 */
async function mergedPluginLock(
  storeData: Record<string, unknown> | undefined,
): Promise<Record<string, PluginLockRecord> | undefined> {
  const merged: Record<string, PluginLockRecord> = {}
  // plugin-manager persists via ctx.store under its own namespace, which is
  // how the key appears in the raw store snapshot (same scheme as the
  // '@BBeBee/plugin-manager:enabled' overrides read in computeEnabledPlugins).
  const npmRecords = storeData?.['@BBeBee/plugin-manager:npm:installed'] as
    | Record<
        string,
        {
          delisted?: boolean
          blocked?: string
        }
      >
    | undefined
  if (npmRecords && typeof npmRecords === 'object') {
    for (const [id, rec] of Object.entries(npmRecords)) {
      if (!rec || typeof rec !== 'object') continue
      const basis: PluginLockRecord = {}
      if (rec.delisted) basis.delisted = true
      if (rec.blocked !== undefined) basis.blocked = rec.blocked
      if (basis.delisted || basis.blocked !== undefined) merged[id] = basis
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** Build the plugin registry (builtin + external). */
async function buildRegistry(storeData?: Record<string, unknown>): Promise<{
  registry: PluginRegistry
  manifests: Record<string, PluginManifest>
}> {
  const lock = await mergedPluginLock(storeData).catch(() => undefined)
  const external = await loadExternalPluginRegistry(lock ? { lock } : undefined).catch(() => ({}))
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
  manifests: Record<string, PluginManifest>,
): typeof INITIAL_ENABLED {
  const effective = { ...INITIAL_ENABLED }
  const overrides = (
    storeData?.['@BBeBee/plugin-manager:enabled'] ??
    storeData?.['plugin-manager:enabled']
  ) as Record<string, boolean> | undefined

  if (overrides) {
    for (const [id, enabled] of Object.entries(overrides)) {
      if (enabled === false && effective[id]) {
        effective[id] = { ...effective[id], enabled: false }
      } else if (enabled === true) {
        effective[id] = { ...(effective[id] ?? {}), enabled: true }
      }
    }
  }

  // Provider arbitration (audit W5): a non-critical key with several
  // providers may only start ONE of them (Cordis refuses duplicate
  // service registrations in an isolate). The winner comes from the
  // user's persisted selection, else the built-in provider; the other
  // providers present in the enablement map are held off here. This
  // filter only governs the config-driven set — a losing npm provider
  // that arrives through the external loader path is arbitrated at
  // install/switch time by the plugin-manager instead.
  const providersByKey = new Map<string, string[]>()
  for (const m of Object.values(manifests)) {
    if (!m.entry?.main) continue
    for (const key of m.contributes?.services ?? []) {
      const arr = providersByKey.get(key) ?? []
      arr.push(m.id)
      providersByKey.set(key, arr)
    }
  }
  if ([...providersByKey.values()].some((ps) => ps.length > 1)) {
    const selection = storeData?.['@BBeBee/plugin-manager:service-providers'] as
      | Record<string, string>
      | undefined
    const npmRecords = storeData?.['@BBeBee/plugin-manager:npm:installed'] as
      | Record<string, unknown>
      | undefined
    const active = resolveActiveProviders(
      providersByKey,
      selection,
      new Set(Object.keys(npmRecords ?? {})),
      isCriticalServiceKey,
    )
    for (const [key, providers] of providersByKey) {
      const winner = active.get(key)
      if (!winner) continue
      for (const id of providers) {
        if (id !== winner && effective[id] && effective[id].enabled !== false) {
          effective[id] = { ...effective[id], enabled: false }
        }
      }
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
  const { registry, manifests } = await buildRegistry(prefs.storeData)
  const enabledPlugins = computeEnabledPlugins(prefs.storeData, manifests)

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
      [CodecBridge, { supportedFormats: decodableFormats() }],
      [HttpNode, {
        ...(transport ? { fetch: transport } : {}),
        ...(prefs.userAgent ? { userAgent: prefs.userAgent } : {}),
      }],
      [DesktopAudioService, {
        initialEngine: prefs.audioOutputEngine ?? 'mpv',
        initialAudioExclusive: prefs.audioExclusive,
        bridgeCall: window.BBeBeeBridge?.call,
      }],
      [logBuffer, {}],
      ...(isDevelopment()
        ? ([[logConsole, { level: 3, debug: isDebug() }]] as const)
        : ([[logFile, { level: 2 }]] as const)),
    ],
    registry,
    config: { plugins: enabledPlugins },
    // Capability grants live in the db DbBridge provides; the kernel
    // resolves them after bootstrap and again before every dynamic
    // load, so a plugin the user just installed (plugin-manager records
    // the grant from the confirmed install) activates without a
    // restart, and a fresh boot sees the grants of past installs (W1).
    //
    // The resolver also layers plugin-manager's settings-derived
    // download hosts over the ledger (see `withManagerPipelineGrants`
    // in the kernel): the manager's grant entry is the union of its
    // manifest, any ledger rows, and the `net:host/…` set derived
    // from the user's current network settings — so a mirror the
    // user configures is one the manager may actually reach. The
    // derivation is re-run at every resolution, but a RUNNING manager
    // keeps the grants its fiber was created with: a settings change
    // takes gate effect at the manager's next load (in practice the
    // next launch). Its own endpoint selection and tarball pre-check
    // read settings live, so only a NEW custom host's gate entry can
    // lag — built-in endpoints are in every derived set already.
    resolveGrants: createShellGrantResolver({
      managerManifestCapabilities: manifests[PLUGIN_MANAGER_ID]?.capabilities,
    }),
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
    let lastGlassSignature = ''
    const sync = (s: AppSettings | undefined) => {
      if (!s) return
      if (s.closeToTray !== undefined) {
        void window.BBeBee?.window?.setCloseToTray?.(s.closeToTray)
      }
      // Window glass (layer B): settings.glass.window drives the native
      // OS effect through the shim; signature-guarded so unrelated
      // settings changes do not re-invoke it.
      if (s.glass?.window) {
        const w = s.glass.window
        // "Tint follows theme" resolves here, not in the settings: the
        // active theme's brand colour is read off :root (plugin-theme
        // keeps --primary current), and it joins the signature so a
        // theme switch re-sends the effect with the new tint.
        const themeTint = w.tintFollowTheme
          ? getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || undefined
          : undefined
        const tint = w.tintFollowTheme ? themeTint : w.tintColor
        const signature = `${JSON.stringify(w)}|${tint ?? ''}`
        if (signature !== lastGlassSignature) {
          lastGlassSignature = signature
          void window.BBeBee?.window
            ?.setGlass?.(w.enabled ? w.effect : 'off', tint, w.tintOpacity)
            ?.catch(() => {})
        }
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
    // The shell's own declaration goes in alongside the plugin manifests:
    // services the composition root provides directly (none today — see
    // SHELL_MANIFEST) must be visible to the install-time availability
    // check, which is judged against manifests.
    pm?.registerManifests({ [SHELL_MANIFEST.id]: SHELL_MANIFEST, ...manifests })
    // Host-module version facts for plugin-manager's install-plan peer
    // check: the versions of the React copies this shell actually loaded
    // (resolved through the import map to the shared host chunks — the
    // same instances plugin UIs will render against). The manifest in
    // host-modules.manifest.ts stays the build-time source of truth; this
    // is its runtime reflection, so the two can never drift apart.
    pm?.setHostVersions?.({ react: reactVersion, 'react-dom': reactDomVersion })
    pm?.setLifecycleBridge({
      loadPlugin: (id: string) => app.loadPlugin(id),
      unloadPlugin: (id: string) => app.unloadPlugin(id),
      uninstallPlugin: (id: string) => uninstallExternalPlugin(app, id),
      // npm installs (plugin-manager): files are already downloaded, verified
      // and security-scanned by the service; the bridge only writes + activates.
      installPlugin: async (id: string, files: Record<string, string>, manifest: PluginManifest) => {
        const result = await installAndActivatePlugin(app, id, files, manifest)
        pm?.registerManifests({ [id]: manifest })
        return result
      },
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
