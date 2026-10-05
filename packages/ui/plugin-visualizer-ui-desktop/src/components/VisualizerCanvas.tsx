/**
 * VisualizerCanvas — real-time audio visualization canvas component.
 *
 * All styles render through the Canvas 2D API (one persistent 2d context —
 * no WebGL context juggling):
 * - 'bars': Equalizer spectrum bars with gradient fill and bouncing peak caps.
 * - 'wave': Cinematic organic waveform — layered tapered sine bands, gradient
 *   stroke fading at both ends, soft glow, amplitude lifted by live audio.
 * - 'circle': Radial 360-degree circular spectrum radiating from center.
 * - 'particles': Floating dancing particles reacting to audio energy.
 *
 * Supports 4 color themes: 'accent', 'neon', 'rainbow', 'monochrome'.
 */

import { createElement as h, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'
import { useTransport } from '@BBeBee/toolkit/hooks'
import { useAudioData, useVisualizer } from '@BBeBee/plugin-visualizer/hooks'
import { tokens } from '@BBeBee/ui-tokens'

export interface VisualizerCanvasProps {
  ctx: Context
  height?: number
  previewStyle?: VisualizerStyle
  previewTheme?: VisualizerColorTheme
  interactive?: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  bin: number
  color: string
}

export function VisualizerCanvas({
  ctx,
  height = 72,
  previewStyle,
  previewTheme,
}: VisualizerCanvasProps): ReactElement | null {
  const { settings } = useVisualizer(ctx)
  const transport = useTransport(ctx)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const activeStyle = previewStyle ?? settings.style ?? 'bars'
  const activeTheme = previewTheme ?? settings.colorTheme ?? 'accent'
  const isPlaying = transport.status === 'playing'

  // Hook to acquire real-time audio data buffers
  const { frequencyDataRef, timeDomainDataRef } = useAudioData(
    ctx,
    isPlaying,
    settings.fftSize ?? 128,
  )

  // Floating peak caps for 'bars' style
  const peaksRef = useRef<number[]>([])
  // Particles pool for 'particles' style
  const particlesRef = useRef<Particle[]>([])
  // Phase & smoothed live energy for the 'wave' cinematic organic style
  const wavePhaseRef = useRef(0)
  const waveEnergyRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    let animId = 0

    const resize = () => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const width = rect.width || 320
      const h = height || 72
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(h * dpr)
    }

    resize()

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resize())
        : null
    observer?.observe(canvas)

    // Helper to generate color based on theme and normalized position (0..1)
    const getColor = (pos: number, alpha = 1): string => {
      switch (activeTheme) {
        case 'neon':
          return `rgba(${Math.round(96 * (1 - pos))}, ${Math.round(255 - 15 * pos)}, ${Math.round(180 + 75 * pos)}, ${alpha})`
        case 'rainbow': {
          const hue = Math.round(pos * 300)
          return `hsla(${hue}, 85%, 60%, ${alpha})`
        }
        case 'monochrome':
          return `rgba(235, 235, 245, ${alpha * 0.85})`
        case 'accent':
        default: {
          // Cyber Bee character visual: Electric Blue (95, 135, 255) -> Lavender (169, 156, 255)
          const r = Math.round(95 + (169 - 95) * pos)
          const g = Math.round(135 + (156 - 135) * pos)
          const b = 255
          return `rgba(${r}, ${g}, ${b}, ${alpha})`
        }
      }
    }

    // Animation render loop
    const render = () => {
      const w = canvas.width
      const h = canvas.height

      const freq = frequencyDataRef.current

      const g = canvas.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, w, h)

      if (activeStyle === 'bars') {
        const binCount = freq ? freq.length : 32
        const barCount = Math.min(binCount, 48)
        const gap = 3 * dpr
        const barWidth = Math.max(2 * dpr, (w - (barCount - 1) * gap) / barCount)

        if (peaksRef.current.length !== barCount) {
          peaksRef.current = new Array(barCount).fill(0)
        }

        for (let i = 0; i < barCount; i++) {
          const val = freq ? (freq[i] ?? 0) / 255 : 0
          const barHeight = Math.max(2 * dpr, val * (h - 8 * dpr))
          const x = i * (barWidth + gap)
          const y = h - barHeight

          // Draw gradient bar
          const grad = g.createLinearGradient(x, y, x, h)
          const colorTop = getColor(i / barCount, 0.95)
          const colorBot = getColor(i / barCount, 0.25)
          grad.addColorStop(0, colorTop)
          grad.addColorStop(1, colorBot)

          g.fillStyle = grad
          g.beginPath()
          const radius = Math.min(barWidth / 2, 4 * dpr)
          if (typeof g.roundRect === 'function') {
            g.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0])
          } else {
            g.rect(x, y, barWidth, barHeight)
          }
          g.fill()

          // Peak cap
          let peak = peaksRef.current[i] ?? 0
          if (val >= peak) {
            peak = val
          } else {
            peak = Math.max(0, peak - 0.015)
          }
          peaksRef.current[i] = peak

          const peakY = h - peak * (h - 8 * dpr) - 3 * dpr
          g.fillStyle = getColor(i / barCount, 0.9)
          g.fillRect(x, Math.max(0, peakY), barWidth, 2 * dpr)
        }
      } else if (activeStyle === 'wave') {
        // Cinematic organic waveform (映画歌词 style, ported from the
        // now-playing CinematicLayout): three layered sine bands under a
        // strong tapered envelope, stroked with a gradient that fades to
        // transparent at both ends plus a soft glow. Live audio only lifts
        // the amplitude — the shape and motion stay the page's signature.
        wavePhaseRef.current += isPlaying ? 0.025 : 0.004
        const phase = wavePhaseRef.current

        let live = 0
        if (freq && freq.length > 0) {
          const half = Math.max(1, Math.floor(freq.length / 2))
          for (let i = 0; i < half; i++) live += freq[i] ?? 0
          live = live / (half * 255)
        }
        waveEnergyRef.current = waveEnergyRef.current * 0.85 + live * 0.15
        const boost = 1 + waveEnergyRef.current * 0.6

        const baseAmp = (isPlaying ? h * 0.24 : h * 0.07) * boost

        const grad = g.createLinearGradient(0, 0, w, 0)
        grad.addColorStop(0, getColor(0.5, 0))
        grad.addColorStop(0.12, getColor(0.5, 0.45))
        grad.addColorStop(0.5, getColor(0.5, 0.85))
        grad.addColorStop(0.88, getColor(0.5, 0.45))
        grad.addColorStop(1, getColor(0.5, 0))

        g.beginPath()
        g.strokeStyle = grad
        g.lineWidth = 1.2 * dpr
        g.shadowColor = getColor(0.5, 0.5)
        g.shadowBlur = isPlaying ? 4 * dpr : 1 * dpr

        const midY = h / 2
        g.moveTo(0, midY)
        for (let x = 0; x <= w; x += 2 * dpr) {
          const progress = x / w
          const envelope = Math.pow(Math.sin(progress * Math.PI), 2.2)
          const wave1 = Math.sin(progress * 8 + phase) * baseAmp * 0.65
          const wave2 = Math.sin(progress * 14 - phase * 0.8) * baseAmp * 0.25
          const wave3 = Math.cos(progress * 4 + phase * 0.3) * baseAmp * 0.15
          g.lineTo(x, midY + (wave1 + wave2 + wave3) * envelope)
        }
        g.stroke()
        g.shadowBlur = 0
      } else if (activeStyle === 'circle') {
        const cx = w / 2
        const cy = h / 2
        const baseRadius = Math.min(w, h) * 0.22
        const binCount = freq ? Math.min(freq.length, 64) : 32

        g.lineWidth = 2 * dpr
        for (let i = 0; i < binCount; i++) {
          const angle = (i / binCount) * Math.PI * 2
          const val = freq ? (freq[i] ?? 0) / 255 : 0
          const barLen = val * (Math.min(w, h) * 0.26)
          const r1 = baseRadius
          const r2 = baseRadius + barLen

          const x1 = cx + Math.cos(angle) * r1
          const y1 = cy + Math.sin(angle) * r1
          const x2 = cx + Math.cos(angle) * r2
          const y2 = cy + Math.sin(angle) * r2

          g.strokeStyle = getColor(i / binCount, 0.85)
          g.beginPath()
          g.moveTo(x1, y1)
          g.lineTo(x2, y2)
          g.stroke()
        }

        // Inner glowing core
        g.beginPath()
        g.arc(cx, cy, baseRadius - 2 * dpr, 0, Math.PI * 2)
        g.strokeStyle = getColor(0.5, 0.4)
        g.stroke()
      } else if (activeStyle === 'particles') {
        // Initialize particle pool if needed
        if (particlesRef.current.length < 36) {
          particlesRef.current = Array.from({ length: 36 }, (_, i) => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 1.5 * dpr,
            vy: (Math.random() - 0.5) * 1.5 * dpr,
            radius: (2 + Math.random() * 3) * dpr,
            bin: i % 24,
            color: getColor(i / 36, 0.8),
          }))
        }

        for (const p of particlesRef.current) {
          const amp = freq ? (freq[p.bin] ?? 0) / 255 : 0
          p.x += p.vx * (1 + amp * 2)
          p.y += p.vy * (1 + amp * 2)

          if (p.x < 0) p.x = w
          if (p.x > w) p.x = 0
          if (p.y < 0) p.y = h
          if (p.y > h) p.y = 0

          const r = p.radius * (1 + amp * 1.4)
          g.fillStyle = p.color
          g.beginPath()
          g.arc(p.x, p.y, r, 0, Math.PI * 2)
          g.fill()
        }
      }

      if (isPlaying) {
        animId = requestAnimationFrame(render)
      }
    }

    render()

    return () => {
      observer?.disconnect()
      if (animId) cancelAnimationFrame(animId)
    }
  }, [isPlaying, activeStyle, activeTheme, height, frequencyDataRef, timeDomainDataRef])

  if (!previewStyle && !settings.enabled) {
    return null
  }

  return h('div', {
    'aria-label': 'Audio visualizer',
    role: 'img',
    style: {
      width: '100%',
      maxWidth: 480,
      height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens.radius.md,
      overflow: 'hidden',
      position: 'relative',
    },
    children: h('canvas', {
      ref: canvasRef,
      style: {
        width: '100%',
        height: '100%',
        display: 'block',
      },
    }),
  })
}
