# BBeBee Desktop: Architecture & Host Interface Mapping

> **Group 0 Specification Document**  
> Target Project: `apps/desktop`  
> Reference Baseline: Desktop Host Specification  
> Gate Status: PASS  
> Zero TBDs (All items resolved; decisions D1–D5 recorded)

---

## 1. Executive Architecture Overview

BBeBee Desktop runs on Tauri v2. In accordance with the Cordis kernel architecture and ADR-3, the desktop architecture employs a **Hybrid Tripartite Model**:

```
+--------------------------------------------------------------------------+
|                     1. Webview Frontend (Renderer)                      |
|  - Cordis Kernel & Plugin System (Layer 1 - Layer 5)                      |
|  - React 18 UI Shell, Player Views, Desktop Lyrics View, Mini Player UI    |
|  - Bridge Shim: window.BBeBee & window.BBeBeeBridge                       |
+------------------------------------+-------------------------------------+
                                     |
               Tauri IPC (Commands / Events / Custom Protocols)
                                     |
+------------------------------------+-------------------------------------+
|                      2. Rust Shell (Tauri Host)                         |
|  - Window Management (Main, Desktop Lyrics, Mini Player)                 |
|  - System Tray & Native Context Menus (TrayIconBuilder, MenuBuilder)     |
|  - Global Shortcuts & Media Keys (tauri-plugin-global-shortcut)          |
|  - System Dialogs (tauri-plugin-dialog)                                  |
|  - OS Keychain & Crypto (keyring crate + AES-256-GCM fallback - D1)      |
|  - Deep Links: bbebee:// (tauri-plugin-deep-link - D2)                   |
|  - Custom Protocols: bbebee-file://, bbebee-plugin://, bbebee-sandbox://  |
|  - Power & Suspend Monitoring (Win32 / Cocoa / D-Bus zbus)               |
|  - Screen Geometry & Cursor Tracking (clamping, hover pills)             |
|  - Sidecar Process Supervisor (Stdio JSON-RPC Manager)                  |
|  - FFmpeg Transcoding (transcode.rs, desktop_audio_transcode[_cancel])   |
|  - Audio Engine Supervisor (audio.rs, staged: 11 audio_engine_* cmds)   |
+------------------------------------+-------------------------------------+
                                     |
                       Stdio JSON-RPC (Framed NDJSON)
                                     |
+------------------------------------+-------------------------------------+
|                     3. Node.js Headless Sidecar                          |
|  - Core Service Host: @BBeBee/core-desktop-bridge/main                   |
|  - Headless Context: core-fs-node, core-db-node, core-paths-node         |
|  - SQLite Database Operations & Schema Migrations                        |
|  - File System Operations with Path Containment & Whitelisting           |
|  - HTTP Outbound Engine (CORS-free, custom Cookie/Referer handling)      |
|  - Audio Engine Supervisor (live playback path; Rust port staged)        |
+--------------------------------------------------------------------------+
```

---

## 2. Exhaustive Inventory of Direct Bridge References

Every reference across `apps/desktop/renderer` and related Layer 2 / Layer 4 / Layer 5 packages was inventoried using ripgrep (`rg` / `grep`).

### 2.1 References in `apps/desktop/renderer`

| File Path | Line(s) | Symbol Referenced | Purpose / Context |
|---|---|---|---|
| `apps/desktop/renderer/boot.ts` | 74 | `window.BBeBee?.isDebug` | Debug flag read inside `isDebug()` during boot initialization |
| `apps/desktop/renderer/boot.ts` | 80 | `window.BBeBee?.platform` | Desktop host platform, normalized to `macos` / `windows` / `linux` |
| `apps/desktop/renderer/boot.ts` | 433 | `window.BBeBeeBridge` | Grab bridge handle before mounting core services |
| `apps/desktop/renderer/boot.ts` | 472 | `window.BBeBeeBridge?.call('fs', 'readFile', [storeUri])` | Bootstrap read of persistent app config store file |
| `apps/desktop/renderer/boot.ts` | 562 | `window.BBeBeeBridge?.call` | Injected as `bridgeCall` into `core-audio-mpv` |
| `apps/desktop/renderer/boot.ts` | 593 | `window.BBeBee?.window?.setCloseToTray` | Synchronize close-to-tray preference to window host |
| `apps/desktop/renderer/boot.ts` | 596 | `window.BBeBee?.proxy?.set` | Apply network proxy configuration to host session |
| `apps/desktop/renderer/main.tsx` | 120 | `window.BBeBee?.locale?.notify` | Push resolved interface locale to host for ctx-less windows |
| `apps/desktop/renderer/TopBar.tsx` | 1004 | `window.BBeBee?.window?.isMaximized` | Query initial window maximize state |
| `apps/desktop/renderer/TopBar.tsx` | 1010 | `window.BBeBee?.window?.minimize` | Minimize window button action |
| `apps/desktop/renderer/TopBar.tsx` | 1014 | `window.BBeBee?.window?.maximize` | Toggle maximize / unmaximize window button action |
| `apps/desktop/renderer/TopBar.tsx` | 1020 | `window.BBeBee?.window?.close` | Window close button action |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 49, 54 | `window.BBeBee?.desktopLyrics?.getPosition` | Read initial window coordinates on pointer down drag |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 69, 71, 88 | `window.BBeBee?.desktopLyrics?.setPosition` | Move floating window during drag gesture |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 92 | `window.BBeBee?.desktopLyrics?.commitPosition` | Report final dragged position for persistence |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 103 | `window.BBeBee?.desktopLyrics?.getData` | Fetch initial lyrics payload on mount |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 110 | `window.BBeBee?.desktopLyrics?.onData` | Subscribe to realtime lyrics push from player |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 121 | `window.BBeBee?.desktopLyrics?.sendAction` | Dispatch controls (play, prev, next, lock, font) to main window |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 155, 164 | `window.BBeBee?.desktopLyrics?.onCursor` | Subscribe to polled OS cursor position while click-through |
| `apps/desktop/renderer/DesktopLyricsWindow.tsx` | 179 | `window.BBeBee?.desktopLyrics?.setIgnoreMouse` | Toggle mouse passthrough over unlock pill hotspot |
| `apps/desktop/renderer/drop-import.ts` | 161 | `window.BBeBee?.files?.getPath(file)` | Extract native filesystem path from dropped `File` objects (backed by `tauri://drag-drop` payload map) |
| `apps/desktop/renderer/dynamic-loader.ts` | 120, 124 | `pluginsApi.listInstalled` (`pluginsApi = window.BBeBee?.plugins`) | Enumerate external plugins installed on disk |
| `apps/desktop/renderer/dynamic-loader.ts` | 125 | `pluginsApi.getLock` | Read `registry.lock.json` for integrity validation |
| `apps/desktop/renderer/dynamic-loader.ts` | 199, 219 | `pluginsApi.install` | Write plugin files into user's installed-plugins directory |
| `apps/desktop/renderer/dynamic-loader.ts` | 250, 252 | `pluginsApi.uninstall` | Remove plugin directory from disk after fiber disposal |

