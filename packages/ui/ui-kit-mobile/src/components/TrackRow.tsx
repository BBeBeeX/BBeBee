import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { Artwork } from './Artwork.js'
import { IconButton } from './Button.js'

export function TrackRow(
  props: TrackRowProps & {
    /**
     * Optional Cordis context. When provided, the icon-button labels are
     * translated via `useI18n`; without it the built-in English copy renders.
     */
    ctx?: Context
  },
): ReactElement {
  const native = nativePrimitives()
  // Deliberately hook-free: the kit's tree() tests invoke this component as a
  // plain function. Locale changes reach it because its useI18n-subscribed
  // ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
  const { active = false, showArtwork = true, showAlbum = false } = props
  const artists = props.track.artists?.map((a) => a.name).join(', ')
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      onPress: props.onPress,
      // Long press is the mobile half of `onMore`; desktop uses right-click.
      onLongPress: (event: { nativeEvent?: { pageX?: number; pageY?: number } }) =>
        props.onMore?.({
          x: event.nativeEvent?.pageX ?? 0,
          y: event.nativeEvent?.pageY ?? 0,
        }),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.sm,
        // The playing row is green *text*, not a filled row: a fill here would
        // compete with the press highlight and the two would read the same.
        backgroundColor: 'transparent',
      },
    },
    showArtwork
      ? h(Artwork, {
          artwork: props.track.artwork,
          seed: props.track.urn,
          size: tokens.size.artworkThumb,
        })
      : null,
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, {
        numberOfLines: 1,
        tone: active ? 'accent' : 'default',
        children: props.track.title,
      }),
      artists
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists })
        : null,
    ),
    showAlbum && props.track.albumTitle
      ? h(Text, {
          variant: 'sm',
          tone: 'muted',
          numberOfLines: 1,
          children: props.track.albumTitle,
        })
      : null,
    props.onToggleLoved
      ? h(IconButton, {
          icon: props.track.loved ? '♥' : '♡',
          accessibilityLabel: props.track.loved
            ? t('app:common.track.unlike', 'Unlike')
            : t('app:common.track.like', 'Like'),
          variant: props.track.loved ? 'primary' : 'ghost',
          onPress: props.onToggleLoved,
        })
      : null,
    props.onDownload && !props.track.urn.startsWith('BBeBee:local:')
      ? h(IconButton, { icon: '⬇', accessibilityLabel: t('app:common.track.download', 'Download'), onPress: props.onDownload })
      : null,
    props.onMore
      ? h(IconButton, { icon: '⋯', accessibilityLabel: t('app:common.track.more', 'More'), onPress: props.onMore })
      : null,
  )
}
