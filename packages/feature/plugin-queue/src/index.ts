/**
 * `plugin-queue` — the up-next list.
 *
 * A **surface** plugin: it owns the queue route and view id, and nothing else.
 * The queue itself — the ordered items, the current item, reordering, the
 * "jump to this one" semantics — belongs to `ctx.player`, and the hooks that
 * read it (`useQueue`, `useTracksByUrn`, `queueTrackFallback`) live in
 * `@BBeBee/toolkit/hooks` beside the other shared bindings.
 *
 * It was part of `plugin-player`, then of that plugin's view package; it is its
 * own plugin because up-next is a *different question* from what is playing now —
 * the now-playing surfaces live in `plugin-now-playing` — and because a
 * transport service should not have to change when a screen does.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { QUEUE_ROUTES } from './views.js'

export const name = 'plugin-queue'

/**
 * The route descriptor.
 *
 * `placement: ['tab-bar', 'sidebar']` is unchanged from when the player
 * contributed it: the queue is a place people go on purpose, on both shells.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-queue: loaded')

  // The `ui` inject is a child fiber, so unloading this plugin unloads the
  // contribution with it. Not awaited: a build without `plugin-ui` is a build
  // with no contribution, not a plugin that never finishes loading.
  const fiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      scoped.logger.debug(`queue: contributing route ${QUEUE_ROUTES.queue}`)
      yield scoped.ui.contribute({
        kind: 'route',
        id: QUEUE_ROUTES.queue,
        path: '/queue',
        title: 'Queue',
        icon: 'list',
        placement: ['tab-bar'],
        order: 20,
      })
    }, 'queue-ui-contributions'),
  )

  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
