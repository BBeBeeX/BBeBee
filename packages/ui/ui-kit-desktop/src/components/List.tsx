import { createElement as h, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { tokens } from '@BBeBee/ui-tokens'
import type { ListProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'

export function List<T>(props: ListProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const count = props.items.length
  const estimate = props.estimatedItemSize ?? tokens.size.row

  // Content scrolls inside the scroller above the rows — a collapsible bar,
  // a scroll-away header, a pinned table header — so the virtualiser must
  // treat the first row as starting below all of it. The offset is measured
  // off the spacer's real position (everything above it, whatever its
  // heights), because a wrapped title or an optional toolbar makes the total
  // unknowable from props.
  const [scrollMargin, setScrollMargin] = useState(0)
  const hasHeader = props.header !== undefined
  const hasStickyHeader = props.stickyHeader !== undefined

  useLayoutEffect(() => {
    const scrollerEl = scroller.current
    const spacerEl = spacerRef.current
    if (!scrollerEl || !spacerEl) {
      setScrollMargin((prev) => (prev === 0 ? prev : 0))
      return
    }
    const measure = () => {
      const margin = Math.round(
        spacerEl.getBoundingClientRect().top -
          scrollerEl.getBoundingClientRect().top +
          scrollerEl.scrollTop,
      )
      setScrollMargin((prev) => (prev === margin ? prev : Math.max(0, margin)))
    }
    measure()
    // The margin is scroll-invariant, so the internal scroll listener is a
    // cheap invariant check — it only fires a re-render if the header's
    // height changed mid-scroll. jsdom (and some embedded webviews) ship no
    // ResizeObserver; a missing one costs only live re-measurement.
    scrollerEl.addEventListener('scroll', measure)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      if (headerRef.current) observer.observe(headerRef.current)
      observer.observe(spacerEl)
    }
    return () => {
      scrollerEl.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [hasHeader, hasStickyHeader])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 8,
    scrollMargin,
  })

  const rows = virtualizer.getVirtualItems()

  const last = rows[rows.length - 1]
  const pageSize = props.pageSize
  const thresholdIndex =
    pageSize !== undefined && count > 0
      ? Math.max(0, count - pageSize) + Math.floor((count - Math.max(0, count - pageSize)) / 2)
      : count - 1
  const reachedEnd = last !== undefined && last.index >= thresholdIndex
  const firedFor = useRef(-1)
  const onEndReached = props.onEndReached
  useEffect(() => {
    if (!reachedEnd || !onEndReached || firedFor.current === count) return
    if (pageSize !== undefined) {
      const currentScrollTop = scroller.current?.scrollTop ?? 0
      const currentClientHeight = scroller.current?.clientHeight ?? 0
      const halfwayOffset = scrollMargin + thresholdIndex * estimate
      if (currentScrollTop === 0 || currentScrollTop + currentClientHeight < halfwayOffset) {
        return
      }
    }
    firedFor.current = count
    onEndReached()
  }, [reachedEnd, onEndReached, count, pageSize, scrollMargin, thresholdIndex, estimate])

  const onScroll = props.onScroll
  const handleScroll = (event: { currentTarget: { scrollTop: number; clientHeight: number } }) => {
    const el = event.currentTarget
    onScroll?.(el.scrollTop)
    if (onEndReached && count > 0 && firedFor.current !== count) {
      if (pageSize !== undefined) {
        const halfwayOffset = scrollMargin + thresholdIndex * estimate
        if (el.scrollTop + el.clientHeight >= halfwayOffset) {
          firedFor.current = count
          onEndReached()
        }
      } else if (last !== undefined && last.index >= count - 1) {
        firedFor.current = count
        onEndReached()
      }
    }
  }

  const isEmpty = count === 0 && props.empty !== undefined

  return h(
    'div',
    {
      ...common(props),
      ref: scroller,
      role: 'list',
      onScroll: onScroll || onEndReached ? handleScroll : undefined,
      style: { overflowY: 'auto', overflowX: 'hidden', height: '100%' },
    },
    // Sticky elements have to be the scroller's own children: a sticky
    // element only sticks within its parent's box, so nesting either the bar
    // or the pinned table header inside the header would let them scroll
    // away exactly when they have finished arriving.
    (props.sticky ?? null) as ReactNode,
    hasHeader ? h('div', { ref: headerRef }, props.header as ReactNode) : null,
    (props.stickyHeader ?? null) as ReactNode,
    isEmpty
      ? (props.empty as ReactNode)
      : h(
          'div',
          {
            ref: spacerRef,
            style: { height: virtualizer.getTotalSize(), position: 'relative', width: '100%' },
          },
          rows.map((row) => {
            const item = props.items[row.index]!
            return h(
              'div',
              {
                key: props.keyExtractor(item, row.index),
                role: 'listitem',
                'aria-setsize': count,
                'aria-posinset': row.index + 1,
                ref: virtualizer.measureElement,
                'data-index': row.index,
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start - scrollMargin}px)`,
                },
              },
              props.renderItem(item, row.index) as ReactNode,
            )
          }),
        ),
  )
}
