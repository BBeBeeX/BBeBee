import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  DownloadsService,
  PlayerService,
  ShareService,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import {
  useCollections,
  useLibraryProfile,
  usePlaylists,
  useSaved,
} from '@bbebee/plugin-library/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { ContextMenu, EmptyState, List, Text, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu } from '@BBeBee/ui-menus'
import { UnifiedLibraryRow, type UnifiedItem } from '../components/UnifiedLibraryRow.js'
import { LibraryCreateButton, LibraryCreateMenu } from '../components/LibraryCreateDropdown.js'
import {
  LibraryToolbar,
  type LibraryFilterKey,
  type LibrarySortMode,
} from '../components/LibraryToolbar.js'
import { LibraryModals } from '../components/LibraryModals.js'
import { CollapsedLibraryView } from '../components/views/CollapsedLibraryView.js'
import { ExpandedLibraryView } from '../components/views/ExpandedLibraryView.js'
import { SidebarFolderView } from '../components/views/SidebarFolderView.js'
import { useLibraryHydration } from '../hooks/useLibraryHydration.js'
import { useLibraryActions } from '../hooks/useLibraryActions.js'

export interface LibraryScreenProps {
  ctx: Context
  mode?: 'collapsed' | 'sidebar' | 'expanded'
  onModeChange?: (mode: 'collapsed' | 'sidebar' | 'expanded') => void
  onOpenAlbum?: (urn: string) => void
  /**
   * The route the shell is actually showing right now — not the last
   * `ui/navigate` event. Shell-internal navigation (opening an album,
   * back/forward, home, settings) never emits that event, so the quick
   * entries (Favorites / Local & downloads) may only highlight from this prop.
   */
  activeViewId?: string
  folderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  [key: string]: unknown
}