### 2.2 References in Core and Feature Packages

| Package | File | Symbol Referenced | Purpose |
|---|---|---|---|
| `@BBeBee/core-desktop-bridge` | `src/protocol.ts` | `window.BBeBeeBridge`, `window.BBeBee.secrets` | Defines `BridgeApi`, `requireBridge()`, and `safeStorageCodec()` |
| `@BBeBee/core-desktop-bridge` | `src/index.ts` | `window.BBeBeeBridge` | `FsBridge`, `DbBridge`, `PathsBridge`, `bridgeFetch()` |
| `@BBeBee/core-codec-node` | `src/index.ts` | `window.BBeBee.audio.transcode`, `cancelTranscode` | Delegated transcode execution via FFmpeg |
| `@BBeBee/core-device-tauri` | `src/index.ts` | `window.BBeBeeBridge` (`call('system', ...)` + `on()`) | Media keys, global accelerators, battery, network |
| `@BBeBee/core-background-tauri` | `src/index.ts` | `window.BBeBeeBridge` (`call('system', ...)` + `on()`) | Wake locks (`acquireWakeLock`), system suspend notifications |
| `@BBeBee/core-media-session-tauri` | `src/index.ts` | `window.BBeBeeBridge` (`call('system', ...)` + `on()`) | MPRIS / SMTC / Now Playing broadcast & commands |
| `@BBeBee/core-audio-mpv` | `src/index.ts` | `bridgeCall` (`window.BBeBeeBridge.call('audio', ...)`) | MPV audio engine load, play, pause, seek, volume, DSP, FFT |
| `@BBeBee/plugin-desktop-taskbar` | `src/index.ts` | `window.BBeBee.taskbar.update`, `onAction` | Windows thumbnail toolbar & tray menu state synchronization |
| `@BBeBee/plugin-desktop-lyrics-ui-desktop` | `src/DesktopLyrics.tsx` | `window.BBeBee.desktopLyrics` | Secondary window sync: `setVisible`, `setPosition`, `setLocked`, `updateData`, `onMoved`, `onAction` |
| `@BBeBee/plugin-mini-player` | `src/index.ts`, `hooks.ts` | `window.BBeBee.miniPlayer` | Secondary window sync: `open`, `close`, `restoreMain`, `setMode`, `getState`, `getData`, `updateData`, `sendAction`, `onData`, `onState`, `onAction` |
| `@BBeBee/ui-kit-desktop` | `src/hooks/use-bridge-locale.ts` | `window.BBeBee.locale.getLocale`, `onLocaleChange` | Language hook for ctx-less secondary windows |
| `@BBeBee/plugin-registry-ui-desktop` | `src/hooks/use-registry.ts` | `window.BBeBee.getAppVersion` | Enforce `minAppVersion` in plugin install confirmation |
| `@BBeBee/plugin-now-playing-ui-desktop` | `src/styles/SandboxedLayout.tsx` | `window.BBeBee.sandbox.setHtml` | Register dynamic skin template served over `bbebee-sandbox://` |

---

## 3. Desktop Host API & Capability Mapping

All 16 desktop host APIs are mapped below with concrete target implementations across Rust shell, Node sidecar, or Tauri plugins.

