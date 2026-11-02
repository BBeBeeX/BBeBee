/**
 * The bridge from a `ThemeDefinition` to the mobile `Palette`.
 *
 * Two colour languages exist in this repo: the rich per-theme `ColorTokens`
 * of `ctx.theme` (bg.app, surface.s1, brand.primary, …) and the six-group
 * semantic `Palette` the mobile kit paints with (`bg.sunken`, `accent.base`,
 * …). Desktop maps the first onto the second through the legacy `--bb-*` CSS
 * variables (see `themeToCssVariables` in `ui-tokens`); this file is that
 * same mapping, expressed as data for React Native — one place, so the two
 * platforms cannot disagree about what a theme looks like.
 */

import type { ThemeDefinition } from '@BBeBee/protocol'
import type { Palette, Scheme } from '@BBeBee/ui-tokens'

/**
 * Resolves the palette for `theme` under `scheme`.
 *
 * The scheme swap follows `themeToCssVariables`: a light scheme prefers the
 * theme's dedicated `lightTokens` when it declares them, and falls back to the
 * dark-first tokens when it does not — a theme that only ships dark must not
 * be re-invented here.
 */
export function themeToPalette(theme: ThemeDefinition, scheme: Scheme): Palette {
  const t = scheme === 'light' && theme.lightTokens ? theme.lightTokens : theme.tokens
  return {
    bg: {
      // The page family (shell root, drawer, every page canvas) sits on the
      // theme's own app background — `bg.app`, in both schemes — so what the
      // user sees is the theme's colour, never a derived or hand-picked one.
      // The chrome (tab bar, rail) takes `bg.primary`, one step removed, to
      // stay distinguishable from the canvas it overlays.
      sunken: t.bg.primary,
      base: t.bg.app,
      raised: scheme === 'light' ? t.surface.s2 : t.surface.s1,
      overlay: t.surface.s2,
    },
    text: {
      primary: t.text.primary,
      secondary: t.text.secondary,
      disabled: t.text.disabled,
      tertiary: t.text.tertiary,
      muted: t.text.muted,
      placeholder: t.text.placeholder,
    },
    accent: {
      base: t.brand.primary,
      hover: t.brand.primaryHover,
      muted: t.surface.selected,
      on: t.text.primary,
    },
    state: {
      error: t.semantic.error,
      warn: t.semantic.warning,
      ok: t.semantic.success,
      info: t.semantic.info,
    },
    border: {
      subtle: t.border.subtle,
      strong: t.border.default,
      hover: t.border.hover,
      focus: t.border.focus,
    },
    surface: {
      s1: t.surface.s1,
      s2: t.surface.s2,
      s3: t.surface.s3,
      hover: t.surface.hover,
      active: t.surface.active,
      selected: t.surface.selected,
    },
    music: {
      playing: t.music.playing,
      lyrics: t.music.lyrics,
      lyricsActive: t.music.lyricsActive ?? t.music.playing,
      lyricsHighlight: t.music.lyricsHighlight ?? t.text.primary,
      waveform: t.music.waveform,
      waveformActive: t.music.waveformActive,
    },
    brand: {
      primary: t.brand.primary,
      primaryActive: t.brand.primaryActive,
      primaryHover: t.brand.primaryHover,
      accent: t.brand.accent,
      accentHover: t.brand.accentHover,
    },
  }
}
