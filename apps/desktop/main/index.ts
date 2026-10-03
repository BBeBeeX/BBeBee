/**
 * Electron main process — a thin native host.
 *
 * Per ADR-3 the Cordis kernel lives in the **renderer**; this process owns the
 * window, the OS, and Node, and contains **no business logic**. It does not
 * know what a track is. Every handler here is mechanical and has a direct
 * counterpart in an Expo module on the mobile side.
 *
 * See docs/02-architecture.md §2.
 */

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  shell,
  Tray,
  Menu,
  session,
  screen,
} from 'electron'
import { createHost, type Host } from '@BBeBee/core-desktop-bridge/main'
import {
  shouldHideOnClose,
  shouldQuitWhenWindowsGone,
  type CloseContext,
} from './window-policy.js'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, resolve } from 'node:path'
import {
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { Readable } from 'node:stream'
import { pluginDirName } from '@BBeBee/protocol'
import { MiniPlayerWindowManager } from './mini-player-manager.js'
import { createAudioHost } from './audio/index.js'
import { toNativePath } from './fs-path.js'

const here = dirname(fileURLToPath(import.meta.url))

const APP_NAME = 'BBeBee'
app.setName(APP_NAME)

// Unlock Chromium media permissions and Web Audio output device selection
app.commandLine.appendSwitch('enable-experimental-web-platform-features')

// Mitigate Windows 10/11 DirectComposition 1px white border artifact in fullscreen / maximized mode
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-direct-composition')
}

/**
 * Only web URLs may be handed to the OS.
 *
 * `shell.openExternal` launches whatever handler the OS has registered, so
 * `file://`, `smb://` and custom protocol handlers become an execution
 * primitive for anything that can reach this call. Electron's own security
 * guidance is to allow http(s) and nothing else.
 */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Set when the user genuinely means to leave.
 *
 * MD-6: closing the window *hides* it, because the kernel — and therefore the
 * audio graph — lives in the renderer, so destroying the window would stop the
 * music (docs/11 §1.3, docs/10 §M1). Quit goes through the tray or the app
 * menu, and sets this first.
 */
let quitting = false
let closeToTray = true

let tray: Tray | undefined
let audioHost: ReturnType<typeof createAudioHost> | undefined
let mainWindow: BrowserWindow | undefined
const miniPlayerManager = new MiniPlayerWindowManager(() => mainWindow, here)

interface TaskbarState {
  isPlaying: boolean
  canPlayOrPause?: boolean
  canPrevious?: boolean
  canNext?: boolean
  title?: string
  artist?: string
}

let currentTaskbarState: TaskbarState = {
  isPlaying: false,
  canPlayOrPause: false,
  canPrevious: false,
  canNext: false,
}

let taskbarIcons: {
  play: Electron.NativeImage
  pause: Electron.NativeImage
  prev: Electron.NativeImage
  next: Electron.NativeImage
} | undefined

function getTaskbarIcons() {
  if (!taskbarIcons) {
    taskbarIcons = {
      play: nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVR4nGNgGHTg/////yk2AAYoNoAsQ9ANINkQbAaQZBA+A4gyhKYGkO0FojTiMoAkzegGkKyZgRpJme4AABQX3yHuYW/PAAAAAElFTkSuQmCC',
      ),
      pause: nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR4nGNgGH7gPxLAJzZqwKgBtDVg6AEAuPvvESqTjFcAAAAASUVORK5CYII=',
      ),
      prev: nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQklEQVR4nGNgGHLg//////FK4lNASB6vgv9IgCQD/mMBRBuATTPRBuDSTD8DKPYCPkNIMgCbQWQZQIw8UYBiA6gOAD3sDwAezjxJAAAAAElFTkSuQmCC',
      ),
      next: nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVR4nGNgGFTg/////yk2AJ8hhOThCnApIskAbIrJMgBZA9kGwDQNnAEUeQGbPFEG4JMnaAC58pQn5QEBALmoDwA7dTgXAAAAAElFTkSuQmCC',
      ),
    }
  }
  return taskbarIcons
}

let taskbarRetryTimer: ReturnType<typeof setTimeout> | undefined

