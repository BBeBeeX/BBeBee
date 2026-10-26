// @vitest-environment jsdom
/**
 * The mobile now-playing surfaces.
 *
 * The full-screen player and the mini-player that opens it, rendered against
 * DOM host components — the same seam `apps/mobile` uses to hand over the real
 * `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Contribution, NowPlayingStyleId, QueueItem, SlotContribution, Track, TransportState } from '@BBeBee/protocol'
import { configureNative, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { NowPlayingBar, NowPlayingScreen } from './index.js'

import nowPlayingCatalogue from '../../../feature/plugin-i18n/src/locales/nowPlaying.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  nowPlaying: { en: nowPlayingCatalogue.en, zh: nowPlayingCatalogue.zh },
}

/**
 * English i18n stub serving the real `nowPlaying` catalogue, so components
 * under test render the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  setLocale = (next: string): void => {
    this.locale = next
    for (const listener of [...this.listeners]) listener(next)
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
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          ;(onPress as () => void)()
        } : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

const IDLE: TransportState = {
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

/** A `ctx.player` with what the views read and call, and an optional `ctx.sources`. */
async function harness(
  state: Partial<TransportState> = {},
  queue: QueueItem[] = [],
  catalogue: Record<string, Track> = {},
  opts: { haptics?: boolean } = {},
) {
  const calls: string[] = []
  const transport: TransportState = { ...IDLE, ...state }

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    get queue() {
      return queue
    }
    togglePlay = () => void calls.push('togglePlay')
    next = async () => void calls.push('next')
    previous = async () => void calls.push('previous')
    seek = async (ms: number) => void calls.push(`seek:${ms}`)
    setVolume = (v: number) => void calls.push(`volume:${v}`)
    setMuted = (m: boolean) => void calls.push(`muted:${m}`)
    playNow = async (urns: string[]) => void calls.push(`playNow:${urns.join(',')}`)
    playFromContext = async (urn: string, contextUrns: readonly string[] = []) =>
      void calls.push(`jump:${urn}${contextUrns.length ? `|${contextUrns.join(',')}` : ''}`)
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    getTracks = async (urns: readonly string[]) =>
      urns.map((urn) => catalogue[urn]).filter((t): t is Track => t !== undefined)
    setLoved = async (urn: string, loved: boolean) => {
      void calls.push(`setLoved:${urn}:${loved}`)
    }
  }

  /**
   * A `ctx.library` with the favorite surface the bar reads and writes.
   * `setSaved` fires `library/changed` — the one event every favorite writer
   * emits — so the bar's re-read path is exercised, not stubbed around.
   */
  class LibraryStub extends Service {
    private saved = new Set<string>()
    constructor(ctx: Context) {
      super(ctx, 'library')
    }
    isSaved = async (urn: string) => this.saved.has(urn)
    setSaved = async (urn: string, value: boolean) => {
      void calls.push(`setSaved:${urn}:${value}`)
      if (value) this.saved.add(urn)
      else this.saved.delete(urn)
      this.ctx.emit('library/changed', 'track', [urn])
    }
  }

  /**
   * A `ctx.haptics` double — only what the heart's press cue reads. Registered
   * just when a test asks for it, so the default harness is the desktop shape:
   * no haptics service at all, and every read comes back `undefined`.
   */
  class HapticsStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'haptics')
    }
    enabled = true
    setEnabled = (on: boolean): void => { void on }
    impact = (): void => {}
    notification = (): void => {}
    selection = (): void => {}
    tap = (): void => void calls.push('haptics:tap')
  }

  class UiStub extends Service {
    readonly views = new Map<string, unknown>()
    readonly contributions: Contribution[] = []
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
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
      this.contributions.filter((c): c is SlotContribution => c.kind === 'slot' && c.slot === slot)
    viewFor = (id: string) => this.views.get(id)
  }

  class NowPlayingStub extends Service {
    style: NowPlayingStyleId = 'classic'
    constructor(ctx: Context) {
      super(ctx, 'nowPlaying')
    }
    getStyle = () => this.style
    setStyle = (s: NowPlayingStyleId) => {
      this.style = s
      calls.push(`setStyle:${s}`)
      this.ctx.emit('now-playing/style-changed', s)
    }
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  if (Object.keys(catalogue).length > 0) await ctx.plugin(SourcesStub)
  await ctx.plugin(LibraryStub)
  if (opts.haptics) await ctx.plugin(HapticsStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(NowPlayingStub)
  await ctx.plugin(DefaultI18nStub)
  return { ctx, calls }
}

describe('NowPlayingBar on mobile', () => {
  it('renders track title, artist and play/pause control', async () => {
    const { ctx } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis', album: 'Walkin' },
      status: 'playing',
    })
    const { container } = render(h(NowPlayingBar, { ctx }))
    expect(container.textContent).toContain('Solar')
    expect(container.textContent).toContain('Miles Davis')

    const pauseBtn = container.querySelector('[data-label="Pause"]') as HTMLElement | null
    expect(pauseBtn).toBeTruthy()
  })

  it('triggers togglePlay and onOpenNowPlaying callback', async () => {
    let opened = false
    const queue: QueueItem[] = [
      { id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' },
      { id: 'q-2', trackUrn: 'BBeBee:local:track:2', addedBy: 'user' },
    ]
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        currentItemId: 'q-1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
        status: 'paused',
      },
      queue,
    )
    const { container } = render(
      h(NowPlayingBar, { ctx, onOpenNowPlaying: () => { opened = true } }),
    )

    const playBtn = container.querySelector('[data-label="Play"]') as HTMLElement
    expect(playBtn).toBeTruthy()
    await act(async () => {
      playBtn.click()
    })
    expect(calls).toContain('togglePlay')

    const bar = container.querySelector('[data-label="Open now playing"]') as HTMLElement
    expect(bar).toBeTruthy()
    await act(async () => {
      bar.click()
    })
    expect(opened).toBe(true)
    expect(calls).toContain('navigate:now-playing.view')
  })

  it('stays mounted while idle as a placeholder: nothing to play, queue still reachable', async () => {
    let opened = false
    let queueOpened = false
    const { ctx, calls } = await harness()
    const { container } = render(
      h(NowPlayingBar, {
        ctx,
        onOpenNowPlaying: () => { opened = true },
        onOpenQueue: () => { queueOpened = true },
      }),
    )

    // The placeholder copy, not a hidden bar.
    expect(container.textContent).toContain('Nothing playing')

    // The body is inert while idle: pressing it must neither open the player
    // nor navigate.
    const bar = container.querySelector('[data-label="Open now playing"]') as HTMLElement
    await act(async () => {
      bar.click()
    })
    expect(opened).toBe(false)
    expect(calls).not.toContain('navigate:now-playing.view')

    // The queue button is the one control that stays live while idle.
    const queueBtn = container.querySelector('[data-label="Play queue"]') as HTMLElement
    expect(queueBtn).toBeTruthy()
    await act(async () => {
      queueBtn.click()
    })
    expect(queueOpened).toBe(true)
  })

  it('favorites the current track through both stores and re-reads on library change', async () => {
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
        status: 'paused',
      },
      [],
      { 'BBeBee:local:track:1': { urn: 'BBeBee:local:track:1', title: 'Solar', artists: [] } },
    )
    const { container } = render(h(NowPlayingBar, { ctx }))

    // Unsaved: the label offers adding, and the press writes catalogue first,
    // library second (the dual-write invariant).
    const heart = container.querySelector('[data-label="Add Solar to favorites"]') as HTMLElement
    expect(heart).toBeTruthy()
    await act(async () => {
      heart.click()
    })
    expect(calls.indexOf('setLoved:BBeBee:local:track:1:true')).toBeLessThan(
      calls.indexOf('setSaved:BBeBee:local:track:1:true'),
    )

    // The library write fired `library/changed`; the bar re-read and flipped
    // its label to the remove form.
    await act(async () => {
      await Promise.resolve()
    })
    const removeHeart = container.querySelector(
      '[data-label="Remove Solar from favorites"]',
    ) as HTMLElement
    expect(removeHeart).toBeTruthy()
  })

  it('fires the haptics tap cue exactly once per heart press', async () => {
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
        status: 'paused',
      },
      [],
      { 'BBeBee:local:track:1': { urn: 'BBeBee:local:track:1', title: 'Solar', artists: [] } },
      { haptics: true },
    )
    const { container } = render(h(NowPlayingBar, { ctx }))

    const heart = container.querySelector('[data-label="Add Solar to favorites"]') as HTMLElement
    await act(async () => {
      heart.click()
    })
    // The press itself ticked once, and the toggle still ran behind it.
    expect(calls.filter((call) => call === 'haptics:tap')).toHaveLength(1)
    expect(calls).toContain('setSaved:BBeBee:local:track:1:true')

    // The `library/changed` the write fired re-reads the saved state; that
    // re-render must not tick again — the press is the cue's only trigger
    // (the haptics service's no-favorite-event rule).
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls.filter((call) => call === 'haptics:tap')).toHaveLength(1)
  })

  it('toggles the favorite with no haptics service registered, without throwing', async () => {
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
        status: 'paused',
      },
      [],
      { 'BBeBee:local:track:1': { urn: 'BBeBee:local:track:1', title: 'Solar', artists: [] } },
    )
    const { container } = render(h(NowPlayingBar, { ctx }))

    const heart = container.querySelector('[data-label="Add Solar to favorites"]') as HTMLElement
    await act(async () => {
      heart.click()
    })
    expect(calls).toContain('setSaved:BBeBee:local:track:1:true')

    // Desktop shape: nothing answered 'haptics', and the press still toggled
    // the favorite — the optional read is a no-op, never a crash.
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      container.querySelector('[data-label="Remove Solar from favorites"]'),
    ).toBeTruthy()
  })
})

