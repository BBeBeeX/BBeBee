import { createElement as h } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { identicon } from '@BBeBee/ui-core'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { c, common } from '../theme.js'

export function toBbebeeFileUri(rawUri?: string): string | undefined {
  if (!rawUri) return undefined
  if (rawUri.startsWith('bbebee-file:')) return rawUri
  if (rawUri.startsWith('file://')) return rawUri.replace(/^file:\/\//, 'bbebee-file://')
  if (rawUri.startsWith('file:')) return rawUri.replace(/^file:\/*/, 'bbebee-file:///')
  if (/^[a-zA-Z]:[\\/]/.test(rawUri)) return `bbebee-file:///${rawUri.replace(/\\/g, '/')}`
  if (rawUri.startsWith('/') && !rawUri.startsWith('//')) return `bbebee-file://${rawUri}`
  return rawUri
}

export function Artwork(props: ArtworkProps) {
  const { size, radius = tokens.radius.sm } = props
  const rawUri = props.artwork?.sourceUrl
  const uri = toBbebeeFileUri(rawUri)
  const dominant = props.artwork?.dominantColor
  const pattern = uri || dominant ? undefined : identicon(props.seed || props.artwork?.id)

  return h(
    'div',
    {
      ...common(props),
      style: {
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        flexShrink: 0,
        background: pattern?.background ?? dominant ?? c().bg.overlay,
      },
    },
    uri
      ? h('img', {
          src: uri,
          alt: '',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        })
      : pattern
        ? h(
            'svg',
            {
              viewBox: '0 0 5 5',
              width: '100%',
              height: '100%',
              'aria-hidden': true,
              shapeRendering: 'crispEdges',
            },
            pattern.cells.flatMap((on, i) =>
              on
                ? [
                    h('rect', {
                      key: i,
                      x: i % 5,
                      y: Math.floor(i / 5),
                      width: 1,
                      height: 1,
                      fill: pattern.foreground,
                    }),
                  ]
                : [],
            ),
          )
        : null,
  )
}
