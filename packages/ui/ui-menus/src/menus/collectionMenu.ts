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
      title: 'Move to folder',
      searchPlaceholder: 'Find folder',
      createLabel: 'New folder',
      currentFolderId: opts.currentFolderId,
      onMoved: opts.onMoved,
    },
  )
  const items: MenuItemSpec[] = []

  // 1. Delete (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-album',
      label: 'Delete',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 2. Pin playlist / album
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? 'Unpin playlist' : 'Pin playlist',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  if (urns.length === 1) {
    const originalUrl = resolveOriginalResourceUrl({ urn: urns[0], kind: 'album' })
    if (originalUrl) {
      items.push({
        id: 'open-original-resource',
        label: 'Open original resource',
        icon: 'share-box',
        onSelect: () => openExternalUrl(originalUrl),
      })
    }
  }

  if (submenu) items.push({ id: 'add-to-collection', label: 'Move to folder', icon: 'folder', submenu })
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

  // 1. Rename (if provided)
  if (opts.onRename) {
    items.push({
      id: 'rename-collection',
      label: 'Rename',
      icon: 'pencil',
      onSelect: opts.onRename,
    })
  }

  // 2. Delete (if provided)
  if (opts.onDelete) {
    items.push({
      id: 'delete-collection',
      label: 'Delete',
      icon: 'delete',
      tone: 'danger',
      divider: true,
      onSelect: opts.onDelete,
    })
  }

  // 3. Pin folder
  if (opts.onTogglePin) {
    items.push({
      id: 'toggle-pin',
      label: opts.pinned ? 'Unpin folder' : 'Pin folder',
      icon: 'pin',
      onSelect: opts.onTogglePin,
    })
  }

  // 4. Create playlist
  if (opts.onCreatePlaylist) {
    items.push({
      id: 'create-playlist',
      label: 'Create playlist',
      icon: 'create-playlist',
      onSelect: opts.onCreatePlaylist,
    })
  }

  // 5. Create playlist folder
  if (opts.onCreateFolder) {
    items.push({
      id: 'create-folder',
      label: 'Create playlist folder',
      icon: 'create-folder',
      onSelect: opts.onCreateFolder,
    })
  }

  // 6. Move to folder
  if (opts.onMoveToFolder || (library && opts.collectionId)) {
    const availableFolders = collections.filter((c) => c.id !== opts.collectionId)
    const folderSubmenu = addToCollectionSubmenu(
      library,
      opts.collectionId ? [opts.collectionId] : [],
      availableFolders,
      {
        title: 'Move to folder',
        searchPlaceholder: 'Find folder',
        createLabel: 'New folder',
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
        label: 'Move to folder',
        icon: 'folder',
        submenu: folderSubmenu,
      })
    }
  }

  // 7. Play
  if (opts.onPlay || (player && trackUrns.length > 0)) {
    items.push({
      id: 'enqueue',
      label: 'Play',
      icon: 'play',
      onSelect: opts.onPlay ?? (() => player?.enqueueLast([...trackUrns])),
    })
  }

  // 8. Download
  if (downloads && trackUrns.length > 0) {
    items.push({
      id: 'download',
      label: 'Download',
      icon: 'download',
      onSelect: () => void downloads.enqueue([...trackUrns]),
    })
  }

  // 9. Add to another playlist
  const submenu = addToPlaylistSubmenu(library, trackUrns, playlists, {
    title: 'Add to another playlist',
  })
  if (submenu) {
    items.push({
      id: 'add-to-playlist',
      label: 'Add to another playlist',
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
