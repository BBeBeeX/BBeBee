/**
 * React Native views for `@bbebee/plugin-manager` — the mobile plugin
 * management screen: the list of known plugins with enable/disable toggles.
 *
 * Desktop manages plugins inside its settings screen's own `plugins`
 * section (`plugin-settings-ui-desktop`); mobile has no equivalent native
 * section, so this screen ships reachable through a settings link-row —
 * the same entrance `plugin-history-ui-mobile` and
 * `plugin-registry-ui-mobile` established. The row lives in section
 * `plugins`, the section id desktop's settings screen already reserves for
 * plugin management, so the mobile settings screen draws it as its own
 * "Plugins" group.
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
     * The screen's mobile entrance, mirroring where desktop puts plugin
     * management: a settings link-row in the `plugins` section. A
     * contribution with no `action` renders as a row whose button hands the
     * id to `ui.navigate`, pushing `plugin-manager.screen` onto the stack,
     * so Back returns to Settings exactly as from any detail page.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: MANAGER_VIEWS.screen,
      section: 'plugins',
      title: 'settings:settings.plugins',
      order: 20,
    })
  }, 'manager-ui-mobile')
}

export default { name, inject, apply }