| Host Capability / API | Used Methods / Properties | Purpose in BBeBee | Target Implementation | Concrete Technology / Module |
|---|---|---|---|---|
| **app** | `setName`, `commandLine.appendSwitch`, `getPath`, `getVersion`, `quit`, `whenReady`, `activate`, `before-quit`, `window-all-closed`, `will-quit`, `login` | App metadata, Chromium switches, paths, version, quit policy, proxy auth | **Rust Shell** | `tauri::AppHandle`, `tauri::path::PathResolver`, `tauri::RunEvent` loop. Proxy auth handled in reqwest client / sidecar session. |
| **BrowserWindow** | `new BrowserWindow`, `show`, `hide`, `focus`, `minimize`, `maximize`, `unmaximize`, `isMaximized`, `isMinimized`, `restore`, `close`, `destroy`, `isDestroyed`, `isVisible`, `getPosition`, `setPosition`, `getSize`, `setBounds`, `setAlwaysOnTop`, `setVisibleOnAllWorkspaces`, `setIgnoreMouseEvents`, `setThumbarButtons`, `webContents` | Window creation, lifecycle, frameless controls, floating lyrics & island | **Rust Shell** | `tauri::WebviewWindow`, `tauri::WebviewWindowBuilder`, Win32 `ITaskbarList3` for thumbar, `set_ignore_cursor_events`. |
| **dialog** | `showOpenDialog({ properties: ['openDirectory', 'openFile', 'multiSelections'], filters })` | Local music folder selection & audio file picker | **Tauri Plugin** | `tauri-plugin-dialog` (`pick_folder`, `pick_files`). Whitelists selected paths into Node sidecar `extraRoots`. |
| **globalShortcut** | `register`, `unregister`, `unregisterAll` | Media keys (`MediaPlayPause`, etc.) and user hotkeys | **Tauri Plugin** | `tauri-plugin-global-shortcut`. Global shortcuts emit `BBeBee:event` (`media-key`, `hotkey`) to Webview. |
| **ipcMain** | `handle`, `removeHandler`, `webContents.send` | Main-renderer IPC messaging, request-response, push events | **Rust Shell** | Tauri `#[tauri::command]` (request/response) and `app.emit()` / `window.emit()` (push). Stdio JSON-RPC to Sidecar. |
| **nativeImage** | `createFromPath`, `createFromDataURL` | Tray icon images and Windows taskbar thumbnail button icons | **Rust Shell** | `tauri::image::Image` and Rust `image` crate. |
| **net** | `net.fetch` | Outbound HTTP requests bypassing CORS and custom protocol restrictions | **Node Sidecar / Rust** | Handled in **Node Sidecar** via `undici` / Node `fetch` (`core-http-node`) with support for custom `Cookie`/`Referer`/`Range`. |
| **powerMonitor** | `powerMonitor.on('suspend', cb)` | Detects OS sleep/suspend to trigger position checkpointing | **Rust Shell** | OS native listeners: Win32 `WM_POWERBROADCAST`, macOS `NSWorkspaceWillSleep`, Linux `zbus` on `org.freedesktop.login1`. Emits `will-suspend`. |
| **powerSaveBlocker** | `start('prevent-app-suspension')`, `stop`, `isStarted` | Keeps system awake during audio playback without keeping screen on | **Rust Shell** | Rust sleep blocker: Win32 `SetThreadExecutionState`, macOS `IOPMAssertionCreateWithName`, Linux D-Bus `Inhibit`. |
| **protocol** | `registerSchemesAsPrivileged`, `handle('bbebee-file')`, `handle('bbebee-plugin')`, `handle('bbebee-sandbox')` | Privileged custom schemes: local file streaming, plugin assets, HTML skins | **Rust Shell** | Tauri custom URI scheme protocol handler `app.register_uri_scheme_protocol(...)`. Native HTTP Range parsing & streaming response. |
| **safeStorage** | `isEncryptionAvailable`, `encryptString`, `decryptString` | Encrypted credential store for source tokens and secrets | **Rust Shell** | Decision **D1**: `keyring` crate (OS Keychain: Secret Service, Keychain, Credential Manager) + AES-256-GCM fallback. |
| **shell** | `openExternal(url)`, `openPath(path)` | Open web URLs in browser (HTTP/HTTPS only) and open folders in file manager | **Rust Shell** | `tauri-plugin-opener` / `open::that` in Rust with strict `isWebUrl` validation. |
| **Tray** | `new Tray`, `setToolTip`, `setContextMenu`, `on('click')`, `destroy` | System tray icon, status tooltip, background controls menu, click restore | **Rust Shell** | `tauri::tray::TrayIconBuilder`, `tauri::menu::MenuBuilder`. |
| **Menu** | `setApplicationMenu(null)`, `buildFromTemplate` | Application menu suppression and context menu construction | **Rust Shell** | `tauri::menu::Menu`, `tauri::menu::MenuItem`. Frameless custom header used in UI. |
| **session** | `setProxy`, `closeAllConnections`, `fromPartition`, `setPermissionCheckHandler`, `webRequest.onBeforeSendHeaders`, `webRequest.onHeadersReceived` | Proxy management, latency test, web permissions, stream headers, CORS | **Rust Shell & Sidecar** | Webview proxy via Tauri webview config; proxy testing in Rust/Sidecar; stream headers attached via custom protocol or sidecar HTTP. |
| **screen** | `getPrimaryDisplay`, `getDisplayMatching`, `getDisplayNearestPoint`, `getCursorScreenPoint` | Screen bounds query, window positioning, cursor tracking for lyrics | **Rust Shell** | Tauri `window.primary_monitor()`, `available_monitors()`. Cursor polling via `device_query` / OS APIs (`GetCursorPos`, `CGEvent`). |
| **contextBridge** *(preload)* | `exposeInMainWorld('BBeBee')`, `exposeInMainWorld('BBeBeeBridge')` | Exposes bridge surface to sandboxed renderer | **Webview Init** | Tauri `initialization_script` injects bridge shim before DOM loads. |
| **ipcRenderer** *(preload)* | `invoke`, `on`, `removeListener` | Renderer-side IPC wire | **Webview Init** | `window.__TAURI__.core.invoke` and `window.__TAURI__.event.listen` polyfilled into bridge interface. |
| **webUtils** *(preload)* | `getPathForFile(file)` | Extracts local disk path from dropped files | **Rust & Webview** | Tauri native drag-drop events (`onDragDropEvent`) supply filesystem paths directly to renderer. |

