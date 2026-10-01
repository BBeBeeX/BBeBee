/**
 * `plugin-history` — playback history and statistics.
 *
 * A **surface** plugin: it owns the history route and view id, and nothing else.
 * The history itself — recording play events, computing stats and the heatmap —
 * belongs to `ctx.player`, and the hooks that read it (`usePlayHistory`,
 * `usePlayHistoryStats`, `usePlayHistoryHeatmap`) stay in `plugin-player` beside
 * the service.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { HISTORY_ROUTES } from './views.js'

export const name = 'plugin-history'

/**
 * The route descriptor.
 *
 * `placement: ['tab-bar']` places it in mobile navigation; on desktop it is accessed via Settings.
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
        placement: ['tab-bar'],
        order: 25,
      })
      yield scoped.ui.contribute({
        kind: 'settings',
        id: HISTORY_ROUTES.history,
        section: 'playback',
        title: '播放历史 (Playback History)',
        description: '查看已播放曲目记录、按日期分布的听歌热力图及统计分析',
        actionText: '查看播放历史',
        order: 90,
      })
    }, 'history-ui-contributions'),
  )

  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
