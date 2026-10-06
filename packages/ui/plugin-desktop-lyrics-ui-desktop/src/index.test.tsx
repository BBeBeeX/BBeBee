// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { AppSettings, TransportState } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { DesktopLyrics } from './DesktopLyrics.js'
import { DesktopLyricsSettingsCard } from './DesktopLyricsSettingsCard.js'
import { DESKTOP_LYRICS_VIEWS } from '@BBeBee/plugin-desktop-lyrics/views'
import pluginDesktopLyricsUi from './index.js'

class UiStub extends Service {
  public views = new Map<string, any>()
  public slots = new Map<string, { id: string; slot: string; order?: number }[]>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  contribute(c: { kind: string; id: string; slot?: string; order?: number }) {
    if (c.kind === 'slot' && c.slot) {
      const list = this.slots.get(c.slot) ?? []
      list.push({ id: c.id, slot: c.slot, order: c.order })
      this.slots.set(c.slot, list)
    }
    return () => {}
  }

  slotsFor(slot: string) {
    return this.slots.get(slot) ?? []
  }
}

class PlayerStub extends Service {
  public transport: TransportState = {
    status: 'playing',
    positionMs: 4000,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
    nowPlaying: {
      title: 'Floating Song',
      artist: 'Floating Artist',
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }

  setPosition(ms: number) {
    this.transport.positionMs = ms
    this.ctx.emit('player/position', ms, this.transport.durationMs)
    this.ctx.emit('player/state-changed', this.transport)
  }
}

class LyricsStub extends Service {
  public currentState = {
    status: 'ready' as const,
    offsetMs: 0,
    lyrics: {
      format: 'lrc' as const,
      content: '[00:01.00]First Floating Lyric\n[00:06.00]Second Floating Lyric',
      synced: true,
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'lyrics')
  }

  get state() {
    return this.currentState
  }

  setLyrics(content: string, status: any = 'ready') {
    this.currentState = {
      status,
      offsetMs: 0,
      lyrics: {
        format: 'lrc' as const,
        content,
        synced: true,
      },
    }
    this.ctx.emit('lyrics/changed', this.currentState)
  }
}

class DesktopLyricsStub extends Service {
  private currentState = {
    visible: true,
    showNextLine: true,
    fontSize: 22,
    opacity: 0.9,
    position: { x: 0, y: 0 },
    locked: false,
  }

  constructor(ctx: Context) {
    super(ctx, 'desktopLyrics')
  }

  get state() {
    return this.currentState
  }

  setVisible(v: boolean) {
    this.currentState.visible = v
    this.ctx.emit('desktop-lyrics/changed', this.currentState)
  }
}

class SettingsStub extends Service {
  public current: AppSettings = { ...DEFAULT_APP_SETTINGS }
  private appCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'settings')
    this.appCtx = ctx
  }

  getSync = (): AppSettings => this.current

  update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    this.calls.push(`update:${JSON.stringify(patch)}`)
    this.current = {
      ...this.current,
      ...patch,
      desktopLyrics: { ...this.current.desktopLyrics, ...(patch.desktopLyrics ?? {}) },
    }
    this.appCtx.emit('settings/changed', this.current)
    return this.current
  }

  public calls: string[] = []
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  await ctx.plugin(DesktopLyricsStub)
  await ctx.plugin(SettingsStub)
  await ctx.plugin(pluginDesktopLyricsUi)

  const player = (ctx as unknown as { player: PlayerStub }).player
  const lyrics = (ctx as unknown as { lyrics: LyricsStub }).lyrics
  const desktopLyrics = (ctx as unknown as { desktopLyrics: DesktopLyricsStub }).desktopLyrics
  const settings = (ctx as unknown as { settings: SettingsStub }).settings

  return { ctx, player, lyrics, desktopLyrics, settings }
}

