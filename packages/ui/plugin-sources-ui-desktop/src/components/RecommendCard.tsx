import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry } from '@BBeBee/protocol'
import { Artwork, Text } from '@BBeBee/ui-kit-desktop'
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

  return h(
    'button',
    {
      type: 'button',
      'data-testid': 'recommend-card',
      onClick: () => onPress?.(entry),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
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
          transform: hovered ? 'translateY(-2px)' : 'none',
          transition: 'transform 0.15s ease',
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
            background: 'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
            pointerEvents: 'none',
          },
        },
        // The play chip is for cards that open something playable. A
        // placeholder ("当前资源无效") opens nothing, and offering a play
        // button that does nothing is the lie the chip exists to avoid.
        entry.kind === 'album'
          ? h(
              'div',
              {
                style: {
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--bb-accent-on, #FFFFFF)',
                  boxShadow: 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))',
                },
              },
              '▶',
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
