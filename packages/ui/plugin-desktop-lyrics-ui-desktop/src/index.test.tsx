// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { TransportState } from '@BBeBee/protocol'
import { DesktopLyrics } from './DesktopLyrics.js'
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

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  await ctx.plugin(DesktopLyricsStub)
  await ctx.plugin(pluginDesktopLyricsUi)

  const player = (ctx as unknown as { player: PlayerStub }).player
  const lyrics = (ctx as unknown as { lyrics: LyricsStub }).lyrics
  const desktopLyrics = (ctx as unknown as { desktopLyrics: DesktopLyricsStub }).desktopLyrics

  return { ctx, player, lyrics, desktopLyrics }
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