function updateTaskbar(state: TaskbarState): void {
  currentTaskbarState = state
  const icons = getTaskbarIcons()

  // 1. Windows thumbnail toolbar (setThumbarButtons)
  // Windows ITaskbarList3 requires the window to be visible and mapped on the taskbar.
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && process.platform === 'win32') {
    try {
      const prevFlags: Array<'disabled' | 'dismissonclick' | 'nobackground' | 'hidden' | 'noninteractive'> = []
      if (!state.canPrevious) prevFlags.push('disabled')

      const playFlags: Array<'disabled' | 'dismissonclick' | 'nobackground' | 'hidden' | 'noninteractive'> = []
      if (!state.canPlayOrPause) playFlags.push('disabled')

      const nextFlags: Array<'disabled' | 'dismissonclick' | 'nobackground' | 'hidden' | 'noninteractive'> = []
      if (!state.canNext) nextFlags.push('disabled')

      const success = mainWindow.setThumbarButtons([
        {
          tooltip: '上一曲',
          icon: icons.prev,
          flags: prevFlags,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'previous')
            }
          },
        },
        {
          tooltip: state.isPlaying ? '暂停' : '播放',
          icon: state.isPlaying ? icons.pause : icons.play,
          flags: playFlags,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'togglePlay')
            }
          },
        },
        {
          tooltip: '下一曲',
          icon: icons.next,
          flags: nextFlags,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'next')
            }
          },
        },
      ])

      if (success) {
        if (taskbarRetryTimer) {
          clearTimeout(taskbarRetryTimer)
          taskbarRetryTimer = undefined
        }
      } else {
        if (isDebug()) {
          process.stdout.write(
            '[desktop:taskbar] mainWindow.setThumbarButtons returned false; scheduling retry\n',
          )
        }
        if (!taskbarRetryTimer) {
          taskbarRetryTimer = setTimeout(() => {
            taskbarRetryTimer = undefined
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
              updateTaskbar(currentTaskbarState)
            }
          }, 150)
        }
      }
    } catch (err: unknown) {
      if (isDebug()) {
        process.stdout.write(`[desktop:taskbar] error setting thumbar buttons: ${String(err)}\n`)
      }
    }
  }

  // 2. Tray context menu update (Windows / macOS / Linux)
  if (tray) {
    try {
      const tooltip = state.title
        ? `BBeBee — ${state.title}${state.artist ? ` - ${state.artist}` : ''}`
        : 'BBeBee'
      tray.setToolTip(tooltip)

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
          label: state.isPlaying ? '暂停' : '播放',
          enabled: Boolean(state.canPlayOrPause),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'togglePlay')
            }
          },
        },
        {
          label: '上一曲',
          enabled: Boolean(state.canPrevious),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'previous')
            }
          },
        },
        {
          label: '下一曲',
          enabled: Boolean(state.canNext),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:action', 'next')
            }
          },
        },
        { type: 'separator' },
        { label: '显示主界面', click: () => showWindow() },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true
            app.quit()
          },
        },
      ]
      tray.setContextMenu(Menu.buildFromTemplate(menuTemplate))
    } catch {
      // Tray might not support context menu
    }
  }
}


function isDebug(): boolean {
  const val = process.env['DEBUG'] || process.env['BBEBEE_DEBUG']
  if (val && val !== '0' && val !== 'false') return true
  return process.argv.includes('--debug')
}

function createWindow(): BrowserWindow {
  const iconCandidate = [
    join(here, '../resources/icon.png'),
    join(here, '../../resources/icon.png'),
    join(here, 'resources/icon.png'),
  ].find((p) => existsSync(p))

  let width = 1360
  let height = 860
  try {
    const primary = screen.getPrimaryDisplay()
    if (primary?.workAreaSize) {
      width = Math.min(width, Math.max(720, primary.workAreaSize.width))
      height = Math.min(height, Math.max(480, primary.workAreaSize.height))
    }
  } catch {
    // fallback to static 1360x860
  }

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#05060A',
    frame: false,
    show: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    autoHideMenuBar: true,
    icon: iconCandidate,
    webPreferences: {
      // The security posture from docs/02 §2. None of these are negotiable:
      // the renderer hosts third-party plugin code (docs/03 §6.2).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(here, '../preload/index.cjs'),
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }

  // Forward renderer logs (from plugin-log-console) to the terminal stdout only in debug mode.
  if (isDebug()) {
    window.webContents.on('console-message', (_event, _level, message) => {
      process.stdout.write(`${message}\n`)
    })
  }

  // External links open in the user's browser, never in an app window — an
  // app-window navigation would run untrusted content beside the preload.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * The app is a SPA and never navigates. Chromium's default for a file
   * dragged onto the window is to navigate to it — which would replace the
   * whole app with that raw file — so every page-initiated navigation is
   * refused here. (`loadURL`/`loadFile` above are not page-initiated and do
   * not come through this event; the drop gesture itself is owned by the
   * shell's importer.)
   */
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  /*
   * Close-to-tray (MD-6).
   *
   * `preventDefault` keeps the renderer — and with it the kernel, the queue
   * and the audio graph — alive. Without this, "close the window" and "stop
   * the music" are the same gesture, which is the one thing the exit criterion
   * "playback survives window-hide" forbids.
   *
   * ⚠️ Only where the window can be got back. A Linux session with no
   * StatusNotifier host has no tray, and hiding the last window there leaves a
   * process with no window, no tray and no dock — running, playing, and
   * impossible to reach or quit except from a terminal. Losing playback on
   * close is worse than the alternative everywhere the tray exists, and much
   * better than that.
   */
  window.on('close', (event) => {
    if (shouldHideOnClose(closeContext())) {
      event.preventDefault()
      window.hide()
      return
    }
    if (!quitting) {
      quitting = true
      app.quit()
    }
  })

  window.on('show', () => {
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        updateTaskbar(currentTaskbarState)
      }
    })
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
    if (taskbarRetryTimer) {
      clearTimeout(taskbarRetryTimer)
      taskbarRetryTimer = undefined
    }
  })

  return window
}

function clampToVisibleScreen(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  try {
    const display = screen.getDisplayMatching({ x, y, width, height })
    const { workArea } = display
    const clampedX = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))
    const clampedY = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))
    return { x: clampedX, y: clampedY }
  } catch {
    return { x, y }
  }
}

let lyricWindow: BrowserWindow | undefined
let lyricWindowReady = false
let lyricWindowVisible = false
let lyricWindowLocked = false
let latestLyricData: unknown = undefined
let programmaticMove = false
let lyricCursorTimer: ReturnType<typeof setInterval> | undefined

function setLyricWindowPosition(x: number, y: number): void {
  if (!lyricWindow || lyricWindow.isDestroyed()) return
  const [curX, curY] = lyricWindow.getPosition()
  if (curX === x && curY === y) return
  programmaticMove = true
  try {
    lyricWindow.setPosition(x, y)
  } finally {
    setTimeout(() => {
      programmaticMove = false
    }, 60)
  }
}

