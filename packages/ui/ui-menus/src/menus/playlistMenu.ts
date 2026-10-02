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

  // 0. 批量操作 (if provided)
  if (opts.onToggleBatchMode) {
    if (opts.isBatchMode) {
      if (opts.onBatchPlay) {
        items.push({
          id: 'batch-play',
          label: '批量播放',
          icon: 'play',
          onSelect: opts.onBatchPlay,
        })
      }
      if (opts.onBatchAddToPlaylist) {
        items.push({
          id: 'batch-add-to-playlist',
          label: '添加到歌单',
          icon: 'plus',
          onSelect: opts.onBatchAddToPlaylist,
        })
      }
      if (opts.onBatchDelete) {
        items.push({
          id: 'batch-delete',
          label: '删除',
          icon: 'trash',
          tone: 'danger',
          onSelect: opts.onBatchDelete,
        })
      }
      items.push({
        id: 'batch-exit',
        label: '退出批量操作',
        icon: 'x',
        divider: true,
        onSelect: opts.onToggleBatchMode,
      })
    } else {
      items.push({
        id: 'batch-operations',
        label: '批量操作',
        icon: 'list-check',
        divider: true,
        onSelect: opts.onToggleBatchMode,
      })
    }
  }

  // 1. 编辑详情 (if provided)
  if (opts.onEdit) {
    items.push({
      id: 'edit-details',
      label: '编辑详情',
      icon: 'pencil',
      onSelect: opts.onEdit,
    })
  }

  // 2. 删除 (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-playlist',
      label: '删除',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. 置顶歌单
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. 添加到音乐库
  if (library && opts.isSaved !== true) {
    items.push({
      id: 'save-to-library',
      label: '添加到音乐库',
      icon: 'plus',
      onSelect: () => library.setSaved(playlist.urn, true),
    })
  }

  // 5. 播放 / 加入播放列表
  if (player && tracks.length > 0) {
    items.push({
      id: 'enqueue',
      label: '播放',
      icon: 'play',
      onSelect: () => player.enqueueLast([...tracks]),
    })
  }

  // 6. 下载
  if (downloads && tracks.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...tracks]),
    })
  }

  // 6.5. 分享歌单
  const share = serviceOf<ShareService>(ctx, 'share')
  if (share) {
    items.push({
      id: 'share-playlist',
      label: '分享歌单',
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

  // 7. 添加至其他歌单
  const submenu = addToPlaylistSubmenu(library, tracks, playlists, {
    title: '添加至其他歌单',
    excludePlaylistUrn: playlist.urn,
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: '添加至其他歌单',
      icon: 'plus',
      submenu,
    })
  }

  // 8. 移动至文件夹
  const collectionSubmenu = addToCollectionSubmenu(library, [playlist.urn], collections, {
    title: '移动至文件夹',
    searchPlaceholder: '查找文件夹',
    createLabel: '新建文件夹',
    currentFolderId: opts.currentFolderId,
    onMoved: opts.onMoved,
  })
  if (collectionSubmenu) {
    items.push({
      id: 'add-to-collection',
      label: '移动至文件夹',
      icon: 'folder',
      submenu: collectionSubmenu,
    })
  }

  const originalUrl = resolveOriginalResourceUrl({ urn: playlist.urn, kind: 'playlist' })
  if (originalUrl) {
    items.push({
      id: 'open-original-resource',
      label: '跳转原始资源',
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
