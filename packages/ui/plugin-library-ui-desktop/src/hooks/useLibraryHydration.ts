import { useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type {
  AlbumDetail,
  ArtworkRef,
  Collection,
  PlayerService,
  Playlist,
  Track,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { fetchAllLocalTracks } from '@BBeBee/plugin-library/hooks'

export interface UseLibraryHydrationParams {
  ctx: Context
  generation: number
  savedAlbumEntries?: readonly { urn: string }[]
  savedTrackEntries?: readonly { urn: string }[]
  playlists?: readonly Playlist[]
  collections?: readonly Collection[]
}

export function useLibraryHydration({
  ctx,
  generation,
  savedAlbumEntries,
  savedTrackEntries,
  playlists,
  collections,
}: UseLibraryHydrationParams) {
  const [historyRecords, setHistoryRecords] = useState<readonly { trackUrn: string; playedAt: number }[]>([])
  const [localTracks, setLocalTracks] = useState<readonly Track[]>([])
  const [albumsMap, setAlbumsMap] = useState<Map<string, AlbumDetail>>(new Map())
  const [playlistFirstTrackArtworks, setPlaylistFirstTrackArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [collectionFirstArtworks, setCollectionFirstArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [containedPlaylistUrns, setContainedPlaylistUrns] = useState<Set<string>>(new Set())
  const [favoriteArtwork, setFavoriteArtwork] = useState<ArtworkRef | undefined>(undefined)

  // Load history records if supported
  useEffect(() => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    if (!p?.getHistory) return
    let cancelled = false
    p.getHistory({ limit: 100 })
      .then((records) => {
        if (!cancelled) {
          setHistoryRecords(
            records.map((r) => ({
              trackUrn: r.trackUrn,
              playedAt: r.endedAt ?? r.startedAt,
            })),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Load local tracks
  useEffect(() => {
    let cancelled = false
    if (!ctx.sources?.listTracks) return
    fetchAllLocalTracks(ctx.sources)
      .then((items) => {
        if (!cancelled) setLocalTracks(items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Hydrate saved albums
  useEffect(() => {
    const urns = savedAlbumEntries?.map((e) => e.urn) ?? []
    if (urns.length === 0) {
      setAlbumsMap((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let cancelled = false
    Promise.all(urns.map((urn) => ctx.sources?.getAlbum(urn).catch(() => undefined)))
      .then((results) => {
        if (cancelled) return
        const map = new Map<string, AlbumDetail>()
        for (const res of results) {
          if (res) map.set(res.urn, res)
        }
        setAlbumsMap(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedAlbumEntries, generation])

  // Load first track cover for playlists
  useEffect(() => {
    const list = playlists ?? []
    let cancelled = false
    const toFetch = list.filter((p) => !p.artwork)
    if (toFetch.length === 0) return
    Promise.all(
      toFetch.map(async (p) => {
        try {
          const detail = await ctx.library.getPlaylist(p.urn)
          const firstUrn = detail?.items[0]?.trackUrn
          if (!firstUrn) return null
          const tracks = await ctx.sources.getTracks([firstUrn])
          if (tracks[0]?.artwork) return { urn: p.urn, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setPlaylistFirstTrackArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.urn) || prev.get(res.urn) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.urn, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, playlists, generation])

  // Load first track cover for collections
  useEffect(() => {
    const list = collections ?? []
    let cancelled = false
    if (list.length === 0) return
    Promise.all(
      list.map(async (c) => {
        try {
          const items = await ctx.library.listCollectionItems(c.id)
          const firstTrack = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'track')
          if (!firstTrack) {
            const firstAlbum = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'album')
            if (firstAlbum) {
              const album = await ctx.sources.getAlbum(firstAlbum.urn)
              if (album?.artwork) return { id: c.id, artwork: album.artwork }
            }
            return null
          }
          const tracks = await ctx.sources.getTracks([firstTrack.urn])
          if (tracks[0]?.artwork) return { id: c.id, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setCollectionFirstArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.id) || prev.get(res.id) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.id, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, collections, generation])

  // Track which playlists are contained inside any collection/folder
  useEffect(() => {
    const list = collections ?? []
    let cancelled = false
    if (list.length === 0) {
      setContainedPlaylistUrns((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }

    Promise.all(
      list.map(async (c) => {
        try {
          const page = await ctx.library.listCollectionItems(c.id, { limit: 1000 })
          return (page?.items ?? [])
            .filter((item) => tryParseUrn(item.urn)?.kind === 'playlist')
            .map((item) => item.urn)
        } catch {
          return []
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const set = new Set<string>()
        for (const urns of results) {
          for (const urn of urns) {
            set.add(urn)
          }
        }
        setContainedPlaylistUrns((prev) => {
          if (prev.size === set.size && Array.from(set).every((u) => prev.has(u))) {
            return prev
          }
          return set
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [ctx, collections, generation])

  // First favorite track cover
  useEffect(() => {
    const firstUrn = savedTrackEntries?.[0]?.urn
    if (!firstUrn) {
      setFavoriteArtwork((prev) => (prev === undefined ? prev : undefined))
      return
    }
    let cancelled = false
    ctx.sources
      ?.getTracks([firstUrn])
      .then((tracks) => {
        if (!cancelled && tracks[0]?.artwork) setFavoriteArtwork(tracks[0].artwork)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedTrackEntries])

  const historyMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const rec of historyRecords) {
      if (!map.has(rec.trackUrn) || rec.playedAt > map.get(rec.trackUrn)!) {
        map.set(rec.trackUrn, rec.playedAt)
      }
    }
    return map
  }, [historyRecords])

  return {
    historyMap,
    localTracks,
    albumsMap,
    playlistFirstTrackArtworks,
    collectionFirstArtworks,
    containedPlaylistUrns,
    setContainedPlaylistUrns,
    favoriteArtwork,
  }
}
