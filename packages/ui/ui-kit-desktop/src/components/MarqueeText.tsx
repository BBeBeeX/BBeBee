import { createElement as h, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextProps } from '@BBeBee/ui-core'
import { common, toneColor } from '../theme.js'
import { weightFor } from './Text.js'

export interface MarqueeTextProps {
  children: ReactNode
  variant?: TextProps['variant']
  tone?: TextProps['tone']
  /** Sizing on the clipping box: flex, width, margins live here. */
  style?: CSSProperties
  testID?: string
  accessibilityLabel?: string
}

/**
 * A single line of text that plays a marquee (走马灯) once it overflows.
 *
 * Layout-wise it is a one-line ellipsis text with `display: block`, so it
 * drops in wherever `Text numberOfLines={1}` was clipped. When the content is
 * wider than the box it ping-pongs — scroll to the end, hold, scroll back —
 * instead of truncating; when it fits it is a plain static line. The loop is
 * driven by the Web Animations API because the renderer ships no stylesheet
 * to host keyframes.
 */
export function MarqueeText(props: MarqueeTextProps): ReactElement {
  const variant = props.variant ?? 'md'
  const outerRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return
    const measure = () => {
      setOverflow(Math.max(0, outer.scrollWidth - outer.clientWidth))
    }
    measure()
    // The clip box resizes with its flex/grid parents; content width changes
    // (fonts, long titles) are caught because scrollWidth is re-read in the
    // same callback through the observer on resize of either side.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    if (outer.firstElementChild instanceof Element) ro.observe(outer.firstElementChild)
    return () => ro.disconnect()
  }, [props.children])

  useEffect(() => {
    const inner = outerRef.current?.firstElementChild
    if (!(inner instanceof Element) || overflow <= 0) return
    if (typeof inner.animate !== 'function') return
    // Distance-proportional speed, clamped so short overflows still read and
    // long ones do not crawl forever.
    const duration = Math.max(3000, Math.min(15000, overflow * 80))
    const animation = inner.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(0)', offset: 0.12 },
        { transform: `translateX(-${overflow}px)`, offset: 0.88 },
        { transform: `translateX(-${overflow}px)`, offset: 1 },
      ],
      { duration, iterations: Infinity },
    )
    return () => animation.cancel()
  }, [overflow])

  return h(
    'span',
    {
      ref: outerRef,
      ...common(props),
      style: {
        display: 'block',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size[variant],
        fontWeight: weightFor(variant),
        lineHeight: tokens.font.lineHeight.normal,
        color: toneColor(props.tone),
        ...props.style,
      },
    },
    h(
      'span',
      {
        style: {
          display: 'inline-block',
          verticalAlign: 'top',
          whiteSpace: 'nowrap',
          willChange: overflow > 0 ? 'transform' : undefined,
        },
      },
      props.children,
    ),
  )
}
