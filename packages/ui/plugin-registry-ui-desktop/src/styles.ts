/**
 * Shared visual vocabulary for the registry UI package (the 发现 page family).
 *
 * Pure style constants and one-line factories — no React, no domain logic, so
 * every screen and drawer draws its pills, chips, banners and badges from the
 * same definitions instead of restating them. Spacing sticks to the design
 * system's 4/8/12/16/24 rhythm; every color is a theme CSS variable in the
 * package's `var(--token, #fallback)` form, with fallbacks matching the
 * values the rest of this package already uses.
 *
 * `BASELINE_CSS` is the one thing inline styles cannot express — the skeleton
 * shimmer keyframes and the shared hover/focus/active feedback rules. It is
 * injected once by each top-level screen (`RegistryScreen`,
 * `RegistryDiagnosticsScreen`) as a plain `<style>` element; class names are
 * prefixed `bbreg-` so they stay out of the rest of the app's way.
 */

/** The tone palette of the package: semantic color tokens + fallbacks. */
export const TONE = {
  primary: 'var(--color-primary, #5F87FF)',
  success: 'var(--color-success, #10B981)',
  warning: 'var(--color-warning, #F59E0B)',
  error: 'var(--color-error, #F43F5E)',
  /** Quiet metadata color — used for the neutral (等待确认 / 信息) states. */
  neutral: 'var(--text-secondary, #C5CAD8)',
} as const

/** The pill control base shared by tabs, toggles, header and drawer buttons. */
export const PILL_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 999,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  border: '1px solid transparent',
} as const

/** A tab/filter pill: active = selected surface + primary ring, idle = quiet. */
export function tabPill(active: boolean) {
  return {
    ...PILL_BASE,
    background: active
      ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
      : 'var(--surface-1, rgba(255, 255, 255, 0.04))',
    borderColor: active
      ? 'var(--color-primary, #5F87FF)'
      : 'var(--border-subtle, rgba(255, 255, 255, 0.08))',
    color: active ? 'var(--text-primary, #F5F7FF)' : 'var(--text-secondary, #C5CAD8)',
    fontWeight: active ? 600 : 400,
  } as const
}

/** The one chip: version, 内置, capabilities, kind labels, commit hashes. */
export const CHIP = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  color: 'var(--text-secondary, #C5CAD8)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  minWidth: 0,
} as const

/** A quieter chip variant for the lazily-fetched stats (stars, contributors). */
export const STAT_CHIP = {
  ...CHIP,
  background: 'transparent',
  color: 'var(--text-tertiary, #8B95B0)',
} as const

/** The quiet outlined action (卸载, 取消, 查看, 清空已完成). */
export const GHOST_BUTTON = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 12px',
  borderRadius: 999,
  fontSize: 12,
  cursor: 'pointer',
  background: 'transparent',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  color: 'var(--text-secondary, #C5CAD8)',
  transition: 'all 120ms ease',
} as const

/** A hairline banner (errors, warnings) — the package's one alert treatment. */
export function banner(color: string) {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${color}`,
    color,
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  } as const
}

export const ERROR_BANNER = banner(TONE.error)
export const WARNING_BANNER = banner(TONE.warning)

/**
 * A status chip: colored text over a translucent tint of the same tone, the
 * family the security-audit badge already uses. `color` is a CSS color string
 * (pass a `TONE` value), so the tint follows the theme.
 */
export function statusChip(color: string) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    color,
    background: `color-mix(in srgb, ${color} 13%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  } as const
}

/** The entry-card grid — the loading skeleton mirrors it exactly. */
export const CARD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
  alignItems: 'stretch',
} as const

/** The hairline divider between the kind tabs and the curated tabs. */
export const TAB_DIVIDER = {
  width: 1,
  height: 20,
  alignSelf: 'center',
  background: 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
  flexShrink: 0,
} as const

/**
 * Hover/focus/active feedback + the skeleton shimmer, expressed as real CSS
 * (inline styles cannot carry `:hover` or `@keyframes`). Injected once per
 * screen; everything is namespaced under `bbreg-`.
 */
export const BASELINE_CSS = `
@keyframes bbreg-shimmer {
  from { background-position: 180% 0; }
  to { background-position: -180% 0; }
}
.bbreg-skeleton {
  background: linear-gradient(90deg, var(--surface-1, rgba(255, 255, 255, 0.04)) 30%, var(--surface-3, rgba(255, 255, 255, 0.10)) 50%, var(--surface-1, rgba(255, 255, 255, 0.04)) 70%);
  background-size: 200% 100%;
  animation: bbreg-shimmer 1.5s ease-in-out infinite;
}
.bbreg-card {
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.bbreg-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-hover, rgba(255, 255, 255, 0.22));
  box-shadow: var(--glow-xs, 0 0 8px rgba(95, 135, 255, 0.14));
}
.bbreg-btn {
  transition: transform 120ms ease, filter 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}
.bbreg-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.bbreg-btn-primary:hover:not(:disabled) {
  transform: scale(1.04);
  filter: brightness(1.06);
}
.bbreg-btn-ghost:hover:not(:disabled) {
  border-color: var(--border-hover, rgba(255, 255, 255, 0.22));
  color: var(--text-primary, #F5F7FF);
}
.bbreg-favorite {
  transition: transform 120ms ease, color 120ms ease;
}
.bbreg-favorite:hover {
  transform: scale(1.18);
}
.bbreg-input:focus {
  border-color: var(--border-focus, var(--color-primary, #5F87FF));
  box-shadow: var(--glow-blue-xs, 0 0 0 2px rgba(95, 135, 255, 0.28));
}
.bbreg-select select {
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.bbreg-select:hover select {
  border-color: var(--border-hover, rgba(255, 255, 255, 0.22));
}
.bbreg-select:focus-within select {
  border-color: var(--border-focus, var(--color-primary, #5F87FF));
  box-shadow: var(--glow-blue-xs, 0 0 0 2px rgba(95, 135, 255, 0.28));
}
`
