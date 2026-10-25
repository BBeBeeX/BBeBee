/**
 * VisualizerCanvas — the mobile real-time audio visualization.
 *
 * The desktop twin draws through Canvas 2D. React Native has no canvas in the
 * mobile app's dependency set — `@shopify/react-native-skia` is not a
 * dependency of `apps/mobile` — and the repo's `react-native`-injection
 * discipline (`configureNative`, docs/08 §6) means this package cannot import
 * `react-native`'s Animated either. So the frame is drawn with **plain Views**
 * driven by a throttled pure-JS render loop:
 *
 * - 'bars': 32 vertical Views with peak caps (2 px lines).
 * - 'wave': 48 tapered columns sampled from the desktop's three-band sine sum.
 * - 'circle': 48 thin rays placed with rotate+translate transforms.
 * - 'particles': 28 absolutely-positioned dots stepping through the pool.
 *
 * The frame loop re-renders at ~30 fps while playing (one static frame when
 * paused, matching the desktop's no-rAF idle path) — the trade-off versus a
 * Skia/reanimated approach is CPU-driven re-renders instead of GPU-driven
 * draws; at these element counts that is comfortably inside frame budget, and
 * it adds zero native dependencies. All the math lives in `frame-math.ts`,
 * shared with the tests.
 */

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'
import { nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { useTransport } from '@BBeBee/toolkit/hooks'
import { tokens } from '@BBeBee/ui-tokens'
import { useAudioData, useVisualizer } from '@bbebee/plugin-visualizer/hooks'
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
  WAVE_PHASE_IDLE,
  WAVE_PHASE_PLAYING,
  type Particle,
  type Scheme,
} from '../frame-math.js'

export interface VisualizerCanvasProps {
  ctx: Context
  height?: number
  previewStyle?: VisualizerStyle
  previewTheme?: VisualizerColorTheme
  interactive?: boolean
  /** Light-mode ink variants; the phone player is dark-first today. */
  scheme?: Scheme
}

/** One rendered frame's payload — only the active style's data is filled. */
interface Frame {
  bars: number[]
  peaks: number[]
  wave: number[]
  rays: number[]
  particles: Particle[]
}

const EMPTY_FRAME: Frame = {
  bars: [],
  peaks: [],
  wave: [],
  rays: [],
  particles: [],
}

/** ~30 fps: the re-render cadence, decoupled from the rAF callback rate. */
const FRAME_INTERVAL_MS = 33

