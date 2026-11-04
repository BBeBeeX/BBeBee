import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { Artwork, IconButton, Text, c, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
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
  onHeartPress?: (track: Track) => void
  hideHeart?: boolean
  onOpenAlbum?: (track: Track) => void
  batchMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  showSource?: boolean
  sourceName?: string
  compact?: boolean
  onRemove?: () => void
  isSmart?: boolean
  playlistName?: string
}

export function MobileLibraryTrackRow({
  ctx,
  track,
  index: _index,
  active = false,
  isPlaying = false,
  inLibrary,
  highlighted,
  onPress,
  onMore,
  onAddToFavorites,
  onHeartPress,
  hideHeart = false,
  onOpenAlbum,
  batchMode,
  selected,
  onToggleSelect,
  showSource,
  sourceName,
  compact = false,
  onRemove,
  isSmart = false,
  playlistName,
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
    // Left: Batch Checkbox or Playing indicator (index number column hidden)
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
      : isPlaying
        ? h(
            native.View as never,
            { style: { width: 20, alignItems: 'center', justifyContent: 'center' } },
            tablerIcon('play', { size: 14, color: 'var(--color-primary, #5F87FF)' }),
          )
        : null,
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
    // Right actions: Heart (if favorited and not hidden) + More menu
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: 4 } },
      !hideHeart && inLibrary
        ? h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              accessibilityLabel: t('library:trackLibraryActionButton.addToPlaylist', { title: track.title }),
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
      !batchMode && onRemove && !isSmart
        ? h(IconButton, {
            icon: 'x',
            accessibilityLabel: t('library:index.removeFrom', {
              title: track.title,
              name: playlistName ?? t('library:playlistDetail.playlist'),
            }),
            variant: 'ghost',
            onPress: () => onRemove(),
          })
        : null,
      h(IconButton, {
        icon: 'dots',
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
