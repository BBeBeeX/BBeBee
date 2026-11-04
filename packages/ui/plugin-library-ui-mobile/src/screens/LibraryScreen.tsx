/**
 * The unified library — the mobile transcription of the desktop twin's
 * `LibraryScreen` (its main sidebar-mode view). Same layout, same content,
 * same wiring: the title, the two quick entries (Favorites, Local &
 * downloads) with live counts, the filter/search/sort/create toolbar, and one
 * recycled list of unified rows (playlists, albums, folders, artists) with
 * pin-first sorting and inline folder expansion.
 *
 * Platform transcription only: hover becomes long-press, the dropdown menu
 * becomes a bottom sheet, and the three desktop windowing modes (collapsed /
 * sidebar / expanded) stay desktop-only — a phone has one column and one
 * pane. Reads, reload rules and every derived value come from
 * `@bbebee/plugin-library/hooks`, shared with the desktop twin.
 */

import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DownloadsService, PlayerService, SettingsService, ShareService } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings, tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import {
  useCollections,
  useLibraryHydration,
  useLibraryProfile,
  usePlaylists,
  useSaved,
} from '@bbebee/plugin-library/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { ALBUM_VIEWS } from '@bbebee/plugin-album/views'
import {
  Button,
  ContextMenu,
  EmptyState,
  List,
  Text,
  TextField,
  c,
  nativePrimitives,
  tablerIcon,
  useI18n,
} from '@BBeBee/ui-kit-mobile'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { UnifiedRow, type UnifiedItem } from '../components/UnifiedRow.js'
import { LibraryModals } from '../components/LibraryModals.js'
import { useLibraryActions } from '../hooks/useLibraryActions.js'

/** The filter chips: stable keys plus the i18n key for each label. */
const FILTER_CHIPS = [
  { key: 'playlist', labelKey: 'library:libraryToolbar.playlists' },
  { key: 'album', labelKey: 'library:libraryToolbar.albums' },
  { key: 'artist', labelKey: 'library:libraryToolbar.artists' },
] as const

type FilterKey = (typeof FILTER_CHIPS)[number]['key'] | 'all' | 'downloaded'

type SortMode = 'creator' | 'recent-added' | 'recent-played' | 'alphabetical'

const SORT_LABEL_KEYS: Record<SortMode, string> = {
  creator: 'library:library.creator',
  'recent-added': 'library:library.recentlyAdded',
  'recent-played': 'library:library.recentlyPlayed',
  alphabetical: 'library:library.alphabetical',
}

