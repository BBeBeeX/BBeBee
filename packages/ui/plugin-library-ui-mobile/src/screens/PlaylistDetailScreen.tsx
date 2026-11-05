import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  DownloadsService,
  LibraryService,
  Playlist,
  PlayerService,
  SettingsService,
  ShareService,
  UrnKind,
} from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { usePlaylistView, useLibraryProfile, type PlaylistSortKey, type PlaylistViewRow } from '@bbebee/plugin-library/hooks'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { resolveTrackSourceName, useResolvedArtwork, useTransport } from '@BBeBee/toolkit/hooks'
import { formatTotalDuration } from '@BBeBee/toolkit'
import { serviceOf, type MenuItemSpec } from '@BBeBee/ui-core'
import { useSaveToPlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
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
import { tokens } from '@BBeBee/ui-tokens'
import { HeaderGradient } from '../components/HeaderGradient.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { MobileLibraryTrackRow } from '../components/MobileLibraryTrackRow.js'
import { SaveToPlaylistSheet } from '../components/SaveToPlaylistSheet.js'
import { QuadArtworkCollage } from '../components/QuadArtworkCollage.js'
import { LibraryModals } from '../components/LibraryModals.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import type { DeleteConfirmTarget } from '../hooks/useLibraryActions.js'

type ViewMode = 'list' | 'compact'

export function PlaylistDetailScreen({
  ctx,
  urn,
  onBack,
}: {
  ctx: Context
  urn?: string
  onBack?: () => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const transport = useTransport(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const library = serviceOf<LibraryService>(ctx, 'library')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const shareService = serviceOf<ShareService>(ctx, 'share')
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)

  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )

  const view = usePlaylistView(ctx, urn)
  const {
    detail,
    rows: processedRows,
    rawItems,
    isThirdParty,
    sourceName,
    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    searchQuery,
    setSearchQuery,
    batch,
    sortedUrns,
    toggleSelectAll,
    removeSelectedItems,
    removeSingleItem,
    playTrack,
    playBatch,
  } = view

  const profile = useLibraryProfile(ctx)
  const creatorName = profile?.name ?? t('library:userProfile.mine')
  const ownerName = isThirdParty && sourceName ? sourceName : (detail?.owner ?? creatorName)

  const [menuOpen, setMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const isBatchMode = batch.isBatchMode
  const selectedUrns = batch.selectedUrns
  const [isSaved, setIsSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const [editingPlaylist, setEditingPlaylist] = useState<(Playlist & { description?: string }) | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<DeleteConfirmTarget | null>(null)

  const { isTrackInLibrary, handleToggleFavorite } = useTrackLibraryInfo(ctx)

  // Top-right navigation menu event
  useEffect(() => {
    const off = ctx.on('library/open-header-menu', (targetId?: string) => {
      if (!targetId || targetId === 'library.playlist' || targetId === LIBRARY_VIEWS.playlist) {
        setMenuOpen(true)
      }
    })
    return () => {
      off()
    }
  }, [ctx])

  // Resolve artwork & dominant color
  const resolvedCover = useResolvedArtwork(ctx, detail?.artwork)
  const dominantTint = (resolvedCover as { dominantColor?: string } | undefined)?.dominantColor

  // Saved playlist status
  const loadSavedState = useCallback(() => {
    const playlistUrn = detail?.urn
    if (!library || !playlistUrn) return
    library
      .isSaved(playlistUrn)
      .then((saved) => setIsSaved(saved))
      .catch(() => {})
  }, [library, detail?.urn])

  useEffect(() => {
    loadSavedState()
    const off = ctx.on('library/changed', (kind?: UrnKind) => {
      if (!kind || kind === 'playlist') {
        loadSavedState()
      }
    })
    return () => void off()
  }, [ctx, loadSavedState])

  const allTracks = useMemo(() => processedRows.map((r) => r.track), [processedRows])
  const activeTrackUrn = transport?.trackUrn
  const isPlaying = transport?.status === 'playing'

  const play = (trackUrn: string) => {
    void playTrack(trackUrn)
  }

  // Toggle favorite playlist
  const handleToggleSavePlaylist = async () => {
    if (!library || !detail) return
    const next = !isSaved
    setIsSaved(next)
    ctx.emit('ui/toast', {
      message: next
        ? t('album:index.addedToLibrary')
        : t('album:index.removedFromLibrary'),
      tone: 'info',
    })
    try {
      await library.setSaved(detail.urn, next)
    } catch {
      setIsSaved(!next)
    }
  }

  // Single item removal
  const handleRemoveItem = (itemId: string) => {
    setError(undefined)
    void removeSingleItem(itemId).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }

  // Batch operations
  const handleToggleSelectAll = toggleSelectAll

  const handleToggleSelect = (trackUrn: string) => {
    batch.toggleSelect(trackUrn)
  }

  const handleBatchPlay = () => {
    void playBatch()
  }

  const handleBatchDownload = () => {
    if (!downloads || !detail) return
    const selectedTracks = processedRows
      .filter((r) => selectedUrns.has(r.track.urn))
      .map((r) => r.track)
    if (selectedTracks.length > 0) {
      ctx.emit('ui/toast', {
        message: t('album:index.queuedForDownload'),
        tone: 'info',
      })
      void downloads.enqueue(selectedTracks)
      batch.setBatchMode(false)
    }
  }

  const handleBatchRemove = () => {
    setError(undefined)
    void removeSelectedItems().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }

  const handleBack = () => {
    if (onBack) onBack()
    else serviceOf<{ navigate(id: string): void }>(ctx, 'ui')?.navigate(LIBRARY_VIEWS.home)
  }

  // Consolidated Top-Right Menu items
  const menuItems = useMemo<MenuItemSpec[]>(() => {
    const items: MenuItemSpec[] = []

    const sortLabels: Record<PlaylistSortKey, string> = {
      custom: t('library:playlistDetail.customOrder'),
      title: t('library:favorites.title'),
      artist: t('library:favorites.artist'),
      album: t('library:favorites.album'),
      source: t('library:favorites.source'),
      dateAdded: t('library:playlistDetail.dateAdded'),
      duration: t('library:favorites.duration'),
    }

    const sortChildren: MenuItemSpec[] = (
      ['custom', 'title', 'artist', 'album', 'source', 'dateAdded', 'duration'] as PlaylistSortKey[]
    ).map((key) => ({
      id: `sort-${key}`,
      label: sortLabels[key],
      icon: sortKey === key ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
      onSelect: () => setSortKey(key),
    }))

    sortChildren.push(
      {
        id: 'sort-asc',
        label: t('app:common.menu.ascending') || 'Ascending',
        divider: true,
        icon: sortOrder === 'asc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortOrder('asc'),
      },
      {
        id: 'sort-desc',
        label: t('app:common.menu.descending') || 'Descending',
        icon: sortOrder === 'desc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
        onSelect: () => setSortOrder('desc'),
      },
    )

    items.push({
      id: 'playlist-sort',
      label: t('library:favorites.sortBy'),
      icon: 'arrows-sort',
      submenu: { items: sortChildren },
    })

    const viewChildren: MenuItemSpec[] = [
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

    items.push({
      id: 'playlist-view-mode',
      label: t('app:common.viewMode.viewMode') || 'View mode',
      icon: 'list',
      submenu: { items: viewChildren },
    })

    items.push({
      id: 'playlist-batch-edit',
      label: isBatchMode ? t('library:favorites.exitBatchOperations') : t('library:favorites.batchOperations'),
      icon: 'list-check',
      onSelect: () => {
        batch.setBatchMode(!batch.isBatchMode)
      },
    })

    if (detail && !detail.isSmart && !isThirdParty) {
      items.push({
        id: 'playlist-edit',
        label: t('library:editPlaylist.editDetails') || 'Edit details',
        icon: 'pencil',
        onSelect: () => setEditingPlaylist(detail),
      })
      items.push({
        id: 'playlist-delete',
        label: t('library:confirmDelete.deletePlaylist') || 'Delete playlist',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => setConfirmDeleteTarget({ type: 'playlist', urn: detail.urn, name: detail.name }),
      })
    }

    items.push({
      id: 'playlist-toggle-save',
      label: isSaved
        ? t('album:index.removeFromMusicLibrary')
        : t('album:index.addToMusicLibrary'),
      icon: isSaved ? (tablerIcon('heart-filled', { size: 20, color: '#E53935' }) ?? '❤️') : 'heart',
      onSelect: () => void handleToggleSavePlaylist(),
    })

    if (downloads && processedRows.length > 0) {
      items.push({
        id: 'playlist-download-all',
        label: t('album:index.downloadAll'),
        icon: 'download',
        onSelect: () => {
          ctx.emit('ui/toast', {
            message: t('album:index.queuedForDownload'),
            tone: 'info',
          })
          void downloads.enqueue(processedRows.map((r) => r.track))
        },
      })
    }

    if (shareService && detail) {
      items.push({
        id: 'playlist-share',
        label: t('app:common.share') || 'Share',
        icon: 'share',
        onSelect: () => {
          shareService.sharePlaylist(
            {
              urn: detail.urn,
              name: detail.name,
            },
            processedRows.map((r) => r.track),
          )
        },
      })
    }

    return items
  }, [
    sortKey,
    sortOrder,
    viewMode,
    isBatchMode,
    detail,
    isThirdParty,
    isSaved,
    downloads,
    shareService,
    processedRows,
    rawItems.length,
    t,
  ])

  if (!urn) return h(EmptyState, { title: t('library:playlistDetail.noPlaylistChosen') })
  if (view.error) {
    return h(EmptyState, {
      icon: 'alert',
      title: t('library:playlistDetail.couldNotOpenThePlaylist'),
      description: view.error,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: t('album:index.backToLibrary') }),
    })
  }
  if (!detail || view.loading) return h(EmptyState, { title: t('library:collection.loading') })

  const totalDurationStr = formatTotalDuration(allTracks)

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: c().bg.base,
      },
      accessibilityLabel: detail.name,
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
        (detail.isSmart
          ? (t('library:library.smartPlaylist') || 'Smart playlist')
          : (t('library:playlistDetail.playlist') || 'Playlist')
        ).toUpperCase(),
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
        h(QuadArtworkCollage, {
          ctx,
          tracks: allTracks,
          customArtwork: detail.artwork,
          size: 100,
          radius: tokens.radius.md,
        }),
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
            detail.name,
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
              ownerName?.[0]?.toUpperCase()
                ? h(
                    Text,
                    { style: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' } },
                    ownerName[0]!.toUpperCase(),
                  )
                : (tablerIcon('music', { size: 12, color: '#FFFFFF' }) ??
                    h(Text, { style: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' } }, '♪')),
            ),
            h(
              Text,
              { variant: 'sm', tone: 'muted', numberOfLines: 1, style: { flexShrink: 1 } },
              ownerName,
            ),
          ),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            detail.isSmart
              ? t('library:playlistDetail.smartPlaylistDescription')
              : `${(detail.trackCount ?? rawItems.length) === 1 ? t('library:playlistDetail.tracksOne', { count: detail.trackCount ?? rawItems.length }) : t('library:playlistDetail.tracksOther', { count: detail.trackCount ?? rawItems.length })}${totalDurationStr ? `, ${totalDurationStr}` : ''}`,
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
              testID: 'playlist-play',
              accessibilityRole: 'button',
              accessibilityLabel: t('library:playlistDetail.play'),
              disabled: sortedUrns.length === 0,
              onPress: () => sortedUrns[0] && play(sortedUrns[0]),
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
              testID: 'playlist-shuffle',
              accessibilityRole: 'button',
              accessibilityLabel: t('album:index.shuffle'),
              disabled: sortedUrns.length === 0,
              onPress: () => {
                if (sortedUrns.length > 0 && player) {
                  const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                  void player.playNow(shuffled, {
                    context: { kind: 'playlist', urn: detail.urn, label: detail.name },
                  })
                }
              },
              style: { padding: 8, opacity: sortedUrns.length === 0 ? 0.5 : 1 },
            },
            tablerIcon('shuffle', { size: 22, color: c().text.muted }),
          ),
          // Save playlist heart
          h(
            native.Pressable as never,
            {
              testID: 'playlist-heart-trigger',
              accessibilityRole: 'button',
              accessibilityLabel: isSaved
                ? t('album:index.removeFromMusicLibrary')
                : t('album:index.addToMusicLibrary'),
              onPress: () => void handleToggleSavePlaylist(),
              style: { padding: 8 },
            },
            tablerIcon(isSaved ? 'heart-filled' : 'heart', {
              size: 22,
              color: isSaved ? '#E53935' : c().text.muted,
            }),
          ),
          // Download all
          downloads
            ? h(
                native.Pressable as never,
                {
                  testID: 'playlist-download-all',
                  accessibilityRole: 'button',
                  accessibilityLabel: t('album:index.downloadAll'),
                  disabled: processedRows.length === 0,
                  onPress: () => void downloads.enqueue(processedRows.map((r) => r.track)),
                  style: { padding: 8, opacity: processedRows.length === 0 ? 0.5 : 1 },
                },
                tablerIcon('download', { size: 22, color: c().text.muted }),
              )
            : null,
          // Share
          shareService
            ? h(
                native.Pressable as never,
                {
                  testID: 'playlist-share-btn',
                  accessibilityRole: 'button',
                  accessibilityLabel: t('app:common.share') || 'Share',
                  onPress: () => {
                    shareService.sharePlaylist(
                      {
                        urn: detail.urn,
                        name: detail.name,
                      },
                      processedRows.map((r) => r.track),
                    )
                  },
                  style: { padding: 8 },
                },
                tablerIcon('share', { size: 22, color: c().text.muted }),
              )
            : null,
          // Edit (if local non-smart)
          !detail.isSmart && !isThirdParty
            ? h(
                native.Pressable as never,
                {
                  testID: 'playlist-edit-btn',
                  accessibilityRole: 'button',
                  accessibilityLabel: t('library:editPlaylist.editDetails') || 'Edit details',
                  onPress: () => setEditingPlaylist(detail),
                  style: { padding: 8 },
                },
                tablerIcon('pencil', { size: 20, color: c().text.muted }),
              )
            : null,
        ),
        // Search trigger
        h(
          native.Pressable as never,
          {
            testID: 'playlist-search-trigger',
            accessibilityRole: 'button',
            accessibilityLabel: 'Search tracks',
            onPress: () => setIsSearchOpen((prev) => !prev),
            style: { padding: 8 },
          },
          tablerIcon('search', {
            size: 20,
            color: isSearchOpen ? c().accent.base : c().text.muted,
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
              placeholder: t('library:expandedLibrary.searchInPlaylist') || '在歌单中搜索',
            }),
          )
        : null,
    ),
    error ? h(Text, { variant: 'sm', tone: 'error', style: { paddingHorizontal: tokens.space[4] } }, error) : null,
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
            onBatchDelete: !detail.isSmart && !isThirdParty ? handleBatchRemove : undefined,
            onExitBatch: () => {
              batch.setBatchMode(false)
            },
          }),
        )
      : null,
    // Track list
    h(List<PlaylistViewRow>, {
      items: processedRows,
      testID: 'playlist-tracks',
      accessibilityLabel: detail.name,
      estimatedItemSize: viewMode === 'compact' ? 42 : 56,
      keyExtractor: ({ item, track }, index) => `${item.id ?? track.urn}:${index}`,
      empty: h(EmptyState, {
        icon: 'music',
        title: t('library:playlistDetail.nothingHereYet'),
        description: detail.isSmart
          ? t('library:playlistDetail.noTrackMatchesTheseRules')
          : t('library:playlistDetail.addTracksToFill'),
      }),
      renderItem: ({ item, track, originalIndex }) =>
        h(MobileLibraryTrackRow, {
          ctx,
          track,
          index: originalIndex,
          active: track.urn === activeTrackUrn,
          isPlaying: track.urn === activeTrackUrn && isPlaying,
          inLibrary: isTrackInLibrary(track),
          compact: viewMode === 'compact',
          batchMode: isBatchMode,
          selected: selectedUrns.has(track.urn),
          onToggleSelect: () => handleToggleSelect(track.urn),
          showSource: true,
          sourceName: resolveTrackSourceName(ctx, track.urn),
          isSmart: detail.isSmart,
          playlistName: detail.name,
          onPress: () => {
            if (isBatchMode) {
              handleToggleSelect(track.urn)
            } else {
              play(track.urn)
            }
          },
          onAddToFavorites: (t) => void handleToggleFavorite(t),
          onHeartPress: (t) => saveToPlaylistMenu.open(t, { x: 0, y: 0 }),
          onRemove: !detail.isSmart && !isThirdParty ? () => handleRemoveItem(item.id) : undefined,
          onMore: (anchor) => {
            menu.open({ track, playlistItemId: item.id }, anchor)
          },
        }),
    }),
    // Track row ContextMenu
    h(ContextMenu, {
      ctx,
      ...menu.menuProps,
      liquid: liquidGlass,
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
    // Save to playlist sheet for track hearts & batch operations
    h(SaveToPlaylistSheet, {
      ctx,
      menuProps: saveToPlaylistMenu.menuProps,
    }),
    // Edit & Delete modals
    h(LibraryModals, {
      ctx,
      showCreatePlaylistModal: false,
      setShowCreatePlaylistModal: () => {},
      onCreatePlaylist: () => {},
      showCreateCollectionModal: false,
      setShowCreateCollectionModal: () => {},
      onCreateCollection: () => {},
      editingPlaylist,
      setEditingPlaylist,
      onUpdatePlaylist: async (patch) => {
        if (!library || !detail) return
        await library.updatePlaylist(detail.urn, patch)
        setEditingPlaylist(null)
      },
      renamingCollection: null,
      setRenamingCollection: () => {},
      onRenameCollection: async () => {},
      createInFolderModal: null,
      setCreateInFolderModal: () => {},
      onCreateInFolder: async () => {},
      confirmDeleteTarget,
      setConfirmDeleteTarget,
      onConfirmDelete: async () => {
        if (!library || !detail) return
        await library.deletePlaylist(detail.urn)
        setConfirmDeleteTarget(null)
        handleBack()
      },
    }),
  )
}
