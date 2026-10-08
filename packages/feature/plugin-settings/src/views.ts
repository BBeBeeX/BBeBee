/**
 * The view ids `plugin-settings` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const SETTINGS_VIEWS = {
  /** The main settings dashboard. */
  main: 'settings.view',
  /** The global shortcuts card (owner: plugin-settings itself). */
  shortcutsCard: 'settings.shortcuts',
  /** Debug info dashboard. */
  debug: 'debug.view',
  /** System logs viewer. */
  logs: 'debug.logs',
  /** Source HTTP requests logs viewer. */
  httpLogs: 'debug.http-logs',
  /** Theme CSS variables palette viewer. */
  themePalette: 'debug.theme-palette',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const SETTINGS_ROUTES = SETTINGS_VIEWS
