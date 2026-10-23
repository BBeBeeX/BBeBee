/**
 * Cover-colour extraction from a loaded image element.
 *
 * Moved here from ui-kit-desktop's coverTheme so the headless theme
 * service can seed its dynamic (cover-following) theme with the same
 * algorithm the detail pages use for their header tint: bucket pixels
 * by coarse RGB, score by chroma weighted toward mid lightness, and
 * return the winning bucket's average (or the overall average for a
 * monochrome cover). A tainted canvas reads as `undefined`, never an
 * error.
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
