/**
 * Tauri Preload Shim for BBeBee Desktop (TypeScript).
 *
 * Exposes frozen objects `window.BBeBee` and `window.BBeBeeBridge` with 100% 1:1
 * API compatibility with the desktop host surface specification.
 * Available for webview runtime and test environments.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BBeBeePathsApi {
  get(kind: string): Promise<string | undefined>
}

export interface BBeBeeSecretsApi {
  available(): Promise<boolean>
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
}

export interface BBeBeeShellApi {
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<string>
}

export interface BBeBeeDialogApi {
  pickDirectory(): Promise<string | undefined>
  pickFiles(options?: { extensions?: string[] }): Promise<string[]>
}

export interface BBeBeeFilesApi {
  getPath(file: File): string
  authorizePath(path: string): Promise<boolean>
  /**
   * Map a `bbebee-file://` URI to the URL form the current webview can load.
   * On Windows the custom scheme is served over `http://bbebee-file.localhost`
   * (WebView2 cannot resolve custom schemes natively); elsewhere the URI is
   * returned unchanged. Non-`bbebee-file:` inputs pass through untouched.
   */
  toServableUrl(uri: string): string
}

export interface BBeBeeDevtoolsApi {
  open(): Promise<void>
}

export interface BBeBeePluginsApi {
  listInstalled(): Promise<
    Array<{ id: string; version: string; manifest: unknown; dirName: string; sha256?: string }>
  >
  getLock(): Promise<unknown>
  install(
    pluginId: string,
    files: Record<string, string>,
  ): Promise<{ ok: boolean; pluginId: string; path?: string }>
  uninstall(pluginId: string): Promise<{ ok: boolean; message?: string }>
}

export interface BBeBeeWindowApi {
  minimize(): Promise<void>
  maximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  setCloseToTray(enabled: boolean): Promise<void>
  toggle(): Promise<void>
}

export interface BBeBeeProxyApi {
  test(config: unknown): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  set(config: unknown): Promise<void>
}

export interface BBeBeeStreamApi {
  setHeaders(entry: { url: string; headers: Record<string, string> }): Promise<void>
}

export interface BBeBeeAudioTranscodeOptions {
  jobId?: string
  inputUri: string
  outputUri: string
  targetFormat: string
  bitrate?: string
  sampleRate?: number
  channels?: number
  bitDepth?: number
  vbr?: boolean
  quality?: number
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
  startTimeSeconds?: number
  endTimeSeconds?: number
  signal?: AbortSignal
  onProgress?: (progress: number, currentTimeSeconds: number) => void
}

export interface BBeBeeAudioApi {
  cancelTranscode(jobId: string): Promise<boolean>
  transcode(
    options: BBeBeeAudioTranscodeOptions,
    onProgressCallback?: (progress: number, currentTimeSeconds: number) => void,
  ): Promise<{ ok: boolean; error?: string }>
}

export interface BBeBeeDesktopLyricsApi {
  setVisible(visible: boolean, pos?: { x: number; y: number }): Promise<void>
  setPosition(pos: { x: number; y: number }): Promise<void>
  getPosition(): Promise<{ x: number; y: number } | undefined>
  commitPosition(pos: { x: number; y: number }): Promise<void>
  getData(): Promise<unknown>
  onMoved(callback: (pos: { x: number; y: number }) => void): () => void
  setLocked(locked: boolean): Promise<void>
  setIgnoreMouse(ignore: boolean): Promise<void>
  onCursor(callback: (pos: { x: number; y: number }) => void): () => void
  updateData(data: unknown): Promise<void>
  sendAction(action: unknown): Promise<void>
  onData(callback: (data: unknown) => void): () => void
  onAction(callback: (action: unknown) => void): () => void
}

export interface BBeBeeTaskbarApi {
  update(state: unknown): Promise<void>
  onAction(callback: (action: 'togglePlay' | 'previous' | 'next') => void): () => void
}

