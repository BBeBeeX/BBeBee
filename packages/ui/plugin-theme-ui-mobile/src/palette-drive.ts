/**
 * `wirePaletteDrive(ctx)` — the mobile theme application mechanism.
 *
 * The headless `plugin-theme` service paints the desktop by writing CSS
 * variables into the DOM (`applyThemeToDom`); under React Native there is no
 * DOM, so the palette has to be *resolved into the kit* instead. This module
 * is that resolver, and the mobile counterpart of the desktop shell's
 * `wireThemeSync`:
 *
 * 1. The active `ThemeDefinition` comes from `ctx.theme` (which persists the
 *    selection in the store and mirrors it into the settings document —
 *    persistence is reused, never duplicated here).
 * 2. The effective scheme is resolved natively: explicit modes pass straight
 *    through, and `system` asks the injected `Appearance` primitive. The
 *    service cannot do this step on mobile — its `system` branch reads
 *    `window.matchMedia`, which does not exist under RN and answers dark —
 *    so this drive owns scheme resolution and applies the `lightTokens`
 *    swap through `themeToPalette`.
 * 3. The resolved palette is installed kit-wide with `setPalette`, which
 *    notifies subscribers; every screen that calls `usePalette` (or whose
 *    ancestor does) re-renders with the new colours. `c()` reads the same
 *    override, so existing consumers pick it up on their next render.
 *
 * Everything registers through the fiber: the returned disposer removes every
 * listener, and the Appearance subscription dies with the plugin.
 */

import type { Context } from '@BBeBee/kernel'
import type { AppSettings, ThemeDefinition } from '@BBeBee/protocol'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import {
  nativePrimitives,
  setPalette,
  setScheme,
  themeToPalette,
  type AppearanceLike,
} from '@BBeBee/ui-kit-mobile'

/** The slice of `ctx.settings` the drive reads; optional so tests can omit it. */
type SettingsLike = { getSync?: () => AppSettings }

/** The slice of `ctx.theme` the drive reads. */
type ThemeLike = {
  getCurrentTheme?: () => ThemeDefinition
  getThemes?: () => readonly ThemeDefinition[]
}

export type AppearanceMode = 'dark' | 'light' | 'system'

/**
 * Resolves the effective scheme for an appearance mode.
 *
 * `system` needs the platform answer: the injected `Appearance` primitive
 * when the shell wired one, dark otherwise — the same degradation the
 * headless service's `matchMedia` guard has.
 */
export function resolveEffectiveScheme(
  mode: AppearanceMode,
  appearance: AppearanceLike | undefined,
): 'dark' | 'light' {
  if (mode === 'system') {
    const system = appearance?.getColorScheme?.()
    return system === 'light' ? 'light' : 'dark'
  }
  return mode
}

/**
 * The definition to paint with. The `theme/changed` payload is preferred
 * (it is the definition the service just applied); otherwise the current
 * theme is re-read, matching by id across the registry so the `lightTokens`
 * swap in {@link themeToPalette} sees the full definition.
 */
export function resolveDefinition(
  theme: ThemeLike | undefined,
  payload?: ThemeDefinition,
): ThemeDefinition {
  if (payload) return payload
  const current = theme?.getCurrentTheme?.()
  if (!current) return midnightPurpleTheme
  const id = current.id
  const found = theme?.getThemes?.().find((candidate) => candidate.id === id)
  return found ?? current
}

/**
 * Installs the drive on `ctx`. Returns the disposer removing every listener
 * and the Appearance subscription.
 */
export function wirePaletteDrive(ctx: Context): () => void {
  const disposers: Array<() => void> = []
  let stopped = false

  ctx.inject(['theme', 'settings'], (scoped) => {
    // The drive can be disposed before `inject` resolves (a plugin unloaded
    // mid-boot); the callback must not attach listeners into a dead fiber.
    if (stopped) return
    const theme = scoped.theme as unknown as ThemeLike | undefined
    const settings = scoped.settings as unknown as SettingsLike | undefined

    let mode: AppearanceMode = settings?.getSync?.()?.theme ?? 'dark'
    // The definition the service last announced. Kept so a scheme change
    // (settings or the OS) repaints the *same* theme — re-reading
    // `getCurrentTheme()` here would race the service's own scheme logic,
    // which on mobile cannot see the OS answer and may not have swapped
    // tokens the way this drive has.
    let lastPayload: ThemeDefinition | undefined

    const apply = (payload?: ThemeDefinition): void => {
      if (payload) lastPayload = payload
      const appearance = nativePrimitives().Appearance
      const scheme = resolveEffectiveScheme(mode, appearance)
      const definition = resolveDefinition(theme, payload ?? lastPayload)
      setPalette(themeToPalette(definition, scheme))
      // Keep the kit's fallback scheme in step for anything that reads it
      // while no override is installed.
      setScheme(scheme)
    }

    apply()

    disposers.push(ctx.on('theme/changed', (payload: ThemeDefinition) => apply(payload)))
    disposers.push(
      ctx.on('settings/changed', (s: AppSettings | undefined) => {
        if (s?.theme === 'dark' || s?.theme === 'light' || s?.theme === 'system') {
          mode = s.theme
        }
        apply()
      }),
    )

    // The service cannot observe the OS scheme on mobile (no matchMedia), so
    // this is the only `system`-mode change signal that exists here.
    const appearance = nativePrimitives().Appearance
    if (appearance?.addChangeListener) {
      const subscription = appearance.addChangeListener(() => {
        if (mode === 'system') apply()
      })
      disposers.push(() => subscription.remove())
    }
  })

  return () => {
    stopped = true
    for (const dispose of disposers) dispose()
    disposers.length = 0
  }
}
