import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Album } from '@BBeBee/protocol'
import { Artwork, Text, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface LocalAlbumCardProps {
  ctx: Context
  album: Album
  onOpen: () => void
  onPlay?: () => void
  layout?: 'grid' | 'list'
}

export function LocalAlbumCard({
  ctx,
  album,
  onOpen,
  onPlay,
  layout = 'grid',
}: LocalAlbumCardProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const artists = album.artists?.map((a) => a.name).join(', ') || t('library:library.unknownArtist')
  const isList = layout === 'list'

  return h(
    native.Pressable as never,
    {
      testID: `local-album-card-${album.urn}`,
      accessibilityRole: 'button',
      accessibilityLabel: album.title,
      onPress: onOpen,
      style: isList
        ? {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: tokens.space[2],
            paddingHorizontal: tokens.space[3],
            borderRadius: tokens.radius.sm,
            gap: tokens.space[3],
          }
        : {
            width: 156,
            padding: tokens.space[2],
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderRadius: tokens.radius.md,
            gap: tokens.space[2],
          },
    },
    // Cover artwork with play overlay
    h(
      native.View as never,
      {
        style: {
          width: isList ? 48 : 140,
          height: isList ? 48 : 140,
          borderRadius: tokens.radius.sm,
          overflow: 'hidden',
          position: 'relative',
        },
      },
      h(Artwork, {
        artwork: album.artwork,
        seed: album.urn,
        size: isList ? 48 : 140,
      }),
      onPlay
        ? h(
            native.Pressable as never,
            {
              testID: `local-album-play-${album.urn}`,
              accessibilityRole: 'button',
              accessibilityLabel: t('library:library.playItem', { title: album.title }),
              onPress: (e: { stopPropagation?: () => void }) => {
                e?.stopPropagation?.()
                onPlay()
              },
              style: {
                position: 'absolute',
                right: 8,
                bottom: 8,
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'var(--color-primary, #5F87FF)',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 4,
              },
            },
            tablerIcon('play', { size: 18, color: '#FFFFFF' }),
          )
        : null,
    ),
    // Title & Metadata
    h(
      native.View as never,
      { style: { flex: isList ? 1 : undefined, gap: 2 } },
      h(
        Text,
        {
          variant: 'sm',
          style: { fontWeight: tokens.font.weight.bold },
          numberOfLines: 1,
        },
        album.title,
      ),
      h(
        Text,
        {
          variant: 'xs',
          tone: 'muted',
          numberOfLines: 1,
        },
        artists,
      ),
      h(
        Text,
        {
          variant: 'xs',
          tone: 'muted',
        },
        album.year
          ? t('library:localAlbum.yearAndTracks', { year: album.year, trackCount: album.trackCount ?? 0 })
          : t('library:localAlbum.tracks', { trackCount: album.trackCount ?? 0 }),
      ),
    ),
  )
}
