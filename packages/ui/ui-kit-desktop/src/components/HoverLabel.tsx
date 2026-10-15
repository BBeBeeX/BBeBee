import { createContext, createElement as h, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Context to flag when an element is already rendered inside a HoverLabel,
 * allowing nested MarqueeText or other components to avoid creating duplicate tooltips.
 */
export const HoverLabelContext = createContext<boolean>(false)

export interface HoverLabelProps {
  /** The text of the floating label — usually the truncated name itself. */
  label: string
  /** Hover milliseconds before the label appears. Default 250ms (200~300ms). */
  delayMs?: number
  children?: ReactNode
  /** Sizing on the wrapper: flex, min-width, display live here. */
  style?: CSSProperties
  testID?: string
  /**
   * Whether to always show the tooltip on hover regardless of truncation.
   * Default false (only shows when the content is actually truncated).
   */
  alwaysShow?: boolean
}

/**
 * Checks whether an element or any of its direct children is clipped/truncated.
 * Supports single-line ellipsis, CSS line clamps (-webkit-line-clamp), and data-overflow marks.
 */
export function isElementTruncated(el: HTMLElement | null): boolean {
  if (!el) return false

  // Check data attributes from MarqueeText or other truncation components
  if (el.dataset.overflow && Number.parseFloat(el.dataset.overflow) > 0) return true
  if (el.dataset.truncated === 'true') return true

  // Check horizontal or vertical truncation with a 1px tolerance for subpixel rounding
  if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
    return true
  }

  // Inspect children if the wrapper itself is an unconstrained inline/block container
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i] as HTMLElement
    if (child.dataset.overflow && Number.parseFloat(child.dataset.overflow) > 0) return true
    if (child.dataset.truncated === 'true') return true
    if (child.scrollWidth > child.clientWidth + 1 || child.scrollHeight > child.clientHeight + 1) {
      return true
    }
  }

  return false
}

/**
 * Shows a floating label after the pointer has rested on `children` for a brief
 * duration (250ms by default) — displaying the full title for truncated names.
 *
 * For non-truncated text, the tooltip is suppressed by default to prevent redundant noise.
 * The label is portaled to `document.body` at fixed coordinates with `pointerEvents: 'none'`,
 * ensuring it never clips against `overflow: hidden` ancestors or blocks underlying controls.
 */
export function HoverLabel(props: HoverLabelProps): ReactElement {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; placeAbove?: boolean } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  useEffect(() => {
    if (!anchor) return
    const hide = () => setAnchor(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor])

  const handleEnter = () => {
    clearTimer()
    const el = wrapperRef.current
    if (!el) return

    // Requirement: only show tooltip if the title is actually truncated
    if (!props.alwaysShow && !isElementTruncated(el)) {
      return
    }

    timerRef.current = setTimeout(() => {
      const currentEl = wrapperRef.current
      if (!currentEl) return
      if (!props.alwaysShow && !isElementTruncated(currentEl)) return

      const rect = currentEl.getBoundingClientRect()
      const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0
      const placeAbove = windowHeight > 0 && rect.bottom + 40 > windowHeight

      setAnchor({
        left: rect.left,
        top: placeAbove ? rect.top - 6 : rect.bottom + 6,
        placeAbove,
      })
    }, props.delayMs ?? 250)
  }

  const handleLeave = () => {
    clearTimer()
    setAnchor(null)
  }

  return h(
    HoverLabelContext.Provider,
    { value: true },
    h(
      'span',
      {
        ref: wrapperRef,
        'data-testid': props.testID,
        onMouseEnter: handleEnter,
        onMouseLeave: handleLeave,
        style: {
          position: 'relative',
          minWidth: 0,
          ...props.style,
        },
      },
      props.children,
      anchor && typeof document !== 'undefined'
        ? createPortal(
            h(
              'div',
              {
                role: 'tooltip',
                style: {
                  position: 'fixed',
                  left: Math.max(8, Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 800) - 8)),
                  top: anchor.top,
                  transform: anchor.placeAbove ? 'translateY(-100%)' : undefined,
                  maxWidth: 420,
                  padding: '5px 10px',
                  borderRadius: 6,
                  background: 'var(--bb-bg-overlay, rgba(18, 22, 34, 0.96))',
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                  boxShadow: 'var(--shadow-dropdown, 0 8px 24px rgba(0, 0, 0, 0.55))',
                  color: 'var(--text-primary, #FFFFFF)',
                  fontSize: 12,
                  lineHeight: 1.4,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  pointerEvents: 'none',
                  zIndex: 12000,
                },
              },
              props.label,
            ),
            document.body,
          )
        : null,
    ),
  )
}
