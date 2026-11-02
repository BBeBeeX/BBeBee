import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { SvgPrimitives } from '../primitives.js'
import { nativePrimitives } from '../primitives.js'
import { TABLER_ICON_DEFS, type IconSvgDefinition } from './tabler-defs.generated.js'

export interface TablerIconProps {
  size?: number
  color?: string
  stroke?: number
}

/** The desktop kit's standard stroke width (`ui-kit-desktop/src/icons/tabler.ts`). */
export const DEFAULT_STROKE_WIDTH = 1.25

const TAG_TO_PRIMITIVE: Record<string, keyof SvgPrimitives> = {
  path: 'Path',
  circle: 'Circle',
  rect: 'Rect',
  line: 'Line',
  polyline: 'Polyline',
  polygon: 'Polygon',
  g: 'G',
}

/**
 * The Tabler icon, drawn through the injected `react-native-svg` primitives —
 * the same 24x24 geometry and the desktop kit's 1.25 stroke standard, so the
 * two platforms render identical icons (rules/ui.md §4.1). Returns `null` when
 * the shell configured no SVG primitives or the name is not in the vendored
 * subset; callers decide their own fallback (the kit's text-glyph maps).
 */
export function tablerIcon(name: string, props: TablerIconProps = {}): ReactElement | null {
  const svg = nativePrimitives().svg
  if (!svg) return null
  const def: IconSvgDefinition | undefined = TABLER_ICON_DEFS[name]
  if (!def) return null
  const size = props.size ?? 24
  const stroke = props.stroke ?? DEFAULT_STROKE_WIDTH
  const color = props.color ?? 'currentColor'

  const children = [
    h(svg.Path as never, { key: 'bg', d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' }),
    ...def.elements.map((el, idx) => {
      const primitive = svg[TAG_TO_PRIMITIVE[el.tag] ?? 'Path'] as never
      return h(primitive, { key: idx, ...el.attrs })
    }),
  ]

  return h(
    svg.Svg as never,
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: def.filled ? color : 'none',
      stroke: def.filled ? 'none' : color,
      strokeWidth: def.filled ? undefined : stroke,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    ...children,
  )
}

/** Whether the shell wired SVG primitives — callers use this to pick a fallback. */
export function hasSvgIcons(): boolean {
  return nativePrimitives().svg !== undefined
}
