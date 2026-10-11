/**
 * Loading placeholders shaped like the registry entry cards: title bar, meta
 * bar, two description lines and an action pill, in the same grid the real
 * cards use — so the page settles instead of jumping when the index lands.
 *
 * The shimmer is pure CSS (`@keyframes` live in the shared `BASELINE_CSS`,
 * injected once by the screens); this file holds no animation logic. The
 * bars are decorative, hence `aria-hidden`.
 */

import { createElement as h, type ReactElement } from 'react'
import { CARD_GRID } from '../styles.js'

const skeletonCardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
  borderRadius: 8,
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
} as const

const bar = (width: string | number, height: number, radius: number | string = 6, extraStyle?: Record<string, string | number>) => ({
  className: 'bbreg-skeleton',
  style: { width, height, borderRadius: radius, flexShrink: 0, ...extraStyle },
})

function SkeletonCard(): ReactElement {
  return h(
    'div',
    { style: skeletonCardStyle, 'aria-hidden': true },
    // Title row: name + heart placeholder.
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('div', { ...bar('55%', 15), key: 'title' }),
      h('div', { ...bar(24, 24, 999, { marginLeft: 'auto' }), key: 'heart' }),
    ),
    // Meta row: author / date placeholder.
    h('div', { ...bar('42%', 11), key: 'meta' }),
    // Description, two clamped lines.
    h('div', { ...bar('100%', 11), key: 'desc-1' }),
    h('div', { ...bar('86%', 11), key: 'desc-2' }),
    // Action row: the pill sits where the install button lands.
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 6 } },
      h('div', { ...bar(76, 28, 999), key: 'action' }),
    ),
  )
}

/** The skeleton grid; six cards fill the first two rows of the 280px grid. */
export function RegistrySkeletonGrid({ count = 6 }: { count?: number }): ReactElement {
  return h(
    'div',
    { style: CARD_GRID },
    Array.from({ length: count }, (_, index) => h(SkeletonCard, { key: index })),
  )
}
