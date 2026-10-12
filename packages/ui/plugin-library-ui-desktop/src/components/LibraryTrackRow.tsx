import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { HoverLabel, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { formatAddedDate, formatDuration } from '@BBeBee/toolkit'
import { CachedArtwork } from './CachedArtwork.js'
import { TrackLibraryActionButton } from './TrackLibraryActionButton.js'

export interface LibraryTrackRowProps {
  ctx: Context
  track: Track
  index: number
  /** Compact view: no artwork, artist as its own column. */
  compact?: boolean
  /** Live saved state: shows a plus when unsaved, a red heart when saved. */
  inLibrary: boolean
  /** Whether to highlight the row (e.g. a track just drag-and-drop imported). */
  highlighted?: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
  /** Favorite action when the plus is clicked (the plus has no side effect when omitted). */
  onAddToFavorites?: (track: Track) => void
  /** When passed, the album name becomes a clickable link (local music page jumps to the album). */
  onOpenAlbum?: (track: Track) => void
  /** When passed, shows the "Date added" column (playlist page). */
  addedAt?: number
  /** When passed, shows the "Remove from this playlist" button (playlist page, except smart playlists). */
  onRemove?: () => void
  isSmart?: boolean
  playlistName?: string
  /** Batch mode: the first column shows a checkbox; clicking the row toggles selection */
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** Whether to show the source column */
  showSource?: boolean
  sourceName?: string
}

/**
 * The detail table's track row, written once for Local music / Favorites / Playlists.
 *
 * The column skeleton is shared — #/play, artwork + title + artist, optional
 * compact artist column, album, optional added-date, actions (library button,
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
  const { t } = useI18n(ctx)
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
          color: hovered ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #b3b3b3)',
        },
      },
      batchMode
        ? h('input', {
            type: 'checkbox',
            'data-testid': `track-checkbox-${track.urn}`,
            'aria-label': selected ? t('library:libraryTrack.deselect') : t('library:libraryTrack.select'),
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
        ? tablerIcon('play', { size: 18, color: 'currentColor' })
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
        // When the song/artist name is truncated, hovering for 2s reveals a label with the full name.
        h(
          HoverLabel,
          { label: track.title, style: { display: 'block' } },
          h(
            'span',
            {
              style: {
                display: 'block',
                color: 'var(--bb-text-primary, #FFFFFF)',
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
                    color: 'var(--bb-text-secondary, #b3b3b3)',
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
              color: 'var(--bb-text-secondary, #b3b3b3)',
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
    // Col 3: Album (a clickable link on the local music page)
    h(
      'div',
      {
        style: {
          flex: 1.5,
          minWidth: 0,
          paddingRight: 16,
          fontSize: 14,
          color: 'var(--bb-text-secondary, #b3b3b3)',
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
              'aria-label': t('library:libraryTrack.viewAlbum', { albumTitle: track.albumTitle }),
              title: t('library:libraryTrack.viewAlbum', { albumTitle: track.albumTitle }),
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
                e.currentTarget.style.color = 'var(--bb-text-primary, #FFFFFF)'
                e.currentTarget.style.textDecoration = 'underline'
              },
              onMouseLeave: (e: ReactMouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.color = 'var(--bb-text-secondary, #b3b3b3)'
                e.currentTarget.style.textDecoration = 'none'
              },
            },
            track.albumTitle,
          )
        : track.albumTitle || '-',
    ),
    // Col: Source name (album/favorites/playlist pages)
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
              color: 'var(--text-tertiary, #8B95B0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          sourceName ?? '-',
        )
      : null,
    // Col 4: Added date (playlist page)
    addedAt !== undefined
      ? h(
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
        ctx,
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
              'aria-label': t('library:index.removeFrom', {
                title: track.title,
                name: playlistName ?? t('library:playlistDetail.playlist'),
              }),
              title: t('library:libraryTrack.removeFromPlaylist', {
                name: playlistName ?? t('library:playlistDetail.playlist'),
              }),
              onClick: (e: ReactMouseEvent) => {
                e.stopPropagation()
                onRemove()
              },
              style: {
                background: 'none',
                border: 'none',
                color: 'var(--bb-text-secondary, #b3b3b3)',
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
            color: 'var(--bb-text-secondary, #b3b3b3)',
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
          'aria-label': t('library:libraryTrack.more'),
          title: t('library:libraryTrack.more'),
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: 'var(--bb-text-secondary, #b3b3b3)',
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
