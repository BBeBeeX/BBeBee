// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { LyricsState, TransportState } from '@BBeBee/protocol'
import { LyricsPanel } from './LyricsPanel.js'
import pluginLyricsUi from './index.js'
import lyricsCatalogue from '../../../feature/plugin-i18n/src/locales/lyrics.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'

/** Minimal i18n service serving the real English catalogues for tests. */
class I18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const root = key.slice(0, sep) === 'app' ? appCatalogue : key.slice(0, sep) === 'lyrics' ? lyricsCatalogue.en : null
    if (!root) return key
    let cur: unknown = root
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    return typeof cur === 'string' ? cur : key
  }
  onLocaleChange = (): (() => void) => () => {}
}

class UiStub extends Service {
  public views = new Map<string, any>()
  public contributions: any[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  contribute(contribution: any) {
    this.contributions.push(contribution)
    return () => {}
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  slotsFor(slot: string) {
    return this.contributions.filter((c) => c.slot === slot)
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
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }

  seek = async (_ms: number) => {}
}

class LyricsStub extends Service {
  private currentState: LyricsState = {
    status: 'ready',
    offsetMs: 0,
    lyrics: {
      format: 'lrc',
      content: '[00:01.00]Line 1\n[00:05.00]Line 2\n[00:10.00]Line 3',
      synced: true,
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'lyrics')
  }

  get state() {
    return this.currentState
  }

  setState(patch: Partial<typeof this.currentState>) {
    this.currentState = { ...this.currentState, ...patch }
    this.ctx.emit('lyrics/changed', this.currentState)
  }

  retry = async () => {}
  setOffset = () => {}
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  await ctx.plugin(I18nStub)
  await ctx.plugin(pluginLyricsUi)

  return {
    ctx,
    player: (ctx as any).player as PlayerStub,
    lyrics: (ctx as any).lyrics as LyricsStub,
  }
}

describe('LyricsPanel', () => {
  it('registers view with ui service upon load', async () => {
    const { ctx } = await createHarness()
    expect(ctx.ui.viewFor('lyrics.panel')).toBeDefined()
  })

  it('renders track header information', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(LyricsPanel, { ctx }))

    expect(html).toContain('Test Song')
    expect(html).toContain('Test Artist')
    expect(html).toContain('Test Album')
  })

  it('renders lyrics lines and highlights the active line', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(LyricsPanel, { ctx }))

    expect(html).toContain('Line 1')
    expect(html).toContain('Line 2')
    expect(html).toContain('Line 3')
    expect(html).toContain('aria-label="Line 1 (0:01)"')
  })

  it('displays empty state when no lyrics are present', async () => {
    const { ctx, lyrics } = await createHarness()
    lyrics.setState({ status: 'no-lyrics', lyrics: undefined })

    const html = renderToStaticMarkup(h(LyricsPanel, { ctx }))
    expect(html).toContain('No lyrics')
  })

  it('displays error state with retry option on failure', async () => {
    const { ctx, lyrics } = await createHarness()
    lyrics.setState({ status: 'error', lyrics: undefined })

    const html = renderToStaticMarkup(h(LyricsPanel, { ctx }))
    expect(html).toContain('Retry')
  })

  it('renders share lyrics button when lyrics and track are present', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(LyricsPanel, { ctx }))
    expect(html).toContain('Share lyrics')
  })
})