export function LibraryScreen({
  ctx,
  mode: propMode,
  onModeChange,
  onOpenAlbum,
  activeViewId,
  folderId: propFolderId,
  onFolderChange,
}: LibraryScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const [localMode, setLocalMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')
  const currentMode = propMode ?? localMode

  const handleModeChange = useCallback(
    (nextMode: 'collapsed' | 'sidebar' | 'expanded') => {
      setLocalMode(nextMode)
      onModeChange?.(nextMode)
    },
    [onModeChange],
  )

  const [isHeaderHovered, setIsHeaderHovered] = useState(false)
  const [localFolderId, setLocalFolderId] = useState<string | null>(propFolderId ?? null)
  useEffect(() => {
    if (propFolderId !== undefined) {
      setLocalFolderId(propFolderId)
    }
  }, [propFolderId])
  const activeFolderId = localFolderId
  const setActiveFolderId = useCallback(
    (id: string | null) => {
      setLocalFolderId(id)
      onFolderChange?.(id)
    },
    [onFolderChange],
  )
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const [folderItemsMap, setFolderItemsMap] = useState<Map<string, UnifiedItem[]>>(new Map())
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [collapsedMenuPos, setCollapsedMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false)
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isCreateMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-testid="create-dropdown-trigger"]')) {
        return
      }
      if (createMenuRef.current && !createMenuRef.current.contains(target as Node)) {
        setIsCreateMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isCreateMenuOpen])

  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedArtistEntries = useSaved(ctx, 'artist')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)

  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')

  const [activeFilter, setActiveFilter] = useState<LibraryFilterKey>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<LibrarySortMode>('creator')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | undefined>(undefined)

  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = useCallback(
    (what: string) => (cause: unknown) => {
      setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)
    },
    [],
  )

  useEffect(() => {
    // Coalesce rapid bursts (a scan emits `library/changed` per batch):
    // without this, every batch triggers a full library hydration.
    let timer: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        setGeneration((n) => n + 1)
      }, 750)
    }
    const offChanged = ctx.on('library/changed', () => bump())
    const offCollections = ctx.on('library/collections-changed', () => bump())
    return () => {
      if (timer) clearTimeout(timer)
      offChanged()
      offCollections()
    }
  }, [ctx])

  const {
    historyMap,
    localTracks,
    albumsMap,
    playlistFirstTrackArtworks,
    collectionFirstArtworks,
    containedPlaylistUrns,
    setContainedPlaylistUrns,
  } = useLibraryHydration({
    ctx,
    generation,
    savedAlbumEntries: savedAlbumEntries.data,
    savedTrackEntries: savedTrackEntries.data,
    playlists: playlists.data,
    collections: collections.data,
  })

  const pinnedUrns = useMemo(() => {
    return new Set(allSaved.data?.filter((e) => e.pinned).map((e) => e.urn) ?? [])
  }, [allSaved.data])

  const {
    isItemPinned,
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
  } = useLibraryActions({
    ctx,
    pinnedUrns,
    collections: collections.data ?? [],
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
  })

  const favoriteUrns = useMemo(() => savedTrackEntries.data?.map((e) => e.urn) ?? [], [savedTrackEntries.data])

  // The local user is the creator: used by both the playlist row's creator and the "Playlist • X" subtitle.
  const profile = useLibraryProfile(ctx)
  const creatorName = profile?.name ?? t('library:userProfile.mine')

  // Favorites and Local music are no longer two cards in the list below: they render as
  // two quick entries under the music library title and above the filter toolbar (see renderQuickItem).

  const playlistItems: UnifiedItem[] = useMemo(() => {
    return (playlists.data ?? [])
      .filter((playlist) => !containedPlaylistUrns.has(playlist.urn))
      .map((playlist) => {
        const isPinned = isItemPinned({ id: playlist.urn, urn: playlist.urn })
        const addedAt =
          playlist.createdAt ??
          playlist.updatedAt ??
          allSaved.data?.find((e) => e.urn === playlist.urn)?.addedAt ??
          Date.now()
        return {
          id: playlist.urn,
          urn: playlist.urn,
          kind: 'playlist',
          title: playlist.name,
          subtitle: playlist.isSmart
            ? t('library:library.smartPlaylist')
            : t('library:library.playlistByOwner', { owner: playlist.owner ?? creatorName }),
          creator: playlist.owner ?? creatorName,
          artwork: playlist.artwork ?? playlistFirstTrackArtworks.get(playlist.urn),
          artworkSeed: playlist.urn,
          pinned: isPinned,
          addedAt,
          lastPlayedAt: 0,
          onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
          onPlay: () => playPlaylist(playlist.urn, playlist.name),
          onDelete: () =>
            void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
          onMore: (anchor) => openPlaylistMenu(playlist, anchor, isPinned),
        }
      })
  }, [allSaved.data, containedPlaylistUrns, ctx, creatorName, fail, isItemPinned, openPlaylistMenu, playPlaylist, playlistFirstTrackArtworks, playlists.data, t])

  const albumItems: UnifiedItem[] = useMemo(() => {
    return (savedAlbumEntries.data ?? []).map((entry) => {
      const detail = albumsMap.get(entry.urn)
      const title = detail?.title ?? entry.urn
      const artists = detail?.artists?.map((a) => a.name).join(', ') ?? t('library:localAlbum.albumFallback')
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
      const lastPlayedAt = trackUrns.length > 0 ? Math.max(0, ...trackUrns.map((u) => historyMap.get(u) ?? 0)) : 0
      const isDownloaded =
        trackUrns.length > 0 &&
        trackUrns.every((u) => downloads?.tasks.some((t) => t.trackUrn === u && t.state === 'done'))
      return {
        id: entry.urn,
        urn: entry.urn,
        kind: 'album' as const,
        title,
        subtitle: t('library:library.album', { artists }),
        creator: artists,
        artwork: detail?.artwork,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt,
        isDownloaded,
        onOpen: () => {
          if (onOpenAlbum) onOpenAlbum(entry.urn)
          // 'album.view' is plugin-album's view descriptor id — serialized data, a literal, not an import.
          else ctx.ui.navigate('album.view', { urn: entry.urn })
        },
        onPlay: () => playAlbum(entry.urn, title),
        onDelete: () => void ctx.library.setSaved(entry.urn, false).catch(fail('could not remove the album')),
        onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
      }
    })
  }, [albumsMap, ctx, downloads?.tasks, fail, historyMap, isItemPinned, onOpenAlbum, openAlbumMenu, playAlbum, savedAlbumEntries.data, t])

  const collectionItems: UnifiedItem[] = useMemo(() => {
    return (collections.data ?? []).map((collection) => {
      const isPinned = isItemPinned({ id: collection.id })
      return {
        id: collection.id,
        kind: 'collection',
        title: collection.name,
        subtitle:
          (collection.itemCount ?? 0) === 1
            ? t('library:library.folderItemsOne', { count: collection.itemCount ?? 0 })
            : t('library:library.folderItemsOther', { count: collection.itemCount ?? 0 }),
        creator: creatorName,
        artwork: collectionFirstArtworks.get(collection.id),
        artworkSeed: collection.id,
        pinned: isPinned,
        addedAt: collection.createdAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => setActiveFolderId(collection.id),
        onPlay: () => playCollection(collection.id),
        onDelete: () =>
          void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
        onMore: (anchor) => openCollectionMenu(collection, anchor, isPinned),
      }
    })
  }, [collectionFirstArtworks, collections.data, ctx, creatorName, fail, isItemPinned, openCollectionMenu, playCollection, setActiveFolderId])

  const artistItems: UnifiedItem[] = useMemo(() => {
    return (savedArtistEntries.data ?? []).map((entry) => {
      const name = entry.urn.replace(/^artist:/, '')
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      return {
        id: entry.urn,
        urn: entry.urn,
        kind: 'artist' as const,
        title: name,
        subtitle: t('library:favorites.artist'),
        creator: name,
        artwork: undefined,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => ctx.ui.navigate('sources.search', { query: name }),
        onPlay: () => {},
        onMore: (anchor) => openBuiltinMenu(name, () => {}, isPinned, { id: entry.urn }, anchor),
      }
    })
  }, [ctx, isItemPinned, openBuiltinMenu, savedArtistEntries.data, t])

  const allItems = useMemo(() => {
    return [...playlistItems, ...albumItems, ...collectionItems, ...artistItems]
  }, [playlistItems, albumItems, collectionItems, artistItems])

  const filteredItems = useMemo(() => {
    let result = allItems
    if (activeFilter === 'playlist') {
      result = result.filter((item) => item.kind === 'playlist' || item.kind === 'favorite')
    } else if (activeFilter === 'album') {
      result = result.filter((item) => item.kind === 'album')
    } else if (activeFilter === 'artist') {
      result = result.filter((item) => item.kind === 'artist')
    } else if (activeFilter === 'downloaded') {
      result = result.filter((item) => item.kind === 'local' || item.isDownloaded)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
      )
    }

    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortMode === 'alphabetical') {
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      }
      if (sortMode === 'recent-played') {
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      }
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [allItems, activeFilter, searchQuery, sortMode])

  const loadCollectionUnifiedItems = useCallback(
    async (collectionId: string): Promise<UnifiedItem[]> => {
      try {
        const page = await ctx.library.listCollectionItems(collectionId)
        const entries = page.items ?? []
        const results: UnifiedItem[] = []

        for (const entry of entries) {
          const parsed = tryParseUrn(entry.urn)
          const kind = parsed?.kind

          const matchedPlaylist = (playlists.data ?? []).find((p) => p.urn === entry.urn)
          if (matchedPlaylist) {
            const isPinned = isItemPinned({ id: matchedPlaylist.urn, urn: matchedPlaylist.urn })
            results.push({
              id: matchedPlaylist.urn,
              urn: matchedPlaylist.urn,
              kind: 'playlist',
              title: matchedPlaylist.name,
              subtitle: matchedPlaylist.isSmart ? t('library:library.smartPlaylist') : t('library:library.playlistByOwner', { owner: matchedPlaylist.owner ?? creatorName }),
              creator: matchedPlaylist.owner ?? creatorName,
              artwork: matchedPlaylist.artwork ?? playlistFirstTrackArtworks.get(matchedPlaylist.urn),
              artworkSeed: matchedPlaylist.urn,
              pinned: isPinned,
              addedAt: matchedPlaylist.createdAt ?? Date.now(),
              lastPlayedAt: 0,
              onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: matchedPlaylist.urn }),
              onPlay: () => playPlaylist(matchedPlaylist.urn, matchedPlaylist.name),
              onDelete: () =>
                void ctx.library.deletePlaylist(matchedPlaylist.urn).catch(fail('could not delete the playlist')),
              onMore: (anchor) => openPlaylistMenu(matchedPlaylist, anchor, isPinned, collectionId),
            })
            continue
          }

          const matchedAlbum = albumItems.find((a) => a.urn === entry.urn || a.id === entry.urn)
          if (matchedAlbum) {
            results.push({
              ...matchedAlbum,
              onDelete: () =>
                void ctx.library
                  .removeFromCollection(collectionId, [entry.urn])
                  .catch(fail('could not remove album from folder')),
              onMore: (anchor) =>
                openAlbumMenu({ urn: entry.urn, title: matchedAlbum.title }, anchor, matchedAlbum.pinned, collectionId),
            })
            continue
          }

          if (kind === 'track') {
            const local = localTracks.find((t) => t.urn === entry.urn)
            let trackObj = local
            if (!trackObj && ctx.sources?.getTracks) {
              const fetched = await ctx.sources.getTracks([entry.urn]).catch(() => [])
              trackObj = fetched[0]
            }
            if (trackObj) {
              results.push({
                id: entry.urn,
                urn: entry.urn,
                kind: 'playlist',
                title: trackObj.title,
                subtitle: trackObj.artists?.map((a) => a.name).join(', ') ?? t('library:library.single'),
                creator: trackObj.artists?.map((a) => a.name).join(', ') ?? t('library:library.unknownArtist'),
                artwork: trackObj.artwork,
                artworkSeed: entry.urn,
                pinned: false,
                addedAt: trackObj.fetchedAt ?? Date.now(),
                lastPlayedAt: historyMap.get(entry.urn) ?? 0,
                onOpen: () => {
                  void player?.playNow([entry.urn])
                },
                onPlay: () => {
                  void player?.playNow([entry.urn])
                },
                onMore: (anchor) =>
                  openBuiltinMenu(
                    trackObj!.title,
                    () => void player?.playNow([entry.urn]),
                    false,
                    { id: entry.urn },
                    anchor,
                  ),
              })
              continue
            }
          }

          if (kind === 'playlist') {
            try {
              const detail = await ctx.library.getPlaylist(entry.urn)
              if (detail) {
                const isPinned = isItemPinned({ id: detail.urn, urn: detail.urn })
                results.push({
                  id: detail.urn,
                  urn: detail.urn,
                  kind: 'playlist',
                  title: detail.name,
                  subtitle: detail.isSmart ? t('library:library.smartPlaylist') : t('library:library.playlistByOwner', { owner: detail.owner ?? creatorName }),
                  creator: detail.owner ?? creatorName,
                  artwork: detail.artwork ?? playlistFirstTrackArtworks.get(detail.urn),
                  artworkSeed: detail.urn,
                  pinned: isPinned,
                  addedAt: detail.createdAt ?? Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: detail.urn }),
                  onPlay: () => playPlaylist(detail.urn, detail.name),
                  onMore: (anchor) =>
                    openPlaylistMenu(
                      {
                        urn: detail.urn,
                        name: detail.name,
                        isSmart: detail.isSmart,
                        createdAt: detail.createdAt,
                        updatedAt: detail.updatedAt,
                      },
                      anchor,
                      isPinned,
                      collectionId,
                    ),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          if (kind === 'album') {
            try {
              const album = await ctx.sources?.getAlbum(entry.urn)
              if (album) {
                const title = album.title ?? entry.urn
                const artists = album.artists?.map((a) => a.name).join(', ') ?? t('library:localAlbum.albumFallback')
                const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
                results.push({
                  id: entry.urn,
                  urn: entry.urn,
                  kind: 'album',
                  title,
                  subtitle: t('library:library.album', { artists }),
                  creator: artists,
                  artwork: album.artwork,
                  artworkSeed: entry.urn,
                  pinned: isPinned,
                  addedAt: Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => {
                    if (onOpenAlbum) onOpenAlbum(entry.urn)
                    else ctx.ui.navigate('album.view', { urn: entry.urn })
                  },
                  onPlay: () => playAlbum(entry.urn, title),
                  onDelete: () =>
                    void ctx.library
                      .removeFromCollection(collectionId, [entry.urn])
                      .catch(fail('could not remove album from folder')),
                  onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned, collectionId),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          results.push({
            id: entry.urn,
            urn: entry.urn,
            kind: 'playlist',
            title: entry.urn,
            subtitle: t('library:library.items'),
            creator: '',
            artwork: undefined,
            artworkSeed: entry.urn,
            pinned: false,
            addedAt: Date.now(),
            lastPlayedAt: 0,
            onOpen: () => {},
            onPlay: () => {},
            onMore: () => {},
          })
        }
        return results
      } catch {
        return []
      }
    },
    [
      albumItems,
      ctx,
      creatorName,
      fail,
      historyMap,
      isItemPinned,
      localTracks,
      onOpenAlbum,
      openAlbumMenu,
      openBuiltinMenu,
      openPlaylistMenu,
      playAlbum,
      player,
      playPlaylist,
      playlistFirstTrackArtworks,
      playlists.data,
      t,
    ],
  )

  const loadCollectionUnifiedItemsRef = useRef(loadCollectionUnifiedItems)
  useEffect(() => {
    loadCollectionUnifiedItemsRef.current = loadCollectionUnifiedItems
  })

  useEffect(() => {
    const idsToLoad = new Set<string>(expandedFolderIds)
    if (activeFolderId) idsToLoad.add(activeFolderId)
    if (idsToLoad.size === 0) return

    let cancelled = false
    Promise.all(
      Array.from(idsToLoad).map(async (id) => {
        const items = await loadCollectionUnifiedItemsRef.current(id)
        return { id, items }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setFolderItemsMap((prev) => {
          let hasDiff = false
          for (const res of results) {
            const existing = prev.get(res.id)
            if (
              !existing ||
              existing.length !== res.items.length ||
              existing.some((it, idx) => it.id !== res.items[idx]?.id)
            ) {
              hasDiff = true
              break
            }
          }
          if (!hasDiff && prev.size === results.length) return prev
          const next = new Map(prev)
          for (const res of results) {
            next.set(res.id, res.items)
          }
          return next
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [expandedFolderIds, activeFolderId, generation, t])

  const activeCollection = useMemo(() => {
    if (!activeFolderId) return undefined
    return (collections.data ?? []).find((c) => c.id === activeFolderId)
  }, [collections.data, activeFolderId])

  const activeFolderItems = useMemo(() => {
    if (!activeFolderId) return []
    return folderItemsMap.get(activeFolderId) ?? []
  }, [activeFolderId, folderItemsMap])

  const filteredFolderItems = useMemo(() => {
    let result = activeFolderItems
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
      )
    }
    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortMode === 'alphabetical') {
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      }
      if (sortMode === 'recent-played') {
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      }
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [activeFolderItems, searchQuery, sortMode])

  const displayItems = useMemo(() => {
    const list: (UnifiedItem & {
      isFolder?: boolean
      isExpanded?: boolean
      onToggleExpand?: () => void
      isChild?: boolean
    })[] = []
    for (const item of filteredItems) {
      const isFolder = item.kind === 'collection'
      const isExpanded = isFolder && expandedFolderIds.has(item.id)
      list.push({
        ...item,
        isFolder,
        isExpanded,
        onToggleExpand: isFolder ? () => toggleFolderExpanded(item.id) : undefined,
      })
      if (isExpanded) {
        const children = folderItemsMap.get(item.id) ?? []
        for (const child of children) {
          list.push({
            ...child,
            isChild: true,
          })
        }
      }
    }
    return list
  }, [filteredItems, expandedFolderIds, folderItemsMap, toggleFolderExpanded])

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'creator',
      label: t('library:library.creator'),
      icon: sortMode === 'creator' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('creator'),
    },
    {
      id: 'recent-added',
      label: t('library:library.recentlyAdded'),
      icon: sortMode === 'recent-added' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('recent-added'),
    },
    {
      id: 'recent-played',
      label: t('library:library.recentlyPlayed'),
      icon: sortMode === 'recent-played' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('recent-played'),
    },
    {
      id: 'alphabetical',
      label: t('library:library.alphabetical'),
      icon: sortMode === 'alphabetical' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('alphabetical'),
    },
  ]

  const renderCreateButton = () => {
    return h(LibraryCreateButton, {
      ctx,
      isCreateMenuOpen,
      onClick: () => setIsCreateMenuOpen((prev) => !prev),
    })
  }

  // The create trigger as an icon-only plus, living at the far right of the
  // filter row (moved out of the header).
  const renderToolbarCreate = () => {
    return h(
      'div',
      { style: { position: 'relative', display: 'flex', alignItems: 'center' } },
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'create-dropdown-trigger',
          'aria-label': t('library:libraryCreateDropdown.create'),
          title: t('library:libraryCreateDropdown.create'),
          onClick: () => setIsCreateMenuOpen((prev) => !prev),
          style: {
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: isCreateMenuOpen ? 'var(--text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #A0A0AE)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            if (!isCreateMenuOpen) e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
          },
        },
        h(
          'span',
          {
            style: {
              transform: isCreateMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
              display: 'inline-flex',
              lineHeight: 1,
            },
          },
          tablerIcon('plus', { size: 20 }),
        ),
      ),
      renderCreateMenu(false),
    )
  }

  // Minimal sidebar quick entries: flat rows of icon + text + count, the selected one
  // highlighted with a rounded light grey. Colours go through light-dark(), switching
  // between light (black icon / dark grey text / light grey background) and dark with the colour mode.
  const renderQuickItem = (
    icon: 'heart' | 'download',
    label: string,
    count: number,
    viewId: string,
  ) => {
    const selected = activeViewId === viewId
    return h(
      'button',
      {
        key: viewId,
        type: 'button',
        'aria-current': selected ? 'page' : undefined,
        onClick: () => ctx.ui.navigate(viewId),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderRadius: 10,
          border: 'none',
          background: selected ? 'light-dark(#E9E9EC, rgba(255, 255, 255, 0.09))' : 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (!selected) {
            e.currentTarget.style.backgroundColor = 'light-dark(#F2F2F4, rgba(255, 255, 255, 0.05))'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = selected
            ? 'light-dark(#E9E9EC, rgba(255, 255, 255, 0.09))'
            : 'transparent'
        },
      },
      tablerIcon(icon, { size: 20, color: 'light-dark(#17171C, #F2F3F7)' }),
      h(
        'span',
        {
          style: {
            fontSize: 13,
            fontWeight: 500,
            color: 'light-dark(#494950, #A9AEB9)',
            whiteSpace: 'nowrap',
          },
        },
        label,
        h(
          'span',
          {
            style: {
              fontWeight: 400,
              fontVariantNumeric: 'tabular-nums',
              color: 'light-dark(#8E8E96, #6E7380)',
            },
          },
          `·${count}`,
        ),
      ),
    )
  }

  const renderCreateMenu = (isCollapsed: boolean) => {
    return h(LibraryCreateMenu, {
      ctx,
      isCreateMenuOpen,
      setIsCreateMenuOpen,
      createMenuRef,
      isCollapsed,
      collapsedMenuPos,
      onOpenCreatePlaylist: () => {
        setIsCreateMenuOpen(false)
        setShowCreatePlaylistModal(true)
      },
      onOpenCreateCollection: () => {
        setIsCreateMenuOpen(false)
        setShowCreateCollectionModal(true)
      },
      onOpenImportShare: () => {
        setIsCreateMenuOpen(false)
        const share = serviceOf<ShareService>(ctx, 'share')
        if (share) {
          share.openImport()
        } else {
          ctx.emit?.('share/import')
        }
      },
    })
  }

  const renderModals = () => {
    return h(LibraryModals, {
      ctx,
      showCreatePlaylistModal,
      setShowCreatePlaylistModal,
      draft,
      setDraft,
      onCreatePlaylist: () => {
        createPlaylist(draft, activeFolderId)
        setDraft('')
      },
      showCreateCollectionModal,
      setShowCreateCollectionModal,
      collectionDraft,
      setCollectionDraft,
      onCreateCollection: () => {
        createCollection(collectionDraft, activeFolderId)
        setCollectionDraft('')
      },
      editingPlaylist,
      setEditingPlaylist,
      onUpdatePlaylist: async (patch) => {
        if (!editingPlaylist) return
        await ctx.library.updatePlaylist(editingPlaylist.urn, patch)
        setGeneration((n) => n + 1)
      },
      renamingCollection,
      setRenamingCollection,
      onRenameCollection: async (id, newName) => {
        await ctx.library.renameCollection(id, newName)
        setGeneration((n) => n + 1)
      },
      createInFolderModal,
      setCreateInFolderModal,
      onCreateInFolder: async (name) => {
        if (!createInFolderModal) return
        if (createInFolderModal.type === 'playlist') {
          const created = await ctx.library.createPlaylist(name)
          await ctx.library.addToCollection(createInFolderModal.folderId, [created.urn])
        } else {
          await ctx.library.createCollection(name, { parentId: createInFolderModal.folderId })
        }
        setGeneration((n) => n + 1)
      },
      confirmDeleteTarget,
      setConfirmDeleteTarget,
      onConfirmDelete: async () => {
        if (!confirmDeleteTarget) return
        const target = confirmDeleteTarget
        setConfirmDeleteTarget(null)
        try {
          if (target.type === 'playlist') {
            await ctx.library.deletePlaylist(target.urn)
          } else if (target.type === 'album') {
            await ctx.library.setSaved(target.urn, false)
            if (target.folderId) {
              await ctx.library.removeFromCollection(target.folderId, [target.urn])
            }
          }
          if (target.folderId) {
            setFolderItemsMap((prev) => {
              const existing = prev.get(target.folderId!)
              if (!existing) return prev
              const next = new Map(prev)
              next.set(
                target.folderId!,
                existing.filter((item) => item.urn !== target.urn && item.id !== target.urn),
              )
              return next
            })
          }
          setGeneration((n) => n + 1)
        } catch (e) {
          fail(target.type === 'playlist' ? 'could not delete the playlist' : 'could not remove the album')(e)
        }
      },
    })
  }

  const renderContextMenus = () => {
    return h(
      'div',
      null,
      h(ContextMenu, playlistMenu.menuProps),
      h(ContextMenu, collectionMenu.menuProps),
      h(ContextMenu, albumMenu.menuProps),
      h(ContextMenu, {
        open: simpleMenu !== undefined,
        onClose: () => setSimpleMenu(undefined),
        x: simpleMenu?.anchor.x ?? 0,
        y: simpleMenu?.anchor.y ?? 0,
        items: simpleMenu?.items ?? [],
        ...(simpleMenu ? { title: simpleMenu.title } : {}),
      }),
      h(ContextMenu, {
        open: sortMenuAnchor !== undefined,
        onClose: () => setSortMenuAnchor(undefined),
        x: sortMenuAnchor?.x ?? 0,
        y: sortMenuAnchor?.y ?? 0,
        items: sortMenuItems,
        title: t('library:favorites.sortBy'),
      }),
    )
  }

  if (currentMode === 'collapsed') {
    return h(CollapsedLibraryView, {
      ctx,
      activeFolderId,
      setActiveFolderId,
      handleModeChange,
      isCreateMenuOpen,
      setIsCreateMenuOpen,
      setCollapsedMenuPos,
      renderCreateMenu,
      items: activeFolderId !== null ? filteredFolderItems : filteredItems,
      favoriteCount: favoriteUrns.length,
      localCount: localTracks.length,
      activeViewId,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  if (currentMode === 'expanded') {
    return h(ExpandedLibraryView, {
      ctx,
      activeFolderId,
      activeCollection,
      setActiveFolderId,
      handleModeChange,
      renderCreateButton,
      renderCreateMenu,
      openCollectionMenu,
      isItemPinned,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
      activeFilter,
      setActiveFilter,
      hasArtists: artistItems.length > 0,
      filteredItems,
      filteredFolderItems,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  if (activeFolderId !== null) {
    return h(SidebarFolderView, {
      ctx,
      activeCollection,
      setActiveFolderId,
      handleModeChange,
      renderCreateButton,
      renderCreateMenu,
      openCollectionMenu,
      isItemPinned,
      searchOpen,
      setSearchOpen,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
      filteredFolderItems,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  return h(
    'section',
    {
      'aria-label': t('library:library.library'),
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: '12px 16px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'header',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: () => setIsHeaderHovered(true),
          onMouseLeave: () => setIsHeaderHovered(false),
          onClick: () => handleModeChange('collapsed'),
          title: t('library:expandedLibrary.collapseMusicLibrary'),
        },
        isHeaderHovered
          ? tablerIcon('layout-sidebar-left-collapse', { size: 26, color: 'var(--bb-text-primary, currentColor)' })
          : tablerIcon('books', { size: 26, color: 'var(--bb-text-secondary, #A0A0AE)' }),
        h(
          'span',
          {
            style: {
              fontSize: 16,
              fontWeight: 700,
              color: isHeaderHovered ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #F5F5F7)',
              transition: 'color 0.15s ease',
            },
          },
          t('library:expandedLibrary.musicLibrary'),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, position: 'relative' } },
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('library:collapsedLibrary.expandMusicLibrary'),
            title: t('library:collapsedLibrary.expandMusicLibrary'),
            onClick: () => handleModeChange('expanded'),
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: 'var(--bb-text-secondary, #A0A0AE)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
            },
          },
          tablerIcon('maximize', { size: 20 }),
        ),
      ),
    ),
    h(
      'nav',
      {
        'aria-label': t('library:collapsedLibrary.musicLibraryQuickLinks'),
        style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 },
      },
      renderQuickItem('heart', t('library:unifiedLibrary.favorites'), favoriteUrns.length, LIBRARY_VIEWS.favorites),
      renderQuickItem('download', t('library:library.localAndDownloads'), localTracks.length, LIBRARY_VIEWS.local),
    ),
    h(LibraryToolbar, {
      ctx,
      activeFilter,
      setActiveFilter,
      searchOpen,
      setSearchOpen,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
      hasArtists: artistItems.length > 0,
      createSlot: renderToolbarCreate(),
    }),
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
      filteredItems.length === 0
        ? h(EmptyState, {
            icon: 'music',
            title: t('library:library.nothingFound'),
            description: t('library:library.importAMusicSourceScan'),
          })
        : h(
            List<
              UnifiedItem & {
                isFolder?: boolean
                isExpanded?: boolean
                onToggleExpand?: () => void
                isChild?: boolean
              }
            >,
            {
              testID: 'playlists-list',
              items: displayItems,
              estimatedItemSize: 64,
              keyExtractor: (item) => (item.isChild ? `${item.id}:child` : item.id),
              empty: h(EmptyState, { title: t('library:sidebarFolder.noItemsYet') }),
              renderItem: (item) =>
                h(UnifiedLibraryRow, {
                  key: item.isChild ? `${item.id}:child` : item.id,
                  ctx,
                  item,
                  isFolder: item.isFolder ?? (item.kind === 'collection'),
                  isExpanded: item.isExpanded ?? expandedFolderIds.has(item.id),
                  onToggleExpand: item.onToggleExpand ?? (() => toggleFolderExpanded(item.id)),
                  isChild: item.isChild,
                }),
            },
          ),
    ),
    renderModals(),
    renderContextMenus(),
  )
}
