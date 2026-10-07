/**
 * The preload bridge.
 *
 * Exposes one frozen object, `window.BBeBee`, carrying only what the renderer
 * genuinely cannot do for itself. Every method is mechanical — no domain
 * concepts cross this boundary (docs/02 §2).
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
// The channel names only — the package root pulls in cordis, and a sandboxed
// preload has no `require` for anything but Electron's own modules.
import { CH, unwrapBridgeResult } from '@BBeBee/core-desktop-bridge/protocol'

const api = {
  paths: {
    get: (kind: string): Promise<string | undefined> => ipcRenderer.invoke('paths:get', kind),
  },
  // The running app's version, for registry entries that declare a
  // `minAppVersion` (the confirm dialog disables installs the build cannot satisfy).
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /**
   * The OS keychain, reachable only from `main`.
   *
   * Three calls and no key: `safeStorage` holds the key in the OS, so nothing
   * secret crosses this bridge in either direction — a plaintext string goes
   * one way and an opaque one comes back.
   */
  secrets: {
    available: (): Promise<boolean> => ipcRenderer.invoke('secrets:available'),
    encrypt: (plain: string): Promise<string> => ipcRenderer.invoke('secrets:encrypt', plain),
    decrypt: (cipher: string): Promise<string> => ipcRenderer.invoke('secrets:decrypt', cipher),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:openPath', path),
  },
  dialog: {
    pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  /**
   * Dropped files, by path.
   *
   * A `File` from a drag onto the window carries no path the renderer can
   * read — `File.path` is gone and the sandbox hides the filesystem — so
   * `webUtils` is the only reader left, and it must be called with the *same*
   * `File` object the drop produced. This shim forwards it untouched; the
   * path that comes back is what the importer turns into a `file://` uri.
   */
  files: {
    getPath: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        // Not backed by a path (e.g. a drag from inside the page): the
        // importer treats '' the same as absent.
        return ''
      }
    },
  },
  devtools: {
    open: (): Promise<void> => ipcRenderer.invoke('devtools:open'),
  },
  plugins: {
    listInstalled: (): Promise<
      Array<{ id: string; version: string; manifest: unknown; dirName: string }>
    > => ipcRenderer.invoke('plugins:list-installed'),
    install: (
      pluginId: string,
      files: Record<string, string>,
    ): Promise<{ ok: boolean; pluginId: string; path?: string }> =>
      ipcRenderer.invoke('plugins:install', pluginId, files),
    uninstall: (pluginId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('plugins:uninstall', pluginId),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    setCloseToTray: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('window:setCloseToTray', enabled),
    toggle: (): Promise<void> => ipcRenderer.invoke('window:toggle'),
  },
  proxy: {
    test: (config: unknown): Promise<{ ok: boolean; latencyMs?: number; error?: string }> =>
      ipcRenderer.invoke('proxy:test', config),
    set: (config: unknown): Promise<void> => ipcRenderer.invoke('proxy:set', config),
  },
  stream: {
    setHeaders: (entry: { url: string; headers: Record<string, string> }): Promise<void> =>
      ipcRenderer.invoke('stream:set-headers', entry),
  },
  desktopLyrics: {
    setVisible: (visible: boolean, pos?: { x: number; y: number }): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:set-visible', visible, pos),
    setPosition: (pos: { x: number; y: number }): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:set-position', pos),
    getPosition: (): Promise<{ x: number; y: number } | undefined> =>
      ipcRenderer.invoke('desktop-lyrics:get-position'),
    commitPosition: (pos: { x: number; y: number }): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:commit-position', pos),
    getData: (): Promise<unknown> => ipcRenderer.invoke('desktop-lyrics:get-data'),
    onMoved: (callback: (pos: { x: number; y: number }) => void): (() => void) => {
      const listener = (_event: unknown, pos: { x: number; y: number }) => callback(pos)
      ipcRenderer.on('desktop-lyrics:moved', listener)
      return () => {
        ipcRenderer.removeListener('desktop-lyrics:moved', listener)
      }
    },
    setLocked: (locked: boolean): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:set-locked', locked),
    setIgnoreMouse: (ignore: boolean): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:set-ignore-mouse', ignore),
    onCursor: (callback: (pos: { x: number; y: number }) => void): (() => void) => {
      const listener = (_event: unknown, pos: { x: number; y: number }) => callback(pos)
      ipcRenderer.on('desktop-lyrics:cursor', listener)
      return () => {
        ipcRenderer.removeListener('desktop-lyrics:cursor', listener)
      }
    },
    updateData: (data: unknown): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:update-data', data),
    sendAction: (action: unknown): Promise<void> =>
      ipcRenderer.invoke('desktop-lyrics:send-action', action),
    onData: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data)
      ipcRenderer.on('desktop-lyrics:data', listener)
      return () => {
        ipcRenderer.removeListener('desktop-lyrics:data', listener)
      }
    },
    onAction: (callback: (action: unknown) => void): (() => void) => {
      const listener = (_event: unknown, action: unknown) => callback(action)
      ipcRenderer.on('desktop-lyrics:action', listener)
      return () => {
        ipcRenderer.removeListener('desktop-lyrics:action', listener)
      }
    },
  },
  taskbar: {
    update: (state: unknown): Promise<void> => ipcRenderer.invoke('taskbar:update', state),
    onAction: (callback: (action: 'togglePlay' | 'previous' | 'next') => void): (() => void) => {
      const listener = (_event: unknown, action: 'togglePlay' | 'previous' | 'next') => callback(action)
      ipcRenderer.on('taskbar:action', listener)
      return () => {
        ipcRenderer.removeListener('taskbar:action', listener)
      }
    },
  },
  miniPlayer: {
    open: (options?: unknown): Promise<void> => ipcRenderer.invoke('mini-player:open', options),
    close: (): Promise<void> => ipcRenderer.invoke('mini-player:close'),
    restoreMain: (): Promise<void> => ipcRenderer.invoke('mini-player:restore-main'),
    setMode: (mode: unknown): Promise<void> => ipcRenderer.invoke('mini-player:set-mode', mode),
    getState: (): Promise<unknown> => ipcRenderer.invoke('mini-player:get-state'),
    getData: (): Promise<unknown> => ipcRenderer.invoke('mini-player:get-data'),
    updateData: (data: unknown): Promise<void> => ipcRenderer.invoke('mini-player:update-data', data),
    sendAction: (action: unknown): Promise<void> => ipcRenderer.invoke('mini-player:send-action', action),
    onData: (callback: (data: unknown) => void): (() => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data)
      ipcRenderer.on('mini-player:data', listener)
      return () => {
        ipcRenderer.removeListener('mini-player:data', listener)
      }
    },
    onState: (callback: (state: unknown) => void): (() => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state)
      ipcRenderer.on('mini-player:state', listener)
      return () => {
        ipcRenderer.removeListener('mini-player:state', listener)
      }
    },
    onAction: (callback: (action: unknown) => void): (() => void) => {
      const listener = (_event: unknown, action: unknown) => callback(action)
      ipcRenderer.on('mini-player:action', listener)
      return () => {
        ipcRenderer.removeListener('mini-player:action', listener)
      }
    },
  },
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node },
  isDebug: Boolean(
    (process.env['DEBUG'] && process.env['DEBUG'] !== '0' && process.env['DEBUG'] !== 'false') ||
    process.env['BBEBEE_DEBUG'] ||
    process.argv.includes('--debug'),
  ),
} as const

