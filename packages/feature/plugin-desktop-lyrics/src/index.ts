/**
 * `plugin-desktop-lyrics` — headless state, controls and settings for desktop floating lyrics.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  DesktopLyricsPosition,
  DesktopLyricsService as IDesktopLyricsService,
  DesktopLyricsState,
  SettingsService,
} from '@BBeBee/protocol'
import { DESKTOP_LYRICS_VIEWS } from './views.js'

export type { DesktopLyricsPosition, DesktopLyricsState }

export class DesktopLyricsService extends Service implements IDesktopLyricsService {
  static inject = []

  private readonly ownCtx: Context
  private settingsService?: SettingsService

  private currentState: DesktopLyricsState = {
    visible: false,
    showNextLine: true,
    fontSize: 24,
    opacity: 0.92,
    position: { x: -1, y: -1 },
    locked: false,
  }

  constructor(ctx: Context) {
    super(ctx, 'desktopLyrics')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-desktop-lyrics: initialized')

    const initialSettings = this.getSettings()
    if (initialSettings) {
      try {
        const s = initialSettings.getSync()
        if (s?.desktopLyrics) {
          this.update({
            visible: s.desktopLyrics.enabled ?? false,
            position: s.desktopLyrics.position ?? { x: -1, y: -1 },
            locked: s.desktopLyrics.locked ?? false,
            fontSize: s.desktopLyrics.fontSize ?? this.currentState.fontSize,
            opacity: s.desktopLyrics.opacity ?? this.currentState.opacity,
          })
        }
      } catch {
        // ignore if not loaded synchronously
      }
    }

    // Bind settings service if available
    this.ownCtx.inject(['settings'], (scoped: Context) => {
      this.settingsService = scoped.settings
      void scoped.settings.get().then((s) => {
        if (s?.desktopLyrics) {
          this.update({
            visible: s.desktopLyrics.enabled ?? false,
            position: s.desktopLyrics.position ?? { x: -1, y: -1 },
            locked: s.desktopLyrics.locked ?? false,
            fontSize: s.desktopLyrics.fontSize ?? this.currentState.fontSize,
            opacity: s.desktopLyrics.opacity ?? this.currentState.opacity,
          })
        }
      })
      scoped.on('settings/changed', (s) => {
        if (s?.desktopLyrics) {
          this.update({
            visible: s.desktopLyrics.enabled ?? this.currentState.visible,
            position: s.desktopLyrics.position ?? this.currentState.position,
            locked: s.desktopLyrics.locked ?? this.currentState.locked,
            fontSize: s.desktopLyrics.fontSize ?? this.currentState.fontSize,
            opacity: s.desktopLyrics.opacity ?? this.currentState.opacity,
          })
        }
      })
    })

    // Contribute commands via ctx.ui if available
    const toggle = () => this.toggleVisible()
    this.ownCtx.inject(['ui'], (scoped: Context) =>
      scoped.effect(function* () {
        scoped.logger.debug('desktop-lyrics: contributing commands')
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'desktop-lyrics.toggle',
          title: 'Toggle desktop lyrics',
          run: toggle,
        })
        yield scoped.ui.contribute({
          kind: 'settings',
          id: DESKTOP_LYRICS_VIEWS.settingsCard,
          section: 'lyrics',
          title: '桌面歌词设置',
          description: '配置悬浮桌面歌词的显示行数、对齐、字体、字号、颜色及透明度',
          icon: 'message',
          display: 'card',
          order: 10,
        })
      }, 'desktop-lyrics-contributions'),
    )

    return () => {
      this.ownCtx.logger.info('plugin-desktop-lyrics: disposing')
    }
  }

  get state(): Readonly<DesktopLyricsState> {
    return this.currentState
  }

  private update(patch: Partial<DesktopLyricsState>): void {
    this.currentState = { ...this.currentState, ...patch }
    this.ownCtx.emit('desktop-lyrics/changed', this.currentState)
  }

  private getSettings(): SettingsService | undefined {
    return (
      this.settingsService ??
      ((this.ownCtx as unknown as { reflect?: { get(key: string, required: boolean): unknown } })
        .reflect?.get?.('settings', false) as SettingsService | undefined)
    )
  }

  private persistToSettings(patch: {
    enabled?: boolean
    position?: DesktopLyricsPosition
    locked?: boolean
  }): void {
    const settings = this.getSettings()
    if (!settings) return
    void settings.get().then((current) => {
      void settings.update({
        desktopLyrics: {
          ...current.desktopLyrics,
          ...patch,
        },
      })
    })
  }

  setState(partial: Partial<DesktopLyricsState>): void {
    this.update(partial)
    const patch: { enabled?: boolean; position?: DesktopLyricsPosition; locked?: boolean } = {}
    if (partial.visible !== undefined) patch.enabled = partial.visible
    if (partial.position !== undefined) patch.position = partial.position
    if (partial.locked !== undefined) patch.locked = partial.locked
    if (Object.keys(patch).length > 0) {
      this.persistToSettings(patch)
    }
  }

  toggleVisible(): void {
    this.setVisible(!this.currentState.visible)
  }

  setVisible(visible: boolean): void {
    this.update({ visible })
    this.persistToSettings({ enabled: visible })
  }

  setShowNextLine(showNextLine: boolean): void {
    this.update({ showNextLine })
  }

  setFontSize(size: number): void {
    const clamped = Math.min(40, Math.max(14, size))
    this.update({ fontSize: clamped })
  }

  setOpacity(opacity: number): void {
    const clamped = Math.min(1.0, Math.max(0.2, opacity))
    this.update({ opacity: clamped })
  }

  setPosition(position: DesktopLyricsPosition): void {
    this.update({ position })
    this.persistToSettings({ position })
  }

  setLocked(locked: boolean): void {
    this.update({ locked })
    this.persistToSettings({ locked })
  }
}

export const name = 'plugin-desktop-lyrics'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-desktop-lyrics: loaded')
  const fiber = await ctx.plugin(DesktopLyricsService)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
