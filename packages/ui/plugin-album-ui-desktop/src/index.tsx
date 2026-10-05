/**
 * React DOM views for `@BBeBee/plugin-album`.
 *
 * One screen: the album header with its cover and "Play album", then the
 * track list. Every value comes from `@BBeBee/plugin-album/hooks` and
 * `ctx.sources`; this file is layout, gestures and event wiring only
 * (docs/08 §1).
 *
 * Playback semantics, which are the part worth stating:
 *
 *  - **"Play album"** is `playNow(urns)` — the explicit from-the-top gesture,
 *    and it replaces the queue outright. Disabled, not hidden, when the album
 *    has no playable tracks: an empty album is a real state, and hiding the
 *    control hides the reason.
 *  - **Tapping a row** is `playFromContext(track, albumUrns)`: jump if the
 *    queue already holds it, otherwise the whole album becomes the queue
 *    starting here. Playback never navigates; the transport bar announces it.
 */

import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection, DownloadsService, LibraryService, PlayerService, ShareService, SleepTimerService, SourcesService, Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useAlbum } from '@BBeBee/plugin-album/hooks'
import { resolveTrackSourceName, useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { formatDuration, formatTotalDuration } from '@BBeBee/toolkit'
import { addToCollectionSubmenu, openExternalUrl, resolveOriginalResourceUrl, sleepTimerSubmenu, sortMenuItems, useSaveToPlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import { Artwork, ContextMenu, DetailHero, DetailPlayButton, DetailTableHeader, type DetailColumnSpec, EmptyState, HoverLabel, List, SaveToPlaylistPopover, StickyDetailBar, tablerIcon, useDetailBarCollapse, useImageColor, headerGradient, viewModeMenuItems, useViewMode } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { BatchActionBar } from './BatchActionBar.js'

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at the call site because the album
 * header is not a list row: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

function TrackLibraryActionButton({
  track,
  hovered,
  inLibrary: initialInLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  track: Track
  hovered: boolean
  inLibrary: boolean
  onAddToFavorites?: () => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
  // Optimistic until the truth catches up — and reset whenever it does: an
  // unfavourite from any surface flips the prop, drops the optimism, and the
  // row is a plus again.
  const [optimisticInLibrary, setOptimisticInLibrary] = useState(false)
  useEffect(() => {
    setOptimisticInLibrary(false)
  }, [initialInLibrary])
  const inLibrary = initialInLibrary || optimisticInLibrary

  return h(
    'button',
    {
      type: 'button',
      'aria-label': inLibrary ? `Add ${track.title} to playlist` : `Add ${track.title} to favourites`,
      title: inLibrary ? '加入歌单' : '加入最喜欢的音乐',
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation()
        if (inLibrary) {
          const rect = e.currentTarget.getBoundingClientRect()
          onOpenPlaylistMenu(track, { x: rect.left, y: rect.bottom + 4 })
        } else {
          setOptimisticInLibrary(true)
          onAddToFavorites?.()
        }
      },
      style: {
        background: 'none',
        border: 'none',
        color: inLibrary ? 'var(--color-primary, #5F87FF)' : 'var(--text-tertiary, #8B95B0)',
        fontSize: inLibrary ? 16 : 18,
        fontWeight: inLibrary ? 700 : 400,
        cursor: 'pointer',
        padding: '2px 4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
    },
    inLibrary ? tablerIcon('heart-filled', { size: 20 }) : tablerIcon('plus', { size: 20 }),
  )
}

function AlbumTrackTableRow({
  track,
  index,
  albumTitle,
  inLibrary,
  compact,
  batchMode,
  selected,
  onToggleSelect,
  showSource,
  sourceName,
  onAddToFavorites,
  onOpenPlaylistMenu,
  onPress,
  onDownload,
  onMore,
}: {
  track: Track
  index: number
  albumTitle?: string
  inLibrary: boolean
  /** 紧凑视图：艺人独立成列。 */
  compact?: boolean
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showSource?: boolean
  sourceName?: string
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu?: (track: Track, anchor: MenuAnchor) => void
  onPress: () => void
  onDownload?: () => void
  onMore: (anchor: { x: number; y: number }) => void
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artists = track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onPress,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        onMore({ x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onPress()
      },
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
    // Col 1: Checkbox (batch mode) or # or Play
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
          color: hovered ? '#FFFFFF' : '#b3b3b3',
        },
      },
      batchMode
        ? h('input', {
            type: 'checkbox',
            'data-testid': `album-track-checkbox-${track.urn}`,
            'aria-label': `选择 ${track.title}`,
            checked: selected,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              e.stopPropagation()
              onToggleSelect?.()
            },
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
            style: {
              width: 16,
              height: 16,
              cursor: 'pointer',
              accentColor: 'var(--color-primary, #5F87FF)',
            },
          })
        : hovered
          ? tablerIcon('play', { size: 18 })
          : String(index + 1),
    ),
    // Col 2: Title and Artist
    // 歌名/作者名被截断时，悬浮 2 秒浮出完整名字的 label。
    h(
      'div',
      {
        style: {
          flex: 2,
          minWidth: 0,
          paddingLeft: 12,
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      },
      h(
        HoverLabel,
        { label: track.title, style: { display: 'block' } },
        h(
          'span',
          {
            style: {
              display: 'block',
              color: '#FFFFFF',
              fontSize: 15,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          track.title,
        ),
      ),
      !compact && artists
        ? h(
            HoverLabel,
            { label: artists, style: { display: 'block' } },
            h(
              'span',
              {
                style: {
                  display: 'block',
                  color: '#b3b3b3',
                  fontSize: 13,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              artists,
            ),
          )
        : null,
    ),
    // Col 3 (compact only): Artist as its own column
    compact
      ? h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: '#b3b3b3',
            },
          },
          h(
            HoverLabel,
            {
              label: artists || '-',
              style: {
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            artists || '-',
          ),
        )
      : null,
    // Col 3: Album
    h(
      'div',
      {
        style: {
          flex: 1.5,
          minWidth: 0,
          paddingRight: 16,
          fontSize: 14,
          color: '#b3b3b3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      track.albumTitle || albumTitle || '-',
    ),
    // Col: Source
    showSource
      ? h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 14,
              color: 'var(--text-tertiary, #8B95B0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          sourceName || '-',
        )
      : null,
    // Col 4: Duration and actions
    h(
      'div',
      {
        style: {
          width: 130,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          paddingRight: 16,
        },
      },
      onDownload && !track.urn.startsWith('BBeBee:local:')
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': 'Download',
              title: 'Download',
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation()
                onDownload()
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                fontSize: 15,
                cursor: 'pointer',
                padding: 4,
                opacity: hovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
              },
            },
            tablerIcon('download', { size: 20 }),
          )
        : null,
      onOpenPlaylistMenu
        ? h(TrackLibraryActionButton, {
            track,
            hovered,
            inLibrary,
            onAddToFavorites: () => onAddToFavorites?.(track),
            onOpenPlaylistMenu,
          })
        : null,
      h(
        'span',
        {
          style: {
            fontSize: 14,
            color: '#b3b3b3',
            width: 45,
            textAlign: 'right',
          },
        },
        formatDuration(track.durationMs),
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'More',
          title: '更多',
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: '#b3b3b3',
            fontSize: 16,
            cursor: 'pointer',
            padding: 4,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

type AlbumSortKey = 'trackNo' | 'title' | 'album' | 'duration' | 'plays' | 'source'

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const player = serviceOf<PlayerService>(ctx, 'player')
  const sleepTimer = serviceOf<SleepTimerService>(ctx, 'sleepTimer')
  const menu = useTrackMenu(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)
  const [sortKey, setSortKey] = useState<AlbumSortKey>('trackNo')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | null>(null)
  // 视图模式：列表为默认（与历史行为一致），紧凑把艺人单列。
  const [viewMode, setViewMode] = useViewMode('album-detail', 'list', ['compact', 'list'] as const)
  const [albumMenuAnchor, setAlbumMenuAnchor] = useState<MenuAnchor | null>(null)
  const [collections, setCollections] = useState<readonly Collection[]>([])
  const [isSaved, setIsSaved] = useState(false)
  const [savedTrackUrns, setSavedTrackUrns] = useState<Set<string>>(new Set())
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(new Set())
  // 滚动折叠：吸顶栏在播放按钮靠近时滑入，滚过按钮一半高度时吸附（docked）。
  const collapse = useDetailBarCollapse({ barHeight: 64, anchorHeight: 56 })
  // A row's `track.loved` is the value at the album's last fetch, which can be
  // hours old. When a favourite write fires `library/changed`, re-read the
  // changed URNs so the heart follows the truth and not the fetch snapshot.
  const [lovedOverrides, setLovedOverrides] = useState<Map<string, boolean>>(new Map())

  // 背景与吸顶栏的主题色来自专辑封面（dominantColor，缺失时画布提取）。
  const resolvedCover = useResolvedArtwork(ctx, album.data?.artwork)
  const tint = useImageColor(resolvedCover?.sourceUrl, resolvedCover?.dominantColor)

  useEffect(() => {
    const albumUrn = album.data?.urn
    if (!library || !albumUrn) return
    let cancelled = false

    library
      .isSaved(albumUrn)
      .then((res) => {
        if (!cancelled) setIsSaved(res)
      })
      .catch(() => {})

    if (typeof library.listSaved === 'function') {
      library
        .listSaved('track')
        .then((res) => {
          if (!cancelled && res?.items) {
            const next = new Set(res.items.map((i) => i.urn))
            setSavedTrackUrns((prev) => {
              if (prev.size === next.size && [...prev].every((u) => next.has(u))) return prev
              return next
            })
          }
        })
        .catch(() => {})
    }

    const off = ctx.on('library/changed', (kind, urns) => {
      if (!kind || kind === 'album') {
        library
          .isSaved(albumUrn)
          .then((res) => {
            if (!cancelled) setIsSaved(res)
          })
          .catch(() => {})
      }
      if (kind === 'track' && typeof library.listSaved === 'function') {
        library
          .listSaved('track')
          .then((res) => {
            if (!cancelled && res?.items) {
              const next = new Set(res.items.map((i) => i.urn))
              setSavedTrackUrns((prev) => {
                if (prev.size === next.size && [...prev].every((u) => next.has(u))) return prev
                return next
              })
            }
          })
          .catch(() => {})
        const list = (urns ?? []).filter(Boolean)
        if (list.length > 0 && sources?.getTracks) {
          void sources
            .getTracks(list)
            .then((tracks) => {
              if (cancelled) return
              const loved = new Map(tracks.map((t) => [t.urn, t.loved === true]))
              setLovedOverrides((prev) => {
                const next = new Map(prev)
                for (const urn of list) next.set(urn, loved.get(urn) ?? false)
                return next
              })
            })
            .catch(() => {})
        }
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, album.data?.urn, library, sources])

  const handleTrackAddToFavorites = useCallback(
    async (track: Track) => {
      if (!library) return
      setSavedTrackUrns((prev) => new Set([...prev, track.urn]))
      setLovedOverrides((prev) => new Map(prev).set(track.urn, true))
      // Catalogue first: the `library/changed` event the shelf write fires
      // must already see the loved flag, or listeners re-read stale state.
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, true).catch(() => {})
      }
      await library.setSaved(track.urn, true)
    },
    [library, sources],
  )

  const handleToggleSave = useCallback(async () => {
    if (!library || !album.data?.urn) return
    const next = !isSaved
    await library.setSaved(album.data.urn, next)
    setIsSaved(next)
  }, [library, album.data?.urn, isSaved])

  const rawTracks = album.data?.tracks ?? []
  const tracks = useMemo(() => {
    const seen = new Set<string>()
    return rawTracks.filter((t) => {
      if (!t.urn || seen.has(t.urn)) return false
      seen.add(t.urn)
      return true
    })
  }, [rawTracks])

  const sortedTracks = useMemo(() => {
    const list = [...tracks]
    if (sortKey === 'trackNo') {
      return sortOrder === 'desc' ? list.reverse() : list
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'duration') {
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
      } else if (sortKey === 'album' || sortKey === 'plays') {
        const aAlb = a.albumTitle || album.data?.title || ''
        const bAlb = b.albumTitle || album.data?.title || ''
        cmp = aAlb.localeCompare(bAlb, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'source') {
        const aSrc = resolveTrackSourceName(ctx, a.urn)
        const bSrc = resolveTrackSourceName(ctx, b.urn)
        cmp = aSrc.localeCompare(bSrc, undefined, { numeric: true, sensitivity: 'base' })
      }
      return sortOrder === 'desc' ? -cmp : cmp
    })
    return list
  }, [tracks, sortKey, sortOrder, album.data?.title])

  const sortedUrns = useMemo(() => sortedTracks.map((track) => track.urn), [sortedTracks])

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
    if (toPlay.length > 0 && album.data) {
      void player?.playNow(toPlay, {
        context: { kind: 'album', urn: album.data.urn, label: album.data.title },
      })
    }
  }

  const handleBatchAddToPlaylist = (anchor?: MenuAnchor) => {
    const toAdd = Array.from(selectedUrns)
    if (toAdd.length > 0) {
      const trackMap = new Map(tracks.map((t) => [t.urn, t]))
      const selectedTracks = toAdd.map((u) => trackMap.get(u) ?? u)
      saveToPlaylistMenu.openBatch(
        selectedTracks,
        anchor ?? {
          x: typeof window !== 'undefined' ? window.innerWidth / 2 : 200,
          y: typeof window !== 'undefined' ? window.innerHeight / 2 : 200,
        },
      )
    }
  }

  const handleBatchDelete = async () => {
    if (selectedUrns.size === 0) return
    for (const u of selectedUrns) {
      if (sources?.setLoved) {
        await sources.setLoved(u, false).catch(() => {})
      }
      if (library) {
        await library.setSaved(u, false).catch(() => {})
      }
    }
    setSavedTrackUrns((prev) => {
      const next = new Set(prev)
      for (const u of selectedUrns) next.delete(u)
      return next
    })
    setSelectedUrns(new Set())
  }

  const handleExitBatch = () => {
    setIsBatchMode(false)
    setSelectedUrns(new Set())
  }

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: 'alert',
      title: 'Album unavailable',
      description: album.error?.message,
    })
  }

  const detail = album.data

  const isLocalAlbum = Boolean(
    detail.urn.startsWith('BBeBee:local:') ||
      detail.urn.startsWith('local:') ||
      (detail.tracks.length > 0 &&
        detail.tracks.every((t) => t.urn.startsWith('BBeBee:local:') || t.urn.startsWith('local:'))),
  )

  const parsedUrn = tryParseUrn(detail.urn)
  const isThirdParty = Boolean(
    (parsedUrn && parsedUrn.sourceId && parsedUrn.sourceId !== 'local') || !isLocalAlbum,
  )
  const sourceId = parsedUrn?.sourceId && parsedUrn.sourceId !== 'local' ? parsedUrn.sourceId : undefined
  const sourceRecord = sourceId && typeof sources?.get === 'function' ? sources.get(sourceId) : undefined
  const sourcePlugin = sourceId && typeof sources?.source === 'function' ? sources.source(sourceId) : undefined
  const sourceName = sourcePlugin?.doc?.sourceName || sourceRecord?.displayName || sourceId

  const collectionSubmenu = addToCollectionSubmenu(library, [detail.urn], collections, {
    title: '加入文件夹',
  })

  const albumMenuItems: MenuItemSpec[] = isBatchMode
    ? [
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
    : [
        {
          id: 'batch-operations',
          label: '批量操作',
          icon: tablerIcon('list-check', { size: 20 }),
          divider: true,
          onSelect: () => setIsBatchMode(true),
        },
      ]

  const albumResourceUrl = resolveOriginalResourceUrl({ urn: detail.urn, kind: 'album' })
  if (albumResourceUrl) {
    albumMenuItems.push({
      id: 'open-original-resource',
      label: '跳转原始资源',
      icon: tablerIcon('share-box', { size: 20 }),
      onSelect: () => openExternalUrl(albumResourceUrl),
    })
  }

  if (collectionSubmenu) {
    albumMenuItems.push({
      id: 'add-to-folder',
      label: '加入文件夹',
      icon: tablerIcon('folder', { size: 20 }),
      submenu: collectionSubmenu,
    })
  }

  albumMenuItems.push({
    id: 'toggle-library',
    label: isSaved ? '从音乐库中删除' : '添加到音乐库',
    icon: isSaved ? tablerIcon('heart', { size: 20 }) : tablerIcon('heart-filled', { size: 20 }),
    tone: isSaved ? 'danger' : undefined,
    onSelect: () => void handleToggleSave(),
  })

  if (player) {
    albumMenuItems.push({
      id: 'enqueue',
      label: '加入播放列表',
      icon: tablerIcon('playlist-add', { size: 20 }),
      onSelect: () => player.enqueueLast(sortedUrns),
    })
  }

  if (!isLocalAlbum && downloads) {
    albumMenuItems.push({
      id: 'download',
      label: '下载',
      icon: tablerIcon('download', { size: 20 }),
      onSelect: () => void downloads.enqueue(sortedUrns),
    })
  }

  const share = serviceOf<ShareService>(ctx, 'share')
  if (share && detail) {
    albumMenuItems.push({
      id: 'share-album',
      label: '分享专辑',
      icon: tablerIcon('share', { size: 20 }),
      onSelect: () => {
        const coverUrl = typeof detail.artwork === 'string'
          ? detail.artwork
          : (detail.artwork as { sourceUrl?: string } | undefined)?.sourceUrl
        share.shareAlbum(
          {
            urn: detail.urn,
            title: detail.title,
            artist: detail.artists?.map((a) => a.name).join(', ') || '未知艺人',
            artwork: coverUrl,
            year: detail.year,
            trackCount: detail.tracks.length,
          },
          detail.tracks,
        )
      },
    })
  }

  const sleepSubmenu = sleepTimerSubmenu(sleepTimer)
  if (sleepSubmenu) {
    albumMenuItems.push({
      id: 'sleep-timer',
      label: sleepTimer?.state.active ? '睡眠定时器 (已开启)' : '睡眠定时器',
      icon: tablerIcon('clock', { size: 20 }),
      submenu: sleepSubmenu,
    })
  }

  const handleHeaderClick = (key: AlbumSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const sortLabelMap: Record<AlbumSortKey, string> = {
    trackNo: '默认顺序',
    title: '标题',
    album: '专辑',
    plays: '专辑',
    source: '来源',
    duration: '时长',
  }

  const sortItems = sortMenuItems(
    [
      { id: 'trackNo', label: '默认顺序' },
      { id: 'title', label: '标题' },
      { id: 'album', label: '专辑' },
      { id: 'source', label: '来源' },
      { id: 'duration', label: '时长' },
    ],
    sortKey,
    (id) => setSortKey(id as AlbumSortKey),
    { value: sortOrder, onChange: setSortOrder },
  )

  const yearText = detail.year || (detail.releaseDate ? detail.releaseDate.slice(0, 4) : '')
  const totalDurationStr = formatTotalDuration(detail.tracks)

  const renderPlayButton = (size: number, iconSize: number, testID: string | undefined) =>
    h(DetailPlayButton, {
      size,
      iconSize,
      testID,
      ariaLabel: 'Play album',
      srText: 'Play album',
      onPress: () =>
        void player?.playNow(sortedUrns, {
          context: { kind: 'album', urn: detail.urn, label: detail.title },
        }),
      disabled: detail.tracks.length === 0,
    })

  // 随列表一起滚走的部分：封面 hero、操作条、表头。
  // 吸顶栏单独走 List 的 sticky 插槽（滚动容器的直接子节点）。
  const stickyBar = h(StickyDetailBar, {
    title: detail.title,
    progress: collapse.slide,
    docked: collapse.docked,
    tint,
    playButton: renderPlayButton(48, 24, 'album-play-sticky'),
  })

  // 渐变只存在于头部区域（随内容滚走），到底边精确过渡为纯色；下方内容
  // 与吸附后的表头都是纯色 --bg-primary。
  const headerNode = h(
    'div',
    {
      style: { background: headerGradient(tint), position: 'relative' },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        setAlbumMenuAnchor({ x: e.clientX, y: e.clientY })
      },
    },
    isThirdParty && sourceName
      ? h(
          'div',
          {
            'data-testid': 'album-source-badge',
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
      eyebrow: '专辑',
      title: detail.title,
      titleSize: detail.title.length > 25 ? 40 : 54,
      cover: h(
        'div',
        {
          style: {
            width: 232,
            height: 232,
            flexShrink: 0,
            borderRadius: 6,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          },
        },
        h(CachedArtwork, { ctx, artwork: detail.artwork, seed: detail.urn, size: 232, radius: 6 }),
      ),
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
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
            },
          },
          detail.artists?.[0]?.name?.[0]
            ? detail.artists[0].name[0].toUpperCase()
            : tablerIcon('music', { size: 18 }),
        ),
        h('span', { style: { fontWeight: 700, color: '#FFFFFF' } }, detail.artists?.map((a) => a.name).join(', ') || '未知艺人'),
        yearText ? h('span', null, ` • ${yearText}`) : null,
        h('span', null, ` • ${detail.tracks.length} 首歌曲`),
        totalDurationStr ? h('span', null, `, ${totalDurationStr}`) : null,
      ),
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
        h('div', { ref: collapse.anchorRef, style: { display: 'flex' } }, renderPlayButton(56, 28, undefined)),
        h(
          'button',
          {
            type: 'button',
            title: '随机播放',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: () => {
              if (sortedUrns.length > 0) {
                const shuffled = [...sortedUrns].sort(() => Math.random() - 0.5)
                void player?.playNow(shuffled, {
                  context: { kind: 'album', urn: detail.urn, label: detail.title },
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
            'data-testid': 'album-heart-trigger',
            'aria-label': isSaved ? '从音乐库中删除' : '添加到音乐库',
            title: isSaved ? '从音乐库中删除' : '添加到音乐库',
            onClick: () => void handleToggleSave(),
            style: {
              background: 'none',
              border: 'none',
              color: isSaved ? 'var(--color-primary, #5F87FF)' : '#b3b3b3',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          isSaved
            ? tablerIcon('heart-filled', { size: 26, color: 'var(--color-primary, #5F87FF)' })
            : tablerIcon('heart', { size: 26 }),
        ),
        !isLocalAlbum && downloads
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': 'album-download-all',
                title: '下载全部',
                style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
                onClick: () => void downloads.enqueue(sortedUrns),
              },
              tablerIcon('download', { size: 24 }),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'album-share-action-btn',
            title: '分享专辑',
            'aria-label': '分享专辑',
            onClick: () => {
              const shareService = serviceOf<ShareService>(ctx, 'share')
              if (shareService && detail) {
                const coverUrl = typeof detail.artwork === 'string'
                  ? detail.artwork
                  : (detail.artwork as { sourceUrl?: string } | undefined)?.sourceUrl
                shareService.shareAlbum(
                  {
                    urn: detail.urn,
                    title: detail.title,
                    artist: detail.artists?.map((a) => a.name).join(', ') || '未知艺人',
                    artwork: coverUrl,
                    year: detail.year,
                    trackCount: detail.tracks.length,
                  },
                  detail.tracks,
                )
              }
            },
            style: {
              background: 'none',
              border: 'none',
              color: '#b3b3b3',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            },
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
            'data-testid': 'album-more-trigger',
            title: '更多选项',
            style: { background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
            onClick: async (e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (library) {
                try {
                  const cols = await library.listCollections()
                  setCollections(cols)
                } catch {
                  setCollections([])
                }
              }
              setAlbumMenuAnchor({ x: rect.left, y: rect.bottom + 6 })
            },
          },
          tablerIcon('dots', { size: 24 }),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
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
              'data-testid': 'album-sort-trigger',
              title: '排序方式',
              onClick: (e: React.MouseEvent) => {
                const rect = e.currentTarget.getBoundingClientRect()
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
          allSelected,
          onToggleSelectAll: handleToggleSelectAll,
          onBatchPlay: handleBatchPlay,
          onBatchAddToPlaylist: (anchor) => handleBatchAddToPlaylist(anchor),
          onBatchDelete: handleBatchDelete,
          deleteLabel: '从“最喜欢”中删除',
          onExitBatch: handleExitBatch,
        })
      : null,
  )

  // 表头走 stickyHeader 插槽（滚动容器的直接子节点）——嵌在 header 盒内时
  // sticky 只在父盒范围吸附，作为父盒最后一个子元素等于完全吸不住。
  const tableHeaderNode = h(DetailTableHeader, {
    testID: 'album-table-header',
    accessibilityLabel: detail.title,
    columns: [
      { key: 'trackNo', label: '#', testID: 'album-sort-trackNo', width: 40, align: 'center' },
      { key: 'title', label: '标题', testID: 'album-sort-title', flex: 2, paddingLeft: 12 },
      { key: 'artist', label: '艺人', plain: true, flex: 1, visible: viewMode === 'compact' },
      { key: 'album', label: '专辑', testID: 'album-sort-album', flex: 1.5, fixed: true, sortKeys: ['album', 'plays'] },
      { key: 'source', label: '来源', testID: 'album-sort-source', flex: 1, paddingLeft: 8 },
      { key: 'duration', label: '', icon: tablerIcon('clock', { size: 18 }), testID: 'album-sort-duration', width: 130, align: 'right', paddingRight: 40 },
    ] satisfies DetailColumnSpec[],
    sortKey,
    sortDirection: sortOrder,
    onSort: (key) => handleHeaderClick(key as AlbumSortKey),
    solid: collapse.docked,
  })

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #080A10)',
        color: '#FFFFFF',
        overflow: 'hidden',
      },
    },
    // Track list — the header scrolls away inside the same scroller, and the
    // sticky bar rides on top of it.
    h(
      'div',
      { ref: collapse.scrollerRef, style: { flex: 1, minHeight: 0 } },
      h(List<Track>, {
        header: headerNode,
        sticky: stickyBar,
        stickyHeader: tableHeaderNode,
        onScroll: collapse.handleScroll,
        items: sortedTracks,
        accessibilityLabel: `Tracks on ${detail.title}`,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (track) => track.urn,
        pageSize: 30,
        onEndReached: isThirdParty && album.hasMore ? album.loadMore : undefined,
        empty: h(EmptyState, { title: 'This album has no tracks' }),
        renderItem: (track, index) =>
          h(AlbumTrackTableRow, {
            track,
            index,
            albumTitle: detail.title,
            batchMode: isBatchMode,
            selected: selectedUrns.has(track.urn),
            onToggleSelect: () => handleToggleSelect(track.urn),
            showSource: true,
            sourceName: resolveTrackSourceName(ctx, track.urn),
            // Live saved set first; the row's snapshot `loved` only fills in
            // what the live data has not answered yet.
            inLibrary:
              savedTrackUrns.has(track.urn) ||
              (lovedOverrides.get(track.urn) ?? track.loved === true),
            compact: viewMode === 'compact',
            onAddToFavorites: handleTrackAddToFavorites,
            onOpenPlaylistMenu: (t, anchor) => saveToPlaylistMenu.open(t, anchor),
            onPress: () => {
              void player?.playFromContext(track.urn, sortedUrns, {
                context: { kind: 'album', urn: detail.urn, label: detail.title },
              })
            },
            onDownload: !isLocalAlbum && downloads ? () => void downloads.enqueue([track.urn]) : undefined,
            onMore: (anchor) => menu.open({ track }, anchor),
          }),
      }),
    ),
    h(ContextMenu, menu.menuProps),
    h(ContextMenu, {
      open: albumMenuAnchor !== null,
      onClose: () => setAlbumMenuAnchor(null),
      x: albumMenuAnchor?.x ?? 0,
      y: albumMenuAnchor?.y ?? 0,
      items: albumMenuItems,
      title: detail.title,
    }),
    h(ContextMenu, {
      open: sortMenuAnchor !== null,
      onClose: () => setSortMenuAnchor(null),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: viewModeMenuItems(sortItems, viewMode, setViewMode),
      title: '排序方式',
    }),
    h(SaveToPlaylistPopover, saveToPlaylistMenu.menuProps),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-album-ui-desktop'

/**
 * `sources` is required (the album read goes through it); `player` and
 * `downloads` are read with `serviceOf`, so a build without either draws the
 * screen without the control that would call it.
 */
export const inject = ['ui', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-album-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(ALBUM_VIEWS.album, bound(ctx, AlbumScreen))
  }, 'album-ui-desktop')
}

export default { name, inject, apply }
