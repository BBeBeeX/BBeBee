import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, LibraryService, PlaylistItem, PlaylistDetail, SourcesService, ShareService, Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { usePlaylist } from '@BBeBee/plugin-library/hooks'
import { resolveTrackSourceName, useResolvedArtwork, useTracksByUrn } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuAnchor } from '@BBeBee/ui-core'
import { sortMenuItems, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, useImageColor, headerGradient, viewModeMenuItems, useViewMode } from '@BBeBee/ui-kit-desktop'
import { formatTotalDuration } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { QuadArtworkCollage } from '../components/QuadArtworkCollage.js'
import { LibraryTrackRow } from '../components/LibraryTrackRow.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { EditPlaylistModal } from '../components/modals/EditPlaylistModal.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

type PlaylistSortKey = 'custom' | 'title' | 'artist' | 'album' | 'source' | 'dateAdded' | 'duration'

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const sources = serviceOf<SourcesService>(ctx, 'sources')
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

  const handleLoadMore = useCallback(async () => {
    if (!urn || !isThirdPartyUrn) return
    if (thirdPartyData.loadingMore || !thirdPartyData.hasMore || !thirdPartyData.cursor) return

    setThirdPartyData((prev) => ({ ...prev, loadingMore: true }))
    try {
      const src = serviceOf<SourcesService>(ctx, 'sources')
      const lib = serviceOf<LibraryService>(ctx, 'library')
      let res: PlaylistDetail | undefined
      if (src && typeof src.getPlaylist === 'function') {
        res = await src.getPlaylist(urn, { limit: 30, cursor: thirdPartyData.cursor })
      }
      if (!res && lib && typeof lib.getPlaylist === 'function') {
        res = await lib.getPlaylist(urn, { limit: 30, cursor: thirdPartyData.cursor })
      }
      if (res) {
        setThirdPartyData((prev) => {
          const prevItems = prev.detail?.items ?? []
          const existingUrns = new Set(prevItems.map((it) => it.trackUrn))
          const newItems = (res.items ?? []).filter((it) => !existingUrns.has(it.trackUrn))
          return {
            ...prev,
            detail: prev.detail ? { ...prev.detail, items: [...prevItems, ...newItems] } : res,
            hasMore: Boolean(res.hasMore),
            cursor: res.cursor,
            loadingMore: false,
          }
        })
      } else {
        setThirdPartyData((prev) => ({ ...prev, hasMore: false, loadingMore: false }))
      }
    } catch {
      setThirdPartyData((prev) => ({ ...prev, loadingMore: false }))
    }
  }, [ctx, urn, isThirdPartyUrn, thirdPartyData.cursor, thirdPartyData.hasMore, thirdPartyData.loadingMore])

  const detail = isThirdPartyUrn ? thirdPartyData.detail : state.data
  // 1. 歌曲去重：按 trackUrn 过滤重复项
  const rawItems = useMemo(() => {
    const list = isThirdPartyUrn ? (thirdPartyData.detail?.items ?? []) : (state.data?.items ?? [])
    const seen = new Set<string>()
    return list.filter((item) => {
      if (!item.trackUrn || seen.has(item.trackUrn)) return false
      seen.add(item.trackUrn)
      return true
    })
  }, [isThirdPartyUrn, thirdPartyData.detail?.items, state.data?.items])

  const urns = useMemo(() => rawItems.map((item) => item.trackUrn), [rawItems])
  const tracks = useTracksByUrn(ctx, urns)

  // Identify third party source: only when the playlist itself originates from a third-party source
  const sourceId = parsedUrn?.sourceId && parsedUrn.sourceId !== 'local' ? parsedUrn.sourceId : undefined
  const isThirdParty = Boolean(sourceId)
  const sourceRecord = sourceId && typeof sources?.get === 'function' ? sources.get(sourceId) : undefined
  const sourcePlugin = sourceId && typeof sources?.source === 'function' ? sources.source(sourceId) : undefined
  const sourceName = sourcePlugin?.doc?.sourceName || sourceRecord?.displayName || sourceId || ''

  const playlistMenu = usePlaylistMenu(ctx)
  const [error, setError] = useState<string | undefined>(undefined)
  const [showEditModal, setShowEditModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<PlaylistSortKey>('custom')
  // 视图模式：列表为默认（与历史行为一致），紧凑不显示封面并把艺人单列。
  const [viewMode, setViewMode] = useViewMode('playlist-detail', 'list', ['compact', 'list'] as const)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())

  // 滚动折叠：吸顶栏在播放按钮靠近时从视口上方滑入，滚过按钮一半高度时
  // 把按钮“吸”进吸顶栏（docked），表头吸附在吸顶栏正下方。
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const { isTrackInLibrary, handleAddToFavorites, openAddToPlaylistMenu, openBatchAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  // 背景与吸顶栏的主题色：优先歌单封面，其次第一首歌的封面。
  const coverArtwork: ArtworkRef | undefined =
    detail?.artwork ?? tracks.get(rawItems[0]?.trackUrn ?? '')?.artwork
  const resolvedCover = useResolvedArtwork(ctx, coverArtwork)
  const tint = useImageColor(resolvedCover?.sourceUrl, resolvedCover?.dominantColor)

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = rawItems.map((item, originalIndex) => ({
      item,
      trackUrn: item.trackUrn,
      track: tracks.get(item.trackUrn),
      originalIndex,
    }))

    const matching = q
      ? list.filter(({ track, trackUrn }) => {
          if (!track) return trackUrn.toLowerCase().includes(q)
          return (
            track.title.toLowerCase().includes(q) ||
            track.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            track.albumTitle?.toLowerCase().includes(q)
          )
        })
      : list

    if (sortKey === 'custom') {
      return sortOrder === 'desc' ? [...matching].reverse() : matching
    }

    return [...matching].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = (a.track?.title ?? '').localeCompare(b.track?.title ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'artist') {
        const aArt = a.track?.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.track?.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'album') {
        cmp = (a.track?.albumTitle ?? '').localeCompare(b.track?.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'source') {
        const aSrc = resolveTrackSourceName(ctx, a.trackUrn)
        const bSrc = resolveTrackSourceName(ctx, b.trackUrn)
        cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'dateAdded') {
        cmp = (a.item.addedAt ?? 0) - (b.item.addedAt ?? 0)
      } else if (sortKey === 'duration') {
        cmp = (a.track?.durationMs ?? 0) - (b.track?.durationMs ?? 0)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [rawItems, tracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => filteredRows.map((r) => r.trackUrn), [filteredRows])

  const allSelected = sortedUrns.length > 0 && selectedUrns.size === sortedUrns.length
  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedUrns(new Set())
    } else {
      setSelectedUrns(new Set(sortedUrns))
    }
  }

  const handleToggleSelect = (trackUrn: string) => {
    setSelectedUrns((prev) => {
      const next = new Set(prev)
      if (next.has(trackUrn)) next.delete(trackUrn)
      else next.add(trackUrn)
      return next
    })
  }

  const handleBatchPlay = () => {
    const toPlay = Array.from(selectedUrns)
    if (toPlay.length > 0 && detail) {
      void ctx.player.playNow(toPlay, {
        context: { kind: 'playlist', urn: detail.urn, label: detail.name },
      })
    }
  }

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
    if (!detail || selectedUrns.size === 0) return
    const itemIds = rawItems
      .filter((it) => selectedUrns.has(it.trackUrn))
      .map((it) => it.id)
    if (itemIds.length > 0) {
      setError(undefined)
      try {
        await ctx.library.removeItems(detail.urn, itemIds)
        setSelectedUrns(new Set())
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  const handleExitBatch = () => {
    setIsBatchMode(false)
    setSelectedUrns(new Set())
  }

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, sortedUrns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  const isError = isThirdPartyUrn ? Boolean(thirdPartyData.error) : state.status === 'error'
  const errorMessage = isThirdPartyUrn ? thirdPartyData.error?.message : state.error?.message
  const isLoading = isThirdPartyUrn ? thirdPartyData.loading : state.status === 'loading'
  if (!urn) return h(EmptyState, { title: 'No playlist chosen' })
  if (isError) {
    return h(EmptyState, { title: 'Could not open the playlist', description: errorMessage })
  }
  if (!detail || isLoading) return h(EmptyState, { title: 'Loading…' })

  const sortLabelMap: Record<PlaylistSortKey, string> = {
    custom: '自定义顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    source: '来源',
    dateAdded: '添加日期',
    duration: '时长',
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
      { id: 'custom', label: '自定义顺序' },
      { id: 'title', label: '标题' },
      { id: 'artist', label: '艺人' },
      { id: 'album', label: '专辑' },
      { id: 'source', label: '来源' },
      { id: 'dateAdded', label: '添加日期' },
      { id: 'duration', label: '时长' },
    ],
    sortKey,
    (id) => setSortKey(id as PlaylistSortKey),
    { value: sortOrder, onChange: setSortOrder },
  )
  const totalDurationStr = formatTotalDuration(Array.from(tracks.values()))

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(DetailPlayButton, {
      size,
      iconSize,
      testID,
      ariaLabel: 'Play',
      onPress: () => sortedUrns[0] && play(sortedUrns[0]),
      disabled: sortedUrns.length === 0,
    })

  // 吸顶栏单独走 List 的 sticky 插槽（滚动容器的直接子节点）。
  const stickyBar = h(StickyDetailBar, {
    title: detail.name,
    progress: collapse.slide,
    docked: collapse.docked,
    tint,
    playButton: renderPlayButton(48, 24, 'playlist-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），到底边精确过渡为纯色；下方内容
  // 与吸附后的表头都是纯色 --bg-primary。
  const headerNode = h(
    'div',
    {
      style: { background: headerGradient(tint), position: 'relative' },
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        playlistMenu.open(
          { urn: detail.urn, name: detail.name },
          urns,
          { x: e.clientX, y: e.clientY },
          {
            isBatchMode,
            onToggleBatchMode: () => {
              setIsBatchMode((prev) => !prev)
              setSelectedUrns(new Set())
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
      eyebrow: detail.isPublic !== false ? '公开歌单' : '歌单',
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
            color: '#b3b3b3',
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
        h('span', null, ` • ${detail.isSmart ? '智能歌单' : `${detail.trackCount ?? urns.length} 首歌曲`}`),
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
        // 折叠锚点：吸顶栏按这只大按钮的位置决定滑入与吸附时机。
        h(
          'div',
          { ref: collapse.anchorRef, style: { display: 'flex' } },
          renderPlayButton(56, 28, 'playlist-play'),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '下载',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('download', { size: 24 }),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '分享歌单',
            'aria-label': '分享歌单',
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
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s ease' },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#b3b3b3'
            },
          },
          tablerIcon('share', { size: 24 }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'playlist-more-trigger',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              playlistMenu.open(
                { urn: detail.urn, name: detail.name },
                urns,
                { x: rect.left, y: rect.bottom + 6 },
                {
                  isBatchMode,
                  onToggleBatchMode: () => {
                    setIsBatchMode((prev) => !prev)
                    setSelectedUrns(new Set())
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
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              padding: '4px 10px',
              gap: 6,
            },
          },
          tablerIcon('search', { size: 18, color: '#b3b3b3' }),
          h('input', {
            type: 'text',
            placeholder: '在歌单中搜索',
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
            title: '排序方式',
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setSortMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
            },
            style: {
              background: 'none',
              border: 'none',
              color: '#b3b3b3',
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
            const el = document.querySelector('input[placeholder="在歌单中搜索"]') as HTMLInputElement | null
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
        '添加',
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
        '名称和详情',
      ),
    ),
    isBatchMode
      ? h(BatchActionBar, {
          selectedCount: selectedUrns.size,
          totalCount: sortedUrns.length,
          allSelected,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: '从歌单中删除',
          onExitBatch: handleExitBatch,
        })
      : null,
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）——嵌在 header 盒内时
  // sticky 只在父盒范围吸附，作为父盒最后一个子元素等于完全吸不住。
  const tableHeaderNode = h(DetailTableHeader, {
    testID: 'playlist-table-header',
    accessibilityLabel: detail.name,
    columns: [
      { key: 'custom', label: '#', testID: 'playlist-sort-custom', width: 40, align: 'center' },
      { key: 'title', label: '标题', testID: 'playlist-sort-title', flex: 2, paddingLeft: 12 },
      { key: 'artist', label: '艺人', plain: true, flex: 1, visible: viewMode === 'compact' },
      { key: 'album', label: '专辑', testID: 'playlist-sort-album', flex: 1.5, paddingLeft: 8 },
      { key: 'source', label: '来源', testID: 'playlist-sort-source', flex: 1, paddingLeft: 8 },
      { key: 'dateAdded', label: '添加日期', testID: 'playlist-sort-dateAdded', flex: 1, paddingLeft: 8 },
      { key: 'duration', label: '', icon: tablerIcon('clock', { size: 18 }), testID: 'playlist-sort-duration', width: 120, align: 'right', paddingRight: 40 },
    ] satisfies DetailColumnSpec[],
    sortKey,
    sortDirection: sortOrder,
    onSort: (key) => handleHeaderClick(key as PlaylistSortKey),
    solid: collapse.docked,
  })

  return h(
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
      h(List<{ item: PlaylistItem; trackUrn: string; track?: Track; originalIndex: number }>, {
        testID: 'playlist-tracks',
        header: headerNode,
        sticky: stickyBar,
        stickyHeader: tableHeaderNode,
        onScroll: collapse.handleScroll,
        items: filteredRows,
        pageSize: 30,
        onEndReached: isThirdPartyUrn && thirdPartyData.hasMore && !thirdPartyData.loadingMore ? handleLoadMore : undefined,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (row) => row.item.id,
        empty: h(EmptyState, {
          icon: 'music',
          title: 'Nothing here yet',
          description: detail.isSmart
            ? 'No track in the catalogue matches this playlist\'s rules right now.'
            : 'Add tracks from the library to fill this playlist.',
        }),
        renderItem: (row, index) => {
          const { track, item, trackUrn } = row
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          return h(LibraryTrackRow, {
            ctx,
            track,
            index,
            compact: viewMode === 'compact',
            batchMode: isBatchMode,
            selected: selectedUrns.has(trackUrn),
            onToggleSelect: () => handleToggleSelect(trackUrn),
            showSource: true,
            sourceName: resolveTrackSourceName(ctx, trackUrn),
            onPress: () => play(trackUrn),
            // 取消收藏后那一行要回到加号：心形状态跟着实时收藏集合走。
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
      items: viewModeMenuItems(sortItems, viewMode, setViewMode),
      title: '排序方式',
    }),
    showEditModal
      ? h(EditPlaylistModal, {
          playlist: detail,
          onClose: () => setShowEditModal(false),
          onSave: async (patch) => {
            await ctx.library.updatePlaylist(detail.urn, patch)
            setShowEditModal(false)
          },
        })
      : null,
  )
}
