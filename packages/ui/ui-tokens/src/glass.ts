/**
 * Glassmorphism resolution — component layer "A" of the glass plan.
 *
 * Turns (active theme, user glass settings) into the `--glass-*` CSS
 * variables the shell surfaces read. The resolution is pure and total:
 * the same inputs always produce the same variable set, and the caller
 * diffs it onto `:root` (plugin-theme owns that side effect).
 *
 * Precedence, highest first:
 *   per-surface user override → global user values → theme preset
 *   (`theme.effects.glass`) → built-in defaults.
 * A theme preset also *enables* the layer when present: a pack only
 * attaches a preset when its own glass toggle is on, so presence is the
 * signal. The user's global toggle remains the master switch for the
 * numbers, and disabling the layer in settings (with no preset-bearing
 * theme active) yields an empty variable set — surfaces fall back to
 * their solid colours.
 *
 * The window layer "B" is resolved here only to the extent the renderer
 * owns: when window glass is on, `--glass-window-bg: transparent` is
 * emitted so the shell root lets the OS effect (applied natively via
 * Tauri `set_effects`) show through.
 */

import type { GlassSettings, GlassSurfaceId, ThemeDefinition } from '@BBeBee/protocol'
import { DEFAULT_GLASS_SETTINGS } from '@BBeBee/protocol'

export interface ResolvedGlassComponent {
  blurPx: number
  saturate: number
  opacity: number
  borderOpacity: number
}

const SURFACE_BASE: Record<GlassSurfaceId | 'main', string> = {
  sidebar: 'var(--bg-primary)',
  topbar: 'var(--bg-primary)',
  player: 'var(--player-bg, var(--bg-primary))',
  cards: 'var(--card-bg, var(--bg-primary))',
  popovers: 'var(--bg-primary)',
  main: 'var(--bg-primary)',
}

const SURFACE_KEYS: readonly (GlassSurfaceId | 'main')[] = [
  'sidebar',
  'topbar',
  'player',
  'cards',
  'popovers',
  'main',
]

function resolveComponent(
  theme: ThemeDefinition,
  glass: GlassSettings | undefined,
  surface?: GlassSurfaceId,
): ResolvedGlassComponent {
  const preset = theme.effects?.glass
  const user = glass?.components
  const base: ResolvedGlassComponent = {
    blurPx: preset?.blurPx ?? DEFAULT_GLASS_SETTINGS.components.blurPx,
    saturate: preset?.saturate ?? DEFAULT_GLASS_SETTINGS.components.saturate,
    opacity: preset?.opacity ?? DEFAULT_GLASS_SETTINGS.components.opacity,
    borderOpacity: preset?.borderOpacity ?? DEFAULT_GLASS_SETTINGS.components.borderOpacity,
  }
  if (user) {
    base.blurPx = user.blurPx
    base.saturate = user.saturate
    base.opacity = user.opacity
    base.borderOpacity = user.borderOpacity
  }
  const override = surface ? glass?.surfaces?.[surface] : undefined
  if (override) {
    if (override.blurPx !== undefined) base.blurPx = override.blurPx
    if (override.saturate !== undefined) base.saturate = override.saturate
    if (override.opacity !== undefined) base.opacity = override.opacity
    if (override.borderOpacity !== undefined) base.borderOpacity = override.borderOpacity
  }
  return base
}

/** Whether the component glass layer is in effect for this theme/settings pair. */
export function isComponentGlassEnabled(theme: ThemeDefinition, glass: GlassSettings | undefined): boolean {
  return Boolean(glass?.components?.enabled) || theme.effects?.glass !== undefined
}

/**
 * Computes the `--glass-*` variables for the active theme + settings.
 * Returns an empty record when nothing glassy is on.
 */
export function resolveGlassVariables(
  theme: ThemeDefinition,
  glass: GlassSettings | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {}

  if (glass?.window?.enabled) {
    vars['--glass-window-bg'] = 'transparent'
    vars['--glass-window-tint'] = glass.window.tintFollowTheme
      ? `color-mix(in srgb, var(--brand-primary) ${glass.window.tintOpacity}%, transparent)`
      : `color-mix(in srgb, ${glass.window.tintColor ?? '#000000'} ${glass.window.tintOpacity}%, transparent)`
  }

  if (!isComponentGlassEnabled(theme, glass)) return vars

  const components = glass?.components ?? DEFAULT_GLASS_SETTINGS.components
  const global = resolveComponent(theme, glass)
  vars['--glass-blur'] = `${global.blurPx}px`
  vars['--glass-saturate'] = `${global.saturate}%`
  vars['--glass-opacity'] = `${global.opacity}`

  for (const surface of SURFACE_KEYS) {
    const resolved = surface === 'main' ? global : resolveComponent(theme, glass, surface)
    vars[`--glass-${surface}-bg`] =
      `color-mix(in srgb, ${SURFACE_BASE[surface]} ${resolved.opacity}%, transparent)`
    vars[`--glass-${surface}-filter`] = `blur(${resolved.blurPx}px) saturate(${resolved.saturate}%)`
    vars[`--glass-${surface}-border-color`] =
      `color-mix(in srgb, var(--text-primary) ${resolved.borderOpacity}%, transparent)`
  }

  // Ambient backdrop: the layer the glass surfaces blur. 'desktop' means
  // the OS window effect is the backdrop (no in-app layer), 'none' and a
  // disabled layer emit nothing.
  if (components.ambientSource === 'cover' || components.ambientSource === 'theme') {
    vars['--glass-ambient-bg'] =
      'radial-gradient(120% 120% at 15% 0%, var(--glass-ambient-color, var(--brand-primary)) 0%, transparent 55%), ' +
      'radial-gradient(100% 100% at 85% 100%, var(--brand-accent, var(--brand-primary)) 0%, transparent 50%)'
    vars['--glass-ambient-blur'] = `${components.ambientBlurPx}px`
    vars['--glass-ambient-opacity'] = `${components.ambientOpacity / 100}`
  }

  return vars
}
