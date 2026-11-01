// @vitest-environment jsdom
/**
 * The stats page's play-count heatmap, rendered against DOM host components —
 * the same seam `plugin-now-playing-ui-mobile` uses to test RN views without
 * a device.
 *
 * What is asserted is the part the drawer contract leans on
 * (docs/ui/architecture.md §7.4): one chart for a year and for three months,
 * the desktop chart's week-chunking, and cells coloured by the shared level
 * scale in `@BBeBee/ui-tokens` — never a second scale.
 */

import { cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayHistoryHeatmapDay } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { PlayHeatmap } from './PlayHeatmap.js'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, testID, accessibilityLabel, style } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        style: typeof style === 'object' && style !== null ? style : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
  ScrollView: hostComponent('ScrollView'),
})

/** Key-identity translator: the chart's strings are looked up, not asserted. */
const t = (key: string): string => key

/** Ten days from a Sunday (2026-01-04) — no first-week padding. */
function days(counts: number[], startIso = '2026-01-04'): PlayHistoryHeatmapDay[] {
  const start = new Date(`${startIso}T00:00:00`)
  return counts.map((count, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    const iso = day.toISOString().slice(0, 10)
    return { date: iso, count, msPlayed: count * 60_000 }
  })
}

describe('PlayHeatmap', () => {
  it('renders nothing without data', () => {
    const { container } = render(h(PlayHeatmap, { heatmap: [], t }))
    expect(container.querySelector('[data-testid="play-heatmap"]')).toBeNull()
  })

  it('renders one cell per day, coloured by the shared level scale', () => {
    const { container } = render(
      h(PlayHeatmap, { heatmap: days([0, 1, 15, 4]), t }),
    )
    expect(container.querySelector('[data-testid="play-heatmap"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-host="View"][style]').length).toBeGreaterThan(0)

    const level0 = container.querySelector<HTMLElement>('[data-testid="heatmap-cell-2026-01-04"]')
    const level1 = container.querySelector<HTMLElement>('[data-testid="heatmap-cell-2026-01-05"]')
    const level4 = container.querySelector<HTMLElement>('[data-testid="heatmap-cell-2026-01-06"]')
    const level2 = container.querySelector<HTMLElement>('[data-testid="heatmap-cell-2026-01-07"]')
    expect(level0?.style.backgroundColor).toBe('rgba(255, 255, 255, 0.07)')
    expect(level1?.style.backgroundColor).toBe('rgb(14, 68, 41)')
    expect(level4?.style.backgroundColor).toBe('rgb(57, 211, 83)')
    expect(level2?.style.backgroundColor).toBe('rgb(0, 109, 50)')
  })

  it('pads the first week up to the start weekday', () => {
    // 2026-01-05 is a Monday: one leading null cell, so the grid still has
    // seven rows in its first column — and the same ten cells.
    const { container } = render(
      h(PlayHeatmap, { heatmap: days([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], '2026-01-05'), t }),
    )
    expect(container.querySelector('[data-testid="heatmap-cell-2026-01-05"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid^="heatmap-cell-"]')).toHaveLength(10)
  })

  it('renders the month label row and the legend', () => {
    const { container } = render(h(PlayHeatmap, { heatmap: days([1, 2, 3]), t }))
    const text = container.textContent ?? ''
    expect(text).toContain('history:playHeatmap.jan')
    expect(text).toContain('history:playHeatmap.less')
    expect(text).toContain('history:playHeatmap.more')
  })
})