---

## 4. `window.BBeBee` Method & Property Forwarding Routes

The `window.BBeBee` object exposes 20 namespaces and properties. Every method forwards through Tauri commands (`invoke`), Tauri events (`listen`/`emit`), or executes against the Node sidecar via stdio JSON-RPC.

| Namespace / Member | TypeScript Signature | Forwarding Route | Target Handler |
|---|---|---|---|
| **paths** | `get(kind: string): Promise<string \| undefined>` | `invoke('desktop_paths_get', { kind })` | Rust Shell (`tauri::path`) |
| **getAppVersion** | `(): Promise<string>` | `invoke('desktop_app_version')` | Rust Shell (`app_handle.package_info().version`) |
| **secrets.available** | `(): Promise<boolean>` | `invoke('desktop_secrets_available')` | Rust Shell (Keyring crate availability check) |
| **secrets.encrypt** | `(plain: string): Promise<string>` | `invoke('desktop_secrets_encrypt', { plain })` | Rust Shell (Keyring / AES-256-GCM cipher) |
| **secrets.decrypt** | `(cipher: string): Promise<string>` | `invoke('desktop_secrets_decrypt', { cipher })` | Rust Shell (Keyring / AES-256-GCM decipher) |
| **shell.openExternal** | `(url: string): Promise<void>` | `invoke('desktop_shell_open_external', { url })` | Rust Shell (`open::that`, validated `isWebUrl`) |
| **shell.openPath** | `(path: string): Promise<string>` | `invoke('desktop_shell_open_path', { path })` | Rust Shell (`open::that` for directories) |
| **dialog.pickDirectory**| `(): Promise<string \| undefined>` | `invoke('desktop_dialog_pick_directory')` | Rust Shell (`tauri-plugin-dialog`), registers path to Sidecar `extraRoots` |
| **dialog.pickFiles** | `(options?: { extensions?: string[] }): Promise<string[]>` | `invoke('desktop_dialog_pick_files', { extensions })` | Rust Shell (`tauri-plugin-dialog`), registers paths to Sidecar `extraRoots` |
| **files.getPath** | `(file: File): string` | Preloaded file-path map populated by Tauri `drag-drop` | Webview runtime / Tauri drag-drop handler |
| **files.authorizePath** | `(path: string): Promise<boolean>` | `invoke('desktop_files_authorize', { path })` | Rust forwards to Sidecar `extraRoots` whitelist |
| **devtools.open** | `(): Promise<void>` | `invoke('desktop_devtools_open')` | Rust Shell (`window.open_devtools()`) |
| **plugins.listInstalled**| `(): Promise<Array<{ id, version, manifest, dirName, sha256 }>>` | `invoke('desktop_plugins_list_installed')` | Rust Shell / Node Sidecar reading `installed-plugins/` |
| **plugins.getLock** | `(): Promise<unknown>` | `invoke('desktop_plugins_get_lock')` | Rust Shell / Node Sidecar reading `registry.lock.json` |
| **plugins.install** | `(pluginId: string, files: Record<string, string>): Promise<{ ok, pluginId, path }>` | `invoke('desktop_plugins_install', { pluginId, files })` | Rust Shell / Node Sidecar writing files with path-traversal check |
| **plugins.uninstall** | `(pluginId: string): Promise<{ ok, message }>` | `invoke('desktop_plugins_uninstall', { pluginId })` | Rust Shell / Node Sidecar removing plugin directory |
| **window.minimize** | `(): Promise<void>` | `invoke('desktop_window_minimize')` | Rust Shell (`window.minimize()`) |
| **window.maximize** | `(): Promise<void>` | `invoke('desktop_window_maximize')` | Rust Shell (`window.maximize()` / `unmaximize()`) |
| **window.close** | `(): Promise<void>` | `invoke('desktop_window_close')` | Rust Shell (`window.close()` or `hide()` per closeToTray) |
| **window.isMaximized** | `(): Promise<boolean>` | `invoke('desktop_window_is_maximized')` | Rust Shell (`window.is_maximized()`) |
| **window.setCloseToTray**| `(enabled: boolean): Promise<void>` | `invoke('desktop_window_set_close_to_tray', { enabled })` | Rust Shell updates state variable `close_to_tray` |
| **window.toggle** | `(): Promise<void>` | `invoke('desktop_window_toggle')` | Rust Shell (`show()` / `hide()`) |
| **proxy.test** | `(config: unknown): Promise<{ ok, latencyMs, error }>` | `invoke('desktop_proxy_test', { config })` | Rust Shell / Node Sidecar HTTP ping via proxy |
| **proxy.set** | `(config: unknown): Promise<void>` | `invoke('desktop_proxy_set', { config })` | Rust Shell sets Webview proxy settings |
| **stream.setHeaders** | `(entry: { url, headers }): Promise<void>` | `invoke('desktop_stream_set_headers', { entry })` | Rust Shell stores origin/host headers map |
| **audio.cancelTranscode**| `(jobId: string): Promise<boolean>` | `invoke('desktop_audio_transcode_cancel', { jobId })` | Rust Shell kills active FFmpeg child process |
| **audio.transcode** | `(options, onProgress): Promise<{ ok, error }>` | `invoke('desktop_audio_transcode', { options })` | Rust Shell spawns FFmpeg; progress streamed via `audio:transcode-progress` Tauri event |
| **desktopLyrics.setVisible**| `(visible: boolean, pos?: { x, y }): Promise<void>` | `invoke('desktop_lyrics_set_visible', { visible, pos })` | Rust Shell manages `"desktop-lyrics"` WebviewWindow |
| ~~desktopLyrics.setPosition~~ | _removed_ | _lyrics drag is OS-native via `data-tauri-drag-region`; position persists through the `Moved` window event_ |
| ~~desktopLyrics.getPosition~~ | _removed_ | _see above_ |
| ~~desktopLyrics.commitPosition~~ | _removed_ | _see above_ |
| **desktopLyrics.getData**| `(): Promise<unknown>` | `invoke('desktop_lyrics_get_data')` | Rust Shell returns cached `latest_lyric_data` |
| **desktopLyrics.onMoved**| `(callback: (pos) => void): (() => void)` | `listen('desktop-lyrics:moved', event => callback(event.payload))` | Tauri Event subscription |
| **desktopLyrics.setLocked**| `(locked: boolean): Promise<void>` | `invoke('desktop_lyrics_set_locked', { locked })` | Rust Shell `window.set_ignore_cursor_events(locked)` |
| **desktopLyrics.setIgnoreMouse**| `(ignore: boolean): Promise<void>` | `invoke('desktop_lyrics_set_ignore_mouse', { ignore })` | Rust Shell `window.set_ignore_cursor_events(ignore)` |
| **desktopLyrics.onCursor**| `(callback: (pos) => void): (() => void)` | `listen('desktop-lyrics:cursor', event => callback(event.payload))` | Tauri Event subscription (polled by Rust shell) |
| **desktopLyrics.updateData**| `(data: unknown): Promise<void>` | `invoke('desktop_lyrics_update_data', { data })` | Rust stores data & emits `desktop-lyrics:data` to lyrics win |
| **desktopLyrics.sendAction**| `(action: unknown): Promise<void>` | `invoke('desktop_lyrics_send_action', { action })` | Rust emits `desktop-lyrics:action` to main window |
| **desktopLyrics.onData**| `(callback: (data) => void): (() => void)` | `listen('desktop-lyrics:data', event => callback(event.payload))` | Tauri Event subscription |
| **desktopLyrics.onAction**| `(callback: (action) => void): (() => void)` | `listen('desktop-lyrics:action', event => callback(event.payload))` | Tauri Event subscription |
| **taskbar.update** | `(state: unknown): Promise<void>` | `invoke('desktop_taskbar_update', { state })` | Rust Shell Win32 thumbnail toolbar buttons (Prev, Play/Pause, Next, Favorite/Unfavorite) with theme adaptation & Tray menu |
| **taskbar.onAction** | `(callback: (action) => void): (() => void)` | `listen('taskbar:action', event => callback(event.payload))` | Tauri Event subscription (`'togglePlay' \| 'previous' \| 'next' \| 'toggleFavorite'`) |
| **miniPlayer.open** | `(options?: unknown): Promise<void>` | `invoke('desktop_mini_player_open', { options })` | Rust Shell creates/shows `"mini-player"` WebviewWindow |
| **miniPlayer.close** | `(): Promise<void>` | `invoke('desktop_mini_player_close')` | Rust Shell hides mini player window & restores main |
| **miniPlayer.restoreMain**| `(): Promise<void>` | `invoke('desktop_mini_player_restore_main')` | Rust Shell restores and focuses main window |
| **miniPlayer.setMode** | `(mode: unknown): Promise<void>` | `invoke('desktop_mini_player_set_mode', { mode })` | Rust Shell adjusts bounds (attached / expanded / normal) |
| **miniPlayer.getState** | `(): Promise<unknown>` | `invoke('desktop_mini_player_get_state')` | Rust Shell returns `{ visible, mode, windowState }` |
| **miniPlayer.getData** | `(): Promise<unknown>` | `invoke('desktop_mini_player_get_data')` | Rust Shell returns cached `latest_mini_player_data` |
| **miniPlayer.updateData**| `(data: unknown): Promise<void>` | `invoke('desktop_mini_player_update_data', { data })` | Rust caches data & emits `mini-player:data` to mini win |
| **miniPlayer.sendAction**| `(action: unknown): Promise<void>` | `invoke('desktop_mini_player_send_action', { action })` | Rust processes action or emits `mini-player:action` to main |
| **miniPlayer.onData** | `(callback: (data) => void): (() => void)` | `listen('mini-player:data', event => callback(event.payload))` | Tauri Event subscription |
| **miniPlayer.onState** | `(callback: (state) => void): (() => void)` | `listen('mini-player:state', event => callback(event.payload))` | Tauri Event subscription |
| **miniPlayer.onAction**| `(callback: (action) => void): (() => void)` | `listen('mini-player:action', event => callback(event.payload))` | Tauri Event subscription |
| **platform** | `'win32' \| 'darwin' \| 'linux'` | Constant string property | Injected by bridge init script matching host OS |
| **locale.getLocale** | `(): Promise<string>` | `invoke('desktop_locale_get')` | Rust Shell returns current stored locale |
| **locale.notify** | `(locale: string): Promise<void>` | `invoke('desktop_locale_notify', { locale })` | Rust stores locale & emits `locale:changed` to all windows |
| **locale.onLocaleChange**| `(callback: (locale) => void): (() => void)`| `listen('locale:changed', event => callback(event.payload))` | Tauri Event subscription |
| **sandbox.setHtml** | `(id: string, html: string): Promise<void>` | `invoke('desktop_sandbox_set_html', { id, html })` | Rust stores HTML string for `bbebee-sandbox://<id>` |
| **versions** | `{ tauri: string, node: string, webview: string }`| Constant object | Injected by bridge init script (compat shim) |
| **isDebug** | `boolean` | Constant boolean | Injected by bridge init script from env / dev mode |

