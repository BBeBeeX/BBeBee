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
 * A horizontal shelf row with hover-activated 3D curved folded half-covers and scroll arrows.
 *
 * When hovered and the row content overflows horizontally:
 * 1. Shows a 3D curved folded half-cover on the leftmost and rightmost edges.
 * 2. Overlays '<' and '>' arrows on top of the folded covers if that direction has more content.
 * 3. Smoothly scrolls the shelf when clicked.
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
            // Left folded half-cover with curved surface 3D effect
            hasOverflow && isHovered && canScrollLeft
              ? h(FoldedHalfCover, {
                  ctx,
                  side: 'left',
                  entry: edgeEntries.left,
                  hasMore: canScrollLeft,
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
            // Right folded half-cover with curved surface 3D effect
            hasOverflow && isHovered && canScrollRight
              ? h(FoldedHalfCover, {
                  ctx,
                  side: 'right',
                  entry: edgeEntries.right,
                  hasMore: canScrollRight,
                  onPress: handleScrollRight,
                })
              : null,
          ),
  )
}

/**
 * 3D curved folded half-cover at the edge of the shelf.
 *
 * Simulates a cover bent around a cylindrical curve into depth (rotateY with perspective),
 * topped with a cylinder lighting/shadow gradient and an overlay arrow layer.
 */
function FoldedHalfCover({
  ctx,
  side,
  entry,
  hasMore,
  onPress,
}: {
  ctx: Context
  side: 'left' | 'right'
  entry?: BrowseEntry
  hasMore: boolean
  onPress: (e: React.MouseEvent) => void
}): ReactElement {
  const artwork = useResolvedArtwork(ctx, entry?.artwork)
  const isLeft = side === 'left'

  return h(
    'div',
    {
      'data-testid': isLeft ? 'recommend-fold-left' : 'recommend-fold-right',
      onClick: onPress,
      style: {
        position: 'absolute',
        [isLeft ? 'left' : 'right']: 0,
        top: 0,
        width: 72,
        height: 160,
        zIndex: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        perspective: '600px',
        transformOrigin: isLeft ? 'left center' : 'right center',
        transform: `perspective(600px) rotateY(${isLeft ? '30deg' : '-30deg'}) scale(0.98)`,
        borderRadius: isLeft
          ? `${tokens.radius.md} 0 0 ${tokens.radius.md}`
          : `0 ${tokens.radius.md} ${tokens.radius.md} 0`,
        boxShadow: isLeft
          ? '6px 0 20px rgba(0,0,0,0.65), inset -2px 0 8px rgba(255,255,255,0.08)'
          : '-6px 0 20px rgba(0,0,0,0.65), inset 2px 0 8px rgba(255,255,255,0.08)',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
      },
    },
    // Cover artwork container (shifted so half of 160px is visible in 72px slot)
    h(
      'div',
      {
        style: {
          position: 'absolute',
          top: 0,
          [isLeft ? 'right' : 'left']: 0,
          width: 160,
          height: 160,
          pointerEvents: 'none',
        },
      },
      h(Artwork, {
        artwork,
        seed: entry?.id ?? (isLeft ? 'left-edge' : 'right-edge'),
        size: 160,
        radius: tokens.radius.md,
      }),
    ),
    // Curved surface cylinder light/shadow overlay
    h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: isLeft
          ? 'linear-gradient(90deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 45%, rgba(255,255,255,0.15) 80%, rgba(0,0,0,0.4) 100%)'
          : 'linear-gradient(-90deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 45%, rgba(255,255,255,0.15) 80%, rgba(0,0,0,0.4) 100%)',
        pointerEvents: 'none',
      },
    }),
    // Arrow overlay layer
    hasMore
      ? h(
          'div',
          {
            'data-testid': isLeft ? 'recommend-arrow-layer-left' : 'recommend-arrow-layer-right',
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.25)',
              backdropFilter: 'blur(2px)',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'data-testid': isLeft ? 'recommend-scroll-left' : 'recommend-scroll-right',
              'aria-label': isLeft ? '向左滚动' : '向右滚动',
              style: {
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(20, 20, 24, 0.75)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                padding: 0,
                outline: 'none',
              },
            },
            isLeft ? '<' : '>',
          ),
        )
      : null,
  )
}
