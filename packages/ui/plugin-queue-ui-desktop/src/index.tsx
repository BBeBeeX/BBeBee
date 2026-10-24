/**
 * React DOM views for `@bbebee/plugin-queue`.
 *
 * Screen: the up-next list and recently played history tabs.
 * Every value comes from the shared bindings in `@BBeBee/toolkit/hooks` — the
 * queue model belongs to the player, the binding is toolkit's — and this package
 * handles layout, presentation, and event wiring only (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { QUEUE_VIEWS } from '@bbebee/plugin-queue/views'
import { QueueTrackRow, type QueueTrackRowProps } from './QueueTrackRow.js'
import { QueueScreen, type QueueScreenProps } from './QueueScreen.js'
import { QueueButton, type QueueButtonProps } from './QueueButton.js'

export { QueueTrackRow, type QueueTrackRowProps }
export { QueueScreen, type QueueScreenProps }
export { QueueButton, type QueueButtonProps }

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-queue-ui-desktop'
export const inject = ['ui', 'player', 'sources']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-queue-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(QUEUE_VIEWS.queue, bound(ctx, QueueScreen))
    yield ctx.ui.registerView('queue.button', bound(ctx, QueueButton))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'queue.button',
      slot: 'now-playing.actions',
      order: 30,
    })
  }, 'queue-ui-desktop')
}

export default { name, inject, apply }
