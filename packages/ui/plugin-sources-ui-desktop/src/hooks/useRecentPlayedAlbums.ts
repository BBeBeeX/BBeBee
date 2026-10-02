import { useEffect, useState, useCallback } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, PlayerService, SourcesService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

export interface UseRecentPlayedAlbumsResult {
  albums: readonly BrowseEntry[]
  loading: boolean
  refresh: () => void
}

/**
 * Loads albums of the most recent 20 unique played songs.
 *
 * Reads play history from `ctx.player` (if available), extracts up to 20 unique
 * track URNs, resolves their metadata via `ctx.sources`, and collects their
 * distinct albums as `BrowseEntry` items. Listens to `player/history-changed`.
 */
export function useRecentPlayedAlbums(ctx: Context): UseRecentPlayedAlbumsResult {
  const [albums, setAlbums] = useState<readonly BrowseEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const player = serviceOf<PlayerService>(ctx, 'player')
    const sources = serviceOf<SourcesService>(ctx, 'sources')

    if (!player || !sources) {
      setAlbums([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const records = await player!.getHistory({ limit: 100 })
        if (cancelled) return

        // Extract up to 20 unique track URNs in reverse-chronological order
        const uniqueTrackUrns: string[] = []
        const seenTracks = new Set<string>()
        for (const record of records) {
          if (record.trackUrn && !seenTracks.has(record.trackUrn)) {
            seenTracks.add(record.trackUrn)
            uniqueTrackUrns.push(record.trackUrn)
            if (uniqueTrackUrns.length >= 20) break
          }
        }

        if (uniqueTrackUrns.length === 0) {
          if (!cancelled) {
            setAlbums([])
            setLoading(false)
          }
          return
        }

        const tracks = await sources!.getTracks(uniqueTrackUrns)
        if (cancelled) return

        // Collect distinct albums
        const seenAlbums = new Set<string>()
        const albumEntries: BrowseEntry[] = []

        for (const track of tracks) {
          if (!track.albumUrn || seenAlbums.has(track.albumUrn)) continue
          seenAlbums.add(track.albumUrn)

          let albumDetail
          try {
            albumDetail = await sources!.getAlbum(track.albumUrn)
          } catch {
            // Fallback to track's own album metadata
          }

          if (cancelled) return

          const title = albumDetail?.title || track.albumTitle || '未知专辑'
          const subtitle =
            albumDetail?.artists?.map((a) => a.name).join(', ') ||
            track.artists?.map((a) => a.name).join(', ') ||
            (albumDetail?.year ? String(albumDetail.year) : undefined)
          const artwork = albumDetail?.artwork || track.artwork

          albumEntries.push({
            id: track.albumUrn,
            urn: track.albumUrn,
            title,
            subtitle,
            artwork,
            kind: 'album',
            leaf: false,
          })

          if (albumEntries.length >= 20) break
        }

        if (!cancelled) {
          setAlbums(albumEntries)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setAlbums([])
          setLoading(false)
        }
      }
    }

    void load()

    const off = ctx.on('player/history-changed', () => {
      refresh()
    })

    return () => {
      cancelled = true
      off()
    }
  }, [ctx, tick, refresh])

  return { albums, loading, refresh }
}