---

## 5. CH Channel Wire Transport Specification (Rust <-> Node Sidecar)

The core services (`fs`, `db`, `paths`, `audio`) live in the Node.js sidecar per ADR-3. The bridge between the Tauri Rust Shell and the Node Sidecar operates over standard input/output (`stdio`) using JSON-RPC 2.0 framing.

### 5.1 Protocol Framing & Wire Format

- **Transport Medium**: Standard input (`stdin`) and standard output (`stdout`) pipes of the spawned Node sidecar subprocess.
- **Message Delimiter**: Single newline (`\n`). Every JSON-RPC frame MUST be a valid single-line JSON string without unescaped internal newlines (NDJSON format).
- **Diagnostics Isolation**: Diagnostic and informational logs produced by Node.js MUST be written exclusively to standard error (`stderr`), ensuring that `stdout` is dedicated strictly to framed JSON-RPC messages.
- **Result Wrapping**: All successful and operational-error responses from service calls use the standard `BridgeEnvelope` contract:
  ```json
  {
    "__bbebee_bridge__": true,
    "ok": true,
    "result": "<Payload>"
  }
  ```
  or for expected operational errors:
  ```json
  {
    "__bbebee_bridge__": true,
    "ok": false,
    "error": {
      "message": "File not found",
      "code": "ENOENT"
    }
  }
  ```

