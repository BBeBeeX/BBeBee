import { useEffect, useState } from 'react'
import { extractVibrantColor, parseHex } from '@BBeBee/ui-tokens'
import { toBbebeeFileUri } from './Artwork.js'

/**
 * A detail page's background takes its colour from the cover, the way
 * modern streaming players do. A ref's `dominantColor` — computed once at cache time — is
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
