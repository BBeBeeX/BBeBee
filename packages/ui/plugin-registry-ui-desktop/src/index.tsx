/**
 * Desktop UI views for `@BBeBee/plugin-registry`.
 *
 * The headless `plugin-registry` package contributes the descriptors (the
 * `registry.screen` route and the `registry.settings-card`); this package
 * only fills them on the desktop shell (docs/08 §3).
 */

import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { REGISTRY_VIEWS } from '@BBeBee/plugin-registry/views'
import { RegistryScreen } from './screens/RegistryScreen.js'
import { RegistrySettingsCard } from './components/RegistrySettingsCard.js'

export { RegistryScreen }
export { RegistrySettingsCard }
export {
  deriveRegistryActionState,
  deriveRegistryActionStates,
  minAppVersionBlock,
  isBuiltinEntry,
  type InstalledContentSnapshot,
  type RegistryActionState,
} from './hooks/install-state.js'

export const name = 'plugin-registry-ui-desktop'
export const inject = ['ui', 'contentRegistry', 'settings']

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
  ctx.logger.info('plugin-registry-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(REGISTRY_VIEWS.screen, bound(ctx, RegistryScreen))
    yield ctx.ui.registerView(REGISTRY_VIEWS.settingsCard, bound(ctx, RegistrySettingsCard))
  }, 'registry-ui-desktop')
}

export default { name, inject, apply }