### 5.2 Mapping of the 10 CH Channels

| Channel Constant | Channel Name String | Direction | JSON-RPC Method | Payload Parameters | Result / Return Value |
|---|---|---|---|---|---|
| `CH.call` | `'BBeBee:call'` | Renderer -> Rust -> Sidecar | `"BBeBee:call"` | `[service: string, method: string, args: unknown[], token?: string]` | `BridgeEnvelope<unknown>`: executes `fs`, `db`, `paths`, `system`, or `audio` methods |
| `CH.streamOpen` | `'BBeBee:stream:open'` | Renderer -> Rust -> Sidecar | `"BBeBee:stream:open"` | `[uri: string, range?: { start: number, end?: number }]` | `number` (active stream handle ID) |
| `CH.streamPull` | `'BBeBee:stream:pull'` | Renderer -> Rust -> Sidecar | `"BBeBee:stream:pull"` | `[handle: number]` | `Uint8Array \| null` (base64 string over wire, null indicates EOF) |
| `CH.streamClose`| `'BBeBee:stream:close'`| Renderer -> Rust -> Sidecar | `"BBeBee:stream:close"`| `[handle: number]` | `void` (stream reader disposed and descriptor closed) |
| `CH.httpOpen` | `'BBeBee:http:open'` | Renderer -> Rust -> Sidecar | `"BBeBee:http:open"` | `[request: BridgeHttpRequest]` | `BridgeHttpHead` (`{ handle, status, statusText, headers, url, hasBody }`) |
| `CH.httpPull` | `'BBeBee:http:pull'` | Renderer -> Rust -> Sidecar | `"BBeBee:http:pull"` | `[handle: number]` | `Uint8Array \| null` (base64 string over wire, null indicates body end) |
| `CH.httpClose`| `'BBeBee:http:close'`| Renderer -> Rust -> Sidecar | `"BBeBee:http:close"`| `[handle: number]` | `void` (HTTP reader canceled, abort controller triggered) |
| `CH.txBegin` | `'BBeBee:tx:begin'` | Renderer -> Rust -> Sidecar | `"BBeBee:tx:begin"` | `[]` | `string` (unique transaction token, e.g. `"tx1"`) |
| `CH.txEnd` | `'BBeBee:tx:end'` | Renderer -> Rust -> Sidecar | `"BBeBee:tx:end"` | `[token: string, commit: boolean]` | `void` (commits or rolls back transaction) |
| `CH.event` | `'BBeBee:event'` | Sidecar -> Rust -> Renderer | `"BBeBee:event"` (Notification) | `[BridgeEvent]` (`media-key`, `hotkey`, `will-suspend`, `power`, `transport`) | Broadcast to Webview via Tauri event `'BBeBee:event'` |

