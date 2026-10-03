/**
 * The desktop bootstrap — the **composition root**.
 *
 * This file *is* the platform-specific surface of the desktop app: a list of
 * which core services to register, and which plugins to enable. Everything
 * after it — every feature plugin, every contribution — is identical to mobile
 * (docs/02 §3).
 *
 * It is one of docs/02 §1's three deliberate exceptions to the layer model,
 * and `eslint.config.js` names it by path: the only files allowed to call
 * `createApp` and to import a Layer 2 `core-*` package directly. That is
 * wiring, not business function — no orchestration, no domain types, no view
 * code belongs here, and everything else under `apps/` is plain Layer 4.
 * `kernel/src/layers.test.ts` fails if a second `createApp` appears elsewhere.
 *
 * Desktop uses **dynamic plugin loading** (docs/03 §6.2) via dynamic glob
 * resolution, eliminating static codegen for the desktop shell. What stays
 * hand-written is the config: configuration is the allowlist, so a package
 * being available is not on its own enough to run it.
 */

import { createApp, type App } from '@BBeBee/kernel'
import { Service, type Context, type Fiber } from 'cordis'
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
// The renderer is sandboxed, so these are IPC clients over the main-process
// host — not the node implementations, which cannot load here (docs/02 §2).
import {
  DbBridge,
  FsBridge,
  PathsBridge,
  bridgeFetch,
  fetchPaths,
  safeStorageCodec,
} from '@BBeBee/core-desktop-bridge'
import { StoreFs } from '@BBeBee/core-store-fs'
import { DeviceElectron } from '@BBeBee/core-device-electron'
import { BackgroundElectron } from '@BBeBee/core-background-electron'
import { MediaSessionElectron } from '@BBeBee/core-media-session-electron'
import { SecretsNode } from '@BBeBee/core-secrets-node'
import { JsQuickJsNode } from '@BBeBee/core-js-quickjs-node'
import { CodecNode } from '@BBeBee/core-codec-node'
import { HttpNode } from '@BBeBee/core-http-node'
import { AudioWebAudio, type AudioWebAudioConfig } from '@BBeBee/core-audio-webaudio'
import { AudioMpv, type AudioMpvConfig } from '@BBeBee/core-audio-mpv'
/*
 * The logs layer (Layer 3). Imported here rather than enabled through the
 * registry because it has to be *running* before the feature plugins whose
 * first lines it exists to capture — see the bootstrap array below.
 */
import logBuffer from '@BBeBee/plugin-log-buffer'
import logConsole from '@BBeBee/plugin-log-console'
import logFile from '@BBeBee/plugin-log-file'

import { BOOTSTRAP_SERVICES, INITIAL_ENABLED } from './plugins.js'
import { getBuiltinPluginRegistry, loadExternalPluginRegistry } from './dynamic-loader.js'

