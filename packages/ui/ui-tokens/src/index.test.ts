/**
 * The tokens, and the contrast gate.
 *
 * docs/08 §8 makes WCAG AA a CI check rather than a design review note. This
 * is that check — and the colour maths under it, because a wrong luminance
 * formula produces a gate that passes everything.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  contrastRatio,
  cssVariables,
  luminance,
  meetsAA,
  paletteContrastIssues,
  palettes,
  parseHex,
  tokens,
  builtInThemes,
  defaultTheme,
  midnightPurpleTheme,
  themeToCssVariables,
  themeContrastIssues,
  applyThemeToDom,
} from './index.js'

describe('parseHex', () => {
  it('reads the long and short forms', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseHex('FF8000')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('ignores an alpha channel rather than misreading it', () => {
    expect(parseHex('#ff8000cc')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('refuses something that is not a colour', () => {
    for (const bad of ['#gg0000', 'rebeccapurple', '#12345', '']) {
      expect(() => parseHex(bad), bad).toThrow(/not a hex colour/)
    }
  })
})

describe('luminance and contrast', () => {
  it('matches the WCAG reference points', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      10,
    )
  })

  it('applies the sRGB→linear step', () => {
    // Mid grey is *not* half the luminance of white. A naive channel average
    // would report 0.5 here, and would wave through grey-on-white text.
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3)
  })

  it('knows the AA thresholds apart', () => {
    // #767676 on white is the canonical 4.54:1 — the colour that passes body
    // text by a hair, and the one a broken formula gets wrong.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
    expect(meetsAA('#767676', '#ffffff')).toBe(true)
    expect(meetsAA('#8a8a8a', '#ffffff')).toBe(false)
    expect(meetsAA('#8a8a8a', '#ffffff', true), 'passes as large text').toBe(true)
  })
})

describe('the shipped palettes', () => {
  it('meet WCAG AA in both schemes', () => {
    // The gate from docs/08 §8. If this fails, the failing pair and its actual
    // ratio are in the message — "contrast failed" sends someone hunting.
    const issues = paletteContrastIssues()
    expect(
      issues,
      issues.map((i) => `${i.scheme}: ${i.pair} is ${i.ratio}:1, needs ${i.required}:1`).join('\n'),
    ).toEqual([])
  })

  it('define the same keys in light and dark', () => {
    // A dark theme is not a light theme with the lightness flipped, but it is
    // the same *shape* — a key present in one and missing in the other is a
    // component that renders `undefined` on one scheme only.
    const keys = (p: object): string[] =>
      Object.entries(p)
        .flatMap(([group, values]) => Object.keys(values as object).map((k) => `${group}.${k}`))
        .sort()
    expect(keys(palettes.light)).toEqual(keys(palettes.dark))
  })

  it('uses valid hex throughout', () => {
    for (const [scheme, palette] of Object.entries(palettes)) {
      for (const [group, values] of Object.entries(palette)) {
        for (const [name, value] of Object.entries(values as Record<string, string>)) {
          expect(() => parseHex(value), `${scheme}.${group}.${name}`).not.toThrow()
        }
      }
    }
  })

  it('keeps light and dark genuinely different', () => {
    // A copy-paste that left one scheme identical to the other would pass
    // every other check here.
    expect(palettes.light.bg.base).not.toBe(palettes.dark.bg.base)
    expect(palettes.light.text.primary).not.toBe(palettes.dark.text.primary)
  })
})

describe('scales', () => {
  it('spaces ascend from zero', () => {
    expect(tokens.space[0]).toBe(0)
    const ascending = [...tokens.space].every((v, i, all) => i === 0 || v > all[i - 1]!)
    expect(ascending).toBe(true)
  })

  it('font sizes ascend', () => {
    const sizes = Object.values(tokens.font.size)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
  })

  it('keeps a touch target both platforms consider reliable', () => {
    expect(tokens.size.touchTarget).toBeGreaterThanOrEqual(44)
  })
})

describe('cssVariables', () => {
  it('emits every palette entry as a custom property', () => {
    const vars = cssVariables('dark')
    expect(vars['--bb-bg-base']).toBe(palettes.dark.bg.base)
    expect(vars['--bb-text-primary']).toBe(palettes.dark.text.primary)
    expect(vars['--bb-accent-on']).toBe(palettes.dark.accent.on)
  })

  it('emits scales with their units, so a stylesheet can use them directly', () => {
    const vars = cssVariables('light')
    expect(vars['--bb-radius-md']).toBe('8px')
    expect(vars['--bb-duration-fast']).toBe('120ms')
    expect(vars['--bb-space-4']).toBe('16px')
  })

  it('differs between schemes', () => {
    expect(cssVariables('light')['--bb-bg-base']).not.toBe(cssVariables('dark')['--bb-bg-base'])
  })
})

describe('Color Token System & Theme Management', () => {
  it('provides built-in themes', () => {
    expect(builtInThemes['midnight-purple']).toBeDefined()
    expect(builtInThemes['spotify']).toBeDefined()
    expect(builtInThemes['crimson-night']).toBeDefined()
    expect(builtInThemes['ocean-abyss']).toBeDefined()
    expect(defaultTheme.id).toBe('midnight-purple')
  })

  it('midnight-purple matches Cyber Bee character visual color system', () => {
    const t = midnightPurpleTheme.tokens
    expect(t.bg.app).toBe('#05060A')
    expect(t.bg.primary).toBe('#080A10')
    expect(t.bg.secondary).toBe('#080D1A')
    expect(t.bg.tertiary).toBe('#0B1124')

    expect(t.surface.s1).toBe('#080D1A')
    expect(t.surface.s2).toBe('#0B1124')
    expect(t.surface.s3).toBe('#101831')
    expect(t.surface.hover).toBe('#101831')
    expect(t.surface.active).toBe('#162142')

    expect(t.brand.primary).toBe('#5F87FF')
    expect(t.brand.primaryActive).toBe('#7C86FF')
    expect(t.brand.primaryHover).toBe('#91B0FF')
    expect(t.brand.accent).toBe('#A99CFF')
    expect(t.brand.accentHover).toBe('#BEB4FF')

    expect(t.text.primary).toBe('#FFFFFF')

    expect(t.semantic.success).toBe('#22C55E')
    expect(t.semantic.warning).toBe('#F59E0B')
    expect(t.semantic.error).toBe('#EF4444')
    expect(t.semantic.info).toBe('#7598FF')

    expect(t.music.playing).toBe('#BEB4FF')
    expect(t.music.lyrics).toBe('#B7CCFF')
    expect(t.music.waveform).toBe('#6F9BFF')
  })

  it('emits unified CSS custom properties via themeToCssVariables', () => {
    const vars = themeToCssVariables(midnightPurpleTheme)
    expect(vars['--bg-app']).toBe('#05060A')
    expect(vars['--color-bg-app']).toBe('var(--black-950)')
    expect(vars['--color-primary']).toBe('var(--electric-blue-500)')
    expect(vars['--color-accent']).toBe('var(--lavender-500)')
    expect(vars['--color-text-primary']).toBe('var(--white-100)')
    expect(vars['--button-primary-bg']).toBe('var(--gradient-brand)')
    expect(vars['--player-progress']).toBe('var(--gradient-progress)')
    expect(vars['--slider-active']).toBe('var(--gradient-progress)')
    expect(vars['--gradient-brand']).toContain('#5F87FF')
    expect(vars['--gradient-progress']).toContain('#4F73FF')

    // Also ensures backwards compatibility with legacy --bb-*
    expect(vars['--bb-bg-sunken']).toBe('#05060A')
    expect(vars['--bb-bg-base']).toBe('#080A10')
    expect(vars['--bb-accent-base']).toBe('#5F87FF')
  })

  it('all built-in themes define lightTokens and pass WCAG AA in both dark and light modes', () => {
    for (const [id, theme] of Object.entries(builtInThemes)) {
      expect(theme.lightTokens, `Theme ${id} must define lightTokens`).toBeDefined()
      const darkIssues = themeContrastIssues(theme, 'dark')
      expect(darkIssues, `Theme ${id} dark mode contrast issues: ${JSON.stringify(darkIssues)}`).toEqual([])
      const lightIssues = themeContrastIssues(theme, 'light')
      expect(lightIssues, `Theme ${id} light mode contrast issues: ${JSON.stringify(lightIssues)}`).toEqual([])
    }
  })

  it('themeToCssVariables resolves light tokens when scheme is light', () => {
    const darkVars = themeToCssVariables(midnightPurpleTheme, 'dark')
    const lightVars = themeToCssVariables(midnightPurpleTheme, 'light')

    expect(darkVars['--bg-app']).toBe('#05060A')
    expect(lightVars['--bg-app']).toBe('#F0F4FC')
    expect(lightVars['--primary']).toBe('#3B66F5')
    expect(lightVars['--text-primary']).toBe('#080A10')

    // Dynamic card & preview tokens from theme
    expect(darkVars['--preview-card-bg']).toBe(midnightPurpleTheme.tokens.surface.s1)
    expect(lightVars['--preview-card-bg']).toBe(midnightPurpleTheme.lightTokens!.surface.s2)
    expect(darkVars['--lyrics-preview-bg']).toBe(darkVars['--preview-card-bg'])
    expect(lightVars['--lyrics-preview-bg']).toBe(lightVars['--preview-card-bg'])
    expect(lightVars['--input-bg']).toBe(midnightPurpleTheme.lightTokens!.bg.primary)
    const themeWithoutOverrides = { ...midnightPurpleTheme, cssVariables: undefined, lightCssVariables: undefined }
    const customLightVars = themeToCssVariables(themeWithoutOverrides, 'light')
    expect(customLightVars['--switch-off-bg']).toBe(midnightPurpleTheme.lightTokens!.border.default)
    expect(lightVars['--switch-off-bg']).toBe('#D1D5DB')
  })

  it('applyThemeToDom applies variables and data attributes to target element', () => {
    const el = {
      style: {
        colorScheme: '',
        setProperty: vi.fn(),
      },
      setAttribute: vi.fn(),
    } as unknown as HTMLElement

    applyThemeToDom(midnightPurpleTheme, 'light', el)

    expect(el.setAttribute).toHaveBeenCalledWith('data-theme', 'midnight-purple')
    expect(el.setAttribute).toHaveBeenCalledWith('data-color-scheme', 'light')
    expect(el.style.colorScheme).toBe('light')
    expect(el.style.setProperty).toHaveBeenCalledWith('--bg-app', '#F0F4FC')
  })
})
