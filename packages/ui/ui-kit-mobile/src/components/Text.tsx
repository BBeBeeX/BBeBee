import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextProps } from '@BBeBee/ui-core'
import { common, nativePrimitives, toneColor } from '../primitives.js'

/**
 * Weight follows size — the same rule the desktop kit applies.
 *
 * The licensed display face is a lookup rather than a download, so the scale
 * has to carry the design: a heading is recognisable by being heavy and large,
 * not by being set in something distinctive.
 */
function weightFor(variant: NonNullable<TextProps['variant']>): string {
  if (variant === 'display' || variant === 'xl') return tokens.font.weight.heavy
  if (variant === 'lg') return tokens.font.weight.bold
  return tokens.font.weight.regular
}

export function Text(props: TextProps): ReactElement {
  const native = nativePrimitives()
  const { variant = 'md' } = props
  const tight = variant === 'display' || variant === 'xl'
  const baseStyle = {
    fontSize: tokens.font.size[variant],
    fontWeight: weightFor(variant),
    lineHeight:
      tokens.font.size[variant] *
      (tight ? tokens.font.lineHeight.tight : tokens.font.lineHeight.normal),
    color: toneColor(props.tone),
  }
  return h(
    native.Text as never,
    {
      ...common(props),
      numberOfLines: props.numberOfLines,
      // Relative to the OS text-size setting rather than absolute, so the
      // 200% test in docs/08 8 is a layout question, not a clipping one.
      allowFontScaling: true,
      style: props.style ? [baseStyle, props.style] : baseStyle,
    },
    props.children as ReactNode,
  )
}
