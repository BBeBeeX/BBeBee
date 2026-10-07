import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album, PlayerService, SourcesService, Track } from '@BBeBee/protocol'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, viewModeMenuItems, useViewMode, headerGradient } from '@BBeBee/ui-kit-desktop'
import { sortMenuItems, useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/CachedArtwork.js'
import { LocalAlbumCard } from '../components/LocalAlbumCard.js'
import { LibraryTrackRow } from '../components/LibraryTrackRow.js'
import { BatchActionBar } from '../components/BatchActionBar.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import { fetchAllLocalAlbums, fetchAllLocalTracks } from '@BBeBee/plugin-library/hooks'

type LocalTrackSortKey = 'default' | 'title' | 'artist' | 'album' | 'duration'
type LocalAlbumSortKey = 'default' | 'title' | 'artist' | 'year' | 'count'

/** 专辑的列表/紧凑行：平铺模式仍用 LocalAlbumCard 网格。 */
function LocalAlbumRow({
  ctx,
  album,
  index,
  compact,
  onOpen,
  onPlay,
}: {
  ctx: Context
  album: Album
  index: number
  /** 紧凑视图：无封面，艺人独立成列。 */
  compact?: boolean
  onOpen: () => void
  onPlay?: () => void
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artists = album.artists?.map((a) => a.name).join(', ') || '未知艺人'

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      'aria-label': album.title,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onOpen,
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 56,
        padding: '0 32px',
        borderRadius: 4,
        cursor: 'pointer',
        background: hovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
        transition: 'background-color 0.15s ease',
        boxSizing: 'border-box',
      },
    },
    // Col 1: # or Play on hover
    h(
      'div',
      {
        style: {
          width: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          color: hovered ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #b3b3b3)',
        },
      },
      hovered && onPlay
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': `local-album-play-${album.urn}`,
              'aria-label': `播放 ${album.title}`,
              title: `播放 ${album.title}`,
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onPlay()
              },
              style: {
                background: 'none',
                border: 'none',
                color: 'currentColor',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            tablerIcon('play', { size: 18, color: 'currentColor' }),
          )
        : String(index + 1),
    ),
    // Col 2: Title (+ artists inline in list mode)
    h(
      'div',
      {
        style: {
          flex: 2,
          minWidth: 0,
          paddingLeft: 12,
          paddingRight: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        },
      },
      compact
        ? null
        : h(
            'div',
            {
              style: {
                width: 40,
                height: 40,
                borderRadius: 4,
                overflow: 'hidden',
                flexShrink: 0,
                backgroundColor: '#282828',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            album.artwork
              ? h(CachedArtwork, { ctx, artwork: album.artwork, seed: album.urn, size: 40, radius: 4 })
              : tablerIcon('disc', { size: 22, color: '#7f7f7f' }),
          ),
      h(
        'div',
        {
          style: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          },
        },
        h(
          'span',
          {
            style: {
              color: 'var(--bb-text-primary, #FFFFFF)',
              fontSize: 15,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          album.title,
        ),
        !compact
          ? h(
              'span',
              {
                style: {
                  color: 'var(--bb-text-secondary, #b3b3b3)',
                  fontSize: 13,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              artists,
            )
          : null,
      ),
    ),
    // Col 3 (compact only): Artist as its own column
    compact
      ? h(
          'div',
          {
            style: {
              flex: 1.5,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: 'var(--bb-text-secondary, #b3b3b3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          artists,
        )
      : null,
    // Col 4: Year
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          paddingRight: 16,
          fontSize: 13,
          color: 'var(--bb-text-secondary, #b3b3b3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      album.year ? String(album.year) : '-',
    ),
    // Col 5: Track count
    h(
      'div',
      {
        style: {
          width: 100,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 13,
          color: 'var(--bb-text-secondary, #b3b3b3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      album.trackCount ? `${album.trackCount} 首歌曲` : '-',
    ),
  )
}

export interface LocalMusicScreenProps {
  ctx: Context
  highlightUrn?: string
  highlightUrns?: string[]
}

export function LocalMusicScreen({
  ctx,
  highlightUrn,
  highlightUrns,
}: LocalMusicScreenProps): ReactElement {
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [albums, setAlbums] = useState<readonly Album[]>([])
  const [viewMode, setViewMode] = useState<'tracks' | 'albums'>('tracks')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [trackSortKey, setTrackSortKey] = useState<LocalTrackSortKey>('default')
  const [trackSortOrder, setTrackSortOrder] = useState<'asc' | 'desc'>('asc')
  const [albumSortKey, setAlbumSortKey] = useState<LocalAlbumSortKey>('default')
  const [albumSortOrder, setAlbumSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<MenuAnchor | null>(null)
  // 滚动折叠：吸顶栏在播放按钮靠近时滑入，滚过按钮一半高度时吸附（docked）。
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  // 视图模式：歌曲页默认列表，专辑页默认平铺（卡片网格），选择按页记忆。
  const [trackViewMode, setTrackViewMode] = useViewMode('local-tracks', 'list', ['compact', 'list'] as const)
  const [albumViewMode, setAlbumViewMode] = useViewMode('local-albums', 'tiled', ['compact', 'list', 'tiled'] as const)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    openBatchAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)

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
  }, [targetUrns])

  useEffect(() => {
    if (targetUrns.size > 0 && collapse.scrollerRef.current) {
      collapse.scrollerRef.current.scrollTop = 0
    }
  }, [targetUrns, tracks.length])

  const reload = useCallback(() => {
    const sources = serviceOf<SourcesService>(ctx, 'sources') ?? ctx.sources
    if (!sources?.listTracks) {
      setLoading(false)
      return
    }

    const loadAlbums = fetchAllLocalAlbums(sources).catch(() => [] as Album[])

    Promise.all([fetchAllLocalTracks(sources), loadAlbums])
      .then(([loadedTracks, loadedAlbums]) => {
        const seen = new Set<string>()
        const dedupedTracks = loadedTracks.filter((t) => {
          if (!t.urn || seen.has(t.urn)) return false
          seen.add(t.urn)
          return true
        })
        setTracks(dedupedTracks)

        if (loadedAlbums.length > 0) {
          setAlbums(loadedAlbums)
        } else {
          // Synthesize albums from local tracks if listAlbums returned empty
          const map = new Map<string, Album>()
          for (const t of loadedTracks) {
            const albumTitle = t.albumTitle || '未知专辑'
            const key = t.albumUrn || `BBeBee:local:album:${encodeURIComponent(albumTitle)}`
            if (!map.has(key)) {
              map.set(key, {
                urn: key,
                title: albumTitle,
                artists: t.artists || [],
                year: t.year,
                artwork: t.artwork,
                trackCount: 1,
              })
            } else {
              const existing = map.get(key)!
              existing.trackCount = (existing.trackCount || 1) + 1
            }
          }
          setAlbums(Array.from(map.values()))
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [ctx])

  useEffect(() => {
    reload()
    const offLibrary = ctx.on?.('library/changed', (kind) => {
      if (kind === 'track' || kind === 'album' || !kind) reload()
    })
    const offScan = ctx.on?.('scan/finished', () => {
      reload()
    })
    return () => {
      offLibrary?.()
      offScan?.()
    }
  }, [ctx, reload])

  const sortedTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? tracks.filter((t) => {
          return (
            t.title.toLowerCase().includes(q) ||
            t.artists?.some((a) => a.name.toLowerCase().includes(q)) ||
            t.albumTitle?.toLowerCase().includes(q)
          )
        })
      : [...tracks]

    if (trackSortKey === 'default') {
      if (targetUrns.size > 0) {
        const highlighted: Track[] = []
        const others: Track[] = []
        for (const t of matching) {
          if (targetUrns.has(t.urn)) highlighted.push(t)
          else others.push(t)
        }
        const arranged = [...highlighted, ...others]
        return trackSortOrder === 'desc' ? arranged.reverse() : arranged
      }
      return trackSortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (trackSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (trackSortKey === 'album') {
        cmp = (a.albumTitle ?? '').localeCompare(b.albumTitle ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      } else if (trackSortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      }
      return trackSortOrder === 'desc' ? -cmp : cmp
    })
  }, [tracks, searchQuery, trackSortKey, trackSortOrder])

  const sortedTrackUrns = useMemo(() => sortedTracks.map((t) => t.urn), [sortedTracks])

  const allSelected = sortedTrackUrns.length > 0 && selectedUrns.size === sortedTrackUrns.length
  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedUrns(new Set())
    } else {
      setSelectedUrns(new Set(sortedTrackUrns))
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
    if (toPlay.length > 0) {
      void player?.playNow(toPlay, {
        context: { kind: 'local', label: '本地音乐' },
      })
    }
  }

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const trackMap = new Map(tracks.map((t) => [t.urn, t]))
      const selectedTracks = toAdd.map((u) => trackMap.get(u) ?? u)
      openBatchAddToPlaylistMenu(
        selectedTracks,
        anchor ?? {
          x: typeof window !== 'undefined' ? window.innerWidth / 2 : 200,
          y: typeof window !== 'undefined' ? window.innerHeight / 2 : 200,
        },
      )
    }
  }

  const handleBatchDelete = () => {
    if (selectedUrns.size === 0) return
    const toRemove = new Set(selectedUrns)
    setTracks((prev) => prev.filter((t) => !toRemove.has(t.urn)))
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
          label: '删除',
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
  }, [isBatchMode, selectedUrns, sortedTrackUrns])

  const albumUrnByTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of albums) {
      if (a.title) map.set(a.title, a.urn)
    }
    return map
  }, [albums])

  const handleOpenAlbum = (t: Track) => {
    const urn =
      t.albumUrn ||
      (t.albumTitle ? albumUrnByTitle.get(t.albumTitle) : undefined) ||
      (t.albumTitle ? `BBeBee:local:album:${encodeURIComponent(t.albumTitle)}` : undefined)
    if (urn) {
      // 'album.view' is plugin-album's view descriptor id — serialized data, a literal, not an import.
      ctx.ui.navigate('album.view', { urn })
    }
  }

  const sortedAlbums = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matching = q
      ? albums.filter((a) => {
          return (
            a.title.toLowerCase().includes(q) ||
            a.artists?.some((art) => art.name.toLowerCase().includes(q))
          )
        })
      : [...albums]

    if (albumSortKey === 'default') {
      return albumSortOrder === 'desc' ? matching.reverse() : matching
    }

    return matching.sort((a, b) => {
      let cmp = 0
      if (albumSortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (albumSortKey === 'artist') {
        const aArt = a.artists?.map((x) => x.name).join(', ') ?? ''
        const bArt = b.artists?.map((x) => x.name).join(', ') ?? ''
        cmp = aArt.localeCompare(bArt, undefined, { numeric: true, sensitivity: 'base' })
      } else if (albumSortKey === 'year') {
        cmp = (a.year ?? 0) - (b.year ?? 0)
      } else if (albumSortKey === 'count') {
        cmp = (a.trackCount ?? 0) - (b.trackCount ?? 0)
      }
      return albumSortOrder === 'desc' ? -cmp : cmp
    })
  }, [albums, searchQuery, albumSortKey, albumSortOrder])

  const handleTrackHeaderClick = (key: LocalTrackSortKey) => {
    if (trackSortKey === key) {
      setTrackSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setTrackSortKey(key)
      setTrackSortOrder('asc')
    }
  }

  const handleAlbumHeaderClick = (key: LocalAlbumSortKey) => {
    if (albumSortKey === key) {
      setAlbumSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setAlbumSortKey(key)
      setAlbumSortOrder('asc')
    }
  }

  const trackSortLabelMap: Record<LocalTrackSortKey, string> = {
    default: '默认顺序',
    title: '标题',
    artist: '艺人',
    album: '专辑',
    duration: '时长',
  }

  const albumSortLabelMap: Record<LocalAlbumSortKey, string> = {
    default: '默认顺序',
    title: '专辑名称',
    artist: '艺人',
    year: '年份',
    count: '曲目数',
  }

  const trackSortItems = sortMenuItems(
    [
      { id: 'default', label: '默认顺序' },
      { id: 'title', label: '标题' },
      { id: 'artist', label: '艺人' },
      { id: 'album', label: '专辑' },
      { id: 'duration', label: '时长' },
    ],
    trackSortKey,
    (id) => setTrackSortKey(id as LocalTrackSortKey),
    { value: trackSortOrder, onChange: setTrackSortOrder },
  )

  const albumSortItems = sortMenuItems(
    [
      { id: 'default', label: '默认顺序' },
      { id: 'title', label: '专辑名称' },
      { id: 'artist', label: '艺人' },
      { id: 'year', label: '年份' },
      { id: 'count', label: '曲目数' },
    ],
    albumSortKey,
    (id) => setAlbumSortKey(id as LocalAlbumSortKey),
    { value: albumSortOrder, onChange: setAlbumSortOrder },
  )

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(DetailPlayButton, {
      size,
      iconSize,
      testID,
      ariaLabel: '播放全部',
      onPress: () =>
        sortedTrackUrns[0] &&
        player?.playNow(sortedTrackUrns, { context: { kind: 'local', label: '本地音乐' } }),
      disabled: sortedTrackUrns.length === 0,
    })

  // 随列表一起滚走的部分：hero、视图切换、操作条、（歌曲模式的）表头。
  // 吸顶栏单独走 sticky 插槽/滚动容器的直接子节点。
  const stickyBar = h(StickyDetailBar, {
    title: '本地音乐',
    progress: collapse.slide,
    docked: collapse.docked,
    playButton: renderPlayButton(48, 24, 'local-music-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），下方内容为纯色。
  const headerNode = h(
    'div',
    { style: { background: headerGradient(undefined) } },
    h(DetailHero, {
      eyebrow: '本地音乐',
      title: viewMode === 'tracks' ? '本地文件' : '本地专辑',
      subtitle:
        viewMode === 'tracks'
          ? `来自本地电脑的文件 • ${tracks.length} 首歌曲`
          : `来自本地电脑的专辑 • ${albums.length} 张专辑`,
    }),
    // View Mode Switcher: [ 歌曲 ]  [ 专辑 ]
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 32px 16px 32px',
          flexShrink: 0,
        },
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => setViewMode('tracks'),
          'data-testid': 'local-tab-tracks',
          style: {
            background: viewMode === 'tracks' ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--surface-1, rgba(255, 255, 255, 0.1))',
            color: viewMode === 'tracks' ? 'var(--bb-bg-base, #000000)' : 'var(--bb-text-secondary, #FFFFFF)',
            border: 'none',
            borderRadius: 20,
            padding: '6px 18px',
            fontSize: 14,
            fontWeight: viewMode === 'tracks' ? 700 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          },
        },
        '歌曲',
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => setViewMode('albums'),
          'data-testid': 'local-tab-albums',
          style: {
            background: viewMode === 'albums' ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--surface-1, rgba(255, 255, 255, 0.1))',
            color: viewMode === 'albums' ? 'var(--bb-bg-base, #000000)' : 'var(--bb-text-secondary, #FFFFFF)',
            border: 'none',
            borderRadius: 20,
            padding: '6px 18px',
            fontSize: 14,
            fontWeight: viewMode === 'albums' ? 700 : 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          },
        },
        '专辑',
      ),
    ),
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
        h('div', { ref: collapse.anchorRef, style: { display: 'flex' } }, renderPlayButton(56, 28, 'local-music-play')),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedTrackUrns.length > 0) {
                const shuffled = [...sortedTrackUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled, { context: { kind: 'local', label: '本地音乐' } })
              }
            },
          },
          tablerIcon('shuffle', { size: 26 }),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'local-music-more-trigger',
            title: '更多选项',
            onClick: (e: ReactMouseEvent) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMoreMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
            },
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          tablerIcon('dots', { size: 26 }),
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
            placeholder: viewMode === 'tracks' ? '在本地文件中搜索' : '在本地专辑中搜索',
            value: searchQuery,
            onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            style: {
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--bb-text-primary, #FFFFFF)',
              fontSize: 13,
              width: 140,
            },
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () => ctx.ui.navigate('scanner.settings'),
            title: '扫描目录设置',
            style: {
              background: 'none',
              border: 'none',
              color: 'var(--bb-text-secondary, #b3b3b3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 4,
            },
          },
          tablerIcon('settings', { size: 22 }),
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
              'data-testid': 'local-music-sort-trigger',
              title: '排序方式',
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
            h('span', null, viewMode === 'tracks' ? trackSortLabelMap[trackSortKey] : albumSortLabelMap[albumSortKey]),
            tablerIcon('list', { size: 20 }),
          ),
        ),
      ),
    ),
    isBatchMode && viewMode === 'tracks'
      ? h(BatchActionBar, {
          selectedCount: selectedUrns.size,
          totalCount: sortedTrackUrns.length,
          allSelected,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: '删除',
          onExitBatch: handleExitBatch,
        })
      : null,
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）——嵌在 header 盒内时
  // sticky 只在父盒范围吸附，作为父盒最后一个子元素等于完全吸不住。
  const tableHeaderNode = viewMode === 'tracks'
    ? h(DetailTableHeader, {
        testID: 'local-table-header',
        accessibilityLabel: '本地音乐',
        columns: [
          { key: 'default', label: '#', testID: 'local-sort-default', width: 40, align: 'center' },
          { key: 'title', label: '标题', testID: 'local-sort-title', flex: 2, paddingLeft: 12 },
          { key: 'artist', label: '艺人', plain: true, flex: 1, visible: trackViewMode === 'compact' },
          { key: 'album', label: '专辑', testID: 'local-sort-album', flex: 1.5, paddingLeft: 8 },
          { key: 'duration', label: '', icon: tablerIcon('clock', { size: 18 }), testID: 'local-sort-duration', width: 120, align: 'right', paddingRight: 40 },
        ] satisfies DetailColumnSpec[],
        sortKey: trackSortKey,
        sortDirection: trackSortOrder,
        onSort: (key) => handleTrackHeaderClick(key as LocalTrackSortKey),
        solid: collapse.docked,
      })
    : undefined

  const albumTableHeaderNode =
    albumViewMode === 'tiled'
      ? undefined
      : h(DetailTableHeader, {
          testID: 'local-albums-table-header',
          accessibilityLabel: '本地专辑',
          columns: [
            { key: 'default', label: '#', testID: 'local-album-sort-default', width: 40, align: 'center' },
            { key: 'title', label: '专辑', testID: 'local-album-sort-title', flex: 2, paddingLeft: 12 },
            { key: 'artist', label: '艺人', testID: 'local-album-sort-artist', flex: 1.5, visible: albumViewMode === 'compact' },
            { key: 'year', label: '年份', testID: 'local-album-sort-year', flex: 1 },
            { key: 'count', label: '曲目数', testID: 'local-album-sort-count', width: 100, align: 'right' },
          ] satisfies DetailColumnSpec[],
          sortKey: albumSortKey,
          sortDirection: albumSortOrder,
          onSort: (key) => handleAlbumHeaderClick(key as LocalAlbumSortKey),
          solid: collapse.docked,
        })

  // 专辑模式的内容（平铺网格或行列表），直接在滚动流里，不再自带滚动容器。
  const albumsContent = loading
    ? h(EmptyState, { key: 'album-loading', title: '加载中…' })
    : sortedAlbums.length === 0
    ? h(EmptyState, {
        key: 'album-empty',
        icon: 'disc',
        title: '暂无本地专辑',
        description: '添加包含专辑信息的本地音乐文件夹后，专辑将在此显示。',
      })
    : albumViewMode === 'tiled'
    ? h(
        'div',
        {
          key: 'album-grid',
          style: {
            padding: '8px 32px 32px 32px',
          },
        },
        h(
          'div',
          {
            'data-testid': 'local-albums-grid',
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 24,
            },
          },
          sortedAlbums.map((album) =>
            h(LocalAlbumCard, {
              key: album.urn,
              ctx,
              album,
              onOpen: () => ctx.ui.navigate('album.view', { urn: album.urn }),
              onPlay: () => {
                const albumTracks = tracks.filter(
                  (t) => t.albumUrn === album.urn || (album.title && t.albumTitle === album.title),
                )
                const urns = albumTracks.map((t) => t.urn)
                if (urns[0]) {
                  void player?.playNow(urns, {
                    context: { kind: 'album', label: album.title ?? '本地音乐' },
                  })
                }
              },
            }),
          ),
        ),
      )
    : h(
        'div',
        { key: 'album-list', style: { padding: '8px 0 32px 0' } },
        sortedAlbums.map((album, index) =>
          h(LocalAlbumRow, {
            key: album.urn,
            ctx,
            album,
            index,
            compact: albumViewMode === 'compact',
            onOpen: () => ctx.ui.navigate('album.view', { urn: album.urn }),
            onPlay: () => {
              const albumTracks = tracks.filter(
                (t) => t.albumUrn === album.urn || (album.title && t.albumTitle === album.title),
              )
              const urns = albumTracks.map((t) => t.urn)
              if (urns[0]) {
                void player?.playNow(urns, {
                  context: { kind: 'album', label: album.title ?? '本地音乐' },
                })
              }
            },
          }),
        ),
      )

  return h(
    'section',
    {
      'aria-label': '本地音乐',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: 'var(--bb-text-primary, #FFFFFF)',
        overflow: 'hidden',
      },
    },
    viewMode === 'tracks'
      ? // 歌曲模式：头部随虚拟列表一起滚动，吸顶栏浮在其上。
        h(
          'div',
          { key: 'track-list-container', ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
          loading
            ? h('div', { style: { overflowY: 'auto', height: '100%' } }, stickyBar, headerNode, h(EmptyState, { title: '加载中…' }))
            : h(List<Track>, {
                testID: 'local-tracks-list',
                header: headerNode,
                sticky: stickyBar,
                stickyHeader: tableHeaderNode ?? undefined,
                onScroll: collapse.handleScroll,
                items: sortedTracks,
                estimatedItemSize: tokens.size.row,
                keyExtractor: (t) => t.urn,
                empty: h(EmptyState, {
                  icon: 'folder',
                  title: '暂无本地音乐',
                  description: '添加音乐文件夹后，扫描的歌曲将在此显示。',
                }),
                renderItem: (t, index) =>
                  h(LibraryTrackRow, {
                    ctx,
                    track: t,
                    index,
                    batchMode: isBatchMode,
                    selected: selectedUrns.has(t.urn),
                    onToggleSelect: () => handleToggleSelect(t.urn),
                    inLibrary: isTrackInLibrary(t),
                    highlighted: activeHighlights.has(t.urn),
                    compact: trackViewMode === 'compact',
                    onPress: () =>
                      player?.playFromContext(t.urn, sortedTrackUrns, {
                        context: { kind: 'local', label: '本地音乐' },
                      }),
                    onMore: (anchor) => menu.open({ track: t }, anchor),
                    onAddToFavorites: handleAddToFavorites,
                    onOpenPlaylistMenu: openAddToPlaylistMenu,
                    onOpenAlbum: handleOpenAlbum,
                  }),
              }),
        )
      : // 专辑模式：没有虚拟列表，滚动容器由本页自己提供，头部同样随内容滚走。
        h(
          'div',
          {
            key: 'album-scroll-container',
            ref: collapse.scrollerRef,
            style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' },
            onScroll: collapse.handleScroll,
          },
          stickyBar,
          headerNode,
          albumTableHeaderNode,
          albumsContent,
        ),
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
    h(ContextMenu, {
      open: moreMenuAnchor !== null,
      onClose: () => setMoreMenuAnchor(null),
      x: moreMenuAnchor?.x ?? 0,
      y: moreMenuAnchor?.y ?? 0,
      items: moreMenuItems,
      title: '更多选项',
    }),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items:
        viewMode === 'tracks'
          ? viewModeMenuItems(trackSortItems, trackViewMode, setTrackViewMode)
          : viewModeMenuItems(albumSortItems, albumViewMode, setAlbumViewMode, {
              allowTiled: true,
            }),
      title: '排序方式',
    }),
  )
}
