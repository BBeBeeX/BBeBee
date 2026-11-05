/**
 * View hooks for `plugin-album`.
 *
 * One read, written once for both shells (docs/08 §4). The album's data is a
 * catalogue row, so the read goes to `ctx.sources` — this hook exists so the
 * two view packages cannot grow two different ideas of what "album not found"
 * means.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AlbumDetail, PlayerService, Track } from '@BBeBee/protocol'
import { resolveTrackSourceName, serviceOf, useBatchSelection, type AsyncState, type BatchSelectionState } from '@BBeBee/toolkit/hooks'

export interface AlbumRead extends AsyncState<AlbumDetail> {
  hasMore?: boolean
  loadingMore?: boolean
  loadMore?: () => void
}

/**
 * One album with its tracks. `undefined` data means "no such album".
 *
 * `error` is used for a missing album as well as a failed read, deliberately:
 * a screen has the same thing to say either way — this album cannot be shown —
 * and a distinct empty state for a URN nobody has would be a distinction
 * without a difference.
 */
export function useAlbum(ctx: Context, urn: string | undefined): AlbumRead {
  const [state, setState] = useState<AsyncState<AlbumDetail> & { hasMore?: boolean; loadingMore?: boolean }>({
    status: 'idle',
    hasMore: false,
    loadingMore: false,
  })
  const cursorRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!urn) {
      cursorRef.current = undefined
      setState({ status: 'idle', hasMore: false, loadingMore: false })
      return
    }
    let cancelled = false
    cursorRef.current = undefined
    setState({ status: 'loading', hasMore: false, loadingMore: false })

    ctx.sources
      .getAlbum(urn, { limit: 30 })
      .then((album) => {
        if (cancelled) return
        cursorRef.current = album?.cursor
        setState(
          album
            ? {
                status: 'ready',
                data: album,
                hasMore: Boolean(album.hasMore),
                loadingMore: false,
              }
            : { status: 'error', error: new Error(`no album ${urn}`), hasMore: false, loadingMore: false },
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          hasMore: false,
          loadingMore: false,
        })
      })
    return () => void (cancelled = true)
  }, [ctx, urn])

  const loadMore = useCallback(() => {
    if (!urn || !state.hasMore || state.loadingMore || !cursorRef.current) return
    setState((prev) => ({ ...prev, loadingMore: true }))

    ctx.sources
      .getAlbum(urn, { cursor: cursorRef.current, limit: 30 })
      .then((nextAlbum) => {
        cursorRef.current = nextAlbum?.cursor
        setState((prev) => {
          if (!prev.data || !nextAlbum) return { ...prev, loadingMore: false }
          const existingUrns = new Set(prev.data.tracks.map((t) => t.urn))
          const newTracks = nextAlbum.tracks.filter((t) => !existingUrns.has(t.urn))
          return {
            ...prev,
            loadingMore: false,
            hasMore: Boolean(nextAlbum.hasMore),
            data: {
              ...prev.data,
              tracks: [...prev.data.tracks, ...newTracks],
            },
          }
        })
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loadingMore: false }))
      })
  }, [ctx, urn, state.hasMore, state.loadingMore])

  return { ...state, loadMore }
}

export type AlbumTrackSortKey = 'default' | 'trackNo' | 'title' | 'artist' | 'album' | 'duration' | 'plays' | 'source'
export type AlbumSortOrder = 'asc' | 'desc'

export interface AlbumViewState {
  album: AlbumDetail | undefined
  loading: boolean
  error: string | undefined
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredTracks: readonly Track[]
  sortedUrns: readonly string[]
  allSelected: boolean

  // Sorting
  sortKey: AlbumTrackSortKey
  setSortKey: (key: AlbumTrackSortKey) => void
  sortOrder: AlbumSortOrder
  setSortOrder: (order: AlbumSortOrder | ((prev: AlbumSortOrder) => AlbumSortOrder)) => void
  toggleSort: (key: AlbumTrackSortKey) => void
  sortedTracks: readonly Track[]

  // Batch
  batch: BatchSelectionState

  // Playback
  playTrack: (track: Track, contextTracks?: readonly Track[]) => Promise<void>
  playAll: (trackList?: readonly Track[]) => Promise<void>
  playBatch: () => Promise<void>
}

export function useAlbumView(ctx: Context, urn: string | undefined): AlbumViewState {
  const read = useAlbum(ctx, urn)
  const album = read.data
  const tracks = useMemo(() => {
    const raw = album?.tracks ?? []
    const seen = new Set<string>()
    return raw.filter((t) => {
      if (!t.urn || seen.has(t.urn)) return false
      seen.add(t.urn)
      return true
    })
  }, [album?.tracks])

  const [sortKey, setSortKey] = useState<AlbumTrackSortKey>('trackNo')
  const [sortOrder, setSortOrder] = useState<AlbumSortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const batch = useBatchSelection()

  const toggleSort = useCallback((key: AlbumTrackSortKey) => {
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
    if (sortKey === 'default' || sortKey === 'trackNo') {
      return sortOrder === 'asc' ? tracks : [...tracks].reverse()
    }
    const copy = [...tracks]
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
        case 'album': {
          const aAlb = a.albumTitle || album?.title || ''
          const bAlb = b.albumTitle || album?.title || ''
          cmp = aAlb.localeCompare(bAlb, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
        case 'duration':
          cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
          break
        case 'plays':
          cmp = 0
          break
        case 'source': {
          const aSrc = resolveTrackSourceName(ctx, a.urn)
          const bSrc = resolveTrackSourceName(ctx, b.urn)
          cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })
    return copy
  }, [tracks, sortKey, sortOrder, album?.title, ctx])

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedTracks
    return sortedTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artists?.some((a) => a.name.toLowerCase().includes(q)),
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
    const urnsToPlay = tracks
      .filter((t) => batch.selectedUrns.has(t.urn))
      .map((t) => t.urn)
    if (urnsToPlay.length > 0) {
      await player.playNow(urnsToPlay)
    }
  }, [ctx, batch.selectedUrns, tracks])

  return {
    album,
    loading: read.status === 'loading',
    error: read.error?.message,
    hasMore: Boolean(read.hasMore),
    loadingMore: Boolean(read.loadingMore),
    loadMore: read.loadMore ?? (() => {}),

    searchQuery,
    setSearchQuery,
    filteredTracks,
    sortedUrns: filteredTracks.map((t) => t.urn),
    allSelected: filteredTracks.length > 0 && batch.selectedUrns.size === filteredTracks.length,

    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    toggleSort,
    sortedTracks,

    batch,

    playTrack,
    playAll,
    playBatch,
  }
}