describe('DesktopLyrics', () => {
  it('registers view with ui service upon load', async () => {
    const { ctx } = await createHarness()
    expect(ctx.ui.viewFor('desktop-lyrics.floating')).toBeDefined()
    expect(ctx.ui.viewFor('desktop-lyrics.toggle')).toBeDefined()
    expect(ctx.ui.slotsFor('now-playing.actions')).toEqual([
      { id: 'desktop-lyrics.toggle', slot: 'now-playing.actions', order: 20 },
    ])
  })

  it('renders floating overlay and lyrics line', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))

    expect(html).toContain('Desktop lyrics overlay')
    expect(html).toContain('First Floating Lyric')
    expect(html).toContain('Second Floating Lyric')
  })

  it('renders prelude with song title and upcoming first lyric', async () => {
    const { ctx, player } = await createHarness()
    player.setPosition(500) // Before 00:01.00
    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))

    expect(html).toContain('(前奏) Floating Song')
    expect(html).toContain('First Floating Lyric')
  })

  it('renders interlude symbol instead of song title and artist during blank lines', async () => {
    const { ctx, player, lyrics } = await createHarness()
    lyrics.setLyrics('[00:01.00]Verse 1\n[00:03.00]\n[00:06.00]Verse 2')
    player.setPosition(4000) // At 00:03.00 blank line
    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))

    expect(html).toContain('♪ 间奏 ♪')
    expect(html).toContain('Verse 2')
    expect(html).not.toContain('Floating Song - Floating Artist')
  })

  it('renders outro symbol when playback reaches trailing blank line', async () => {
    const { ctx, player, lyrics } = await createHarness()
    lyrics.setLyrics('[00:01.00]Verse 1\n[00:05.00]')
    player.setPosition(6000) // At 00:05.00 blank line at end
    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))

    expect(html).toContain('♪ 尾奏 ♪')
  })

  it('returns null when invisible', async () => {
    const { ctx, desktopLyrics } = await createHarness()
    desktopLyrics.setVisible(false)

    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))
    expect(html).toBe('')
  })
})

describe('DesktopLyricsSettingsCard', () => {
  const renderCard = async () => {
    const harness = await createHarness()
    const { ctx, settings, desktopLyrics } = harness
    const rendered = render(h(DesktopLyricsSettingsCard, { ctx }))
    return { ...rendered, settings, desktopLyrics }
  }

  it('registers the settings card view under the descriptor id', async () => {
    const { ctx } = await createHarness()
    expect(ctx.ui.viewFor(DESKTOP_LYRICS_VIEWS.settingsCard)).toBeDefined()
  })

  it('renders every display row and the live preview', async () => {
    const { getByText, container } = await renderCard()
    expect(getByText('桌面歌词设置')).toBeTruthy()
    expect(getByText('开启桌面歌词')).toBeTruthy()
    expect(getByText('歌词显示行数')).toBeTruthy()
    expect(getByText('文本对齐方式')).toBeTruthy()
    expect(getByText('歌词字体')).toBeTruthy()
    expect(getByText('歌词字号')).toBeTruthy()
    expect(getByText('歌词高亮颜色')).toBeTruthy()
    expect(getByText('文字透明度')).toBeTruthy()

    const preview = container.querySelector('[data-testid="desktop-lyrics-preview"]')
    expect(preview).toBeTruthy()
    expect(preview?.textContent).toContain('桌面歌词实时预览效果')
  })

  it('toggles visibility through the service and persists enabled state', async () => {
    const { container, settings, desktopLyrics } = await renderCard()
    const lyricsSwitch = container.querySelector(
      'button[aria-label="开启桌面歌词"]',
    ) as HTMLButtonElement
    expect(lyricsSwitch).toBeTruthy()
    fireEvent.click(lyricsSwitch)

    await waitFor(() => {
      expect(desktopLyrics.state.visible).toBe(false)
      expect(settings.calls.some((c) => c.includes('"enabled":false'))).toBe(true)
    })
  })

  it('changes line mode through the settings document', async () => {
    const { container, settings } = await renderCard()
    const lineModeSelect = container.querySelector(
      'select[aria-label="歌词显示行数"]',
    ) as HTMLSelectElement
    expect(lineModeSelect).toBeTruthy()
    fireEvent.change(lineModeSelect, { target: { value: 'single' } })

    await waitFor(() => {
      expect(settings.calls.some((c) => c.includes('"lineMode":"single"'))).toBe(true)
    })
  })
})