/**
 * While the lyrics window is locked (click-through) the renderer cannot rely
 * on forwarded mouse moves — `forward` is a no-op on Linux — so main polls
 * the OS cursor and reports window-relative coordinates instead. `{x:-1,y:-1}`
 * announces that the cursor left the window.
 */
function startLyricCursorTracking(): void {
  if (lyricCursorTimer) return
  let lastInside = false
  lyricCursorTimer = setInterval(() => {
    const win = lyricWindow
    if (!win || win.isDestroyed() || !lyricWindowVisible || !lyricWindowLocked) {
      stopLyricCursorTracking()
      return
    }
    if (!win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getContentBounds()
    const x = Math.round(cursor.x - bounds.x)
    const y = Math.round(cursor.y - bounds.y)
    const inside = x >= 0 && x < bounds.width && y >= 0 && y < bounds.height
    if (inside || lastInside) {
      win.webContents.send('desktop-lyrics:cursor', inside ? { x, y } : { x: -1, y: -1 })
    }
    lastInside = inside
  }, 120)
}

function stopLyricCursorTracking(): void {
  if (lyricCursorTimer) {
    clearInterval(lyricCursorTimer)
    lyricCursorTimer = undefined
  }
}

function createLyricWindow(pos?: { x?: number; y?: number }): BrowserWindow {
  const windowWidth = 860
  const windowHeight = 140

  let initialX: number | undefined
  let initialY: number | undefined

  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && pos.x >= 0 && pos.y >= 0) {
    const clamped = clampToVisibleScreen(pos.x, pos.y, windowWidth, windowHeight)
    initialX = clamped.x
    initialY = clamped.y
  } else {
    try {
      const primary = screen.getPrimaryDisplay()
      initialX = Math.round(primary.workArea.x + (primary.workArea.width - windowWidth) / 2)
      initialY = Math.round(primary.workArea.y + primary.workArea.height - windowHeight - 40)
    } catch {
      // let electron pick default
    }
  }

  const window = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 400,
    minHeight: 80,
    ...(initialX !== undefined && initialY !== undefined ? { x: initialX, y: initialY } : {}),
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(here, '../preload/index.cjs'),
    },
  })

  // Ensure window stays above regular applications
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    const targetUrl = new URL(rendererUrl)
    targetUrl.searchParams.set('window', 'desktop-lyrics')
    targetUrl.hash = 'desktop-lyrics'
    void window.loadURL(targetUrl.toString())
  } else {
    void window.loadFile(join(here, '../renderer/index.html'), {
      search: 'window=desktop-lyrics',
      hash: 'desktop-lyrics',
    })
  }

  window.once('ready-to-show', () => {
    lyricWindowReady = true
    if (lyricWindowVisible && !window.isDestroyed()) {
      window.showInactive()
    }
    if (latestLyricData && !window.isDestroyed()) {
      window.webContents.send('desktop-lyrics:data', latestLyricData)
    }
  })

  window.webContents.on('did-finish-load', () => {
    if (latestLyricData && !window.isDestroyed()) {
      window.webContents.send('desktop-lyrics:data', latestLyricData)
    }
  })

  let moveTimer: ReturnType<typeof setTimeout> | undefined
  window.on('moved', () => {
    if (programmaticMove) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (programmaticMove || window.isDestroyed()) return
      const [x, y] = window.getPosition()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop-lyrics:moved', { x, y })
      }
    }, 150)
  })

  window.on('closed', () => {
    if (moveTimer) clearTimeout(moveTimer)
    if (lyricWindow === window) {
      lyricWindow = undefined
      lyricWindowReady = false
      lyricWindowVisible = false
      stopLyricCursorTracking()
    }
  })

  return window
}

/** The three facts the window policy decides from. */
function closeContext(): CloseContext {
  return { quitting, hasTray: tray !== undefined, platform: process.platform, closeToTray }
}

function showWindow(): void {
  const window = mainWindow ?? createWindow()
  mainWindow = window
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * The tray, and deliberately nothing more.
 *
 * MD-6 puts the mini-player in a later milestone: this exists so a hidden
 * window is reachable and the app is quittable, which is the whole of what
 * close-to-tray owes the user.
 *
 * The icon ships as `resources/tray-icon.png`. A missing icon file makes
 * `new Tray()` throw and take the boot with it, so the transparent
 * placeholder stays as the fallback — an empty tray slot beats a dead boot.
 */
function createTray(): Tray | undefined {
  try {
    const trayIconPath = [
      join(here, '../resources/tray-icon.png'),
      join(here, '../../resources/tray-icon.png'),
      join(here, 'resources/tray-icon.png'),
    ].find((p) => existsSync(p))
    const icon = trayIconPath
      ? nativeImage.createFromPath(trayIconPath)
      : nativeImage.createFromDataURL(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkklEQVR42u3XwQqAIAzGcR/BQ+//ltKx6BaC+on7OyMHHgLZfoxlFsKOlSOl83oWtV9OqCY1B/QkRgqrCLx4rRDW9nwGepc7wASyPCDGI6AIBaAgcEALMQVQQ0wDlBDTZqCEcAXgr2Fe8P2Mn4QtgEsH8CFUJ98EoRT/D2CkONYB/LNscR9AT8JPAFyuZPufsidu5RtMtHn4VVsAAAAASUVORK5CYII=',
        )
    const created = new Tray(icon)
    created.setToolTip('BBeBee')
    created.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show BBeBee', click: () => showWindow() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true
            app.quit()
          },
        },
      ]),
    )
    created.on('click', () => showWindow())
    return created
  } catch {
    // A Linux session with no StatusNotifier host has no tray. The window
    // still hides on close and is reachable from the dock or the app menu.
    return undefined
  }
}

