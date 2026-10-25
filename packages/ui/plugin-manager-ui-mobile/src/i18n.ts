/**
 * i18n for the manager screen.
 *
 * The catalogue JSON lives feature-owned in `packages/feature/plugin-i18n`;
 * view packages never write into it. Everything this screen renders uses
 * existing `settings:*` keys — the very keys the desktop plugin management
 * section already carries (`settings:settings.plugins`,
 * `settings:pluginDetails.*`, `settings:pluginTrafficLight.*`,
 * `settings:plugins.*`), so the two shells translate identically.
 *
 * One key has no catalogue entry yet — the mobile-only "changes apply at
 * next launch" hint (desktop has no such sentence because its toggles act
 * live). Until the feature package adds
 * `settings:pluginManager.changesApplyAtNextLaunch` (en + zh), `t()` answers
 * the key itself and the English fallback below is shown instead. When the
 * key lands, this helper's fallback becomes dead weight and can go.
 */

import type { I18nService } from '@BBeBee/protocol'

/** The catalogue key the feature package should add (en + zh). */
export const CHANGES_APPLY_AT_NEXT_LAUNCH_KEY = 'settings:pluginManager.changesApplyAtNextLaunch'

/** English stopgap for the missing catalogue key — see the header. */
const CHANGES_APPLY_AT_NEXT_LAUNCH_FALLBACK =
  'Enable/disable changes are saved and take effect the next time the app starts.'

/**
 * `t()` first, literal fallback when the key is not in any catalogue (the
 * i18n service's documented miss behavior is "falls back … → the key
 * itself"). The same move the desktop settings screen makes with its
 * `GroupSpec.fallbackTitle`.
 */
export function translateOrFallback(
  t: I18nService['t'],
  key: string,
  fallback: string,
): string {
  const translated = t(key)
  return translated === key ? fallback : translated
}

/** The next-launch hint, in whatever the catalogue currently provides. */
export function changesApplyAtNextLaunch(t: I18nService['t']): string {
  return translateOrFallback(t, CHANGES_APPLY_AT_NEXT_LAUNCH_KEY, CHANGES_APPLY_AT_NEXT_LAUNCH_FALLBACK)
}
