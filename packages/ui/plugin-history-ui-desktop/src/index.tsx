/**
 * React DOM views for `@bbebee/plugin-history`.
 *
 * One screen: playback history and activity statistics.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { HISTORY_VIEWS } from '@bbebee/plugin-history/views'
import { HistoryScreen } from './HistoryScreen.js'

export const name = 'plugin-history-ui-desktop'

/**
 * `sources` is what row hydration goes through; `player` is the playback history
 * and transport model itself.
 */
export const inject = ['ui', 'player', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
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
  ctx.logger.info('plugin-history-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(HISTORY_VIEWS.history, bound(ctx, HistoryScreen))
  }, 'history-ui-desktop')
}

export default { name, inject, apply }
