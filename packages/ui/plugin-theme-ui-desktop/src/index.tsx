/**
 * Desktop UI views for @BBeBee/plugin-theme.
 *
 * Registers the `theme.settings` card view for the settings screen — the
 * descriptor is contributed by the headless `plugin-theme` package, this
 * package only fills it on the desktop shell (docs/08 §3).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { ThemeManagementCard } from './components/ThemeManagementCard.js'
import { THEME_VIEWS } from '@BBeBee/plugin-theme/views'

export { ThemeManagementCard }

export const name = 'plugin-theme-ui-desktop'
export const inject = ['ui', 'theme', 'settings']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-theme-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(THEME_VIEWS.settingsCard, bound(ctx, ThemeManagementCard))
  }, 'theme-ui-desktop')
}

export default { name, inject, apply }
