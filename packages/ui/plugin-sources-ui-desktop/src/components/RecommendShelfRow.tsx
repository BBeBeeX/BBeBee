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
import { Artwork, Text } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
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
 * A horizontal shelf row with always-visible half-cover fold panels and
 * hover-activated scroll arrows.
 *
 * When the row content overflows horizontally:
 * 1. Shows exactly half the adjacent card's cover at each edge, with a
 *    convex-arc outer edge (clip-path path) that simulates a cover bending
 *    around a vertical cylinder — always visible, no hover required.
 * 2. On hover, fades in ❮ / ❯ arrow buttons centred over each fold panel.
 * 3. Smoothly scrolls the shelf when an arrow is clicked.
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
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [edgeEntries, setEdgeEntries] = useState<{ left?: BrowseEntry; right?: BrowseEntry }>({})

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const overflow = el.scrollWidth > el.clientWidth + 2
    setHasOverflow(overflow)

    const canLeft = el.scrollLeft > 4
    const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setCanScrollLeft(canLeft)
    setCanScrollRight(canRight)

    if (entries.length > 0) {
      const cardStep = 172 // 160px card + 12px gap
      const leftIdx = Math.max(0, Math.floor(el.scrollLeft / cardStep) - 1)
      const rightIdx = Math.min(entries.length - 1, Math.ceil((el.scrollLeft + el.clientWidth) / cardStep))
      setEdgeEntries({
        left: entries[leftIdx] ?? entries[0],
        right: entries[rightIdx] ?? entries[entries.length - 1],
      })
    }
  }, [entries])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateScrollState()

    const onScroll = () => {
      updateScrollState()
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateScrollState()
          })
        : null
    observer?.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [updateScrollState])

  const scrollByAmount = (delta: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const handleScrollLeft = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = scrollRef.current
    const distance = el ? Math.max(200, el.clientWidth * 0.7) : 340
    scrollByAmount(-distance)
  }

  const handleScrollRight = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = scrollRef.current
    const distance = el ? Math.max(200, el.clientWidth * 0.7) : 340
    scrollByAmount(distance)
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
    // Header
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
    // Content body
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
            {
              style: {
                position: 'relative',
                width: '100%',
              },
            },
            // Left fold panel — always visible when there's content to the left
            hasOverflow && canScrollLeft
              ? h(EdgePeekPanel, {
                  ctx,
                  side: 'left',
                  entry: edgeEntries.left,
                  showArrow: isHovered,
                  onPress: handleScrollLeft,
                })
              : null,
            // Horizontal scrolling card container
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
                  paddingBottom: tokens.space[1],
                  scrollBehavior: 'smooth',
                },
              },
              ...entries.map((entry) =>
                h(RecommendCard, { key: entry.id, ctx, entry, onPress: onOpenCard }),
              ),
            ),
            // Right fold panel — always visible when there's more content to the right
            hasOverflow && canScrollRight
              ? h(EdgePeekPanel, {
                  ctx,
                  side: 'right',
                  entry: edgeEntries.right,
                  showArrow: isHovered,
                  onPress: handleScrollRight,
                })
              : null,
          ),
  )
}

/**
 * Half-cover fold panel with curved-surface edge effect.
 *
 * Visual construction — three layers inside a clipped container:
 *
 *   1. ARTWORK — the adjacent card's cover at full size (160×160 px), shifted
 *      so that exactly the inner half (80 px) fills the panel.  The user sees
 *      a genuine slice of the next/previous card.
 *
 *   2. CLIP + DROP-SHADOW — a `clip-path: path()` cuts the *outer* edge as a
 *      convex cubic-Bézier arc, simulating the cover bending around a vertical
 *      cylinder.  A `filter: drop-shadow()` (which respects clip-path unlike
 *      box-shadow) adds a soft cast shadow toward the main content area.
 *
 *   3. SHADING GRADIENT — a linear-gradient darkens the outer curved edge
 *      (surface angled away from the viewer) and fades to transparent at the
 *      inner edge, completing the cylindrical lighting illusion.
 *
 *   4. ARROW — a frosted-glass ❮/❯ button that opacity-transitions in on hover.
 */