function parsePluginRequestUrl(rawUrl: string): { pluginId: string; subPath: string } | undefined {
  try {
    const url = new URL(rawUrl)
    // Handle bbebee-plugin://app/<pluginId>/<subPath> or bbebee-plugin://plugin/<pluginId>/<subPath>
    if (url.host === 'app' || url.host === 'plugin') {
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      const rawId = parts[0]
      if (!rawId) return undefined
      const pluginId = decodeURIComponent(rawId)
      const subPath = parts.slice(1).join('/') || 'index.js'
      return { pluginId, subPath }
    }
    // Handle bbebee-plugin://<pluginId>/<subPath>
    const pluginId = decodeURIComponent(url.host)
    const subPath = url.pathname.replace(/^\/+/, '') || 'index.js'
    return { pluginId, subPath }
  } catch {
    return undefined
  }
}

function getInstalledPluginsDir(): string {
  const dir = join(app.getPath('userData'), 'installed-plugins')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function resolvePluginDir(pluginId: string): string | undefined {
  const root = getInstalledPluginsDir()
  // 1. Check pluginDirName(pluginId)
  const hashedName = pluginDirName(pluginId)
  const hashedPath = join(root, hashedName)
  if (existsSync(hashedPath)) return hashedPath

  // 2. Check exact sanitized name
  const sanitized = pluginId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const directPath = join(root, sanitized)
  if (existsSync(directPath)) return directPath

  // 3. Check versioned matches (e.g. pluginId@version)
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name === pluginId ||
          entry.name.startsWith(`${pluginId}@`) ||
          entry.name.startsWith(`${hashedName}@`))
      ) {
        return join(root, entry.name)
      }
    }
  } catch {
    // ignore
  }

  return undefined
}

/**
 * The IPC surface.
 *
 * Deliberately tiny: `paths` and `safeStorage` are the things the renderer
 * genuinely cannot do for itself. Everything else that needs Node goes through
 * `createHost` below, which is machinery rather than app surface.
 */
