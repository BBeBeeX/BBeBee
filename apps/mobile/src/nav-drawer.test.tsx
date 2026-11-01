// @vitest-environment jsdom
/**
 * The drawer overlay's arrangement — the regression that slipped past the
 * drawer's first delivery: the `flex: 1` backdrop listed before the panel
 * took the row's left edge and pushed the 320dp panel to the right, so the
 * "left" drawer opened on the right. These tests pin the order (panel first,
 * backdrop after), the width cap, and the backdrop's close affordance.
 *
 * They can exist only because `NavDrawerOverlay` sits on the kit's
 * `configureNative` seam; `App.tsx` itself never loads under vitest.
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { palettes } from '@BBeBee/ui-tokens'
import { NavDrawerOverlay, collectDrawerPages } from './nav-drawer'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, testID, accessibilityLabel, style, onPress } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        style: typeof style === 'object' && style !== null ? style : undefined,
        onClick: typeof onPress === 'function' ? onPress : undefined,
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

const palette = palettes.dark

function renderOverlay(
  overrides: Partial<{ width: number; onClose: () => void; topInset: number }> = {},
) {
  return render(
    h(NavDrawerOverlay, {
      palette,
      width: 400,
      closeLabel: 'Close',
      onClose: overrides.onClose ?? (() => {}),
      ...overrides,
      children: 'DRAWER BODY',
    }),
  )
}

describe('NavDrawerOverlay', () => {
  it('renders the panel as the first (left) child, the backdrop after it', () => {
    const { container } = renderOverlay()
    const overlay = container.querySelector('[data-testid="nav-drawer-overlay"]') as HTMLElement
    expect(overlay).toBeTruthy()

    // The row's first child is its left edge: the panel must be it, the
    // flex: 1 backdrop the remainder on the right. Reversed, the "left"
    // drawer opens on the right — the shipped bug.
    const [first, second] = Array.from(overlay.children)
    expect(first).toBe(container.querySelector('[data-testid="nav-drawer-panel"]'))
    expect(second).toBe(container.querySelector('[data-testid="nav-drawer-backdrop"]'))
    expect(first?.textContent).toContain('DRAWER BODY')
  })

  it('fills the window as an absolute row above the shell', () => {
    const { container } = renderOverlay()
    const overlay = container.querySelector('[data-testid="nav-drawer-overlay"]') as HTMLElement
    expect(overlay.style.position).toBe('absolute')
    expect(overlay.style.flexDirection).toBe('row')
    expect(overlay.style.zIndex).toBe('110')
  })

  it('caps the panel at 320dp, or 80% of a narrower window', () => {
    const wide = renderOverlay({ width: 900 })
    const widePanel = wide.container.querySelector(
      '[data-testid="nav-drawer-panel"]',
    ) as HTMLElement
    expect(widePanel.style.width).toBe('320px')
    wide.unmount()

    const narrow = renderOverlay({ width: 300 })
    const narrowPanel = narrow.container.querySelector(
      '[data-testid="nav-drawer-panel"]',
    ) as HTMLElement
    expect(narrowPanel.style.width).toBe('240px')
  })

  it('closes from the backdrop', () => {
    let closed = false
    const { container } = renderOverlay({ onClose: () => { closed = true } })
    const backdrop = container.querySelector('[data-testid="nav-drawer-backdrop"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(closed).toBe(true)
  })

  it('pads the panel content below the status bar by the top inset', () => {
    // The overlay is absolutely positioned and escapes the shell's
    // SafeAreaView padding — the panel carries the status-bar inset itself.
    const { container } = renderOverlay({ topInset: 24 })
    const panel = container.querySelector('[data-testid="nav-drawer-panel"]') as HTMLElement
    expect(panel.style.paddingTop).toBe('24px')
  })
})

describe('collectDrawerPages', () => {
  const routes = [
    { id: 'library.home', title: 'Library', order: 0 },
    { id: 'album.view', title: 'Album', order: 0 },
    { id: 'history.view', title: 'Play history', order: 25 },
    { id: 'sources.search', title: 'Search', order: 1 },
    // No mobile view registered: a desktop-only route stays out.
    { id: 'desktop.only', title: 'Desktop only', order: 0 },
  ]
  const hasView = (id: string) => id !== 'desktop.only'
  const translate = (_id: string, contributed: string) => `t(${contributed})`

  it('lists every route with a registered view, drops the rest', () => {
    const pages = collectDrawerPages(routes, hasView, translate)
    expect(pages.map((page) => page.id)).toEqual([
      'album.view',
      'library.home',
      'sources.search',
      'history.view',
    ])
  })

  it('sorts by contribution order, ties by id', () => {
    const pages = collectDrawerPages(routes, hasView, translate)
    expect(pages[0]?.id).toBe('album.view')
    expect(pages[pages.length - 1]?.id).toBe('history.view')
  })

  it('deduplicates routes contributed twice', () => {
    const pages = collectDrawerPages(
      [...routes, { id: 'album.view', title: 'Album', order: 0 }],
      hasView,
      translate,
    )
    expect(pages.filter((page) => page.id === 'album.view')).toHaveLength(1)
  })

  it('translates through the shell resolver with the contributed title', () => {
    const pages = collectDrawerPages(routes, hasView, translate)
    expect(pages.find((page) => page.id === 'album.view')?.title).toBe('t(Album)')
  })

  it('keeps routes without an order, after the ordered ones', () => {
    const pages = collectDrawerPages(
      [
        { id: 'a.late', title: 'Late' },
        { id: 'b.first', title: 'First', order: 1 },
      ],
      () => true,
      (_id, contributed) => contributed,
    )
    expect(pages.map((page) => page.id)).toEqual(['b.first', 'a.late'])
  })

  it("drops the ids the shell excludes (param'd details, transport overlays)", () => {
    const pages = collectDrawerPages(
      routes,
      hasView,
      (_id, contributed) => contributed,
      new Set(['album.view', 'queue.view']),
    )
    expect(pages.map((page) => page.id)).not.toContain('album.view')
    expect(pages.map((page) => page.id)).not.toContain('queue.view')
    expect(pages.map((page) => page.id)).toContain('library.home')
  })
})
