/**
 * React Native views for `@bbebee/plugin-registry` — the mobile half of the
 * Discover surface.
 *
 * The headless `plugin-registry` package contributes the descriptors (the
 * `registry.screen` route and the `registry.settings-card`); this package
 * only fills them on the mobile shell (docs/08 §3), plus one mobile-only
 * entrance for the screen (see `apply`).
 */

import type { ReactElement } from 'react'
import { createElement as h } from 'react'
import type { Context } from 'cordis'
import { REGISTRY_VIEWS } from '@bbebee/plugin-registry/views'
import { RegistryScreen } from './screens/RegistryScreen.js'
import { RegistrySettingsCard } from './screens/RegistrySettingsCard.js'

export { RegistryScreen }
export { RegistrySettingsCard }
export { RegistryEntryCard } from './components/RegistryEntryCard.js'
export { InstallConfirmSheet } from './components/InstallConfirmSheet.js'
export { RegistryTaskSheet } from './components/RegistryTaskSheet.js'
export { useRegistryTasks } from './hooks/use-registry-tasks.js'
export { useRepoMetadata, entryStatsKey } from './hooks/use-repo-metadata.js'
export { usePluginLatestVersions } from './hooks/use-plugin-latest.js'
export {
  deriveRegistryActionState,
  deriveRegistryActionStates,
  minAppVersionBlock,
  isBuiltinEntry,
  isCustomizableSourceUrl,
  findInstalledMusicSource,
  INSTALLED_CONTENT_EVENTS,
  type InstalledContentSnapshot,
  type RegistryActionState,
} from './hooks/install-state.js'
export { useRegistryActionStates } from './hooks/use-action-states.js'
export { isOfficialEntry, parseRepoOwner, repoKey, type RepoRef } from './utils/repo.js'
export { formatDateTime, formatDateMs, formatShortDate, formatCompactCount } from './utils/format.js'
export {
  DEFAULT_SORT_DIR,
  type RegistrySortDir,
  type RegistrySortKey,
} from './screens/RegistryScreen.js'

export const name = 'plugin-registry-ui-mobile'

/**
 * `contentRegistry` is the screen's whole subject and `settings` the settings
 * card's writer; both are guaranteed by the headless plugins this package
 * depends on. Everything else (sources, lyricSources, theme, plugin-manager,
 * registryMetadata) is read structurally through `serviceOf` and degrades
 * quietly when absent, so the screen renders with whatever the shell has.
 */
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
  ctx.logger.info('plugin-registry-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(REGISTRY_VIEWS.screen, bound(ctx, RegistryScreen))
    yield ctx.ui.registerView(REGISTRY_VIEWS.settingsCard, bound(ctx, RegistrySettingsCard))
    /*
     * The Discover screen's mobile entrance. The shell's tab bar is a fixed
     * four — a deliberate product decision — and the headless plugin's route
     * carries `placement: ['tray']`, which is desktop-only, so the page would
     * otherwise ship unreachable on a phone. A settings link row is the answer
     * the settings screen already knows how to draw: a contribution with no
     * `action` renders as a row whose button hands the id to `ui.navigate`,
     * pushing the `registry.screen` route onto the stack, so Back returns to
     * Settings exactly as from any detail page. Contributed here, not in the
     * headless plugin, because the desktop keeps its own entrances — this row
     * exists only where the tray entry does not. The same pattern
     * `plugin-history-ui-mobile` established.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: REGISTRY_VIEWS.screen,
      section: 'sources',
      title: 'registry:route.discover',
      description: 'registry:registry.browseSubtitle',
      order: 16,
    })
  }, 'registry-ui-mobile')
}

export default { name, inject, apply }
