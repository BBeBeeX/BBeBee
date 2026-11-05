import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, PlayerService, SettingsService, Track } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { useLocalMusic } from '@bbebee/plugin-library/hooks'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { ALBUM_VIEWS } from '@bbebee/plugin-album/views'
import { useTransport } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
  BOTTOM_CHROME_HEIGHT,
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
import { BatchActionBar } from '../components/BatchActionBar.js'
import { HeaderGradient } from '../components/HeaderGradient.js'
import { LocalAlbumCard } from '../components/LocalAlbumCard.js'
import { LocalArtistRow } from '../components/LocalArtistRow.js'
import { MobileLibraryTrackRow } from '../components/MobileLibraryTrackRow.js'
import { SaveToPlaylistSheet } from '../components/SaveToPlaylistSheet.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

export interface LocalMusicScreenProps {
  ctx: Context
  highlightUrn?: string
  highlightUrns?: readonly string[]
}

export function LocalMusicScreen({
  ctx,
  highlightUrn,
  highlightUrns,
}: LocalMusicScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const transport = useTransport(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )

  const targetUrns = useMemo(() => {
    const set = new Set<string>()
    if (highlightUrn) set.add(highlightUrn)
    if (highlightUrns) {
      for (const u of highlightUrns) {
        if (u) set.add(u)
      }
    }
    return set
  }, [highlightUrn, highlightUrns])

  const local = useLocalMusic(ctx, {
    unknownAlbumLabel: t('library:localAlbum.unknownAlbum'),
    targetUrns,
  })

  const {
    tracks,
    albums,
    artists,
    loading,
    error,
    viewMode,
    setViewMode,
    selectedArtist,
    setSelectedArtist,
    trackSortKey,
    setTrackSortKey,
    trackSortOrder,
    setTrackSortOrder,
    albumSortKey,
    setAlbumSortKey,
    albumSortOrder,
    setAlbumSortOrder,
    searchQuery,
    setSearchQuery,
    filteredTracks: sortedTracks,
    filteredAlbums: sortedAlbums,
    filteredArtists,
    tracksForSelectedArtist,
    batch,
  } = local

  const [searchVisible, setSearchVisible] = useState(false)
  const [trackViewMode, setTrackViewMode] = useState<'compact' | 'list'>('list')
  const [albumViewMode, setAlbumViewMode] = useState<'compact' | 'list' | 'tiled'>('tiled')
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)

  const isBatchMode = batch.isBatchMode
  const setIsBatchMode = batch.setBatchMode
  const selectedUrns = batch.selectedUrns

  useEffect(() => {
    const off = ctx.on('library/open-header-menu', (targetId?: string) => {
      if (!targetId || targetId === 'library.local' || targetId === LIBRARY_VIEWS.local) {
        setHeaderMenuOpen(true)
      }
    })
    return () => void off()
  }, [ctx])

  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleToggleFavorite,
    openAddToPlaylistMenu,
    openBatchAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)

  const [activeHighlights, setActiveHighlights] = useState<Set<string>>(() => new Set(targetUrns))

  useEffect(() => {
    setActiveHighlights(new Set(targetUrns))
    if (targetUrns.size === 0) return
    const timer = setTimeout(() => {
      setActiveHighlights(new Set())
    }, 8000)
    return () => clearTimeout(timer)
  }, [targetUrns])

  useEffect(() => {
    if (targetUrns.size > 0) {
      setViewMode('tracks')
    }
  }, [targetUrns, setViewMode])

  const sortedArtistTracks = useMemo(() => {
    if (viewMode !== 'artists' || !selectedArtist) return []
    return tracksForSelectedArtist
  }, [viewMode, selectedArtist, tracksForSelectedArtist])

  const currentTracks = useMemo(() => {
    if (viewMode === 'artists' && selectedArtist) {
      return sortedArtistTracks
    }
    return sortedTracks
  }, [viewMode, selectedArtist, sortedArtistTracks, sortedTracks])

  const currentTrackUrns = useMemo(() => currentTracks.map((t) => t.urn), [currentTracks])
  const sortedTrackUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])

  // Batch operations
  const allSelected = currentTrackUrns.length > 0 && selectedUrns.size === currentTrackUrns.length
  const handleToggleSelectAll = () => {
    if (allSelected) {
      batch.clearSelection()
    } else {
      batch.selectAll(currentTrackUrns)
    }
  }

  const handleToggleSelect = (urn: string) => {
    batch.toggleSelect(urn)
  }

  const handleBatchPlay = () => {
    const toPlay = Array.from(selectedUrns)
    if (toPlay.length > 0) {
      void player?.playNow(toPlay, {
        context: { kind: 'local', label: t('library:localMusic.localMusic') },
      })
    }
  }

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const trackMap = new Map(tracks.map((t) => [t.urn, t]))
      const selectedTracks = toAdd.map((u) => trackMap.get(u) ?? u)
      openBatchAddToPlaylistMenu(selectedTracks, anchor ?? { x: 200, y: 200 })
    }
  }

  const handleBatchDelete = () => {
    if (selectedUrns.size === 0) return
    batch.clearSelection()
  }

  const handleExitBatch = () => {
    batch.setBatchMode(false)
  }

  const unifiedMenuItems: MenuItemSpec[] = useMemo(() => {
    const actionItems: MenuItemSpec[] = [
      {
        id: 'folder-settings',
        label: t('library:localMusic.scanSettings') || 'Scan settings',
        icon: 'folder',
        onSelect: () => ctx.ui.navigate('settings.view', { tab: 'sources' }),
      },
      ...(isBatchMode
        ? [
            {
              id: 'batch-play',
              label: t('library:favorites.playSelected'),
              icon: 'play',
              disabled: selectedUrns.size === 0,
              onSelect: handleBatchPlay,
            },
            {
              id: 'batch-add',
              label: t('library:trackLibraryActionButton.addToPlaylist2'),
              icon: 'plus',
              disabled: selectedUrns.size === 0,
              onSelect: () => handleBatchAddToPlaylist(),
            },
            {
              id: 'batch-delete',
              label: t('library:localMusic.delete'),
              icon: 'trash',
              tone: 'danger' as const,
              disabled: selectedUrns.size === 0,
              onSelect: handleBatchDelete,
            },
            {
              id: 'batch-exit',
              label: t('library:favorites.exitBatchOperations'),
              icon: 'x',
              divider: true,
              onSelect: handleExitBatch,
            },
          ]
        : viewMode !== 'albums'
          ? [
              {
                id: 'batch-operations',
                label: t('library:favorites.batchOperations'),
                icon: 'list-check',
                divider: true,
                onSelect: () => setIsBatchMode(true),
              },
            ]
          : []),
    ]

    const viewSubmenuItems: MenuItemSpec[] =
      viewMode === 'albums'
        ? [
            {
              id: 'view-compact',
              label: t('app:common.viewMode.compact') || 'Compact',
              icon: albumViewMode === 'compact' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumViewMode('compact'),
            },
            {
              id: 'view-list',
              label: t('app:common.viewMode.list') || 'List',
              icon: albumViewMode === 'list' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumViewMode('list'),
            },
            {
              id: 'view-tiled',
              label: t('app:common.viewMode.tiled') || 'Tiled',
              icon: albumViewMode === 'tiled' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumViewMode('tiled'),
            },
          ]
        : [
            {
              id: 'view-compact',
              label: t('app:common.viewMode.compact') || 'Compact',
              icon: trackViewMode === 'compact' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackViewMode('compact'),
            },
            {
              id: 'view-list',
              label: t('app:common.viewMode.list') || 'List',
              icon: trackViewMode === 'list' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackViewMode('list'),
            },
          ]

    const sortSubmenuItems: MenuItemSpec[] =
      viewMode === 'albums'
        ? [
            {
              id: 'sort-default',
              label: t('library:favorites.defaultOrder'),
              icon: albumSortKey === 'default' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortKey('default'),
            },
            {
              id: 'sort-title',
              label: t('library:localMusic.albumName'),
              icon: albumSortKey === 'title' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortKey('title'),
            },
            {
              id: 'sort-artist',
              label: t('library:favorites.artist'),
              icon: albumSortKey === 'artist' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortKey('artist'),
            },
            {
              id: 'sort-year',
              label: t('library:localMusic.year'),
              icon: albumSortKey === 'year' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortKey('year'),
            },
            {
              id: 'sort-count',
              label: t('library:localMusic.trackCount'),
              divider: true,
              icon: albumSortKey === 'count' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortKey('count'),
            },
            {
              id: 'sort-asc',
              label: t('app:common.menu.ascending') || 'Ascending',
              icon: albumSortOrder === 'asc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortOrder('asc'),
            },
            {
              id: 'sort-desc',
              label: t('app:common.menu.descending') || 'Descending',
              icon: albumSortOrder === 'desc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setAlbumSortOrder('desc'),
            },
          ]
        : [
            {
              id: 'sort-default',
              label: t('library:favorites.defaultOrder'),
              icon: trackSortKey === 'default' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortKey('default'),
            },
            {
              id: 'sort-title',
              label: t('library:favorites.title'),
              icon: trackSortKey === 'title' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortKey('title'),
            },
            {
              id: 'sort-artist',
              label: t('library:favorites.artist'),
              icon: trackSortKey === 'artist' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortKey('artist'),
            },
            {
              id: 'sort-album',
              label: t('library:favorites.album'),
              icon: trackSortKey === 'album' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortKey('album'),
            },
            {
              id: 'sort-duration',
              label: t('library:favorites.duration'),
              divider: true,
              icon: trackSortKey === 'duration' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortKey('duration'),
            },
            {
              id: 'sort-asc',
              label: t('app:common.menu.ascending') || 'Ascending',
              icon: trackSortOrder === 'asc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortOrder('asc'),
            },
            {
              id: 'sort-desc',
              label: t('app:common.menu.descending') || 'Descending',
              icon: trackSortOrder === 'desc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setTrackSortOrder('desc'),
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
        label: t('library:favorites.sortBy') || 'Sort',
        icon: 'shuffle',
        submenu: {
          title: t('library:favorites.sortBy') || 'Sort',
          items: sortSubmenuItems,
        },
      },
    ]
  }, [
    isBatchMode,
    selectedUrns,
    currentTrackUrns,
    viewMode,
    albumViewMode,
    trackViewMode,
    albumSortKey,
    albumSortOrder,
    trackSortKey,
    trackSortOrder,
    t,
  ])

  const handleOpenAlbum = (trk: Track) => {
    const urn = trk.albumUrn || (trk.albumTitle ? `BBeBee:local:album:${encodeURIComponent(trk.albumTitle)}` : undefined)
    if (urn) {
      ctx.ui.navigate(ALBUM_VIEWS.album, { urn })
    }
  }

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: c().bg.base,
      },
      accessibilityLabel: t('library:localMusic.localMusic'),
    },
    // Header Hero Area
    h(
      native.View as never,
      {
        style: {
          position: 'relative',
          overflow: 'hidden',
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[4],
          paddingBottom: tokens.space[2],
          gap: tokens.space[2],
        },
      },
      h(HeaderGradient, {}),
      // Eyebrow
      h(
        Text,
        { variant: 'xs', style: { letterSpacing: 1, opacity: 0.85, fontWeight: tokens.font.weight.bold } },
        t('library:localMusic.localMusic').toUpperCase(),
      ),
      // Title
      h(
        Text,
        { variant: 'xl', numberOfLines: 1, style: { fontSize: 28, fontWeight: tokens.font.weight.heavy } },
        viewMode === 'tracks'
          ? t('library:localMusic.localFiles')
          : viewMode === 'albums'
            ? t('library:localMusic.localAlbums')
            : selectedArtist
              ? selectedArtist
              : t('library:localMusic.localArtists'),
      ),
      // Subtitle
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        viewMode === 'tracks'
          ? t('library:localMusic.filesFromThisComputerSongs', { length: tracks.length })
          : viewMode === 'albums'
            ? t('library:localMusic.albumsFromThisComputerAlbums', { length: albums.length })
            : selectedArtist
              ? t('library:localAlbum.tracks', { trackCount: sortedArtistTracks.length })
              : t('library:localMusic.artistsFromThisComputerArtists', { length: artists.length }),
      ),
      // View Mode Switcher: [ Songs ]  [ Albums ]  [ Artists ]
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[2],
            marginVertical: tokens.space[2],
          },
        },
        h(
          native.Pressable as never,
          {
            testID: 'local-tab-tracks',
            accessibilityRole: 'tab',
            accessibilityState: { selected: viewMode === 'tracks' },
            onPress: () => {
              setViewMode('tracks')
              setSelectedArtist(null)
            },
            style: {
              paddingVertical: 6,
              paddingHorizontal: 16,
              borderRadius: 20,
              backgroundColor: viewMode === 'tracks' ? '#FFFFFF' : 'transparent',
            },
          },
          h(
            Text,
            {
              variant: 'sm',
              style: {
                fontWeight: tokens.font.weight.bold,
                color: viewMode === 'tracks' ? '#000000' : c().text.muted,
              },
            },
            t('library:localMusic.songs'),
          ),
        ),
        h(
          native.Pressable as never,
          {
            testID: 'local-tab-albums',
            accessibilityRole: 'tab',
            accessibilityState: { selected: viewMode === 'albums' },
            onPress: () => {
              setViewMode('albums')
              setSelectedArtist(null)
            },
            style: {
              paddingVertical: 6,
              paddingHorizontal: 16,
              borderRadius: 20,
              backgroundColor: viewMode === 'albums' ? '#FFFFFF' : 'transparent',
            },
          },
          h(
            Text,
            {
              variant: 'sm',
              style: {
                fontWeight: tokens.font.weight.bold,
                color: viewMode === 'albums' ? '#000000' : c().text.muted,
              },
            },
            t('library:libraryToolbar.albums'),
          ),
        ),
        h(
          native.Pressable as never,
          {
            testID: 'local-tab-artists',
            accessibilityRole: 'tab',
            accessibilityState: { selected: viewMode === 'artists' },
            onPress: () => setViewMode('artists'),
            style: {
              paddingVertical: 6,
              paddingHorizontal: 16,
              borderRadius: 20,
              backgroundColor: viewMode === 'artists' ? '#FFFFFF' : 'transparent',
            },
          },
          h(
            Text,
            {
              variant: 'sm',
              style: {
                fontWeight: tokens.font.weight.bold,
                color: viewMode === 'artists' ? '#000000' : c().text.muted,
              },
            },
            t('library:localMusic.artists'),
          ),
        ),
      ),
      // Action Bar: Play + Shuffle ... Search (old more, scan, sort moved to 3-dots menu)
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
          // Play button
          h(
            native.Pressable as never,
            {
              testID: 'local-music-play',
              accessibilityRole: 'button',
              accessibilityLabel: t('library:favorites.playAll'),
              disabled: (viewMode === 'albums' ? sortedAlbums.length === 0 : currentTrackUrns.length === 0),
              onPress: () => {
                if (viewMode === 'albums') {
                  const firstAlbum = sortedAlbums[0]
                  if (firstAlbum) {
                    const albumTracks = tracks.filter(
                      (trk) => trk.albumUrn === firstAlbum.urn || (firstAlbum.title && trk.albumTitle === firstAlbum.title),
                    )
                    const urns = albumTracks.map((trk) => trk.urn)
                    if (urns[0]) {
                      void player?.playNow(urns, {
                        context: { kind: 'album', label: firstAlbum.title ?? t('library:localMusic.localMusic') },
                      })
                    }
                  }
                } else if (currentTrackUrns[0]) {
                  void player?.playNow(currentTrackUrns, {
                    context: {
                      kind: 'local',
                      label:
                        viewMode === 'artists' && selectedArtist
                          ? `${t('library:localMusic.artists')}: ${selectedArtist}`
                          : t('library:localMusic.localMusic'),
                    },
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
                opacity: (viewMode === 'albums' ? sortedAlbums.length === 0 : currentTrackUrns.length === 0) ? 0.5 : 1,
              },
            },
            tablerIcon('play', { size: 22, color: '#FFFFFF' }),
          ),
          // Shuffle button
          h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              accessibilityLabel: t('library:favorites.shuffle'),
              onPress: () => {
                if (currentTrackUrns.length > 0) {
                  const shuffled = [...currentTrackUrns].sort(() => Math.random() - 0.5)
                  void player?.playNow(shuffled, {
                    context: {
                      kind: 'local',
                      label:
                        viewMode === 'artists' && selectedArtist
                          ? `${t('library:localMusic.artists')}: ${selectedArtist}`
                          : t('library:localMusic.localMusic'),
                    },
                  })
                }
              },
              style: { padding: 8 },
            },
            tablerIcon('shuffle', { size: 22, color: c().text.muted }),
          ),
        ),
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
          // Search toggle
          h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              accessibilityLabel: t('library:libraryToolbar.search'),
              onPress: () => setSearchVisible(!searchVisible),
              style: { padding: 8 },
            },
            tablerIcon('search', { size: 20, color: c().text.muted }),
          ),
        ),
      ),
      // Search Input
      searchVisible
        ? h(
            native.View as never,
            { style: { marginTop: tokens.space[2] } },
            h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder:
                viewMode === 'tracks'
                  ? t('library:localMusic.searchLocalFiles')
                  : viewMode === 'albums'
                    ? t('library:localMusic.searchLocalAlbums')
                    : t('library:localMusic.searchLocalArtists'),
              testID: 'local-music-search-input',
            }),
          )
        : null,
    ),
    // Batch Action Bar
    isBatchMode && viewMode !== 'albums'
      ? h(
          native.View as never,
          { style: { paddingHorizontal: tokens.space[4], paddingTop: tokens.space[2] } },
          h(BatchActionBar, {
            ctx,
            selectedCount: selectedUrns.size,
            totalCount: currentTrackUrns.length,
            allSelected,
            onToggleSelectAll: handleToggleSelectAll,
            onBatchPlay: handleBatchPlay,
            onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
            onBatchDelete: handleBatchDelete,
            deleteLabel: t('library:localMusic.delete'),
            onExitBatch: handleExitBatch,
          }),
        )
      : null,
    error ? h(Text, { variant: 'sm', tone: 'error', style: { paddingHorizontal: tokens.space[4] } }, error) : null,
    // Content Views
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      viewMode === 'tracks'
        ? h(List<Track>, {
            testID: 'local-tracks-list',
            items: sortedTracks,
            keyExtractor: (trk) => trk.urn,
            empty: loading
              ? h(EmptyState, { title: t('library:collection.loading') })
              : searchQuery.trim()
                ? h(EmptyState, {
                    icon: 'search',
                    title: t('library:favorites.nothingFound'),
                    description: t('library:localMusic.searchLocalFiles'),
                  })
                : h(EmptyState, {
                    icon: 'folder',
                    title: t('library:localMusic.noLocalMusicYet'),
                    description: t('library:localMusic.afterAddingAMusicFolder'),
                  }),
            renderItem: (trk, index) =>
              h(MobileLibraryTrackRow, {
                ctx,
                track: trk,
                index,
                active: transport?.trackUrn === trk.urn,
                isPlaying: transport?.trackUrn === trk.urn && transport?.status === 'playing',
                compact: trackViewMode === 'compact',
                batchMode: isBatchMode,
                selected: selectedUrns.has(trk.urn),
                onToggleSelect: () => handleToggleSelect(trk.urn),
                inLibrary: isTrackInLibrary(trk),
                highlighted: activeHighlights.has(trk.urn),
                onPress: () =>
                  player?.playFromContext(trk.urn, sortedTrackUrns, {
                    context: { kind: 'local', label: t('library:localMusic.localMusic') },
                  }),
                onMore: (anchor) => menu.open({ track: trk }, anchor),
                onAddToFavorites: () => handleToggleFavorite(trk),
                onHeartPress: (t) => openAddToPlaylistMenu(t, { x: 0, y: 0 }),
                onOpenAlbum: handleOpenAlbum,
              }),
          })
        : viewMode === 'albums'
          ? h(
              native.ScrollView as never,
              {
                testID: 'local-albums-container',
                contentContainerStyle: {
                  flexDirection: albumViewMode === 'tiled' ? 'row' : 'column',
                  flexWrap: albumViewMode === 'tiled' ? 'wrap' : 'nowrap',
                  gap: tokens.space[3],
                  padding: tokens.space[4],
                  paddingBottom: BOTTOM_CHROME_HEIGHT,
                },
              },
              sortedAlbums.length === 0
                ? h(EmptyState, {
                    icon: searchQuery.trim() ? 'search' : 'disc',
                    title: searchQuery.trim()
                      ? t('library:favorites.nothingFound')
                      : t('library:localMusic.noLocalAlbumsYet'),
                    description: searchQuery.trim()
                      ? t('library:localMusic.searchLocalAlbums')
                      : t('library:localMusic.afterAddingALocalMusic'),
                  })
                : sortedAlbums.map((album) =>
                    h(LocalAlbumCard, {
                      key: album.urn,
                      ctx,
                      album,
                      layout: albumViewMode === 'tiled' ? 'grid' : 'list',
                      onOpen: () => ctx.ui.navigate(ALBUM_VIEWS.album, { urn: album.urn }),
                      onPlay: () => {
                        const albumTracks = tracks.filter(
                          (trk) => trk.albumUrn === album.urn || (album.title && trk.albumTitle === album.title),
                        )
                        const urns = albumTracks.map((trk) => trk.urn)
                        if (urns[0]) {
                          void player?.playNow(urns, {
                            context: { kind: 'album', label: album.title ?? t('library:localMusic.localMusic') },
                          })
                        }
                      },
                    }),
                  ),
            )
          : selectedArtist
            ? // Artist detail track list
              h(
                native.View as never,
                { style: { flex: 1 } },
                h(
                  native.Pressable as never,
                  {
                    accessibilityRole: 'button',
                    accessibilityLabel: t('library:localMusic.artists'),
                    onPress: () => setSelectedArtist(null),
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: tokens.space[4],
                      paddingVertical: tokens.space[2],
                    },
                  },
                  h(
                    native.View as never,
                    { style: { transform: [{ rotate: '180deg' }] } },
                    tablerIcon('chevron-right', {
                      size: 16,
                      color: c().text.muted,
                    }),
                  ),
                  h(Text, { variant: 'sm', tone: 'accent' }, t('library:localMusic.artists')),
                ),
                h(List<Track>, {
                  testID: 'local-artist-tracks-list',
                  items: sortedArtistTracks,
                  keyExtractor: (trk) => trk.urn,
                  empty: h(EmptyState, {
                    icon: 'folder',
                    title: t('library:localMusic.noLocalMusicYet'),
                    description: t('library:localMusic.afterAddingAMusicFolder'),
                  }),
                  renderItem: (trk, index) =>
                    h(MobileLibraryTrackRow, {
                      ctx,
                      track: trk,
                      index,
                      active: transport?.trackUrn === trk.urn,
                      isPlaying: transport?.trackUrn === trk.urn && transport?.status === 'playing',
                      compact: trackViewMode === 'compact',
                      batchMode: isBatchMode,
                      selected: selectedUrns.has(trk.urn),
                      onToggleSelect: () => handleToggleSelect(trk.urn),
                      inLibrary: isTrackInLibrary(trk),
                      highlighted: activeHighlights.has(trk.urn),
                      onPress: () =>
                        player?.playFromContext(trk.urn, currentTrackUrns, {
                          context: {
                            kind: 'local',
                            label: `${t('library:localMusic.artists')}: ${selectedArtist}`,
                          },
                        }),
                      onMore: (anchor) => menu.open({ track: trk }, anchor),
                      onAddToFavorites: () => handleToggleFavorite(trk),
                      onHeartPress: (t) => openAddToPlaylistMenu(t, { x: 0, y: 0 }),
                      onOpenAlbum: handleOpenAlbum,
                    }),
                }),
              )
            : // Artist List
              h(List<{ name: string; trackCount: number; artwork?: ArtworkRef }>, {
                testID: 'local-artists-list',
                items: filteredArtists,
                keyExtractor: (a) => a.name,
                empty: h(EmptyState, {
                  icon: 'folder',
                  title: t('library:localMusic.noLocalArtistsYet'),
                  description: t('library:localMusic.afterAddingAMusicFolderArtists'),
                }),
                renderItem: (artist) =>
                  h(LocalArtistRow, {
                    ctx,
                    name: artist.name,
                    trackCount: artist.trackCount,
                    artwork: artist.artwork,
                    onSelect: () => setSelectedArtist(artist.name),
                  }),
              }),
    ),
    // Context Menus & Sheets
    h(ContextMenu, { ctx, ...menu.menuProps }),
    h(SaveToPlaylistSheet, { ctx, menuProps: saveToPlaylistMenuProps }),
    h(ContextMenu, {
      ctx,
      open: headerMenuOpen,
      onClose: () => setHeaderMenuOpen(false),
      placement: 'top-right',
      liquid: liquidGlass,
      x: 0,
      y: 0,
      items: unifiedMenuItems,
      title: t('library:localMusic.localMusic'),
    }),
  )
}
