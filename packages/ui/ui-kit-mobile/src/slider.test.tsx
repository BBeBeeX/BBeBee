// @vitest-environment jsdom
/**
 * The mobile scrubber, driven.
 *
 * `Slider` is the one component in this kit that holds state — a drag has to
 * survive between touch events — so it cannot be checked by calling it like a
 * function the way `index.test.tsx` checks the rest. It gets a renderer here.
 *
 * The renderer is React DOM, which works because this package **injects** its
 * primitives: the stand-ins below are ordinary components that render a `div`
 * and hang the React Native props they were given on the node, so a test can
 * fire `onResponderMove` exactly as the platform would. That is the same seam
 * `apps/mobile` uses to hand over the real `react-native` — a fake native host
 * rather than a mock of the component under test.
 *
 * What this cannot check is that React Native's responder system grants the
 * touch, which is the platform's job and the device smoke matrix's.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement as h, type ReactNode } from 'react'
import { render } from '@testing-library/react'
import { act } from 'react'
import { Slider, configureNative } from './index.js'

/** React Native props, as the platform would deliver them to a handler. */
interface NativeProps {
  onLayout?: (e: { nativeEvent: { layout: { width: number } } }) => void
  onResponderGrant?: (e: { nativeEvent: { locationX: number } }) => void
  onResponderMove?: (e: { nativeEvent: { locationX: number } }) => void
  onResponderRelease?: (e: { nativeEvent: { locationX: number } }) => void
  onResponderTerminate?: () => void
  onStartShouldSetResponder?: () => boolean
  onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void
  accessibilityRole?: string
  accessibilityValue?: { min: number; max: number; now: number }
  accessibilityState?: { disabled?: boolean }
  style?: Record<string, unknown>
  children?: ReactNode
}

/** A DOM node carrying the RN props it was rendered with. */
type HostNode = HTMLElement & { rn?: NativeProps }

