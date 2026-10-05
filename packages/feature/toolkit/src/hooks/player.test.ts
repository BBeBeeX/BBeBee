/**
 * The part of the view layer with actual logic.
 *
 * These are written once and consumed by both shells, so a bug here is a bug
 * on two platforms — which is exactly why they live in the headless package
 * and are tested without a renderer.
 */

import { describe, expect, it } from 'vitest'
import { isPlayingLike } from './player.js'

describe('isPlayingLike', () => {
  it('counts a buffer underrun as playing', () => {
    // The bug this pins: a bar that swapped to a play button mid-buffer while
    // the lock screen a foot away still said "playing". docs/05 §2 keeps them
    // agreeing, and both views read this one rule.
    expect(isPlayingLike('stalled')).toBe(true)
    expect(isPlayingLike('loading'), 'the user pressed play and is waiting').toBe(true)
    expect(isPlayingLike('playing')).toBe(true)
  })

  it('does not count anything else', () => {
    expect(isPlayingLike('paused')).toBe(false)
    expect(isPlayingLike('idle')).toBe(false)
    expect(isPlayingLike('error')).toBe(false)
  })
})
