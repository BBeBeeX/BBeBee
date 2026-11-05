/**
 * Headless data orchestration, event refresh, deduplication, stats calculation,
 * and date filtering for Playback History.
 *
 * Shared between desktop and mobile to ensure identical state management and metrics (rules/ui.md §1).
 */

import { useCallback, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, Track } from '@BBeBee/protocol'
import {
  usePlayHistory,
  usePlayHistoryHeatmap,
  usePlayHistoryStats,
  useTracksByUrn,
  useTransport,
} from '@BBeBee/toolkit/hooks'

export interface HistoryViewOptions {
  readonly limit?: number
  readonly defaultDate?: string | null
}

export interface HistoryViewState {
  readonly selectedDate: string | null
  readonly setSelectedDate: (date: string | null) => void

  readonly confirmClear: boolean
  readonly setConfirmClear: (confirm: boolean) => void
  readonly handleClear: () => Promise<void>

  readonly stats: ReturnType<typeof usePlayHistoryStats>['stats']
  readonly heatmap: ReturnType<typeof usePlayHistoryHeatmap>['heatmap']
  readonly records: readonly PlayRecord[]
  readonly loading: boolean

  readonly uniqueRecords: readonly PlayRecord[]
  readonly playCountMap: ReadonlyMap<string, number>
  readonly tracks: ReadonlyMap<string, Track>

  readonly completionRate: string
  readonly transport: ReturnType<typeof useTransport>
  readonly isTrackActive: (trackUrn: string) => boolean
}

export function fallbackTrack(urn: string, title = ''): Track {
  return { urn, title, artists: [] }
}

export function formatHistoryTime(
  t: (key: string, params?: Record<string, string | number>) => string,
  timestamp: number,
): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const timeStr = `${hours}:${minutes}`

  if (isToday) return t('history:history.todayAt', { time: timeStr })
  if (isYesterday) return t('history:history.yesterdayAt', { time: timeStr })

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${timeStr}`
  }
  return `${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timeStr}`
}

export function useHistoryView(
  ctx: Context,
  options?: HistoryViewOptions,
): HistoryViewState {
  const [selectedDate, setSelectedDate] = useState<string | null>(options?.defaultDate ?? null)
  const [confirmClear, setConfirmClear] = useState(false)

  const { stats } = usePlayHistoryStats(ctx)
  const { heatmap } = usePlayHistoryHeatmap(ctx, 365)
  const { records, loading } = usePlayHistory(ctx, {
    limit: options?.limit ?? 500,
    date: selectedDate ?? undefined,
  })

  const { uniqueRecords, playCountMap } = useMemo(() => {
    const counts = new Map<string, number>()
    const seen = new Set<string>()
    const list: PlayRecord[] = []
    for (const r of records) {
      counts.set(r.trackUrn, (counts.get(r.trackUrn) ?? 0) + 1)
      if (!seen.has(r.trackUrn)) {
        seen.add(r.trackUrn)
        list.push(r)
      }
    }
    return { uniqueRecords: list, playCountMap: counts }
  }, [records])

  const tracks = useTracksByUrn(
    ctx,
    uniqueRecords.map((r) => r.trackUrn),
  )

  const handleClear = useCallback(async () => {
    try {
      await ctx.player?.clearHistory?.()
    } finally {
      setConfirmClear(false)
    }
  }, [ctx])

  const completionRate = useMemo(() => {
    if (stats.totalPlays > 0) {
      return `${((stats.completedPlays / stats.totalPlays) * 100).toFixed(1)}%`
    }
    return '0%'
  }, [stats.completedPlays, stats.totalPlays])

  const transport = useTransport(ctx)

  const isTrackActive = useCallback(
    (trackUrn: string) => transport.trackUrn === trackUrn,
    [transport.trackUrn],
  )

  return {
    selectedDate,
    setSelectedDate,

    confirmClear,
    setConfirmClear,
    handleClear,

    stats,
    heatmap,
    records,
    loading,

    uniqueRecords,
    playCountMap,
    tracks,

    completionRate,
    transport,
    isTrackActive,
  }
}