function registerHandlers(): void {
  ipcMain.handle('paths:get', (_event, kind: string) => {
    try {
      return app.getPath(kind as Parameters<typeof app.getPath>[0])
    } catch {
      // Not every kind exists on every platform; `undefined` is the contract.
      return undefined
    }
  })

  /*
   * The OS keychain, which only `main` can reach.
   *
   * ⚠️ Without this the desktop credential store falls back to XOR against a
   * key derived from the install path — obfuscation, not protection, and the
   * shipped build was running on it because nothing ever injected a real
   * codec. `isHardwareBacked` was honest about it, but honesty is not the
   * feature; the keychain is.
   *
   * Encryption happens here rather than in the renderer because
   * `safeStorage` is main-only. The renderer sends a string and receives an
   * opaque one back; the key never crosses the bridge, because there is no
   * key to cross — `safeStorage` holds it in the OS.
   */
  ipcMain.handle('secrets:available', () => safeStorage.isEncryptionAvailable())

  ipcMain.handle('secrets:encrypt', (_event, plain: string) => {
    if (typeof plain !== 'string') throw new Error('secrets: expected a string')
    return safeStorage.encryptString(plain).toString('base64')
  })

  ipcMain.handle('secrets:decrypt', (_event, cipher: string) => {
    if (typeof cipher !== 'string') throw new Error('secrets: expected a string')
    // A value written by another install, or on another machine, will not
    // decrypt. Throwing is right: the store treats it as absent and asks the
    // user to sign in again, which is recoverable.
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!isWebUrl(url)) throw new Error(`refusing to open a non-web url: ${url}`)
    await shell.openExternal(url)
  })

  ipcMain.handle('dialog:pickDirectory', async (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    const window = target && !target.isDestroyed() ? target : undefined
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  })

  /*
   * DevTools on demand, from the debug page.
   *
   * There is no application menu (`Menu.setApplicationMenu(null)`), so
   * without this the only way in was a packaged build's absence of one.
   * Detached, because the renderer is a fixed grid and a docked inspector
   * would reflow it for as long as it is open.
   */
  ipcMain.handle('devtools:open', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.webContents.openDevTools({ mode: 'detach' })
  })

  ipcMain.handle('window:minimize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target) {
      if (target.isMaximized()) {
        target.unmaximize()
      } else {
        target.maximize()
      }
    }
  })

  ipcMain.handle('window:close', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    target?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    return target?.isMaximized() ?? false
  })

  ipcMain.handle('window:setCloseToTray', (_event, enabled: boolean) => {
    closeToTray = Boolean(enabled)
  })

  ipcMain.handle('window:toggle', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      showWindow()
      return
    }
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })

  ipcMain.handle('shell:openPath', async (_event, fullPath: string) => {
    if (typeof fullPath !== 'string' || !fullPath) return ''
    let localPath = fullPath
    if (localPath.startsWith('file://')) {
      try {
        localPath = fileURLToPath(localPath)
      } catch {
        localPath = decodeURIComponent(localPath.replace(/^file:\/\/\/?/, ''))
      }
    }
    if (localPath === 'cache' || localPath.includes('默认缓存目录')) {
      localPath = join(app.getPath('userData'), 'Cache')
    } else if (localPath === 'downloads' || localPath.includes('默认下载目录')) {
      localPath = join(app.getPath('downloads'), 'BBeBee')
    }
    try {
      if (!existsSync(localPath)) {
        mkdirSync(localPath, { recursive: true })
      }
    } catch {
      // ignore
    }
    return shell.openPath(localPath)
  })

  function buildProxyRules(config: { protocol?: string; host?: string; port?: number }): string {
    if (!config?.host || !config?.port) return ''
    const proto = (config.protocol || 'http').toLowerCase()
    const host = config.host.trim()
    const port = config.port
    if (proto === 'socks5' || proto === 'socks') {
      return `socks5://${host}:${port}`
    }
    if (proto === 'socks4') {
      return `socks4://${host}:${port}`
    }
    // For HTTP/HTTPS, explicitly forward both http and https via the proxy
    return `http=${host}:${port};https=${host}:${port}`
  }

  let activeProxyAuth: { username?: string; password?: string } | null = null
  let testProxyAuth: { username?: string; password?: string } | null = null

  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (authInfo.isProxy) {
      if (testProxyAuth && (testProxyAuth.username || testProxyAuth.password)) {
        event.preventDefault()
        callback(testProxyAuth.username || '', testProxyAuth.password || '')
        return
      }
      if (activeProxyAuth && (activeProxyAuth.username || activeProxyAuth.password)) {
        event.preventDefault()
        callback(activeProxyAuth.username || '', activeProxyAuth.password || '')
        return
      }
    }
  })

  ipcMain.handle(
    'proxy:test',
    async (
      _event,
      config: {
        protocol: string
        host: string
        port: number
        username?: string
        password?: string
      },
    ) => {
      const start = Date.now()
      if (!config?.host || !config?.port) {
        return { ok: false, error: '代理服务器地址或端口不能为空' }
      }

      const proxyRule = buildProxyRules(config)
      const partition = 'proxy-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
      const testSession = session.fromPartition(partition)

      if (config.username || config.password) {
        testProxyAuth = { username: config.username, password: config.password }
      }

      try {
        await testSession.setProxy({ proxyRules: proxyRule })

        const testUrls = [
          'https://www.google.com/generate_204',
          'https://www.gstatic.com/generate_204',
          'https://www.google.com',
        ]

        let lastError: unknown = null
        for (const url of testUrls) {
          try {
            // Note: Must use testSession.fetch, NOT net.fetch!
            // net.fetch issues requests from session.defaultSession, bypassing testSession proxy.
            const res = await testSession.fetch(url, {
              method: 'GET',
              signal: AbortSignal.timeout(10000),
            })
            if (res.status < 500) {
              return { ok: true, latencyMs: Date.now() - start }
            }
          } catch (err) {
            lastError = err
          }
        }

        return {
          ok: false,
          error: lastError instanceof Error ? lastError.message : String(lastError || '连接超时'),
        }
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        testProxyAuth = null
        await testSession.closeAllConnections().catch(() => {})
      }
    },
  )

  ipcMain.handle(
    'proxy:set',
    async (
      _event,
      config: {
        enabled: boolean
        protocol?: string
        host?: string
        port?: number
        username?: string
        password?: string
      },
    ) => {
      if (!config?.enabled || !config.host || !config.port) {
        activeProxyAuth = null
        await session.defaultSession.setProxy({ mode: 'direct' })
        await session.defaultSession.closeAllConnections().catch(() => {})
        return
      }
      activeProxyAuth = { username: config.username, password: config.password }
      const proxyRule = buildProxyRules(config)
      await session.defaultSession.setProxy({ proxyRules: proxyRule })
      await session.defaultSession.closeAllConnections().catch(() => {})
    },
  )

  ipcMain.handle(
    'desktop-lyrics:set-visible',
    (_event, visible: boolean, position?: { x: number; y: number }) => {
      lyricWindowVisible = Boolean(visible)
      if (visible) {
        if (!lyricWindow || lyricWindow.isDestroyed()) {
          lyricWindowReady = false
          lyricWindow = createLyricWindow(position)
        } else if (
          position &&
          typeof position.x === 'number' &&
          typeof position.y === 'number' &&
          position.x >= 0 &&
          position.y >= 0
        ) {
          const clamped = clampToVisibleScreen(position.x, position.y, 860, 140)
          setLyricWindowPosition(clamped.x, clamped.y)
        }
        if (lyricWindowReady && !lyricWindow.isDestroyed()) {
          lyricWindow.showInactive()
        }
      } else {
        if (lyricWindow && !lyricWindow.isDestroyed()) {
          lyricWindow.hide()
        }
      }
      if (lyricWindowVisible && lyricWindowLocked) {
        startLyricCursorTracking()
      } else {
        stopLyricCursorTracking()
      }
    },
  )

  ipcMain.handle('desktop-lyrics:set-position', (_event, position: { x: number; y: number }) => {
    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
      const clamped = clampToVisibleScreen(position.x, position.y, 860, 140)
      if (!lyricWindow || lyricWindow.isDestroyed()) {
        lyricWindowReady = false
        lyricWindow = createLyricWindow(clamped)
      } else {
        setLyricWindowPosition(clamped.x, clamped.y)
      }
    }
  })

  ipcMain.handle('desktop-lyrics:get-position', () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const [x, y] = lyricWindow.getPosition()
      return { x, y }
    }
    return undefined
  })

  // A renderer-driven drag moves the window through `set-position`, whose
  // echoes are suppressed; the drag end reports the final position here so it
  // re-enters persistence through the same `moved` channel a native move uses.
  ipcMain.handle(
    'desktop-lyrics:commit-position',
    (_event, position: { x: number; y: number }) => {
      if (
        position &&
        typeof position.x === 'number' &&
        typeof position.y === 'number' &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        const clamped = clampToVisibleScreen(position.x, position.y, 860, 140)
        mainWindow.webContents.send('desktop-lyrics:moved', { x: clamped.x, y: clamped.y })
      }
    },
  )

  ipcMain.handle('desktop-lyrics:get-data', () => {
    return latestLyricData
  })

  ipcMain.handle('desktop-lyrics:set-locked', (_event, locked: boolean) => {
    lyricWindowLocked = Boolean(locked)
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.setIgnoreMouseEvents(lyricWindowLocked, { forward: true })
    }
    if (lyricWindowLocked && lyricWindowVisible) {
      startLyricCursorTracking()
    } else {
      stopLyricCursorTracking()
    }
  })

  // The click-through lyrics window keeps one interactive hotspot (the unlock
  // pill); the renderer flips mouse handling as the polled cursor crosses it.
  ipcMain.handle('desktop-lyrics:set-ignore-mouse', (_event, ignore: boolean) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
    }
  })

  ipcMain.handle('desktop-lyrics:update-data', (_event, data: unknown) => {
    latestLyricData = data
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send('desktop-lyrics:data', data)
    }
  })

  ipcMain.handle('desktop-lyrics:send-action', (_event, action: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop-lyrics:action', action)
    }
  })

  ipcMain.handle('taskbar:update', (_event, state: TaskbarState) => {
    if (state && typeof state === 'object') {
      updateTaskbar(state)
    }
  })

  ipcMain.handle('plugins:list-installed', async () => {
    try {
      const root = getInstalledPluginsDir()
      const entries = readdirSync(root, { withFileTypes: true })
      const plugins: Array<{ id: string; version: string; manifest: unknown; dirName: string }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = join(root, entry.name, 'manifest.json')
        const pkgJsonPath = join(root, entry.name, 'package.json')

        let manifest: Record<string, unknown> | undefined
        if (existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
          } catch {
            // ignore malformed manifest
          }
        } else if (existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>
            if (pkg['manifest'] && typeof pkg['manifest'] === 'object') {
              manifest = pkg['manifest'] as Record<string, unknown>
            } else {
              manifest = {
                id: pkg['name'],
                version: pkg['version'] ?? '1.0.0',
                displayName: pkg['displayName'] ?? pkg['name'],
                entry: { main: pkg['main'] ?? './index.js' },
                capabilities: pkg['capabilities'] ?? [],
              }
            }
          } catch {
            // ignore malformed pkg
          }
        }

        if (manifest && manifest['id']) {
          plugins.push({
            id: String(manifest['id']),
            version: String(manifest['version'] ?? '1.0.0'),
            manifest,
            dirName: entry.name,
          })
        }
      }
      return plugins
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'plugins:install',
    async (_event, pluginId: string, files: Record<string, string>) => {
      if (!pluginId || typeof pluginId !== 'string') {
        throw new Error('pluginId is required')
      }
      const root = getInstalledPluginsDir()
      const targetDir = join(root, pluginDirName(pluginId))
      mkdirSync(targetDir, { recursive: true })

      for (const [relPath, content] of Object.entries(files)) {
        const filePath = resolve(targetDir, relPath)
        if (!filePath.startsWith(resolve(targetDir))) {
          throw new Error(`Path traversal rejected: ${relPath}`)
        }
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, content, 'utf8')
      }
      return { ok: true, pluginId, path: targetDir }
    },
  )

  ipcMain.handle('plugins:uninstall', async (_event, pluginId: string) => {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('pluginId is required')
    }
    const dir = resolvePluginDir(pluginId)
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      return { ok: true }
    }
    return { ok: false, message: 'Plugin directory not found' }
  })

  miniPlayerManager.registerIpc()
}

