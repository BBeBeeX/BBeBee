// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { MarqueeText } from './MarqueeText.js'
import {
  buildMarqueeKeyframes,
  PageMarqueeProvider,
  DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
  DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC,
  MARQUEE_FORWARD_START_MS,
  MARQUEE_FORWARD_WINDOW_END_MS,
  MARQUEE_RETURN_START_MS,
} from './PageMarqueeSync.js'

describe('buildMarqueeKeyframes (15s timeline & 40px/s uniform speed math)', () => {
  it('defines correct standard constants according to specification', () => {
    expect(DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS).toBe(15000)
    expect(DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC).toBe(40)
    expect(MARQUEE_FORWARD_START_MS).toBe(2250)
    expect(MARQUEE_FORWARD_WINDOW_END_MS).toBe(7500)
    expect(MARQUEE_RETURN_START_MS).toBe(9750)
  })

  it('handles non-truncated or zero travel with static keyframes', () => {
    const res = buildMarqueeKeyframes(0)
    expect(res.totalDurationMs).toBe(15000)
    expect(res.keyframes).toHaveLength(2)
    expect(res.keyframes[0]!.transform).toBe('translateX(0)')
    expect(res.keyframes[1]!.transform).toBe('translateX(0)')
  })

  it('calculates short title keyframes with uniform 40px/s speed and early completion hold', () => {
    // 40px travel at 40px/s takes 1000ms (1.0s)
    const { keyframes, totalDurationMs } = buildMarqueeKeyframes(40, 40, 15000)
    expect(totalDurationMs).toBe(15000)

    // Keyframes:
    // 0ms: 0px (offset 0)
    // 2250ms: 0px (offset 2250 / 15000 = 0.15)
    // 3250ms: -40px (offset 3250 / 15000 = 0.216666...)
    // 9750ms: -40px (offset 9750 / 15000 = 0.65)
    // 10750ms: 0px (offset 10750 / 15000 = 0.716666...)
    // 15000ms: 0px (offset 1.0)
    expect(keyframes).toHaveLength(6)

    expect(keyframes[0]!.offset).toBe(0)
    expect(keyframes[0]!.transform).toBe('translateX(0)')

    expect(keyframes[1]!.offset).toBeCloseTo(0.15, 4)
    expect(keyframes[1]!.transform).toBe('translateX(0)')

    expect(keyframes[2]!.offset).toBeCloseTo(3250 / 15000, 4)
    expect(keyframes[2]!.transform).toBe('translateX(-40px)')

    expect(keyframes[3]!.offset).toBeCloseTo(0.65, 4)
    expect(keyframes[3]!.transform).toBe('translateX(-40px)')

    expect(keyframes[4]!.offset).toBeCloseTo(10750 / 15000, 4)
    expect(keyframes[4]!.transform).toBe('translateX(0)')

    expect(keyframes[5]!.offset).toBe(1)
    expect(keyframes[5]!.transform).toBe('translateX(0)')

    // Verify speed = distance / time = 40px / 1s = 40px/s
    const forwardTimeSec = (3250 - 2250) / 1000
    expect(40 / forwardTimeSec).toBe(40)

    const returnTimeSec = (10750 - 9750) / 1000
    expect(40 / returnTimeSec).toBe(40)
  })

  it('calculates full window boundary title (210px at 40px/s)', () => {
    // 210px at 40px/s takes exactly 5250ms (5.25s)
    // Arrives at 2250 + 5250 = 7500ms (50%)
    // Returns from 9750ms (65%), arrives at 0 at 9750 + 5250 = 15000ms (100%)
    const { keyframes, totalDurationMs } = buildMarqueeKeyframes(210, 40, 15000)
    expect(totalDurationMs).toBe(15000)

    expect(keyframes[0]!.offset).toBe(0)
    expect(keyframes[1]!.offset).toBeCloseTo(0.15, 4) // 2250ms
    expect(keyframes[2]!.offset).toBeCloseTo(0.5, 4) // 7500ms
    expect(keyframes[2]!.transform).toBe('translateX(-210px)')
    expect(keyframes[3]!.offset).toBeCloseTo(0.65, 4) // 9750ms
    expect(keyframes[3]!.transform).toBe('translateX(-210px)')
    expect(keyframes[4]!.offset).toBe(1) // 15000ms
    expect(keyframes[4]!.transform).toBe('translateX(0)')
  })

  it('handles ultra-long titles with harmonic multi-cycle extension maintaining strictly 40px/s', () => {
    // 300px at 40px/s takes 7500ms (7.5s)
    // Arrives at 2250 + 7500 = 9750ms
    // Min end pause 2250ms -> return start at 12000ms
    // Return takes 7500ms -> arrives at 0 at 12000 + 7500 = 19500ms
    // Fits within 2 cycles of 15s (30000ms)
    const { keyframes, totalDurationMs } = buildMarqueeKeyframes(300, 40, 15000)
    expect(totalDurationMs).toBe(30000) // Exactly 2 x 15s

    // Speed forward: 300px / 7.5s = 40px/s
    const fwdStart = keyframes[1]!.offset as number
    const fwdEnd = keyframes[2]!.offset as number
    const fwdDurationSec = (fwdEnd - fwdStart) * 30
    expect(300 / fwdDurationSec).toBeCloseTo(40, 4)

    // Speed return: 300px / 7.5s = 40px/s
    const retStart = keyframes[3]!.offset as number
    const retEnd = keyframes[4]!.offset as number
    const retDurationSec = (retEnd - retStart) * 30
    expect(300 / retDurationSec).toBeCloseTo(40, 4)

    // Final keyframe holds at origin until 30s
    expect(keyframes[keyframes.length - 1]!.offset).toBe(1)
    expect(keyframes[keyframes.length - 1]!.transform).toBe('translateX(0)')
  })
})

