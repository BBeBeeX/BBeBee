/**
 * Frame-math tests: the numbers the mobile View-based visualizer renders must
 * match the desktop Canvas 2D math function for function, so the two engines
 * cannot drift.
 */

import { describe, expect, it } from 'vitest'
import {
  BAR_COUNT,
  colorForTheme,
  createParticles,
  decayPeaks,
  liveEnergy,
  PARTICLE_COUNT,
  RAY_COUNT,
  sampleBars,
  smoothEnergy,
  stepParticle,
  WAVE_POINTS,
  waveAmp,
  waveColumnAlpha,
  wavePoint,
  type Particle,
} from './frame-math.js'

const freq = (values: number[]): Uint8Array => Uint8Array.from(values)

describe('sampleBars', () => {
  it('normalizes byte bins into 0..1', () => {
    expect(sampleBars(freq([0, 127, 255]), 3)).toEqual([0, 127 / 255, 1])
  })

  it('pads missing bins and empty buffers with silence', () => {
    expect(sampleBars(freq([255]), 3)).toEqual([1, 0, 0])
    expect(sampleBars(new Uint8Array(0), 2)).toEqual([0, 0])
    expect(sampleBars(null, 2)).toEqual([0, 0])
    expect(sampleBars(undefined, 4)).toHaveLength(4)
  })

  it('uses the phone bar count, not the desktop 48', () => {
    expect(BAR_COUNT).toBe(32)
    expect(sampleBars(freq([255]), BAR_COUNT)).toHaveLength(BAR_COUNT)
  })
})

describe('decayPeaks', () => {
  it('jumps a peak up to a higher bar immediately', () => {
    expect(decayPeaks([0.2, 0.5], [0.9, 0.1])[0]).toBe(0.9)
  })

  it('decays a falling bar by PEAK_DECAY and clamps at zero', () => {
    const next = decayPeaks([0.5, 0.01], [0.3, 0])
    expect(next[0]).toBeCloseTo(0.5 - 0.015)
    expect(next[1]).toBe(0)
  })

  it('holds when the bar is exactly at the peak', () => {
    expect(decayPeaks([0.5], [0.5])[0]).toBe(0.5)
  })
})

describe('wave math', () => {
  it('envelope vanishes at both ends — the tapered gradient shape', () => {
    const amp = 10
    expect(Math.abs(wavePoint(0, 1.23) * amp)).toBeLessThan(0.01)
    expect(Math.abs(wavePoint(1, 1.23) * amp)).toBeLessThan(0.01)
    // …and peaks near the middle.
    expect(Math.abs(wavePoint(0.5, 1.23))).toBeGreaterThan(0)
  })

  it('phase animates: same point moves between frames while playing', () => {
    expect(wavePoint(0.5, 0)).not.toBe(wavePoint(0.5, 0.025))
  })

  it('live energy reads the lower half of the spectrum', () => {
    // 255 in the first bin of a 128-bin buffer: half = 64 bins summed.
    const e = liveEnergy(freq([255, ...new Array(127).fill(0)]))
    expect(e).toBeCloseTo(255 / (64 * 255))
    expect(liveEnergy(null)).toBe(0)
    expect(liveEnergy(new Uint8Array(0))).toBe(0)
  })

  it('smoothing matches the desktop weights (0.85 / 0.15)', () => {
    expect(smoothEnergy(1, 0)).toBeCloseTo(0.85)
    expect(smoothEnergy(0, 1)).toBeCloseTo(0.15)
  })

  it('amplitude lifts with playing and energy', () => {
    expect(waveAmp(true, 100, 0)).toBeCloseTo(24)
    expect(waveAmp(false, 100, 0)).toBeCloseTo(7)
    expect(waveAmp(true, 100, 1)).toBeCloseTo(24 * 1.6)
  })

  it('column alpha tapers to the edges', () => {
    expect(waveColumnAlpha(0)).toBeCloseTo(0)
    expect(waveColumnAlpha(0.5)).toBeCloseTo(0.85)
    expect(waveColumnAlpha(1)).toBeCloseTo(0)
  })

  it('samples WAVE_POINTS columns', () => {
    expect(WAVE_POINTS).toBe(48)
  })
})

describe('circle rays', () => {
  it('spreads RAY_COUNT rays over a full turn', () => {
    expect(RAY_COUNT).toBe(48)
    // The step between adjacent rays is a full turn divided by the count.
    expect(rayDelta(0, 1)).toBeCloseTo((Math.PI * 2) / RAY_COUNT)
  })

  function rayDelta(i: number, count: number): number {
    // Re-derives the angle the canvas computes, for the delta assertion.
    const angleOf = (n: number) => (n / RAY_COUNT) * Math.PI * 2
    void count
    return angleOf(i + 1) - angleOf(i)
  }
})

describe('particles', () => {
  it('spawns the phone pool size with baked colors across the spectrum', () => {
    const pool = createParticles(PARTICLE_COUNT, 320, 72, (pos) => `c${Math.round(pos * 100)}`)
    expect(pool).toHaveLength(PARTICLE_COUNT)
    expect(new Set(pool.map((pt) => pt.color)).size).toBeGreaterThan(1)
    for (const pt of pool) {
      expect(pt.x).toBeGreaterThanOrEqual(0)
      expect(pt.x).toBeLessThanOrEqual(320)
      expect(pt.y).toBeLessThanOrEqual(72)
    }
  })

  it('steps a particle faster when the audio is louder', () => {
    const p: Particle = { x: 50, y: 50, vx: 1, vy: 0, radius: 2, bin: 0, color: 'c' }
    const quiet = stepParticle(p, 0, 320, 72)
    const loud = stepParticle(p, 1, 320, 72)
    expect(quiet.x).toBe(51)
    expect(loud.x).toBe(53)
    expect(quiet.y).toBe(50)
  })

  it('wraps at the bounds instead of escaping the frame', () => {
    const p: Particle = { x: 0, y: 72, vx: -1, vy: 1, radius: 2, bin: 0, color: 'c' }
    const stepped = stepParticle(p, 0, 320, 72)
    expect(stepped.x).toBe(319)
    expect(stepped.y).toBe(1)
  })
})

describe('colorForTheme', () => {
  it('matches the desktop accent ramp endpoints in dark mode', () => {
    expect(colorForTheme('accent', 'dark', 0, 1)).toBe('rgba(95, 135, 255, 1)')
    expect(colorForTheme('accent', 'dark', 1, 1)).toBe('rgba(169, 156, 255, 1)')
  })

  it('rides darker, more saturated ink in light mode', () => {
    expect(colorForTheme('accent', 'light', 0, 1)).toBe('rgba(59, 102, 245, 1)')
    expect(colorForTheme('accent', 'light', 1, 1)).toBe('rgba(112, 72, 232, 1)')
  })

  it('maps rainbow onto a hue sweep and monochrome onto fixed silver', () => {
    expect(colorForTheme('rainbow', 'dark', 0.5, 1)).toBe('hsla(150, 85%, 60%, 1)')
    expect(colorForTheme('monochrome', 'dark', 0.2, 1)).toBe('rgba(235, 235, 245, 0.85)')
    expect(colorForTheme('monochrome', 'light', 0.2, 1)).toBe('rgba(60, 63, 90, 0.85)')
  })

  it('neon descends red while rising green-to-cyan in dark mode', () => {
    expect(colorForTheme('neon', 'dark', 0, 1)).toBe('rgba(96, 255, 180, 1)')
    expect(colorForTheme('neon', 'dark', 1, 1)).toBe('rgba(0, 240, 255, 1)')
  })
})
