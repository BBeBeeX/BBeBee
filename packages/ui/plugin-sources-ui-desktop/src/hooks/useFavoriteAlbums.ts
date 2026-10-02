import { useEffect, useState, useCallback } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, LibraryService, SourcesService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

export interface UseFavoriteAlbumsResult {
  albums: readonly BrowseEntry[]
  loading: boolean
  refresh: () => void
}

/**
 * Loads albums corresponding to 20 randomly picked tracks from the user's favorites/saved library.
 *
 * Reads saved tracks from `ctx.library` (if available), randomly samples up to 20 songs,
 * resolves track metadata via `ctx.sources`, and collects their distinct albums as
 * `BrowseEntry` items. Listens to `library/changed`.
 */
export function useFavoriteAlbums(ctx: Context): UseFavoriteAlbumsResult {
  const [albums, setAlbums] = useState<readonly BrowseEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const library = serviceOf<LibraryService>(ctx, 'library')
    const sources = serviceOf<SourcesService>(ctx, 'sources')

    if (!library || !sources) {
      setAlbums([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const saved = await library!.listSaved('track')
        if (cancelled) return

        const trackEntries = (saved?.items ?? []).filter((entry) => entry.kind === 'track')
        if (trackEntries.length === 0) {
          if (!cancelled) {
            setAlbums([])
            setLoading(false)
          }
          return
        }

        // Shuffle track entries and take up to 20
        const shuffled = [...trackEntries]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const temp = shuffled[i]!
          shuffled[i] = shuffled[j]!
          shuffled[j] = temp
        }

        const sampledUrns = shuffled.slice(0, 20).map((e) => e.urn)
        const tracks = await sources!.getTracks(sampledUrns)
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
            // Fallback to track's album metadata
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

    const off = ctx.on('library/changed', (kind) => {
      if (!kind || kind === 'track') {
        refresh()
      }
    })

    return () => {
      cancelled = true
      off()
    }
  }, [ctx, tick, refresh])

  return { albums, loading, refresh }
}
