import { createElement as h, memo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { Artwork, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface QueueTrackRowProps {
  ctx: Context
  track: Track
  active?: boolean
  itemId?: string
  extraRight?: string
  onPress?: () => void
  onMore?: (anchor: { x: number; y: number }) => void
  /** Present on upcoming rows only; shuffle and the fixed sections get none. */
  draggable?: boolean
  dragging?: boolean
  /** Accent line at the row's top edge marking where the drop would land. */
  dropBefore?: boolean
  /** Accent line at the row's bottom edge marking where the drop would land. */
  dropAfter?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  /** Alt+↑/↓ reorder for keyboard users; wired on upcoming rows only. */
  onKeyboardMove?: (direction: -1 | 1) => void
}

export const QueueTrackRow = memo(
  function QueueTrackRow({
    ctx,
    track,
    active = false,
    itemId,
    extraRight,
    onPress,
    onMore,
    draggable = false,
    dragging = false,
    dropBefore = false,
    dropAfter = false,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onKeyboardMove,
  }: QueueTrackRowProps): ReactElement {
    const [hovered, setHovered] = useState(false)
    const artwork = useResolvedArtwork(ctx, track.artwork)
    const artists = track.artists?.map((a) => a.name).join(', ')

    return h(
      'div',
      {
        role: 'row',
        tabIndex: 0,
        'data-track-urn': track.urn,
        'data-item-id': itemId,
        draggable,
        onDragStart: draggable && onDragStart ? onDragStart : undefined,
        onDragOver: draggable ? onDragOver : undefined,
        onDrop: draggable ? onDrop : undefined,
        onDragEnd: draggable ? onDragEnd : undefined,
        onClick: onPress,
        onContextMenu: onMore
          ? (e: { preventDefault: () => void; clientX?: number; clientY?: number }) => {
              e.preventDefault()
              onMore({ x: e.clientX ?? 0, y: e.clientY ?? 0 })
            }
          : undefined,
        onKeyDown: (e: { key: string; altKey?: boolean; preventDefault: () => void }) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onPress?.()
          }
          if (onKeyboardMove && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            onKeyboardMove(e.key === 'ArrowUp' ? -1 : 1)
          }
        },
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 10px',
          borderRadius: tokens.radius.sm,
          position: 'relative',
          cursor: draggable ? 'grab' : 'pointer',
          opacity: dragging ? 0.4 : 1,
          background: hovered ? 'var(--surface-hover, rgba(255, 255, 255, 0.08))' : 'transparent',
          transition: 'background-color 0.15s ease',
          outline: 'none',
        },
      },
      dropBefore
        ? h('div', {
            'aria-hidden': true,
            style: {
              position: 'absolute',
              top: -2,
              left: 8,
              right: 8,
              height: 2,
              borderRadius: 2,
              background: 'var(--tab-active, var(--color-primary, #5F87FF))',
              pointerEvents: 'none',
            },
          })
        : null,
      dropAfter
        ? h('div', {
            'aria-hidden': true,
            style: {
              position: 'absolute',
              bottom: -2,
              left: 8,
              right: 8,
              height: 2,
              borderRadius: 2,
              background: 'var(--tab-active, var(--color-primary, #5F87FF))',
              pointerEvents: 'none',
            },
          })
        : null,
      h(
        'div',
        {
          style: {
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: tokens.radius.sm,
            overflow: 'hidden',
            flexShrink: 0,
          },
        },
        h(Artwork, {
          artwork,
          seed: track.urn,
          size: 48,
          radius: tokens.radius.sm,
        }),
        hovered
          ? h(
              'div',
              {
                'aria-label': 'Play',
                'data-testid': 'queue-track-play-overlay',
                style: {
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: tokens.radius.sm,
                  transition: 'opacity 0.15s ease',
                  pointerEvents: 'none',
                },
              },
              tablerIcon('play', { size: 20, color: '#FFFFFF' }),
            )
          : null,
      ),
      h(
        'div',
        {
          style: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          },
        },
        h(
          'span',
          {
            'data-active': active ? 'true' : undefined,
            style: {
              fontSize: 14,
              fontWeight: 600,
              color: active ? 'var(--color-primary, var(--primary, #5F87FF))' : 'var(--bb-text-primary, #FFFFFF)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          track.title,
        ),
        artists
          ? h(
              'span',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--bb-text-secondary, #A0A0AE)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              artists,
            )
          : null,
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            minWidth: 44,
            flexShrink: 0,
            marginLeft: 8,
          },
        },
        hovered && onMore
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': 'queue-track-more-btn',
                'aria-label': 'More options',
                title: 'More options',
                onClick: (e: { stopPropagation: () => void; currentTarget: HTMLElement }) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  onMore({ x: rect.left, y: rect.bottom + 4 })
                },
                style: {
                  background: 'none',
                  border: 'none',
                  color: 'var(--bb-text-primary, #FFFFFF)',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: tokens.radius.sm,
                  outline: 'none',
                  transition: 'background-color 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                },
              },
              tablerIcon('dots', { size: 18, color: 'currentColor' }),
            )
          : extraRight
          ? h(
              'span',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--bb-text-secondary, #8E8E93)',
                },
              },
              extraRight,
            )
          : null,
      ),
    )
  },
  (prev, next) =>
    prev.track.urn === next.track.urn &&
    prev.track.title === next.track.title &&
    prev.track.artwork === next.track.artwork &&
    prev.active === next.active &&
    prev.itemId === next.itemId &&
    prev.extraRight === next.extraRight &&
    prev.draggable === next.draggable &&
    prev.dragging === next.dragging &&
    prev.dropBefore === next.dropBefore &&
    prev.dropAfter === next.dropAfter,
)