export function LibraryScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()

  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedArtistEntries = useSaved(ctx, 'artist')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)

  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('creator')
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  // The header menu's glass surface, read fresh on every render: the
  // menu opens from a state change, so a settings change made elsewhere
  // is picked up before the next open, and no setting can change while
  // this modal is up (it blocks the screen behind it).
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const [pendingCreate, setPendingCreate] = useState<'playlist' | 'folder' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const off = ctx.on('library/open-header-menu', () => {
      setHeaderMenuOpen(true)
    })
    return () => void off()
  }, [ctx])

  // Coalesce rapid bursts (a scan emits `library/changed` per batch):
  // without this, every batch triggers a full library hydration.
  useEffect(() => {
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

  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = useCallback(
    (what: string) => (cause: unknown) => {
      setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)
    },
    [],
  )

  const [folderItemsMap, setFolderItemsMap] = useState<Map<string, UnifiedItem[]>>(new Map())
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

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
    playlistMenu,
    collectionMenu,
    albumMenu,
    setGeneration,
    setFolderItemsMap,
    setContainedPlaylistUrns,
    fail,
  })

  const favoriteUrns = useMemo(() => savedTrackEntries.data?.map((e) => e.urn) ?? [], [savedTrackEntries.data])

  // The local user is the creator: used by both the playlist row's creator
  // and the "Playlist • X" subtitle — same rule as the desktop twin.
  const profile = useLibraryProfile(ctx)
  const creatorName = profile?.name ?? t('library:userProfile.mine')

  const navigate = useCallback(
    (viewId: string, params?: Record<string, unknown>) => {
      ctx.ui.navigate(viewId, params)
    },
    [ctx],
  )

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
          kind: 'playlist' as const,
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
          onOpen: () => navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
          onPlay: () => playPlaylist(playlist.urn, playlist.name),
          onDelete: () =>
            void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
          onMore: (anchor?: MenuAnchor) => openPlaylistMenu(playlist, anchor, isPinned),
        }
      })
  }, [allSaved.data, containedPlaylistUrns, ctx, creatorName, fail, isItemPinned, navigate, openPlaylistMenu, playPlaylist, playlistFirstTrackArtworks, playlists.data, t])

  const albumItems: UnifiedItem[] = useMemo(() => {
    return (savedAlbumEntries.data ?? []).map((entry) => {
      const detail = albumsMap.get(entry.urn)
      const title = detail?.title ?? entry.urn
      const artists = detail?.artists?.map((a) => a.name).join(', ') ?? t('library:localAlbum.albumFallback')
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      const trackUrns = detail?.tracks?.map((tr) => tr.urn) ?? []
      const lastPlayedAt = trackUrns.length > 0 ? Math.max(0, ...trackUrns.map((u) => historyMap.get(u) ?? 0)) : 0
      const isDownloaded =
        trackUrns.length > 0 &&
        trackUrns.every((u) => downloads?.tasks.some((task) => task.trackUrn === u && task.state === 'done'))
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
        onOpen: () => navigate(ALBUM_VIEWS.album, { urn: entry.urn }),
        onPlay: () => playAlbum(entry.urn, title),
        onDelete: () => void ctx.library.setSaved(entry.urn, false).catch(fail('could not remove the album')),
        onMore: (anchor?: MenuAnchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
      }
    })
  }, [albumsMap, ctx, downloads?.tasks, fail, historyMap, isItemPinned, navigate, openAlbumMenu, playAlbum, savedAlbumEntries.data, t])

  const collectionItems: UnifiedItem[] = useMemo(() => {
    return (collections.data ?? []).map((collection) => {
      const isPinned = isItemPinned({ id: collection.id })
      return {
        id: collection.id,
        kind: 'collection' as const,
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
        onOpen: () => navigate(LIBRARY_VIEWS.collection, { id: collection.id }),
        onPlay: () => playCollection(collection.id),
        onDelete: () =>
          void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
        onMore: (anchor?: MenuAnchor) => openCollectionMenu(collection, anchor, isPinned),
      }
    })
  }, [collectionFirstArtworks, collections.data, ctx, creatorName, fail, isItemPinned, navigate, openCollectionMenu, playCollection])

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
        onOpen: () => navigate('sources.search', { query: name }),
        onPlay: () => {},
        onMore: (anchor?: MenuAnchor) => openBuiltinMenu(name, () => {}, isPinned, { id: entry.urn }, anchor),
      }
    })
  }, [ctx, isItemPinned, navigate, openBuiltinMenu, savedArtistEntries.data, t])

  const allItems = useMemo(
    () => [...playlistItems, ...albumItems, ...collectionItems, ...artistItems],
    [playlistItems, albumItems, collectionItems, artistItems],
  )

  const sortItems = useCallback(
    (a: UnifiedItem, b: UnifiedItem): number => {
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
    },
    [sortMode],
  )

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

    return [...result].sort(sortItems)
  }, [allItems, activeFilter, searchQuery, sortItems])

  // One folder's rows, resolved the same way the desktop twin resolves them:
  // playlists and albums by identity, tracks through the catalogue, and a
  // member nothing can answer for still shows, titled by its URN.
  const buildFolderItems = useCallback(
    async (collectionId: string): Promise<UnifiedItem[]> => {
      try {
        const page = await ctx.library.listCollectionItems(collectionId)
        const entries = page.items ?? []
        const results: UnifiedItem[] = []

        for (const entry of entries) {
          const kind = tryParseUrn(entry.urn)?.kind

          const matchedPlaylist = (playlists.data ?? []).find((p) => p.urn === entry.urn)
          if (matchedPlaylist) {
            const isPinned = isItemPinned({ id: matchedPlaylist.urn, urn: matchedPlaylist.urn })
            results.push({
              id: matchedPlaylist.urn,
              urn: matchedPlaylist.urn,
              kind: 'playlist',
              title: matchedPlaylist.name,
              subtitle: matchedPlaylist.isSmart
                ? t('library:library.smartPlaylist')
                : t('library:library.playlistByOwner', { owner: matchedPlaylist.owner ?? creatorName }),
              creator: matchedPlaylist.owner ?? creatorName,
              artwork: matchedPlaylist.artwork ?? playlistFirstTrackArtworks.get(matchedPlaylist.urn),
              artworkSeed: matchedPlaylist.urn,
              pinned: isPinned,
              addedAt: matchedPlaylist.createdAt ?? Date.now(),
              lastPlayedAt: 0,
              onOpen: () => navigate(LIBRARY_VIEWS.playlist, { urn: matchedPlaylist.urn }),
              onPlay: () => playPlaylist(matchedPlaylist.urn, matchedPlaylist.name),
              onDelete: () =>
                void ctx.library.deletePlaylist(matchedPlaylist.urn).catch(fail('could not delete the playlist')),
              onMore: (anchor?: MenuAnchor) => openPlaylistMenu(matchedPlaylist, anchor, isPinned, collectionId),
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
              onMore: (anchor?: MenuAnchor) =>
                openAlbumMenu({ urn: entry.urn, title: matchedAlbum.title }, anchor, matchedAlbum.pinned, collectionId),
            })
            continue
          }

          if (kind === 'track') {
            const local = localTracks.find((tr) => tr.urn === entry.urn)
            let trackObj = local
            if (!trackObj) {
              const fetched = await ctx.sources?.getTracks([entry.urn]).catch(() => [])
              trackObj = fetched?.[0]
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
                onMore: (anchor?: MenuAnchor) =>
                  openBuiltinMenu(
                    trackObj.title,
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
                  subtitle: detail.isSmart
                    ? t('library:library.smartPlaylist')
                    : t('library:library.playlistByOwner', { owner: detail.owner ?? creatorName }),
                  creator: detail.owner ?? creatorName,
                  artwork: detail.artwork ?? playlistFirstTrackArtworks.get(detail.urn),
                  artworkSeed: detail.urn,
                  pinned: isPinned,
                  addedAt: detail.createdAt ?? Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => navigate(LIBRARY_VIEWS.playlist, { urn: detail.urn }),
                  onPlay: () => playPlaylist(detail.urn, detail.name),
                  onMore: (anchor?: MenuAnchor) => openPlaylistMenu(detail, anchor, isPinned, collectionId),
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
                  onOpen: () => navigate(ALBUM_VIEWS.album, { urn: entry.urn }),
                  onPlay: () => playAlbum(entry.urn, title),
                  onDelete: () =>
                    void ctx.library
                      .removeFromCollection(collectionId, [entry.urn])
                      .catch(fail('could not remove album from folder')),
                  onMore: (anchor?: MenuAnchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned, collectionId),
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
      navigate,
      openAlbumMenu,
      openBuiltinMenu,
      openPlaylistMenu,
      player,
      playAlbum,
      playPlaylist,
      playlistFirstTrackArtworks,
      playlists.data,
      t,
    ],
  )

  // Hydrate every expanded folder; a folder row renders its children inline
  // beneath it, the same expansion the desktop list performs.
  useEffect(() => {
    if (expandedFolderIds.size === 0) return
    let cancelled = false
    void Promise.all(
      Array.from(expandedFolderIds).map(async (id) => ({ id, items: await buildFolderItems(id) })),
    )
      .then((results) => {
        if (cancelled) return
        setFolderItemsMap((prev) => {
          const next = new Map(prev)
          let changed = false
          for (const res of results) {
            const existing = prev.get(res.id)
            if (
              !existing ||
              existing.length !== res.items.length ||
              existing.some((it, idx) => it.id !== res.items[idx]?.id)
            ) {
              changed = true
            }
            next.set(res.id, res.items)
          }
          return changed ? next : prev
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedFolderIds, buildFolderItems, generation])

  const displayItems = useMemo(() => {
    const list: (UnifiedItem & { isFolder?: boolean; isExpanded?: boolean; onToggleExpand?: () => void; isChild?: boolean })[] = []
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
        for (const child of folderItemsMap.get(item.id) ?? []) {
          list.push({ ...child, isChild: true })
        }
      }
    }
    return list
  }, [filteredItems, expandedFolderIds, folderItemsMap, toggleFolderExpanded])

  const handleImportShare = () => {
    const share = serviceOf<ShareService>(ctx, 'share')
    if (share) {
      share.openImport()
    } else {
      ctx.emit?.('share/import')
    }
  }

  const quickCard = (icon: string, glyph: string, label: string, count: number, viewId: string) =>
    h(
      native.Pressable as never,
      {
        key: viewId,
        accessibilityRole: 'button',
        accessibilityLabel: label,
        testID: `library-quick-${viewId}`,
        onPress: () => navigate(viewId),
        style: {
          flex: 1,
          backgroundColor: c().bg.raised,
          borderRadius: tokens.radius.md,
          borderWidth: 1,
          borderColor: c().border.subtle,
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[3],
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[3],
        },
      },
      h(
        native.View as never,
        {
          style: {
            width: 38,
            height: 38,
            borderRadius: tokens.radius.sm,
            backgroundColor: c().bg.base,
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        tablerIcon(icon, { size: 20, color: c().accent.base }) ??
          h(Text, { style: { fontSize: 18, color: c().accent.base } }, glyph),
      ),
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0, gap: 2 } },
        h(Text, { variant: 'sm', numberOfLines: 1, style: { fontWeight: '600' } }, label),
        h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1 }, `${count}`),
      ),
    )

  const filterChip = (key: FilterKey, label: string) => {
    const active = activeFilter === key
    return h(
      native.Pressable as never,
      {
        key,
        accessibilityRole: 'button',
        accessibilityLabel: label,
        accessibilityState: { selected: active },
        testID: `library-filter-${key}`,
        onPress: () => setActiveFilter(active ? 'all' : key),
        style: {
          minHeight: 30,
          paddingHorizontal: tokens.space[3],
          borderRadius: tokens.radius.pill,
          borderWidth: 1,
          borderColor: active ? 'transparent' : c().border.subtle,
          backgroundColor: active ? c().accent.base : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(
        Text,
        {
          style: {
            color: active ? c().accent.on : c().text.secondary,
            fontSize: tokens.font.size.xs,
            fontWeight: tokens.font.weight.bold,
          },
        },
        label,
      ),
    )
  }

  const libraryHeaderMenuItems = useMemo<MenuItemSpec[]>(() => {
    return [
      {
        id: 'create-menu-playlist',
        label: t('library:libraryCreateDropdown.playlist'),
        icon: 'playlist-add',
        onSelect: () => setPendingCreate('playlist'),
      },
      {
        id: 'create-menu-folder',
        label: t('library:libraryCreateDropdown.folder'),
        icon: 'create-folder',
        onSelect: () => setPendingCreate('folder'),
      },
      {
        id: 'create-menu-import-share',
        label: t('library:libraryCreateDropdown.importShare'),
        icon: 'upload',
        onSelect: () => handleImportShare(),
      },
      {
        id: 'menu-sort',
        label: t('library:favorites.sortBy'),
        icon: 'shuffle',
        submenu: {
          title: t('library:favorites.sortBy'),
          items: (['creator', 'recent-added', 'recent-played', 'alphabetical'] as const).map((mode) => ({
            id: `sort-option-${mode}`,
            label: t(SORT_LABEL_KEYS[mode]),
            icon: sortMode === mode ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
            onSelect: () => setSortMode(mode),
          })),
        },
      },
    ]
  }, [handleImportShare, sortMode, t])

  const hasArtists = artistItems.length > 0
  const visibleChips = FILTER_CHIPS.filter(({ key }) => key !== 'artist' || hasArtists)

  return h(
    native.View as never,
    {
      style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] },
      accessibilityLabel: t('library:library.library'),
    },
    // Quick entries, the desktop nav's two rows -> cards in one row.
    h(
      native.View as never,
      {
        accessibilityLabel: t('library:collapsedLibrary.musicLibraryQuickLinks'),
        style: { flexDirection: 'row', gap: tokens.space[3] },
      },
      quickCard('heart', 'heart', t('library:unifiedLibrary.favorites'), favoriteUrns.length, LIBRARY_VIEWS.favorites),
      quickCard('download', 'download', t('library:library.localAndDownloads'), localTracks.length, LIBRARY_VIEWS.local),
    ),
    // Toolbar: filter chips, then search toggle at the far right.
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[2] } },
      visibleChips.map(({ key, labelKey }) => filterChip(key as FilterKey, t(labelKey))),
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1], marginLeft: 'auto' } },
        h(Button, {
          variant: 'ghost',
          onPress: () => setSearchOpen((open) => !open),
          accessibilityLabel: t('sources:search.search'),
          testID: 'library-search-toggle',
          children: tablerIcon('search', { size: 20, color: c().text.secondary }) ?? '🔍',
        }),
      ),
    ),
    searchOpen
      ? h(TextField, {
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: t('library:libraryToolbar.searchTheLibrary'),
          testID: 'library-search-input',
          liquid: liquidGlass,
        })
      : null,
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,
    playlists.status === 'error'
      ? h(Text, { tone: 'error' }, t('library:index.couldNotReadPlaylists', { message: playlists.error?.message ?? '' }))
      : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<UnifiedItem & { isFolder?: boolean; isExpanded?: boolean; onToggleExpand?: () => void; isChild?: boolean }>, {
        testID: 'playlists-list',
        items: displayItems,
        estimatedItemSize: 76,
        keyExtractor: (item) => (item.isChild ? `${item.id}:child` : item.id),
        empty: h(EmptyState, {
          icon: 'music',
          title: t('library:library.nothingFound'),
          description: t('library:library.importAMusicSourceScan'),
        }),

        renderItem: (item) =>
          h(UnifiedRow, {
            key: item.isChild ? `${item.id}:child` : item.id,
            ctx,
            item,
            isChild: item.isChild,
          }),
      }),
    ),
    // Header Menu — Right-click style dropdown anchored at top-right
    h(ContextMenu, {
      ctx,
      open: headerMenuOpen,
      onClose: () => setHeaderMenuOpen(false),
      placement: 'top-right',
      liquid: liquidGlass,
      items: libraryHeaderMenuItems,
      x: 0,
      y: 0,
      title: t('library:library.library'),
    }),
    h(LibraryModals, {
      ctx,
      showCreatePlaylistModal: pendingCreate === 'playlist',
      setShowCreatePlaylistModal: (open) => {
        if (!open) setPendingCreate(undefined)
      },
      onCreatePlaylist: (name) => createPlaylist(name, null),
      showCreateCollectionModal: pendingCreate === 'folder',
      setShowCreateCollectionModal: (open) => {
        if (!open) setPendingCreate(undefined)
      },
      onCreateCollection: (name) => createCollection(name, null),
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
      onConfirmDelete: () => {
        if (!confirmDeleteTarget) return
        const target = confirmDeleteTarget
        setConfirmDeleteTarget(null)
        void (async () => {
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
        })()
      },
    }),
    // Every open menu, mounted in one place.
    h(ContextMenu, { ctx, ...playlistMenu.menuProps, liquid: liquidGlass }),
    h(ContextMenu, { ctx, ...collectionMenu.menuProps, liquid: liquidGlass }),
    h(ContextMenu, { ctx, ...albumMenu.menuProps, liquid: liquidGlass }),
    h(ContextMenu, {
      ctx,
      open: simpleMenu !== undefined,
      onClose: () => setSimpleMenu(undefined),
      x: simpleMenu?.anchor?.x ?? 0,
      y: simpleMenu?.anchor?.y ?? 0,
      items: simpleMenu?.items ?? [],
      ...(simpleMenu ? { title: simpleMenu.title } : {}),
      liquid: liquidGlass,
    }),
  )
}
