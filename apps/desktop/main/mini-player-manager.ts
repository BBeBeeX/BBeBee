/**
 * Manager for the Mini Player / Dynamic Island BrowserWindow.
 */

import { BrowserWindow, screen, shell, ipcMain } from 'electron'
import { join } from 'node:path'
import type {
  MiniPlayerData,
  MiniPlayerAction,
  MiniPlayerDisplayMode,
  MiniPlayerServiceState,
  MiniPlayerWindowState,
} from '@BBeBee/protocol'

const DIMENSIONS = {
  normal: { width: 380, height: 96 },
  attached: { width: 280, height: 50 },
  expanded: { width: 420, height: 184 },
} as const

const TOP_SNAP_THRESHOLD = 80

function isWebUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export class MiniPlayerWindowManager {
  private window?: BrowserWindow
  private isReady = false
  private programmaticMove = false
  private lastFloatingPos?: { x: number; y: number }
  private mode: MiniPlayerDisplayMode = 'normal'
  private windowState: MiniPlayerWindowState = 'hidden'
  private latestData?: MiniPlayerData

  constructor(
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly here: string,
  ) {}

  public registerIpc(): void {
    ipcMain.handle('mini-player:open', async (_event, options?: { mode?: MiniPlayerDisplayMode }) => {
      await this.open(options)
    })

    ipcMain.handle('mini-player:close', () => {
      this.close()
    })

    ipcMain.handle('mini-player:restore-main', () => {
      this.restoreMain()
    })

    ipcMain.handle('mini-player:set-mode', (_event, mode: MiniPlayerDisplayMode) => {
      this.setMode(mode)
    })

    ipcMain.handle('mini-player:get-state', (): MiniPlayerServiceState => {
      return this.getState()
    })

    ipcMain.handle('mini-player:get-data', (): MiniPlayerData | undefined => {
      return this.latestData
    })

    ipcMain.handle('mini-player:update-data', (_event, data: MiniPlayerData) => {
      this.updateData(data)
    })

    ipcMain.handle('mini-player:send-action', (_event, action: MiniPlayerAction) => {
      this.handleAction(action)
    })
  }

  public getState(): MiniPlayerServiceState {
    const visible = Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
    return {
      visible,
      mode: this.mode,
      windowState: visible ? this.windowState : 'hidden',
    }
  }

  public updateData(data: MiniPlayerData): void {
    this.latestData = data
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('mini-player:data', data)
    }
  }

  public handleAction(action: MiniPlayerAction): void {
    if (action.type === 'restoreMain') {
      this.restoreMain()
      return
    }
    if (action.type === 'close') {
      this.close()
      return
    }
    if (action.type === 'setMode') {
      this.setMode(action.mode)
      return
    }

    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini-player:action', action)
    }
  }

  public async open(options?: { mode?: MiniPlayerDisplayMode }): Promise<void> {
    const targetMode = options?.mode ?? this.mode
    this.mode = targetMode

    if (!this.window || this.window.isDestroyed()) {
      this.createWindow()
    }

    this.applyModeBounds(targetMode)

    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      this.notifyState()
    }

    // Minimize main window to avoid clutter
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      mainWindow.minimize()
    }
  }

  public close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide()
      this.windowState = 'hidden'
      this.notifyState()
    }
    this.restoreMain()
  }

  public restoreMain(): void {
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }
  }

  public setMode(mode: MiniPlayerDisplayMode): void {
    this.mode = mode
    this.applyModeBounds(mode)
    this.notifyState()
  }

  private notifyState(): void {
    const state = this.getState()
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('mini-player:state', state)
    }
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini-player:state', state)
    }
  }

  private createWindow(): BrowserWindow {
    const dims = DIMENSIONS[this.mode]
    let initialX: number | undefined
    let initialY: number | undefined

    try {
      const primary = screen.getPrimaryDisplay()
      if (this.mode === 'attached' || this.mode === 'expanded') {
        initialX = primary.workArea.x + Math.round((primary.workArea.width - dims.width) / 2)
        initialY = primary.workArea.y
      } else if (this.lastFloatingPos) {
        initialX = this.lastFloatingPos.x
        initialY = this.lastFloatingPos.y
      } else {
        initialX = primary.workArea.x + Math.round((primary.workArea.width - dims.width) / 2)
        initialY = primary.workArea.y + Math.round(primary.workArea.height * 0.2)
      }
    } catch {
      // Let Electron choose default
    }

    const win = new BrowserWindow({
      width: dims.width,
      height: dims.height,
      ...(initialX !== undefined && initialY !== undefined ? { x: initialX, y: initialY } : {}),
      backgroundColor: '#00000000',
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(this.here, '../preload/index.cjs'),
      },
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      const targetUrl = new URL(rendererUrl)
      targetUrl.searchParams.set('window', 'mini-player')
      targetUrl.hash = 'mini-player'
      void win.loadURL(targetUrl.toString())
    } else {
      void win.loadFile(join(this.here, '../renderer/index.html'), {
        search: 'window=mini-player',
        hash: 'mini-player',
      })
    }

    win.once('ready-to-show', () => {
      this.isReady = true
      if (this.latestData && !win.isDestroyed()) {
        win.webContents.send('mini-player:data', this.latestData)
      }
      this.notifyState()
    })

    win.webContents.on('did-finish-load', () => {
      if (this.latestData && !win.isDestroyed()) {
        win.webContents.send('mini-player:data', this.latestData)
      }
      this.notifyState()
    })

    let moveTimer: ReturnType<typeof setTimeout> | undefined
    win.on('moved', () => {
      if (this.programmaticMove) return
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        if (this.programmaticMove || win.isDestroyed()) return
        this.handleWindowMoved()
      }, 100)
    })

    win.on('closed', () => {
      if (moveTimer) clearTimeout(moveTimer)
      if (this.window === win) {
        this.window = undefined
        this.isReady = false
        this.windowState = 'hidden'
      }
    })

    this.window = win
    return win
  }

  private handleWindowMoved(): void {
    if (!this.window || this.window.isDestroyed()) return

    const pos = this.window.getPosition()
    const size = this.window.getSize()
    const x = pos[0] ?? 0
    const y = pos[1] ?? 0
    const w = size[0] ?? 0
    const h = size[1] ?? 0
    const center = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) }
    const display = screen.getDisplayNearestPoint(center)

    const distanceToTop = y - display.workArea.y

    if (this.mode === 'normal') {
      if (distanceToTop <= TOP_SNAP_THRESHOLD) {
        // Snapped to top of current display!
        this.setMode('attached')
      } else {
        this.lastFloatingPos = { x, y }
      }
    } else if (this.mode === 'attached' || this.mode === 'expanded') {
      if (distanceToTop > 40) {
        // Dragged down away from top - detach into normal floating window!
        this.lastFloatingPos = { x, y }
        this.setMode('normal')
      }
    }
  }

  private applyModeBounds(mode: MiniPlayerDisplayMode): void {
    if (!this.window || this.window.isDestroyed()) return

    this.programmaticMove = true
    try {
      const curPos = this.window.getPosition()
      const curSize = this.window.getSize()
      const curX = curPos[0] ?? 0
      const curY = curPos[1] ?? 0
      const curW = curSize[0] ?? 0
      const curH = curSize[1] ?? 0
      const center = { x: Math.round(curX + curW / 2), y: Math.round(curY + curH / 2) }
      const display = screen.getDisplayNearestPoint(center)

      const dims = DIMENSIONS[mode]
      let targetX: number
      let targetY: number

      if (mode === 'attached' || mode === 'expanded') {
        targetX = display.workArea.x + Math.round((display.workArea.width - dims.width) / 2)
        targetY = display.workArea.y
        this.windowState = mode === 'expanded' ? 'expanded' : 'attached'
      } else {
        // Normal floating mode
        this.windowState = 'normal'
        if (this.lastFloatingPos) {
          targetX = Math.max(
            display.workArea.x,
            Math.min(display.workArea.x + display.workArea.width - dims.width, this.lastFloatingPos.x),
          )
          targetY = Math.max(
            display.workArea.y + 40,
            Math.min(display.workArea.y + display.workArea.height - dims.height, this.lastFloatingPos.y),
          )
        } else {
          targetX = display.workArea.x + Math.round((display.workArea.width - dims.width) / 2)
          targetY = display.workArea.y + Math.round(display.workArea.height * 0.25)
        }
      }

      this.window.setBounds({
        x: targetX,
        y: targetY,
        width: dims.width,
        height: dims.height,
      })
    } finally {
      setTimeout(() => {
        this.programmaticMove = false
      }, 100)
    }
  }
}
