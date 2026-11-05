/**
 * Headless data fetching, deduplication, metadata hydration, multi-key sorting,
 * search filtering, pagination, and batch state for the Playlist Detail Screen.
 *
 * Shared between desktop and mobile to ensure unified curation behavior (rules/ui.md §1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type {
  ArtworkRef,
  LibraryService,
  PlaylistItem,
  PlaylistDetail,
  PlayerService,
  SourcesService,
  Track,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import {
  resolveTrackSourceName,
  serviceOf,
  useBatchSelection,
  useTracksByUrn,
  type BatchSelectionState,
} from '@BBeBee/toolkit/hooks'
import { usePlaylist } from './hooks.js'

export type PlaylistSortKey =
  | 'custom'
  | 'title'
  | 'artist'
  | 'album'
  | 'source'
  | 'dateAdded'
  | 'duration'

export type PlaylistSortOrder = 'asc' | 'desc'

export interface PlaylistViewRow {
  readonly item: PlaylistItem
  readonly trackUrn: string
  readonly track: Track
  readonly originalIndex: number
}

export interface PlaylistViewState {
  readonly detail: PlaylistDetail | undefined
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly error: string | undefined
  readonly reload: () => void
  readonly handleLoadMore: () => Promise<void>

  // Metadata & Source
  readonly isThirdParty: boolean
  readonly sourceId: string | undefined
  readonly sourceName: string
  readonly coverArtwork: ArtworkRef | undefined
  readonly totalDurationMs: number

  // Items & Filtering
  readonly rows: readonly PlaylistViewRow[]
  readonly rawItems: readonly PlaylistItem[]
  readonly tracks: ReadonlyMap<string, Track>

  // Sorting
  readonly sortKey: PlaylistSortKey
  readonly setSortKey: (key: PlaylistSortKey) => void
  readonly sortOrder: PlaylistSortOrder
  readonly setSortOrder: (
    order: PlaylistSortOrder | ((prev: PlaylistSortOrder) => PlaylistSortOrder),
  ) => void
  readonly toggleSort: (key: PlaylistSortKey) => void

  // Search
  readonly searchQuery: string
  readonly setSearchQuery: (query: string) => void

  // Batch Selection
  readonly batch: BatchSelectionState
  readonly sortedUrns: readonly string[]
  readonly allSelected: boolean
  readonly toggleSelectAll: () => void
  readonly removeSelectedItems: () => Promise<void>
  readonly removeSingleItem: (itemId: string) => Promise<void>

  // Playback
  readonly playTrack: (trackUrn: string, contextUrns?: readonly string[]) => Promise<void>
  readonly playAll: (trackUrns?: readonly string[]) => Promise<void>
  readonly playBatch: () => Promise<void>
}

export function usePlaylistView(ctx: Context, urn?: string): PlaylistViewState {
  const parsedUrn = tryParseUrn(urn ?? '')
  const isThirdPartyUrn = Boolean(parsedUrn && parsedUrn.sourceId && parsedUrn.sourceId !== 'local')

  const state = usePlaylist(ctx, isThirdPartyUrn ? undefined : urn)

  const [thirdPartyRefresh, setThirdPartyRefresh] = useState(0)
  const [thirdPartyData, setThirdPartyData] = useState<{
    detail?: PlaylistDetail
    hasMore: boolean
    cursor?: string
    loading: boolean
    loadingMore: boolean
    error?: Error
  }>({
    hasMore: false,
    loading: isThirdPartyUrn,
    loadingMore: false,
  })

  useEffect(() => {
    if (!urn || !isThirdPartyUrn) return
    let cancelled = false
    setThirdPartyData({ hasMore: false, loading: true, loadingMore: false })

    const fetchFirstPage = async () => {
      try {
        const src = serviceOf<SourcesService>(ctx, 'sources')
        const lib = serviceOf<LibraryService>(ctx, 'library')
        let res: PlaylistDetail | undefined
        if (src && typeof src.getPlaylist === 'function') {
          res = await src.getPlaylist(urn, { limit: 30 })
        }
        if (!res && lib && typeof lib.getPlaylist === 'function') {
          res = await lib.getPlaylist(urn, { limit: 30 })
        }
        if (!cancelled) {
          setThirdPartyData({
            detail: res,
            hasMore: Boolean(res?.hasMore),
            cursor: res?.cursor,
            loading: false,
            loadingMore: false,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setThirdPartyData({
            hasMore: false,
            loading: false,
            loadingMore: false,
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      }
    }

    void fetchFirstPage()
    return () => {
      cancelled = true
    }
  }, [ctx, urn, isThirdPartyUrn, thirdPartyRefresh])

  const handleLoadMore = useCallback(async () => {
    if (!urn || !isThirdPartyUrn) return
    if (thirdPartyData.loadingMore || !thirdPartyData.hasMore || !thirdPartyData.cursor) return

    setThirdPartyData((prev) => ({ ...prev, loadingMore: true }))
    try {
      const src = serviceOf<SourcesService>(ctx, 'sources')
      const lib = serviceOf<LibraryService>(ctx, 'library')
      let res: PlaylistDetail | undefined
      if (src && typeof src.getPlaylist === 'function') {
        res = await src.getPlaylist(urn, { limit: 30, cursor: thirdPartyData.cursor })
      }
      if (!res && lib && typeof lib.getPlaylist === 'function') {
        res = await lib.getPlaylist(urn, { limit: 30, cursor: thirdPartyData.cursor })
      }
      if (res) {
        setThirdPartyData((prev) => {
          const prevItems = prev.detail?.items ?? []
          const existingUrns = new Set(prevItems.map((it) => it.trackUrn))
          const newItems = (res.items ?? []).filter((it) => !existingUrns.has(it.trackUrn))
          return {
            ...prev,
            detail: prev.detail ? { ...prev.detail, items: [...prevItems, ...newItems] } : res,
            hasMore: Boolean(res.hasMore),
            cursor: res.cursor,
            loadingMore: false,
          }
        })
      } else {
        setThirdPartyData((prev) => ({ ...prev, hasMore: false, loadingMore: false }))
      }
    } catch {
      setThirdPartyData((prev) => ({ ...prev, loadingMore: false }))
    }
  }, [ctx, urn, isThirdPartyUrn, thirdPartyData.cursor, thirdPartyData.hasMore, thirdPartyData.loadingMore])

  const detail = isThirdPartyUrn ? thirdPartyData.detail : state.data
  const loading = isThirdPartyUrn ? thirdPartyData.loading : state.status === 'loading'
  const error = isThirdPartyUrn ? thirdPartyData.error?.message : state.error?.message

  const reload = useCallback(() => {
    if (isThirdPartyUrn) {
      setThirdPartyRefresh((n) => n + 1)
    } else {
      state.reload()
    }
  }, [isThirdPartyUrn, state])

  // Song deduplication: filter duplicates by trackUrn (desktop logic)
  const rawItems = useMemo(() => {
    const list = isThirdPartyUrn ? (thirdPartyData.detail?.items ?? []) : (state.data?.items ?? [])
    const seen = new Set<string>()
    return list.filter((item) => {
      if (!item.trackUrn || seen.has(item.trackUrn)) return false
      seen.add(item.trackUrn)
      return true
    })
  }, [isThirdPartyUrn, thirdPartyData.detail?.items, state.data?.items])

  const urns = useMemo(() => rawItems.map((item) => item.trackUrn), [rawItems])
  const tracks = useTracksByUrn(ctx, urns)

  // Third party source info
  const sourceId =
    parsedUrn?.sourceId && parsedUrn.sourceId !== 'local' ? parsedUrn.sourceId : undefined
  const isThirdParty = Boolean(sourceId)
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const sourceRecord =
    sourceId && typeof sources?.get === 'function' ? sources.get(sourceId) : undefined
  const sourcePlugin =
    sourceId && typeof sources?.source === 'function' ? sources.source(sourceId) : undefined
  const sourceName =
    sourcePlugin?.doc?.sourceName || sourceRecord?.displayName || sourceId || ''

  const coverArtwork: ArtworkRef | undefined =
    detail?.artwork ?? (rawItems[0] ? tracks.get(rawItems[0].trackUrn)?.artwork : undefined)

  const totalDurationMs = useMemo(() => {
    return rawItems.reduce((acc, it) => acc + (tracks.get(it.trackUrn)?.durationMs ?? 0), 0)
  }, [rawItems, tracks])

  // Sorting and Filtering
  const [sortKey, setSortKey] = useState<PlaylistSortKey>('custom')
  const [sortOrder, setSortOrder] = useState<PlaylistSortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const batch = useBatchSelection()

  const toggleSort = useCallback((key: PlaylistSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortOrder('asc')
      return key
    })
  }, [])

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list: PlaylistViewRow[] = rawItems.map((item, originalIndex) => {
      const fallbackTrack: Track = {
        urn: item.trackUrn,
        title: item.trackUrn.split(':').pop() ?? item.trackUrn,
        artists: [],
      }
      const track = tracks.get(item.trackUrn) ?? fallbackTrack
      return {
        item,
        trackUrn: item.trackUrn,
        track,
        originalIndex,
      }
    })

    const matching = q
      ? list.filter(({ track, trackUrn }) => {
          if (!track) return trackUrn.toLowerCase().includes(q)
          return (
            track.title.toLowerCase().includes(q) ||
            track.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            (track.albumTitle && track.albumTitle.toLowerCase().includes(q))
          )
        })
      : list

    if (sortKey === 'custom') {
      return sortOrder === 'desc' ? [...matching].reverse() : matching
    }

    return [...matching].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = (a.track.title ?? '').localeCompare(b.track.title ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'artist') {
        const aArt = a.track.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.track.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'album') {
        cmp = (a.track.albumTitle ?? '').localeCompare(b.track.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'source') {
        const aSrc = resolveTrackSourceName(ctx, a.trackUrn)
        const bSrc = resolveTrackSourceName(ctx, b.trackUrn)
        cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'dateAdded') {
        cmp = (a.item.addedAt ?? 0) - (b.item.addedAt ?? 0)
      } else if (sortKey === 'duration') {
        cmp = (a.track.durationMs ?? 0) - (b.track.durationMs ?? 0)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [ctx, rawItems, tracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => rows.map((r) => r.trackUrn), [rows])
  const allSelected = sortedUrns.length > 0 && batch.selectedUrns.size === sortedUrns.length

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      batch.clearSelection()
    } else {
      batch.selectAll(sortedUrns)
    }
  }, [allSelected, batch, sortedUrns])

  const removeSelectedItems = useCallback(async () => {
    if (!detail || batch.selectedUrns.size === 0) return
    const itemIds = rawItems
      .filter((it) => batch.selectedUrns.has(it.trackUrn))
      .map((it) => it.id)
    if (itemIds.length > 0) {
      const lib = serviceOf<LibraryService>(ctx, 'library')
      if (lib) {
        await lib.removeItems(detail.urn, itemIds)
        batch.clearSelection()
      }
    }
  }, [ctx, detail, batch, rawItems])

  const removeSingleItem = useCallback(
    async (itemId: string) => {
      if (!detail || detail.isSmart) return
      const lib = serviceOf<LibraryService>(ctx, 'library')
      if (lib) {
        await lib.removeItems(detail.urn, [itemId])
      }
    },
    [ctx, detail],
  )

  const playTrack = useCallback(
    async (trackUrn: string, contextUrns?: readonly string[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const urnsList = contextUrns && contextUrns.length > 0 ? [...contextUrns] : sortedUrns
      const context = detail ? { kind: 'playlist' as const, urn: detail.urn, label: detail.name } : undefined
      if (player.playFromContext) {
        await player.playFromContext(trackUrn, urnsList, { context })
      } else {
        await player.playNow(urnsList, { context })
      }
    },
    [ctx, detail, sortedUrns],
  )

  const playAll = useCallback(
    async (trackUrns?: readonly string[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const list = trackUrns && trackUrns.length > 0 ? [...trackUrns] : sortedUrns
      if (list.length === 0) return
      const context = detail ? { kind: 'playlist' as const, urn: detail.urn, label: detail.name } : undefined
      await player.playNow(list, { context })
    },
    [ctx, detail, sortedUrns],
  )

  const playBatch = useCallback(async () => {
    if (batch.selectedUrns.size === 0 || !detail) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) return
    const urnsToPlay = sortedUrns.filter((u) => batch.selectedUrns.has(u))
    if (urnsToPlay.length > 0) {
      await player.playNow(urnsToPlay, {
        context: { kind: 'playlist', urn: detail.urn, label: detail.name },
      })
    }
  }, [ctx, detail, batch.selectedUrns, sortedUrns])

  return {
    detail,
    loading,
    loadingMore: thirdPartyData.loadingMore,
    hasMore: thirdPartyData.hasMore,
    error,
    reload,
    handleLoadMore,

    isThirdParty,
    sourceId,
    sourceName,
    coverArtwork,
    totalDurationMs,

    rows,
    rawItems,
    tracks,

    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    toggleSort,

    searchQuery,
    setSearchQuery,

    batch,
    sortedUrns,
    allSelected,
    toggleSelectAll,
    removeSelectedItems,
    removeSingleItem,

    playTrack,
    playAll,
    playBatch,
  }
}
