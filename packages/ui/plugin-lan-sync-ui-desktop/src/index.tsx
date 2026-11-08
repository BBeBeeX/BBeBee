/**
 * Desktop UI views for `@bbebee/plugin-lan-sync`.
 *
 * One screen: leaders on the network, the active session (mirrored transport
 * with controls while following, the follower roster while serving), and the
 * manual-address fallback for networks where discovery is blocked.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LAN_SYNC_VIEWS } from '@bbebee/plugin-lan-sync/views'
import { LanSyncScreen } from './LanSyncScreen.js'

export const name = 'plugin-lan-sync-ui-desktop'

export const inject = ['ui', 'lanSync']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lan-sync-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LAN_SYNC_VIEWS.host, bound(ctx, LanSyncScreen))
  }, 'lan-sync-ui-desktop')
}

export default { name, inject, apply }
