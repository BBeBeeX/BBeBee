import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { HoverLabel, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { formatAddedDate, formatDuration } from '@BBeBee/toolkit'
import { CachedArtwork } from './CachedArtwork.js'
import { TrackLibraryActionButton } from './TrackLibraryActionButton.js'

export interface LibraryTrackRowProps {
  ctx: Context
  track: Track
  index: number
  /** 紧凑视图：无封面，艺人独立成列。 */
  compact?: boolean
  /** 实时收藏状态：未收藏显示加号，已收藏显示红心。 */
  inLibrary: boolean
  /** 是否高亮显示（例如刚刚拖拽导入的歌曲）。 */
  highlighted?: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
  /** 加号点击时的收藏动作（不传则加号无副作用）。 */
  onAddToFavorites?: (track: Track) => void
  /** 传入后专辑名变为可点击链接（本地音乐页跳转专辑）。 */
  onOpenAlbum?: (track: Track) => void
  /** 传入后显示“添加日期”列（歌单页）。 */
  addedAt?: number
  /** 传入后显示“从此歌单中删除”按钮（歌单页，smart 歌单除外）。 */
  onRemove?: () => void
  isSmart?: boolean
  playlistName?: string
  /** 批量模式：首列显示复选框，整行点击触发选中 */
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** 是否展示来源列 */
  showSource?: boolean
  sourceName?: string
}

/**
 * The detail table's track row, written once for 本地音乐 / 收藏 / 歌单.
 *
 * The column skeleton is shared — #/play, artwork + title + artist, optional
 * compact 艺人 column, album, optional added-date, actions (library button,
 * duration, more) — and each page opts into its extras by prop: the album
 * link (`onOpenAlbum`), the added-date column (`addedAt`), the remove button
 * (`onRemove`).
 */
export function LibraryTrackRow({
  ctx,
  track,
  index,
  compact,
  inLibrary,
  highlighted,
  onPress,
  onMore,
  onOpenPlaylistMenu,
  onAddToFavorites,
  onOpenAlbum,
  addedAt,
  onRemove,
  isSmart,
  playlistName,
  batchMode,
  selected,
  onToggleSelect,
  showSource,
  sourceName,
}: LibraryTrackRowProps): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artists = track.artists?.map((a) => a.name).join(', ')

  const handleRowClick = batchMode ? (onToggleSelect ?? onPress) : onPress

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      'data-highlighted': highlighted ? 'true' : undefined,
      'data-selected': selected ? 'true' : undefined,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: handleRowClick,
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        onMore({ x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') handleRowClick()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 56,
        padding: '0 32px',
        borderRadius: 4,
        cursor: 'pointer',
        background: selected
          ? 'rgba(95, 135, 255, 0.22)'
          : hovered
          ? highlighted
            ? 'rgba(95, 135, 255, 0.28)'
            : 'rgba(255, 255, 255, 0.1)'
          : highlighted
          ? 'rgba(95, 135, 255, 0.18)'
          : 'transparent',
        borderLeft: selected
          ? '3px solid var(--accent-primary, #5F87FF)'
          : highlighted
          ? '3px solid var(--accent-primary, #5F87FF)'
          : '3px solid transparent',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        boxSizing: 'border-box',
      },
    },
    // Col 1: # or Play icon or Checkbox in batch mode
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
            'data-testid': `track-checkbox-${track.urn}`,
            'aria-label': selected ? '取消选择' : '选择',
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
        ? tablerIcon('play', { size: 18, color: '#FFFFFF' })
        : String(index + 1),
    ),
    // Col 2: Artwork (list only) + Title + Artist
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
            track.artwork
              ? h(CachedArtwork, { ctx, artwork: track.artwork, seed: track.urn, size: 40, radius: 4 })
              : tablerIcon('music', { size: 22, color: '#7f7f7f' }),
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
        // 歌名/作者名被截断时，悬浮 2 秒浮出完整名字的 label。
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
    // Col 3: Album (本地音乐页为可点击链接)
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
      onOpenAlbum && track.albumTitle
        ? h(
            'span',
            {
              role: 'button',
              tabIndex: 0,
              'data-testid': `track-album-link-${track.urn}`,
              'aria-label': `查看专辑：${track.albumTitle}`,
              title: `查看专辑：${track.albumTitle}`,
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onOpenAlbum(track)
              },
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onOpenAlbum(track)
                }
              },
              style: {
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: ReactMouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.color = '#FFFFFF'
                e.currentTarget.style.textDecoration = 'underline'
              },
              onMouseLeave: (e: ReactMouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.color = '#b3b3b3'
                e.currentTarget.style.textDecoration = 'none'
              },
            },
            track.albumTitle,
          )
        : track.albumTitle || '-',
    ),
    // Col: Source name (专辑页/最喜欢页/歌单页)
    showSource
      ? h(
          'div',
          {
            'data-testid': 'track-source-col',
            style: {
              flex: 1,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: '#8B95B0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          sourceName ?? '-',
        )
      : null,
    // Col 4: Added date (歌单页)
    addedAt !== undefined
      ? h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              paddingRight: 16,
              fontSize: 13,
              color: '#b3b3b3',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          formatAddedDate(addedAt),
        )
      : null,
    // Col 5: Library button + remove + duration & more
    h(
      'div',
      {
        style: {
          width: 120,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          paddingRight: 16,
        },
      },
      h(TrackLibraryActionButton, {
        track,
        hovered,
        inLibrary,
        onAddToFavorites: onAddToFavorites ? () => onAddToFavorites(track) : undefined,
        onOpenPlaylistMenu,
      }),
      onRemove && !isSmart
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': `Remove ${track.title} from ${playlistName ?? 'playlist'}`,
              title: `Remove from ${playlistName ?? 'playlist'}`,
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onRemove()
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#b3b3b3',
                cursor: 'pointer',
                padding: '2px 4px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: hovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
              },
            },
            tablerIcon('x', { size: 20 }),
          )
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
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: '#b3b3b3',
            cursor: 'pointer',
            padding: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}
