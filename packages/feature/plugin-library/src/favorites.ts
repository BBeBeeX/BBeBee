/**
 * Headless data fetching, deduplication, metadata hydration, sorting,
 * search filtering, and batch state for the Favorites Screen.
 *
 * Shared between desktop and mobile to ensure unified curation behavior (rules/ui.md §1).
 */

import { useCallback, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { PlayerService, Track } from '@BBeBee/protocol'
import { serviceOf, useBatchSelection, useTracksByUrn, type BatchSelectionState } from '@BBeBee/toolkit/hooks'
import { useSaved } from './hooks.js'
import type { SortOrder } from './local-music.js'

export type FavoriteSortKey = 'default' | 'title' | 'artist' | 'album' | 'source' | 'duration'

export interface FavoritesViewState {
  tracks: readonly Track[]
  loading: boolean
  error: string | undefined
  reload: () => void

  // Sorting
  sortKey: FavoriteSortKey
  setSortKey: (key: FavoriteSortKey) => void
  sortOrder: SortOrder
  setSortOrder: (order: SortOrder | ((prev: SortOrder) => SortOrder)) => void
  toggleSort: (key: FavoriteSortKey) => void
  sortedTracks: readonly Track[]

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredTracks: readonly Track[]
  sortedUrns: readonly string[]
  allSelected: boolean

  // Batch
  batch: BatchSelectionState

  // Playback
  playTrack: (track: Track, contextTracks?: readonly Track[]) => Promise<void>
  playAll: (trackList?: readonly Track[]) => Promise<void>
  playBatch: () => Promise<void>
}

export function useFavoritesView(ctx: Context): FavoritesViewState {
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const rawUrns = useMemo(() => entries.map((entry) => entry.urn), [entries])

  // Strict song deduplication
  const urns = useMemo(() => {
    const seen = new Set<string>()
    return rawUrns.filter((u) => {
      if (!u || seen.has(u)) return false
      seen.add(u)
      return true
    })
  }, [rawUrns])

  const tracksMap = useTracksByUrn(ctx, urns)
  const loading = saved.status === 'loading'
  const error = saved.error?.message

  const [sortKey, setSortKey] = useState<FavoriteSortKey>('default')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const batch = useBatchSelection()

  const allTracks = useMemo(() => {
    const seen = new Set<string>()
    const list: Track[] = []
    for (const urn of urns) {
      const t = tracksMap.get(urn) ?? { urn, title: urn.split(':').pop() ?? urn, artists: [] }
      if (!seen.has(t.urn)) {
        seen.add(t.urn)
        list.push(t)
      }
    }
    return list
  }, [urns, tracksMap])

  const toggleSort = useCallback((key: FavoriteSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortOrder('asc')
      return key
    })
  }, [])

  const sortedTracks = useMemo(() => {
    if (sortKey === 'default') return allTracks
    const copy = [...allTracks]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true, sensitivity: 'base' })
          break
        case 'artist': {
          const aName = a.artists?.[0]?.name ?? ''
          const bName = b.artists?.[0]?.name ?? ''
          cmp = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
        case 'album':
          cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, { numeric: true, sensitivity: 'base' })
          break
        case 'source': {
          const aSrc = a.urn.split(':')[1] ?? ''
          const bSrc = b.urn.split(':')[1] ?? ''
          cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
        case 'duration':
          cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
          break
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return copy
  }, [allTracks, sortKey, sortOrder])

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedTracks
    return sortedTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
        (t.albumTitle && t.albumTitle.toLowerCase().includes(q)),
    )
  }, [sortedTracks, searchQuery])

  const playTrack = useCallback(
    async (track: Track, contextTracks?: readonly Track[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const list = contextTracks && contextTracks.length > 0 ? contextTracks : filteredTracks
      const urnsList = list.map((t) => t.urn)
      if (player.playFromContext) {
        await player.playFromContext(track.urn, urnsList)
      } else {
        await player.playNow(urnsList)
      }
    },
    [ctx, filteredTracks],
  )

  const playAll = useCallback(
    async (trackList?: readonly Track[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const list = trackList ?? filteredTracks
      if (list.length === 0) return
      await player.playNow(list.map((t) => t.urn))
    },
    [ctx, filteredTracks],
  )

  const playBatch = useCallback(async () => {
    if (batch.selectedUrns.size === 0) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) return
    const urnsToPlay = allTracks
      .filter((t) => batch.selectedUrns.has(t.urn))
      .map((t) => t.urn)
    if (urnsToPlay.length > 0) {
      await player.playNow(urnsToPlay)
    }
  }, [ctx, batch.selectedUrns, allTracks])

  const sortedUrns = useMemo(() => filteredTracks.map((t) => t.urn), [filteredTracks])
  const allSelected = sortedUrns.length > 0 && batch.selectedUrns.size === sortedUrns.length

  return {
    tracks: allTracks,
    loading,
    error,
    reload: saved.reload,

    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    toggleSort,
    sortedTracks,

    searchQuery,
    setSearchQuery,
    filteredTracks,
    sortedUrns,
    allSelected,

    batch,

    playTrack,
    playAll,
    playBatch,
  }
}