describe('NowPlayingScreen on mobile', () => {
  it('renders full screen player details and transport buttons', async () => {
    let closed = false
    const queue: QueueItem[] = [
      { id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' },
      { id: 'q-2', trackUrn: 'BBeBee:local:track:2', addedBy: 'user' },
    ]
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        currentItemId: 'q-1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis', album: 'Walkin' },
        status: 'playing',
        durationMs: 180_000,
      },
      queue,
    )
    const { container } = render(
      h(NowPlayingScreen, { ctx, onClose: () => { closed = true } }),
    )

    expect(container.textContent).toContain('Solar')
    expect(container.textContent).toContain('Miles Davis')
    expect(container.textContent).toContain('Walkin')

    const closeBtn = container.querySelector('[data-label="Close player"]') as HTMLElement
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn.click()
    })
    expect(closed).toBe(true)

    const nextBtn = container.querySelector('[data-label="Next track"]') as HTMLElement
    expect(nextBtn).toBeTruthy()
    await act(async () => {
      nextBtn.click()
    })
    expect(calls).toContain('next')
  })

  it('renders style switcher button and cycles to next style on click', async () => {
    const { ctx, calls } = await harness({ status: 'playing' })
    const { container } = render(h(NowPlayingScreen, { ctx }))

    const switchBtn = container.querySelector('[data-role="button"][data-label^="Switch now-playing style"]') as HTMLElement
    expect(switchBtn).toBeTruthy()
    expect(switchBtn.getAttribute('data-label')).toContain('Switch now-playing style')

    await act(async () => {
      switchBtn.click()
    })
    expect(calls).toContain('setStyle:full-cover')
  })

  it('renders vinyl disc when style is vinyl', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('vinyl')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-label="Vinyl disc"]')).toBeTruthy()
  })

  it('renders compact layout without crashing', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('compact')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.textContent).toContain('Nothing playing')
  })

  it('renders full-cover layout without crashing', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('full-cover')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.textContent).toContain('Nothing playing')
  })

  it('renders cinematic layout without crashing', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('cinematic')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.textContent).toContain('Nothing playing')
  })
})

