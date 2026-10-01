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
} from '@BBeBee/protocol'
import { addToPlaylistSubmenu } from '../submenus/playlistSubmenu.js'
import { addToCollectionSubmenu } from '../submenus/collectionSubmenu.js'
import { useMenuState, type MenuController } from '../types.js'
import { openExternalUrl, resolveOriginalResourceUrl } from '../utils/resourceUrls.js'

export interface AddToCollectionOptions {
  pinned?: boolean
  currentFolderId?: string
  onTogglePin?: () => void
  onMoved?: (targetFolderId?: string | null) => void
  onDelete?: () => void
}

/**
 * The one-item menu for an entity that is only a candidate for a folder:
 * an album (or anything else) whose useful action here is "put this in a
 * collection".
 */
export function addToCollectionOnlyItems(
  ctx: Context,
  urns: readonly string[],
  collections: readonly Collection[],
  opts: AddToCollectionOptions = {},
): MenuItemSpec[] {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const submenu = addToCollectionSubmenu(
    library,
    urns,
    opts.currentFolderId ? collections.filter((c) => c.id !== opts.currentFolderId) : collections,
    {
      title: '移动至文件夹',
      searchPlaceholder: '查找文件夹',
      createLabel: '新建文件夹',
      currentFolderId: opts.currentFolderId,
      onMoved: opts.onMoved,
    },
  )
  const items: MenuItemSpec[] = []

  // 1. 删除 (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-album',
      label: '删除',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 2. 置顶歌单 / 专辑
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶歌单' : '置顶歌单',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  if (urns.length === 1) {
    const originalUrl = resolveOriginalResourceUrl({ urn: urns[0], kind: 'album' })
    if (originalUrl) {
      items.push({
        id: 'open-original-resource',
        label: '跳转原始资源',
        icon: 'share-box',
        onSelect: () => openExternalUrl(originalUrl),
      })
    }
  }

  if (submenu) items.push({ id: 'add-to-collection', label: '移动至文件夹', icon: 'folder', submenu })
  return items
}

export interface AddToCollectionController extends MenuController {
  open(
    title: string,
    urns: readonly string[],
    anchor?: MenuAnchor,
    opts?: AddToCollectionOptions,
  ): void
}

