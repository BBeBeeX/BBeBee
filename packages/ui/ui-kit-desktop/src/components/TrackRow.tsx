import { createElement as h } from 'react'
import type React from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { common, useHover } from '../theme.js'
import { Artwork } from './Artwork.js'
import { Text } from './Text.js'
import { IconButton } from './Button.js'

export function TrackRow(
  props: TrackRowProps & {
    /**
     * Optional Cordis context. When provided, the icon-button labels are
     * translated via `useI18n`; without it the built-in English copy renders.
     */
    ctx?: Context
  },
) {
  const { active = false, showArtwork = true, showAlbum = false } = props
  // Deliberately hook-free: the kit's tree() tests invoke components as plain
  // functions. Locale changes reach this component because its
  // useI18n-subscribed ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
  const [hovered, hoverProps] = useHover()
  const artists = props.track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      ...common(props),
      role: 'row',
      tabIndex: 0,
      onClick: props.onPress,
      onContextMenu: props.onMore
        ? (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
            event.preventDefault()
            props.onMore?.({
              x: event.clientX ?? 0,
              y: event.clientY ?? 0,
            })
          }
        : undefined,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter' || event.key === ' ') props.onPress?.()
      },
      ...hoverProps,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
        cursor: props.onPress ? 'pointer' : 'default',
        color: active ? 'var(--music-playing, var(--lavender-400, #BEB4FF))' : 'var(--text-primary, #FFFFFF)',
        background: hovered
          ? 'var(--surface-hover, #101831)'
          : active
            ? 'var(--playing-item-bg, rgba(117,152,255,0.06))'
            : 'transparent',
        boxShadow: active ? 'var(--playing-item-glow, var(--glow-brand-sm))' : 'none',
        border: active ? '1px solid var(--playing-item-border, rgba(169,156,255,0.18))' : '1px solid transparent',
        transition: `background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, box-shadow ${tokens.duration.fast}ms`,
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
      'div',
      { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
      h(Text, { numberOfLines: 1, children: props.track.title }),
      artists ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists }) : null,
    ),
    showAlbum && props.track.albumTitle
      ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.track.albumTitle })
      : null,
    props.onToggleLoved
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: props.track.loved ? 'heart-filled' : 'heart',
            accessibilityLabel: props.track.loved
              ? t('app:common.track.unlike', 'Unlike')
              : t('app:common.track.like', 'Like'),
            variant: props.track.loved ? 'primary' : 'ghost',
            onPress: props.onToggleLoved,
          }),
        )
      : null,
    props.onDownload && !props.track.urn.startsWith('BBeBee:local:')
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: 'download',
            accessibilityLabel: t('app:common.track.download', 'Download'),
            onPress: props.onDownload,
          }),
        )
      : null,
    props.onMore
      ? h(
          'span',
          {
            onClick: (e: React.MouseEvent<HTMLElement>) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              props.onMore?.({ x: rect.left, y: rect.bottom + 4 })
            },
            style: {
              visibility: hovered ? 'visible' : 'hidden',
            },
          },
          h(IconButton, { icon: 'dots', accessibilityLabel: t('app:common.track.more', 'More'), onPress: () => {} }),
        )
      : null,
  )
}
