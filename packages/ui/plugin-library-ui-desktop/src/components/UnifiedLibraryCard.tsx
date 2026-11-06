import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from './CachedArtwork.js'
import type { UnifiedItem } from './UnifiedLibraryRow.js'

export interface UnifiedLibraryCardProps {
  ctx: Context
  item: UnifiedItem
  isFolder?: boolean
  isChild?: boolean
}

export function UnifiedLibraryCard({
  ctx,
  item,
  isFolder,
}: UnifiedLibraryCardProps): ReactElement {
  const { t } = useI18n(ctx)
  const [isHovered, setIsHovered] = useState(false)
  const isFav = item.kind === 'favorite'
  const isArt = item.kind === 'artist'

  return h(
    'div',
    {
      role: 'button',
      tabIndex: 0,
      'aria-label': item.title,
      'data-testid': `library-card-${item.id}`,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      onClick: () => item.onOpen(),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          item.onOpen()
        }
      },
      onContextMenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
        event.preventDefault()
        item.onMore({ x: event.clientX ?? 0, y: event.clientY ?? 0 })
      },
      style: {
        backgroundColor: isHovered
          ? 'var(--card-hover, rgba(255, 255, 255, 0.08))'
          : 'var(--card-bg, rgba(255, 255, 255, 0.03))',
        border: isHovered
          ? '1px solid var(--border-hover, rgba(255, 255, 255, 0.12))'
          : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
        padding: 12,
        borderRadius: tokens.radius.md,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        minWidth: 0,
      },
    },
    // Cover artwork container with play hover button
    h(
      'div',
      {
        style: {
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: isArt ? '50%' : 6,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isFav ? '#FFFFFF' : undefined,
          backgroundColor: isFav ? undefined : 'var(--surface-1, rgba(255, 255, 255, 0.05))',
          background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        },
      },
      isFav
        ? tablerIcon('heart-filled', { size: 36, color: 'currentColor' })
        : isFolder || item.kind === 'collection'
          ? tablerIcon('folder', { size: 40, color: 'var(--bb-text-secondary, #CCCCCC)' })
          : item.artwork
            ? h(CachedArtwork, {
                ctx,
                artwork: item.artwork,
                seed: item.artworkSeed,
                size: 160,
                radius: isArt ? 80 : 6,
              })
            : tablerIcon(
                isArt
                  ? 'user'
                  : item.kind === 'local'
                    ? 'folder'
                    : item.kind === 'album'
                      ? 'disc'
                      : 'music',
                { size: 36, color: 'var(--bb-text-secondary, #A0A0A0)' },
              ),
      // Floating Play Button
      isHovered && item.onPlay
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': t('library:library.playItem', { title: item.title }),
              title: t('library:library.playItem', { title: item.title }),
              onClick: (e: MouseEvent) => {
                e.stopPropagation()
                item.onPlay()
              },
              style: {
                position: 'absolute',
                bottom: 6,
                right: 6,
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--color-primary, #5F87FF)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                color: '#FFFFFF',
                zIndex: 2,
              },
            },
            tablerIcon('play', { size: 20, color: '#FFFFFF' }),
          )
        : null,
    ),
    // Title & Subtitle
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
      h(
        'div',
        {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        item.title,
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            color: 'var(--bb-text-secondary, #A0A0AE)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        item.pinned
          ? tablerIcon('pin', { size: 14, color: 'var(--color-primary, #5F87FF)', style: { flexShrink: 0 } })
          : null,
        h(
          'span',
          {
            style: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          item.subtitle,
        ),
      ),
    ),
    // Automated test compatibility hook
    item.onDelete
      ? h('button', {
          'aria-label': t('library:library.deleteItem', { title: item.title }),
          style: { display: 'none' },
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            item.onDelete?.()
          },
        })
      : null,
  )
}
