import { createElement as h, useContext, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextProps } from '@BBeBee/ui-core'
import { common, toneColor } from '../theme.js'
import { weightFor } from './Text.js'
import { usePageMarqueeSync } from './PageMarqueeSync.js'
import { HoverLabel, HoverLabelContext } from './HoverLabel.js'

export interface MarqueeTextProps {
  children?: ReactNode
  variant?: TextProps['variant']
  tone?: TextProps['tone']
  /** Sizing on the clipping box: flex, width, margins live here. */
  style?: CSSProperties
  testID?: string
  accessibilityLabel?: string
  /**
   * Tooltip label shown on hover. Defaults to string content of children if available.
   */
  label?: string
  /**
   * Whether to enable hover tooltip when truncated.
   * Defaults to true (automatically suppressed if already inside an outer HoverLabel).
   */
  tooltip?: boolean
  /** Hover milliseconds before tooltip appears. Defaults to 250ms. */
  tooltipDelayMs?: number
  /** Optional click handler for title. */
  onClick?: (e: ReactMouseEvent<HTMLSpanElement>) => void
}

/**
 * A single line of text that automatically synchronizes its marquee animation
 * with all other visible truncated titles across the current page.
 *
 * Rules:
 * 1. Automatic truncation detection:
 *    Measures rendered scrollWidth vs container clientWidth. If text fits without truncation,
 *    it remains static with zero animation.
 * 2. Page-wide unified synchronization:
 *    Uses the timeline established by PageMarqueeProvider so all eligible truncated titles
 *    move in unison — identical start times, direction, progress, pause duration, and cycle pace.
 * 3. Lifecycle & Performance:
 *    Uses IntersectionObserver so off-screen elements in long/virtual lists do not run animations.
 *    When an element scrolls into view, it instantly synchronizes with the running page timeline.
 * 4. prefers-reduced-motion:
 *    Automatically disables animation when the user prefers reduced motion, falling back to static ellipsis.
 * 5. Integrated HoverLabel tooltip:
 *    Provides hover tooltip after 250ms when truncated, without causing animation jumps or duplicating
 *    if already wrapped in an external HoverLabel.
 */
export function MarqueeText(props: MarqueeTextProps): ReactElement {
  const variant = props.variant ?? 'md'
  const outerRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const [isVisible, setIsVisible] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)

  const isParentInHoverLabel = useContext(HoverLabelContext)
  const { startTime, cycleDurationMs } = usePageMarqueeSync()

  // Track prefers-reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])

  // Detect truncation via ResizeObserver
  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return

    const measure = () => {
      const diff = outer.scrollWidth - outer.clientWidth
      setOverflow(diff > 1 ? diff : 0)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    if (outer.firstElementChild instanceof Element) {
      ro.observe(outer.firstElementChild)
    }
    return () => ro.disconnect()
  }, [props.children])

  // Track visibility with IntersectionObserver to avoid animating off-screen items
  useEffect(() => {
    const outer = outerRef.current
    if (!outer || typeof IntersectionObserver === 'undefined') return

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setIsVisible(entry.isIntersecting)
      }
    })

    io.observe(outer)
    return () => io.disconnect()
  }, [])

  // Unified synchronized animation loop
  useEffect(() => {
    const inner = outerRef.current?.firstElementChild as HTMLElement | null
    if (!inner) return

    // If text fits, item is off-screen, or user prefers reduced motion, don't run marquee
    if (overflow <= 0 || !isVisible || reducedMotion) {
      if (typeof inner.animate === 'function') {
        inner.style.transform = ''
      }
      return
    }

    if (typeof inner.animate !== 'function') return

    // Visual margin of 6px so end characters do not press tightly against container boundary
    const travel = overflow + 6

    // Synchronized ping-pong cycle:
    // 0% -> 15%: Initial hold at start for readability
    // 15% -> 50%: Smooth scroll to the end
    // 50% -> 65%: Pause at the end for reading the tail
    // 65% -> 100%: Smooth return to start
    const keyframes: Keyframe[] = [
      { transform: 'translateX(0)', offset: 0, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: 'translateX(0)', offset: 0.15, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: `translateX(-${travel}px)`, offset: 0.5, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: `translateX(-${travel}px)`, offset: 0.65, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: 'translateX(0)', offset: 1.0, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    ]

    const animation = inner.animate(keyframes, {
      duration: cycleDurationMs,
      iterations: Infinity,
      fill: 'both',
    })

    // Align animation's currentTime to the current page's synchronized timeline
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsed = (now - startTime) % cycleDurationMs
    try {
      animation.currentTime = elapsed >= 0 ? elapsed : 0
    } catch {
      // Ignore if browser environment disallows setting currentTime
    }

    return () => {
      try {
        animation.cancel()
        inner.style.transform = ''
      } catch {
        // Ignore
      }
    }
  }, [overflow, isVisible, reducedMotion, startTime, cycleDurationMs])

  const resolvedLabel =
    props.label ?? (typeof props.children === 'string' ? props.children : undefined)

  const isTruncated = overflow > 0
  const isAnimated = isTruncated && isVisible && !reducedMotion

  const marqueeElement = h(
    'span',
    {
      ref: outerRef,
      ...common(props),
      'data-testid': props.testID,
      'data-overflow': isTruncated ? overflow : undefined,
      'data-truncated': isTruncated ? 'true' : undefined,
      onClick: props.onClick,
      style: {
        display: 'block',
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: isAnimated ? 'clip' : 'ellipsis',
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
          willChange: isAnimated ? 'transform' : undefined,
          paddingRight: isTruncated ? 6 : 0,
        },
      },
      props.children,
    ),
  )

  // Auto-wrap with HoverLabel when used standalone, unless already inside HoverLabel
  if (!isParentInHoverLabel && props.tooltip !== false && resolvedLabel) {
    return h(
      HoverLabel,
      {
        label: resolvedLabel,
        delayMs: props.tooltipDelayMs ?? 250,
        style: {
          display: props.style?.display ?? 'block',
          minWidth: 0,
          flex: props.style?.flex,
          width: props.style?.width,
        },
      },
      marqueeElement,
    )
  }

  return marqueeElement
}
