// @vitest-environment jsdom
/**
 * The theme-aware palette layer, off device.
 *
 * Three behaviours live here: the ThemeDefinition→Palette mapping (the mobile
 * twin of the desktop `--bb-*` mapping), the override/subscription semantics
 * of the resolver in `primitives.ts`, and the `usePalette` re-render binding.
 * The resolver state is module-global, so every test puts it back the way it
 * found it — the fallback must be exactly what shipped before this module
 * existed.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { createElement as h } from 'react'
import { midnightPurpleTheme, oceanAbyssTheme, palettes } from '@BBeBee/ui-tokens'
import type { ThemeDefinition } from '@BBeBee/protocol'
import {
  activePalette,
  getScheme,
  onPaletteChange,
  setPalette,
  setScheme,
  themeToPalette,
  usePalette,
} from './index.js'
import { c } from './primitives.js'

afterEach(() => {
  cleanup()
  // Reset the module-global resolver: no override, dark fallback.
  setPalette(null)
  setScheme('dark')
})

/** A theme with dedicated light tokens, to exercise the scheme swap. */
const DUAL_SCHEME: ThemeDefinition = {
  ...midnightPurpleTheme,
  id: 'dual-scheme',
  lightTokens: {
    ...midnightPurpleTheme.tokens,
    bg: { ...midnightPurpleTheme.tokens.bg, app: '#F4F4F6' },
    text: { ...midnightPurpleTheme.tokens.text, primary: '#101014' },
  },
}

describe('themeToPalette', () => {
  it('maps the theme tokens onto the mobile palette groups', () => {
    const p = themeToPalette(midnightPurpleTheme, 'dark')
    const t = midnightPurpleTheme.tokens
    expect(p.bg.sunken).toBe(t.bg.app)
    expect(p.bg.base).toBe(t.bg.primary)
    expect(p.bg.raised).toBe(t.surface.s1)
    expect(p.bg.overlay).toBe(t.surface.s2)
    expect(p.text.primary).toBe(t.text.primary)
    expect(p.text.secondary).toBe(t.text.secondary)
    expect(p.text.disabled).toBe(t.text.disabled)
    expect(p.accent.base).toBe(t.brand.primary)
    expect(p.accent.hover).toBe(t.brand.primaryHover)
    expect(p.accent.muted).toBe(t.surface.selected)
    expect(p.accent.on).toBe(t.text.primary)
    expect(p.state.error).toBe(t.semantic.error)
    expect(p.state.warn).toBe(t.semantic.warning)
    expect(p.state.ok).toBe(t.semantic.success)
    expect(p.border.subtle).toBe(t.border.subtle)
    expect(p.border.strong).toBe(t.border.default)
  })

  it('maps a different theme to its own colours, not the first theme', () => {
    const p = themeToPalette(oceanAbyssTheme, 'dark')
    expect(p.accent.base).toBe(oceanAbyssTheme.tokens.brand.primary)
    expect(p.bg.base).toBe(oceanAbyssTheme.tokens.bg.primary)
  })

  it('swaps to lightTokens under the light scheme and falls back without them', () => {
    const dual = themeToPalette(DUAL_SCHEME, 'light')
    expect(dual.bg.sunken).toBe('#F4F4F6')
    expect(dual.text.primary).toBe('#101014')

    // The built-in midnight theme ships lightTokens of its own, so the
    // fallback is exercised with a synthetic dark-only variant.
    const darkOnly = themeToPalette({ ...midnightPurpleTheme, lightTokens: undefined }, 'light')
    expect(darkOnly.bg.base).toBe(midnightPurpleTheme.tokens.bg.primary)

    // The built-in's own light tokens, when it has them, are what light uses.
    if (midnightPurpleTheme.lightTokens) {
      expect(themeToPalette(midnightPurpleTheme, 'light').bg.base).toBe(
        midnightPurpleTheme.lightTokens.bg.primary,
      )
    }

    const dark = themeToPalette(DUAL_SCHEME, 'dark')
    expect(dark.bg.sunken).toBe(midnightPurpleTheme.tokens.bg.app)
  })
})

describe('the palette resolver', () => {
  it('falls back to the static scheme palette before any theme runs', () => {
    expect(c()).toBe(palettes.dark)
    expect(activePalette()).toBe(palettes.dark)
    setScheme('light')
    expect(c()).toBe(palettes.light)
  })

  it('serves the override once a theme installs one, and the fallback again after clearing', () => {
    const themed = themeToPalette(midnightPurpleTheme, 'dark')
    setPalette(themed)
    expect(c()).toBe(themed)
    // Scheme switching no longer moves `c()` while a theme is installed —
    // the theme owns the colours.
    setScheme('light')
    expect(c()).toBe(themed)
    setPalette(null)
    expect(c()).toBe(palettes.light)
  })

  it('notifies subscribers only on real changes, and unsubscribes cleanly', () => {
    const seen: string[] = []
    const off = onPaletteChange((palette) => void seen.push(palette.bg.base))

    setScheme('light') // dark → light: notify
    setScheme('light') // same value: silent
    const themed = themeToPalette(midnightPurpleTheme, 'dark')
    setPalette(themed) // null → themed: notify
    setPalette(themed) // same object: silent
    setPalette(null) // themed → null: notify
    off()
    setScheme('dark') // unsubscribed: silent

    expect(seen).toEqual([palettes.light.bg.base, themed.bg.base, palettes.light.bg.base])
  })
})

describe('usePalette', () => {
  it('re-renders the component on palette and scheme changes', () => {
    const rendered: string[] = []
    function Probe(): null {
      const palette = usePalette()
      rendered.push(palette.bg.base)
      return null
    }

    render(h(Probe))
    expect(rendered).toEqual([palettes.dark.bg.base])

    act(() => {
      setPalette(themeToPalette(midnightPurpleTheme, 'dark'))
    })
    expect(rendered.length).toBe(2)
    expect(rendered[1]).toBe(midnightPurpleTheme.tokens.bg.primary)

    act(() => {
      setPalette(null)
      setScheme('light')
    })
    expect(rendered[rendered.length - 1]).toBe(palettes.light.bg.base)
  })

  it('reports the fallback scheme through getScheme', () => {
    expect(getScheme()).toBe('dark')
    setScheme('light')
    expect(getScheme()).toBe('light')
  })
})