/** Media keys, as the protocol names them. */
const MEDIA_KEYS: Record<string, 'play-pause' | 'next' | 'previous' | 'stop'> = {
  MediaPlayPause: 'play-pause',
  MediaNextTrack: 'next',
  MediaPreviousTrack: 'previous',
  MediaStop: 'stop',
}

/**
 * The OS integrations `ctx.device`, `ctx.background` and `ctx.mediaSession`
 * reach through the bridge.
 *
 * Every one of these was a no-op until now: `createHost` was called without a
 * `system` option, so `acquireWakeLock` resolved and blocked nothing, and a
 * media key reached nothing at all.
 */
function systemHost(host: () => Host | undefined) {
  /** `powerSaveBlocker` ids, keyed by the renderer's lock id. */
  const blockers = new Map<number, number>()
  const hotkeys = new Set<string>()

  return {
    acquireWakeLock(id: number, reason: string): void {
      if (blockers.has(id)) return
      // `prevent-app-suspension` keeps the process scheduled without keeping
      // the display awake — the right one for audio, which does not need a
      // lit screen and should not burn a laptop battery holding one.
      void reason
      blockers.set(id, powerSaveBlocker.start('prevent-app-suspension'))
    },
    releaseWakeLock(id: number): void {
      const blocker = blockers.get(id)
      if (blocker === undefined) return
      blockers.delete(id)
      if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
    },

    watchMediaKeys(on: boolean): void {
      for (const [accelerator, key] of Object.entries(MEDIA_KEYS)) {
        if (on) {
          // Registration fails when another app holds the key. That is a
          // feature lost, not a boot lost.
          try {
            globalShortcut.register(accelerator, () => {
              host()?.emit({ topic: 'media-key', key })
            })
          } catch {
            /* another app owns it */
          }
        } else {
          globalShortcut.unregister(accelerator)
        }
      }
    },

    registerHotkey(accelerator: string): void {
      if (hotkeys.has(accelerator)) return
      try {
        globalShortcut.register(accelerator, () => {
          host()?.emit({ topic: 'hotkey', accelerator })
        })
        hotkeys.add(accelerator)
      } catch {
        /* an unparseable or taken accelerator costs one hotkey */
      }
    },
    unregisterHotkey(accelerator: string): void {
      if (!hotkeys.delete(accelerator)) return
      globalShortcut.unregister(accelerator)
    },

    /*
     * ⚠️ MPRIS, SMTC and the macOS Now Playing centre.
     *
     * Chromium publishes all three itself from the renderer's
     * `navigator.mediaSession`, which `core-media-session-electron` already
     * drives — but only while an `HTMLMediaElement` is playing. That is true
     * for a streamed source and false for a buffered one, which plays through
     * an `AudioBufferSourceNode` and is invisible to the OS.
     *
     * Electron exposes no API to publish a session without an element, so
     * these stay no-ops and the tooltip carries what it can. Closing the gap
     * needs a native module per platform; it is named in docs/11 §6 as a
     * manual check for exactly this reason, and the honest behaviour meanwhile
     * is to do nothing rather than to look like it worked.
     */
    publishNowPlaying(nowPlaying: unknown): void {
      const title = (nowPlaying as { title?: string } | undefined)?.title
      tray?.setToolTip(typeof title === 'string' && title ? `BBeBee — ${title}` : 'BBeBee')
    },
    publishPlaybackState(): void {},
    setSupportedCommands(): void {},
    clearNowPlaying(): void {
      tray?.setToolTip('BBeBee')
    },
  }
}

