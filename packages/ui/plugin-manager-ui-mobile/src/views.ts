/**
 * The view ids `plugin-manager-ui-mobile` fills.
 *
 * Desktop keeps plugin management inside its settings screen's own
 * `plugins` section (`plugin-settings-ui-desktop`'s `PluginsSection`), so
 * there is no shared headless route descriptor to mirror — and the headless
 * `@bbebee/plugin-manager` package's `./views` subpath is currently a
 * dangling export. The id is therefore declared here, following the
 * `<namespace>.<name>` convention (`registry.screen`, `history.view`); the
 * settings link-row contribution in `./index.tsx` hands exactly this id to
 * `ui.navigate`, so Back returns to Settings as from any detail page.
 */
export const MANAGER_VIEWS = {
  /** The plugin management screen: list + enable/disable toggles. */
  screen: 'plugin-manager.screen',
} as const
