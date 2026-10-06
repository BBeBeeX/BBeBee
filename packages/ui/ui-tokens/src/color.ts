/**
 * Colour maths for the token set.
 *
 * Contrast is checked here rather than by eye, because "looks fine on my
 * monitor" is how a palette ends up unreadable in sunlight or to a
 * significant fraction of users. docs/08 §8 makes WCAG AA a CI gate, and a
 * gate needs a function.
 *
 * Plain data in, plain numbers out: no framework, no platform.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa`. Alpha is parsed and ignored for contrast. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '')
  const expand = value.length === 3 || value.length === 4
  const pairs = expand
    ? [...value.slice(0, 3)].map((c) => c + c)
    : [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)]

  if (pairs.some((p) => !/^[0-9a-f]{2}$/i.test(p))) {
    throw new Error(`not a hex colour: ${JSON.stringify(hex)}`)
  }
  const [r, g, b] = pairs.map((p) => Number.parseInt(p, 16)) as [number, number, number]
  return { r, g, b }
}

/** Parses #hex or rgb/rgba string into Rgb. */
export function parseColor(color: string): Rgb {
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) return parseHex(trimmed)
  const match = trimmed.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (match) {
    return {
      r: Number.parseInt(match[1]!, 10),
      g: Number.parseInt(match[2]!, 10),
      b: Number.parseInt(match[3]!, 10),
    }
  }
  return parseHex(trimmed)
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * The sRGB→linear step is the part that is easy to skip and wrong to skip: a
 * naive average of the channels reports grey text on white as passing.
 */
export function luminance(color: Rgb | string): number {
  const { r, g, b } = typeof color === 'string' ? parseColor(color) : color
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [light, dark] = la > lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/** WCAG AA: 4.5 for body text, 3 for large text and UI boundaries. */
export const AA_TEXT = 4.5
export const AA_LARGE = 3

export function meetsAA(a: Rgb | string, b: Rgb | string, large = false): boolean {
  // Rounded to two places first: a ratio of 4.4996 displays as 4.5 in every
  // tool a designer uses, and failing it produces an argument rather than a fix.
  return Math.round(contrastRatio(a, b) * 100) / 100 >= (large ? AA_LARGE : AA_TEXT)
}