describe('MarqueeText & PageMarqueeProvider Component', () => {
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

  it('synchronizes 15s timeline and uniform 40px/s pixel speed across titles', () => {
    const animateCalls: Array<{ keyframes: Keyframe[]; opts: KeyframeAnimationOptions }> = []
    HTMLElement.prototype.animate = vi.fn().mockImplementation((keyframes, opts) => {
      animateCalls.push({ keyframes: keyframes as Keyframe[], opts: opts as KeyframeAnimationOptions })
      return { currentTime: 0, cancel: vi.fn() }
    })

    const { container } = render(
      h(
        PageMarqueeProvider,
        null,
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

    // m1: overflow 80px -> travel = 86px
    Object.defineProperty(outer1, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer1, 'scrollWidth', { value: 180, configurable: true })

    // m2: overflow 150px -> travel = 156px
    Object.defineProperty(outer2, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(outer2, 'scrollWidth', { value: 250, configurable: true })

    act(() => {
      for (const cb of resizeCallbacks) cb()
    })

    // Both animations are initialized with the standard 15-second cycle (15000ms)
    expect(animateCalls.length).toBe(2)
    expect(animateCalls[0]!.opts.duration).toBe(15000)
    expect(animateCalls[1]!.opts.duration).toBe(15000)

    // Keyframes travel distance: overflow + 6px breathing room
    expect((animateCalls[0]!.keyframes[2] as Keyframe).transform).toBe('translateX(-86px)')
    expect((animateCalls[1]!.keyframes[2] as Keyframe).transform).toBe('translateX(-156px)')

    // Uniform forward pixel speed: distance / duration == 40px/s for both!
    // m1 travel 86px in (offset2 - offset1) * 15s
    const m1FwdDurationSec = ((animateCalls[0]!.keyframes[2]!.offset as number) - (animateCalls[0]!.keyframes[1]!.offset as number)) * 15
    expect(86 / m1FwdDurationSec).toBeCloseTo(40, 4)

    // m2 travel 156px in (offset2 - offset1) * 15s
    const m2FwdDurationSec = ((animateCalls[1]!.keyframes[2]!.offset as number) - (animateCalls[1]!.keyframes[1]!.offset as number)) * 15
    expect(156 / m2FwdDurationSec).toBeCloseTo(40, 4)
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
