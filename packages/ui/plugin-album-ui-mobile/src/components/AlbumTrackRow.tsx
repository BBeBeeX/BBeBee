import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { Text, c, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface AlbumTrackRowProps {
  ctx: Context
  track: Track
  index: number
  active?: boolean
  isPlaying?: boolean
  inLibrary?: boolean
  onPress: () => void
  onMore: (anchor: { x: number; y: number }) => void
  onAddToFavorites?: (track: Track) => void
  onHeartPress?: (track: Track) => void
  hideHeart?: boolean
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showSource?: boolean
  sourceName?: string
  compact?: boolean
}

export function AlbumTrackRow({
  ctx,
  track,
  index: _index,
  active = false,
  isPlaying = false,
  inLibrary = false,
  onPress,
  onMore,
  onAddToFavorites,
  onHeartPress,
  hideHeart = false,
  batchMode = false,
  selected = false,
  onToggleSelect,
  showSource = false,
  sourceName,
  compact = false,
}: AlbumTrackRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const artists = track.artists?.map((a) => a.name).join(', ')

  const handleRowClick = batchMode ? (onToggleSelect ?? onPress) : onPress

  return h(
    native.Pressable as never,
    {
      testID: `album-track-row-${track.urn}`,
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
        minHeight: compact ? 42 : 54,
        borderRadius: tokens.radius.sm,
        backgroundColor: selected
          ? 'rgba(255, 255, 255, 0.08)'
          : active
            ? 'rgba(95, 135, 255, 0.08)'
            : 'transparent',
        borderLeftWidth: active ? 3 : 0,
        borderLeftColor: 'var(--color-primary, #5F87FF)',
      },
    },
    // Left: Batch Checkbox or Playing indicator (index number column hidden)
    batchMode
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'checkbox',
            accessibilityLabel: selected
              ? t('album:batchAction.deselectAll')
              : t('album:batchAction.selectAll'),
            onPress: onToggleSelect ?? onPress,
            style: { width: 32, alignItems: 'center', justifyContent: 'center' },
          },
          h(
            Text,
            { variant: 'md', tone: selected ? 'accent' : 'muted' },
            selected ? '☑' : '☐',
          ),
        )
      : isPlaying
        ? h(
            native.View as never,
            { style: { width: 20, alignItems: 'center', justifyContent: 'center' } },
            tablerIcon('play', { size: 14, color: 'var(--color-primary, #5F87FF)' }),
          )
        : null,
    // Center: Metadata (Title, Artist, Source badge)
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
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
        showSource && sourceName
          ? h(
              native.View as never,
              {
                style: {
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 3,
                },
              },
              h(Text, { variant: 'xs', tone: 'muted' }, sourceName),
            )
          : null,
        artists
          ? h(
              Text,
              { variant: 'sm', tone: 'muted', numberOfLines: 1, style: { flexShrink: 1 } },
              artists,
            )
          : null,
      ),
    ),
    // Right: Favorite Heart Toggle (only shown when saved)
    !hideHeart && inLibrary
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: t('album:index.removeFromFavorites'),
            onPress: (event: { stopPropagation?: () => void }) => {
              event?.stopPropagation?.()
              if (onHeartPress) {
                onHeartPress(track)
              } else if (onAddToFavorites) {
                onAddToFavorites(track)
              }
            },
            style: {
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          tablerIcon('heart-filled', {
            size: 18,
            color: c().accent.base,
          }),
        )
      : null,
    // Right: More Options Button
    h(
      native.Pressable as never,
      {
        accessibilityRole: 'button',
        accessibilityLabel: t('album:index.moreOptions'),
        onPress: (event: { nativeEvent?: { pageX?: number; pageY?: number } }) =>
          onMore({
            x: event.nativeEvent?.pageX ?? 0,
            y: event.nativeEvent?.pageY ?? 0,
          }),
        style: {
          width: 32,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      tablerIcon('dots', { size: 18, color: 'var(--text-muted, #7C8BA1)' }),
    ),
  )
}