describe('NowPlayingScreen panel slot on mobile', () => {
  /** A stand-in for the lyrics view the real `plugin-lyrics-ui-mobile` registers. */
  function PanelStub(): ReactElement {
    const native = nativePrimitives()
    return h(
      native.View as never,
      { testID: 'stub-panel' },
      h(native.Text as never, null, 'LYRICS PANEL MARKER'),
    )
  }

  const PANEL_SLOT: SlotContribution = {
    kind: 'slot',
    id: 'lyrics.panel',
    slot: 'now-playing.panel',
    order: 10,
  }

  it('renders the now-playing.panel contribution as a band while a track is loaded', async () => {
    const { ctx } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
      status: 'playing',
    })
    ctx.ui.registerView('lyrics.panel', PanelStub)
    ctx.ui.contribute(PANEL_SLOT)

    const { container } = render(h(NowPlayingScreen, { ctx }))
    const band = container.querySelector('[data-testid="now-playing-panel"]') as HTMLElement
    expect(band).toBeTruthy()
    expect(container.textContent).toContain('LYRICS PANEL MARKER')
  })

  it('renders one band even when headless and view packages contribute the same id', async () => {
    const { ctx } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
      status: 'playing',
    })
    ctx.ui.registerView('lyrics.panel', PanelStub)
    ctx.ui.contribute(PANEL_SLOT)
    ctx.ui.contribute(PANEL_SLOT)

    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelectorAll('[data-testid="now-playing-panel"]')).toHaveLength(1)
  })

  it('stays panel-free while idle, even with a contribution registered', async () => {
    const { ctx } = await harness()
    ctx.ui.registerView('lyrics.panel', PanelStub)
    ctx.ui.contribute(PANEL_SLOT)

    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="now-playing-panel"]')).toBeFalsy()
    expect(container.textContent).not.toContain('LYRICS PANEL MARKER')
  })

  it('renders the band with no contribution when the well-known view id is registered', async () => {
    const { ctx } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
      status: 'playing',
    })
    ctx.ui.registerView('lyrics.panel', PanelStub)

    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="now-playing-panel"]')).toBeTruthy()
  })
})
