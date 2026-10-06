/**
 * React DOM views for `@BBeBee/plugin-settings`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'
import { SettingsScreen } from './SettingsScreen.js'
import { ShortcutsCard } from './components/ShortcutsCard.js'
import { DebugScreen } from './DebugScreen.js'
import { LogsScreen } from './LogsScreen.js'
import { HttpLogsScreen } from './HttpLogsScreen.js'

export { SettingsScreen } from './SettingsScreen.js'
export { ShortcutsCard } from './components/ShortcutsCard.js'
export { DebugScreen } from './DebugScreen.js'
export { LogsScreen } from './LogsScreen.js'
export { HttpLogsScreen } from './HttpLogsScreen.js'

export const name = 'plugin-settings-ui-desktop'
export const inject = ['ui', 'settings']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-settings-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SETTINGS_VIEWS.main, bound(ctx, SettingsScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.debug, bound(ctx, DebugScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.logs, bound(ctx, LogsScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.httpLogs, bound(ctx, HttpLogsScreen))
    yield ctx.ui.registerView(SETTINGS_VIEWS.shortcutsCard, bound(ctx, ShortcutsCard))
}, 'settings-ui-desktop')
}

export default { name, inject, apply }

