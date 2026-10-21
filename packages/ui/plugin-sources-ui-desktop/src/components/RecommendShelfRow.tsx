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
import { Text, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
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
  onConfigure?: () => void
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
  onConfigure,
}: RecommendShelfRowProps): ReactElement {
  const { t } = useI18n(ctx)
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
        borderRadius: tokens.radius.lg,
        padding: '10px 12px',
        margin: '-10px -12px',
        backgroundColor: isHovered
          ? 'var(--surface-subtle, rgba(255, 255, 255, 0.02))'
          : 'transparent',
        border: isHovered
          ? '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))'
          : '1px solid transparent',
        transition:
          'background-color 0.25s var(--bb-easing-smooth, cubic-bezier(0.4, 0, 0.2, 1)), border-color 0.25s var(--bb-easing-smooth, cubic-bezier(0.4, 0, 0.2, 1))',
      },
    },
    // ── Header ───────────────────────────────────────────────────────────────
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
      h(Text, { variant: 'lg', testID: testID ? `${testID}-title` : undefined }, title),
      action
        ? h(RowActionButton, {
            label: action.label,
            onPress: action.onPress,
            testID: action.testID,
            rowHovered: isHovered,
          })
        : null,
    ),
    // ── Content body ─────────────────────────────────────────────────────────
    status === 'loading'
      ? h(Text, { variant: 'sm', tone: 'muted' }, t('sources:source.loading'))
      : status === 'error'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
            h(Text, { variant: 'sm', tone: 'error' }, t('sources:source.failedToLoad', { message: errorMessage ?? '' })),
            h(
              'div',
              { style: { display: 'flex', gap: tokens.space[3], alignItems: 'center' } },
              onRetry
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: onRetry,
                      style: {
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-primary, #5F87FF)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 13,
                      },
                    },
                    t('app:common.retry'),
                  )
                : null,
              onConfigure
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: onConfigure,
                      style: {
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-primary, #5F87FF)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 13,
                      },
                    },
                    t('sources:sourcesList.configure'),
                  )
                : null,
            ),
          )
        : h(
            'div',
            { style: { position: 'relative', width: '100%' } },

            // ── Left arrow — absolute, fade-in on hover, aligned with cover artwork ──
            showLeft
              ? h(
                  'div',
                  {
                    'data-testid': 'recommend-arrow-layer-left',
                    style: {
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: 160,
                      width: 64,
                      zIndex: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      paddingLeft: 4,
                      opacity: isHovered ? 1 : 0,
                      transition:
                        'opacity 0.22s var(--bb-easing-smooth, cubic-bezier(0.4, 0, 0.2, 1))',
                      pointerEvents: 'none',
                      background:
                        'linear-gradient(to right, var(--bg-elevated, rgba(16, 16, 20, 0.82)) 0%, rgba(16, 16, 20, 0.25) 60%, transparent 100%)',
                      borderTopLeftRadius: tokens.radius.md,
                      borderBottomLeftRadius: tokens.radius.md,
                    },
                  },
                  h(ScrollArrowButton, {
                    side: 'left',
                    testID: 'recommend-scroll-left',
                    label: t('sources:recommendShelf.scrollLeft'),
                    tabIndex: isHovered ? 0 : -1,
                    isHovered,
                    onClick: handleScrollLeft,
                  }),
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
                      // perspective + rotateY bends outer edge away with pleasant subtle angle
                      transform: isBendLeft
                        ? 'perspective(700px) rotateY(14deg)'
                        : isBendRight
                          ? 'perspective(700px) rotateY(-14deg)'
                          : undefined,
                      transformOrigin: isBendLeft
                        ? 'right center'
                        : isBendRight
                          ? 'left center'
                          : undefined,
                      transition:
                        'transform 0.28s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1))',
                    },
                  },
                  h(RecommendCard, { ctx, entry, onPress: onOpenCard }),
                  // Directional shading gradient: softly applied only over the 160px cover
                  // so the card's title and subtitle remain 100% crisp and readable
                  isBent
                    ? h('div', {
                        'aria-hidden': true,
                        style: {
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: 160,
                          height: 160,
                          borderRadius: tokens.radius.md,
                          pointerEvents: 'none',
                          background: isBendLeft
                            ? 'linear-gradient(to right, rgba(0,0,0,0.36) 0%, rgba(0,0,0,0.12) 40%, transparent 75%)'
                            : 'linear-gradient(to left,  rgba(0,0,0,0.36) 0%, rgba(0,0,0,0.12) 40%, transparent 75%)',
                        },
                      })
                    : null,
                )
              }),
            ),

            // ── Right arrow — absolute, fade-in on hover, aligned with cover artwork ─
            showRight
              ? h(
                  'div',
                  {
                    'data-testid': 'recommend-arrow-layer-right',
                    style: {
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      height: 160,
                      width: 64,
                      zIndex: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingRight: 4,
                      opacity: isHovered ? 1 : 0,
                      transition:
                        'opacity 0.22s var(--bb-easing-smooth, cubic-bezier(0.4, 0, 0.2, 1))',
                      pointerEvents: 'none',
                      background:
                        'linear-gradient(to left, var(--bg-elevated, rgba(16, 16, 20, 0.82)) 0%, rgba(16, 16, 20, 0.25) 60%, transparent 100%)',
                      borderTopRightRadius: tokens.radius.md,
                      borderBottomRightRadius: tokens.radius.md,
                    },
                  },
                  h(ScrollArrowButton, {
                    side: 'right',
                    testID: 'recommend-scroll-right',
                    label: t('sources:recommendShelf.scrollRight'),
                    tabIndex: isHovered ? 0 : -1,
                    isHovered,
                    onClick: handleScrollRight,
                  }),
                )
              : null,
          ),
  )
}