export interface BBeBeeMiniPlayerApi {
  open(options?: unknown): Promise<void>
  close(): Promise<void>
  restoreMain(): Promise<void>
  setMode(mode: unknown): Promise<void>
  getState(): Promise<unknown>
  getData(): Promise<unknown>
  updateData(data: unknown): Promise<void>
  sendAction(action: unknown): Promise<void>
  onData(callback: (data: unknown) => void): () => void
  onState(callback: (state: unknown) => void): () => void
  onAction(callback: (action: unknown) => void): () => void
}

export interface BBeBeeLocaleApi {
  getLocale(): Promise<string>
  notify(locale: string): Promise<void>
  onLocaleChange(callback: (locale: string) => void): () => void
}

export interface BBeBeeSandboxApi {
  setHtml(id: string, html: string): Promise<void>
}

export interface BBeBeeVersions {
  tauri: string
  webview: string
  node?: string
}

export interface BBeBeeApi {
  readonly paths: BBeBeePathsApi
  readonly getAppVersion: () => Promise<string>
  readonly secrets: BBeBeeSecretsApi
  readonly shell: BBeBeeShellApi
  readonly dialog: BBeBeeDialogApi
  readonly files: BBeBeeFilesApi
  readonly devtools: BBeBeeDevtoolsApi
  readonly plugins: BBeBeePluginsApi
  readonly window: BBeBeeWindowApi
  readonly proxy: BBeBeeProxyApi
  readonly stream: BBeBeeStreamApi
  readonly audio: BBeBeeAudioApi
  readonly desktopLyrics: BBeBeeDesktopLyricsApi
  readonly taskbar: BBeBeeTaskbarApi
  readonly miniPlayer: BBeBeeMiniPlayerApi
  readonly platform: 'linux' | 'darwin' | 'win32'
  readonly locale: BBeBeeLocaleApi
  readonly sandbox: BBeBeeSandboxApi
  readonly versions: BBeBeeVersions
  readonly isDebug: boolean
}

export interface BBeBeeBridgeApi {
  call(service: string, method: string, args: unknown[], token?: string): Promise<unknown>
  streamOpen(uri: string, range?: { start: number; end?: number }): Promise<number>
  streamPull(handle: number): Promise<Uint8Array | null>
  streamClose(handle: number): Promise<void>
  httpOpen(request: unknown): Promise<unknown>
  httpPull(handle: number): Promise<Uint8Array | null>
  httpClose(handle: number): Promise<void>
  txBegin(): Promise<string>
  txEnd(token: string, commit: boolean): Promise<void>
  on(handler: (event: unknown) => void): () => void
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
    }
    __TAURI__?: {
      core?: {
        invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
      }
      event?: {
        listen<T = unknown>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>
      }
    }
    __BBEBEE_DEBUG__?: boolean
  }
}

export function deserializeBridgeError(data: any): Error {
  const err = new Error(data?.message || 'Bridge call failed')
  if (data) {
    if (data.name) err.name = data.name
    if (data.code) (err as any).code = data.code
    if (data.errno !== undefined) (err as any).errno = data.errno
    if (data.syscall) (err as any).syscall = data.syscall
    if (data.path) (err as any).path = data.path
    if (data.stack) err.stack = data.stack
  }
  return err
}

export function unwrapBridgeResult<T = unknown>(response: unknown): T {
  if (response && typeof response === 'object' && '__bbebee_bridge__' in response) {
    const env = response as unknown as { ok: boolean; result?: T; error?: any }
    if (!env.ok) {
      throw deserializeBridgeError(env.error ?? { message: 'Bridge call failed' })
    }
    return env.result as T
  }
  return response as T
}

