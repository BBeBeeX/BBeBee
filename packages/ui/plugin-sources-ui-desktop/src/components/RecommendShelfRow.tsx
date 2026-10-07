import {
  createElement as h,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactElement,
} from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry } from '@BBeBee/protocol'
import { Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from './RecommendCard.js'

export interface RecommendShelfRowProps {
  ctx: Context
  title: string
  action?: {
    label: string
    onPress: () => void
    testID?: string
  }
  entries: readonly BrowseEntry[]
  onOpenCard: (entry: BrowseEntry) => void
  testID?: string
  status?: 'idle' | 'loading' | 'ready' | 'error'
  errorMessage?: string
  onRetry?: () => void
}

/**
 * A horizontal shelf row with a bent-ends carousel effect.
 *
 * When row content overflows horizontally, the currently visible leftmost and
 * rightmost cards are bent inward on their outer edges using a CSS 3-D
 * perspective + rotateY transform, giving the whole row a curved-ends "shelf"
 * silhouette.  A directional shading gradient over each bent card deepens the
 * cylindrical lighting illusion.
 *
 * Scroll arrows (❮ / ❯) are separate, absolute-positioned buttons that fade in
 * on hover and are never coupled to the card-bend design.
 */
export function RecommendShelfRow({
  ctx,
  title,
  action,
  entries,
  onOpenCard,
  testID,
  status = 'idle',
  errorMessage,
  onRetry,
}: RecommendShelfRowProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  // Indices of the currently visible leftmost and rightmost cards.
  // showLeft / showRight are derived from these: bend + arrow are only shown
  // when the first (or last) card is NOT yet visible — i.e. there is real
  // hidden content on that side.
  const [leftEdgeIdx, setLeftEdgeIdx] = useState(0)
  const [rightEdgeIdx, setRightEdgeIdx] = useState(0)

  // Derived visibility conditions:
  //   showLeft  = first card (index 0) is not at the visible left boundary
  //   showRight = last  card (index n-1) is not at the visible right boundary
  const showLeft = hasOverflow && leftEdgeIdx > 0
  const showRight = hasOverflow && rightEdgeIdx < entries.length - 1

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const overflow = el.scrollWidth > el.clientWidth + 2
    setHasOverflow(overflow)

    if (entries.length > 0) {
      const cardStep = 172 // 160px card + 12px gap
      // Which card index is at the left visible boundary
      const leftIdx = Math.round(el.scrollLeft / cardStep)
      // How many cards fit in the viewport
      const visibleCount = Math.max(1, Math.floor(el.clientWidth / cardStep))
      // Last fully (or partially) visible card index
      const rightIdx = Math.min(entries.length - 1, leftIdx + visibleCount)
      setLeftEdgeIdx(leftIdx)
      setRightEdgeIdx(rightIdx)
    }
  }, [entries])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateScrollState()

    const onScroll = () => { updateScrollState() }
    el.addEventListener('scroll', onScroll, { passive: true })

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => { updateScrollState() })
        : null
    observer?.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [updateScrollState])

  const handleScrollLeft = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = scrollRef.current
    el?.scrollBy({ left: -(el ? Math.max(200, el.clientWidth * 0.7) : 340), behavior: 'smooth' })
  }

  const handleScrollRight = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = scrollRef.current
    el?.scrollBy({ left: el ? Math.max(200, el.clientWidth * 0.7) : 340, behavior: 'smooth' })
  }

  return h(
    'section',
    {
      'aria-label': title,
      'data-testid': testID,
      onMouseEnter: () => {
        setIsHovered(true)
        updateScrollState()
      },
      onMouseLeave: () => setIsHovered(false),
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        position: 'relative',
      },
    },
    // ── Header ───────────────────────────────────────────────────────────────
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
      h(Text, { variant: 'lg', testID: testID ? `${testID}-title` : undefined }, title),
      action
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': action.testID,
              onClick: action.onPress,
              style: {
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary, rgba(255,255,255,0.75))',
                fontSize: 13,
                cursor: 'pointer',
                padding: '2px 4px',
              },
            },
            action.label,
          )
        : null,
    ),
    // ── Content body ─────────────────────────────────────────────────────────
    status === 'loading'
      ? h(Text, { variant: 'sm', tone: 'muted' }, '加载中…')
      : status === 'error'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
            h(Text, { variant: 'sm', tone: 'error' }, `加载失败：${errorMessage ?? ''}`),
            onRetry
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: onRetry,
                    style: {
                      alignSelf: 'flex-start',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary, #5F87FF)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 13,
                    },
                  },
                  '重试',
                )
              : null,
          )
        : h(
            'div',
            { style: { position: 'relative', width: '100%' } },

            // ── Left arrow — absolute, fade-in on hover ───────────────────────
            showLeft
              ? h(
                  'div',
                  {
                    'data-testid': 'recommend-arrow-layer-left',
                    style: {
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 60,
                      zIndex: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isHovered ? 1 : 0,
                      transition: 'opacity 0.18s ease',
                      pointerEvents: isHovered ? 'auto' : 'none',
                      // Subtle gradient so the button reads against the bent card behind it
                      background:
                        'linear-gradient(to right, var(--bg-elevated, rgba(20,20,24,0.85)) 0%, transparent 100%)',
                    },
                  },
                  h('button', {
                    type: 'button',
                    'data-testid': 'recommend-scroll-left',
                    'aria-label': '向左滚动',
                    tabIndex: isHovered ? 0 : -1,
                    onClick: handleScrollLeft,
                    style: arrowButtonStyle,
                  }, '❮'),
                )
              : null,

            // ── Horizontally scrolling card strip ────────────────────────────
            h(
              'div',
              {
                ref: scrollRef,
                className: 'no-scrollbar',
                'data-testid': testID ? `${testID}-scroll` : undefined,
                style: {
                  display: 'flex',
                  gap: tokens.space[3],
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  paddingBottom: tokens.space[1],
                  scrollBehavior: 'smooth',
                },
              },
              ...entries.map((entry, i) => {
                // Determine whether this card is the bent left or right edge card
                const isBendLeft = showLeft && i === leftEdgeIdx
                const isBendRight = showRight && i === rightEdgeIdx
                const isBent = isBendLeft || isBendRight

                return h(
                  'div',
                  {
                    key: entry.id,
                    // data-testid only on the currently bent edge cards
                    'data-testid': isBendLeft
                      ? 'recommend-fold-left'
                      : isBendRight
                        ? 'recommend-fold-right'
                        : undefined,
                    style: {
                      position: 'relative',
                      flexShrink: 0,
                      // perspective + rotateY bends the outer edge of the card away from
                      // the viewer.  transform-origin anchors the INNER edge in place so
                      // the bent card stays flush with its neighbours.
                      transform: isBendLeft
                        ? 'perspective(600px) rotateY(22deg)'
                        : isBendRight
                          ? 'perspective(600px) rotateY(-22deg)'
                          : undefined,
                      transformOrigin: isBendLeft
                        ? 'right center'
                        : isBendRight
                          ? 'left center'
                          : undefined,
                      // Smooth transition when a card gains or loses the bent role
                      transition: 'transform 0.28s ease',
                    },
                  },
                  h(RecommendCard, { ctx, entry, onPress: onOpenCard }),
                  // Directional shading gradient: darkest at the outer bent edge,
                  // fading to transparent at the inner flat edge — completes the
                  // cylindrical lighting illusion.
                  isBent
                    ? h('div', {
                        'aria-hidden': true,
                        style: {
                          position: 'absolute',
                          inset: 0,
                          borderRadius: tokens.radius.md,
                          pointerEvents: 'none',
                          background: isBendLeft
                            ? 'linear-gradient(to right, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.24) 38%, rgba(0,0,0,0) 70%)'
                            : 'linear-gradient(to left,  rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.24) 38%, rgba(0,0,0,0) 70%)',
                        },
                      })
                    : null,
                )
              }),
            ),

            // ── Right arrow — absolute, fade-in on hover ──────────────────────
            showRight
              ? h(
                  'div',
                  {
                    'data-testid': 'recommend-arrow-layer-right',
                    style: {
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 60,
                      zIndex: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isHovered ? 1 : 0,
                      transition: 'opacity 0.18s ease',
                      pointerEvents: isHovered ? 'auto' : 'none',
                      background:
                        'linear-gradient(to left, var(--bg-elevated, rgba(20,20,24,0.85)) 0%, transparent 100%)',
                    },
                  },
                  h('button', {
                    type: 'button',
                    'data-testid': 'recommend-scroll-right',
                    'aria-label': '向右滚动',
                    tabIndex: isHovered ? 0 : -1,
                    onClick: handleScrollRight,
                    style: arrowButtonStyle,
                  }, '❯'),
                )
              : null,
          ),
  )
}

/** Shared frosted-glass style for the ❮ / ❯ scroll buttons. */
const arrowButtonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: 'var(--surface-hover, rgba(12, 12, 16, 0.75))',
  backdropFilter: 'blur(12px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(12px) saturate(1.5)',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.22))',
  color: 'var(--text-primary, rgba(255, 255, 255, 0.95))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  lineHeight: '1',
  fontWeight: '300',
  cursor: 'pointer',
  boxShadow: 'var(--shadow-dropdown, 0 2px 10px rgba(0,0,0,0.55))',
  padding: '0 0 1px 0',
  outline: 'none',
  flexShrink: 0,
}
