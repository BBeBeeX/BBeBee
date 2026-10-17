import { useCallback, useRef, useState } from 'react'

export interface DetailBarCollapse {
  /**
   * Attach to the element whose top edge coincides with the scrollport's top
   * — the wrapper around the `List` (or the page's own scroller). Distance
   * measurements are taken between this and the anchor.
   */
  scrollerRef: React.RefObject<HTMLDivElement | null>
  /** Attach to a wrapper around the header's big play button. */
  anchorRef: React.RefObject<HTMLDivElement | null>
  /** 0 — bar fully above the viewport; 1 — fully slid in (the dock point). */
  slide: number
  /** True once the bar's edge has passed half the anchor's height. */
  docked: boolean
  /** The `List`'s / scroller's `onScroll`. */
  handleScroll: () => void
}

/**
 * The scroll choreography behind `StickyDetailBar`, measured rather than
 * assumed: on every scroll event the anchor's (the header play button's)
 * distance to the scrollport top is read, and the bar's slide and dock state
 * derive from it — the bar slides in over the anchor's last stretch of
 * approach and docks when its edge has covered half the button, which is the
 * moment the bar absorbs the button. Reads are bounded to one
 * pair of `getBoundingClientRect` per scroll event, and the state write is
 * guarded so steady-state scrolling re-renders only on real change.
 */
export function useDetailBarCollapse(
  opts: { barHeight?: number; anchorHeight?: number } = {},
): DetailBarCollapse {
  const barHeight = opts.barHeight ?? 64
  const anchorHeight = opts.anchorHeight ?? 56
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState({ slide: 0, docked: false })

  // The bar is fully in exactly when the anchor is half-covered: bar bottom
  // (barHeight) minus half the button. The slide starts one button-height of
  // scroll earlier, so the bar arrives *with* the button rather than sitting
  // there waiting for it.
  const dockAt = barHeight - anchorHeight / 2
  const slideStart = barHeight + anchorHeight

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    const anchor = anchorRef.current
    if (!scroller || !anchor) return
    const distance = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const slide = Math.max(0, Math.min(1, (slideStart - distance) / (slideStart - dockAt)))
    const docked = distance <= dockAt
    setState((prev) => (prev.slide === slide && prev.docked === docked ? prev : { slide, docked }))
  }, [slideStart, dockAt])

  return { scrollerRef, anchorRef, slide: state.slide, docked: state.docked, handleScroll }
}
