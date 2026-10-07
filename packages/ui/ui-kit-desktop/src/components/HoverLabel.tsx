import { createElement as h, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface HoverLabelProps {
  /** The text of the floating label — usually the truncated name itself. */
  label: string
  /** Hover milliseconds before the label appears. Default 2000. */
  delayMs?: number
  children?: ReactNode
  /** Sizing on the wrapper: flex, min-width, display live here. */
  style?: CSSProperties
  testID?: string
}

/**
 * Shows a floating label after the pointer has rested on `children` for a
 * while (2s by default) — the deliberate tooltip for names the layout may
 * have truncated.
 *
 * The label is portaled to `document.body` at fixed coordinates so ancestors
 * with `overflow: hidden` (list rows, clamped columns) cannot clip it, and it
 * dismisses on leave, scroll, resize, and Escape. A pending timer is cancelled
 * by the briefest leave, so sweeping the pointer across a list never flashes
 * labels.
 */
export function HoverLabel(props: HoverLabelProps): ReactElement {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)

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
    timerRef.current = setTimeout(() => {
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setAnchor({ left: rect.left, top: rect.bottom })
    }, props.delayMs ?? 2000)
  }

  const handleLeave = () => {
    clearTimer()
    setAnchor(null)
  }

  return h(
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
                left: Math.max(8, Math.min(anchor.left, (window.innerWidth ?? 0) - 8)),
                top: anchor.top + 6,
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
  )
}
