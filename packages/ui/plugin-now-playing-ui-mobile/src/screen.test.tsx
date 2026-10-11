// @vitest-environment jsdom
/**
 * The mobile now-playing surfaces.
 *
 * The full-screen player and the mini-player that opens it, rendered against
 * DOM host components — the same seam `apps/mobile` uses to hand over the real
 * `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { NowPlayingStyleId, QueueItem, Track, TransportState } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { NowPlayingBar, NowPlayingScreen } from './index.js'

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
  }

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
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
  await ctx.plugin(UiStub)
  await ctx.plugin(NowPlayingStub)
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
