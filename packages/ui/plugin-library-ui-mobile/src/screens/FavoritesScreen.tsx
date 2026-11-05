import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, PlayerService, SettingsService, SourcesService, Track } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { useFavoritesView } from '@bbebee/plugin-library/hooks'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { resolveTrackSourceName, useTransport } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
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
import { MobileLibraryTrackRow } from '../components/MobileLibraryTrackRow.js'
import { SaveToPlaylistSheet } from '../components/SaveToPlaylistSheet.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'


/** Favorites theme tint colour: purple gradient for "Liked songs". */
const FAVORITES_TINT = '#450af5'

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const transport = useTransport(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const favorites = useFavoritesView(ctx)
  const {
    tracks: allTracks,
    loading,
    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    filteredTracks: sortedTracks,
    sortedUrns,
    searchQuery,
    setSearchQuery,
    batch,
  } = favorites

  const isBatchMode = batch.isBatchMode
  const setIsBatchMode = batch.setIsBatchMode
  const selectedUrns = batch.selectedUrns
  const allSelected = batch.isAllSelected(sortedUrns)

  const [searchVisible, setSearchVisible] = useState(false)
  const [viewMode, setViewMode] = useState<'compact' | 'list'>('list')
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)

  useEffect(() => {
    const off = ctx.on('library/open-header-menu', (targetId?: string) => {
      if (!targetId || targetId === 'library.favorites' || targetId === LIBRARY_VIEWS.favorites) {
        setHeaderMenuOpen(true)
      }
    })
    return () => void off()
  }, [ctx])

  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleToggleFavorite,
    openBatchAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)

  const handleToggleSelectAll = () => {
    if (allSelected) {
      batch.clearSelection()
    } else {
      batch.selectAll(sortedUrns)
    }
  }

  const handleToggleSelect = (urn: string) => {
    batch.toggleSelect(urn)
  }

  const handleBatchPlay = () => {
    const toPlay = Array.from(selectedUrns)
    if (toPlay.length > 0) {
      void player?.playNow(toPlay, {
        context: { kind: 'favorites', label: t('library:favorites.favorites') },
      })
    }
  }

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const trackMap = new Map(allTracks.map((t) => [t.urn, t]))
      const selectedTracks = toAdd.map((u) => trackMap.get(u) ?? u)
      openBatchAddToPlaylistMenu(selectedTracks, anchor ?? { x: 200, y: 200 })
    }
  }

  const handleBatchDelete = async () => {
    const toDelete = Array.from(selectedUrns)
    if (toDelete.length === 0) return
    const library = serviceOf<LibraryService>(ctx, 'library')
    const sources = serviceOf<SourcesService>(ctx, 'sources')
    for (const u of toDelete) {
      if (sources?.setLoved) {
        await sources.setLoved(u, false).catch(() => {})
      }
      if (library) {
        await library.setSaved(u, false).catch(() => {})
      }
    }
    batch.clearSelection()
  }

  const handleExitBatch = () => {
    batch.setBatchMode(false)
  }

  const unifiedMenuItems: MenuItemSpec[] = useMemo(() => {
    const actionItems: MenuItemSpec[] = isBatchMode
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
            label: t('library:favorites.removeFromFavorites'),
            icon: 'trash',
            tone: 'danger',
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
      : [
          {
            id: 'batch-operations',
            label: t('library:favorites.batchOperations'),
            icon: 'list-check',
            divider: true,
            onSelect: () => setIsBatchMode(true),
          },
        ]

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
        label: t('library:favorites.defaultOrder'),
        icon: sortKey === 'default' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('default'),
      },
      {
        id: 'sort-title',
        label: t('library:favorites.title'),
        icon: sortKey === 'title' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('title'),
      },
      {
        id: 'sort-artist',
        label: t('library:favorites.artist'),
        icon: sortKey === 'artist' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('artist'),
      },
      {
        id: 'sort-album',
        label: t('library:favorites.album'),
        icon: sortKey === 'album' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('album'),
      },
      {
        id: 'sort-source',
        label: t('library:favorites.source'),
        icon: sortKey === 'source' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortKey('source'),
      },
      {
        id: 'sort-duration',
        label: t('library:favorites.duration'),
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
        label: t('library:favorites.sortBy') || 'Sort',
        icon: 'shuffle',
        submenu: {
          title: t('library:favorites.sortBy') || 'Sort',
          items: sortSubmenuItems,
        },
      },
    ]
  }, [isBatchMode, selectedUrns, sortedUrns, viewMode, sortKey, sortOrder, t])

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: c().bg.base,
      },
      accessibilityLabel: t('library:favorites.likedSongs'),
    },
    // Header Hero area
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
      h(HeaderGradient, { tint: FAVORITES_TINT }),
      // Eyebrow
      h(
        Text,
        { variant: 'xs', style: { letterSpacing: 1, opacity: 0.85, fontWeight: tokens.font.weight.bold } },
        t('library:playlistDetail.playlist').toUpperCase(),
      ),
      // Title
      h(Text, { variant: 'xl', numberOfLines: 1, style: { fontSize: 28, fontWeight: tokens.font.weight.heavy } }, t('library:favorites.likedSongs')),
      // Subtitle
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        allTracks.length === 1
          ? t('library:favorites.savedMusicOne', { length: allTracks.length })
          : t('library:favorites.savedMusicOther', { length: allTracks.length }),
      ),
      // Action Bar: Play + Shuffle ... Search (old more & sort moved to unified 3-dots menu)
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
              testID: 'favorites-play',
              accessibilityRole: 'button',
              accessibilityLabel: t('library:favorites.playAll'),
              disabled: sortedUrns.length === 0,
              onPress: () =>
                sortedUrns[0] &&
                player?.playFromContext(sortedUrns[0], sortedUrns, {
                  context: { kind: 'favorites', label: t('library:favorites.favorites') },
                }),
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
              accessibilityRole: 'button',
              accessibilityLabel: t('library:favorites.shuffle'),
              onPress: () => {
                if (sortedUrns.length > 0) {
                  const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                  if (shuffled[0]) {
                    void player?.playFromContext(shuffled[0], shuffled, {
                      context: { kind: 'favorites', label: t('library:favorites.favorites') },
                    })
                  }
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
      // Search input bar
      searchVisible
        ? h(
            native.View as never,
            { style: { marginTop: tokens.space[2] } },
            h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: t('library:favorites.searchInLikedSongs'),
              testID: 'favorites-search-input',
            }),
          )
        : null,
    ),
    // Batch Action Bar
    isBatchMode
      ? h(
          native.View as never,
          { style: { paddingHorizontal: tokens.space[4], paddingTop: tokens.space[2] } },
          h(BatchActionBar, {
            ctx,
            selectedCount: selectedUrns.size,
            totalCount: sortedUrns.length,
            allSelected,
            onToggleSelectAll: handleToggleSelectAll,
            onBatchPlay: handleBatchPlay,
            onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
            onBatchDelete: handleBatchDelete,
            deleteLabel: t('library:favorites.removeFromFavorites'),
            onExitBatch: handleExitBatch,
          }),
        )
      : null,
    // Content / List
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<Track>, {
        testID: 'favorites-list',
        items: sortedTracks,
        keyExtractor: (trk) => trk.urn,
        empty:
          loading
            ? h(EmptyState, { title: t('library:collection.loading') })
            : h(EmptyState, {
                icon: 'heart',
                title: t('library:favorites.noLikedSongsYet'),
                description: t('library:favorites.afterSavingSongsInThe'),
              }),
        renderItem: (trk, index) =>
          h(MobileLibraryTrackRow, {
            ctx,
            track: trk,
            index,
            active: transport?.trackUrn === trk.urn,
            isPlaying: transport?.trackUrn === trk.urn && transport?.status === 'playing',
            batchMode: isBatchMode,
            selected: selectedUrns.has(trk.urn),
            onToggleSelect: () => handleToggleSelect(trk.urn),
            showSource: true,
            sourceName: resolveTrackSourceName(ctx, trk.urn),
            inLibrary: isTrackInLibrary(trk),
            hideHeart: true,
            compact: viewMode === 'compact',
            onPress: () =>
              player?.playFromContext(trk.urn, sortedUrns, {
                context: { kind: 'favorites', label: t('library:favorites.favorites') },
              }),
            onMore: (anchor) => menu.open({ track: trk }, anchor),
            onAddToFavorites: () => handleToggleFavorite(trk),
          }),
      }),
    ),
    // Menus & Sheets
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
      title: t('library:favorites.likedSongs'),
    }),
  )
}