declare global {
  interface Window {
    BBeBee?: {
      paths: { get(kind: string): Promise<string | undefined> }
      shell: { openExternal(url: string): Promise<void> }
      dialog: { pickDirectory(): Promise<string | undefined> }
      files?: { getPath(file: File): string }
      devtools?: { open(): Promise<void> }
      platform: string
      versions: { electron: string; node: string }
      isDebug?: boolean
      window?: {
        minimize(): Promise<void>
        maximize(): Promise<void>
        close(): Promise<void>
        isMaximized(): Promise<boolean>
        setCloseToTray?(enabled: boolean): Promise<void>
        toggle?(): Promise<void>
      }
      proxy?: {
        test(config: unknown): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
        set(config: unknown): Promise<void>
      }
      desktopLyrics?: {
        setVisible(visible: boolean, pos?: { x: number; y: number }): Promise<void>
        setPosition?(pos: { x: number; y: number }): Promise<void>
        getPosition?(): Promise<{ x: number; y: number } | undefined>
        commitPosition?(pos: { x: number; y: number }): Promise<void>
        onMoved?(callback: (pos: { x: number; y: number }) => void): () => void
        setLocked(locked: boolean): Promise<void>
        setIgnoreMouse?(ignore: boolean): Promise<void>
        onCursor?(callback: (pos: { x: number; y: number }) => void): () => void
        updateData(data: unknown): Promise<void>
        sendAction(action: unknown): Promise<void>
        onData(callback: (data: unknown) => void): () => void
        onAction(callback: (action: unknown) => void): () => void
      }
      taskbar?: {
        update(state: {
          isPlaying: boolean
          canPlayOrPause?: boolean
          canPrevious?: boolean
          canNext?: boolean
          title?: string
          artist?: string
        }): Promise<void>
        onAction(callback: (action: 'togglePlay' | 'previous' | 'next') => void): () => void
      }
      miniPlayer?: {
        open(options?: { mode?: 'normal' | 'attached' | 'expanded' }): Promise<void>
        close(): Promise<void>
        restoreMain(): Promise<void>
        setMode(mode: 'normal' | 'attached' | 'expanded'): Promise<void>
        getState(): Promise<{ visible: boolean; mode: string; windowState: string }>
        getData(): Promise<unknown>
        updateData(data: unknown): Promise<void>
        sendAction(action: unknown): Promise<void>
        onData(callback: (data: unknown) => void): () => void
        onState(callback: (state: unknown) => void): () => void
        onAction(callback: (action: unknown) => void): () => void
      }
      plugins?: {
        listInstalled(): Promise<
          Array<{ id: string; version: string; manifest: unknown; dirName: string }>
        >
        install(
          pluginId: string,
          files: Record<string, string>,
        ): Promise<{ ok: boolean; pluginId: string; path?: string }>
        uninstall(pluginId: string): Promise<{ ok: boolean; message?: string }>
      }
    }
  }
}

const APP_VERSION = '0.0.0'

/**
 * Development build or shipped build.
 *
 * Read from how the renderer was loaded: Vite serves it over http in dev
 * (`loadURL`), a packaged app is opened from disk (`loadFile`). No build-time
 * define is involved, which matters because a sandboxed renderer has no
 * `process` to read one from — and because the answer stays right if the
 * bundler changes.
 */
function isDevelopment(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:'
}

function isDebug(): boolean {
  return Boolean(
    window.BBeBee?.isDebug ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))
  )
}

/** Electron's `process.platform`, as the protocol names it. */
function hostPlatform(): 'macos' | 'windows' | 'linux' {
  const raw = window.BBeBee?.platform ?? 'linux'
  return raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : 'linux'
}

/**
 * What the renderer can actually decode.
 *
 * Chromium's list, asked rather than assumed — `ctx.codec` reads tags and does
 * not decode, so it cannot know this on its own, and the scanner reports what
 * it could not import rather than skipping it silently (docs/04 §13).
 */
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
  const supported = candidates.filter(([, mime]) => probe.canPlayType(mime) !== '').map(([name]) => name)
  for (const extra of ['alac', 'wma', 'ape', 'wv', 'dsf', 'dff', 'm4b']) {
    if (!supported.includes(extra)) supported.push(extra)
  }
  return supported
}

export interface DesktopAudioConfig {
  initialEngine?: 'mpv' | 'wasapi' | 'webaudio'
  initialAudioExclusive?: boolean
  fetchBytes: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
}

export class DesktopAudioService extends Service implements AudioService {
  static inject = []

  private activeEngineKey: 'mpv' | 'wasapi' | 'webaudio' = 'webaudio'
  private activeEngine!: AudioService
  private activeFiber?: Fiber
  /** The last effect chain serialized for the native engine (mpv). */
  private lastNativeAf?: string
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
    // The dsp plugin serializes the enabled effect chain for the native
    // engine; forward it over the bridge (no service dependency — the event
    // carries the composed string).
    this.ctx.on('dsp/af-changed', (e) => {
      this.lastNativeAf = e.af
      if (this.activeEngineKey === 'mpv' && this.config.bridgeCall) {
        void this.config.bridgeCall('audio', 'mpvSetDspConfig', [
          {
            af: e.af,
            replaygain: e.replaygain,
            replaygainClip: e.replaygainClip,
            replaygainPreamp: e.replaygainPreamp,
            replaygainFallback: e.replaygainFallback,
          },
        ]).catch(() => {})
      }
    })

