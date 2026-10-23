/**
 * Cover-derived dynamic themes — a hand-written Matugen-style generator.
 *
 * Takes one seed colour (the playing track's cover dominant colour) and
 * expands it into a full {@link ColorTokens} set, the way Material You's
 * Matugen expands a wallpaper seed: the seed hue drives a family of tonal
 * palettes (primary / secondary / tertiary / neutral / neutral-variant),
 * and each scheme picks different chroma and hue-shift rules from them.
 *
 * No new dependency and no HCT: the tonal palettes are built in HSL, which
 * is close enough for a music player's ambient theming, and the AA gate is
 * not left to the maths — every foreground the design checks is run through
 * {@link contrastRatio} and adjusted in lightness until it clears WCAG AA
 * (4.5:1 text, 3:1 for the brand boundary) against the surfaces it sits
 * on. A generated theme therefore passes `themeContrastIssues` by
 * construction, for any seed, including pure greys and yellows.
 */

import type { ColorTokens, DynamicThemeScheme, ThemeDefinition } from '@BBeBee/protocol'
import { contrastRatio, parseHex } from './color.js'

export type { DynamicThemeScheme }

export interface DynamicThemeOptions {
  /** Matugen-style scheme algorithm. Default 'tonal-spot'. */
  scheme?: DynamicThemeScheme
  /** Contrast adjustment, -100 (least) to 100 (most), 0 = standard. */
  contrast?: number
  /** Variant id for the generated theme. Default 'dynamic-cover'. */
  id?: string
  /** Display name for the generated theme. Default 'Dynamic (Cover)'. */
  name?: string
}

interface Hsl {
  h: number
  s: number
  l: number
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s: s * 100, l: l * 100 }
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.min(100, Math.max(0, s)) / 100
  const lig = Math.min(100, Math.max(0, l)) / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lig - c / 2
  let rgb: [number, number, number]
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

interface SchemeRules {
  /** Chroma (HSL saturation) of the primary palette. */
  primarySat: number
  /** Hue shift from the seed for the tertiary palette. */
  tertiaryShift: number
  /** Chroma of the neutral palettes (backgrounds and surfaces). */
  neutralSat: number
}

function schemeRules(scheme: DynamicThemeScheme, seedSat: number): SchemeRules {
  switch (scheme) {
    case 'vibrant':
      return { primarySat: clamp(seedSat * 1.25, 55, 100), tertiaryShift: 60, neutralSat: clamp(seedSat * 0.28, 6, 24) }
    case 'expressive':
      return { primarySat: clamp(seedSat, 45, 90), tertiaryShift: 90, neutralSat: clamp(seedSat * 0.2, 5, 18) }
    case 'content':
      return { primarySat: clamp(seedSat, 5, 100), tertiaryShift: 30, neutralSat: clamp(seedSat * 0.22, 4, 20) }
    case 'neutral':
      return { primarySat: clamp(seedSat * 0.45, 10, 35), tertiaryShift: 45, neutralSat: clamp(seedSat * 0.1, 2, 8) }
    case 'tonal-spot':
    default:
      return { primarySat: clamp(seedSat, 40, 80), tertiaryShift: 60, neutralSat: clamp(seedSat * 0.18, 4, 16) }
  }
}

/**
 * Adjusts a colour's lightness in `step` increments until it clears
 * `required` contrast against `bg`, or the lightness range runs out.
 * Direction is the sign of `step`.
 */
function fitContrast(hex: string, bg: string, required: number, step: number): string {
  let hsl = rgbToHsl(...(Object.values(parseHex(hex)) as [number, number, number]))
  let current = hex
  for (let i = 0; i < 40 && Math.round(contrastRatio(current, bg) * 100) / 100 < required; i++) {
    const nextL = clamp(hsl.l + step, 4, 97)
    if (nextL === hsl.l) break
    hsl = { ...hsl, l: nextL }
    current = hslToHex(hsl)
  }
  return current
}

