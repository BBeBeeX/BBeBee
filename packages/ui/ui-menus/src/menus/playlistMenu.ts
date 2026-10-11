import { useCallback } from 'react'
import type { Context } from 'cordis'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  Collection,
  DownloadsService,
  LibraryService,
  PlayerService,
  Playlist,
  ShareService,
  ShareTrackData,
  Track,
} from '@BBeBee/protocol'
import { addToPlaylistSubmenu } from '../submenus/playlistSubmenu.js'
import { addToCollectionSubmenu } from '../submenus/collectionSubmenu.js'
import { useMenuState, type MenuController } from '../types.js'
import { openExternalUrl, resolveOriginalResourceUrl } from '../utils/resourceUrls.js'

export interface PlaylistMenuOptions {
  pinned?: boolean
  isSaved?: boolean
  currentFolderId?: string
  onTogglePin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onMoved?: (targetFolderId?: string | null) => void
  isBatchMode?: boolean
  onToggleBatchMode?: () => void
  onBatchPlay?: () => void
  onBatchAddToPlaylist?: () => void
  onBatchDelete?: () => void
}

/**
 * Every action a playlist row offers.
 */
export function playlistMenuItems(
  ctx: Context,
  playlist: { urn: string; name: string },
  tracks: readonly string[],
  playlists: readonly Playlist[] = [],
  collections: readonly Collection[] = [],
  opts: PlaylistMenuOptions = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  // 0. Batch operations (if provided)
  if (opts.onToggleBatchMode) {
    if (opts.isBatchMode) {
      if (opts.onBatchPlay) {
        items.push({
          id: 'batch-play',
          label: 'Play selected',
          icon: 'play',
          onSelect: opts.onBatchPlay,
        })
      }
      if (opts.onBatchAddToPlaylist) {
        items.push({
          id: 'batch-add-to-playlist',
          label: 'Add to playlist',
          icon: 'plus',
          onSelect: opts.onBatchAddToPlaylist,
        })
      }
      if (opts.onBatchDelete) {
        items.push({
          id: 'batch-delete',
          label: 'Delete',
          icon: 'trash',
          tone: 'danger',
          onSelect: opts.onBatchDelete,
        })
      }
      items.push({
        id: 'batch-exit',
        label: 'Exit batch operations',
        icon: 'x',
        divider: true,
        onSelect: opts.onToggleBatchMode,
      })
    } else {
      items.push({
        id: 'batch-operations',
        label: 'Batch operations',
        icon: 'list-check',
        divider: true,
        onSelect: opts.onToggleBatchMode,
      })
    }
  }

  // 1. Edit details (if provided)
  if (opts.onEdit) {
    items.push({
      id: 'edit-details',
      label: 'Edit details',
      icon: 'pencil',
      onSelect: opts.onEdit,
    })
  }

  // 2. Delete (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-playlist',
      label: 'Delete',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. Pin playlist
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? 'Unpin playlist' : 'Pin playlist',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. Add to music library
  if (library && opts.isSaved !== true) {
    items.push({
      id: 'save-to-library',
      label: 'Add to music library',
      icon: 'plus',
      onSelect: () => library.setSaved(playlist.urn, true),
    })
  }

  // 5. Play / Add to play queue
  if (player && tracks.length > 0) {
    items.push({
      id: 'enqueue',
      label: 'Play',
      icon: 'play',
      onSelect: () => player.enqueueLast([...tracks]),
    })
  }

  // 6. Download
  if (downloads && tracks.length > 0) {
    items.push({
      id: 'download',
      label: 'Download',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...tracks]),
    })
  }

  // 6.5. Share playlist
  const share = serviceOf<ShareService>(ctx, 'share')
  if (share) {
    items.push({
      id: 'share-playlist',
      label: 'Share playlist',
      icon: 'share',
      onSelect: async () => {
        let resolvedTracks: (Track | ShareTrackData)[] | undefined
        if (library) {
          try {
            const detail = await library.getPlaylist(playlist.urn)
            if (detail?.tracks && detail.tracks.length > 0) {
              resolvedTracks = detail.tracks
            }
          } catch {
            // fallback
          }
        }
        if (!resolvedTracks && tracks.length > 0) {
          resolvedTracks = tracks.map((urn) => ({
            urn,
            title: urn,
            artist: 'Unknown Artist',
          }))
        }
        share.sharePlaylist(playlist, resolvedTracks)
      },
    })
  }

  // 7. Add to another playlist
  const submenu = addToPlaylistSubmenu(library, tracks, playlists, {
    title: 'Add to another playlist',
    excludePlaylistUrn: playlist.urn,
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: 'Add to another playlist',
      icon: 'plus',
      submenu,
    })
  }

  // 8. Move to folder
  const collectionSubmenu = addToCollectionSubmenu(library, [playlist.urn], collections, {
    title: 'Move to folder',
    searchPlaceholder: 'Find folder',
    createLabel: 'New folder',
    currentFolderId: opts.currentFolderId,
    onMoved: opts.onMoved,
  })
  if (collectionSubmenu) {
    items.push({
      id: 'add-to-collection',
      label: 'Move to folder',
      icon: 'folder',
      submenu: collectionSubmenu,
    })
  }

  const originalUrl = resolveOriginalResourceUrl({ urn: playlist.urn, kind: 'playlist' })
  if (originalUrl) {
    items.push({
      id: 'open-original-resource',
      label: 'Open original resource',
      icon: 'share-box',
      onSelect: () => openExternalUrl(originalUrl),
    })
  }

  return items
}

export interface PlaylistMenuController extends MenuController {
  open(
    playlist: { urn: string; name: string },
    tracks: readonly string[],
    anchor?: MenuAnchor,
    opts?: PlaylistMenuOptions,
  ): void
}

/** A playlist row's menu. `tracks` are its resolved track URNs, when the caller has them. */
export function usePlaylistMenu(ctx: Context): PlaylistMenuController {
  const state = useMenuState<{ playlist: { urn: string; name: string }; tracks: readonly string[] }, PlaylistMenuOptions>()
  const open = useCallback(
    (
      playlist: { urn: string; name: string },
      tracks: readonly string[],
      anchor?: MenuAnchor,
      opts?: PlaylistMenuOptions,
    ) => state.show({ playlist, tracks }, anchor, ctx, opts),
    [state, ctx],
  )
  return {
    open,
    menuProps: {
      open: state.open !== undefined,
      onClose: state.close,
      x: state.open?.anchor.x ?? 0,
      y: state.open?.anchor.y ?? 0,
      items: state.open
        ? playlistMenuItems(
            ctx,
            state.open.target.playlist,
            state.open.target.tracks,
            state.playlists,
            state.collections,
            state.open.opts,
          )
        : [],
      ...(state.open ? { title: state.open.target.playlist.name } : {}),
    },
  }
}
