/**
 * React Native views for `@bbebee/plugin-manager` — the mobile plugin
 * management screen: the list of known plugins with enable/disable toggles.
 *
 * Desktop manages plugins inside its settings screen's own `plugins`
 * section (`plugin-settings-ui-desktop`); mobile has no equivalent native
 * section, so this screen ships reachable through the debug center's tool
 * cards — the aggregation point for the phone's developer surfaces.
 */

import type { ReactElement } from 'react'
import { createElement as h } from 'react'
import type { Context } from 'cordis'
import { PluginManagerScreen } from './screens/PluginManagerScreen.js'
import { MANAGER_VIEWS } from './views.js'

export { PluginManagerScreen } from './screens/PluginManagerScreen.js'
export { PluginRow, formatRuntimeState } from './components/PluginRow.js'
export { Switch } from './components/Switch.js'
export { MANAGER_VIEWS } from './views.js'
export {
  CHANGES_APPLY_AT_NEXT_LAUNCH_KEY,
  changesApplyAtNextLaunch,
  translateOrFallback,
} from './i18n.js'

export const name = 'plugin-manager-ui-mobile'

/**
 * `ui` registers the screen; `plugin-manager` is the screen's whole subject
 * (`list()` / `setEnabled`). Both are guaranteed by the composition root's
 * plugin set on mobile (`@bbebee/plugin-ui`, `@bbebee/plugin-manager`).
 */
export const inject = ['ui', 'plugin-manager']

/**
 * Bind a screen to *this* plugin's context, not the shell's — the shell
 * context only has `ctx.ui`, and reaching for anything else throws.
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
  ctx.logger.info('plugin-manager-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(MANAGER_VIEWS.screen, bound(ctx, PluginManagerScreen))
    /*
     * No settings-home row: plugin management used to enter through a
     * `plugins`-section link-row here, and now enters through the debug
     * center's tool cards (`plugin-settings-ui-mobile`'s DebugScreen), which
     * navigate to `plugin-manager.screen` directly. Back unwinds to the debug
     * center as from any detail page.
     */
  }, 'manager-ui-mobile')
}

export default { name, inject, apply }
