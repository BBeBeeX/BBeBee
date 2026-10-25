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
      sunken: t.bg.app,
      base: t.bg.primary,
      raised: t.surface.s1,
      overlay: t.surface.s2,
    },
    text: {
      primary: t.text.primary,
      secondary: t.text.secondary,
      disabled: t.text.disabled,
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
    },
    border: {
      subtle: t.border.subtle,
      strong: t.border.default,
    },
  }
}
