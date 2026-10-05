import { createElement as h, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, PlayerService, SourcesService, Track } from '@BBeBee/protocol'
import { useSaved } from '@BBeBee/plugin-library/hooks'
import { resolveTrackSourceName, useTracksByUrn } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { sortMenuItems, useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, headerGradient, viewModeMenuItems, useViewMode } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { LibraryTrackRow } from '../components/LibraryTrackRow.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

type FavoriteSortKey = 'default' | 'title' | 'artist' | 'album' | 'source' | 'duration'

/** 收藏夹没有封面：Spotify 给“已点赞的歌曲”的固定紫色就是它的主题色。 */
const FAVORITES_TINT = '#450af5'

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const rawUrns = useMemo(() => entries.map((entry) => entry.urn), [entries])
  // 1. 歌曲去重：过滤重复的 URN
  const urns = useMemo(() => {
    const seen = new Set<string>()
    return rawUrns.filter((u) => {
      if (!u || seen.has(u)) return false
      seen.add(u)
      return true
    })
  }, [rawUrns])

  const tracksMap = useTracksByUrn(ctx, urns)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const error = saved.error?.message
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<FavoriteSortKey>('default')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<MenuAnchor | null>(null)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())

  // 滚动折叠：吸顶栏在播放按钮靠近时滑入，滚过按钮一半高度时吸附（docked）。
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  // 视图模式：列表为默认（与历史行为一致），紧凑不显示封面并把艺人单列。
  const [viewMode, setViewMode] = useViewMode('favorites', 'list', ['compact', 'list'] as const)
  const menu = useTrackMenu(ctx)
  const { isTrackInLibrary, handleAddToFavorites, openAddToPlaylistMenu, openBatchAddToPlaylistMenu, saveToPlaylistMenuProps } = useTrackLibraryInfo(ctx)

  const allTracks = useMemo(() => {
    const seen = new Set<string>()
    const list: Track[] = []
    for (const urn of urns) {
      const t = tracksMap.get(urn) ?? { urn, title: urn.split(':').pop() ?? urn, artists: [] }
      if (!seen.has(t.urn)) {
        seen.add(t.urn)
        list.push(t)
      }
    }
    return list
  }, [urns, tracksMap])

  const sortedTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? allTracks.filter((t) => {
          return (
            t.title.toLowerCase().includes(q) ||
            t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            t.albumTitle?.toLowerCase().includes(q)
          )
        })
      : [...allTracks]

    if (sortKey === 'default') {
      return sortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'album') {
        cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (sortKey === 'source') {
        const aSrc = resolveTrackSourceName(ctx, a.urn)
        const bSrc = resolveTrackSourceName(ctx, b.urn)
        cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
  }, [allTracks, searchQuery, sortKey, sortOrder])

  const sortedUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])

  const sortLabelMap: Record<FavoriteSortKey, string> = {
    default: '默认顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    source: '来源',
    duration: '时长',
  }

  const sortItems = sortMenuItems(
    [
      { id: 'default', label: '默认顺序' },
      { id: 'title', label: '标题' },
      { id: 'artist', label: '艺人' },
      { id: 'album', label: '专辑' },
      { id: 'source', label: '来源' },
      { id: 'duration', label: '时长' },
    ],
    sortKey,
    (id) => setSortKey(id as FavoriteSortKey),
    { value: sortOrder, onChange: setSortOrder },
  )

  const handleHeaderClick = (key: FavoriteSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const allSelected = sortedUrns.length > 0 && selectedUrns.size === sortedUrns.length
  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedUrns(new Set())
    } else {
      setSelectedUrns(new Set(sortedUrns))
    }
  }

  const handleToggleSelect = (urn: string) => {
    setSelectedUrns((prev) => {
      const next = new Set(prev)
      if (next.has(urn)) next.delete(urn)
      else next.add(urn)
      return next
    })
  }

  const handleBatchPlay = () => {
    const toPlay = Array.from(selectedUrns)
    if (toPlay.length > 0) {
      void player?.playNow(toPlay, {
        context: { kind: 'favorites', label: '收藏夹' },
      })
    }
  }

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const selectedTracks = toAdd.map((u) => tracksMap.get(u) ?? u)
      openBatchAddToPlaylistMenu(
        selectedTracks,
        anchor ?? { x: typeof window !== 'undefined' ? window.innerWidth / 2 : 200, y: typeof window !== 'undefined' ? window.innerHeight / 2 : 200 },
      )
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
    setSelectedUrns(new Set())
  }

  const handleExitBatch = () => {
    setIsBatchMode(false)
    setSelectedUrns(new Set())
  }

  const moreMenuItems: MenuItemSpec[] = useMemo(() => {
    if (isBatchMode) {
      return [
        {
          id: 'batch-play',
          label: '批量播放',
          icon: tablerIcon('play', { size: 20 }),
          disabled: selectedUrns.size === 0,
          onSelect: handleBatchPlay,
        },
        {
          id: 'batch-add',
          label: '添加到歌单',
          icon: tablerIcon('plus', { size: 20 }),
          disabled: selectedUrns.size === 0,
          onSelect: () => handleBatchAddToPlaylist(),
        },
        {
          id: 'batch-delete',
          label: '从“最喜欢的音乐”中删除',
          icon: tablerIcon('trash', { size: 20 }),
          tone: 'danger',
          disabled: selectedUrns.size === 0,
          onSelect: handleBatchDelete,
        },
        {
          id: 'batch-exit',
          label: '退出批量操作',
          icon: tablerIcon('x', { size: 20 }),
          divider: true,
          onSelect: handleExitBatch,
        },
      ]
    }

    return [
      {
        id: 'batch-operations',
        label: '批量操作',
        icon: tablerIcon('list-check', { size: 20 }),
        onSelect: () => setIsBatchMode(true),
      },
    ]
  }, [isBatchMode, selectedUrns, sortedUrns])

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(DetailPlayButton, {
      size,
      iconSize,
      testID,
      ariaLabel: '播放全部',
      onPress: () =>
        sortedUrns[0] &&
        player?.playFromContext(sortedUrns[0], sortedUrns, {
          context: { kind: 'favorites', label: '收藏夹' },
        }),
      disabled: sortedUrns.length === 0,
    })

  // 吸顶栏单独走 List 的 sticky 插槽（滚动容器的直接子节点）。
  const stickyBar = h(StickyDetailBar, {
    title: '已点赞的歌曲',
    progress: collapse.slide,
    docked: collapse.docked,
    tint: FAVORITES_TINT,
    playButton: renderPlayButton(48, 24, 'favorites-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），下方内容为纯色。
  const headerNode = h(
    'div',
    { style: { background: headerGradient(FAVORITES_TINT) } },
    h(DetailHero, {
      eyebrow: '歌单',
      title: '已点赞的歌曲',
      subtitle: `已收藏的音乐 • ${urns.length} 首歌曲`,
    }),
    // Action Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px 18px 32px',
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
          renderPlayButton(56, 28, 'favorites-play'),
        ),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedUrns.length > 0) {
                const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                if (shuffled[0])
                  void player?.playFromContext(shuffled[0], shuffled, {
                    context: { kind: 'favorites', label: '收藏夹' },
                  })
              }
            },
          },
          tablerIcon('shuffle', { size: 26 }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'favorites-more-trigger',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMoreMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
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
            placeholder: '在已点赞歌曲中搜索',
            value: searchQuery,
            onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            style: {
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#FFFFFF',
              fontSize: 13,
              width: 140,
            },
          }),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
            },
          },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'favorites-sort-trigger',
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
    ),
    isBatchMode
      ? h(BatchActionBar, {
          selectedCount: selectedUrns.size,
          totalCount: sortedUrns.length,
          allSelected: sortedUrns.length > 0 && selectedUrns.size === sortedUrns.length,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: '从“最喜欢”中删除',
          onExitBatch: handleExitBatch,
        })
      : null,
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
    saved.status === 'error'
      ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { tone: 'error' }, `Could not read favourites: ${saved.error?.message}`))
      : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）。
  const tableHeaderNode = h(DetailTableHeader, {
    testID: 'favorites-table-header',
    accessibilityLabel: '已点赞的歌曲',
    columns: [
      { key: 'default', label: '#', testID: 'favorites-sort-default', width: 40, align: 'center' },
      { key: 'title', label: '标题', testID: 'favorites-sort-title', flex: 2, paddingLeft: 12 },
      { key: 'artist', label: '艺人', plain: true, flex: 1, visible: viewMode === 'compact' },
      { key: 'album', label: '专辑', testID: 'favorites-sort-album', flex: 1.5, paddingLeft: 8 },
      { key: 'source', label: '来源', testID: 'favorites-sort-source', flex: 1, paddingLeft: 8 },
      { key: 'duration', label: '', icon: tablerIcon('clock', { size: 18 }), testID: 'favorites-sort-duration', width: 120, align: 'right', paddingRight: 40 },
    ] satisfies DetailColumnSpec[],
    sortKey,
    sortDirection: sortOrder,
    onSort: (key) => handleHeaderClick(key as FavoriteSortKey),
    solid: collapse.docked,
  })

  return h(
    'section',
    {
      'aria-label': '已点赞的歌曲',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    // Content / List — the header scrolls away inside the same scroller.
    h(
      'div',
      { ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
      h(List<Track>, {
        testID: 'favorites-list',
        header: headerNode,
        sticky: stickyBar,
        stickyHeader: tableHeaderNode,
        onScroll: collapse.handleScroll,
        items: sortedTracks,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (t) => t.urn,
        empty:
          saved.status === 'loading'
            ? h(EmptyState, { title: '加载中…' })
            : h(EmptyState, {
                icon: 'heart',
                title: '暂无已点赞歌曲',
                description: '在曲库中收藏歌曲后，歌曲将在此显示。',
              }),
        renderItem: (t, index) =>
          h(LibraryTrackRow, {
            ctx,
            track: t,
            index,
            compact: viewMode === 'compact',
            batchMode: isBatchMode,
            selected: selectedUrns.has(t.urn),
            onToggleSelect: () => handleToggleSelect(t.urn),
            showSource: true,
            sourceName: resolveTrackSourceName(ctx, t.urn),
            onPress: () =>
              player?.playFromContext(t.urn, sortedUrns, {
                context: { kind: 'favorites', label: '收藏夹' },
              }),
            onMore: (anchor) => menu.open({ track: t }, anchor),
            onOpenPlaylistMenu: openAddToPlaylistMenu,
            // 取消收藏后那一行要回到加号：心形状态跟着实时收藏集合走。
            inLibrary: isTrackInLibrary(t),
            onAddToFavorites: handleAddToFavorites,
          }),
      }),
    ),
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: viewModeMenuItems(sortItems, viewMode, setViewMode),
      title: '排序方式',
    }),
    h(ContextMenu, {
      open: moreMenuAnchor !== null,
      onClose: () => setMoreMenuAnchor(null),
      x: moreMenuAnchor?.x ?? 0,
      y: moreMenuAnchor?.y ?? 0,
      items: moreMenuItems,
      title: '已点赞的歌曲',
    }),
  )
}