export function normalizeBridgeBytes(val: unknown): Uint8Array | null {
  if (val === null || val === undefined) return null
  if (val instanceof Uint8Array) return val
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
  }
  if (val instanceof ArrayBuffer) {
    return new Uint8Array(val)
  }
  if (typeof val === 'string') {
    try {
      const bin = atob(val)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return arr
    } catch {
      return new TextEncoder().encode(val)
    }
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj['type'] === 'Buffer' && Array.isArray(obj['data'])) {
      return new Uint8Array(obj['data'] as number[])
    }
    if (Array.isArray(val)) {
      return new Uint8Array(val)
    }
    const len = typeof obj['length'] === 'number' ? obj['length'] : Object.keys(obj).length
    if (len === 0) return new Uint8Array(0)
    if (typeof obj[0] === 'number' || typeof obj['0'] === 'number') {
      const arr = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        arr[i] = Number(obj[i])
      }
      return arr
    }
  }
  return null
}

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key]
    if (val !== null && (typeof val === 'object' || typeof val === 'function') && !Object.isFrozen(val)) {
      deepFreeze(val)
    }
  }
  return obj
}

export type TauriInvoker = (cmd: string, args?: Record<string, unknown>) => Promise<any>
export type TauriListener = (eventName: string, callback: (payload: any) => void) => () => void

export function defaultInvoker(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const w = typeof window !== 'undefined' ? (window as any) : undefined
  if (w?.__TAURI_INTERNALS__?.invoke) {
    return w.__TAURI_INTERNALS__.invoke(cmd, args)
  }
  if (w?.__TAURI__?.core?.invoke) {
    return w.__TAURI__.core.invoke(cmd, args)
  }
  return Promise.resolve()
}

export function defaultListener(eventName: string, callback: (payload: any) => void): () => void {
  let disposed = false
  let unlistenFn: (() => void) | null = null

  const w = typeof window !== 'undefined' ? (window as any) : undefined
  if (w?.__TAURI__?.event?.listen) {
    w.__TAURI__.event
      .listen(eventName, (event: { payload: any }) => {
        if (!disposed) callback(event.payload)
      })
      .then((unlisten: () => void) => {
        if (disposed) {
          unlisten()
        } else {
          unlistenFn = unlisten
        }
      })
      .catch(() => {})
  } else if (typeof window !== 'undefined') {
    const domHandler = (e: Event) => {
      if (!disposed) callback((e as CustomEvent).detail)
    }
    window.addEventListener(eventName, domHandler)
    unlistenFn = () => {
      window.removeEventListener(eventName, domHandler)
    }
  }

  return () => {
    disposed = true
    if (unlistenFn) {
      unlistenFn()
    }
  }
}

