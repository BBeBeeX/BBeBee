import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album, Artist, DownloadsService, Playlist, SourceError, Track, UiService } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { playFromList, type SourcePaginationState } from '@BBeBee/plugin-sources/hooks'
import { Button, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, CachedTrackRow } from './CachedArtwork.js'

const p = () => palettes.dark

export interface SourcePanelProps {
  ctx: Context
  sourceId: string
  sourceName: string
  tracks?: readonly Track[]
  albums?: readonly Album[]
  artists?: readonly Artist[]
  playlists?: readonly Playlist[]
  error?: SourceError
  pending?: boolean
  tookMs?: number
  searchQuery?: string
  expanded: boolean
  pagination?: SourcePaginationState
  maxHeight?: number | string
  onToggle: () => void
  onLoadMore?: (sourceId: string) => void
  onOpenAlbum?: (urn: string) => void
  onTrackMenu?: (track: Track, anchor: { x: number; y: number }) => void
}

/**
 * An expandable / collapsible card panel representing one music source's search results.
 * Fully adapted to BBeBee color management (theme CSS variables + design tokens).
 * Supports internal scrolling for all panel contents while keeping the panel header sticky and always visible.
 */
export function SourcePanel({
  ctx,
  sourceId,
  sourceName,
  tracks = [],
  albums = [],
  artists = [],
  playlists = [],
  error,
  pending = false,
  tookMs = 0,
  searchQuery = '',
  expanded,
  pagination,
  maxHeight = 'min(520px, 60vh)',
  onToggle,
  onLoadMore,
  onOpenAlbum,
  onTrackMenu,
}: SourcePanelProps): ReactElement {
  const scheme = p()
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const [headerHovered, setHeaderHovered] = useState(false)

  const trackCount = tracks.length
  const albumCount = albums.length
  const artistCount = artists.length
  const playlistCount = playlists.length
  const totalCount = trackCount + albumCount + artistCount + playlistCount

  const summaryParts: string[] = []
  if (trackCount > 0) summaryParts.push(`${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`)
  if (albumCount > 0) summaryParts.push(`${albumCount} ${albumCount === 1 ? 'album' : 'albums'}`)
  if (artistCount > 0) summaryParts.push(`${artistCount} ${artistCount === 1 ? 'artist' : 'artists'}`)
  if (playlistCount > 0) summaryParts.push(`${playlistCount} ${playlistCount === 1 ? 'playlist' : 'playlists'}`)

  const detailText = error
    ? error.message
    : pending
      ? 'still searching…'
      : summaryParts.length > 0
        ? summaryParts.join(' · ')
        : 'no matches'

  const openAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate(ALBUM_VIEWS.album, { urn })
  }

  const isLoadingMore = pagination?.loading ?? false
  const hasMore = pagination?.hasMore ?? false
  const paginationError = pagination?.error

  return h(
    'div',
    {
      'data-testid': `source-panel-${sourceId}`,
      style: {
        background: 'var(--surface-1, ' + scheme.bg.raised + ')',
        border: '1px solid var(--border-subtle, ' + scheme.border.subtle + ')',
        borderRadius: tokens.radius.md,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: expanded ? maxHeight : undefined,
        transition: `border-color ${tokens.duration.fast}ms, box-shadow ${tokens.duration.fast}ms`,
        position: 'relative',
      },
    },
    // Panel Header (Clickable Accordion Bar)
    h(
      'div',
      {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': expanded,
        'aria-label': `${sourceName} panel`,
        'data-testid': `source-panel-header-${sourceId}`,
        onClick: onToggle,
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        },
        onMouseEnter: () => setHeaderHovered(true),
        onMouseLeave: () => setHeaderHovered(false),
        style: {
          position: 'sticky',
          top: 0,
          zIndex: 10,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${tokens.space[3]}px ${tokens.space[4]}px`,
          background: headerHovered
            ? 'var(--surface-hover, ' + scheme.bg.overlay + ')'
            : 'var(--surface-1, ' + scheme.bg.raised + ')',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: expanded
            ? '1px solid var(--border-subtle, ' + scheme.border.subtle + ')'
            : 'none',
          cursor: 'pointer',
          userSelect: 'none',
          transition: `background ${tokens.duration.fast}ms`,
        },
      },
      // Header Left: Chevron + Source Title + Result Count / Status Badge
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            minWidth: 0,
          },
        },
        // Accordion Icon
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              color: 'var(--text-secondary, ' + scheme.text.secondary + ')',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: `transform ${tokens.duration.fast}ms`,
            },
          },
          tablerIcon('chevron-down', { size: 18 }),
        ),
        // Source Name (role=heading aria-level=2 for accessibility and parity test compatibility)
        h(
          'div',
          {
            role: 'heading',
            'aria-level': 2,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2],
            },
          },
          h(
            Text,
            {
              variant: 'md',
              style: {
                fontWeight: tokens.font.weight.bold,
                color: 'var(--text-primary, ' + scheme.text.primary + ')',
              },
            },
            sourceName,
          ),
        ),
        // Badge: count summary or status
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: tokens.radius.pill,
              fontSize: tokens.font.size.xs,
              fontFamily: tokens.font.family.ui,
              fontWeight: tokens.font.weight.medium,
              letterSpacing: 0.2,
              background: error
                ? 'rgba(241, 94, 108, 0.15)'
                : pending
                  ? 'rgba(255, 164, 43, 0.15)'
                  : totalCount > 0
                    ? 'var(--surface-selected, rgba(77, 139, 255, 0.15))'
                    : 'transparent',
              border: `1px solid ${
                error
                  ? 'rgba(241, 94, 108, 0.3)'
                  : pending
                    ? 'rgba(255, 164, 43, 0.3)'
                    : totalCount > 0
                      ? 'var(--border-subtle, rgba(77, 139, 255, 0.25))'
                      : 'var(--border-subtle, ' + scheme.border.subtle + ')'
              }`,
              color: error
                ? 'var(--error, ' + scheme.state.error + ')'
                : pending
                  ? 'var(--warning, ' + scheme.state.warn + ')'
                  : totalCount > 0
                    ? 'var(--color-primary, ' + scheme.accent.base + ')'
                    : 'var(--text-muted, ' + scheme.text.disabled + ')',
            },
          },
          detailText,
        ),
      ),
      // Header Right: Latency & Quick Hint
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
          },
        },
        tookMs > 0
          ? h(
              'span',
              {
                style: {
                  fontSize: tokens.font.size.xs,
                  color: 'var(--text-tertiary, #8B95B0)',
                  fontFamily: tokens.font.family.mono,
                },
              },
              `${tookMs} ms`,
            )
          : null,
        h(
          'span',
          {
            style: {
              fontSize: tokens.font.size.xs,
              color: 'var(--text-tertiary, #8B95B0)',
            },
          },
          expanded ? '收起' : '展开',
        ),
      ),
    ),
    // Panel Body (Rendered when expanded)
    expanded
      ? h(
          'div',
          {
            'data-testid': `source-panel-body-${sourceId}`,
            style: {
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: tokens.space[2],
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1],
            },
          },
          // Error Message Box
          error
            ? h(
                'div',
                {
                  style: {
                    padding: tokens.space[3],
                    borderRadius: tokens.radius.sm,
                    background: 'rgba(241, 94, 108, 0.1)',
                    border: '1px solid rgba(241, 94, 108, 0.25)',
                    color: 'var(--error, ' + scheme.state.error + ')',
                    fontSize: tokens.font.size.sm,
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                  },
                },
                tablerIcon('alert', { size: 18 }),
                h('span', null, error.message),
              )
            : null,
          // Pending State
          pending && !error
            ? h(
                'div',
                {
                  style: {
                    padding: tokens.space[4],
                    textAlign: 'center',
                    color: 'var(--text-secondary, ' + scheme.text.secondary + ')',
                    fontSize: tokens.font.size.sm,
                  },
                },
                '正在搜索该源，请稍候…',
              )
            : null,
          // Empty State
          !pending && !error && totalCount === 0
            ? h(
                'div',
                {
                  style: {
                    padding: `${tokens.space[4]}px ${tokens.space[2]}px`,
                    textAlign: 'center',
                    color: 'var(--text-muted, ' + scheme.text.disabled + ')',
                    fontSize: tokens.font.size.sm,
                  },
                },
                '暂无匹配结果',
              )
            : null,
          // Tracks List
          tracks.map((track) =>
            h(CachedTrackRow, {
              key: `track:${track.urn}`,
              ctx,
              track,
              showAlbum: true,
              onPress: () =>
                void playFromList(ctx, track.urn, {
                  urns: [track.urn],
                  context: { kind: 'search', label: searchQuery },
                }),
              onDownload: downloads ? () => void downloads.enqueue([track.urn]) : undefined,
              onMore: onTrackMenu ? (anchor) => onTrackMenu(track, anchor) : undefined,
            }),
          ),
          // Albums List
          albums.map((album) =>
            h(
              'button',
              {
                key: `album:${album.urn}`,
                type: 'button',
                onClick: () => openAlbum(album.urn),
                'aria-label': album.title,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[3],
                  width: '100%',
                  padding: tokens.space[2],
                  background: 'transparent',
                  border: 'none',
                  borderRadius: tokens.radius.sm,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text-primary, ' + scheme.text.primary + ')',
                  transition: `background ${tokens.duration.fast}ms`,
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.background = 'var(--surface-hover, ' + scheme.bg.overlay + ')'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.background = 'transparent'
                },
              },
              h(CachedArtwork, {
                ctx,
                artwork: album.artwork,
                seed: album.urn,
                size: tokens.size.artworkThumb,
              }),
              h(
                'span',
                { style: { display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 } },
                h(
                  Text,
                  {
                    numberOfLines: 1,
                    style: { color: 'var(--text-primary, ' + scheme.text.primary + ')' },
                  },
                  album.title,
                ),
                h(
                  Text,
                  {
                    variant: 'sm',
                    tone: 'muted',
                    numberOfLines: 1,
                    style: { color: 'var(--text-secondary, ' + scheme.text.secondary + ')' },
                  },
                  album.artists?.map((a) => a.name).join(', ') ?? '',
                ),
              ),
            ),
          ),
          // Artists List
          artists.map((artist) =>
            h(
              'div',
              {
                key: `artist:${artist.urn}`,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[3],
                  padding: tokens.space[2],
                },
              },
              h(CachedArtwork, {
                ctx,
                artwork: artist.artwork,
                seed: artist.urn,
                size: tokens.size.artworkThumb,
              }),
              h(
                'span',
                { style: { minWidth: 0 } },
                h(
                  Text,
                  {
                    numberOfLines: 1,
                    style: { color: 'var(--text-primary, ' + scheme.text.primary + ')' },
                  },
                  artist.name,
                ),
              ),
            ),
          ),
          // Playlists List
          playlists.map((playlist) =>
            h(
              'div',
              {
                key: `playlist:${playlist.urn}`,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[3],
                  padding: tokens.space[2],
                },
              },
              h(CachedArtwork, {
                ctx,
                artwork: playlist.artwork,
                seed: playlist.urn,
                size: tokens.size.artworkThumb,
              }),
              h(
                'span',
                { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                h(
                  Text,
                  {
                    numberOfLines: 1,
                    style: { color: 'var(--text-primary, ' + scheme.text.primary + ')' },
                  },
                  playlist.name,
                ),
                playlist.owner
                  ? h(
                      Text,
                      {
                        variant: 'sm',
                        tone: 'muted',
                        numberOfLines: 1,
                        style: { color: 'var(--text-secondary, ' + scheme.text.secondary + ')' },
                      },
                      playlist.owner,
                    )
                  : null,
              ),
            ),
          ),
          // Panel Footer: "加载更多" Pagination Button
          !pending && !error && (hasMore || totalCount > 0)
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingTop: tokens.space[2],
                    paddingBottom: tokens.space[1],
                    borderTop: '1px solid var(--border-subtle, ' + scheme.border.subtle + ')',
                    marginTop: tokens.space[2],
                  },
                },
                hasMore
                  ? h(Button, {
                      variant: 'secondary',
                      loading: isLoadingMore,
                      disabled: isLoadingMore,
                      testID: `search-load-more-${sourceId}`,
                      onPress: () => onLoadMore?.(sourceId),
                      children: isLoadingMore ? '加载中…' : '加载更多',
                      style: {
                        minWidth: 120,
                        background: 'var(--surface-2, ' + scheme.bg.overlay + ')',
                        color: 'var(--text-primary, ' + scheme.text.primary + ')',
                        border: '1px solid var(--border-subtle, ' + scheme.border.subtle + ')',
                      },
                    })
                  : h(
                      Text,
                      {
                        variant: 'xs',
                        tone: 'muted',
                        style: { color: 'var(--text-tertiary, #8B95B0)', letterSpacing: 0.5 },
                      },
                      '已加载全部结果',
                    ),
                paginationError
                  ? h(
                      'div',
                      {
                        style: {
                          marginLeft: tokens.space[2],
                          display: 'flex',
                          alignItems: 'center',
                          gap: tokens.space[1],
                          color: 'var(--error, ' + scheme.state.error + ')',
                          fontSize: tokens.font.size.xs,
                        },
                      },
                      h('span', null, `加载失败: ${paginationError.message}`),
                      h(Button, {
                        variant: 'ghost',
                        onPress: () => onLoadMore?.(sourceId),
                        children: '重试',
                      }),
                    )
                  : null,
              )
            : null,
        )
      : null,
  )
}