/** A folder menu for an arbitrary entity — currently the album rows' menu. */
export function useAddToCollection(ctx: Context): AddToCollectionController {
  const state = useMenuState<
    { title: string; urns: readonly string[] },
    AddToCollectionOptions
  >()
  const open = useCallback(
    (
      title: string,
      urns: readonly string[],
      anchor?: MenuAnchor,
      opts?: AddToCollectionOptions,
    ) => state.show({ title, urns }, anchor, ctx, opts),
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
        ? addToCollectionOnlyItems(ctx, state.open.target.urns, state.collections, state.open.opts)
        : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}

export interface CollectionMenuOptions {
  collectionId?: string
  parentId?: string | null
  pinned?: boolean
  onTogglePin?: () => void
  onRename?: () => void
  onDelete?: () => void
  onCreatePlaylist?: () => void
  onCreateFolder?: () => void
  onMoveToFolder?: (targetFolderId: string | null) => void
  onPlay?: () => void
}

/**
 * Every action a collection row offers.
 */
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists?: readonly Playlist[],
  collections?: readonly Collection[],
  opts?: CollectionMenuOptions,
): MenuItemSpec[]
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists?: readonly Playlist[],
  opts?: CollectionMenuOptions,
): MenuItemSpec[]
export function collectionMenuItems(
  ctx: Context,
  trackUrns: readonly string[],
  playlists: readonly Playlist[] = [],
  collectionsOrOpts?: readonly Collection[] | CollectionMenuOptions,
  maybeOpts?: CollectionMenuOptions,
): MenuItemSpec[] {
  const isCollectionsArray = Array.isArray(collectionsOrOpts)
  const collections: readonly Collection[] = isCollectionsArray ? (collectionsOrOpts as readonly Collection[]) : []
  const opts: CollectionMenuOptions = isCollectionsArray
    ? (maybeOpts ?? {})
    : ((collectionsOrOpts as CollectionMenuOptions | undefined) ?? {})

  const library = serviceOf<LibraryService>(ctx, 'library')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const items: MenuItemSpec[] = []

  // 1. 重命名 (if provided)
  if (opts.onRename) {
    items.push({
      id: 'rename-collection',
      label: '重命名',
      icon: 'pencil',
      onSelect: opts.onRename,
    })
  }

  // 2. 删除 (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-collection',
      label: '删除',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. 置顶文件夹
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? '取消置顶文件夹' : '置顶文件夹',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. 创建歌单
  if (opts.onCreatePlaylist) {
    items.push({
      id: 'create-playlist',
      label: '创建歌单',
      icon: 'create-playlist',
      onSelect: opts.onCreatePlaylist,
    })
  }

  // 5. 创建歌单文件夹
  if (opts.onCreateFolder) {
    items.push({
      id: 'create-folder',
      label: '创建歌单文件夹',
      icon: 'create-folder',
      onSelect: opts.onCreateFolder,
    })
  }

  // 6. 移动至文件夹
  if (opts.onMoveToFolder || (library && opts.collectionId)) {
    const availableFolders = collections.filter((c) => c.id !== opts.collectionId)
    const folderSubmenu = addToCollectionSubmenu(
      library,
      opts.collectionId ? [opts.collectionId] : [],
      availableFolders,
      {
        title: '移动至文件夹',
        searchPlaceholder: '查找文件夹',
        createLabel: '新建文件夹',
        currentFolderId: opts.parentId ?? undefined,
        onSelectFolder: async (targetFolderId) => {
          if (opts.onMoveToFolder) {
            opts.onMoveToFolder(targetFolderId)
          } else if (library && opts.collectionId) {
            await library.moveCollection?.(opts.collectionId, targetFolderId)
          }
        },
      },
    )
    if (folderSubmenu) {
      items.push({
        id: 'move-to-folder',
        label: '移动至文件夹',
        icon: 'folder',
        submenu: folderSubmenu,
      })
    }
  }

  // 7. 播放
  if (opts.onPlay || (player && trackUrns.length > 0)) {
    items.push({
      id: 'enqueue',
      label: '播放',
      icon: 'play',
      onSelect: opts.onPlay ?? (() => player?.enqueueLast([...trackUrns])),
    })
  }

  // 8. 下载
  if (downloads && trackUrns.length > 0) {
    items.push({
      id: 'download',
      label: '下载',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...trackUrns]),
    })
  }

  // 9. 添加至其他歌单
  const submenu = addToPlaylistSubmenu(library, trackUrns, playlists, {
    title: '添加至其他歌单',
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: '添加至其他歌单',
      icon: 'plus',
      submenu,
    })
  }

  return items
}

export interface CollectionMenuController extends MenuController {
  open(
    title: string,
    trackUrns: readonly string[],
    anchor?: MenuAnchor,
    opts?: CollectionMenuOptions,
  ): void
}

/** A collection row's menu. `trackUrns` are its track members, resolved by the caller. */
export function useCollectionMenu(ctx: Context): CollectionMenuController {
  const state = useMenuState<{ title: string; trackUrns: readonly string[] }, CollectionMenuOptions>()
  const open = useCallback(
    (
      title: string,
      trackUrns: readonly string[],
      anchor?: MenuAnchor,
      opts?: CollectionMenuOptions,
    ) => state.show({ title, trackUrns }, anchor, ctx, opts),
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
        ? collectionMenuItems(ctx, state.open.target.trackUrns, state.playlists, state.collections, state.open.opts)
        : [],
      ...(state.open ? { title: state.open.target.title } : {}),
    },
  }
}
