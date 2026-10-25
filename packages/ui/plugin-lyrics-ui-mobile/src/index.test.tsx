// @vitest-environment jsdom
/**
 * The mobile lyrics panel.
 *
 * The view and its registration rendered against DOM host components — the
 * same seam `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type {
  Contribution,
  LyricsState,
  SlotContribution,
  TransportState,
} from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import pluginLyricsUiMobile, { LyricsPanel } from './index.js'

import lyricsCatalogue from '../../../feature/plugin-i18n/src/locales/lyrics.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  // `lyrics.json` is a per-locale document ({ en, zh }); `en.json` is the
  // single-locale app catalogue itself, so it serves both tags.
  lyrics: { en: lyricsCatalogue.en, zh: lyricsCatalogue.zh },
  app: { en: appCatalogue, zh: appCatalogue },
}

/**
 * English i18n stub serving the real `lyrics` and `app` catalogues, so the
 * panel under test renders the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = CATALOGUES[ns]?.[this.locale === 'zh' ? 'zh' : 'en']
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (): (() => void) => () => {}
}

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, accessibilityState, onPress, testID } = props
    const state = (accessibilityState ?? {}) as { selected?: boolean; disabled?: boolean }
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        'aria-selected': typeof state.selected === 'boolean' ? state.selected : undefined,
        onClick: typeof onPress === 'function' ? (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          ;(onPress as () => void)()
        } : undefined,
      },
      children,
    )
  }
}

/** Every `scrollToIndex` the panel asked for, in order. */
const scrollCalls: Array<{ index: number; animated?: boolean; viewPosition?: number }> = []

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: forwardRef(function FlashList(
    props: {
      data?: readonly unknown[]
      renderItem?: (info: { item: unknown; index: number }) => ReactNode
      onScrollBeginDrag?: () => void
      onScrollEndDrag?: () => void
      onMomentumScrollEnd?: () => void
      testID?: string
    },
    ref,
  ) {
    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (options: { index: number; animated?: boolean; viewPosition?: number }) => {
          scrollCalls.push(options)
        },
      }),
      [],
    )
    const items = props.data ?? []
    return h(
      'div',
      {
        'data-host': 'FlashList',
        role: 'list',
        'data-testid': typeof props.testID === 'string' ? props.testID : undefined,
        onClick: () => props.onScrollBeginDrag?.(),
      },
      items.map((item, index) =>
        h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
      ),
    )
  }),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

const IDLE_TRANSPORT: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

const SYNCED_LRC = '[00:01] First line\n[00:02] Second line\n[00:03] Third line'

/**
 * A harness with `ctx.player`, `ctx.lyrics` and `ctx.ui`. The lyrics state is
 * a plain mutable object the test points at whatever scene it needs; the stub
 * re-emits `lyrics/changed` the real service emits on every update.
 */
async function harness(options: {
  lyricsState?: LyricsState
  transport?: Partial<TransportState>
} = {}) {
  const calls: string[] = []
  const transport: TransportState = { ...IDLE_TRANSPORT, ...options.transport }

  class PlayerStub extends Service {
    static override readonly name = 'player'
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    seek = async (ms: number) => void calls.push(`seek:${ms}`)
  }

  class LyricsStub extends Service {
    static override readonly name = 'lyrics'
    state: LyricsState = options.lyricsState ?? { status: 'idle', offsetMs: 0 }
    constructor(ctx: Context) {
      super(ctx, 'lyrics')
    }
    set = (patch: Partial<LyricsState>) => {
      this.state = { ...this.state, ...patch }
      this.ctx.emit('lyrics/changed', this.state)
    }
    retry = async () => void calls.push('retry')
    setOffset = () => void calls.push('setOffset')
  }

  class UiStub extends Service {
    static override readonly name = 'ui'
    readonly views = new Map<string, unknown>()
    readonly contributions: Contribution[] = []
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = (id: string, component: unknown) => {
      this.views.set(id, component)
      this.ctx.emit('ui/changed')
      return () => void this.views.delete(id)
    }
    contribute = (c: Contribution) => {
      this.contributions.push(c)
      this.ctx.emit('ui/changed')
      return () => {
        const index = this.contributions.indexOf(c)
        if (index >= 0) this.contributions.splice(index, 1)
      }
    }
    slotsFor = (slot: string): SlotContribution[] =>
      this.contributions.filter(
        (c): c is SlotContribution => c.kind === 'slot' && c.slot === slot,
      )
    viewFor = (id: string) => this.views.get(id)
  }

  scrollCalls.length = 0
  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(DefaultI18nStub)
  return { ctx, calls, lyrics: ctx.lyrics as unknown as LyricsStub, ui: ctx.ui as unknown as UiStub }
}

/** The synced-lyrics scene: three lines, playback inside the first. */
function readyState(): LyricsState {
  return {
    status: 'ready',
    trackUrn: 'BBeBee:local:track:1',
    lyrics: { format: 'lrc', content: SYNCED_LRC, synced: true, offsetMs: 0 },
    offsetMs: 0,
    supportsLyricSource: true,
    sourceType: 'lyric-source',
  }
}

describe('plugin-lyrics-ui-mobile registration', () => {
  it('registers the lyrics.panel view and contributes the now-playing.panel slot', async () => {
    const { ctx, ui } = await harness()
    await ctx.plugin(pluginLyricsUiMobile)

    expect(ui.views.get('lyrics.panel')).toBeTypeOf('function')
    const slot = ui.contributions.find((c) => c.kind === 'slot')
    expect(slot).toMatchObject({ kind: 'slot', id: 'lyrics.panel', slot: 'now-playing.panel' })
  })
})