/** Interactive action button in the shelf header (e.g. "Show all") */
function RowActionButton({
  label,
  onPress,
  testID,
  rowHovered,
}: {
  label: string
  onPress: () => void
  testID?: string
  rowHovered: boolean
}): ReactElement {
  const [btnHovered, setBtnHovered] = useState(false)
  const [btnPressed, setBtnPressed] = useState(false)

  return h(
    'button',
    {
      type: 'button',
      'data-testid': testID,
      onClick: onPress,
      onMouseEnter: () => setBtnHovered(true),
      onMouseLeave: () => {
        setBtnHovered(false)
        setBtnPressed(false)
      },
      onMouseDown: () => setBtnPressed(true),
      onMouseUp: () => setBtnPressed(false),
      style: {
        background: btnHovered ? 'var(--surface-hover, rgba(255, 255, 255, 0.06))' : 'none',
        border: 'none',
        borderRadius: tokens.radius.sm,
        color: btnHovered
          ? 'var(--color-primary, #5F87FF)'
          : rowHovered
            ? 'var(--text-primary, rgba(255, 255, 255, 0.9))'
            : 'var(--text-secondary, rgba(255, 255, 255, 0.65))',
        fontSize: 13,
        fontWeight: btnHovered ? '600' : '400',
        cursor: 'pointer',
        padding: '3px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transform: btnPressed
          ? 'scale(0.97)'
          : btnHovered
            ? 'translateX(2px)'
            : 'none',
        transition:
          'color 0.18s ease, background-color 0.18s ease, transform 0.18s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1))',
      },
    },
    label,
    tablerIcon('chevron-right', {
      size: 14,
      color: btnHovered ? 'var(--color-primary, #5F87FF)' : 'currentColor',
    }),
  )
}

/** Frosted-glass scroll button with tactile hover & active physics */
function ScrollArrowButton({
  side,
  testID,
  label,
  tabIndex,
  isHovered,
  onClick,
}: {
  side: 'left' | 'right'
  testID?: string
  label: string
  tabIndex?: number
  isHovered: boolean
  onClick: (e: React.MouseEvent) => void
}): ReactElement {
  const [btnHovered, setBtnHovered] = useState(false)
  const [btnPressed, setBtnPressed] = useState(false)

  return h(
    'button',
    {
      type: 'button',
      'data-testid': testID,
      'aria-label': label,
      tabIndex,
      onClick,
      onMouseEnter: () => setBtnHovered(true),
      onMouseLeave: () => {
        setBtnHovered(false)
        setBtnPressed(false)
      },
      onMouseDown: () => setBtnPressed(true),
      onMouseUp: () => setBtnPressed(false),
      style: {
        width: 38,
        height: 38,
        borderRadius: '50%',
        background: btnHovered
          ? 'var(--surface-active, rgba(32, 32, 40, 0.95))'
          : 'var(--surface-hover, rgba(16, 16, 22, 0.82))',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        border: btnHovered
          ? '1px solid var(--border-strong, rgba(255, 255, 255, 0.35))'
          : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.18))',
        color: btnHovered
          ? 'var(--color-primary, #5F87FF)'
          : 'var(--text-primary, rgba(255, 255, 255, 0.95))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: btnHovered
          ? 'var(--shadow-dropdown-layered, 0 8px 24px rgba(0, 0, 0, 0.65))'
          : 'var(--shadow-dropdown, 0 4px 16px rgba(0, 0, 0, 0.45)), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255, 255, 255, 0.15))',
        padding: 0,
        outline: 'none',
        flexShrink: 0,
        pointerEvents: isHovered ? 'auto' : 'none',
        transform: btnPressed
          ? 'scale(0.94)'
          : btnHovered
            ? 'scale(1.08)'
            : 'scale(1)',
        transition:
          'transform 0.2s var(--bb-easing-tactile, cubic-bezier(0.16, 1, 0.3, 1)), background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
      },
    },
    tablerIcon(side === 'left' ? 'chevron-left' : 'chevron-right', {
      size: 20,
      color: 'currentColor',
    }),
  )
}