export function createPreloadApi(
  invoke: TauriInvoker = defaultInvoker,
  addListener: TauriListener = defaultListener,
): BBeBeeApi {
  const isDebugMode = (() => {
    if (typeof process !== 'undefined' && process.env) {
      const val = process.env['DEBUG'] ?? process.env['BBEBEE_DEBUG']
      if (val === '0' || val === 'false') return false
      if (val) return true
      if (process.argv?.includes?.('--debug')) return true
      if (process.env['TAURI_ENV_DEBUG'] || process.env['VITE_DEV_SERVER_URL']) return true
    }
    if (typeof window !== 'undefined' && (window as any).__BBEBEE_DEBUG__) return true
    return false
  })()

  const detectedPlatform = ((): 'linux' | 'darwin' | 'win32' => {
    if (typeof process !== 'undefined' && process.platform) {
      const p = process.platform
      if (p === 'win32' || p === 'darwin') return p
      return 'linux'
    }
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase()
      if (ua.includes('win')) return 'win32'
      if (ua.includes('mac')) return 'darwin'
      return 'linux'
    }
    return 'linux'
  })()

  const api: BBeBeeApi = {
    paths: {
      get: (kind: string): Promise<string | undefined> =>
        invoke('desktop_paths_get', { kind }).then((res) => (res === null ? undefined : res)),
    },
    getAppVersion: (): Promise<string> =>
      invoke('desktop_app_version').then((res) => (typeof res === 'string' ? res : '0.0.0')),
    secrets: {
      available: (): Promise<boolean> =>
        invoke('desktop_secrets_available').then((res) => (typeof res === 'boolean' ? res : true)),
      encrypt: (plain: string): Promise<string> => invoke('desktop_secrets_encrypt', { plain }),
      decrypt: (cipher: string): Promise<string> => invoke('desktop_secrets_decrypt', { cipher }),
    },
    shell: {
      openExternal: (url: string): Promise<void> => invoke('desktop_shell_open_external', { url }),
      openPath: (path: string): Promise<string> =>
        invoke('desktop_shell_open_path', { path }).then((res) => (typeof res === 'string' ? res : '')),
    },
    dialog: {
      pickDirectory: (): Promise<string | undefined> =>
        invoke('desktop_dialog_pick_directory').then((res) => res || undefined),
      pickFiles: (options?: { extensions?: string[] }): Promise<string[]> =>
        invoke('desktop_dialog_pick_files', { options }).then((res) => (Array.isArray(res) ? res : [])),
    },
    files: {
      getPath: (file: File): string => {
        try {
          const p =
            (file as any)?.path ||
            (typeof (window as any)?.webUtils?.getPathForFile === 'function'
              ? (window as any).webUtils.getPathForFile(file)
              : '')
          if (p) {
            void invoke('desktop_files_authorize', { path: p }).catch(() => {})
          }
          return p || ''
        } catch {
          return ''
        }
      },
      authorizePath: (path: string): Promise<boolean> =>
        invoke('desktop_files_authorize', { path }).then((res) => (typeof res === 'boolean' ? res : true)),
      toServableUrl: (uri: string): string => {
        try {
          if (typeof uri !== 'string' || !uri.startsWith('bbebee-file:')) return uri
          // WebView2 (Windows) cannot resolve custom schemes natively: wry serves
          // them over http://{scheme}.localhost and intercepts those requests,
          // so the webview must use the workaround form. WKWebView (macOS) and
          // WebKitGTK (Linux) handle the scheme natively — leave it untouched.
          if (detectedPlatform !== 'win32') return uri
          const rest = uri
            .replace(/^bbebee-file:/, '')
            .replace(/^\/+/, '')
            .replace(/^localhost\//, '')
          return `http://bbebee-file.localhost/${rest}`
        } catch {
          return uri
        }
      },
    },
    devtools: {
      open: (): Promise<void> => invoke('desktop_devtools_open'),
    },
    plugins: {
      listInstalled: (): Promise<
        Array<{ id: string; version: string; manifest: unknown; dirName: string; sha256?: string }>
      > => invoke('desktop_plugins_list_installed').then((res) => (Array.isArray(res) ? res : [])),
      getLock: (): Promise<unknown> => invoke('desktop_plugins_get_lock'),
      install: (
        pluginId: string,
        files: Record<string, string>,
      ): Promise<{ ok: boolean; pluginId: string; path?: string }> =>
        invoke('desktop_plugins_install', { pluginId, files }),
      uninstall: (pluginId: string): Promise<{ ok: boolean; message?: string }> =>
        invoke('desktop_plugins_uninstall', { pluginId }),
    },
    window: {
      minimize: (): Promise<void> => invoke('desktop_window_minimize'),
      maximize: (): Promise<void> => invoke('desktop_window_maximize'),
      close: (): Promise<void> => invoke('desktop_window_close'),
      isMaximized: (): Promise<boolean> =>
        invoke('desktop_window_is_maximized').then((res) => Boolean(res)),
      setCloseToTray: (enabled: boolean): Promise<void> =>
        invoke('desktop_window_set_close_to_tray', { enabled: Boolean(enabled) }),
      toggle: (): Promise<void> => invoke('desktop_window_toggle'),
    },
    proxy: {
      test: (config: unknown): Promise<{ ok: boolean; latencyMs?: number; error?: string }> =>
        invoke('desktop_proxy_test', { config }),
      set: (config: unknown): Promise<void> => invoke('desktop_proxy_set', { config }),
    },
    stream: {
      setHeaders: (entry: { url: string; headers: Record<string, string> }): Promise<void> =>
        invoke('desktop_stream_set_headers', { entry }),
    },
    audio: {
      cancelTranscode: (jobId: string): Promise<boolean> =>
        invoke('desktop_audio_transcode_cancel', { jobId }).then((res) =>
          typeof res === 'boolean' ? res : true,
        ),
      transcode: (
        options: BBeBeeAudioTranscodeOptions,
        onProgressCallback?: (progress: number, currentTimeSeconds: number) => void,
      ): Promise<{ ok: boolean; error?: string }> => {
        if (options.signal?.aborted) {
          return Promise.resolve({ ok: false, error: 'Cancelled' })
        }

        const jobId = options.jobId || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        const payload = {
          jobId,
          inputUri: String(options.inputUri),
          outputUri: String(options.outputUri),
          targetFormat: String(options.targetFormat),
          bitrate: options.bitrate ? String(options.bitrate) : undefined,
          sampleRate: typeof options.sampleRate === 'number' ? options.sampleRate : undefined,
          channels: typeof options.channels === 'number' ? options.channels : undefined,
          bitDepth: typeof options.bitDepth === 'number' ? options.bitDepth : undefined,
          vbr: typeof options.vbr === 'boolean' ? options.vbr : undefined,
          quality: typeof options.quality === 'number' ? options.quality : undefined,
          vbrQuality: typeof options.vbrQuality === 'number' ? options.vbrQuality : undefined,
          volumeGainDb: typeof options.volumeGainDb === 'number' ? options.volumeGainDb : undefined,
          fadeInSeconds: typeof options.fadeInSeconds === 'number' ? options.fadeInSeconds : undefined,
          fadeOutSeconds: typeof options.fadeOutSeconds === 'number' ? options.fadeOutSeconds : undefined,
          startTimeSeconds: typeof options.startTimeSeconds === 'number' ? options.startTimeSeconds : undefined,
          endTimeSeconds: typeof options.endTimeSeconds === 'number' ? options.endTimeSeconds : undefined,
        }

        const progressCb =
          typeof onProgressCallback === 'function'
            ? onProgressCallback
            : typeof options.onProgress === 'function'
              ? options.onProgress
              : undefined

        let cleanupProgress: (() => void) | undefined
        if (typeof progressCb === 'function') {
          cleanupProgress = addListener('audio:transcode-progress', (data: any) => {
            if (data && data.jobId === jobId) {
              try {
                progressCb(data.progress, data.currentTimeSeconds)
              } catch {
                // ignore
              }
            }
          })
        }

        let cleanupAbort: (() => void) | undefined
        if (options.signal && typeof options.signal.addEventListener === 'function') {
          const abortHandler = () => {
            void invoke('desktop_audio_transcode_cancel', { jobId }).catch(() => {})
          }
          options.signal.addEventListener('abort', abortHandler, { once: true })
          cleanupAbort = () => {
            try {
              options.signal?.removeEventListener('abort', abortHandler)
            } catch {
              // ignore
            }
          }
        }

        return invoke('desktop_audio_transcode', { options: payload })
          .then((res: any) => res || { ok: true })
          .finally(() => {
            cleanupProgress?.()
            cleanupAbort?.()
          })
      },
    },
    desktopLyrics: {
      setVisible: (visible: boolean, pos?: { x: number; y: number }): Promise<void> =>
        invoke('desktop_lyrics_set_visible', { visible: Boolean(visible), position: pos }),
      setPosition: (pos: { x: number; y: number }): Promise<void> =>
        invoke('desktop_lyrics_set_position', { position: pos }),
      getPosition: (): Promise<{ x: number; y: number } | undefined> =>
        invoke('desktop_lyrics_get_position').then((res) => res || undefined),
      commitPosition: (pos: { x: number; y: number }): Promise<void> =>
        invoke('desktop_lyrics_commit_position', { position: pos }),
      getData: (): Promise<unknown> => invoke('desktop_lyrics_get_data'),
      onMoved: (callback: (pos: { x: number; y: number }) => void): (() => void) =>
        addListener('desktop-lyrics:moved', callback),
      setLocked: (locked: boolean): Promise<void> =>
        invoke('desktop_lyrics_set_locked', { locked: Boolean(locked) }),
      setIgnoreMouse: (ignore: boolean): Promise<void> =>
        invoke('desktop_lyrics_set_ignore_mouse', { ignore: Boolean(ignore) }),
      onCursor: (callback: (pos: { x: number; y: number }) => void): (() => void) =>
        addListener('desktop-lyrics:cursor', callback),
      updateData: (data: unknown): Promise<void> =>
        invoke('desktop_lyrics_update_data', { data }),
      sendAction: (action: unknown): Promise<void> =>
        invoke('desktop_lyrics_send_action', { action }),
      onData: (callback: (data: unknown) => void): (() => void) =>
        addListener('desktop-lyrics:data', callback),
      onAction: (callback: (action: unknown) => void): (() => void) =>
        addListener('desktop-lyrics:action', callback),
    },
    taskbar: {
      update: (state: unknown): Promise<void> =>
        invoke('desktop_taskbar_update', { taskbar: state }),
      onAction: (callback: (action: 'togglePlay' | 'previous' | 'next') => void): (() => void) =>
        addListener('taskbar:action', callback),
    },
    miniPlayer: {
      open: (options?: unknown): Promise<void> =>
        invoke('desktop_mini_player_open', { options }),
      close: (): Promise<void> => invoke('desktop_mini_player_close'),
      restoreMain: (): Promise<void> => invoke('desktop_mini_player_restore_main'),
      setMode: (mode: unknown): Promise<void> =>
        invoke('desktop_mini_player_set_mode', { mode }),
      getState: (): Promise<unknown> => invoke('desktop_mini_player_get_state'),
      getData: (): Promise<unknown> => invoke('desktop_mini_player_get_data'),
      updateData: (data: unknown): Promise<void> =>
        invoke('desktop_mini_player_update_data', { data }),
      sendAction: (action: unknown): Promise<void> =>
        invoke('desktop_mini_player_send_action', { action }),
      onData: (callback: (data: unknown) => void): (() => void) =>
        addListener('mini-player:data', callback),
      onState: (callback: (state: unknown) => void): (() => void) =>
        addListener('mini-player:state', callback),
      onAction: (callback: (action: unknown) => void): (() => void) =>
        addListener('mini-player:action', callback),
    },
    platform: detectedPlatform,
    locale: {
      getLocale: (): Promise<string> =>
        invoke('desktop_locale_get').then((res) => (typeof res === 'string' ? res : 'en-US')),
      notify: (locale: string): Promise<void> => invoke('desktop_locale_notify', { locale }),
      onLocaleChange: (callback: (locale: string) => void): (() => void) =>
        addListener('locale:changed', callback),
    },
    sandbox: {
      setHtml: (id: string, html: string): Promise<void> =>
        invoke('desktop_sandbox_set_html', { id, html }),
    },
    versions: {
      tauri: '2.12.4',
      webview: '2.12.4',
      node: typeof process !== 'undefined' && process.versions?.node ? process.versions.node : '22.12.0',
    },
    isDebug: isDebugMode,
  }

  return deepFreeze(api)
}

