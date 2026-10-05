import { useCallback, useState } from 'react'
import type { Context } from 'cordis'
import type {
  AlbumDetail,
  Collection,
  PlayerService,
  Playlist,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { collectAllFolderTracks } from '@BBeBee/plugin-library/hooks'
import type { useAddToCollection, useCollectionMenu, usePlaylistMenu } from '@BBeBee/ui-menus'
import type { DeleteConfirmTarget } from '../components/modals/ConfirmDeleteModal.js'
import type { UnifiedItem } from '../components/UnifiedLibraryRow.js'

export interface UseLibraryActionsParams {
  ctx: Context
  pinnedUrns: Set<string>
  collections: readonly Collection[]
  albumsMap: Map<string, AlbumDetail>
  player: PlayerService | undefined
  playlistMenu: ReturnType<typeof usePlaylistMenu>
  collectionMenu: ReturnType<typeof useCollectionMenu>
  albumMenu: ReturnType<typeof useAddToCollection>
  setGeneration: (fn: (n: number) => number) => void
  setFolderItemsMap: (fn: (prev: Map<string, UnifiedItem[]>) => Map<string, UnifiedItem[]>) => void
  setContainedPlaylistUrns: (fn: (prev: Set<string>) => Set<string>) => void
  setError: (err: string | undefined) => void
  fail: (what: string) => (cause: unknown) => void
}

export function useLibraryActions({
  ctx,
  pinnedUrns,
  collections,
  albumsMap,
  player,
  playlistMenu,
  collectionMenu,
  albumMenu,
  setGeneration,
  setFolderItemsMap,
  setContainedPlaylistUrns,
  setError,
  fail,
}: UseLibraryActionsParams) {
  const [pinnedExtraIds, setPinnedExtraIds] = useState<Set<string>>(new Set())

  const [simpleMenu, setSimpleMenu] = useState<{
    title: string
    items: MenuItemSpec[]
    anchor: MenuAnchor
  } | undefined>(undefined)

  const [editingPlaylist, setEditingPlaylist] = useState<(Playlist & { description?: string }) | null>(null)
  const [renamingCollection, setRenamingCollection] = useState<Collection | null>(null)
  const [createInFolderModal, setCreateInFolderModal] = useState<{ type: 'playlist' | 'folder'; folderId: string } | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<DeleteConfirmTarget | null>(null)

  const isItemPinned = useCallback(
    (item: { id?: string; urn?: string }) => {
      if (item.urn) return pinnedUrns.has(item.urn)
      return item.id ? pinnedExtraIds.has(item.id) : false
    },
    [pinnedUrns, pinnedExtraIds],
  )

  const togglePin = useCallback(
    async (item: { id?: string; urn?: string }) => {
      try {
        if (item.urn) {
          const currentlyPinned = pinnedUrns.has(item.urn)
          if (!currentlyPinned) {
            const isSaved = await ctx.library.isSaved(item.urn)
            if (!isSaved) await ctx.library.setSaved(item.urn, true)
            await ctx.library.setPinned(item.urn, true)
          } else {
            await ctx.library.setPinned(item.urn, false)
          }
        } else if (item.id) {
          setPinnedExtraIds((prev) => {
            const next = new Set(prev)
            if (next.has(item.id!)) next.delete(item.id!)
            else next.add(item.id!)
            return next
          })
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [ctx, pinnedUrns, setError],
  )

  const playPlaylist = useCallback(
    (urn: string, name: string) => {
      void ctx.library
        .getPlaylist(urn)
        .then((detail) => {
          const urns = detail?.items.map((i) => i.trackUrn) ?? []
          if (urns[0]) {
            void ctx.player.playFromContext(urns[0], urns, {
              context: { kind: 'playlist', urn, label: name },
            })
          }
        })
        .catch(fail('could not play playlist'))
    },
    [ctx, fail],
  )

  const playAlbum = useCallback(
    (urn: string, title: string) => {
      const album = albumsMap.get(urn)
      const urns = album?.tracks?.map((t) => t.urn) ?? []
      if (urns[0]) {
        void ctx.player.playFromContext(urns[0], urns, {
          context: { kind: 'album', urn, label: title },
        })
      } else {
        void ctx.sources
          .getAlbum(urn)
          .then((detail) => {
            const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
            if (trackUrns[0]) {
              void ctx.player.playFromContext(trackUrns[0], trackUrns, {
                context: { kind: 'album', urn, label: title },
              })
            }
          })
          .catch(fail('could not play album'))
      }
    },
    [ctx, albumsMap, fail],
  )

  const playCollection = useCallback(
    (id: string) => {
      void ctx.library
        .listCollectionItems(id)
        .then((page) => {
          const trackUrns = page.items
            .filter((i) => tryParseUrn(i.urn)?.kind === 'track')
            .map((i) => i.urn)
          if (trackUrns[0]) void player?.playNow(trackUrns, { context: { kind: 'playlist', urn: id } })
        })
        .catch(fail('could not play collection'))
    },
    [ctx, player, fail],
  )

  const openPlaylistMenu = useCallback(
    (playlist: Playlist, anchor?: MenuAnchor, isPinned?: boolean, folderId?: string) => {
      const handleMoved = (targetFolderId?: string | null) => {
        if (targetFolderId) {
          setContainedPlaylistUrns((prev) => new Set([...prev, playlist.urn]))
        } else if (targetFolderId === null) {
          setContainedPlaylistUrns((prev) => {
            const next = new Set(prev)
            next.delete(playlist.urn)
            return next
          })
        }
        if (folderId) {
          setFolderItemsMap((prev) => {
            const existing = prev.get(folderId)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(
              folderId,
              existing.filter((item) => item.urn !== playlist.urn && item.id !== playlist.urn),
            )
            return next
          })
        }
        setGeneration((n) => n + 1)
      }

      void ctx.library
        .getPlaylist(playlist.urn)
        .then((detail) =>
          playlistMenu.open(
            playlist,
            detail?.items.map((item) => item.trackUrn) ?? [],
            anchor,
            {
              pinned: isPinned,
              currentFolderId: folderId,
              onMoved: handleMoved,
              onTogglePin: () => void togglePin(playlist),
              onEdit: () => setEditingPlaylist(detail ?? playlist),
              onDelete: () => {
                setConfirmDeleteTarget({
                  type: 'playlist',
                  urn: playlist.urn,
                  name: playlist.name,
                  folderId,
                })
              },
            },
          ),
        )
        .catch(() =>
          playlistMenu.open(playlist, [], anchor, {
            pinned: isPinned,
            currentFolderId: folderId,
            onMoved: handleMoved,
            onTogglePin: () => void togglePin(playlist),
            onEdit: () => setEditingPlaylist(playlist),
            onDelete: () => {
              setConfirmDeleteTarget({
                type: 'playlist',
                urn: playlist.urn,
                name: playlist.name,
                folderId,
              })
            },
          }),
        )
    },
    [ctx, playlistMenu, setContainedPlaylistUrns, setFolderItemsMap, setGeneration, togglePin],
  )

  const openCollectionMenu = useCallback(
    (collection: Collection, anchor?: MenuAnchor, isPinned?: boolean) => {
      void collectAllFolderTracks(ctx, collection.id, collections, albumsMap)
        .then((allTracks) =>
          collectionMenu.open(
            collection.name,
            allTracks,
            anchor,
            {
              collectionId: collection.id,
              parentId: collection.parentId ?? null,
              pinned: isPinned,
              onTogglePin: () => void togglePin({ id: collection.id }),
              onRename: () => setRenamingCollection(collection),
              onDelete: () => {
                void ctx.library
                  .deleteCollection(collection.id)
                  .then(() => setGeneration((n) => n + 1))
                  .catch(fail('could not delete the collection'))
              },
              onCreatePlaylist: () => setCreateInFolderModal({ type: 'playlist', folderId: collection.id }),
              onCreateFolder: () => setCreateInFolderModal({ type: 'folder', folderId: collection.id }),
              onMoveToFolder: (targetFolderId: string | null) => {
                void ctx.library
                  .moveCollection?.(collection.id, targetFolderId)
                  .then(() => setGeneration((n) => n + 1))
                  .catch(fail('could not move the collection'))
              },
              onPlay: () => {
                if (allTracks[0])
                  void player?.playNow(allTracks, {
                    context: { kind: 'playlist', urn: collection.id, label: collection.name },
                  })
              },
            },
          ),
        )
        .catch(() =>
          collectionMenu.open(collection.name, [], anchor, {
            collectionId: collection.id,
            parentId: collection.parentId ?? null,
            pinned: isPinned,
            onTogglePin: () => void togglePin({ id: collection.id }),
            onRename: () => setRenamingCollection(collection),
            onDelete: () => {
              void ctx.library
                .deleteCollection(collection.id)
                .then(() => setGeneration((n) => n + 1))
                .catch(fail('could not delete the collection'))
            },
            onCreatePlaylist: () => setCreateInFolderModal({ type: 'playlist', folderId: collection.id }),
            onCreateFolder: () => setCreateInFolderModal({ type: 'folder', folderId: collection.id }),
            onMoveToFolder: (targetFolderId: string | null) => {
              void ctx.library
                .moveCollection?.(collection.id, targetFolderId)
                .then(() => setGeneration((n) => n + 1))
                .catch(fail('could not move the collection'))
            },
          }),
        )
    },
    [ctx, collectionMenu, collections, albumsMap, togglePin, player, setGeneration, fail],
  )

  const openAlbumMenu = useCallback(
    (album: { urn: string; title: string }, anchor?: MenuAnchor, isPinned?: boolean, folderId?: string) => {
      albumMenu.open(album.title, [album.urn], anchor, {
        pinned: isPinned,
        currentFolderId: folderId,
        onMoved: () => {
          if (folderId) {
            setFolderItemsMap((prev) => {
              const existing = prev.get(folderId)
              if (!existing) return prev
              const next = new Map(prev)
              next.set(
                folderId,
                existing.filter((item) => item.urn !== album.urn && item.id !== album.urn),
              )
              return next
            })
          }
          setGeneration((n) => n + 1)
        },
        onTogglePin: () => void togglePin({ id: album.urn, urn: album.urn }),
        onDelete: () => {
          setConfirmDeleteTarget({
            type: 'album',
            urn: album.urn,
            name: album.title,
            folderId,
          })
        },
      })
    },
    [albumMenu, setFolderItemsMap, setGeneration, togglePin],
  )

  const openBuiltinMenu = useCallback(
    (
      title: string,
      onPlay: () => void,
      isPinned: boolean,
      item: { id: string },
      anchor?: MenuAnchor,
    ) => {
      setSimpleMenu({
        title,
        anchor: anchor ?? { x: 300, y: 300 },
        items: [
          {
            id: 'play-all',
            label: '播放全部',
            icon: tablerIcon('play', { size: 20 }),
            onSelect: onPlay,
          },
          {
            id: 'toggle-pin',
            label: isPinned ? '取消置顶歌单' : '置顶歌单',
            icon: tablerIcon('pin', { size: 20 }),
            onSelect: () => void togglePin(item),
          },
        ],
      })
    },
    [togglePin],
  )

  const createPlaylist = (name: string, activeFolderId: string | null) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(undefined)
    void ctx.library
      .createPlaylist(trimmed)
      .then(async (created) => {
        if (activeFolderId) {
          await ctx.library.addToCollection(activeFolderId, [created.urn]).catch(() => {})
        }
      })
      .catch(fail('could not create the playlist'))
  }

  const createCollection = (name: string, activeFolderId: string | null) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(undefined)
    void ctx.library
      .createCollection(trimmed, activeFolderId ? { parentId: activeFolderId } : undefined)
      .catch(fail('could not create the collection'))
  }

  return {
    pinnedExtraIds,
    setPinnedExtraIds,
    isItemPinned,
    togglePin,
    playPlaylist,
    playAlbum,
    playCollection,
    openPlaylistMenu,
    openCollectionMenu,
    openAlbumMenu,
    openBuiltinMenu,
    createPlaylist,
    createCollection,
    simpleMenu,
    setSimpleMenu,
    editingPlaylist,
    setEditingPlaylist,
    renamingCollection,
    setRenamingCollection,
    createInFolderModal,
    setCreateInFolderModal,
    confirmDeleteTarget,
    setConfirmDeleteTarget,
  }
}
