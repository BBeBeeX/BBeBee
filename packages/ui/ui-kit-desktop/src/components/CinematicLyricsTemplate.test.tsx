// @vitest-environment jsdom
/**
 * The cinematic lyrics template.
 *
 * What is worth pinning: the interactions a user reaches for — the active
 * line tracks the sync position, a timed line seeks when clicked, manual
 * scrolling pauses auto-follow, and the idle copy shows without lyrics.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { LyricsState, TransportState } from '@BBeBee/protocol'
import { CinematicLyricsTemplate } from './CinematicLyricsTemplate.js'

afterEach(() => {
  cleanup()
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

const TRACK_URN = 'BBeBee:local:track:1'

const LRC = '[00:10.00]First line\n[00:20.00]Second line\n[00:30.00]Third line'

async function harness(opts: { transport?: Partial<TransportState>; lyrics?: LyricsState } = {}) {
  const calls: string[] = []
  const transport: TransportState = {
    ...IDLE,
    status: 'playing',
    trackUrn: TRACK_URN,
    ...opts.transport,
  }
  const lyricsState: LyricsState = opts.lyrics ?? { status: 'idle', offsetMs: 0 }

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    seek = async (ms: number) => void calls.push(`seek:${ms}`)
  }

  class LyricsStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'lyrics')
    }
    get state(): LyricsState {
      return lyricsState
    }
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  return { ctx, calls }
}

const READY_LYRICS: LyricsState = {
  status: 'ready',
  trackUrn: TRACK_URN,
  offsetMs: 0,
  lyrics: { format: 'lrc', content: LRC, synced: true },
}

const PLAIN_LYRICS: LyricsState = {
  status: 'ready',
  trackUrn: TRACK_URN,
  offsetMs: 0,
  lyrics: {
    format: 'plain',
    content: 'First plain line\nSecond plain line\nThird plain line',
    synced: false,
  },
}

describe('CinematicLyricsTemplate', () => {
  it('renders the full list and marks the line at the sync position as active', async () => {
    const { ctx } = await harness({ lyrics: READY_LYRICS })
    const { container } = render(h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000 }))

    expect(container.querySelector('[data-testid="cinematic-lyrics-block"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="cinematic-lyrics-scroll"]')).toBeTruthy()
    expect(container.textContent).toContain('First line')
    expect(container.textContent).toContain('Second line')
    expect(container.textContent).toContain('Third line')

    const active = container.querySelectorAll('[data-active="true"]')
    expect(active).toHaveLength(1)
    expect(active[0]?.textContent).toContain('Second line')
    // Synced lyrics scroll without a scrollbar too.
    const scroller = container.querySelector('[data-testid="cinematic-lyrics-scroll"]') as HTMLElement
    expect(scroller.className).toContain('cinematic-lyrics-scroll')
    expect(scroller.style.scrollbarWidth).toBe('none')
  })

  it('seeks to a timed line when it is clicked', async () => {
    const { ctx, calls } = await harness({ lyrics: READY_LYRICS })
    const { getByTestId } = render(h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000 }))

    fireEvent.click(getByTestId('cinematic-lyric-line-2'))
    expect(calls).toContain('seek:30000')
  })

  it('seeks through onSeek when one is provided instead of the player', async () => {
    const { ctx, calls } = await harness({ lyrics: READY_LYRICS })
    const seekCalls: number[] = []
    const { getByTestId } = render(
      h(CinematicLyricsTemplate, {
        ctx,
        displayPosition: 20_000,
        onSeek: (ms: number) => {
          seekCalls.push(ms)
          calls.push(`onSeek:${ms}`)
        },
      }),
    )

    fireEvent.click(getByTestId('cinematic-lyric-line-0'))
    expect(seekCalls).toEqual([10_000])
    expect(calls).toContain('onSeek:10000')
    expect(calls).not.toContain('seek:10000')
  })

  it('does not render clickable lines and does not seek when seeking is unavailable', async () => {
    const { ctx, calls } = await harness({ lyrics: READY_LYRICS })
    const { container, queryByTestId } = render(
      h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000, canSeek: false }),
    )

    expect(queryByTestId('cinematic-lyric-line-2')).toBeNull()
    expect(container.textContent).toContain('Third line')
    expect(calls).not.toContain('seek:30000')
  })

  it('shows the idle placeholder copy when there are no lyrics', async () => {
    const { ctx } = await harness()
    const { container } = render(
      h(CinematicLyricsTemplate, { ctx, displayPosition: 0, isPlaying: true }),
    )
    expect(container.textContent).toContain('♪ 愿音乐治愈所有的伤痕 ♪')
  })

  it('pauses auto-follow on wheel and offers a return-to-current button', async () => {
    const { ctx } = await harness({ lyrics: READY_LYRICS })
    const { getByTestId, queryByTestId } = render(
      h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000 }),
    )

    expect(queryByTestId('cinematic-lyrics-return')).toBeNull()
    fireEvent.wheel(getByTestId('cinematic-lyrics-scroll'))
    expect(getByTestId('cinematic-lyrics-return')).toBeTruthy()

    fireEvent.click(getByTestId('cinematic-lyrics-return'))
    expect(queryByTestId('cinematic-lyrics-return')).toBeNull()
  })

  it('drops lyrics that still belong to the previous track', async () => {
    const { ctx } = await harness({
      lyrics: { ...READY_LYRICS, trackUrn: 'BBeBee:local:track:old' },
    })
    const { container } = render(
      h(CinematicLyricsTemplate, {
        ctx,
        displayPosition: 20_000,
        trackUrn: TRACK_URN,
        isPlaying: true,
      }),
    )

    expect(container.textContent).not.toContain('First line')
    expect(container.textContent).toContain('♪ 愿音乐治愈所有的伤痕 ♪')
  })

  it('renders plain lyrics as a uniform sheet without highlight or click targets', async () => {
    const { ctx, calls } = await harness({ lyrics: PLAIN_LYRICS })
    const { container } = render(h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000 }))

    expect(container.textContent).toContain('First plain line')
    expect(container.textContent).toContain('Second plain line')
    expect(container.textContent).toContain('Third plain line')

    // No active-line tracking on a sheet without timestamps.
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(0)
    expect(container.querySelector('[data-testid="cinematic-lyric-line-0"]')).toBeNull()
    expect(calls).not.toContain('seek:20000')
  })

  it('hides the scrollbar on plain lyrics and never follows playback', async () => {
    const { ctx } = await harness({ lyrics: PLAIN_LYRICS })
    const { container, getByTestId, queryByTestId } = render(
      h(CinematicLyricsTemplate, { ctx, displayPosition: 20_000 }),
    )

    const scroller = getByTestId('cinematic-lyrics-scroll')
    expect(scroller.className).toContain('cinematic-lyrics-scroll')
    expect(container.querySelector('style')?.textContent).toContain('::-webkit-scrollbar')

    // Wheel scrolling is allowed, but plain lyrics never follow playback,
    // so the return-to-current pill never appears.
    fireEvent.wheel(scroller)
    expect(queryByTestId('cinematic-lyrics-return')).toBeNull()
  })
})
