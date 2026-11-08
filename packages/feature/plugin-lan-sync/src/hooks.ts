/**
 * Shared React bindings for `ctx.lanSync` — the public surface view
 * packages import (`@bbebee/plugin-lan-sync/hooks`).
 *
 * The same rule as every feature's hooks subpath: services own the state,
 * these only subscribe. Nothing here imports another feature package.
 */

import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { LanSyncService, LanSyncSettings, SyncLeaderInfo, SyncSessionState, SyncSnapshot } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'

/** The service, or `undefined` while the plugin is disabled / loading. */
export function lanSyncOf(ctx: Context | undefined): LanSyncService | undefined {
  return serviceOf<LanSyncService>(ctx, 'lanSync')
}

/** Leaders heard on the network, most recent announce first. */
export function useLanSyncLeaders(ctx: Context): readonly SyncLeaderInfo[] {
  return useServiceState(
    ctx,
    ['lan-sync/leaders-changed'],
    () => lanSyncOf(ctx)?.leaders ?? [],
  )
}

/** The local session: role, the mirrored snapshot while following, the follower roster. */
export function useLanSyncSession(ctx: Context): SyncSessionState | undefined {
  return useServiceState(
    ctx,
    ['lan-sync/session-changed'],
    () => lanSyncOf(ctx)?.session,
  )
}

/**
 * The mirrored transport while following. Kept separate from the session so
 * a 1 Hz position mirror does not re-render the whole session panel.
 */
export function useLanSyncMirror(ctx: Context): SyncSnapshot | undefined {
  return useServiceState(
    ctx,
    ['lan-sync/mirror-changed', 'lan-sync/session-changed'],
    () => lanSyncOf(ctx)?.session.snapshot,
  )
}

export function useLanSyncSettings(ctx: Context): LanSyncSettings | undefined {
  return useServiceState(
    ctx,
    ['lan-sync/settings-changed'],
    () => lanSyncOf(ctx)?.settings,
  )
}

export interface MirrorPosition {
  positionMs: number
  durationMs: number
  playing: boolean
}

/**
 * The mirrored position, interpolated between snapshots so a progress bar
 * advances smoothly while the poll cycle (≤10 s) brings corrections. Ticks
 * a half-second clock locally; the value itself comes from the service's
 * clock estimate.
 */
export function useMirrorPosition(ctx: Context): MirrorPosition | undefined {
  const snapshot = useLanSyncMirror(ctx)
  const following = snapshot !== undefined
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!following) return
    const timer = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(timer)
  }, [following])
  if (!snapshot) return undefined
  const positionMs = lanSyncOf(ctx)?.mirrorPositionNow() ?? snapshot.positionMs
  return { positionMs, durationMs: snapshot.durationMs, playing: snapshot.status === 'playing' }
}
