// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, fireEvent, act, renderHook } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { MiniPlayerData, MiniPlayerServiceState } from '@BBeBee/protocol'
import { useMiniPlayerData } from '@bbebee/plugin-mini-player/hooks'
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

class I18nStub extends Service {
  locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string) => {
    if (key === 'miniPlayer:miniPlayerButton.openMiniPlayerDynamicIsland') return 'Open mini player / Dynamic Island'
    if (key === 'miniPlayer:miniPlayerButton.closeMiniPlayer') return 'Close mini player'
    return key
  }
  register = () => () => {}
  onLocaleChange = () => () => {}
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
    expect(html).toContain('Restore main window')
    expect(html).toContain('Close mini player')
    expect(html).toContain('0:45')
    expect(html).toContain('3:00')
  })

  it('renders MiniPlayerButton static markup', async () => {
    const ctx = new Context()
    await ctx.plugin(MiniPlayerStub)
    await ctx.plugin(I18nStub)

    const html = renderToStaticMarkup(h(MiniPlayerButton, { ctx }))
    expect(html).toContain('Open mini player / Dynamic Island')
  })

  it('useMiniPlayerData does not retain previous cover when cover is empty', () => {
    let onDataCb: ((data: unknown) => void) | undefined
    ;(globalThis as any).window.BBeBee = {
      miniPlayer: {
        getData: async () => undefined,
        onData: (cb: (data: unknown) => void) => {
          onDataCb = cb
          return () => {}
        },
      },
    }

    const { result } = renderHook(() => useMiniPlayerData())

    // 1. Initial track has cover
    act(() => {
      onDataCb?.({
        trackUrn: 'bbebee:track:1',
        title: 'Track 1',
        artworkUri: 'bbebee-file:///path/to/cover.jpg',
      })
    })
    expect(result.current.data.artworkUri).toBe('bbebee-file:///path/to/cover.jpg')

    // 2. Next track with empty cover string
    act(() => {
      onDataCb?.({
        trackUrn: 'bbebee:track:2',
        title: 'Track 2',
        artworkUri: '',
      })
    })
    expect(result.current.data.artworkUri).toBeUndefined()

    // 3. Update without artworkUri key
    act(() => {
      onDataCb?.({
        trackUrn: 'bbebee:track:3',
        title: 'Track 3',
      })
    })
    expect(result.current.data.artworkUri).toBeUndefined()
  })

  it('MiniPlayerIsland suppresses double click collapse within 500ms of expanding', () => {
    let collapseCount = 0
    const onCollapse = () => {
      collapseCount++
    }

    const { container, rerender } = render(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: false,
        onAction: () => {},
        onExpand: () => {},
        onCollapse,
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    // Expand to island card
    rerender(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: true,
        onAction: () => {},
        onExpand: () => {},
        onCollapse,
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    const card = container.querySelector('[title="Double-click to collapse the island"]')
    expect(card).toBeTruthy()

    // Immediate double click within 500ms should be ignored
    fireEvent.doubleClick(card!)
    expect(collapseCount).toBe(0)
  })
})
