/**
 * Pure frame math for the mobile visualizer.
 *
 * The desktop twin draws through Canvas 2D (`VisualizerCanvas.tsx`); every
 * number it computes lives inline in its render loop. This module is the same
 * math hoisted into pure functions so the React Native render — which has no
 * canvas, only Views — and the tests can share it, and so the two engines
 * cannot drift.
 *
 * No React, no native primitives, no services.
 */

import type { VisualizerColorTheme } from '@BBeBee/protocol'

export type Scheme = 'dark' | 'light'

/** Bars on a phone: the desktop caps at 48, the phone at 32 for render cost. */
export const BAR_COUNT = 32
/** Circle rays: 48 thin Views read as a ring at phone widths. */
export const RAY_COUNT = 48
/** Wave columns: 48 samples across the width. */
export const WAVE_POINTS = 48
/** Particle pool size: the desktop pools 36, the phone renders 28. */
export const PARTICLE_COUNT = 28
/** Per-frame peak-cap decay, from the desktop render loop. */
export const PEAK_DECAY = 0.015
/** Wave phase advance per frame while playing / idle, from the desktop. */
export const WAVE_PHASE_PLAYING = 0.025
export const WAVE_PHASE_IDLE = 0.004

/**
 * Sample the frequency buffer into `barCount` normalized values (0..1).
 * Missing or empty buffers read as silence, never throw.
 */
export function sampleBars(
  freq: Uint8Array | null | undefined,
  barCount: number,
): number[] {
  const bars: number[] = []
  for (let i = 0; i < barCount; i++) {
    const raw = freq && i < freq.length ? (freq[i] ?? 0) : 0
    bars.push(Math.max(0, Math.min(1, raw / 255)))
  }
  return bars
}

/**
 * Advance the floating peak caps: a peak jumps to any higher bar and decays
 * linearly otherwise — the desktop `peaksRef` update, pure.
 */
export function decayPeaks(
  peaks: readonly number[],
  values: readonly number[],
  decay = PEAK_DECAY,
): number[] {
  return values.map((val, i) => {
    const prev = peaks[i] ?? 0
    if (val >= prev) return val
    return Math.max(0, prev - decay)
  })
}

/**
 * Mean energy of the lower half of the spectrum, 0..1 — the desktop wave's
 * "live" lift, pure.
 */
export function liveEnergy(freq: Uint8Array | null | undefined): number {
  if (!freq || freq.length === 0) return 0
  const half = Math.max(1, Math.floor(freq.length / 2))
  let sum = 0
  for (let i = 0; i < half; i++) sum += freq[i] ?? 0
  return sum / (half * 255)
}

/** The desktop's exponential smoothing: `prev * 0.85 + live * 0.15`. */
export function smoothEnergy(prev: number, live: number): number {
  return prev * 0.85 + live * 0.15
}

/**
 * One y offset of the cinematic three-band waveform at `progress` (0..1),
 * in units of the base amplitude — the desktop wave's exact sum:
 * three sines under a `sin(p·π)^2.2` tapered envelope.
 */
export function wavePoint(progress: number, phase: number): number {
  const envelope = Math.pow(Math.sin(progress * Math.PI), 2.2)
  const wave1 = Math.sin(progress * 8 + phase) * 0.65
  const wave2 = Math.sin(progress * 14 - phase * 0.8) * 0.25
  const wave3 = Math.cos(progress * 4 + phase * 0.3) * 0.15
  return (wave1 + wave2 + wave3) * envelope
}

/** Amplitude lift for the wave: idle 0.07 of height, playing 0.24, boosted. */
export function waveAmp(isPlaying: boolean, height: number, energy: number): number {
  return (isPlaying ? height * 0.24 : height * 0.07) * (1 + energy * 0.6)
}

/** Polar angle of ray `i` of `count`, radians from straight up, clockwise. */
export function rayAngle(i: number, count: number): number {
  return (i / count) * Math.PI * 2
}

/**
 * A dancing particle. `color` is baked at creation (the desktop pools the
 * same way, and rebuilds the pool when the color scheme flips).
 */
export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  bin: number
  color: string
}

/**
 * Spawn a pool of particles spread over `[0,w]×[0,h]`, each bound to a
 * frequency bin and tinted by `colorOf(pos)` — a deterministic-seed-free
 * port of the desktop pool (Math.random, like the desktop).
 */
export function createParticles(
  count: number,
  w: number,
  h: number,
  colorOf: (pos: number) => string,
): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 1.5,
    vy: (Math.random() - 0.5) * 1.5,
    radius: 2 + Math.random() * 3,
    bin: i % 24,
    color: colorOf(i / count),
  }))
}

/**
 * Advance one particle by its audio-driven velocity and wrap it around the
 * bounds — the desktop loop, immutable so a frame can be mapped.
 */
export function stepParticle(p: Particle, amp: number, w: number, h: number): Particle {
  let x = p.x + p.vx * (1 + amp * 2)
  let y = p.y + p.vy * (1 + amp * 2)
  if (x < 0) x += w
  if (x > w) x -= w
  if (y < 0) y += h
  if (y > h) y -= h
  return { ...p, x, y }
}

/**
 * Theme colour at normalized position `pos` (0..1) with `alpha` — the desktop
 * `getColor`, ported verbatim including the light-mode ink adjustments (the
 * neons and pastels wash out against a light page, so light mode rides darker
 * variants of the same families).
 */
export function colorForTheme(
  theme: VisualizerColorTheme,
  scheme: Scheme,
  pos: number,
  alpha = 1,
): string {
  switch (theme) {
    case 'neon':
      if (scheme === 'light') {
        return `rgba(0, ${Math.round(166 - 27 * pos)}, ${Math.round(110 + 80 * pos)}, ${alpha})`
      }
      return `rgba(${Math.round(96 * (1 - pos))}, ${Math.round(255 - 15 * pos)}, ${Math.round(180 + 75 * pos)}, ${alpha})`
    case 'rainbow': {
      const hue = Math.round(pos * 300)
      return `hsla(${hue}, 85%, ${scheme === 'light' ? 42 : 60}%, ${alpha})`
    }
    case 'monochrome':
      return scheme === 'light'
        ? `rgba(60, 63, 90, ${alpha * 0.85})`
        : `rgba(235, 235, 245, ${alpha * 0.85})`
    case 'accent':
    default: {
      // Cyber Bee character visual: Electric Blue -> Lavender in dark mode,
      // the theme's brand range in light so bars stay saturated on white.
      if (scheme === 'light') {
        const r = Math.round(59 + (112 - 59) * pos)
        const g = Math.round(102 + (72 - 102) * pos)
        const b = Math.round(245 + (232 - 245) * pos)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
      const r = Math.round(95 + (169 - 95) * pos)
      const g = Math.round(135 + (156 - 135) * pos)
      const b = 255
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  }
}

/**
 * Per-column alpha for the wave's tapered gradient stroke — the desktop fades
 * a horizontal Canvas gradient to transparent at both ends; the View-based
 * wave fades each column instead, same shape.
 */
export function waveColumnAlpha(progress: number): number {
  const envelope = Math.pow(Math.sin(progress * Math.PI), 2.2)
  return Math.max(0, Math.min(1, envelope * 0.85))
}