export function createBridgeApi(
  invoke: TauriInvoker = defaultInvoker,
  addListener: TauriListener = defaultListener,
): BBeBeeBridgeApi {
  const bridge: BBeBeeBridgeApi = {
    call: async (service: string, method: string, args: unknown[], token?: string) => {
      const res = await invoke('desktop_bridge_call', {
        service,
        method,
        args: args || [],
        token,
      })
      return unwrapBridgeResult(res)
    },
    streamOpen: (uri: string, range?: { start: number; end?: number }) =>
      invoke('bridge_stream_open', { uri, range }),
    streamPull: (handle: number) =>
      invoke('bridge_stream_pull', { handle }).then((res) => {
        const unwrap = unwrapBridgeResult(res)
        return normalizeBridgeBytes(unwrap)
      }),
    streamClose: (handle: number) => invoke('bridge_stream_close', { handle }),
    httpOpen: async (request: unknown) => {
      const res = await invoke('bridge_http_open', { request })
      return unwrapBridgeResult(res)
    },
    httpPull: async (handle: number) => {
      const res = await invoke('bridge_http_pull', { handle })
      const unwrap = unwrapBridgeResult(res)
      return normalizeBridgeBytes(unwrap)
    },
    httpClose: (handle: number) => invoke('bridge_http_close', { handle }),
    txBegin: () => invoke('bridge_tx_begin'),
    txEnd: (token: string, commit: boolean) => invoke('bridge_tx_end', { token, commit }),
    on: (handler: (event: unknown) => void) => {
      return addListener('BBeBee:event', (payload: any) => {
        if (
          Array.isArray(payload) &&
          payload.length === 1 &&
          typeof payload[0] === 'object' &&
          payload[0] !== null &&
          'topic' in payload[0]
        ) {
          handler(payload[0])
        } else {
          handler(payload)
        }
      })
    },
  }

  return deepFreeze(bridge)
}