export type BBeBeeBridge = typeof api

contextBridge.exposeInMainWorld('BBeBee', api)

/**
 * The core-service bridge.
 *
 * Separate from `BBeBee` above because it is machinery, not app surface: the
 * renderer's `ctx.fs`/`ctx.db` forward through here. Still only mechanical
 * calls — no domain concept crosses (docs/02 §2).
 */
contextBridge.exposeInMainWorld('BBeBeeBridge', {
  call: async (service: string, method: string, args: unknown[], token?: string) => {
    const res = await ipcRenderer.invoke(CH.call, service, method, args, token)
    return unwrapBridgeResult(res)
  },
  streamOpen: (uri: string, range?: { start: number; end?: number }) =>
    ipcRenderer.invoke(CH.streamOpen, uri, range),
  streamPull: (handle: number) => ipcRenderer.invoke(CH.streamPull, handle),
  streamClose: (handle: number) => ipcRenderer.invoke(CH.streamClose, handle),
  /**
   * HTTP performed in `main`.
   *
   * Here rather than in the renderer because the renderer is a browser
   * context: CORS applies, and `Cookie`/`User-Agent`/`Range` cannot be set.
   * Neither is true of a music server's expectations (docs/02 §2).
   */
  httpOpen: (request: unknown) => ipcRenderer.invoke(CH.httpOpen, request),
  httpPull: (handle: number) => ipcRenderer.invoke(CH.httpPull, handle),
  httpClose: (handle: number) => ipcRenderer.invoke(CH.httpClose, handle),
  txBegin: () => ipcRenderer.invoke(CH.txBegin),
  txEnd: (token: string, commit: boolean) => ipcRenderer.invoke(CH.txEnd, token, commit),
  /**
   * The one main→renderer channel.
   *
   * The listener is wrapped rather than passed through, so the renderer never
   * receives Electron's `IpcRendererEvent` — which carries `sender` and would
   * hand a plugin a reference back across the boundary.
   */
  on: (handler: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload)
    ipcRenderer.on(CH.event, listener)
    return () => void ipcRenderer.removeListener(CH.event, listener)
  },
})
