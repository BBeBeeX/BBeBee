/**
 * Mobile UI views for `@bbebee/plugin-theme`.
 *
 * Two jobs, both mobile-only:
 *
 * 1. Fill the headless package's `theme.settings` descriptor with the
 *    React Native theme management card (the same contract
 *    `plugin-theme-ui-desktop` fills on the desktop shell — docs/08 §3).
 * 2. Drive the kit-wide palette from the theme service. The headless
 *    service paints a desktop by writing CSS variables into the DOM; under
 *    React Native this package is the application mechanism: it resolves
 *    the active `ThemeDefinition` under the effective scheme (the injected
 *    `Appearance` primitive answers `system` mode, which the service
 *    cannot see here) and installs it through `ui-kit-mobile`'s
 *    `setPalette`. Screens re-render through `usePalette`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { THEME_VIEWS } from '@bbebee/plugin-theme/views'
import { ThemeManagementCard } from './components/ThemeManagementCard.js'
import { wirePaletteDrive } from './palette-drive.js'

export { ThemeManagementCard }
export { wirePaletteDrive, resolveEffectiveScheme, resolveDefinition } from './palette-drive.js'
export { parseThemeDocument, ThemeImportError } from './import.js'
export { ImportSheet } from './components/ImportSheet.js'
export { Chip } from './components/Chip.js'

export const name = 'plugin-theme-ui-mobile'

/**
 * `ui` registers the card; `theme` is what the card switches and what the
 * palette drive reads; `settings` carries the appearance mode and the
 * theme/category mirror the card writes.
 */
export const inject = ['ui', 'theme', 'settings']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-theme-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(THEME_VIEWS.settingsCard, bound(ctx, ThemeManagementCard))
    const stopDrive = wirePaletteDrive(ctx)
    yield () => stopDrive()
  }, 'theme-ui-mobile')
}

export default { name, inject, apply }