function EdgePeekPanel({
  ctx,
  side,
  entry,
  showArrow,
  onPress,
}: {
  ctx: Context
  side: 'left' | 'right'
  entry?: BrowseEntry
  showArrow: boolean
  onPress: (e: React.MouseEvent) => void
}): ReactElement {
  const artwork = useResolvedArtwork(ctx, entry?.artwork)
  const isLeft = side === 'left'

  // Geometry constants
  const CARD_H = 160  // card height = card width in px
  const PANEL_W = 80  // exactly half the card — inner half visible
  // Arc depth: how far the outer-edge anchor points sit inward from the panel
  // edge at the top/bottom corners.  Larger → more pronounced curvature.
  const ARC = 20

  // SVG path for the clipped shape of the panel.
  //
  // Left panel — outer (curved) edge on the LEFT, straight inner edge on RIGHT:
  //   M ARC,0                       start at top of arc (inset from left by ARC)
  //   C 2,50 2,110 ARC,CARD_H       cubic Bézier bowing outward at midpoint
  //   L PANEL_W,CARD_H              across to bottom-right
  //   L PANEL_W,0 Z                 up to top-right, close
  //
  // Right panel — mirror image.
  const clipPath = isLeft
    ? `path('M ${ARC} 0 C 2 50 2 110 ${ARC} ${CARD_H} L ${PANEL_W} ${CARD_H} L ${PANEL_W} 0 Z')`
    : `path('M 0 0 L ${PANEL_W - ARC} 0 C ${PANEL_W - 2} 50 ${PANEL_W - 2} 110 ${PANEL_W - ARC} ${CARD_H} L 0 ${CARD_H} Z')`

  return h(
    'div',
    {
      'data-testid': isLeft ? 'recommend-fold-left' : 'recommend-fold-right',
      onClick: onPress,
      style: {
        position: 'absolute',
        [isLeft ? 'left' : 'right']: 0,
        top: 0,
        width: PANEL_W,
        height: CARD_H,
        zIndex: 10,
        cursor: 'pointer',
        clipPath,
        filter: isLeft
          ? 'drop-shadow(4px 0 10px rgba(0,0,0,0.65))'
          : 'drop-shadow(-4px 0 10px rgba(0,0,0,0.65))',
      },
    },
    // ── Layer 1: artwork — full card, offset to show inner half only ─────────
    //   Left  panel: pin card's RIGHT edge → show right half of card
    //   Right panel: pin card's LEFT  edge → show left  half of card
    h(
      'div',
      {
        style: {
          position: 'absolute',
          top: 0,
          [isLeft ? 'right' : 'left']: 0,
          width: CARD_H,
          height: CARD_H,
          pointerEvents: 'none',
        },
      },
      h(Artwork, {
        artwork,
        seed: entry?.id ?? (isLeft ? 'left-edge' : 'right-edge'),
        size: CARD_H,
        radius: 0,
      }),
    ),
    // ── Layer 2: cylindrical shading gradient ─────────────────────────────────
    //   Outer curved edge darkest (surface bending away from viewer),
    //   brightening toward the inner face — mimics directional lighting.
    h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: isLeft
          ? `linear-gradient(to right,
               rgba(0,0,0,0.72) 0%,
               rgba(0,0,0,0.35) 25%,
               rgba(0,0,0,0.10) 55%,
               rgba(0,0,0,0.00) 100%)`
          : `linear-gradient(to left,
               rgba(0,0,0,0.72) 0%,
               rgba(0,0,0,0.35) 25%,
               rgba(0,0,0,0.10) 55%,
               rgba(0,0,0,0.00) 100%)`,
        pointerEvents: 'none',
      },
    }),
    // ── Layer 3: frosted-glass arrow, fades in on hover ───────────────────────
    h(
      'div',
      {
        'data-testid': isLeft ? 'recommend-arrow-layer-left' : 'recommend-arrow-layer-right',
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: showArrow ? 1 : 0,
          transition: 'opacity 0.18s ease',
          pointerEvents: showArrow ? 'auto' : 'none',
        },
      },
      h(
        'button',
        {
          type: 'button',
          'data-testid': isLeft ? 'recommend-scroll-left' : 'recommend-scroll-right',
          'aria-label': isLeft ? '向左滚动' : '向右滚动',
          tabIndex: showArrow ? 0 : -1,
          style: {
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(12, 12, 16, 0.75)',
            backdropFilter: 'blur(12px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(12px) saturate(1.5)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            color: 'rgba(255, 255, 255, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            lineHeight: '1',
            fontWeight: '300',
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.55)',
            padding: '0 0 1px 0',
            outline: 'none',
            flexShrink: 0,
          },
        },
        isLeft ? '❮' : '❯',
      ),
    ),
  )
}