function buildTokens(seed: Hsl, rules: SchemeRules, contrast: number, mode: 'dark' | 'light'): ColorTokens {
  const H = seed.h
  const dark = mode === 'dark'
  // Contrast slider: ±100 maps to ±5 lightness points of extra separation
  // between text and background, applied in the direction that helps.
  const spread = (contrast / 100) * 5
  const tone = (sat: number, l: number, hueShift = 0): string => hslToHex({ h: H + hueShift, s: sat, l })

  const neutral = rules.neutralSat
  const neutralVariant = clamp(rules.neutralSat * 1.6, 6, 28)
  const primarySat = rules.primarySat
  const secondarySat = clamp(primarySat * 0.55, 12, 60)
  const tertiarySat = clamp(primarySat * 0.8, 20, 85)

  const bg = dark
    ? {
        app: tone(neutral, 6 - spread * 0.4),
        primary: tone(neutral, 10 - spread * 0.4),
        secondary: tone(neutral, 8 - spread * 0.4),
        tertiary: tone(neutralVariant, 15),
      }
    : {
        app: tone(neutral, 95 + spread * 0.4),
        primary: tone(neutral, 99),
        secondary: tone(neutral, 96 + spread * 0.2),
        tertiary: tone(neutralVariant, 91),
      }

  const surfaces = dark
    ? { s1: tone(neutralVariant, 13), s2: tone(neutralVariant, 18), s3: tone(neutralVariant, 24) }
    : { s1: tone(neutralVariant, 94), s2: tone(neutralVariant, 90), s3: tone(neutralVariant, 85) }

  // Brand and text are fitted against the surfaces they actually sit on —
  // this loop, not the tone choices above, is what guarantees the AA gate.
  const brandBase = tone(primarySat, dark ? 78 : 46)
  const brandPrimary = fitContrast(brandBase, bg.primary, 3.1, dark ? 3 : -3)
  const accentBase = tone(tertiarySat, dark ? 78 : 46, rules.tertiaryShift)
  const accent = fitContrast(accentBase, bg.primary, 3.1, dark ? 3 : -3)
  const brandHover = fitContrast(tone(primarySat, dark ? 84 : 40), bg.primary, 3.1, dark ? 3 : -3)
  const brandActive = fitContrast(tone(secondarySat, dark ? 70 : 52), bg.primary, 3.1, dark ? 3 : -3)

  const textPrimary = fitContrast(
    tone(clamp(neutral, 4, 20), dark ? 96 + spread * 0.3 : 10 - spread * 0.3),
    bg.primary,
    4.6,
    dark ? 2 : -2,
  )
  const textPrimaryOnS1 = fitContrast(textPrimary, surfaces.s1, 4.6, dark ? 2 : -2)
  const textSecondary = fitContrast(
    tone(clamp(neutral, 4, 20), dark ? 78 + spread * 0.3 : 34 - spread * 0.3),
    bg.primary,
    4.6,
    dark ? 2 : -2,
  )
  const textSecondaryOnS1 = fitContrast(textSecondary, surfaces.s1, 4.6, dark ? 2 : -2)
  const success = fitContrast(
    hslToHex({ h: 142, s: dark ? 55 : 75, l: dark ? 68 : 30 }),
    bg.primary,
    4.6,
    dark ? 3 : -3,
  )
  const error = fitContrast(
    hslToHex({ h: 4, s: dark ? 75 : 70, l: dark ? 72 : 42 }),
    bg.primary,
    4.6,
    dark ? 3 : -3,
  )
  const warning = fitContrast(
    hslToHex({ h: 38, s: 85, l: dark ? 66 : 33 }),
    bg.primary,
    3.1,
    dark ? 3 : -3,
  )
  const info = brandPrimary

  return {
    bg,
    surface: {
      s1: surfaces.s1,
      s2: surfaces.s2,
      s3: surfaces.s3,
      hover: surfaces.s2,
      active: surfaces.s3,
      selected: `${brandPrimary}28`,
    },
    brand: {
      primary: brandPrimary,
      primaryActive: brandActive,
      primaryHover: brandHover,
      accent,
      accentHover: fitContrast(tone(tertiarySat, dark ? 84 : 40, rules.tertiaryShift), bg.primary, 3.1, dark ? 3 : -3),
    },
    gradient: {
      brand: `linear-gradient(135deg, ${brandPrimary} 0%, ${accent} 100%)`,
      progress: `linear-gradient(90deg, ${brandPrimary} 0%, ${accent} 100%)`,
      blueViolet: `linear-gradient(135deg, ${brandPrimary} 0%, ${accent} 100%)`,
      ice: `linear-gradient(135deg, ${textPrimaryOnS1} 0%, ${accent} 100%)`,
      spectrum: `linear-gradient(90deg, ${error} 0%, ${warning} 25%, ${success} 50%, ${brandPrimary} 75%, ${accent} 100%)`,
    },
    text: {
      primary: textPrimaryOnS1,
      secondary: textSecondaryOnS1,
      tertiary: tone(clamp(neutral, 4, 20), dark ? 66 : 46),
      muted: tone(clamp(neutral, 4, 20), dark ? 54 : 58),
      disabled: dark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(0, 0, 0, 0.28)',
      placeholder: tone(clamp(neutral, 4, 20), dark ? 54 : 58),
    },
    border: {
      subtle: `${textPrimaryOnS1}18`,
      default: `${textPrimaryOnS1}2e`,
      hover: `${brandPrimary}66`,
      active: brandPrimary,
      focus: `${brandPrimary}88`,
    },
    semantic: { success, warning, error, info },
    music: {
      playing: success,
      lyrics: textSecondaryOnS1,
      lyricsActive: accent,
      lyricsHighlight: textPrimaryOnS1,
      waveform: `${textPrimaryOnS1}33`,
      waveformActive: accent,
    },
    glow: {
      xs: `0 0 6px ${brandPrimary}26`,
      sm: `0 0 12px ${brandPrimary}33`,
      md: `0 0 24px ${brandPrimary}40`,
      lg: `0 0 40px ${brandPrimary}4d`,
      blueXs: `0 0 6px ${brandPrimary}26`,
      blueSm: `0 0 12px ${brandPrimary}33`,
      blueMd: `0 0 24px ${brandPrimary}40`,
      purpleXs: `0 0 6px ${accent}26`,
      purpleSm: `0 0 12px ${accent}33`,
      purpleMd: `0 0 24px ${accent}40`,
      brandSm: `0 0 12px ${brandPrimary}33`,
      brandMd: `0 0 24px ${brandPrimary}40`,
    },
  }
}