    const target = this.config.initialEngine ?? 'mpv'
    await this.mountEngine(target)

    return async () => {
      this.ctx.logger?.info('desktop-audio: disposing desktop audio service')
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

  get activeEngineName(): 'mpv' | 'wasapi' | 'webaudio' {
    return this.activeEngineKey
  }

  get engine(): 'mpv' | 'wasapi' | 'webaudio' {
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
    if (this.config.bridgeCall) {
      await this.config.bridgeCall('audio', 'mpvSetAudioExclusive', [exclusive]).catch(() => {})
    }
    if (this.activeEngine && typeof (this.activeEngine as unknown as { setAudioExclusive?: (e: boolean) => Promise<void> }).setAudioExclusive === 'function') {
      await (this.activeEngine as unknown as { setAudioExclusive: (e: boolean) => Promise<void> }).setAudioExclusive(exclusive).catch(() => {})
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

  /** Publish a platform interruption through the active engine. */
  emitInterruption(e: InterruptionEvent): void {
    this.activeEngine?.emitInterruption(e)
  }

  /** Publish a route change through the active engine. */
  emitRouteChange(e: RouteChangeEvent): void {
    this.activeEngine?.emitRouteChange(e)
  }

  private dispatchInterruption(e: InterruptionEvent): void {
    for (const listener of this.interruptionListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('desktop-audio: interruption listener error: %s', String(err))
      }
    }
  }

  private dispatchRouteChange(e: RouteChangeEvent): void {
    for (const listener of this.routeListeners) {
      try {
        listener(e)
      } catch (err) {
        this.ctx.logger?.error('desktop-audio: route change listener error: %s', String(err))
      }
    }
  }

  private async mountEngine(engineKey: 'mpv' | 'wasapi' | 'webaudio'): Promise<void> {
    this.ctx.logger?.info('desktop-audio: mounting backend engine [%s]', engineKey)
    const scoped = this.ctx.isolate('audio')

    let fiber: Fiber
    const effectiveKey = engineKey === 'wasapi' ? 'mpv' : engineKey
    try {
      if (effectiveKey === 'mpv') {
        const mpvConfig: AudioMpvConfig = {
          bridgeCall: this.config.bridgeCall,
          emitContextInterruptions: true,
        }
        fiber = await scoped.plugin(AudioMpv, mpvConfig)
      } else {
        const webAudioConfig: AudioWebAudioConfig = {
          fetchBytes: this.config.fetchBytes,
          bridgeCall: this.config.bridgeCall,
          emitContextInterruptions: true,
        }
        fiber = await scoped.plugin(AudioWebAudio, webAudioConfig)
      }
    } catch (err) {
      if (effectiveKey === 'mpv') {
        this.ctx.logger?.warn('desktop-audio: failed mounting mpv, falling back to webaudio: %s', String(err))
        return this.mountEngine('webaudio')
      }
      throw err
    }

    // The engine instance is read from the mounted fiber's store, where
    // `provide` recorded it: `scoped.audio` resolves up the fiber chain and
    // finds this wrapper's own 'audio' instead, so delegating to it would
    // recurse through setVolume/setMuted until the stack overflows.
    let mounted: AudioService | undefined
    try {
      mounted = (fiber as unknown as { store?: Record<string, { value?: AudioService }> })
        .store?.audio?.value
      if (!mounted || mounted === this) {
        throw new Error('the mounted fiber did not provide an audio service')
      }
    } catch (err) {
      // A mount failure must never take the app down: the webaudio engine has
      // no native dependencies and always mounts.
      this.ctx.logger?.warn('desktop-audio: engine [%s] unusable (%s), falling back to webaudio', engineKey, String(err))
      if (effectiveKey === 'mpv') return this.mountEngine('webaudio')
      throw err
    }
    this.activeEngine = mounted
    this.activeFiber = fiber
    this.activeEngineKey = engineKey

    // Bind event propagation
    this.offActiveInterruption?.()
    this.offActiveRoute?.()
    this.offActiveInterruption = this.activeEngine.onInterruption((e) => this.dispatchInterruption(e))
    this.offActiveRoute = this.activeEngine.onRouteChange((e) => this.dispatchRouteChange(e))

    // Restore volume and device preferences
    this.activeEngine.setVolume(this.currentVolume)
    this.activeEngine.setMuted(this.currentMuted)
    if (this.currentDeviceId && this.currentDeviceId !== 'default') {
      await this.activeEngine.setOutputDevice(this.currentDeviceId).catch(() => {})
    }
    // The native engine starts with a clean filter chain — push the effect
    // chain the dsp plugin already serialized (no-op for webaudio).
    if (effectiveKey === 'mpv' && this.lastNativeAf !== undefined && this.config.bridgeCall) {
      void this.config.bridgeCall('audio', 'mpvSetDspConfig', [{ af: this.lastNativeAf }]).catch(() => {})
    }
    if (effectiveKey === 'mpv' && this.currentAudioExclusive && this.config.bridgeCall) {
      void this.config.bridgeCall('audio', 'mpvSetAudioExclusive', [this.currentAudioExclusive]).catch(() => {})
    }
  }

  async switchEngine(targetEngine: 'mpv' | 'wasapi' | 'webaudio'): Promise<void> {
    if (this.isSwitching) {
      this.ctx.logger?.warn('desktop-audio: switchEngine already in progress, skipping')
      return
    }
    if (this.activeEngineKey === targetEngine) {
      this.ctx.logger?.info('desktop-audio: already running engine [%s], no switch needed', targetEngine)
      return
    }

    this.isSwitching = true
    this.ctx.logger?.info(
      'desktop-audio: switching audio backend from [%s] to [%s]',
      this.activeEngineKey,
      targetEngine,
    )

    try {
      // 1. Dip volume smoothly to avoid clicks
      try {
        await this.dipVolume(20)
      } catch {
        // ignore
      }

      // 2. Unbind active engine listeners
      this.offActiveInterruption?.()
      this.offActiveInterruption = undefined
      this.offActiveRoute?.()
      this.offActiveRoute = undefined

      // 3. Dispose old fiber and context
      if (this.activeFiber) {
        await this.activeFiber.dispose().catch((err) => {
          this.ctx.logger?.warn('desktop-audio: failed disposing previous fiber: %s', String(err))
        })
        this.activeFiber = undefined
      }

      // 4. Mount target engine
      await this.mountEngine(targetEngine)

      this.ctx.logger?.info('desktop-audio: successfully switched backend to [%s]', targetEngine)

      // 5. Emit 'audio/engine-changed' so DSP, Visualizer, and Player can synchronize with new AudioContext
      this.ctx.emit('audio/engine-changed', { engine: targetEngine })
    } finally {
      this.isSwitching = false
    }
  }
}

function createAudioFetchBytes(
  transport?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return async (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => {
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
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        } catch {
          // Fall through to window.fetch if bridge readBytes rejects
        }
      }
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        const response = await window.fetch(src, { signal: opts?.signal })
        if (!response.ok) throw new Error(`audio: ${response.status} loading ${src}`)
        return response.arrayBuffer()
      }
    }
    const fetchFn = transport ?? fetch
    const response = await fetchFn(src, { headers: opts?.headers, signal: opts?.signal })
    if (!response.ok) throw new Error(`audio: ${response.status} loading ${src}`)
    return response.arrayBuffer()
  }
}