### 5.3 Allowed Methods Per Bridged Service

The sidecar enforces strict method allowlists to prevent arbitrary object dispatch:
- **fs**: `dir`, `exists`, `stat`, `list`, `mkdir`, `remove`, `move`, `copy`, `readFile`, `readBytes`, `writeFile`, `freeSpace`, `toPlayableUri`, `pickDirectory`.
- **db**: `query`, `get`, `exec`, `defineSchema`.
- **paths**: `appData`, `cache`, `temp`, `logs`, `downloads`, `music`, `pluginData`, `get`.
- **system**: `acquireWakeLock`, `releaseWakeLock`, `watchMediaKeys`, `registerHotkey`, `unregisterHotkey`, `publishNowPlaying`, `publishPlaybackState`, `setSupportedCommands`, `clearNowPlaying`.
- **audio**: `getOutputDevices`, `setOutputDevice`, `mpvLoad`, `mpvAppend`, `mpvPlay`, `mpvPause`, `mpvStop`, `mpvSeek`, `mpvSetVolume`, `mpvSetMuted`, `mpvSetAudioExclusive`, `mpvSetDspConfig`, `mpvSetVisualizer`, `mpvGetFftFrame`, `mpvGetState`, `mpvGetAudioDevices`, `mpvEngineStatus`, `mpvSetStreamPlayback`.

### 5.4 Fast-Path Bridge Routing (`bridge_call`)

The `bridge_call` / `desktop_bridge_call` command in Rust (`src-tauri/src/commands.rs`) acts as an intelligent router rather than a naive proxy. To prevent head-of-line blocking and ensure high-throughput low-latency execution, it implements dedicated routing layers before delegating to the main Node sidecar:

1. **Cover Sidecar Router (`codec.readArtwork*`)**:
   - Routes artwork batch extractions to a dedicated, standalone Node worker pool (`dist-sidecar/cover.mjs`).
   - Prevents bulk image extraction from starving core playback and database bridge calls. Falls back to the main sidecar if the cover sidecar is unavailable.

2. **Audio Visualization In-Memory Fast-Path Bridge (`audio.mpvGetFftFrame` / `visualizer`)**:
   - Intercepts high-frequency (~60 FPS, ~16ms interval) audio spectrum and waveform queries from `plugin-visualizer`.
   - **Zero-stdio fast path**: If an FFT frame has been cached by the native audio engine in Rust host memory (`AppState.latest_fft_frame`), `bridge_call` immediately wraps it in a standard `BridgeEnvelope` (`{ "__bbebee_bridge__": true, "ok": true, "result": frame }`) and returns it directly to the webview in sub-millisecond time.
   - **Zero queue pollution**: Eliminates 60 round-trips/second over the Node sidecar's stdio NDJSON channel, preventing UI visualizer stutter and sidecar worker saturation.
   - **Hybrid Fallback (Plan C)**: If the host cache has not yet received a frame (e.g. during engine initialization or in environments where audio is managed by the legacy Node supervisor), the call gracefully falls through to the main sidecar.

> **Note — Rust audio migration (staged, P0):** a parallel Rust-native audio
> surface exists in `src-tauri/src/audio.rs` (`AudioEngineSupervisor`, NDJSON JSON-RPC over the
> engine subprocess stdio). It is instantiated at startup (`main.rs`), held in `AppState`
> (`get_audio_engine` / `set_audio_engine`), exposes 12 registered Tauri commands
> (`audio_engine_start`, `audio_engine_stop`, `audio_engine_load`, `audio_engine_play`,
> `audio_engine_pause`, `audio_engine_stop_playback`, `audio_engine_seek`, `audio_engine_set_volume`,
> `audio_engine_set_muted`, `audio_engine_set_dsp`, `audio_engine_status`, `audio_engine_get_fft_frame`),
> continuously updates `AppState.latest_fft_frame` via a background `subscribe_fft()` task, and forwards
> engine events (`audio:state`, crash) to the frontend. Live playback bridge calls for general transport
> continue to route through `bridge_call`, while FFT visualization calls benefit from the in-memory fast-path.
>
> FFmpeg transcoding, by contrast, has **fully migrated to Rust** (`src-tauri/src/transcode.rs`):
> both shims route `window.BBeBee.audio.transcode` / `cancelTranscode` to the
> `desktop_audio_transcode` / `desktop_audio_transcode_cancel` commands, with progress streamed on
> the `audio:transcode-progress` Tauri event. The sidecar's legacy `audio:transcode` handler is no
> longer reachable from the renderer.