/**
 * Forward browser console output to the Rust logs.
 *
 * Mirrors the IIFE at the top of `src-tauri/src/shim.js`: patches
 * `console.error`/`console.warn` and listens for resource `error` events,
 * forwarding them via the `desktop_console_forward` Tauri command so they
 * appear in the terminal running `tauri dev` with a `[console]` prefix.
 *
 * Best-effort: never throws, never breaks the app if the Tauri IPC layer
 * is unavailable (plain browser, tests).
 */
export function forwardConsoleToRust(): void {
  try {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> }
      __TAURI__?: { core?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> } }
    }
    const send = (level: string, args: unknown[]): void => {
      try {
        const message = args
          .map((a) => {
            try {
              return typeof a === 'string' ? a : JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')
          .slice(0, 2000)
        const invoke =
          w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.core?.invoke
        if (typeof invoke === 'function') {
          void invoke('desktop_console_forward', { level, message })
        }
      } catch {
        // Never break the app because logging failed.
      }
    }

    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)
    console.error = (...args: unknown[]) => {
      send('error', args)
      origError(...args)
    }
    console.warn = (...args: unknown[]) => {
      send('warn', args)
      origWarn(...args)
    }
    window.addEventListener(
      'error',
      (e) => {
        const target = e.target as HTMLElement | null
        if (target && target !== (window as unknown as HTMLElement)) {
          const el = target as HTMLImageElement
          send('error', [
            `Resource failed to load: ${target.tagName} src="${el.src || (target as HTMLLinkElement).href || ''}"`,
          ])
        } else if (e.message) {
          send('error', [e.message])
        }
      },
      true,
    )
  } catch {
    // Console patching is best-effort.
  }
}

export function installPreloadShim(
  target: any = typeof window !== 'undefined' ? window : undefined,
): { api: BBeBeeApi; bridge: BBeBeeBridgeApi } | undefined {
  if (!target) return undefined
  // Forward console output to Rust logs before anything else runs.
  forwardConsoleToRust()
  if (!target.BBeBee) {
    target.BBeBee = createPreloadApi()
  }
  if (!target.BBeBeeBridge) {
    target.BBeBeeBridge = createBridgeApi()
  }
  return { api: target.BBeBee, bridge: target.BBeBeeBridge }
}

// Auto-install on window if available and not yet installed
if (typeof window !== 'undefined') {
  installPreloadShim(window)
}