export function VisualizerCanvas({
  ctx,
  height = 72,
  previewStyle,
  previewTheme,
  scheme = 'dark',
}: VisualizerCanvasProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const { settings } = useVisualizer(ctx)
  const transport = useTransport(ctx)
  const isPlaying = transport.status === 'playing'

  const activeStyle = previewStyle ?? settings.style ?? 'bars'
  const activeTheme = previewTheme ?? settings.colorTheme ?? 'accent'

  // Same subscription pattern as the desktop canvas: `useAudioData` runs its
  // own rAF loop pulling `ctx.visualizer` into refs while playing.
  const { frequencyDataRef, timeDomainDataRef } = useAudioData(
    ctx,
    isPlaying,
    settings.fftSize ?? 128,
  )

  const native = nativePrimitives()
  const [width, setWidth] = useState(0)
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME)

  // Mutable animation state — the desktop keeps the same in refs.
  const peaksRef = useRef<number[]>([])
  const particlesRef = useRef<Particle[]>([])
  const wavePhaseRef = useRef(0)
  const waveEnergyRef = useRef(0)
  const lastFrameAtRef = useRef(0)

  // The colour function, bound to the active theme and scheme.
  const colorOf = useMemo(
    () => (pos: number, alpha = 1) => colorForTheme(activeTheme, scheme, pos, alpha),
    [activeTheme, scheme],
  )

  useEffect(() => {
    const compute = (): Frame => {
      const freq = frequencyDataRef.current
      const w = width || 320
      const h = height

      if (activeStyle === 'bars') {
        const bars = sampleBars(freq, BAR_COUNT)
        peaksRef.current = decayPeaks(peaksRef.current, bars)
        return { ...EMPTY_FRAME, bars, peaks: peaksRef.current.slice() }
      }

      if (activeStyle === 'wave') {
        wavePhaseRef.current += isPlaying ? WAVE_PHASE_PLAYING : WAVE_PHASE_IDLE
        const energy = smoothEnergy(waveEnergyRef.current, liveEnergy(freq))
        waveEnergyRef.current = energy
        const amp = waveAmp(isPlaying, h, energy)
        const wave: number[] = []
        for (let i = 0; i < WAVE_POINTS; i++) {
          wave.push(wavePoint(i / (WAVE_POINTS - 1), wavePhaseRef.current) * amp)
        }
        return { ...EMPTY_FRAME, wave }
      }

      if (activeStyle === 'circle') {
        const rays: number[] = []
        for (let i = 0; i < RAY_COUNT; i++) {
          const raw = freq && i < freq.length ? (freq[i] ?? 0) : 0
          rays.push(Math.max(0, Math.min(1, raw / 255)))
        }
        return { ...EMPTY_FRAME, rays }
      }

      // particles
      if (particlesRef.current.length !== PARTICLE_COUNT) {
        particlesRef.current = createParticles(PARTICLE_COUNT, w, h, (pos) => colorOf(pos, 0.8))
      }
      const particles = particlesRef.current.map((p) => {
        const amp = freq && p.bin < freq.length ? (freq[p.bin] ?? 0) / 255 : 0
        return stepParticle(p, amp, w, h)
      })
      particlesRef.current = particles
      return { ...EMPTY_FRAME, particles }
    }

    // One static frame when paused — the desktop's idle path draws once too.
    if (!isPlaying || width === 0) {
      setFrame(compute())
      return
    }

    let animId = 0
    const loop = () => {
      const now = Date.now()
      if (now - lastFrameAtRef.current >= FRAME_INTERVAL_MS) {
        lastFrameAtRef.current = now
        setFrame(compute())
      }
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => {
      if (animId) cancelAnimationFrame(animId)
    }
  }, [isPlaying, activeStyle, activeTheme, height, width, scheme, colorOf, frequencyDataRef, timeDomainDataRef])

  // Disabled outside a preview — the desktop canvas returns null the same way.
  if (!previewStyle && !settings.enabled) {
    return null
  }

  const w = width || 320

  return h(native.View as never, {
    accessibilityLabel: t('visualizer:visualizerCanvas.audioVisualizer'),
    accessibilityRole: 'image',
    testID: 'visualizer-canvas',
    onLayout: (ev: { nativeEvent?: { layout?: { width?: number } } }) => {
      const next = ev.nativeEvent?.layout?.width
      if (next && Math.abs(next - width) > 0.5) setWidth(next)
    },
    style: {
      width: '100%',
      maxWidth: 480,
      height,
      borderRadius: tokens.radius.md,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    children: renderFrame(native, {
      style: activeStyle,
      width: w,
      height,
      frame,
      colorOf,
      peaks: frame.peaks,
    }),
  })
}

type NativeLike = ReturnType<typeof nativePrimitives>

/**
 * The frame as a View tree. Factored out of the component body: it is a pure
 * function of the frame payload, and keeping it out of the hook-heavy render
 * path keeps both readable.
 */
function renderFrame(
  native: NativeLike,
  input: {
    style: VisualizerStyle
    width: number
    height: number
    frame: Frame
    colorOf: (pos: number, alpha?: number) => string
    peaks: number[]
  },
): ReactElement | null {
  const { style, width, height, frame, colorOf, peaks } = input
  const cx = width / 2
  const cy = height / 2

  if (style === 'bars') {
    const barCount = frame.bars.length || BAR_COUNT
    const gap = 3
    const barWidth = Math.max(2, (width - (barCount - 1) * gap) / barCount)
    return h(
      native.View as never,
      { style: { width: '100%', height: '100%' } },
      ...frame.bars.map((val, i) => {
        const x = i * (barWidth + gap)
        const barHeight = Math.max(2, val * (height - 8))
        // Peak cap, floating above its bar — the desktop's `peakY`.
        const peak = peaks[i] ?? 0
        const peakBottom = 4 + peak * (height - 8) + 3
        return h(
          native.View as never,
          { key: i },
          // The bar, anchored to the bottom.
          h(native.View as never, {
            style: {
              position: 'absolute',
              left: x,
              bottom: 4,
              width: barWidth,
              height: barHeight,
              borderRadius: Math.min(barWidth / 2, 4),
              backgroundColor: colorOf(i / barCount, 0.95),
            },
          }),
          // The peak cap line.
          h(native.View as never, {
            style: {
              position: 'absolute',
              left: x,
              bottom: Math.min(height - 2, peakBottom),
              width: barWidth,
              height: 2,
              borderRadius: 1,
              backgroundColor: colorOf(i / barCount, 0.9),
            },
          }),
        )
      }),
    )
  }

  if (style === 'wave') {
    const colWidth = width / WAVE_POINTS
    return h(
      native.View as never,
      { style: { width: '100%', height: '100%' } },
      ...frame.wave.map((offset, i) => {
        const progress = i / (WAVE_POINTS - 1)
        const barHeight = Math.max(1.5, Math.abs(offset))
        return h(native.View as never, {
          key: i,
          style: {
            position: 'absolute',
            left: i * colWidth,
            top: cy - barHeight / 2,
            width: Math.max(1, colWidth * 0.8),
            height: barHeight,
            borderRadius: Math.max(1, colWidth * 0.4),
            backgroundColor: colorOf(0.5, waveColumnAlpha(progress)),
          },
        })
      }),
    )
  }

  if (style === 'circle') {
    const baseRadius = Math.min(width, height) * 0.22
    const maxLen = Math.min(width, height) * 0.26
    return h(
      native.View as never,
      { style: { width: '100%', height: '100%' } },
      // Inner glowing core.
      h(native.View as never, {
        style: {
          position: 'absolute',
          left: cx - baseRadius + 2,
          top: cy - baseRadius + 2,
          width: Math.max(0, (baseRadius - 2) * 2),
          height: Math.max(0, (baseRadius - 2) * 2),
          borderRadius: Math.max(0, baseRadius - 2),
          borderWidth: 1,
          borderColor: colorOf(0.5, 0.4),
        },
      }),
      ...frame.rays.map((val, i) => {
        const angle = (i / frame.rays.length) * Math.PI * 2
        const barLen = Math.max(2, val * maxLen)
        return h(native.View as never, {
          key: i,
          style: {
            position: 'absolute',
            left: cx - 1,
            top: cy - barLen / 2,
            width: 2,
            height: barLen,
            borderRadius: 1,
            backgroundColor: colorOf(i / frame.rays.length, 0.85),
            // Rotate the coordinate system to the ray's angle, then slide the
            // ray outward so its inner edge sits on the base circle.
            transform: [
              { rotate: `${(angle * 180) / Math.PI}deg` },
              { translateY: -(baseRadius + barLen / 2) },
            ],
          },
        })
      }),
    )
  }

  // particles
  return h(
    native.View as never,
    { style: { width: '100%', height: '100%' } },
    ...frame.particles.map((p, i) => {
      const r = p.radius
      return h(native.View as never, {
        key: i,
        style: {
          position: 'absolute',
          left: p.x - r,
          top: p.y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: p.color,
        },
      })
    }),
  )
}
