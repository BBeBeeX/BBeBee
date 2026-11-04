import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  DownloadsService,
  LibraryService,
  PlaylistItem,
  PlaylistDetail,
  Playlist,
  PlayerService,
  SettingsService,
  ShareService,
  SourcesService,
  Track,
} from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings, tryParseUrn } from '@BBeBee/protocol'
import { usePlaylist, useLibraryProfile } from '@bbebee/plugin-library/hooks'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { resolveTrackSourceName, useResolvedArtwork, useTracksByUrn, useTransport } from '@BBeBee/toolkit/hooks'
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

type PlaylistSortKey = 'custom' | 'title' | 'artist' | 'album' | 'source' | 'duration'
type SortOrder = 'asc' | 'desc'
type ViewMode = 'list' | 'compact'

interface PlaylistRowItem {
  item: PlaylistItem
  track: Track
  index: number
}

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
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)

  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )

  const parsedUrn = tryParseUrn(urn ?? '')
  const isThirdPartyUrn = Boolean(parsedUrn && parsedUrn.sourceId && parsedUrn.sourceId !== 'local')

  const state = usePlaylist(ctx, isThirdPartyUrn ? undefined : urn)

  const [thirdPartyData, setThirdPartyData] = useState<{
    detail?: PlaylistDetail
    hasMore: boolean
    cursor?: string
    loading: boolean
    loadingMore: boolean
    error?: Error
  }>({
    hasMore: false,
    loading: isThirdPartyUrn,
    loadingMore: false,
  })

  useEffect(() => {
    if (!urn || !isThirdPartyUrn) return
    let cancelled = false
    setThirdPartyData({ hasMore: false, loading: true, loadingMore: false })

    const fetchFirstPage = async () => {
      try {
        const src = serviceOf<SourcesService>(ctx, 'sources')
        const lib = serviceOf<LibraryService>(ctx, 'library')
        let res: PlaylistDetail | undefined
        if (src && typeof src.getPlaylist === 'function') {
          res = await src.getPlaylist(urn, { limit: 30 })
        }
        if (!res && lib && typeof lib.getPlaylist === 'function') {
          res = await lib.getPlaylist(urn, { limit: 30 })
        }
        if (!cancelled) {
          setThirdPartyData({
            detail: res,
            hasMore: Boolean(res?.hasMore),
            cursor: res?.cursor,
            loading: false,
            loadingMore: false,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setThirdPartyData({
            hasMore: false,
            loading: false,
            loadingMore: false,
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      }
    }

    void fetchFirstPage()
    return () => {
      cancelled = true
    }
  }, [ctx, urn, isThirdPartyUrn])

  const detail = isThirdPartyUrn ? thirdPartyData.detail : state.data

  // Keep full item list; same track may appear at multiple positions
  const rawItems = useMemo(() => {
    return isThirdPartyUrn ? (thirdPartyData.detail?.items ?? []) : (state.data?.items ?? [])
  }, [isThirdPartyUrn, thirdPartyData.detail?.items, state.data?.items])

  const urns = useMemo(() => rawItems.map((item) => item.trackUrn), [rawItems])
  const tracks = useTracksByUrn(ctx, urns)

  // Third party source name
  const sourceId = parsedUrn?.sourceId && parsedUrn.sourceId !== 'local' ? parsedUrn.sourceId : undefined
  const isThirdParty = Boolean(sourceId)
  const sourceRecord = sourceId && typeof sources?.get === 'function' ? sources.get(sourceId) : undefined
  const sourcePlugin = sourceId && typeof sources?.source === 'function' ? sources.source(sourceId) : undefined
  const sourceName = sourcePlugin?.doc?.sourceName || sourceRecord?.displayName || sourceId || ''

  const profile = useLibraryProfile(ctx)
  const creatorName = profile?.name ?? t('library:userProfile.mine')
  const ownerName = isThirdParty && sourceName ? sourceName : (detail?.owner ?? creatorName)

  const [menuOpen, setMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortKey, setSortKey] = useState<PlaylistSortKey>('custom')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())
  const [isSaved, setIsSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const [editingPlaylist, setEditingPlaylist] = useState<(Playlist & { description?: string }) | null>(null)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<DeleteConfirmTarget | null>(null)

  const { isTrackInLibrary, handleToggleFavorite } = useTrackLibraryInfo(ctx)

  // Top-right navigation menu event
  useEffect(() => {
    const off = ctx.on('library/open-header-menu', () => {
      setMenuOpen(true)
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
    const off = ctx.on('library/changed', () => loadSavedState())
    return () => void off()
  }, [ctx, loadSavedState])

  const allRows = useMemo<PlaylistRowItem[]>(() => {
    return rawItems.map((item, index) => {
      const trk = tracks.get(item.trackUrn)
      const track = trk ?? { urn: item.trackUrn, title: item.trackUrn.split(':').pop() ?? item.trackUrn, artists: [] }
      return { item, track, index }
    })
  }, [rawItems, tracks])

  const allTracks = useMemo(() => allRows.map((r) => r.track), [allRows])

  // Filter & sort tracks
  const processedRows = useMemo(() => {
    let list = [...allRows]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(
        ({ track }) =>
          track.title.toLowerCase().includes(q) ||
          track.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
          track.albumTitle?.toLowerCase().includes(q),
      )
    }
    if (sortKey !== 'custom') {
      list.sort((a, b) => {
        let cmp = 0
        if (sortKey === 'title') {
          cmp = a.track.title.localeCompare(b.track.title)
        } else if (sortKey === 'artist') {
          const aArtist = a.track.artists?.[0]?.name ?? ''
          const bArtist = b.track.artists?.[0]?.name ?? ''
          cmp = aArtist.localeCompare(bArtist)
        } else if (sortKey === 'album') {
          cmp = (a.track.albumTitle ?? '').localeCompare(b.track.albumTitle ?? '')
        } else if (sortKey === 'duration') {
          cmp = (a.track.durationMs ?? 0) - (b.track.durationMs ?? 0)
        }
        return sortOrder === 'asc' ? cmp : -cmp
      })
    } else if (sortOrder === 'desc') {
      list.reverse()
    }
    return list
  }, [allRows, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => processedRows.map((r) => r.track.urn), [processedRows])
  const activeTrackUrn = transport?.trackUrn
  const isPlaying = transport?.status === 'playing'

  const play = (trackUrn: string) => {
    if (!detail || !player) return
    void player.playFromContext(trackUrn, sortedUrns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  // Toggle favorite playlist
  const handleToggleSavePlaylist = async () => {
    if (!library || !detail) return
    const next = !isSaved
    setIsSaved(next)
    try {
      await library.setSaved(detail.urn, next)
    } catch {
      setIsSaved(!next)
    }
  }

  // Single item removal
  const handleRemoveItem = (itemId: string) => {
    if (!library || !detail || detail.isSmart) return
    setError(undefined)
    void library.removeItems(detail.urn, [itemId]).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
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
    if (toPlay.length > 0 && player && detail) {
      void player.playNow(toPlay, {
        context: { kind: 'playlist', urn: detail.urn, label: detail.name },
      })
    }
  }

  const handleBatchDownload = () => {
    if (!downloads || !detail) return
    const selectedTracks = processedRows
      .filter((r) => selectedUrns.has(r.track.urn))
      .map((r) => r.track)
    if (selectedTracks.length > 0) {
      void downloads.enqueue(selectedTracks)
      setIsBatchMode(false)
      setSelectedUrns(new Set())
    }
  }

  const handleBatchRemove = () => {
    if (!library || !detail || detail.isSmart) return
    const itemIds = processedRows
      .filter((r) => selectedUrns.has(r.track.urn))
      .map((r) => r.item.id)
    if (itemIds.length > 0) {
      void library.removeItems(detail.urn, itemIds)
      setIsBatchMode(false)
      setSelectedUrns(new Set())
    }
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
      duration: t('library:favorites.duration'),
    }

    const sortChildren: MenuItemSpec[] = (
      ['custom', 'title', 'artist', 'album', 'source', 'duration'] as PlaylistSortKey[]
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
      icon: viewMode === 'list' ? 'layout-list' : 'list',
      submenu: { items: viewChildren },
    })

    items.push({
      id: 'playlist-batch-edit',
      label: isBatchMode ? t('library:favorites.exitBatchOperations') : t('library:favorites.batchOperations'),
      icon: 'checkbox',
      onSelect: () => {
        setIsBatchMode((prev) => !prev)
        setSelectedUrns(new Set())
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
      icon: isSaved ? 'heart-filled' : 'heart',
      onSelect: () => void handleToggleSavePlaylist(),
    })

    if (downloads && processedRows.length > 0) {
      items.push({
        id: 'playlist-download-all',
        label: t('album:index.downloadAll'),
        icon: 'download',
        onSelect: () => void downloads.enqueue(processedRows.map((r) => r.track)),
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
  if (state.status === 'error' || thirdPartyData.error) {
    return h(EmptyState, {
      icon: 'alert',
      title: t('library:playlistDetail.couldNotOpenThePlaylist'),
      description: state.error?.message || thirdPartyData.error?.message,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: t('album:index.backToLibrary') }),
    })
  }
  if (!detail) return h(EmptyState, { title: t('library:collection.loading') })

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
        (detail.isSmart ? t('library:playlist.smartPlaylist') : t('library:playlistDetail.playlist')).toUpperCase(),
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
              disabled: urns.length === 0,
              onPress: () => urns[0] && play(urns[0]),
              style: {
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'var(--color-primary, #5F87FF)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: urns.length === 0 ? 0.5 : 1,
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
              disabled: urns.length === 0,
              onPress: () => {
                if (urns.length > 0 && player) {
                  const shuffled = [...urns].sort(() => Math.random() - 0.5)
                  void player.playNow(shuffled, {
                    context: { kind: 'playlist', urn: detail.urn, label: detail.name },
                  })
                }
              },
              style: { padding: 8, opacity: urns.length === 0 ? 0.5 : 1 },
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
              color: isSaved ? 'var(--color-primary, #5F87FF)' : c().text.muted,
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
              placeholder: t('library:filterAndSort.searchInPlaylist') || 'Search in playlist',
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
              setIsBatchMode(false)
              setSelectedUrns(new Set())
            },
          }),
        )
      : null,
    // Track list
    h(List<PlaylistRowItem>, {
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
      renderItem: ({ item, track, index }) =>
        h(MobileLibraryTrackRow, {
          ctx,
          track,
          index,
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
