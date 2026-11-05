import { createElement as h, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareService } from '@BBeBee/protocol'
import { usePlaylistView, type PlaylistSortKey, type PlaylistViewRow } from '@bbebee/plugin-library/hooks'
import { resolveTrackSourceName, useResolvedArtwork, useTransport } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuAnchor } from '@BBeBee/ui-core'
import { sortMenuItems, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, List, PageMarqueeProvider, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, useImageColor, headerGradient, viewModeMenuItems, useViewMode, useI18n } from '@BBeBee/ui-kit-desktop'
import { formatTotalDuration } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { QuadArtworkCollage } from '../components/QuadArtworkCollage.js'
import { LibraryTrackRow } from '../components/LibraryTrackRow.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { EditPlaylistModal } from '../components/modals/EditPlaylistModal.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const transport = useTransport(ctx)

  const view = usePlaylistView(ctx, urn)
  const {
    detail,
    loading,
    loadingMore,
    hasMore,
    error: viewError,
    rows: filteredRows,
    rawItems,
    tracks,
    isThirdParty,
    sourceName,
    coverArtwork,
    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    searchQuery,
    setSearchQuery,
    batch,
    sortedUrns,
    allSelected,
    toggleSelectAll,
    removeSelectedItems,
    handleLoadMore,
    playTrack,
    playBatch,
  } = view

  const playlistMenu = usePlaylistMenu(ctx)
  const [error, setError] = useState<string | undefined>(undefined)
  const [showEditModal, setShowEditModal] = useState(false)
  const [viewMode, setViewMode] = useViewMode('playlist-detail', 'list', ['compact', 'list'] as const)
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)

  const isBatchMode = batch.isBatchMode
  const selectedUrns = batch.selectedUrns

  // Scroll collapse
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const { isTrackInLibrary, handleAddToFavorites, openAddToPlaylistMenu, openBatchAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  // Theme colour of the background and the sticky bar
  const resolvedCover = useResolvedArtwork(ctx, coverArtwork)
  const tint = useImageColor(resolvedCover?.sourceUrl, resolvedCover?.dominantColor)

  const handleToggleSelectAll = toggleSelectAll
  const handleToggleSelect = (trackUrn: string) => batch.toggleSelect(trackUrn)
  const handleBatchPlay = () => void playBatch()

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const selectedTracks = toAdd.map((u) => tracks.get(u) ?? u)
      openBatchAddToPlaylistMenu(
        selectedTracks,
        anchor ?? { x: typeof window !== 'undefined' ? window.innerWidth / 2 : 200, y: typeof window !== 'undefined' ? window.innerHeight / 2 : 200 },
      )
    }
  }

  const handleBatchDelete = async () => {
    setError(undefined)
    try {
      await removeSelectedItems()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleExitBatch = () => {
    batch.setBatchMode(false)
  }

  const play = (trackUrn: string) => {
    void playTrack(trackUrn)
  }

  const isError = Boolean(viewError)
  const errorMessage = viewError
  const isLoading = loading
  if (!urn) return h(EmptyState, { title: t('library:playlistDetail.noPlaylistChosen') })
  if (isError) {
    return h(EmptyState, { title: t('library:playlistDetail.couldNotOpenThePlaylist'), description: errorMessage })
  }
  if (!detail || isLoading) return h(EmptyState, { title: t('library:collection.loading') })

  const sortLabelMap: Record<PlaylistSortKey, string> = {
    custom: t('library:playlistDetail.customOrder'),
    title: t('library:favorites.title'),
    artist: t('library:favorites.artist'),
    album: t('library:favorites.album'),
    source: t('library:favorites.source'),
    dateAdded: t('library:playlistDetail.dateAdded'),
    duration: t('library:favorites.duration'),
  }

  const handleHeaderClick = (key: PlaylistSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const sortItems = sortMenuItems(
    [
      { id: 'custom', label: t('library:playlistDetail.customOrder') },
      { id: 'title', label: t('library:favorites.title') },
      { id: 'artist', label: t('library:favorites.artist') },
      { id: 'album', label: t('library:favorites.album') },
      { id: 'source', label: t('library:favorites.source') },
      { id: 'dateAdded', label: t('library:playlistDetail.dateAdded') },
      { id: 'duration', label: t('library:favorites.duration') },
    ],
    sortKey,
    (id) => setSortKey(id as PlaylistSortKey),
    { value: sortOrder, onChange: setSortOrder },
    ctx,
  )
  const totalDurationStr = formatTotalDuration(Array.from(tracks.values()))

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(DetailPlayButton, {
      size,
      iconSize,
      testID,
      ariaLabel: t('library:playlistDetail.play'),
      onPress: () => sortedUrns[0] && play(sortedUrns[0]),
      disabled: sortedUrns.length === 0,
    })

  // The sticky bar rides the List's sticky slot (a direct child of the scroller).
  const stickyBar = h(StickyDetailBar, {
    title: detail.name,
    progress: collapse.slide,
    docked: collapse.docked,
    tint,
    playButton: renderPlayButton(48, 24, 'playlist-play-sticky'),
  })

  // The gradient exists only over the header area (scrolling away with the content)
  // and transitions exactly into a solid colour at its bottom edge; the content below
  // and the docked table header are both solid --bg-primary.
  const headerNode = h(
    'div',
    {
      style: { background: headerGradient(tint), position: 'relative' },
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        playlistMenu.open(
          { urn: detail.urn, name: detail.name },
          sortedUrns,
          { x: e.clientX, y: e.clientY },
          {
            isBatchMode,
            onToggleBatchMode: () => {
              batch.setBatchMode(!batch.isBatchMode)
            },
            onBatchPlay: handleBatchPlay,
            onBatchAddToPlaylist: handleBatchAddToPlaylist,
            onBatchDelete: handleBatchDelete,
          },
        )
      },
    },
    isThirdParty && sourceName
      ? h(
          'div',
          {
            'data-testid': 'playlist-source-badge',
            style: {
              position: 'absolute',
              top: 24,
              right: 32,
              padding: '2px 8px',
              fontSize: 12,
              lineHeight: '18px',
              color: 'var(--text-tertiary, #8B95B0)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: 4,
              userSelect: 'none',
              pointerEvents: 'none',
              zIndex: 2,
            },
          },
          sourceName,
        )
      : null,
    h(DetailHero, {
      eyebrow: detail.isPublic !== false ? t('library:playlistDetail.publicPlaylist') : t('library:playlistDetail.playlist'),
      title: detail.name,
      titleSize: detail.name.length > 20 ? 40 : 54,
      onTitleClick: () => setShowEditModal(true),
      description: detail.description,
      cover: h(QuadArtworkCollage, {
        ctx,
        tracks: Array.from(tracks.values()),
        customArtwork: detail.artwork,
        size: 232,
        radius: 6,
        onEdit: () => setShowEditModal(true),
      }),
      meta: h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 14,
            color: 'var(--bb-text-secondary, #b3b3b3)',
            marginTop: 4,
          },
        },
        h(
          'div',
          {
            style: {
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: '#404040',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--bb-text-primary, #FFFFFF)',
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
            },
          },
          (detail.owner?.[0] || 'B').toUpperCase(),
        ),
        h('span', { style: { fontWeight: 700, color: 'var(--bb-text-primary, #FFFFFF)' } }, detail.owner || 'BBeBee'),
        h('span', null, detail.isSmart ? t('library:playlistDetail.smartPlaylist') : t('library:playlistDetail.songCount', { count: detail.trackCount ?? rawItems.length })),
        totalDurationStr ? h('span', null, `, ${totalDurationStr}`) : null,
      ),
    }),
    // Primary Action Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px 14px 32px',
          flexShrink: 0,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 24 } },
        // Collapse anchor: the sticky bar uses this large button's position to decide when to slide in and dock.
        h(
          'div',
          { ref: collapse.anchorRef, style: { display: 'flex' } },
          renderPlayButton(56, 28, 'playlist-play'),
        ),
        h(
          'button',
          {
            type: 'button',
            title: t('library:playlistDetail.download'),
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('download', { size: 24 }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: t('library:playlistDetail.sharePlaylist'),
            'aria-label': t('library:playlistDetail.sharePlaylist'),
            onClick: () => {
              const share = serviceOf<ShareService>(ctx, 'share')
              if (share && detail) {
                const resolvedTracks = Array.from(tracks.values())
                share.sharePlaylist(
                  {
                    urn: detail.urn,
                    name: detail.name,
                    description: detail.description,
                    artwork: resolvedCover?.sourceUrl,
                  },
                  resolvedTracks.length > 0 ? resolvedTracks : undefined,
                )
              }
            },
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--bb-text-primary, #FFFFFF)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--bb-text-secondary, #b3b3b3)'
            },
          },
          tablerIcon('share', { size: 24 }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'playlist-more-trigger',
            title: t('library:expandedLibrary.moreOptions'),
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              playlistMenu.open(
                { urn: detail.urn, name: detail.name },
                sortedUrns,
                { x: rect.left, y: rect.bottom + 6 },
                {
                  isBatchMode,
                  onToggleBatchMode: () => {
                    batch.setBatchMode(!batch.isBatchMode)
                  },
                  onBatchPlay: handleBatchPlay,
                  onBatchAddToPlaylist: handleBatchAddToPlaylist,
                  onBatchDelete: handleBatchDelete,
                },
              )
            },
          },
          tablerIcon('dots', { size: 24 }),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--input-bg, var(--surface-1, rgba(255, 255, 255, 0.1)))',
              border: '1px solid var(--border-subtle, transparent)',
              borderRadius: 16,
              padding: '4px 10px',
              gap: 6,
            },
          },
          tablerIcon('search', { size: 18, color: 'var(--bb-text-secondary, #b3b3b3)' }),
          h('input', {
            type: 'text',
            'data-testid': 'playlist-search-input',
            placeholder: t('library:expandedLibrary.searchInPlaylist'),
            value: searchQuery,
            onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            style: {
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--bb-text-primary, #FFFFFF)',
              fontSize: 13,
              width: 120,
            },
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'playlist-sort-trigger',
            title: t('library:favorites.sortBy'),
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setSortMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
            },
            style: {
              background: 'none',
              border: 'none',
              color: 'var(--bb-text-secondary, #b3b3b3)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: 0,
            },
          },
          h('span', null, sortLabelMap[sortKey]),
          tablerIcon('list', { size: 20 }),
        ),
      ),
    ),
    // Secondary Actions (Capsule Buttons)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 32px 16px 32px',
          flexShrink: 0,
        },
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            const el = document.querySelector('input[data-testid="playlist-search-input"]') as HTMLInputElement | null
            el?.focus()
          },
          style: {
            background: 'transparent',
            border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.2))',
            borderRadius: 20,
            padding: '6px 16px',
            color: 'var(--bb-text-primary, #FFFFFF)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        tablerIcon('plus', { size: 18 }),
        t('library:playlistDetail.add'),
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => setShowEditModal(true),
          style: {
            background: 'transparent',
            border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.2))',
            borderRadius: 20,
            padding: '6px 16px',
            color: 'var(--bb-text-primary, #FFFFFF)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        tablerIcon('pencil', { size: 18 }),
        t('library:editPlaylist.nameAndDetails'),
      ),
    ),
    isBatchMode
      ? h(BatchActionBar, {
          ctx,
          selectedCount: selectedUrns.size,
          totalCount: sortedUrns.length,
          allSelected,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: t('library:playlistDetail.removeFromThisPlaylist'),
          onExitBatch: handleExitBatch,
        })
      : null,
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // The table header rides the stickyHeader slot (a direct child of the scroller) —
  // nested inside the header box, sticky only docks within the parent box, and being
  // the parent box's last child it effectively never docks at all.
  const tableHeaderNode = h(DetailTableHeader, {
    testID: 'playlist-table-header',
    accessibilityLabel: detail.name,
    columns: [
      { key: 'custom', label: '#', testID: 'playlist-sort-custom', width: 40, align: 'center' },
      { key: 'title', label: t('library:favorites.title'), testID: 'playlist-sort-title', flex: 2, paddingLeft: 12 },
      { key: 'artist', label: t('library:favorites.artist'), plain: true, flex: 1, visible: viewMode === 'compact' },
      { key: 'album', label: t('library:favorites.album'), testID: 'playlist-sort-album', flex: 1.5, paddingLeft: 8 },
      { key: 'source', label: t('library:favorites.source'), testID: 'playlist-sort-source', flex: 1, paddingLeft: 8 },
      { key: 'dateAdded', label: t('library:playlistDetail.dateAdded'), testID: 'playlist-sort-dateAdded', flex: 1, paddingLeft: 8 },
      { key: 'duration', label: '', icon: tablerIcon('clock', { size: 18 }), testID: 'playlist-sort-duration', width: 120, align: 'right', paddingRight: 40 },
    ] satisfies DetailColumnSpec[],
    sortKey,
    sortDirection: sortOrder,
    onSort: (key) => handleHeaderClick(key as PlaylistSortKey),
    solid: collapse.docked,
  })

  return h(
    PageMarqueeProvider,
    null,
    h(
      'section',
      {
        'aria-label': detail.name,
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: 'var(--bb-text-primary, #FFFFFF)',
        overflow: 'hidden',
      },
    },
    // Track Rows — the header scrolls away inside the same scroller, and the
    // sticky bar rides on top of it.
    h(
      'div',
      { ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
      h(List<PlaylistViewRow>, {
        testID: 'playlist-tracks',
        header: headerNode,
        sticky: stickyBar,
        stickyHeader: tableHeaderNode,
        onScroll: collapse.handleScroll,
        items: filteredRows,
        pageSize: 30,
        onEndReached: isThirdParty && hasMore && !loadingMore ? handleLoadMore : undefined,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (row) => row.item.id,
        empty: h(EmptyState, {
          icon: 'music',
          title: t('library:playlistDetail.nothingHereYet'),
          description: detail.isSmart
            ? t('library:playlistDetail.noTrackMatchesPlaylistRules')
            : t('library:playlistDetail.addTracksToFill'),
        }),
        renderItem: (row, index) => {
          const { track, item, trackUrn } = row
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          return h(LibraryTrackRow, {
            ctx,
            track,
            index,
            active: transport?.trackUrn === trackUrn,
            isPlaying: transport?.trackUrn === trackUrn && transport?.status === 'playing',
            compact: viewMode === 'compact',
            batchMode: isBatchMode,
            selected: selectedUrns.has(trackUrn),
            onToggleSelect: () => handleToggleSelect(trackUrn),
            showSource: true,
            sourceName: resolveTrackSourceName(ctx, trackUrn),
            onPress: () => play(trackUrn),
            // After unsaving, the row must return to a plus: the heart state follows the live saved set.
            inLibrary: isTrackInLibrary(track),
            onAddToFavorites: handleAddToFavorites,
            addedAt: item.addedAt,
            isSmart: detail.isSmart,
            playlistName: detail.name,
            onRemove: () => {
              setError(undefined)
              void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
            },
            onMore: (anchor) => menu.open({ track, playlistItemId: item.id }, anchor),
            onOpenPlaylistMenu: openAddToPlaylistMenu,
          })
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
    h(ContextMenu, playlistMenu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: viewModeMenuItems(sortItems, viewMode, setViewMode, {}, t),
      title: t('library:favorites.sortBy'),
    }),
    showEditModal
      ? h(EditPlaylistModal, {
          ctx,
          playlist: detail,
          onClose: () => setShowEditModal(false),
          onSave: async (patch) => {
            await ctx.library.updatePlaylist(detail.urn, patch)
            setShowEditModal(false)
          },
        })
      : null,
    ),
  )
}
