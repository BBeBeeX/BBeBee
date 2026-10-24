/**
 * One recommendation card — the shelf's and the show-all grid's common atom.
 *
 * The mobile twin of the desktop `RecommendCard`: the same shape (square
 * cover, two-line title, one-line subtitle) and the same two-zone contract —
 * the card body opens the album, the cover's play chip plays it, and the chip
 * swallows its own press so the two never both fire. Only the pixels differ:
 * no hover states exist on a phone, so the play chip is always visible rather
 * than fading in, and the icons are the kit's glyph convention (rules/ui.md
 * §4.1 — no Tabler SVG on React Native).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry } from '@BBeBee/protocol'
import { Artwork, IconButton, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@bbebee/plugin-cache/hooks'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

export interface RecommendCardProps {
  ctx: Context
  entry: BrowseEntry
  /** Cover edge in dp. Cards are square. */
  size?: number
  onPress?: (entry: BrowseEntry) => void
  /**
   * Play action for the cover's chip. When present, pressing the chip plays
   * the album and must NOT bubble to `onPress` (which opens it) — two zones,
   * two actions. When absent, no chip renders at all: a placeholder that
   * opens nothing must not offer a play button that does nothing.
   */
  onPlay?: (entry: BrowseEntry) => void
  testID?: string
}

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first — the same
 * arrangement as every other artwork site in this package.
 */
function CardArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

export function RecommendCard({
  ctx,
  entry,
  size = 140,
  onPress,
  onPlay,
  testID,
}: RecommendCardProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)

  return h(
    native.Pressable as never,
    {
      testID,
      accessibilityRole: 'button',
      accessibilityLabel: entry.title,
      onPress: () => onPress?.(entry),
      style: { width: size, flexShrink: 0, gap: tokens.space[2] },
    },
    h(
      native.View as never,
      { style: { position: 'relative', width: size, height: size } },
      h(CardArtwork, { ctx, artwork: entry.artwork, seed: entry.urn ?? entry.id, size, radius: tokens.radius.md }),
      entry.kind === 'album' && onPlay
        ? h(
            native.View as never,
            {
              // A chip riding the cover's bottom-right corner, over a scrim
              // that keeps it legible on light artwork.
              style: {
                position: 'absolute',
                right: 0,
                bottom: 0,
                padding: tokens.space[2],
              },
            },
            h(IconButton, {
              icon: '▶',
              accessibilityLabel: t('sources:recommend.playAlbum', { title: entry.title }),
              variant: 'primary',
              size: tokens.size.icon,
              onPress: () => onPlay(entry),
            }),
          )
        : null,
    ),
    h(Text, { variant: 'sm', numberOfLines: 2, children: entry.title }),
    entry.subtitle
      ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1, children: entry.subtitle })
      : null,
  )
}
