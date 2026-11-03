import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef } from '@BBeBee/protocol'
import { Artwork, Text, c, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface LocalArtistRowProps {
  ctx: Context
  name: string
  trackCount: number
  artwork?: ArtworkRef
  selected?: boolean
  onSelect: () => void
}

export function LocalArtistRow({
  ctx,
  name,
  trackCount,
  artwork,
  selected = false,
  onSelect,
}: LocalArtistRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()

  return h(
    native.Pressable as never,
    {
      testID: `local-artist-row-${name}`,
      accessibilityRole: 'button',
      accessibilityLabel: `${name}, ${t('library:localAlbum.tracks', { trackCount })}`,
      onPress: onSelect,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: tokens.space[2],
        paddingHorizontal: tokens.space[3],
        gap: tokens.space[3],
        borderRadius: tokens.radius.sm,
        backgroundColor: selected ? 'rgba(95, 135, 255, 0.12)' : 'transparent',
        borderLeftWidth: selected ? 3 : 0,
        borderLeftColor: 'var(--color-primary, #5F87FF)',
      },
    },
    // Circular Avatar
    h(
      native.View as never,
      {
        style: {
          width: 44,
          height: 44,
          borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      artwork
        ? h(Artwork, { artwork, seed: name, size: 44 })
        : tablerIcon('user', { size: 22, color: c().text.muted }),
    ),
    // Name & Count
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0, justifyContent: 'center' } },
      h(
        Text,
        {
          variant: 'md',
          style: { fontWeight: selected ? tokens.font.weight.bold : tokens.font.weight.regular },
          tone: selected ? 'accent' : 'default',
          numberOfLines: 1,
        },
        name,
      ),
      h(
        Text,
        { variant: 'xs', tone: 'muted' },
        t('library:localAlbum.tracks', { trackCount }),
      ),
    ),
    tablerIcon('chevron-right', { size: 18, color: c().text.muted }),
  )
}
