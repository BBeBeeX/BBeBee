/**
 * Pure appearance-mode helpers for the shell's navigation drawer — no imports,
 * on purpose, for the same reason `layout.ts` has none: the root vitest config
 * collects shell test files anywhere under `apps/`, and anything that pulled
 * in `react-native` could never load under Node.
 *
 * The drawer's header row carries a button cycling the display mode among
 * dark / light / auto (docs/ui/architecture.md §7.4). `AppSettings.theme`
 * spells auto as `'system'` — the same value the palette drive reads.
 */

export type AppearanceMode = 'dark' | 'light' | 'system'

/** The next mode in the drawer button's fixed cycle: dark → light → auto → dark. */
export function nextAppearanceMode(mode: AppearanceMode): AppearanceMode {
  return mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark'
}

/** The i18n key naming the current mode — the button shows the mode it is in. */
export function appearanceModeLabelKey(mode: AppearanceMode): string {
  return mode === 'dark'
    ? 'theme:themeManagement.darkMode'
    : mode === 'light'
      ? 'theme:themeManagement.lightMode'
      : 'theme:themeManagement.followSystem'
}

/** Guards a raw `AppSettings.theme` read into an `AppearanceMode`. */
export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'dark' || value === 'light' || value === 'system'
}
