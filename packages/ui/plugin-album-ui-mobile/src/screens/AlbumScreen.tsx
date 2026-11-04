import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  Collection,
  DownloadsService,
  LibraryService,
  PlayerService,
  SettingsService,
  ShareService,
  SourcesService,
  Track,
} from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { useAlbum } from '@bbebee/plugin-album/hooks'
import { useResolvedArtwork, useTransport, resolveTrackSourceName } from '@BBeBee/toolkit/hooks'
import { formatTotalDuration } from '@BBeBee/toolkit'
import { serviceOf, type MenuItemSpec } from '@BBeBee/ui-core'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { addToCollectionSubmenu, useSaveToPlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import {
  Artwork,
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
import { tokens } from '@BBeBee/ui-tokens'
import { HeaderGradient } from '../components/HeaderGradient.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { AlbumTrackRow } from '../components/AlbumTrackRow.js'
import { SaveToPlaylistSheet } from '../components/SaveToPlaylistSheet.js'

type AlbumSortKey = 'default' | 'title' | 'artist' | 'duration'
type SortOrder = 'asc' | 'desc'
type ViewMode = 'list' | 'compact'

export function AlbumScreen({
  ctx,
  urn,
  onBack,
}: {
  ctx: Context
  urn?: string
  onBack?: () => void
}): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const album = useAlbum(ctx, urn)
  const transport = useTransport(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const library = serviceOf<LibraryService>(ctx, 'library')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const shareService = serviceOf<ShareService>(ctx, 'share')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const menu = useTrackMenu(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)

  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<AlbumSortKey>('default')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())
  const [isSaved, setIsSaved] = useState(false)
  const [savedTrackUrns, setSavedTrackUrns] = useState<Set<string>>(new Set())
  const [collections, setCollections] = useState<readonly Collection[]>([])

  // Header menu listener: Triggered by top-right navigation bar button
  useEffect(() => {
    const off = ctx.on('library/open-header-menu', () => {
      setMenuOpen(true)
    })
    return () => {
      off()
    }
  }, [ctx])

  // Resolve artwork
  const resolvedCover = useResolvedArtwork(ctx, album.data?.artwork)
  const dominantTint = (resolvedCover as { dominantColor?: string } | undefined)?.dominantColor

  // Read saved album and tracks
  const loadSavedState = useCallback(() => {
    const albumUrn = album.data?.urn
    if (!library || !albumUrn) return

    library
      .isSaved(albumUrn)
      .then((saved) => setIsSaved(saved))
      .catch(() => {})

    if (typeof library.listSaved === 'function') {
      library
        .listSaved('track')
        .then((res) => {
          if (res?.items) {
            setSavedTrackUrns(new Set(res.items.map((i) => i.urn)))
          }
        })
        .catch(() => {})
    }

    if (typeof library.listCollections === 'function') {
      library
        .listCollections()
        .then((cols) => setCollections(cols))
        .catch(() => {})
    }
  }, [library, album.data?.urn])

  useEffect(() => {
    loadSavedState()
    const off = ctx.on('library/changed', () => loadSavedState())
    return () => void off()
  }, [ctx, loadSavedState])

  const albumData = album.data
  const rawTracks = useMemo(() => albumData?.tracks ?? [], [albumData?.tracks])

  // Filter & Sort tracks
  const processedTracks = useMemo(() => {
    let list = [...rawTracks]

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(
        (tr) =>
          tr.title.toLowerCase().includes(q) ||
          tr.artists?.some((a) => a.name.toLowerCase().includes(q)),
      )
    }

    if (sortKey !== 'default') {
      list.sort((a, b) => {
        let cmp = 0
        if (sortKey === 'title') {
          cmp = a.title.localeCompare(b.title)
        } else if (sortKey === 'artist') {
          const aArtist = a.artists?.[0]?.name ?? ''
          const bArtist = b.artists?.[0]?.name ?? ''
          cmp = aArtist.localeCompare(bArtist)
        } else if (sortKey === 'duration') {
          cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
        }
        return sortOrder === 'asc' ? cmp : -cmp
      })
    } else if (sortOrder === 'desc') {
      list.reverse()
    }

    return list
  }, [rawTracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => processedTracks.map((t) => t.urn), [processedTracks])
  const activeTrackUrn = transport?.trackUrn
  const isPlaying = transport?.status === 'playing'

  // Toggle favorite album
  const handleToggleSaveAlbum = async () => {
    if (!library || !albumData) return
    const next = !isSaved
    setIsSaved(next)
    try {
      await library.setSaved(albumData.urn, next)
    } catch {
      setIsSaved(!next)
    }
  }

  // Toggle track favorite with dual-write
  const handleToggleTrackFavorite = async (track: Track) => {
    const isLoved = savedTrackUrns.has(track.urn)
    const next = !isLoved

    setSavedTrackUrns((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(track.urn)
      else copy.delete(track.urn)
      return copy
    })

    try {
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, next)
      }
      if (library?.setSaved) {
        await library.setSaved(track.urn, next)
      }
    } catch {
      setSavedTrackUrns((prev) => {
        const copy = new Set(prev)
        if (isLoved) copy.add(track.urn)
        else copy.delete(track.urn)
        return copy
      })
    }
  }

  // Batch operations
  const handleToggleSelectAll = () => {
    if (selectedUrns.size === sortedUrns.length) {
      setSelectedUrns(new Set())
    } else {
      setSelectedUrns(new Set(sortedUrns))
    }
  }

  const handleToggleSelect = (trackUrn: string) => {
    setSelectedUrns((prev) => {
      const copy = new Set(prev)
      if (copy.has(trackUrn)) copy.delete(trackUrn)
      else copy.add(trackUrn)
      return copy
    })
  }

  const handleBatchPlay = () => {
    const toPlay = sortedUrns.filter((u) => selectedUrns.has(u))
    if (toPlay.length > 0 && player && albumData) {
      void player.playNow(toPlay, {
        context: { kind: 'album', urn: albumData.urn, label: albumData.title },
      })
    }
  }

  const handleBatchDownload = () => {
    if (!downloads || !albumData) return
    const selectedTracks = albumData.tracks.filter((t) => selectedUrns.has(t.urn))
    if (selectedTracks.length > 0) {
      void downloads.enqueue(selectedTracks)
      setIsBatchMode(false)
      setSelectedUrns(new Set())
    }
  }

  // Unified Top-Right Menu items
  const menuItems = useMemo<MenuItemSpec[]>(() => {
    if (!albumData) return []

    const actionItems: MenuItemSpec[] = [
      {
        id: 'batch-mode',
        label: t('album:index.batchOperations'),
        icon: 'list-check',
        onSelect: () => {
          setIsBatchMode((prev) => !prev)
          setSelectedUrns(new Set())
        },
      },
      {
        id: 'save-album',
        label: isSaved
          ? t('album:index.removeFromMusicLibrary')
          : t('album:index.addToMusicLibrary'),
        icon: isSaved ? 'heart-filled' : 'heart',
        onSelect: () => void handleToggleSaveAlbum(),
      },
    ]

    if (downloads) {
      actionItems.push({
        id: 'download-all',
        label: t('album:index.downloadAll'),
        icon: 'download',
        onSelect: () => {
          void downloads.enqueue(albumData.tracks)
        },
      })
    }

    if (shareService) {
      actionItems.push({
        id: 'share-album',
        label: t('album:index.shareAlbum'),
        icon: 'share',
        onSelect: () => {
          const coverUrl =
            typeof albumData.artwork === 'string'
              ? albumData.artwork
              : (albumData.artwork as { sourceUrl?: string } | undefined)?.sourceUrl
          shareService.shareAlbum(
            {
              urn: albumData.urn,
              title: albumData.title,
              artist: albumData.artists?.map((a) => a.name).join(', ') || t('album:index.unknownArtist'),
              artwork: coverUrl,
              year: albumData.year,
              trackCount: albumData.tracks.length,
            },
            albumData.tracks,
          )
        },
      })
    }

    if (collections.length > 0 && library) {
      const folderSubmenu = addToCollectionSubmenu(library, [albumData.urn], collections, { ctx })
      if (folderSubmenu) {
        actionItems.push({
          id: 'add-to-folder',
          label: t('album:index.addToFolder'),
          icon: 'folder',
          submenu: folderSubmenu,
        })
      }
    }

    const viewSubmenuItems: MenuItemSpec[] = [
      {
        id: 'view-compact',
        label: t('app:common.viewMode.compact') || 'Compact',
        icon: viewMode === 'compact' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setViewMode('compact'),
      },
      {
        id: 'view-list',
        label: t('app:common.viewMode.list') || 'List',
        icon: viewMode === 'list' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setViewMode('list'),
      },
    ]

    const sortSubmenuItems: MenuItemSpec[] = [
      {
        id: 'sort-default',
        label: t('album:index.defaultOrder'),
        icon: sortKey === 'default' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('default'),
      },
      {
        id: 'sort-title',
        label: t('album:index.title'),
        icon: sortKey === 'title' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('title'),
      },
      {
        id: 'sort-artist',
        label: t('album:index.artist'),
        icon: sortKey === 'artist' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('artist'),
      },
      {
        id: 'sort-duration',
        label: t('album:index.duration'),
        divider: true,
        icon: sortKey === 'duration' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('duration'),
      },
      {
        id: 'sort-asc',
        label: t('app:common.menu.ascending') || 'Ascending',
        icon: sortOrder === 'asc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortOrder('asc'),
      },
      {
        id: 'sort-desc',
        label: t('app:common.menu.descending') || 'Descending',
        icon: sortOrder === 'desc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortOrder('desc'),
      },
    ]

    return [
      ...actionItems,
      {
        id: 'menu-view-mode',
        label: t('app:common.viewMode.viewMode') || 'Display',
        icon: 'list',
        submenu: {
          title: t('app:common.viewMode.viewMode') || 'Display',
          items: viewSubmenuItems,
        },
      },
      {
        id: 'menu-sort',
        label: t('album:index.sortBy') || 'Sort by',
        icon: 'shuffle',
        submenu: {
          title: t('album:index.sortBy') || 'Sort by',
          items: sortSubmenuItems,
        },
      },
    ]
  }, [
    albumData,
    isSaved,
    downloads,
    shareService,
    collections,
    library,
    viewMode,
    sortKey,
    sortOrder,
    t,
    ctx,
  ])

  if (album.status === 'loading' || album.status === 'idle') {
    return h(EmptyState, { title: t('album:index.loadingAlbum') })
  }

  const handleBack = () => {
    if (onBack) onBack()
    else serviceOf<{ navigate(id: string): void }>(ctx, 'ui')?.navigate(LIBRARY_VIEWS.home)
  }

  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: 'alert',
      title: t('album:index.albumUnavailable'),
      description: album.error?.message,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: t('album:index.backToLibrary') }),
    })
  }

  const detail = album.data

  const artistsText = detail.artists?.map((a) => a.name).join(', ') || t('album:index.unknownArtist')
  const yearText = detail.year || (detail.releaseDate ? detail.releaseDate.slice(0, 4) : '')
  const totalDurationStr = formatTotalDuration(detail.tracks)

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: c().bg.base,
      },
      accessibilityLabel: detail.title,
    },
    // Header Hero Area
    h(
      native.View as never,
      {
        style: {
          position: 'relative',
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[4],
          paddingBottom: tokens.space[3],
          gap: tokens.space[2],
          overflow: 'hidden',
        },
      },
      h(HeaderGradient, { tint: dominantTint }),
      // Eyebrow
      h(
        Text,
        { variant: 'xs', style: { letterSpacing: 1, opacity: 0.85, fontWeight: tokens.font.weight.bold } },
        t('album:index.album').toUpperCase(),
      ),
      // Hero Middle: Cover + Title + Metadata
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[3],
            marginTop: tokens.space[1],
          },
        },
        h(
          native.View as never,
          {
            style: {
              width: 100,
              height: 100,
              borderRadius: tokens.radius.md,
              overflow: 'hidden',
              elevation: 4,
            },
          },
          h(Artwork, {
            artwork: detail.artwork,
            seed: detail.urn,
            size: 100,
            radius: tokens.radius.md,
          }),
        ),
        h(
          native.View as never,
          { style: { flex: 1, minWidth: 0, gap: 4 } },
          h(
            Text,
            {
              variant: 'xl',
              numberOfLines: 2,
              style: { fontSize: 22, fontWeight: tokens.font.weight.heavy },
            },
            detail.title,
          ),
          h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
            h(
              native.View as never,
              {
                style: {
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              detail.artists?.[0]?.name?.[0]?.toUpperCase()
                ? h(
                    Text,
                    { style: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' } },
                    detail.artists[0]!.name[0]!.toUpperCase(),
                  )
                : (tablerIcon('music', { size: 12, color: '#FFFFFF' }) ??
                    h(Text, { style: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' } }, '♪')),
            ),
            h(
              Text,
              { variant: 'sm', tone: 'muted', numberOfLines: 1, style: { flexShrink: 1 } },
              artistsText,
            ),
          ),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            `${yearText ? `${yearText} • ` : ''}${t('album:index.songsCount', { length: detail.tracks.length })}${totalDurationStr ? `, ${totalDurationStr}` : ''}`,
          ),
        ),
      ),
      // Action Bar: Play + Shuffle + Heart + Download + Share ... Search
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: tokens.space[2],
          },
        },
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
          // Play button
          h(
            native.Pressable as never,
            {
              testID: 'album-play-all',
              accessibilityRole: 'button',
              accessibilityLabel: t('album:index.playAlbum'),
              disabled: sortedUrns.length === 0,
              onPress: () => {
                if (sortedUrns.length > 0 && player) {
                  void player.playNow(sortedUrns, {
                    context: { kind: 'album', urn: detail.urn, label: detail.title },
                  })
                }
              },
              style: {
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'var(--color-primary, #5F87FF)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: sortedUrns.length === 0 ? 0.5 : 1,
              },
            },
            tablerIcon('play', { size: 22, color: '#FFFFFF' }),
          ),
          // Shuffle button
          h(
            native.Pressable as never,
            {
              testID: 'album-shuffle',
              accessibilityRole: 'button',
              accessibilityLabel: t('album:index.shuffle'),
              onPress: () => {
                if (sortedUrns.length > 0 && player) {
                  const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                  void player.playNow(shuffled, {
                    context: { kind: 'album', urn: detail.urn, label: detail.title },
                  })
                }
              },
              style: { padding: 8 },
            },
            tablerIcon('shuffle', { size: 22, color: c().text.muted }),
          ),
          // Save album heart
          h(
            native.Pressable as never,
            {
              testID: 'album-heart-trigger',
              accessibilityRole: 'button',
              accessibilityLabel: isSaved
                ? t('album:index.removeFromMusicLibrary')
                : t('album:index.addToMusicLibrary'),
              onPress: () => void handleToggleSaveAlbum(),
              style: { padding: 8 },
            },
            tablerIcon(isSaved ? 'heart-filled' : 'heart', {
              size: 22,
              color: isSaved ? 'var(--color-primary, #5F87FF)' : c().text.muted,
            }),
          ),
          // Download all
          downloads
            ? h(
                native.Pressable as never,
                {
                  testID: 'album-download-all',
                  accessibilityRole: 'button',
                  accessibilityLabel: t('album:index.downloadAll'),
                  onPress: () => void downloads.enqueue(detail.tracks),
                  style: { padding: 8 },
                },
                tablerIcon('download', { size: 22, color: c().text.muted }),
              )
            : null,
          // Share
          shareService
            ? h(
                native.Pressable as never,
                {
                  testID: 'album-share-btn',
                  accessibilityRole: 'button',
                  accessibilityLabel: t('album:index.shareAlbum'),
                  onPress: () => {
                    const coverUrl =
                      typeof detail.artwork === 'string'
                        ? detail.artwork
                        : (detail.artwork as { sourceUrl?: string } | undefined)?.sourceUrl
                    shareService.shareAlbum(
                      {
                        urn: detail.urn,
                        title: detail.title,
                        artist: artistsText,
                        artwork: coverUrl,
                        year: detail.year,
                        trackCount: detail.tracks.length,
                      },
                      detail.tracks,
                    )
                  },
                  style: { padding: 8 },
                },
                tablerIcon('share', { size: 22, color: c().text.muted }),
              )
            : null,
        ),
        // Search trigger
        h(
          native.Pressable as never,
          {
            testID: 'album-search-trigger',
            accessibilityRole: 'button',
            accessibilityLabel: 'Search tracks',
            onPress: () => setIsSearchOpen((prev) => !prev),
            style: { padding: 8 },
          },
          tablerIcon('search', {
            size: 20,
            color: isSearchOpen ? 'var(--color-primary, #5F87FF)' : c().text.muted,
          }),
        ),
      ),
      // Search Bar input
      isSearchOpen
        ? h(
            native.View as never,
            { style: { marginTop: tokens.space[2] } },
            h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: t('album:index.searchInAlbum'),
            }),
          )
        : null,
    ),
    // Batch Action Bar
    isBatchMode
      ? h(
          native.View as never,
          { style: { paddingHorizontal: tokens.space[4] } },
          h(BatchActionBar, {
            ctx,
            selectedCount: selectedUrns.size,
            totalCount: sortedUrns.length,
            allSelected: sortedUrns.length > 0 && selectedUrns.size === sortedUrns.length,
            onToggleSelectAll: handleToggleSelectAll,
            onBatchPlay: handleBatchPlay,
            onBatchAddToPlaylist: (anchor) => {
              saveToPlaylistMenu.openBatch(sortedUrns.filter((u) => selectedUrns.has(u)), anchor)
            },
            onBatchDownload: downloads ? handleBatchDownload : undefined,
            onExitBatch: () => {
              setIsBatchMode(false)
              setSelectedUrns(new Set())
            },
          }),
        )
      : null,
    // Track list
    h(List<Track>, {
      items: processedTracks,
      accessibilityLabel: t('album:index.tracksOn', { title: detail.title }),
      estimatedItemSize: viewMode === 'compact' ? 42 : 54,
      keyExtractor: (track) => track.urn,
      empty: h(EmptyState, { title: t('album:index.thisAlbumHasNoTracks') }),
      renderItem: (track, index) =>
        h(AlbumTrackRow, {
          ctx,
          track,
          index,
          active: track.urn === activeTrackUrn,
          isPlaying: track.urn === activeTrackUrn && isPlaying,
          inLibrary: savedTrackUrns.has(track.urn),
          compact: viewMode === 'compact',
          batchMode: isBatchMode,
          selected: selectedUrns.has(track.urn),
          onToggleSelect: () => handleToggleSelect(track.urn),
          sourceName: resolveTrackSourceName(ctx, track.urn),
          onPress: () => {
            if (isBatchMode) {
              handleToggleSelect(track.urn)
            } else if (player) {
              void player.playFromContext(track.urn, sortedUrns, {
                context: { kind: 'album', urn: detail.urn, label: detail.title },
              })
            }
          },
          onAddToFavorites: (t) => void handleToggleTrackFavorite(t),
          onHeartPress: (t) => saveToPlaylistMenu.open(t, { x: 0, y: 0 }),
          onMore: (anchor) => menu.open({ track }, anchor),
        }),
    }),
    // Single Top-Right Consolidated ContextMenu
    h(ContextMenu, {
      open: menuOpen,
      items: menuItems,
      onClose: () => setMenuOpen(false),
      placement: 'top-right',
      liquid: liquidGlass,
      ctx,
      x: 0,
      y: 0,
    }),
    // Save to playlist sheet for batch operations
    h(SaveToPlaylistSheet, {
      ctx,
      menuProps: saveToPlaylistMenu.menuProps,
    }),
  )
}
