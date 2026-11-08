/**
 * Shared React bindings for `ctx.lanShare` — the public surface view
 * packages import (`@bbebee/plugin-lan-share/hooks`).
 *
 * The same rule as every feature's hooks subpath: services own the state,
 * these only subscribe. Nothing here imports another feature package.
 */

import type { Context } from 'cordis'
import type { LanSharePeer, LanShareService, LanShareSettings, LanShareTransfer } from '@BBeBee/protocol'
import { serviceOf, shallowArrayEqual, useServiceState } from '@BBeBee/toolkit/hooks'

/** The service, or `undefined` while the plugin is disabled / loading. */
export function lanShareOf(ctx: Context | undefined): LanShareService | undefined {
  return serviceOf<LanShareService>(ctx, 'lanShare')
}

export function useLanSharePeers(ctx: Context): readonly LanSharePeer[] {
  return useServiceState(
    ctx,
    ['lan-share/peers-changed'],
    () => lanShareOf(ctx)?.peers ?? [],
    { isEqual: shallowArrayEqual },
  )
}

export function useLanShareTransfers(ctx: Context): readonly LanShareTransfer[] {
  return useServiceState(
    ctx,
    ['lan-share/transfers-changed'],
    () => lanShareOf(ctx)?.transfers ?? [],
    { isEqual: shallowArrayEqual },
  )
}

export function useLanShareSettings(ctx: Context): LanShareSettings | undefined {
  return useServiceState(
    ctx,
    ['lan-share/settings-changed'],
    () => lanShareOf(ctx)?.settings,
  )
}