---

## 6. Architectural Decisions Record (D1 - D5)

The following architectural choices have been established for the Tauri desktop target:

### D1: OS Keychain via keyring crate + AES-256-GCM fallback
- **Context**: In desktop host security, secret storage delegates to OS secret storage (DPAPI on Windows, Keychain on macOS, Secret Service / libsecret on Linux).
- **Target**: Use the Rust `keyring` crate to access native platform keychains.
- **Fallback**: On headless environments, Linux systems without Secret Service daemon, or test runners where `keyring` returns an error, gracefully fallback to AES-256-GCM encryption using a machine-bound derived key. This ensures the application never crashes on boot while preserving hardware-backed security where supported.

### D2: Retain `bbebee://` Deep Link Support via `tauri-plugin-deep-link`
- **Context**: BBeBee supports external URI schemes (`bbebee://`) for opening specific tracks, playlists, or importing source documents.
- **Target**: Adopt `tauri-plugin-deep-link` in the Tauri Rust Shell. Deep link activations are captured by the plugin and dispatched as navigation events to the primary Webview.

### D3: Windows WebView2 downloadBootstrapper
- **Context**: On Windows 10/11, WebView2 runtime is required by Tauri.
- **Target**: Configure `tauri.conf.json` with `"webviewInstallMode": { "type": "downloadBootstrapper" }`. When running on machines lacking an existing WebView2 evergreen installation, the installer / shell automatically downloads and installs the required runtime seamlessly.

### D4: Updater Skeleton Prepared, Deferred Pending Signing Cert
- **Context**: Automated background updates via `tauri-plugin-updater`.
- **Target**: The codebase includes the dependency configuration, updater check command, and UI notification wiring. Live update verification is deferred until official code-signing certificates and public/private keypairs are provisioned in CI/CD.

### D5: Linux Wayland PoC Scheduled Before Group 2
- **Context**: Linux desktop environments using Wayland impose strict security restrictions on window placement, transparent click-through surfaces, and global cursor coordinate queries.
- **Target**: Before implementing Group 2 (Desktop Lyrics & Mini Player multi-window management), a targeted Wayland PoC will evaluate `layer-shell` protocols (via `gtk4-layer-shell` or XWayland fallback) to ensure seamless floating lyrics and dynamic island behavior.

### D6: macOS Native Overlay Titlebar & Cross-Platform Frameless Window Management
- **Context**: macOS desktop music players (such as Apple Music and Spotify) place native traffic light buttons (Close, Minimize, Zoom) in the upper-left corner floating transparently over the application window, while Windows and Linux desktop applications require a frameless window with custom interactive titlebar controls on the upper-right.
- **Target**:
  - `tauri.conf.json` configures `"hiddenTitle": true`, `"titleBarStyle": "Overlay"`, and `"decorations": false`.
  - In `src-tauri/src/main.rs`, macOS dynamically activates native decorations and `tauri::TitleBarStyle::Overlay` at boot, and emits `window:fullscreen-changed` on window resize. Windows and Linux retain `decorations: false`.
  - The renderer (`platform.ts`, `TopBar.tsx`, `Shell.tsx`) omits Windows-style window controls on macOS, provides a sticky 36px drag-safe area in the sidebar to prevent content overlap with native traffic lights, applies a 78px left inset to TopBar in expanded library mode, and automatically collapses safe areas when in macOS Spaces/fullscreen.

---

## 7. Security Boundaries & Custom Protocol Registration

Tauri v2 eliminates webPreferences sandbox escape risks by design. Custom URI protocols are registered natively in the Rust shell:

1. **`bbebee-file://`**:
   - Registered via `app.register_uri_scheme_protocol("bbebee-file", ...)`.
   - Handles streaming of local audio files and artwork with HTTP 206 Partial Content byte-range support.
   - Enforces file containment against allowed application directories and `extraRoots`.
   - **Serving-URL forms are platform-specific** (the frontend must emit the right form; Rust
     `to_native_path` in `protocols.rs` strips the `//localhost/` prefix):
     - Linux (WebKitGTK, wry 0.57): `bbebee-file://localhost/<path>` — wry does not dispatch the
       empty-host form to the registered protocol handler.
     - Windows (WebView2): `http://bbebee-file.localhost/<path>` — wry's custom-protocol
       workaround, served over HTTP.
     - macOS (WKWebView): `bbebee-file:///<path>` (identity) — custom schemes are served natively.

2. **`bbebee-plugin://`**:
   - Resolves external plugins from `{appData}/installed-plugins/{pluginId}/{subPath}`.
   - Enforces strict canonical path checks against directory traversal (`../`).
   - Serves `.js`, `.mjs`, `.json`, `.css`, and `.wasm` with correct MIME types and CORS isolation.

3. **`bbebee-sandbox://`**:
   - Serves dynamic HTML skins registered in memory via `sandbox.setHtml(id, html)`.
   - Provides an isolated origin for user-contributed or marketplace player skins.

4. **External Link Guard**:
   - Webview window open handler intercepts target links and ensures only HTTP and HTTPS protocols are opened in the user's default browser via `openExternal`.