/**
 * Privileged custom scheme for local media/artwork assets.
 *
 * Chromium sandboxes the renderer with contextIsolation and strict CSP,
 * disallowing direct `file://` fetch/rendering. `bbebee-file://` serves
 * local files through Electron's net.fetch in the main process.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bbebee-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
  {
    scheme: 'bbebee-plugin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
])

// `toNativePath` lives in ./fs-path.js (shared with the ffmpeg decoder, which
// must decode exactly the same way the protocol handler does).

function getFileMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp3': return 'audio/mpeg'
    case '.flac': return 'audio/flac'
    case '.wav': return 'audio/wav'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    case '.ogg': case '.oga': return 'audio/ogg'
    case '.opus': return 'audio/opus'
    case '.weba': return 'audio/webm'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function parseByteRange(rangeHeader: string, totalSize: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return undefined
  const [, startStr, endStr] = match
  if (!startStr && !endStr) return undefined
  if (!startStr) {
    const suffix = parseInt(endStr ?? '', 10)
    if (isNaN(suffix) || suffix <= 0) return undefined
    const start = Math.max(0, totalSize - suffix)
    return { start, end: totalSize - 1 }
  }
  const start = parseInt(startStr, 10)
  if (isNaN(start) || start >= totalSize) return undefined
  let end = endStr ? parseInt(endStr, 10) : totalSize - 1
  if (isNaN(end) || end >= totalSize) end = totalSize - 1
  if (start > end) return undefined
  return { start, end }
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  /*
   * Stream request headers, keyed at three granularities — origin, hostname,
   * and the hostname's registrable domain.
   *
   * Registered per resolved stream by the player (through the preload bridge)
   * and applied below by `onBeforeSendHeaders`, because a media element's
   * request cannot set `Referer`/`User-Agent` itself and the CDNs that need
   * them refuse the request without.
   *
   * ⚠️ Keyed by host, never by the exact URL. A per-URL map has two defects:
   * it grows by an entry per resolved track for as long as the app runs, and
   * it loses the redirect — a CDN routinely answers a mirror with a 302 to
   * another mirror of the same domain, and only the domain key survives that.
   */
  const streamHeaders = new Map<string, Record<string, string>>()

  ipcMain.handle(
    'stream:set-headers',
    (_event, entry: { url: string; headers: Record<string, string> }) => {
      if (!entry?.url || !entry?.headers) return
      try {
        const u = new URL(entry.url)
        const labels = u.hostname.split('.')
        const domain = labels.slice(-2).join('.')
        streamHeaders.set(u.origin, entry.headers)
        streamHeaders.set(u.hostname, entry.headers)
        if (labels.length > 2) streamHeaders.set(domain, entry.headers)
      } catch {
        // ignore invalid url
      }
    },
  )

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media' || (permission as string) === 'speaker-selection') {
      return true
    }
    return false
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || (permission as string) === 'speaker-selection') {
      callback(true)
      return
    }
    callback(false)
  })

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const u = new URL(details.url)
      const labels = u.hostname.split('.')
      const matched =
        streamHeaders.get(u.origin) ??
        streamHeaders.get(u.hostname) ??
        (labels.length > 2 ? streamHeaders.get(labels.slice(-2).join('.')) : undefined)
      if (matched) {
        for (const [k, v] of Object.entries(matched)) {
          details.requestHeaders[k] = v
        }
      }
    } catch {
      // ignore header inspection error
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    responseHeaders['access-control-allow-origin'] = ['*']
    responseHeaders['access-control-allow-methods'] = ['GET, HEAD, OPTIONS']
    callback({ responseHeaders })
  })

  protocol.handle('bbebee-file', (request) => {
    try {
      const filePath = toNativePath(request.url)
      if (existsSync(filePath)) {
        const stats = statSync(filePath)
        const rangeHeader = request.headers.get('range')
        const contentType = getFileMimeType(filePath)
        const baseHeaders: Record<string, string> = {
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Content-Type': contentType,
        }

        if (rangeHeader) {
          const range = parseByteRange(rangeHeader, stats.size)
          if (!range) {
            return new Response(null, {
              status: 416,
              statusText: 'Range Not Satisfiable',
              headers: {
                ...baseHeaders,
                'Content-Range': `bytes */${stats.size}`,
              },
            })
          }

          const chunkSize = range.end - range.start + 1
          const nodeStream = createReadStream(filePath, { start: range.start, end: range.end })
          return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
              'Content-Length': String(chunkSize),
            },
          })
        }

        const nodeStream = createReadStream(filePath)
        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
          status: 200,
          statusText: 'OK',
          headers: {
            ...baseHeaders,
            'Content-Length': String(stats.size),
          },
        })
      }
    } catch {
      // ignore path resolution failure
    }

    return new Response('File Not Found', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    })
  })

  protocol.handle('bbebee-plugin', async (request) => {
    try {
      const parsed = parsePluginRequestUrl(request.url)
      if (!parsed) {
        return new Response('Invalid plugin URL', { status: 400 })
      }

      const pluginDir = resolvePluginDir(parsed.pluginId)
      if (!pluginDir) {
        return new Response(`Plugin not found: ${parsed.pluginId}`, { status: 404 })
      }

      const safePath = resolve(pluginDir, parsed.subPath)
      // Guard against directory traversal
      if (!safePath.startsWith(resolve(pluginDir))) {
        return new Response('Forbidden', { status: 403 })
      }

      if (existsSync(safePath) && statSync(safePath).isFile()) {
        const stats = statSync(safePath)
        const ext = extname(safePath).toLowerCase()
        let contentType = 'application/octet-stream'
        if (ext === '.js' || ext === '.mjs') contentType = 'text/javascript; charset=utf-8'
        else if (ext === '.json') contentType = 'application/json; charset=utf-8'
        else if (ext === '.css') contentType = 'text/css; charset=utf-8'
        else if (ext === '.wasm') contentType = 'application/wasm'
        else contentType = getFileMimeType(safePath)

        const content = readFileSync(safePath)
        return new Response(content, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(stats.size),
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    } catch {
      // ignore resolution failure
    }

    return new Response('Plugin File Not Found', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    })
  })

  registerHandlers()

  tray = createTray()
  mainWindow = createWindow()
  // Synchronizes tray state immediately; Windows thumbnail toolbar will attach
  // automatically once the window becomes visible ('show' event) to ensure HWND mapping.
  updateTaskbar(currentTaskbarState)

  // A holder rather than a bare binding: `systemHost` needs to reach the host
  // to emit events, and it is constructed as an argument *to* the call that
  // creates it. The indirection is the knot being tied, not an accident.
  const bridge: { host?: Host } = {}
  // The real fs/db live here, in main. ADR-3 puts the kernel in the renderer,
  // which is sandboxed and cannot reach Node — so the renderer's core services
  // are thin IPC clients over this host (docs/02 §2).
  bridge.host = await createHost(
    {
      handle: ipcMain.handle.bind(ipcMain),
      removeHandler: ipcMain.removeHandler.bind(ipcMain),
      broadcast: (channel, payload) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(channel, payload)
        }
      },
    },
    {
      appName: 'BBeBee',
      resolvePath: (kind) => {
        try {
          return app.getPath(kind as Parameters<typeof app.getPath>[0])
        } catch {
          return undefined
        }
      },
      /*
       * `ctx.http`'s transport.
       *
       * `net.fetch` uses Chromium's network stack from `main`, where no CORS
       * policy applies and every header is settable — which is what a source
       * pointed at someone else's Navidrome needs (docs/11 §4.5).
       */
      httpFetch: (url, init) =>
        net.fetch(url, init as Parameters<typeof net.fetch>[1]) as never,
      system: systemHost(() => bridge.host),
      pickDirectory: async (sender) => {
        const target = (sender ? BrowserWindow.fromWebContents(sender as Electron.WebContents) : undefined) ?? mainWindow
        const window = target && !target.isDestroyed() ? target : undefined
        const result = window
          ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] })
        return result.canceled ? undefined : result.filePaths[0]
      },
      audio: (audioHost = createAudioHost({
        info: (msg, ...args) => process.stdout.write(`[desktop:audio] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        warn: (msg, ...args) => process.stdout.write(`[desktop:audio:WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        error: (msg, ...args) => process.stderr.write(`[desktop:audio:ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        debug: (msg, ...args) => {
          if (isDebug()) process.stdout.write(`[desktop:audio:DEBUG] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
        },
      })),
      logger: {
        info: (msg, ...args) => process.stdout.write(`[desktop:bridge] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        warn: (msg, ...args) => process.stdout.write(`[desktop:bridge:WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        error: (msg, ...args) => process.stderr.write(`[desktop:bridge:ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
        debug: (msg, ...args) => {
          if (isDebug()) process.stdout.write(`[desktop:bridge:DEBUG] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
        },
      },
    },
  )

  /*
   * Suspend, forwarded so `ctx.background.onWillSuspend` is a hook that
   * actually fires — the player checkpoints its position on it, and a hook
   * that never fires is worse than no hook (docs/11 §4.3).
   */
  powerMonitor.on('suspend', () => bridge.host?.emit({ topic: 'will-suspend' }))

  app.on('activate', () => {
    showWindow()
  })
})

/**
 * Quit is an explicit act.
 *
 * MD-6 keeps the renderer alive when the window closes, so `window-all-closed`
 * now fires only when something destroyed the window on purpose. The tray and
 * the app menu set `quitting` first.
 */
app.on('before-quit', () => {
  quitting = true
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    lyricWindow.destroy()
    lyricWindow = undefined
  }
})

app.on('window-all-closed', () => {
  // Reached only when a window was genuinely destroyed: either the user is
  // quitting, or this build has nowhere to hide to and the close went through.
  if (shouldQuitWhenWindowsGone(closeContext())) app.quit()
})

app.on('will-quit', () => {
  audioHost?.supervisor.dispose()
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = undefined
})