export async function boot(): Promise<App> {
  // Resolved once: the bridge is either there or it is not.
  const keychain = safeStorageCodec()

  // Paths are fetched once, up front: `PathsService` promises synchronous
  // access and IPC cannot provide it.
  const pathSnapshot = await fetchPaths()

  /*
   * HTTP runs in `main`.
   *
   * The renderer is a browser context: cross-origin requests need the
   * server's permission and `Cookie`/`Range`/`User-Agent` cannot be set. A
   * music server run by a stranger grants none of that, so without this every
   * imported source fails for a reason that has nothing to do with the source
   * (docs/02 §2, docs/11 §4.5). `undefined` — an older preload — falls back to
   * the renderer's own `fetch`, which is worse but is not a boot failure.
   */
  const transport = bridgeFetch()

  // Determine initial audio engine: check persisted settings in store.json.
  // mpv is the default on every platform: the packaged build ships the engine
  // binary with libmpv staged, and a machine where libmpv is missing degrades
  // per load to the media element (Chromium decode) instead of going silent.
  let initialEngine: 'mpv' | 'wasapi' | 'webaudio' = 'mpv'
  let initialAudioExclusive: boolean | undefined
  let preloadedUserAgent: string | undefined
  let preloadedStoreData: Record<string, unknown> | undefined
  try {
    const storeUri = `${pathSnapshot.appData}/store.json`
    const raw = await window.BBeBeeBridge?.call('fs', 'readFile', [storeUri])
    if (raw && typeof raw === 'string') {
      preloadedStoreData = JSON.parse(raw) as Record<string, unknown>
      // StoreFs namespaces plugin writes by package name, so the settings
      // plugin's preferences live under `@BBeBee/plugin-settings:preferences`
      // on disk — a bare `preferences` key never exists. Read both so the
      // engine choice survives the very first mount instead of applying only
      // through the post-boot settings sync.
      const prefs = (preloadedStoreData['preferences'] ??
        preloadedStoreData['@BBeBee/plugin-settings:preferences']) as
        | { audioOutputEngine?: 'mpv' | 'wasapi' | 'webaudio'; audioExclusive?: boolean; userAgent?: string }
        | undefined
      if (prefs?.audioOutputEngine === 'mpv' || prefs?.audioOutputEngine === 'wasapi' || prefs?.audioOutputEngine === 'webaudio') {
        initialEngine = prefs.audioOutputEngine === 'wasapi' ? 'mpv' : prefs.audioOutputEngine
      }
      if (typeof prefs?.audioExclusive === 'boolean') {
        initialAudioExclusive = prefs.audioExclusive
      }
      if (typeof prefs?.userAgent === 'string') preloadedUserAgent = prefs.userAgent
    }
  } catch {
    // fallback to platform default
  }

  const externalRegistry = await loadExternalPluginRegistry().catch(() => ({}))
  const compositeRegistry = {
    ...getBuiltinPluginRegistry(),
    ...externalRegistry,
  }

  const app = createApp({
    target: 'desktop',
    bootstrap: [
      [PathsBridge, pathSnapshot],
      FsBridge,
      [StoreFs, { initialData: preloadedStoreData }],
      DbBridge,
      // The OS-facing trio. Each degrades to "no OS surface" rather than
      // throwing when the platform does not provide one, so a Linux box with
      // no MPRIS daemon still boots (docs/11 §4.3, §4.4).
      [DeviceElectron, { appVersion: APP_VERSION, platform: hostPlatform() }],
      BackgroundElectron,
      MediaSessionElectron,
      /*
       * The keychain where there is one.
       *
       * ⚠️ Without a codec the store falls back to XOR against a path-derived
       * key — obfuscation, not protection — and `isHardwareBacked` reports
       * false so nothing downstream mistakes it for more. Passing
       * `safeStorage` here is what makes the desktop guarantee real rather
       * than documented.
       *
       * Before `HttpNode`, because the jar store is built from it: cookies are
       * credential material and are envelope-encrypted under a key that lives
       * in the credential store (docs/04 §2.1).
       */
      [SecretsNode, keychain ? { crypto: keychain } : {}],
      JsQuickJsNode,

      /*
       * The M1 platform floor.
       *
       * ⚠️ These are bootstrap entries rather than registry ones even though
       * they carry manifests, because the services they provide are required
       * — not optional — for the feature plugins above them: `plugin-player`
       * injects `audio`, `plugin-local-scanner` injects `codec`, and
       * `plugin-source-runtime` injects `http`. A required dependency that
       * arrives through the same allowlist as the thing depending on it can be
       * switched off from the wrong end, and the symptom is a fiber that sits
       * PENDING with no obvious cause.
       */
      [CodecNode, { supportedFormats: decodableFormats() }],
      /*
       * The UA arrives preloaded because the first source request can happen
       * before the settings service finishes loading; `setUserAgent` below
       * keeps it in step from then on. Empty string = the built-in default.
       */
      [HttpNode, {
        ...(transport ? { fetch: transport } : {}),
        ...(preloadedUserAgent ? { userAgent: preloadedUserAgent } : {}),
      }],
      /*
       * `ctx.audio`. Desktop switchable audio service:
       * Supports hot-switching between the two Web Audio engines driven by
       * settings. Output is shared mode; the engines differ in decoding.
       */
      [
        DesktopAudioService,
        {
          initialEngine,
          initialAudioExclusive,
          bridgeCall: window.BBeBeeBridge?.call,
          fetchBytes: createAudioFetchBytes(transport),
        },
      ],

      /*
       * The logs layer — Layer 3, and it sits here for the reason the layer
       * exists: after the core services it writes through, before every
       * feature plugin whose lines it must not miss (docs/09 §1).
       *
       * A transport loaded from the registry alongside the features would be
       * subscribing to `ctx.logger` *while* they start, and the lines lost
       * that way are exactly the ones worth having — a scanner that failed on
       * its first pass, a source that would not initialise.
       *
       * Which transports run is the shell's call, and the split is the one
       * docs/04 §16 describes: the buffer always, because the in-app log
       * viewer and a crash report read from it; the console only in
       * development, where someone is watching it; the file only in a shipped
       * build, where nobody is and the log has to survive being closed.
       */
      [logBuffer, {}],
      ...(isDevelopment()
        ? ([[logConsole, { level: 3, debug: isDebug() }]] as const)
        : ([[logFile, { level: 2 }]] as const)),
    ],
    registry: compositeRegistry,
    config: { plugins: INITIAL_ENABLED },
  })
  await app.start()

  /*
   * Every core service this shell claims to provide must actually be there.
   *
   * ⚠️ This is the check whose absence let the desktop build ship without
   * `ctx.audio`, `ctx.codec` or `ctx.http`: `plugin-player` was commented out,
   * the scanner and the source runtime sat PENDING, and nothing said so — the
   * app started, drew a library screen, and could not play a note. A fiber
   * waiting forever for a service that will never arrive is indistinguishable
   * from one that is merely slow, so the only place to catch it is here, where
   * the list of what was registered is known.
   */
  await app.ready([...BOOTSTRAP_SERVICES], { timeoutMs: 15_000 })

  // Sync closeToTray, proxy, audio engine, audio output device, and User-Agent
  // preference. ⚠️ Every service touched below must be in the inject list: the
  // scoped proxy refuses anything else, and a throw here aborts the synchronous
  // emit — every later `settings/changed` listener would silently stop hearing
  // updates (this is how the settings page stopped re-rendering once).
  app.ctx.inject(['settings', 'audio', 'http'], (scoped) => {
    const syncSettings = (s: AppSettings | undefined) => {
      if (!s) return
      if (s.closeToTray !== undefined) {
        void window.BBeBee?.window?.setCloseToTray?.(s.closeToTray)
      }
      if (s.proxy) {
        void window.BBeBee?.proxy?.set?.(s.proxy)
      }
      if (s.audioOutputEngine && typeof scoped.audio?.switchEngine === 'function') {
        const currentActive = scoped.audio.activeEngineName
        if (currentActive && currentActive !== s.audioOutputEngine) {
          scoped.logger?.info(
            'boot: switching audio engine to "%s" per settings',
            s.audioOutputEngine,
          )
          void scoped.audio.switchEngine(s.audioOutputEngine).catch((err) => {
            scoped.logger?.error('boot: failed to switch audio engine: %s', String(err))
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

    void scoped.settings.get().then(syncSettings)
    scoped.on('settings/changed', syncSettings)
  })

  return app
}
