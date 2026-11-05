// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { PlayHistoryHeatmapDay, PlayHistoryStats, PlayRecord } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { fallbackTrack, formatHistoryTime, useHistoryView } from './hooks.js'

afterEach(cleanup)

class PlayerStub extends Service {
  historyCleared = false
  records: PlayRecord[] = [
    {
      id: 'rec-1',
      trackUrn: 'bbebee:local:track:1',
      startedAt: Date.now() - 1000,
      msPlayed: 180000,
      completed: true,
      skipped: false,
    },
    {
      id: 'rec-2',
      trackUrn: 'bbebee:local:track:1',
      startedAt: Date.now() - 500,
      msPlayed: 180000,
      completed: true,
      skipped: false,
    },
    {
      id: 'rec-3',
      trackUrn: 'bbebee:local:track:2',
      startedAt: Date.now() - 100,
      msPlayed: 60000,
      completed: false,
      skipped: true,
    },
  ]

  stats: PlayHistoryStats = {
    totalPlays: 3,
    totalMsPlayed: 420000,
    todayPlays: 3,
    completedPlays: 2,
  }

  heatmap: PlayHistoryHeatmapDay[] = [
    { date: '2026-11-05', count: 3, msPlayed: 420000 },
  ]

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  async getHistory(): Promise<readonly PlayRecord[]> {
    return this.records
  }

  async getHistoryStats(): Promise<PlayHistoryStats> {
    return this.stats
  }

  async getHistoryHeatmap(): Promise<PlayHistoryHeatmapDay[]> {
    return this.heatmap
  }

  async clearHistory(): Promise<void> {
    this.historyCleared = true
    this.records = []
  }
}

describe('useHistoryView and history helpers', () => {
  it('creates fallbackTrack correctly', () => {
    const track = fallbackTrack('bbebee:local:track:99', 'Unknown')
    expect(track.urn).toBe('bbebee:local:track:99')
    expect(track.title).toBe('Unknown')
    expect(track.artists).toEqual([])
  })

  it('formats history time with relative dates', () => {
    const t = (k: string, p?: Record<string, string | number>) => `${k}:${p?.time ?? ''}`
    const now = Date.now()
    const formatted = formatHistoryTime(t, now)
    expect(formatted.startsWith('history:history.todayAt:')).toBe(true)
  })

  it('deduplicates records and calculates completion rate', async () => {
    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await tick()

    const { result } = renderHook(() => useHistoryView(ctx))

    await waitFor(() => {
      expect(result.current.records.length).toBe(3)
    })

    // Deduplication
    expect(result.current.uniqueRecords.length).toBe(2)
    expect(result.current.playCountMap.get('bbebee:local:track:1')).toBe(2)
    expect(result.current.playCountMap.get('bbebee:local:track:2')).toBe(1)

    // Completion rate
    await waitFor(() => {
      expect(result.current.completionRate).toBe('66.7%')
    })

    // Clear history
    await act(async () => {
      await result.current.handleClear()
    })
    expect((ctx.player as unknown as PlayerStub).historyCleared).toBe(true)
  })
})
