import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, SourcesService, Track } from '@BBeBee/protocol'
import { usePlaylists, useSaved } from '@BBeBee/plugin-library/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { useSaveToPlaylistMenu } from '@BBeBee/ui-menus'

export function useTrackLibraryInfo(ctx: Context) {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const savedTracks = useSaved(ctx, 'track')
  const playlists = usePlaylists(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)
  const [activeTrack, setActiveTrack] = useState<Track | null>(null)

  const savedTrackUrns = useMemo(() => {
    return new Set(savedTracks.data?.map((e) => e.urn) ?? [])
  }, [savedTracks.data])

  // A row's `track.loved` is the value of whoever handed the row over — the
  // local screen's mount-time snapshot can be stale by hours. When a
  // favourite write fires `library/changed`, re-read the changed URNs from
  // the catalogue so the heart follows the truth and not the snapshot; this
  // is what makes unfavourite drop a row's heart back to a plus.
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

  const openAddToPlaylistMenu = useCallback((track: Track, anchor: MenuAnchor) => {
    setActiveTrack(track)
    saveToPlaylistMenu.open(track, anchor)
  }, [saveToPlaylistMenu])

  const openBatchAddToPlaylistMenu = useCallback((tracks: readonly (Track | string)[], anchor: MenuAnchor, title?: string) => {
    saveToPlaylistMenu.openBatch(tracks, anchor, title)
  }, [saveToPlaylistMenu])

  const closeAddToPlaylistMenu = useCallback(() => {
    setActiveTrack(null)
    saveToPlaylistMenu.close()
  }, [saveToPlaylistMenu])

  const addToPlaylistMenuItems = useMemo((): MenuItemSpec[] => {
    if (!saveToPlaylistMenu.menuProps.open || !activeTrack || !library) return []
    const track = activeTrack
    const list = playlists.data ?? []
    const items: MenuItemSpec[] = [
      {
        id: 'create-new-playlist',
        label: '新建歌单',
        icon: 'plus',
        onSelect: async () => {
          const name = window.prompt('歌单名称：')
          if (name && name.trim()) {
            const p = await library.createPlaylist(name.trim())
            if (p) await library.addTracks(p.urn, [track.urn])
          }
        },
        divider: list.length > 0,
      },
      ...list.map((playlist) => ({
        id: playlist.urn,
        label: playlist.name,
        icon: 'music',
        disabled: playlist.isSmart,
        onSelect: async () => {
          await library.addTracks(playlist.urn, [track.urn])
        },
      })),
    ]
    return items
  }, [saveToPlaylistMenu.menuProps.open, activeTrack, library, playlists.data])

  return {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    openBatchAddToPlaylistMenu,
    closeAddToPlaylistMenu,
    addToPlaylistMenuState: saveToPlaylistMenu.menuProps.open && activeTrack
      ? { track: activeTrack, anchor: { x: saveToPlaylistMenu.menuProps.x, y: saveToPlaylistMenu.menuProps.y } }
      : null,
    addToPlaylistMenuItems,
    saveToPlaylistMenuProps: saveToPlaylistMenu.menuProps,
  }
}
