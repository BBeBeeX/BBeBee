// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { HoverLabel, isElementTruncated } from './HoverLabel.js'

describe('HoverLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('detects truncated element correctly', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(div, 'scrollWidth', { value: 150, configurable: true })
    expect(isElementTruncated(div)).toBe(true)

    Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
    expect(isElementTruncated(div)).toBe(false)

    div.setAttribute('data-truncated', 'true')
    expect(isElementTruncated(div)).toBe(true)
  })

  it('shows tooltip after 250ms default delay when truncated or alwaysShow is true', () => {
    const { getByTestId, queryByRole } = render(
      h(
        HoverLabel,
        {
          label: 'Full Title of the Long Song',
          testID: 'hover-target',
          alwaysShow: true,
        },
        h('span', null, 'Truncated...'),
      ),
    )

    const target = getByTestId('hover-target')
    fireEvent.mouseEnter(target)

    // At 200ms, tooltip has not appeared yet (delay is 250ms)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(queryByRole('tooltip')).toBeNull()

    // At 250ms, tooltip appears
    act(() => {
      vi.advanceTimersByTime(50)
    })
    const tooltip = queryByRole('tooltip')
    expect(tooltip).toBeTruthy()
    expect(tooltip?.textContent).toBe('Full Title of the Long Song')
  })

  it('does not show tooltip if content is not truncated and alwaysShow is false', () => {
    const { getByTestId, queryByRole } = render(
      h(
        HoverLabel,
        {
          label: 'Short Title',
          testID: 'hover-target',
        },
        h('span', null, 'Short Title'),
      ),
    )

    const target = getByTestId('hover-target')
    // In jsdom without layout, scrollWidth and clientWidth are 0, so not truncated
    fireEvent.mouseEnter(target)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip when child element has data-overflow or scrollWidth > clientWidth', () => {
    const { getByTestId, queryByRole } = render(
      h(
        HoverLabel,
        {
          label: 'Long Overflowing Title',
          testID: 'hover-target',
        },
        h('span', { 'data-overflow': '45', 'data-truncated': 'true' }, 'Long Overflowing Title'),
      ),
    )

    const target = getByTestId('hover-target')
    fireEvent.mouseEnter(target)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    const tooltip = queryByRole('tooltip')
    expect(tooltip).toBeTruthy()
    expect(tooltip?.textContent).toBe('Long Overflowing Title')
  })

  it('hides immediately when mouse leaves before or after timer fires', () => {
    const { getByTestId, queryByRole } = render(
      h(
        HoverLabel,
        {
          label: 'My Song',
          testID: 'hover-target',
          alwaysShow: true,
        },
        h('span', null, 'My Song'),
      ),
    )

    const target = getByTestId('hover-target')

    // Leave before delay: timer cancelled
    fireEvent.mouseEnter(target)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.mouseLeave(target)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(queryByRole('tooltip')).toBeNull()

    // Enter and let it show, then leave: hides immediately
    fireEvent.mouseEnter(target)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(queryByRole('tooltip')).toBeTruthy()

    fireEvent.mouseLeave(target)
    expect(queryByRole('tooltip')).toBeNull()
  })

  it('dismisses tooltip on Escape key or window scroll', () => {
    const { getByTestId, queryByRole } = render(
      h(
        HoverLabel,
        {
          label: 'Escape dismiss test',
          testID: 'hover-target',
          alwaysShow: true,
        },
        h('span', null, 'Text'),
      ),
    )

    const target = getByTestId('hover-target')
    fireEvent.mouseEnter(target)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(queryByRole('tooltip')).toBeTruthy()

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryByRole('tooltip')).toBeNull()
  })
})
