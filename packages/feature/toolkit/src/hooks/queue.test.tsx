// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { QueueItem, TransportState } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import {
  formatRelativeTime,
  upcomingDropToQueueIndex,
  useQueueScrollWindow,
  useQueueView,
} from './queue.js'

afterEach(cleanup)

class PlayerStub extends Service {
  queueList: QueueItem[] = [
    { id: 'q-1', trackUrn: 'bbebee:local:track:1', addedAt: 100, addedBy: 'user' },
    { id: 'q-2', trackUrn: 'bbebee:local:track:2', addedAt: 200, addedBy: 'user' },
    { id: 'q-3', trackUrn: 'bbebee:local:track:3', addedAt: 300, addedBy: 'user' },
  ]

  state: TransportState = {
    status: 'playing',
    currentItemId: 'q-1',
    trackUrn: 'bbebee:local:track:1',
    positionMs: 1000,
    durationMs: 180000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
  }

  movedTo: { id: string; toIndex: number } | undefined
  cleared = false
  removedIds: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get queue(): readonly QueueItem[] {
    return this.queueList
  }

  upcoming(): readonly QueueItem[] {
    return this.queueList.slice(1)
  }

  moveItem(id: string, toIndex: number): void {
    this.movedTo = { id, toIndex }
  }

  clearQueue(): void {
    this.cleared = true
    this.queueList = []
  }

  removeItems(ids: string[]): void {
    this.removedIds.push(...ids)
    this.queueList = this.queueList.filter((item) => !ids.includes(item.id))
  }

  async getHistory(): Promise<readonly never[]> {
    return []
  }
}

describe('upcomingDropToQueueIndex', () => {
  const queue: QueueItem[] = [
    { id: 'a', trackUrn: '1', addedAt: 1, addedBy: 'user' },
    { id: 'b', trackUrn: '2', addedAt: 2, addedBy: 'user' },
    { id: 'c', trackUrn: '3', addedAt: 3, addedBy: 'user' },
    { id: 'd', trackUrn: '4', addedAt: 4, addedBy: 'user' },
  ]
  const upcoming: QueueItem[] = [
    { id: 'b', trackUrn: '2', addedAt: 2, addedBy: 'user' },
    { id: 'c', trackUrn: '3', addedAt: 3, addedBy: 'user' },
    { id: 'd', trackUrn: '4', addedAt: 4, addedBy: 'user' },
  ]

  it('translates drop position before anchor', () => {
    // moving 'd' to before 'b' (index 0 in upcoming)
    const toIndex = upcomingDropToQueueIndex('d', 0, queue, upcoming)
    expect(toIndex).toBe(1)
  })

  it('translates drop position to end', () => {
    // moving 'b' to after 'd' (index 3 in upcoming)
    const toIndex = upcomingDropToQueueIndex('b', 3, queue, upcoming)
    expect(toIndex).toBe(3)
  })
})

describe('formatRelativeTime', () => {
  it('formats recent timestamp as just now', () => {
    const t = (k: string) => k
    expect(formatRelativeTime(t, Date.now() - 1000)).toBe('queue:index.justNow')
  })
})

describe('useQueueView', () => {
  it('initializes queue state and manages queue operations', async () => {
    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await tick()

    const { result } = renderHook(() => useQueueView(ctx))

    expect(result.current.tab).toBe('queue')
    expect(result.current.queue.length).toBe(3)
    expect(result.current.currentIdx).toBe(0)
    expect(result.current.currentItem?.id).toBe('q-1')

    // Tab toggle
    act(() => {
      result.current.setTab('history')
    })
    expect(result.current.tab).toBe('history')

    // Move upcoming
    act(() => {
      result.current.moveUpcoming('q-3', 0)
    })
    expect((ctx.player as unknown as PlayerStub).movedTo).toEqual({ id: 'q-3', toIndex: 1 })

    // Remove item
    act(() => {
      result.current.removeItem('q-2')
    })
    expect((ctx.player as unknown as PlayerStub).removedIds).toContain('q-2')

    // Clear queue
    act(() => {
      result.current.clearQueue()
    })
    expect((ctx.player as unknown as PlayerStub).cleared).toBe(true)
  })

  it('windows upcoming tracks and always includes currentItem in large queue', async () => {
    const ctx = new Context()
    const manyQueue: QueueItem[] = Array.from({ length: 300 }, (_, i) => ({
      id: `item-${i}`,
      trackUrn: `bbebee:local:track:${i}`,
      addedAt: i * 10,
      addedBy: 'user',
    }))

    class LargePlayerStub extends Service {
      constructor(c: Context) {
        super(c, 'player')
      }
      get queue() {
        return manyQueue
      }
      // Current track is item-100, upcoming is item-101 .. item-299
      upcoming() {
        return manyQueue.slice(101)
      }
      get state(): TransportState {
        return {
          status: 'playing',
          currentItemId: 'item-100',
          trackUrn: 'bbebee:local:track:100',
          positionMs: 0,
          durationMs: 180000,
          bufferedMs: 0,
          volume: 1,
          muted: false,
          repeat: 'off',
          shuffle: false,
          playMode: 'sequence',
        }
      }
      async getHistory() {
        return []
      }
    }

    let queriedUrns: string[] = []
    class SourcesStub extends Service {
      constructor(c: Context) {
        super(c, 'sources')
      }
      async getTracks(urns: readonly string[]) {
        queriedUrns = [...urns]
        return urns.map((urn) => ({
          urn,
          title: `Track ${urn}`,
          artists: [],
        }))
      }
    }

    await ctx.plugin(LargePlayerStub)
    await ctx.plugin(SourcesStub)
    await tick()

    const { result } = renderHook(() => useQueueView(ctx, { windowStart: 0, windowLength: 50 }))
    await tick()

    expect(result.current.currentItem?.id).toBe('item-100')
    // currentItem trackUrn must be queried
    expect(queriedUrns).toContain('bbebee:local:track:100')
    // The first slice of upcoming (item-101 onwards) must be queried, NOT queue[0..50]
    expect(queriedUrns).toContain('bbebee:local:track:101')
    expect(queriedUrns).not.toContain('bbebee:local:track:0')
  })
})

describe('useQueueScrollWindow', () => {
  it('calculates windowStart based on headerOffset, itemHeight, and blockSize', () => {
    const { result } = renderHook(() =>
      useQueueScrollWindow({
        itemHeight: 60,
        blockSize: 25,
        headerOffset: 120,
      }),
    )

    expect(result.current.windowStart).toBe(0)

    // Scroll before header offset should stay at 0
    act(() => {
      result.current.onScroll(80)
    })
    expect(result.current.windowStart).toBe(0)

    // Scroll past header offset: (120 + 20 * 60) = 1320 -> itemIndex = 20 -> block = 0
    act(() => {
      result.current.onScroll(1320)
    })
    expect(result.current.windowStart).toBe(0)

    // Scroll past 25 items: (120 + 26 * 60) = 1680 -> itemIndex = 26 -> block = 25
    act(() => {
      result.current.onScroll(1680)
    })
    expect(result.current.windowStart).toBe(25)

    // Scroll past 50 items: (120 + 55 * 60) = 3420 -> itemIndex = 55 -> block = 50
    act(() => {
      result.current.onScroll(3420)
    })
    expect(result.current.windowStart).toBe(50)
  })
})

