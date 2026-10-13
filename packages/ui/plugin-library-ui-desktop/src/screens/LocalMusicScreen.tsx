import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album, PlayerService, SourcesService, Track } from '@BBeBee/protocol'
import { serviceOf, type MenuAnchor, type MenuItemSpec } from '@BBeBee/ui-core'
import { ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, List, SaveToPlaylistPopover, StickyDetailBar, Text, tablerIcon, useDetailBarCollapse, viewModeMenuItems, useViewMode, headerGradient, useI18n } from '@BBeBee/ui-kit-desktop'
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

/** Album list/compact rows: flat mode still uses the LocalAlbumCard grid. */
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
  /** Compact view: no artwork, artist as its own column. */
  compact?: boolean
  onOpen: () => void
  onPlay?: () => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const [hovered, setHovered] = useState(false)
  const artists = album.artists?.map((a) => a.name).join(', ') || t('library:library.unknownArtist')

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
              'aria-label': t('library:library.playItem', { title: album.title }),
              title: t('library:library.playItem', { title: album.title }),
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
      album.trackCount ? `${album.trackCount} songs` : '-',
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
  const { t } = useI18n(ctx)
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
  // Scroll collapse: the sticky bar slides in as the play button approaches the top, and docks once the scroll passes half its height (docked).
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  // View mode: tracks page defaults to list, albums page defaults to tiled (card grid); the choice is remembered per page.
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
    const unknownAlbumLabel = t('library:localAlbum.unknownAlbum')

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
            const albumTitle = t.albumTitle || unknownAlbumLabel
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
  }, [ctx, t])

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
        context: { kind: 'local', label: t('library:localMusic.localMusic') },
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
          label: t('library:favorites.playSelected'),
          icon: tablerIcon('play', { size: 20 }),
          disabled: selectedUrns.size === 0,
          onSelect: handleBatchPlay,
        },
        {
          id: 'batch-add',
          label: t('library:trackLibraryActionButton.addToPlaylist2'),
          icon: tablerIcon('plus', { size: 20 }),
          disabled: selectedUrns.size === 0,
          onSelect: () => handleBatchAddToPlaylist(),
        },
        {
          id: 'batch-delete',
          label: t('library:localMusic.delete'),
          icon: tablerIcon('trash', { size: 20 }),
          tone: 'danger',
          disabled: selectedUrns.size === 0,
          onSelect: handleBatchDelete,
        },
        {
          id: 'batch-exit',
          label: t('library:favorites.exitBatchOperations'),
          icon: tablerIcon('x', { size: 20 }),
          divider: true,
          onSelect: handleExitBatch,
        },
      ]
    }

    return [
      {
        id: 'batch-operations',
        label: t('library:favorites.batchOperations'),
        icon: tablerIcon('list-check', { size: 20 }),
        onSelect: () => setIsBatchMode(true),
      },
    ]
  }, [isBatchMode, selectedUrns, sortedTrackUrns, t])

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
    default: t('library:favorites.defaultOrder'),
    title: t('library:favorites.title'),
    artist: t('library:favorites.artist'),
    album: t('library:favorites.album'),
    duration: t('library:favorites.duration'),
  }

  const albumSortLabelMap: Record<LocalAlbumSortKey, string> = {
    default: t('library:favorites.defaultOrder'),
    title: t('library:localMusic.albumName'),
    artist: t('library:favorites.artist'),
    year: t('library:localMusic.year'),
    count: t('library:localMusic.trackCount'),
  }

  const trackSortItems = sortMenuItems(
    [
      { id: 'default', label: t('library:favorites.defaultOrder') },
      { id: 'title', label: t('library:favorites.title') },
      { id: 'artist', label: t('library:favorites.artist') },
      { id: 'album', label: t('library:favorites.album') },
      { id: 'duration', label: t('library:favorites.duration') },
    ],
    trackSortKey,
    (id) => setTrackSortKey(id as LocalTrackSortKey),
    { value: trackSortOrder, onChange: setTrackSortOrder },
  )

  const albumSortItems = sortMenuItems(
    [
      { id: 'default', label: t('library:favorites.defaultOrder') },
      { id: 'title', label: t('library:localMusic.albumName') },
      { id: 'artist', label: t('library:favorites.artist') },
      { id: 'year', label: t('library:localMusic.year') },
      { id: 'count', label: t('library:localMusic.trackCount') },
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
      ariaLabel: t('library:favorites.playAll'),
      onPress: () =>
        sortedTrackUrns[0] &&
        player?.playNow(sortedTrackUrns, { context: { kind: 'local', label: t('library:localMusic.localMusic') } }),
      disabled: sortedTrackUrns.length === 0,
    })

  // Parts that scroll away with the list: hero, view switcher, action bar, (tracks-mode) table header.
  // The sticky bar rides the sticky slot / a direct child of the scroller.
  const stickyBar = h(StickyDetailBar, {
    title: t('library:localMusic.localMusic'),
    progress: collapse.slide,
    docked: collapse.docked,
    playButton: renderPlayButton(48, 24, 'local-music-play-sticky'),
  })

  // The gradient exists only over the header area (scrolling away with the content); the content below is solid.
  const headerNode = h(
    'div',
    { style: { background: headerGradient(undefined) } },
    h(DetailHero, {
      eyebrow: t('library:localMusic.localMusic'),
      title: viewMode === 'tracks' ? t('library:localMusic.localFiles') : t('library:localMusic.localAlbums'),
      subtitle:
        viewMode === 'tracks'
          ? t('library:localMusic.filesFromThisComputerSongs', { length: tracks.length })
          : t('library:localMusic.albumsFromThisComputerAlbums', { length: albums.length }),
    }),
    // View Mode Switcher: [ Songs ]  [ Albums ]
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
        t('library:localMusic.songs'),
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
        t('library:libraryToolbar.albums'),
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
        // Collapse anchor: the sticky bar uses this large button's position to decide when to slide in and dock.
        h('div', { ref: collapse.anchorRef, style: { display: 'flex' } }, renderPlayButton(56, 28, 'local-music-play')),
        h(
          'button',
          {
            type: 'button',
            title: t('library:favorites.shuffle'),
            style: { background: 'none', border: 'none', color: 'var(--bb-text-secondary, #b3b3b3)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedTrackUrns.length > 0) {
                const shuffled = [...sortedTrackUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled, { context: { kind: 'local', label: t('library:localMusic.localMusic') } })
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
            title: t('library:expandedLibrary.moreOptions'),
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
            placeholder: viewMode === 'tracks' ? t('library:localMusic.searchLocalFiles') : t('library:localMusic.searchLocalAlbums'),
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
            onClick: () => ctx.ui.navigate('settings.view', { tab: 'sources' }),
            title: t('library:localMusic.scanSettings'),
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
            h('span', null, viewMode === 'tracks' ? trackSortLabelMap[trackSortKey] : albumSortLabelMap[albumSortKey]),
            tablerIcon('list', { size: 20 }),
          ),
        ),
      ),
    ),
    isBatchMode && viewMode === 'tracks'
      ? h(BatchActionBar, {
          ctx,
          selectedCount: selectedUrns.size,
          totalCount: sortedTrackUrns.length,
          allSelected,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: t('library:localMusic.delete'),
          onExitBatch: handleExitBatch,
        })
      : null,
    error ? h('div', { style: { padding: '0 32px 8px 32px' } }, h(Text, { variant: 'sm', tone: 'error' }, error)) : null,
  )

  // The table header rides the stickyHeader slot (a direct child of the scroller) —
  // nested inside the header box, sticky only docks within the parent box, and being
  // the parent box's last child it effectively never docks at all.
  const tableHeaderNode = viewMode === 'tracks'
    ? h(DetailTableHeader, {
        testID: 'local-table-header',
        accessibilityLabel: t('library:localMusic.localMusic'),
        columns: [
          { key: 'default', label: '#', testID: 'local-sort-default', width: 40, align: 'center' },
          { key: 'title', label: t('library:favorites.title'), testID: 'local-sort-title', flex: 2, paddingLeft: 12 },
          { key: 'artist', label: t('library:favorites.artist'), plain: true, flex: 1, visible: trackViewMode === 'compact' },
          { key: 'album', label: t('library:favorites.album'), testID: 'local-sort-album', flex: 1.5, paddingLeft: 8 },
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
          accessibilityLabel: t('library:localMusic.localAlbums'),
          columns: [
            { key: 'default', label: '#', testID: 'local-album-sort-default', width: 40, align: 'center' },
            { key: 'title', label: t('library:favorites.album'), testID: 'local-album-sort-title', flex: 2, paddingLeft: 12 },
            { key: 'artist', label: t('library:favorites.artist'), testID: 'local-album-sort-artist', flex: 1.5, visible: albumViewMode === 'compact' },
            { key: 'year', label: t('library:localMusic.year'), testID: 'local-album-sort-year', flex: 1 },
            { key: 'count', label: t('library:localMusic.trackCount'), testID: 'local-album-sort-count', width: 100, align: 'right' },
          ] satisfies DetailColumnSpec[],
          sortKey: albumSortKey,
          sortDirection: albumSortOrder,
          onSort: (key) => handleAlbumHeaderClick(key as LocalAlbumSortKey),
          solid: collapse.docked,
        })

  // Album mode content (tiled grid or row list) sits directly in the scroll flow, with no scroller of its own.
  const albumsContent = loading
    ? h(EmptyState, { key: 'album-loading', title: t('library:collection.loading') })
    : sortedAlbums.length === 0
    ? h(EmptyState, {
        key: 'album-empty',
        icon: 'disc',
        title: t('library:localMusic.noLocalAlbumsYet'),
        description: t('library:localMusic.afterAddingALocalMusic'),
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
                    context: { kind: 'album', label: album.title ?? t('library:localMusic.localMusic') },
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
                  context: { kind: 'album', label: album.title ?? t('library:localMusic.localMusic') },
                })
              }
            },
          }),
        ),
      )

  return h(
    'section',
    {
      'aria-label': t('library:localMusic.localMusic'),
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
      ? // Tracks mode: the header scrolls with the virtual list and the sticky bar floats above it.
        h(
          'div',
          { key: 'track-list-container', ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
          loading
            ? h('div', { style: { overflowY: 'auto', height: '100%' } }, stickyBar, headerNode, h(EmptyState, { title: t('library:collection.loading') }))
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
                  title: t('library:localMusic.noLocalMusicYet'),
                  description: t('library:localMusic.afterAddingAMusicFolder'),
                }),
                renderItem: (track, index) =>
                  h(LibraryTrackRow, {
                    ctx,
                    track,
                    index,
                    batchMode: isBatchMode,
                    selected: selectedUrns.has(track.urn),
                    onToggleSelect: () => handleToggleSelect(track.urn),
                    inLibrary: isTrackInLibrary(track),
                    highlighted: activeHighlights.has(track.urn),
                    compact: trackViewMode === 'compact',
                    onPress: () =>
                      player?.playFromContext(track.urn, sortedTrackUrns, {
                        context: { kind: 'local', label: t('library:localMusic.localMusic') },
                      }),
                    onMore: (anchor) => menu.open({ track }, anchor),
                    onAddToFavorites: handleAddToFavorites,
                    onOpenPlaylistMenu: openAddToPlaylistMenu,
                    onOpenAlbum: handleOpenAlbum,
                  }),
              }),
        )
      : // Albums mode: no virtual list; this page provides its own scroller, and the header likewise scrolls away with the content.
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
      title: t('library:expandedLibrary.moreOptions'),
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
      title: t('library:favorites.sortBy'),
    }),
  )
}