function hostComponent(name: string) {
  return function Host(props: NativeProps) {
    return h(
      'div',
      {
        'data-host': name,
        ref: (node: HostNode | null) => {
          if (node) node.rn = props
        },
      },
      props.children,
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
})

const TRACK_WIDTH = 200

/** Render a slider and lay its track out, so there is a width to divide by. */
function scrubber(props: Parameters<typeof Slider>[0]) {
  const { container } = render(h(Slider, props))
  // `Array.from`, not a spread: this package's tsconfig is a React Native
  // one, where a NodeList is not iterable.
  const nodes = Array.from(container.querySelectorAll('[data-host="View"]')) as HostNode[]
  const root = nodes[0]!
  // The outer View is the accessible control; the one carrying the responder
  // handlers is the track inside it.
  const track = nodes.find((n) => n.rn?.onResponderMove !== undefined)!
  act(() => {
    track.rn?.onLayout?.({ nativeEvent: { layout: { width: TRACK_WIDTH } } })
  })
  return { root, track }
}

describe('Slider', () => {
  it('reports its range as an adjustable control', () => {
    const { root } = scrubber({ value: 30, max: 100 })
    expect(root.rn?.accessibilityRole).toBe('adjustable')
    expect(root.rn?.accessibilityValue).toMatchObject({ now: 30, max: 100 })
  })

  it('does not divide by a zero duration', () => {
    // A track whose duration is not known yet is the ordinary case at load.
    expect(() => scrubber({ value: 0, max: 0 })).not.toThrow()
    const { root, track } = scrubber({ value: 5000, max: 0 })
    expect(root.rn?.accessibilityValue).toMatchObject({ now: 0, max: 0 })
    expect(root.rn?.accessibilityState).toMatchObject({ disabled: true })
    expect(track.rn?.onStartShouldSetResponder?.()).toBe(false)
  })

  it('seeks to where the finger came up', () => {
    // M1 exit criterion 2 on mobile: without this the scrubber is a picture of
    // a scrubber. The now-playing screen wires `onCommit` to `player.seek`.
    const onCommit = vi.fn()
    const { track } = scrubber({ value: 0, max: 1000, onCommit })

    act(() => {
      track.rn?.onResponderGrant?.({ nativeEvent: { locationX: 0 } })
      track.rn?.onResponderRelease?.({ nativeEvent: { locationX: TRACK_WIDTH / 2 } })
    })

    expect(onCommit).toHaveBeenCalledWith(500)
  })

  it('reports the drag while it happens, and commits once at the end', () => {
    // Seeking per frame is what makes a scrubber unusable, and it is the
    // difference `onChange` and `onCommit` exist to express.
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const { track } = scrubber({ value: 0, max: 1000, onChange, onCommit })

    act(() => {
      track.rn?.onResponderGrant?.({ nativeEvent: { locationX: 20 } })
      track.rn?.onResponderMove?.({ nativeEvent: { locationX: 100 } })
      track.rn?.onResponderMove?.({ nativeEvent: { locationX: 160 } })
      track.rn?.onResponderRelease?.({ nativeEvent: { locationX: 160 } })
    })

    expect(onChange.mock.calls.map(([v]) => v)).toEqual([100, 500, 800])
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(800)
  })

  it('follows the finger rather than the value it was given', () => {
    // The caller is still on the old position until the seek lands; a thumb
    // that snapped back between the two would read as a failed drag.
    const { root, track } = scrubber({ value: 0, max: 1000 })
    act(() => {
      track.rn?.onResponderGrant?.({ nativeEvent: { locationX: TRACK_WIDTH } })
    })
    expect(root.rn?.accessibilityValue?.now).toBe(1000)
  })

  it('stays inside its range however far past the end the finger goes', () => {
    const onCommit = vi.fn()
    const { track } = scrubber({ value: 0, max: 1000, onCommit })
    act(() => {
      track.rn?.onResponderRelease?.({ nativeEvent: { locationX: TRACK_WIDTH * 3 } })
    })
    expect(onCommit).toHaveBeenCalledWith(1000)

    act(() => {
      track.rn?.onResponderRelease?.({ nativeEvent: { locationX: -50 } })
    })
    expect(onCommit).toHaveBeenLastCalledWith(0)
  })

  it('gives the position back when the OS takes the drag away', () => {
    // A call arriving, or a parent scroll winning, must not leave the thumb
    // stranded where the finger happened to be.
    const { root, track } = scrubber({ value: 250, max: 1000 })
    act(() => {
      track.rn?.onResponderGrant?.({ nativeEvent: { locationX: TRACK_WIDTH } })
    })
    expect(root.rn?.accessibilityValue?.now).toBe(1000)

    act(() => track.rn?.onResponderTerminate?.())
    expect(root.rn?.accessibilityValue?.now).toBe(250)
  })

  it('adjusts by a step for a screen reader, rather than committing where it already is', () => {
    // `onAccessibilityAction` used to commit the current value — a control
    // announced as adjustable that seeks to the position it is already at.
    const onCommit = vi.fn()
    const { root } = scrubber({ value: 500, max: 1000, onCommit })

    act(() => root.rn?.onAccessibilityAction?.({ nativeEvent: { actionName: 'increment' } }))
    expect(onCommit).toHaveBeenLastCalledWith(550)

    act(() => root.rn?.onAccessibilityAction?.({ nativeEvent: { actionName: 'decrement' } }))
    expect(onCommit).toHaveBeenLastCalledWith(450)
  })

  it('ignores touches and actions while disabled', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const { root, track } = scrubber({ value: 0, max: 1000, disabled: true, onChange, onCommit })

    expect(track.rn?.onStartShouldSetResponder?.()).toBe(false)
    act(() => root.rn?.onAccessibilityAction?.({ nativeEvent: { actionName: 'increment' } }))

    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })
})
