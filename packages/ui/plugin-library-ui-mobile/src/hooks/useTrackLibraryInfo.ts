import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, SourcesService, Track } from '@BBeBee/protocol'
import { usePlaylists, useSaved } from '@bbebee/plugin-library/hooks'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { useSaveToPlaylistMenu } from '@BBeBee/ui-menus'
import { useI18n } from '@BBeBee/ui-kit-mobile'

export function useTrackLibraryInfo(ctx: Context) {
  const { t } = useI18n(ctx)
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const savedTracks = useSaved(ctx, 'track')
  const playlists = usePlaylists(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)

  const savedTrackUrns = useMemo(() => {
    return new Set(savedTracks.data?.map((e) => e.urn) ?? [])
  }, [savedTracks.data])

  // A row's `track.loved` is the value of whoever handed the row over — the
  // local screen's mount-time snapshot can be stale by hours. When a
  // favorite write fires `library/changed`, re-read the changed URNs from
  // the catalogue so the heart follows the truth and not the snapshot; this
  // is what makes unfavorite drop a row's heart back to a plus.
  const [lovedLive, setLovedLive] = useState<Map<string, boolean>>(new Map())
  useEffect(() => {
    const off = ctx.on('library/changed', (kind, urns) => {
      if (kind !== 'track') return
      const list = (urns ?? []).filter(Boolean)
      const catalogue = serviceOf<SourcesService>(ctx, 'sources')
      if (list.length === 0 || !catalogue?.getTracks) return
      void catalogue
        .getTracks(list)
        .then((tracks) => {
          const loved = new Map(tracks.map((t) => [t.urn, t.loved === true]))
          setLovedLive((prev) => {
            const next = new Map(prev)
            for (const urn of list) next.set(urn, loved.get(urn) ?? false)
            return next
          })
        })
        .catch(() => {})
    })
    return () => {
      off()
    }
  }, [ctx])

  const isTrackInLibrary = useCallback(
    (track: Track, alwaysInLibrary = false): boolean => {
      if (alwaysInLibrary) return true
      // The live saved set outranks the row's possibly-stale `loved` flag.
      if (savedTrackUrns.has(track.urn)) return true
      const liveLoved = lovedLive.get(track.urn)
      if (liveLoved !== undefined) return liveLoved
      return track.loved === true
    },
    [savedTrackUrns, lovedLive],
  )

  const handleAddToFavorites = useCallback(
    async (track: Track) => {
      if (!library) return
      // Catalogue first: the `library/changed` event the shelf write fires
      // must already see the loved flag, or listeners re-read stale state.
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, true).catch(() => {})
      }
      await library.setSaved(track.urn, true)
    },
    [library, sources],
  )

  const handleToggleFavorite = useCallback(
    async (track: Track) => {
      if (!library) return
      const currentlyLoved = isTrackInLibrary(track)
      const nextLoved = !currentlyLoved
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, nextLoved).catch(() => {})
      }
      await library.setSaved(track.urn, nextLoved)
    },
    [library, sources, isTrackInLibrary],
  )

  const openAddToPlaylistMenu = useCallback(
    (track: Track, anchor?: MenuAnchor) => {
      saveToPlaylistMenu.open(track, anchor)
    },
    [saveToPlaylistMenu],
  )

  const openBatchAddToPlaylistMenu = useCallback(
    (tracks: readonly (Track | string)[], anchor?: MenuAnchor, title?: string) => {
      saveToPlaylistMenu.openBatch(tracks, anchor, title)
    },
    [saveToPlaylistMenu],
  )

  const closeAddToPlaylistMenu = useCallback(() => {
    saveToPlaylistMenu.close()
  }, [saveToPlaylistMenu])

  return {
    t,
    isTrackInLibrary,
    handleAddToFavorites,
    handleToggleFavorite,
    openAddToPlaylistMenu,
    openBatchAddToPlaylistMenu,
    closeAddToPlaylistMenu,
    saveToPlaylistMenuProps: saveToPlaylistMenu.menuProps,
    playlists: playlists.data ?? [],
  }
}
