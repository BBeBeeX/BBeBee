/**
 * `plugin-history` — playback history and statistics.
 *
 * A **surface** plugin: it owns the history route and view id, and nothing else.
 * The history itself — recording play events, computing stats and the heatmap —
 * belongs to `ctx.player`, and the hooks that read it (`usePlayHistory`,
 * `usePlayHistoryStats`, `usePlayHistoryHeatmap`) live in `@BBeBee/toolkit/hooks`
 * beside the other shared bindings.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { HISTORY_ROUTES } from './views.js'

export const name = 'plugin-history'

/**
 * The route descriptor.
 *
 * `placement: ['tray', 'tab-bar']` places it in mobile navigation tab bar and desktop tray.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-history: loaded')

  const fiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      scoped.logger.debug(`history: contributing route ${HISTORY_ROUTES.history}`)
      yield scoped.ui.contribute({
        kind: 'route',
        id: HISTORY_ROUTES.history,
        path: '/history',
        title: '播放历史',
        icon: 'history',
        placement: ['tray', 'tab-bar'],
        order: 25,
      })
    }, 'history-ui-contributions'),
  )

  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
