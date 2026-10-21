import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry } from '@BBeBee/protocol'
import { Artwork, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { tokens } from '@BBeBee/ui-tokens'

/**
 * One recommendation card — the shelf's and the grid's common atom.
 *
 * Cover square on top, two-line title, one-line subtitle, in the shape of the
 * streaming-standard playlist card: the cover carries the hover affordance
 * (a lift and a play chip) because that is where the eye already is, and the
 * text stays still so a skim reads titles, not wiggling rows.
 */
export function RecommendCard({
  ctx,
  entry,
  size = 160,
  onPress,
}: {
  ctx: Context
  entry: BrowseEntry
  size?: number
  onPress?: (entry: BrowseEntry) => void
}): ReactElement {
  const artwork = useResolvedArtwork(ctx, entry.artwork)
  const [hovered, setHovered] = useState(false)
  const [playHovered, setPlayHovered] = useState(false)

  return h(
    'button',
    {
      type: 'button',
      'data-testid': 'recommend-card',
      onClick: () => onPress?.(entry),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        setHovered(false)
        setPlayHovered(false)
      },
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: tokens.space[2],
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        width: size,
        flexShrink: 0,
      },
    },
    h(
      'div',
      {
        style: {
          position: 'relative',
          width: size,
          height: size,
          borderRadius: tokens.radius.md,
          overflow: 'hidden',
          transform: hovered ? 'translateY(-4px)' : 'none',
          boxShadow: hovered
            ? 'var(--card-shadow-elevated, 0 10px 24px rgba(0, 0, 0, 0.45))'
            : '0 2px 8px rgba(0, 0, 0, 0.2)',
          transition:
            'transform 0.24s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 0.24s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1))',
        },
      },
      h(Artwork, {
        artwork,
        seed: entry.id,
        size,
        radius: tokens.radius.md,
      }),
      h(
        'div',
        {
          style: {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 10,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.5) 100%)',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1))',
            pointerEvents: 'none',
          },
        },
        // The play chip is for cards that open something playable. A
        // placeholder ("invalid resource") opens nothing, and offering a play
        // button that does nothing is the lie the chip exists to avoid.
        entry.kind === 'album'
          ? h(
              'div',
              {
                onMouseEnter: () => setPlayHovered(true),
                onMouseLeave: () => setPlayHovered(false),
                style: {
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--bb-accent-on, #FFFFFF)',
                  boxShadow: playHovered
                    ? '0 0 18px rgba(95, 135, 255, 0.65), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255,255,255,0.3))'
                    : 'var(--glow-brand-sm, 0 2px 10px rgba(95, 135, 255, 0.4)), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255,255,255,0.2))',
                  transform: hovered
                    ? playHovered
                      ? 'translateY(0) scale(1.08)'
                      : 'translateY(0) scale(1)'
                    : 'translateY(8px) scale(0.9)',
                  opacity: hovered ? 1 : 0,
                  transition:
                    'transform 0.24s var(--bb-easing-spring, cubic-bezier(0.34, 1.56, 0.64, 1)), opacity 0.2s ease, box-shadow 0.2s ease',
                  pointerEvents: 'auto',
                },
              },
              tablerIcon('player-play-filled', {
                size: 18,
                color: 'currentColor',
              }),
            )
          : null,
      ),
    ),
    h(
      Text,
      {
        variant: 'sm',
        numberOfLines: 2,
        testID: 'recommend-card-title',
      },
      entry.title,
    ),
    entry.subtitle
      ? h(
          Text,
          { variant: 'xs', tone: 'muted', numberOfLines: 1, testID: 'recommend-card-subtitle' },
          entry.subtitle,
        )
      : null,
  )
}
