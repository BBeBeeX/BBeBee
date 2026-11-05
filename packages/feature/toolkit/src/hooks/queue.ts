/**
 * Headless data orchestration, reorder calculation, track hydration, and history
 * tab resolution for the Queue screen.
 *
 * Shared between desktop and mobile to ensure identical state semantics (rules/ui.md §1).
 */

import { useCallback, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, QueueItem, QueueSourceContext, Track, TransportState } from '@BBeBee/protocol'
import {
  usePlayHistory,
  useQueue,
  useTracksByUrn,
  useTransport,
  useUpcoming,
} from './player.js'

/** Catalogue keys for the label shown for a context that carries a kind but no label. */
export const CONTEXT_KIND_LABEL_KEYS: Record<QueueSourceContext['kind'], string> = {
  album: 'queue:index.contextKindLabels.album',
  playlist: 'queue:index.contextKindLabels.playlist',
  artist: 'queue:index.contextKindLabels.artist',
  search: 'queue:index.contextKindLabels.search',
  radio: 'queue:index.contextKindLabels.radio',
  local: 'queue:index.contextKindLabels.local',
  favorites: 'queue:index.contextKindLabels.favorites',
}

export function formatRelativeTime(
  t: (key: string, params?: Record<string, string | number>) => string,
  timestamp: number,
): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('queue:index.justNow')
  if (minutes < 60) return t('queue:index.minAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('queue:index.hrAgo', { hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('queue:index.daysAgo', { days })
  return new Date(timestamp).toLocaleDateString()
}

/**
 * Translate a drop position in the visible upcoming list into the
 * `toIndex` `player.moveItem` expects.
 */
export function upcomingDropToQueueIndex(
  draggedId: string,
  dropIndex: number,
  queue: readonly QueueItem[],
  upcoming: readonly QueueItem[],
): number {
  const rowIndexOf = (id: string): number => {
    const at = queue.findIndex((item) => item.id === id)
    return at < 0 ? queue.length : at
  }

  const draggedRow = rowIndexOf(draggedId)
  const anchor =
    dropIndex < upcoming.length ? upcoming[dropIndex] : upcoming[upcoming.length - 1]
  if (!anchor) return queue.length

  const anchorRow = rowIndexOf(anchor.id)
  const anchorWithoutDragged = anchorRow > draggedRow ? anchorRow - 1 : anchorRow

  return dropIndex < upcoming.length ? anchorWithoutDragged : anchorWithoutDragged + 1
}

export interface QueueViewOptions {
  readonly defaultTab?: 'queue' | 'history'
  readonly windowStart?: number
  readonly windowLength?: number
}

export interface QueueViewState {
  readonly tab: 'queue' | 'history'
  readonly setTab: (tab: 'queue' | 'history') => void

  readonly queue: readonly QueueItem[]
  readonly upcoming: readonly QueueItem[]
  readonly state: TransportState
  readonly currentIdx: number
  readonly currentItem: QueueItem | undefined

  readonly queueTracks: ReadonlyMap<string, Track>

  readonly historyRecords: readonly PlayRecord[]
  readonly historyLoading: boolean
  readonly uniqueHistoryRecords: readonly PlayRecord[]
  readonly uniqueHistoryUrns: readonly string[]
  readonly historyTracks: ReadonlyMap<string, Track>

  readonly shuffleOn: boolean

  readonly playTrack: (urn: string) => void
  readonly playHistoryTrack: (urn: string) => void
  readonly removeItem: (id: string) => void
  readonly removeItems: (ids: string[]) => void
  readonly clearQueue: () => void
  readonly moveUpcoming: (id: string, gap: number) => void
}

export function useQueueView(
  ctx: Context,
  options?: QueueViewOptions,
): QueueViewState {
  const [tab, setTab] = useState<'queue' | 'history'>(options?.defaultTab ?? 'queue')
  const queue = useQueue(ctx)
  const upcoming = useUpcoming(ctx)
  const state = useTransport(ctx)

  const currentIdx = useMemo(() => {
    let idx = queue.findIndex(
      (item) =>
        item.id === state.currentItemId ||
        (state.trackUrn && item.trackUrn === state.trackUrn),
    )
    if (idx === -1 && queue.length > 0) idx = 0
    return idx
  }, [queue, state.currentItemId, state.trackUrn])

  const currentItem = queue[currentIdx] ?? queue[0]

  // Queue tracks resolution: when on history tab, don't query queue tracks;
  // if window options are provided and queue > 100, window by scroll position; otherwise resolve all.
  const queueTrackUrns = useMemo(() => {
    if (tab !== 'queue') return []
    if (options?.windowStart !== undefined && queue.length > 100) {
      const start = Math.max(0, options.windowStart)
      const length = options.windowLength ?? 50
      return queue.slice(start, start + length).map((item) => item.trackUrn)
    }
    return queue.map((item) => item.trackUrn)
  }, [tab, queue, options?.windowStart, options?.windowLength])

  const queueTracks = useTracksByUrn(ctx, queueTrackUrns)

  // Play history resolution (de-duplicated by trackUrn, preserving most recent occurrence, capped at 50)
  const { records: historyRecords, loading: historyLoading } = usePlayHistory(ctx, { limit: 100 })
  const { uniqueHistoryRecords, uniqueHistoryUrns } = useMemo(() => {
    const seen = new Set<string>()
    const list: PlayRecord[] = []
    const urns: string[] = []
    for (const record of historyRecords) {
      if (!seen.has(record.trackUrn)) {
        seen.add(record.trackUrn)
        list.push(record)
        urns.push(record.trackUrn)
        if (list.length >= 50) {
          break
        }
      }
    }
    return { uniqueHistoryRecords: list, uniqueHistoryUrns: urns }
  }, [historyRecords])

  const historyTracks = useTracksByUrn(ctx, uniqueHistoryUrns)

  const shuffleOn = state.shuffle

  const playTrack = useCallback(
    (urn: string) => {
      void ctx.player?.playFromContext?.(urn)
    },
    [ctx],
  )

  const playHistoryTrack = useCallback(
    (urn: string) => {
      void ctx.player?.playFromContext?.(urn, uniqueHistoryUrns)
    },
    [ctx, uniqueHistoryUrns],
  )

  const removeItem = useCallback((id: string) => {
    ctx.player?.removeItems?.([id])
  }, [ctx])

  const removeItems = useCallback((ids: string[]) => {
    ctx.player?.removeItems?.(ids)
  }, [ctx])

  const clearQueue = useCallback(() => {
    ctx.player?.clearQueue?.()
  }, [ctx])

  const moveUpcoming = useCallback((id: string, gap: number) => {
    const toIndex = upcomingDropToQueueIndex(id, gap, queue, upcoming)
    ctx.player?.moveItem?.(id, toIndex)
  }, [ctx, queue, upcoming])

  return {
    tab,
    setTab,

    queue,
    upcoming,
    state,
    currentIdx,
    currentItem,

    queueTracks,

    historyRecords,
    historyLoading,
    uniqueHistoryRecords,
    uniqueHistoryUrns,
    historyTracks,

    shuffleOn,

    playTrack,
    playHistoryTrack,
    removeItem,
    removeItems,
    clearQueue,
    moveUpcoming,
  }
}
