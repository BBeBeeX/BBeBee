// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { MiniPlayerData, MiniPlayerServiceState } from '@BBeBee/protocol'
import pluginMiniPlayerUi, { MiniPlayerFloating, MiniPlayerIsland, MiniPlayerButton } from './index.js'

class UiStub extends Service {
  public views = new Map<string, unknown>()
  public slots = new Map<string, { id: string; slot: string; order?: number }[]>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
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

class MiniPlayerStub extends Service {
  public state: MiniPlayerServiceState = {
    visible: false,
    mode: 'normal',
    windowState: 'hidden',
  }

  constructor(ctx: Context) {
    super(ctx, 'miniPlayer')
  }

  get isSupported() {
    return true
  }

  toggle() {
    this.state.visible = !this.state.visible
    this.ctx.emit('mini-player/changed', this.state)
  }
}

const mockData: MiniPlayerData = {
  title: 'Test Island Song',
  artist: 'Island Artist',
  status: 'playing',
  positionMs: 45000,
  durationMs: 180000,
  canPlayOrPause: true,
  canPrevious: true,
  canNext: true,
  volume: 1,
  muted: false,
}

describe('plugin-mini-player-ui-desktop', () => {
  it('registers views and slots in ui service', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(MiniPlayerStub)
    await ctx.plugin(pluginMiniPlayerUi)

    expect(ctx.ui.viewFor('mini-player.window')).toBeDefined()
    expect(ctx.ui.viewFor('mini-player.button')).toBeDefined()
    expect(ctx.ui.slotsFor('now-playing.actions')).toEqual([
      { id: 'mini-player.button', slot: 'now-playing.actions', order: 10 },
    ])
  })

  it('renders floating mode static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerFloating, {
        data: mockData,
        onAction: () => {},
        onSnapToTop: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('Island Artist')
  })

  it('renders attached dynamic island capsule static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: false,
        onAction: () => {},
        onExpand: () => {},
        onCollapse: () => {},
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('Island Artist')
  })

  it('renders expanded dynamic island card static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: true,
        onAction: () => {},
        onExpand: () => {},
        onCollapse: () => {},
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('恢复主窗口')
    expect(html).toContain('关闭小窗')
    expect(html).toContain('0:45')
    expect(html).toContain('3:00')
  })

  it('renders MiniPlayerButton static markup', () => {
    const ctx = new Context()
    ctx.plugin(MiniPlayerStub)

    const html = renderToStaticMarkup(h(MiniPlayerButton, { ctx }))
    expect(html).toContain('打开小窗模式 / 灵动岛')
  })
})
