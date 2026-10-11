import { describe, expect, it } from 'vitest'
import { identicon } from './identicon.js'

describe('identicon', () => {
  it('derives nothing from no identity', () => {
    expect(identicon(undefined)).toBeUndefined()
    expect(identicon('')).toBeUndefined()
  })

  it('is deterministic — the same seed, the same square, forever', () => {
    const first = identicon('BBeBee:local:track:9f2c8a1e')
    expect(identicon('BBeBee:local:track:9f2c8a1e')).toEqual(first)
    // Across "platforms" here means across calls and processes; the hash is
    // hand-rolled precisely so nothing platform-shaped can drift it.
    expect(first).toBeDefined()
  })

  it('pins the pattern, so a silent algorithm change is a test failure', () => {
    expect(identicon('BBeBee:local:track:9f2c8a1e')).toEqual({
      cells: [
        true, true, true, true, true,
        true, false, false, false, true,
        true, true, false, true, true,
        false, true, false, true, false,
        false, true, true, true, false,
      ],
      foreground: 'hsl(65, 68%, 58%)',
      background: 'hsl(65, 30%, 14%)',
    })
  })

  it('mirrors the left three columns onto the right two', () => {
    // Vertical symmetry is what makes the shape read as deliberate rather
    // than as noise; every row must be a palindrome.
    for (const seed of ['BBeBee:local:album:abc', 'a', 'b', '♪♪', 'Japanese title']) {
      const cells = identicon(seed)!.cells
      for (let row = 0; row < 5; row++) {
        for (let column = 0; column < 5; column++) {
          expect(cells[row * 5 + column], seed).toBe(cells[row * 5 + (4 - column)])
        }
      }
    }
  })

  it('always paints something', () => {
    // One hash in 32 768 is an empty grid, which would render as the plain
    // square the identicon exists to replace. Sweep enough seeds that the
    // sweep itself is deterministic but the guard is genuinely exercised.
    for (let i = 0; i < 5000; i++) {
      expect(identicon(`seed-${i}`)!.cells.some(Boolean), `seed-${i}`).toBe(true)
    }
  })

  it('distinguishes seeds', () => {
    expect(identicon('a')).not.toEqual(identicon('b'))
  })

  it('varies the hue across a library', () => {
    // Two hundred albums landing in fewer than half the hues would read as a
    // palette, not as identity. The hash spreads uniformly, so the margin is
    // enormous — this fails only if the hue derivation breaks outright.
    const hues = new Set<string>()
    for (let i = 0; i < 200; i++) {
      hues.add(identicon(`BBeBee:local:track:${i}`)!.foreground)
    }
    expect(hues.size).toBeGreaterThan(100)
  })

  it('handles astral-plane code points', () => {
    // A surrogate pair must be consumed as one code point — hashed as its
    // UTF-8 bytes, not twice as bare UTF-16 units, which is where a
    // charCode-at-a-time hash drifts between platforms.
    const pattern = identicon('🎵-Mix')!
    expect(pattern.cells).toHaveLength(25)
    expect(pattern.cells.some(Boolean)).toBe(true)
    expect(identicon('🎶-Mix')).not.toEqual(pattern)
  })
})
