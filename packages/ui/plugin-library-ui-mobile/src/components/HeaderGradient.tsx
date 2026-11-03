import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { parseHex } from '@BBeBee/ui-tokens'
import { c, nativePrimitives } from '@BBeBee/ui-kit-mobile'

export interface HeaderGradientProps {
  tint?: string
  height?: number
  style?: unknown
}

/**
 * Native vertical gradient for detail header backgrounds, matching desktop's `headerGradient`:
 * - Strong color at 0%
 * - Mid color at 62%
 * - App background (solid) at 100%
 */
export function HeaderGradient({ tint, height = 240, style }: HeaderGradientProps): ReactElement {
  const native = nativePrimitives()
  const p = c()
  const svg = native.svg as Record<string, unknown> | undefined

  let topColor = 'rgb(95, 135, 255)'
  let topOpacity = 0.15
  let midColor = 'rgb(8, 13, 26)'
  let midOpacity = 0.7
  const botColor = p.bg.base || '#080A10'

  if (tint) {
    try {
      const { r, g, b } = parseHex(tint)
      topColor = `rgb(${r}, ${g}, ${b})`
      topOpacity = 0.5
      midColor = `rgb(${r}, ${g}, ${b})`
      midOpacity = 0.16
    } catch {
      // fallback to default
    }
  }

  const gradId = `hdr-grad-${tint ? tint.replace('#', '') : 'default'}`

  if (svg?.Svg && svg.Defs && svg.LinearGradient && svg.Stop && svg.Rect) {
    return h(
      native.View as never,
      {
        pointerEvents: 'none',
        style: [
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height,
            overflow: 'hidden',
          },
          style,
        ],
      },
      h(
        svg.Svg as never,
        {
          width: '100%',
          height: '100%',
          viewBox: '0 0 100 100',
          preserveAspectRatio: 'none',
        },
        h(
          svg.Defs as never,
          null,
          h(
            svg.LinearGradient as never,
            { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' },
            h(svg.Stop as never, { offset: '0%', stopColor: topColor, stopOpacity: topOpacity }),
            h(svg.Stop as never, { offset: '62%', stopColor: midColor, stopOpacity: midOpacity }),
            h(svg.Stop as never, { offset: '100%', stopColor: botColor, stopOpacity: 1 }),
          ),
        ),
        h(svg.Rect as never, {
          x: '0',
          y: '0',
          width: '100',
          height: '100',
          fill: `url(#${gradId})`,
        }),
      ),
    )
  }

  // Graceful fallback when SVG not configured (or in headless unit tests)
  return h(native.View as never, {
    pointerEvents: 'none',
    style: [
      {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height,
        backgroundColor: topColor,
        opacity: tint ? 0.35 : 0.12,
      },
      style,
    ],
  })
}
