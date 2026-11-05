/**
 * Headless data fetching, caching, sorting, search filtering, and batch state for Local Music.
 *
 * Consumed identically by desktop and mobile LocalMusicScreen to ensure unified
 * business logic across platforms (rules/ui.md §1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { Album, ArtworkRef, PlayerService, SourcesService, Track } from '@BBeBee/protocol'
import { serviceOf, useBatchSelection, type BatchSelectionState } from '@BBeBee/toolkit/hooks'
import { fetchAllLocalAlbums, fetchAllLocalTracks } from './local-catalog.js'

export type LocalTrackSortKey = 'default' | 'title' | 'artist' | 'album' | 'duration'
export type LocalAlbumSortKey = 'default' | 'title' | 'artist' | 'year' | 'count'
export type SortOrder = 'asc' | 'desc'

export interface LocalArtistItem {
  name: string
  count: number
  trackCount: number
  artwork?: ArtworkRef
}

export interface UseLocalMusicOptions {
  unknownAlbumLabel?: string
  targetUrns?: ReadonlySet<string>
  highlightUrn?: string
  highlightUrns?: readonly string[]
}

export interface LocalMusicState {
  tracks: readonly Track[]
  albums: readonly Album[]
  artists: readonly LocalArtistItem[]
  loading: boolean
  error: string | undefined
  reload: () => void

  // View Mode & Artist View
  viewMode: 'tracks' | 'albums' | 'artists'
  setViewMode: (mode: 'tracks' | 'albums' | 'artists') => void
  selectedArtist: string | null
  setSelectedArtist: (artist: string | null) => void
  effectiveSelectedArtist: string | null
  selectedArtistTracks: readonly Track[]
  tracksForSelectedArtist: readonly Track[]

  // Sorting
  trackSortKey: LocalTrackSortKey
  setTrackSortKey: (key: LocalTrackSortKey) => void
  trackSortOrder: SortOrder
  setTrackSortOrder: (order: SortOrder | ((prev: SortOrder) => SortOrder)) => void
  toggleTrackSort: (key: LocalTrackSortKey) => void
  sortedTracks: readonly Track[]
  sortedTrackUrns: readonly string[]

  albumSortKey: LocalAlbumSortKey
  setAlbumSortKey: (key: LocalAlbumSortKey) => void
  albumSortOrder: SortOrder
  setAlbumSortOrder: (order: SortOrder | ((prev: SortOrder) => SortOrder)) => void
  toggleAlbumSort: (key: LocalAlbumSortKey) => void
  sortedAlbums: readonly Album[]

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredTracks: readonly Track[]
  filteredAlbums: readonly Album[]
  filteredArtists: readonly LocalArtistItem[]

  // Computed Current
  currentTracks: readonly Track[]
  currentTrackUrns: readonly string[]
  allSelected: boolean
  targetUrns: ReadonlySet<string>

  // Batch
  batch: BatchSelectionState

  // Playback Helpers
  playTrack: (track: Track, contextTracks?: readonly Track[]) => Promise<void>
  playAll: (trackList?: readonly Track[]) => Promise<void>
  playBatch: () => Promise<void>
}

export function useLocalMusic(ctx: Context, options?: UseLocalMusicOptions): LocalMusicState {
  const unknownAlbum = options?.unknownAlbumLabel ?? 'Unknown Album'

  const targetUrns = useMemo(() => {
    const set = new Set<string>()
    if (options?.highlightUrn) set.add(options.highlightUrn)
    if (options?.highlightUrns) {
      for (const u of options.highlightUrns) {
        if (u) set.add(u)
      }
    }
    if (options?.targetUrns) {
      for (const u of options.targetUrns) {
        if (u) set.add(u)
      }
    }
    return set
  }, [options?.highlightUrn, options?.highlightUrns, options?.targetUrns])

  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [albums, setAlbums] = useState<readonly Album[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  const [viewMode, setViewMode] = useState<'tracks' | 'albums' | 'artists'>('tracks')
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)

  useEffect(() => {
    if (targetUrns.size > 0) {
      setViewMode('tracks')
    }
  }, [targetUrns])

  const [trackSortKey, setTrackSortKey] = useState<LocalTrackSortKey>('default')
  const [trackSortOrder, setTrackSortOrder] = useState<SortOrder>('asc')
  const [albumSortKey, setAlbumSortKey] = useState<LocalAlbumSortKey>('default')
  const [albumSortOrder, setAlbumSortOrder] = useState<SortOrder>('asc')

  const [searchQuery, setSearchQuery] = useState('')
  const batch = useBatchSelection()

  const reload = useCallback(() => {
    const sources = serviceOf<SourcesService>(ctx, 'sources') ?? ctx.sources
    if (!sources?.listTracks) {
      return
    }

    const loadAlbums = fetchAllLocalAlbums(sources).catch(() => [] as Album[])

    Promise.all([fetchAllLocalTracks(sources), loadAlbums])
      .then(([loadedTracks, loadedAlbums]) => {
        const seen = new Set<string>()
        const dedupedTracks = loadedTracks.filter((t) => {
          if (!t.urn || seen.has(t.urn)) return false
          seen.add(t.urn)
          return true
        })
        setTracks(dedupedTracks)

        if (loadedAlbums.length > 0) {
          setAlbums(loadedAlbums)
        } else {
          // Synthesize albums from local tracks if listAlbums returned empty
          const map = new Map<string, Album>()
          for (const trk of dedupedTracks) {
            const albumTitle = trk.albumTitle || unknownAlbum
            const key = trk.albumUrn || `BBeBee:local:album:${encodeURIComponent(albumTitle)}`
            if (!map.has(key)) {
              map.set(key, {
                urn: key,
                title: albumTitle,
                artists: trk.artists || [],
                year: trk.year,
                artwork: trk.artwork,
                trackCount: 1,
              })
            } else {
              const existing = map.get(key)!
              existing.trackCount = (existing.trackCount || 1) + 1
            }
          }
          setAlbums(Array.from(map.values()))
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [ctx, unknownAlbum])

  useEffect(() => {
    reload()
    const offLibrary = ctx.on?.('library/changed', (kind) => {
      if (kind === 'track' || kind === 'album' || !kind) reload()
    })
    const offScan = ctx.on?.('scan/finished', () => {
      reload()
    })
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    if (!ctx.sources?.listTracks) {
      retryTimer = setTimeout(() => {
        reload()
      }, 500)
    }
    return () => {
      offLibrary?.()
      offScan?.()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [ctx, reload])

  // Extract artists from tracks
  const artists = useMemo(() => {
    const map = new Map<string, { count: number; artwork?: ArtworkRef }>()
    for (const t of tracks) {
      const artistNames = (t.artists && t.artists.length > 0)
        ? t.artists.map((a) => a.name.trim()).filter(Boolean)
        : ['Unknown Artist']
      for (const name of artistNames) {
        if (!map.has(name)) {
          map.set(name, { count: 1, artwork: t.artwork })
        } else {
          map.get(name)!.count++
        }
      }
    }
    return Array.from(map.entries())
      .map(([name, val]) => ({ name, count: val.count, trackCount: val.count, artwork: val.artwork }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  }, [tracks])

  const toggleTrackSort = useCallback((key: LocalTrackSortKey) => {
    setTrackSortKey((prev) => {
      if (prev === key) {
        setTrackSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setTrackSortOrder('asc')
      return key
    })
  }, [])

  const toggleAlbumSort = useCallback((key: LocalAlbumSortKey) => {
    setAlbumSortKey((prev) => {
      if (prev === key) {
        setAlbumSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setAlbumSortOrder('asc')
      return key
    })
  }, [])

  // Sorted Tracks
  const sortedTracks = useMemo(() => {
    let list = tracks
    if (trackSortKey === 'default') {
      if (targetUrns && targetUrns.size > 0) {
        const highlighted: Track[] = []
        const others: Track[] = []
        for (const t of tracks) {
          if (targetUrns.has(t.urn)) highlighted.push(t)
          else others.push(t)
        }
        list = [...highlighted, ...others]
      }
      return trackSortOrder === 'desc' ? [...list].reverse() : list
    }
    const copy = [...tracks]
    copy.sort((a, b) => {
      let cmp = 0
      switch (trackSortKey) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true, sensitivity: 'base' })
          break
        case 'artist': {
          const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
          const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
          cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
        case 'album':
          cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, { numeric: true, sensitivity: 'base' })
          break
        case 'duration':
          cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
          break
      }
      return trackSortOrder === 'asc' ? cmp : -cmp
    })
    return copy
  }, [tracks, trackSortKey, trackSortOrder, targetUrns])

  // Filtered Tracks by search
  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedTracks
    return sortedTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
        t.albumTitle?.toLowerCase().includes(q),
    )
  }, [sortedTracks, searchQuery])

  // Sorted Albums
  const sortedAlbums = useMemo(() => {
    if (albumSortKey === 'default') {
      return albumSortOrder === 'desc' ? [...albums].reverse() : albums
    }
    const copy = [...albums]
    copy.sort((a, b) => {
      let cmp = 0
      switch (albumSortKey) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true, sensitivity: 'base' })
          break
        case 'artist': {
          const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
          const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
          cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
          break
        }
        case 'year':
          cmp = (a.year ?? 0) - (b.year ?? 0)
          break
        case 'count':
          cmp = (a.trackCount ?? 0) - (b.trackCount ?? 0)
          break
      }
      return albumSortOrder === 'asc' ? cmp : -cmp
    })
    return copy
  }, [albums, albumSortKey, albumSortOrder])

  // Filtered Albums by search
  const filteredAlbums = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedAlbums
    return sortedAlbums.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.artists?.some((art) => art.name.toLowerCase().includes(q)),
    )
  }, [sortedAlbums, searchQuery])

  // Filtered Artists by search
  const filteredArtists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return artists
    return artists.filter((a) => a.name.toLowerCase().includes(q))
  }, [artists, searchQuery])

  // Effective selected artist with fallback to first filtered or first artist
  const effectiveSelectedArtist = useMemo(() => {
    if (artists.length === 0) return null
    if (selectedArtist && artists.some((a) => a.name === selectedArtist)) {
      return selectedArtist
    }
    if (filteredArtists.length > 0) {
      return filteredArtists[0]?.name ?? null
    }
    return artists[0]?.name ?? null
  }, [artists, filteredArtists, selectedArtist])

  const selectedArtistTracks = useMemo(() => {
    if (!effectiveSelectedArtist) return []
    const unknownArtistLabel = options?.unknownAlbumLabel ?? 'Unknown Artist'
    return tracks.filter((t) => {
      const tArtists = t.artists && t.artists.length > 0 ? t.artists : [{ name: unknownArtistLabel }]
      return tArtists.some((a) => (a.name?.trim() || unknownArtistLabel) === effectiveSelectedArtist)
    })
  }, [tracks, effectiveSelectedArtist, options?.unknownAlbumLabel])

  // Tracks for selected artist (filtered by search and sorted)
  const tracksForSelectedArtist = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? selectedArtistTracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            t.albumTitle?.toLowerCase().includes(q),
        )
      : [...selectedArtistTracks]

    if (trackSortKey === 'default') {
      return trackSortOrder === 'desc' ? matching.reverse() : matching
    }
    return matching.sort((a, b) => {
      let cmp = 0
      if (trackSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'album') {
        cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (trackSortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      }
      return trackSortOrder === 'desc' ? -cmp : cmp
    })
  }, [selectedArtistTracks, searchQuery, trackSortKey, trackSortOrder])

  const currentTracks = useMemo(() => {
    if (viewMode === 'artists') {
      return tracksForSelectedArtist
    }
    return filteredTracks
  }, [viewMode, tracksForSelectedArtist, filteredTracks])

  const currentTrackUrns = useMemo(() => currentTracks.map((t) => t.urn), [currentTracks])
  const sortedTrackUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])
  const allSelected = currentTrackUrns.length > 0 && batch.selectedUrns.size === currentTrackUrns.length

  // Playback handlers
  const playTrack = useCallback(
    async (track: Track, contextTracks?: readonly Track[]) => {
      const player = serviceOf<PlayerService>(ctx, 'player')
      if (!player) return
      const list = contextTracks && contextTracks.length > 0 ? contextTracks : filteredTracks
      const urns = list.map((t) => t.urn)
      if (player.playFromContext) {
        await player.playFromContext(track.urn, urns)
      } else {
        await player.playNow(urns)
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
    tracks,
    albums,
    artists,
    loading,
    error,
    reload,

    viewMode,
    setViewMode,
    selectedArtist,
    setSelectedArtist,
    effectiveSelectedArtist,
    selectedArtistTracks,
    tracksForSelectedArtist,

    trackSortKey,
    setTrackSortKey,
    trackSortOrder,
    setTrackSortOrder,
    toggleTrackSort,
    sortedTracks,
    sortedTrackUrns,

    albumSortKey,
    setAlbumSortKey,
    albumSortOrder,
    setAlbumSortOrder,
    toggleAlbumSort,
    sortedAlbums,

    searchQuery,
    setSearchQuery,
    filteredTracks,
    filteredAlbums,
    filteredArtists,

    currentTracks,
    currentTrackUrns,
    allSelected,
    targetUrns,

    batch,

    playTrack,
    playAll,
    playBatch,
  }
}
