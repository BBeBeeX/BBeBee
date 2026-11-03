import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import { Artwork, IconButton, Text, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface MobileLibraryTrackRowProps {
  ctx: Context
  track: Track
  index: number
  active?: boolean
  isPlaying?: boolean
  inLibrary: boolean
  highlighted?: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onAddToFavorites?: (track: Track) => void
  onOpenAlbum?: (track: Track) => void
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showSource?: boolean
  sourceName?: string
  compact?: boolean
}

export function MobileLibraryTrackRow({
  ctx,
  track,
  index,
  active = false,
  isPlaying = false,
  inLibrary,
  highlighted,
  onPress,
  onMore,
  onAddToFavorites,
  onOpenAlbum,
  batchMode,
  selected,
  onToggleSelect,
  showSource,
  sourceName,
  compact = false,
}: MobileLibraryTrackRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const artists = track.artists?.map((a) => a.name).join(', ')

  const handleRowClick = batchMode ? (onToggleSelect ?? onPress) : onPress

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: track.title,
      onPress: handleRowClick,
      onLongPress: (event: { nativeEvent?: { pageX?: number; pageY?: number } }) =>
        onMore({
          x: event.nativeEvent?.pageX ?? 0,
          y: event.nativeEvent?.pageY ?? 0,
        }),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: compact ? tokens.space[1] : tokens.space[2],
        paddingHorizontal: tokens.space[3],
        gap: tokens.space[2],
        minHeight: compact ? 42 : 56,
        borderRadius: tokens.radius.sm,
        backgroundColor: highlighted
          ? 'rgba(95, 135, 255, 0.12)'
          : selected
            ? 'rgba(255, 255, 255, 0.08)'
            : active
              ? 'rgba(95, 135, 255, 0.06)'
              : 'transparent',
        borderLeftWidth: active ? 3 : 0,
        borderLeftColor: 'var(--color-primary, #5F87FF)',
      },
    },
    // Left: Batch Checkbox or Number index / Play indicator
    batchMode
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'checkbox',
            accessibilityLabel: selected ? t('library:libraryTrack.deselect') : t('library:libraryTrack.select'),
            onPress: onToggleSelect ?? onPress,
            style: { width: 32, alignItems: 'center', justifyContent: 'center' },
          },
          h(
            Text,
            { variant: 'md', tone: selected ? 'accent' : 'muted' },
            selected ? '☑' : '☐',
          ),
        )
      : h(
          native.View as never,
          { style: { width: 28, alignItems: 'center', justifyContent: 'center' } },
          isPlaying
            ? tablerIcon('play', { size: 14, color: 'var(--color-primary, #5F87FF)' })
            : h(
                Text,
                {
                  variant: 'sm',
                  tone: active ? 'accent' : 'muted',
                  style: {
                    fontWeight: active ? tokens.font.weight.bold : tokens.font.weight.regular,
                  },
                },
                String(index + 1),
              ),
        ),
    // Artwork (hidden in compact view, matching desktop)
    !compact
      ? h(Artwork, {
          artwork: track.artwork,
          seed: track.urn,
          size: tokens.size.artworkThumb,
        })
      : null,
    // Center: Metadata (Title, Artist, Album, Source badge)
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 } },
      h(
        Text,
        {
          numberOfLines: 1,
          style: {
            fontWeight: active ? tokens.font.weight.bold : tokens.font.weight.regular,
          },
          tone: active ? 'accent' : 'default',
        },
        track.title,
      ),
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        artists
          ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, artists)
          : null,
        track.albumTitle
          ? onOpenAlbum
            ? h(
                native.Pressable as never,
                {
                  onPress: (e: { stopPropagation?: () => void }) => {
                    e?.stopPropagation?.()
                    onOpenAlbum(track)
                  },
                },
                h(
                  Text,
                  {
                    variant: 'sm',
                    tone: 'muted',
                    numberOfLines: 1,
                    style: { textDecorationLine: 'underline' },
                  },
                  `• ${track.albumTitle}`,
                ),
              )
            : h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, `• ${track.albumTitle}`)
          : null,
        showSource && sourceName
          ? h(
              native.View as never,
              {
                style: {
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 4,
                },
              },
              h(Text, { variant: 'xs', tone: 'muted' }, sourceName),
            )
          : null,
      ),
    ),
    // Right actions: Duration + Heart + More menu
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: 4 } },
      track.durationMs
        ? h(
            Text,
            { variant: 'xs', tone: 'muted', style: { marginRight: 2 } },
            formatDuration(track.durationMs),
          )
        : null,
      onAddToFavorites
        ? h(IconButton, {
            icon: inLibrary ? '♥' : '♡',
            accessibilityLabel: inLibrary
              ? t('library:index.removeFromFavorites', { title: track.title })
              : t('app:track.like'),
            variant: inLibrary ? 'primary' : 'ghost',
            onPress: () => onAddToFavorites(track),
          })
        : null,
      h(IconButton, {
        icon: '⋯',
        accessibilityLabel: t('library:libraryTrack.more'),
        variant: 'ghost',
        onPress: () =>
          onMore({
            x: 0,
            y: 0,
          }),
      }),
    ),
  )
}
