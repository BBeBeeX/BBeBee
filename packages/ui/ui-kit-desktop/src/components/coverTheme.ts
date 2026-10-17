import { useEffect, useState } from 'react'
import { parseHex } from '@BBeBee/ui-tokens'
import { toBbebeeFileUri } from './Artwork.js'

/**
 * A detail page's background takes its colour from the cover, the way
 * Spotify's do. A ref's `dominantColor` — computed once at cache time — is
 * the primary source; a cover without one gets a one-shot canvas extraction
 * of its image, and a cover that cannot be read (remote URLs without CORS, a
 * failed decode, no cover at all) gets `undefined`, i.e. the caller's neutral
 * gradient.
 *
 * Deliberately ctx-free: the caller resolves the ref through the cache hook
 * and hands over the URL plus the declared colour.
 */
export function useImageColor(sourceUrl: string | undefined, declared?: string): string | undefined {
  const [extracted, setExtracted] = useState<string | undefined>(undefined)
  const hasDeclared = Boolean(declared)

  useEffect(() => {
    if (hasDeclared || !sourceUrl) {
      setExtracted((prev) => (prev === undefined ? prev : undefined))
      return
    }
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (!cancelled) setExtracted(extractVibrantColor(image) ?? undefined)
    }
    image.onerror = () => {
      if (!cancelled) setExtracted(undefined)
    }
    image.src = toBbebeeFileUri(sourceUrl) ?? sourceUrl
    return () => {
      cancelled = true
    }
  }, [hasDeclared, sourceUrl])

  return declared ?? extracted
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`, or `undefined` untouched. */
export function tintRgba(tint: string | undefined, alpha: number): string | undefined {
  if (!tint) return undefined
  try {
    const { r, g, b } = parseHex(tint)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  } catch {
    return undefined
  }
}

const DEFAULT_GRADIENT =
  'linear-gradient(180deg, var(--surface-hover, rgba(95, 135, 255, 0.15)) 0%, var(--surface-1, rgba(8, 13, 26, 0.7)) 62%, var(--bg-primary, #080A10) 100%)'

/**
 * A detail page's header gradient — the cover's colour strongest at the very
 * top, fading into the app background exactly at the header's bottom edge.
 * Percentage stops, so whatever the header's height turns out to be, the
 * content below the header sits on pure `--bg-primary` with no seam, and the
 * pinned table header's solid background matches it.
 *
 * No tint — no cover, unreadable cover — falls back to the neutral brand
 * wash with the same shape.
 */
export function headerGradient(tint: string | undefined): string {
  const top = tintRgba(tint, 0.5)
  const mid = tintRgba(tint, 0.16)
  if (!top || !mid) return DEFAULT_GRADIENT
  return `linear-gradient(180deg, ${top} 0%, ${mid} 62%, var(--bg-primary, #080A10) 100%)`
}

/**
 * Pull one representative colour out of a loaded image.
 *
 * Pixels are bucketed into a coarse RGB grid; the bucket with the best
 * vividness score wins and its average becomes the colour. Scoring prefers
 * saturated mid-tones — a pure average of a typical cover is mud, and the
 * brightest pixel is usually a white highlight.
 */
export function extractVibrantColor(image: HTMLImageElement): string | undefined {
  const canvas = document.createElement('canvas')
  const size = 32
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  try {
    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)

    const buckets = new Map<number, { r: number; g: number; b: number; score: number; n: number }>()
    let average: { r: number; g: number; b: number; n: number } | undefined
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      average = average
        ? { r: average.r + r, g: average.g + g, b: average.b + b, n: average.n + 1 }
        : { r, g, b, n: 1 }
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510
      const score = chroma * (1 - Math.abs(lightness - 0.55) * 1.4)
      if (score <= 0) continue
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, score: 0, n: 0 }
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.score += score
      bucket.n += 1
      buckets.set(key, bucket)
    }

    let best: { r: number; g: number; b: number; score: number; n: number } | undefined
    for (const bucket of buckets.values()) {
      if (!best || bucket.score > best.score) best = bucket
    }
    const chosen = best ?? (average && average.n > 0 ? { ...average, score: 0 } : undefined)
    if (!chosen || chosen.n === 0) return undefined
    const channel = (v: number) => Math.round(v / chosen.n).toString(16).padStart(2, '0')
    return `#${channel(chosen.r)}${channel(chosen.g)}${channel(chosen.b)}`
  } catch {
    // A tainted canvas (cross-origin cover without CORS) reads as an
    // exception — the neutral gradient is the answer, not an error.
    return undefined
  }
}
