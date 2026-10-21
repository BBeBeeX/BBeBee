import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album } from '@BBeBee/protocol'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { CachedArtwork } from './CachedArtwork.js'

export function LocalAlbumCard({
  ctx,
  album,
  onOpen,
  onPlay,
}: {
  ctx: Context
  album: Album
  onOpen: () => void
  onPlay?: () => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const [hovered, setHovered] = useState(false)
  const artists = album.artists?.map((a) => a.name).join(', ') || t('library:library.unknownArtist')

  return h(
    'div',
    {
      role: 'button',
      tabIndex: 0,
      'aria-label': album.title,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onOpen,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      },
      style: {
        backgroundColor: hovered ? 'var(--card-hover, #282828)' : 'var(--card-bg, #181818)',
        border: hovered
          ? '1px solid var(--card-border-hover, var(--card-border, transparent))'
          : '1px solid var(--card-border, transparent)',
        boxShadow: 'var(--card-shadow, none)',
        padding: 16,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'pointer',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        position: 'relative',
      },
    },
    // Cover container with floating play button
    h(
      'div',
      {
        style: {
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: 'var(--surface-1, var(--color-surface, #242424))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        },
      },
      album.artwork
        ? h(CachedArtwork, { ctx, artwork: album.artwork, seed: album.urn, size: 200, radius: 6 })
        : tablerIcon('disc', { size: 52, color: 'var(--text-tertiary, #7f7f7f)' }),
      // Floating Green Play Button
      onPlay
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': t('library:library.playItem', { title: album.title }),
              title: t('library:library.playItem', { title: album.title }),
              onClick: (e: MouseEvent) => {
                e.stopPropagation()
                onPlay()
              },
              style: {
                position: 'absolute',
                bottom: 8,
                right: 8,
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--glow-brand-sm, 0 4px 16px rgba(95, 135, 255, 0.4))',
                color: 'var(--bb-accent-on, #ffffff)',
                fontSize: 20,
                paddingLeft: 3,
                opacity: hovered ? 1 : 0,
                transform: hovered ? 'translateY(0)' : 'translateY(8px)',
                transition: 'all 0.2s ease',
                zIndex: 2,
              },
            },
            tablerIcon('play', { size: 26, color: 'currentColor' }),
          )
        : null,
    ),
    // Album Title & Artists & Year
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
      h(
        'span',
        {
          style: {
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--bb-text-primary, #FFFFFF)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        album.title,
      ),
      h(
        'span',
        {
          style: {
            fontSize: 13,
            color: 'var(--bb-text-secondary, #b3b3b3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        artists,
      ),
      h(
        'span',
        {
          style: {
            fontSize: 12,
            color: 'var(--bb-text-disabled, #7f7f7f)',
            marginTop: 2,
          },
        },
        album.year
          ? album.trackCount
            ? t('library:localAlbum.yearAndTracks', { year: album.year, trackCount: album.trackCount })
            : t('library:localAlbum.yearAndAlbum', { year: album.year })
          : album.trackCount
            ? t('library:localAlbum.tracks', { trackCount: album.trackCount })
            : t('library:localAlbum.albumFallback'),
      ),
    ),
  )
}
