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
 * A horizontal shelf row with always-visible edge peek covers and hover-activated scroll arrows.
 *
 * When the row content overflows horizontally:
 * 1. Shows a naturally clipped partial cover at each overflowing edge, with a soft
 *    depth gradient that gives a tactile "more content here" affordance — always visible.
 * 2. On hover, fades in '<' and '>' arrow buttons over the edge panels to invite scrolling.
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
            // Left edge peek panel — always visible when there's something scrolled past left
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
            // Right edge peek panel — always visible when there's more content to the right
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
 * Edge peek panel: shows the partially visible cover at the row edge with a
 * soft gradient vignette — giving a natural "more content behind" visual cue
 * without resorting to jarring 3D transforms.
 *
 * The effect works in three layers:
 *   1. The actual cover artwork, clipped to the panel width, so the user sees
 *      a genuine slice of the next/previous card.
 *   2. A directional gradient that fades the inner edge of the artwork to
 *      transparent, blending it into the background — creating the impression
 *      of depth and curvature without a literal rotation.
 *   3. On hover: a frosted-glass arrow button centred over the panel.
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

  // Width of the peeking sliver. ~55px shows enough of the cover to be
  // recognisable without occluding too much of the visible cards.
  const PANEL_WIDTH = 56
  // The cover is rendered at full card size; we shift it so the *inner* edge
  // of the artwork aligns with the *inner* edge of the panel, so the
  // visible strip is the outer part of the adjacent card.
  const CARD_SIZE = 160

  return h(
    'div',
    {
      'data-testid': isLeft ? 'recommend-fold-left' : 'recommend-fold-right',
      onClick: onPress,
      style: {
        position: 'absolute',
        [isLeft ? 'left' : 'right']: 0,
        top: 0,
        width: PANEL_WIDTH,
        height: CARD_SIZE,
        zIndex: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        borderRadius: isLeft
          ? `${tokens.radius.md} 0 0 ${tokens.radius.md}`
          : `0 ${tokens.radius.md} ${tokens.radius.md} 0`,
      },
    },
    // ── Layer 1: the artwork, offset so the outer slice is visible ──────────
    h(
      'div',
      {
        style: {
          position: 'absolute',
          top: 0,
          // Left panel shows the right portion of the previous card.
          // Right panel shows the left portion of the next card.
          [isLeft ? 'right' : 'left']: 0,
          width: CARD_SIZE,
          height: CARD_SIZE,
          pointerEvents: 'none',
        },
      },
      h(Artwork, {
        artwork,
        seed: entry?.id ?? (isLeft ? 'left-edge' : 'right-edge'),
        size: CARD_SIZE,
        radius: tokens.radius.md,
      }),
    ),
    // ── Layer 2: depth-fade gradient ────────────────────────────────────────
    // Fades the inner edge (towards the visible cards) to transparent so the
    // slice blends into the background, and darkens the outer edge slightly
    // to suggest the card is receding into depth.
    h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: isLeft
          ? `linear-gradient(to right,
               rgba(0,0,0,0.55) 0%,
               rgba(0,0,0,0.18) 38%,
               rgba(0,0,0,0.04) 65%,
               rgba(0,0,0,0) 100%)`
          : `linear-gradient(to left,
               rgba(0,0,0,0.55) 0%,
               rgba(0,0,0,0.18) 38%,
               rgba(0,0,0,0.04) 65%,
               rgba(0,0,0,0) 100%)`,
        pointerEvents: 'none',
      },
    }),
    // ── Layer 3: frosted-glass arrow, fades in on hover ─────────────────────
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
          // Fade the arrow in/out with a CSS transition driven by opacity.
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
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(15, 15, 18, 0.72)',
            backdropFilter: 'blur(10px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            color: 'rgba(255, 255, 255, 0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: '600',
            letterSpacing: '-0.5px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            padding: 0,
            outline: 'none',
            flexShrink: 0,
          },
        },
        isLeft ? '‹' : '›',
      ),
    ),
  )
}
