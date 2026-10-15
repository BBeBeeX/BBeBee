// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { MarqueeText } from './MarqueeText.js'
import { PageMarqueeProvider } from './PageMarqueeSync.js'

describe('MarqueeText & PageMarqueeProvider', () => {
  let originalRO: typeof ResizeObserver
  let originalAnimate: typeof HTMLElement.prototype.animate
  let resizeCallbacks: Array<() => void> = []

  beforeEach(() => {
    vi.useFakeTimers()
    resizeCallbacks = []
    originalRO = window.ResizeObserver
    originalAnimate = HTMLElement.prototype.animate

    window.ResizeObserver = class {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    window.ResizeObserver = originalRO
    HTMLElement.prototype.animate = originalAnimate
  })

  it('renders content statically without animation when text fits within container', () => {
    const { container } = render(
      h(MarqueeText, { testID: 'marquee-short' }, 'Short'),
    )
    const el = container.querySelector('[data-testid="marquee-short"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('data-truncated')).toBeNull()
    expect(el?.getAttribute('data-overflow')).toBeNull()
  })

  it('sets data-truncated and data-overflow when scrollWidth exceeds clientWidth', () => {
    const { container } = render(
      h(MarqueeText, { testID: 'marquee-long' }, 'A very long title that exceeds the container boundary'),
    )

    const outer = container.querySelector('[data-testid="marquee-long"]') as HTMLElement
    expect(outer).toBeTruthy()

    // Simulate layout width difference
    Object.defineProperty(outer, 'clientWidth', { value: 200, configurable: true })
    Object.defineProperty(outer, 'scrollWidth', { value: 350, configurable: true })

    act(() => {
      for (const cb of resizeCallbacks) cb()
    })

    expect(outer.getAttribute('data-truncated')).toBe('true')
    expect(outer.getAttribute('data-overflow')).toBe('150')
  })

  it('synchronizes animation timeline across all visible items within PageMarqueeProvider', () => {
    const animateCalls: Array<{ keyframes: Keyframe[]; opts: KeyframeAnimationOptions }> = []
    HTMLElement.prototype.animate = vi.fn().mockImplementation((keyframes, opts) => {
      animateCalls.push({ keyframes: keyframes as Keyframe[], opts: opts as KeyframeAnimationOptions })
      return { currentTime: 0, cancel: vi.fn() }
    })

    const { container } = render(
      h(
        PageMarqueeProvider,
        { cycleDurationMs: 8000 },
        h(
          'div',
          null,
          h(MarqueeText, { testID: 'm1' }, 'First Long Title'),
          h(MarqueeText, { testID: 'm2' }, 'Second Long Title'),
        ),
      ),
    )

    const outer1 = container.querySelector('[data-testid="m1"]') as HTMLElement
    const outer2 = container.querySelector('[data-testid="m2"]') as HTMLElement

    Object.defineProperty(outer1, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer1, 'scrollWidth', { value: 180, configurable: true })
    Object.defineProperty(outer2, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer2, 'scrollWidth', { value: 250, configurable: true })

    act(() => {
      for (const cb of resizeCallbacks) cb()
    })

    // Both animations are initialized with the same duration (8000ms)
    expect(animateCalls.length).toBe(2)
    expect(animateCalls[0]!.opts.duration).toBe(8000)
    expect(animateCalls[1]!.opts.duration).toBe(8000)

    // Keyframes travel distance: overflow + 6px breathing room
    expect((animateCalls[0]!.keyframes[2] as Keyframe).transform).toBe('translateX(-86px)') // 80 + 6
    expect((animateCalls[1]!.keyframes[2] as Keyframe).transform).toBe('translateX(-156px)') // 150 + 6
  })

  it('respects prefers-reduced-motion by disabling animation and using standard ellipsis', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const animateMock = vi.fn()
    HTMLElement.prototype.animate = animateMock

    const { container } = render(
      h(MarqueeText, { testID: 'm-reduced' }, 'Reduced motion title'),
    )

    const outer = container.querySelector('[data-testid="m-reduced"]') as HTMLElement
    Object.defineProperty(outer, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer, 'scrollWidth', { value: 250, configurable: true })

    act(() => {
      for (const cb of resizeCallbacks) cb()
    })

    // Animation should not be called when reduced motion is preferred
    expect(animateMock).not.toHaveBeenCalled()
    expect(outer.style.textOverflow).toBe('ellipsis')

    window.matchMedia = originalMatchMedia
  })

  it('shows hover tooltip after 250ms when truncated', () => {
    const { container, queryByRole } = render(
      h(MarqueeText, { testID: 'm-hover' }, 'Full Hoverable Song Title That Overflows'),
    )

    const outer = container.querySelector('[data-testid="m-hover"]') as HTMLElement
    Object.defineProperty(outer, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer, 'scrollWidth', { value: 250, configurable: true })

    act(() => {
      for (const cb of resizeCallbacks) cb()
    })

    const hoverWrapper = container.firstElementChild as HTMLElement
    fireEvent.mouseEnter(hoverWrapper)

    act(() => {
      vi.advanceTimersByTime(250)
    })

    const tooltip = queryByRole('tooltip')
    expect(tooltip).toBeTruthy()
    expect(tooltip?.textContent).toBe('Full Hoverable Song Title That Overflows')

    fireEvent.mouseLeave(hoverWrapper)
    expect(queryByRole('tooltip')).toBeNull()
  })
})