/** Builds the token set for one mode from a seed colour. */
export function generateDynamicTokens(
  seedColor: string,
  options: DynamicThemeOptions & { mode?: 'dark' | 'light' } = {},
): ColorTokens {
  const { r, g, b } = parseHex(seedColor)
  const seed = rgbToHsl(r, g, b)
  const rules = schemeRules(options.scheme ?? 'tonal-spot', seed.s)
  const contrast = clamp(options.contrast ?? 0, -100, 100)
  return buildTokens(seed, rules, contrast, options.mode ?? 'dark')
}

/**
 * Generates a complete dynamic theme from a seed colour: dark tokens in
 * `tokens`, the light counterpart in `lightTokens`, following the built-in
 * themes' dual-scheme shape.
 */
export function generateThemeFromSeed(seedColor: string, options: DynamicThemeOptions = {}): ThemeDefinition {
  const tokens = generateDynamicTokens(seedColor, { ...options, mode: 'dark' })
  const lightTokens = generateDynamicTokens(seedColor, { ...options, mode: 'light' })
  return {
    id: options.id ?? 'dynamic-cover',
    name: options.name ?? 'Dynamic (Cover)',
    description: `Generated from the cover colour ${seedColor} with the ${options.scheme ?? 'tonal-spot'} scheme.`,
    isDark: true,
    tokens,
    lightTokens,
    packId: 'dynamic-cover',
    origin: 'dynamic',
  }
}