describe('LyricsPanel on mobile', () => {
  it('renders synced lines as tappable rows and seeks on tap', async () => {
    const { ctx, calls } = await harness({ lyricsState: readyState() })
    const { container } = render(h(LyricsPanel, { ctx }))

    expect(container.textContent).toContain('First line')
    expect(container.textContent).toContain('Second line')
    expect(container.textContent).toContain('Third line')

    const secondLine = container.querySelector(
      '[data-label="Second line (0:02)"]',
    ) as HTMLElement
    expect(secondLine).toBeTruthy()
    await act(async () => {
      secondLine.click()
    })
    expect(calls).toContain('seek:2000')
  })

  it('follows the active line: highlight moves and the list scrolls to it', async () => {
    const { ctx } = await harness({ lyricsState: readyState() })
    const { container } = render(h(LyricsPanel, { ctx }))

    // Mount scrolls to wherever playback is (before the first line: index 0).
    expect(scrollCalls[0]).toMatchObject({ index: 0 })

    await act(async () => {
      ctx.emit('player/position', 2500, 200_000)
    })
    expect(scrollCalls.at(-1)).toMatchObject({ index: 1, viewPosition: 0.5 })

    // The active row announces itself; the row behind it is marked played.
    const active = container.querySelector('[aria-current="true"], [data-role="button"][aria-selected="true"]')
    expect(active).toBeTruthy()
  })

  it('pauses auto-follow while the user browses and offers the return pill', async () => {
    const { ctx } = await harness({ lyricsState: readyState() })
    const { container } = render(h(LyricsPanel, { ctx }))

    await act(async () => {
      ctx.emit('player/position', 2500, 200_000)
    })
    scrollCalls.length = 0

    // A drag begins: the pill appears and auto-follow holds still.
    const list = container.querySelector('[data-testid="lyrics-panel-list"]') as HTMLElement
    await act(async () => {
      list.click()
    })
    expect(container.querySelector('[data-testid="lyrics-panel-back-to-current"]')).toBeTruthy()

    await act(async () => {
      ctx.emit('player/position', 3100, 200_000)
    })
    expect(scrollCalls).toHaveLength(0)

    // The pill returns to the current line (the third line is active by now)
    // and auto-follow resumes.
    const pill = container.querySelector('[data-testid="lyrics-panel-back-to-current"]') as HTMLElement
    await act(async () => {
      pill.click()
    })
    expect(scrollCalls.at(-1)).toMatchObject({ index: 2, viewPosition: 0.5 })
    expect(container.querySelector('[data-testid="lyrics-panel-back-to-current"]')).toBeFalsy()
  })

  it('renders unsynced lyrics as plain, non-tappable text', async () => {
    const { ctx, calls } = await harness({
      lyricsState: {
        status: 'ready',
        trackUrn: 'BBeBee:local:track:1',
        lyrics: { format: 'plain', content: 'Just words\nNo timestamps', synced: false, offsetMs: 0 },
        offsetMs: 0,
      },
    })
    const { container } = render(h(LyricsPanel, { ctx }))

    expect(container.textContent).toContain('Just words')
    expect(container.textContent).toContain('No timestamps')
    await act(async () => {
      ;(container.querySelector('[data-testid="lyrics-panel-list"]') as HTMLElement).click()
    })
    expect(calls).not.toContain('seek:0')
  })

  it('shows the no-lyrics empty state with a search-again action', async () => {
    const { ctx, calls } = await harness({
      lyricsState: { status: 'no-lyrics', trackUrn: 'BBeBee:local:track:1', offsetMs: 0, supportsLyricSource: true },
    })
    const { container } = render(h(LyricsPanel, { ctx }))

    expect(container.textContent).toContain('No lyrics')
    const again = container.querySelector('[data-label="Search lyrics again"]') as HTMLElement
    expect(again).toBeTruthy()
    await act(async () => {
      again.click()
    })
    expect(calls).toContain('retry')
  })

  it('shows the external-sources hint when the audio source opted out', async () => {
    const { ctx } = await harness({
      lyricsState: {
        status: 'no-lyrics',
        trackUrn: 'BBeBee:local:track:1',
        offsetMs: 0,
        supportsLyricSource: false,
      },
    })
    const { container } = render(h(LyricsPanel, { ctx }))

    expect(container.textContent).toContain('External lyric sources are not enabled')
    expect(container.textContent).toContain('You can enable external lyric source support')
    expect(container.querySelector('[data-label="Search lyrics again"]')).toBeFalsy()
  })

  it('shows nothing-playing while idle and an error state with retry on failure', async () => {
    const { ctx } = await harness({ lyricsState: { status: 'idle', offsetMs: 0 } })
    const { container } = render(h(LyricsPanel, { ctx }))
    expect(container.textContent).toContain('Nothing playing')
    cleanup()

    const { ctx: errorCtx, calls: errorCalls } = await harness({
      lyricsState: { status: 'error', trackUrn: 'BBeBee:local:track:1', error: 'boom', offsetMs: 0 },
    })
    const errorView = render(h(LyricsPanel, { ctx: errorCtx }))
    expect(errorView.container.textContent).toContain('boom')
    const retry = errorView.container.querySelector('[data-label="Retry"]') as HTMLElement
    expect(retry).toBeTruthy()
    await act(async () => {
      retry.click()
    })
    expect(errorCalls).toContain('retry')
  })
})
