/**
 * Desktop UI views for `@bbebee/plugin-lan-share`.
 *
 * One screen: peers on the network, a send panel (search the library, send
 * to the selected peer), incoming-offer prompts, and the transfer log.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LAN_SHARE_VIEWS } from '@bbebee/plugin-lan-share/views'
import { LanShareScreen } from './LanShareScreen.js'

export const name = 'plugin-lan-share-ui-desktop'

export const inject = ['ui', 'lanShare', 'sources']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lan-share-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LAN_SHARE_VIEWS.host, bound(ctx, LanShareScreen))
  }, 'lan-share-ui-desktop')
}

export default { name, inject, apply }
