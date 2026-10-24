/**
 * The Discover dot's "unseen updates" semantics, shared by the tray
 * (TopBar) and the sidebar (Shell) so the two dots can never disagree.
 *
 * The registry service fires `registry/updates-available` with the FULL
 * list after every check — including a list the user already looked at.
 * A dot driven straight off that event therefore never clears on a visit
 * to Discover, and stays lit until the next check comes back clean (up to
 * 24h later). The user-confirmed semantics are instead: the dot means
 * "there are updates you have not seen yet".
 *
 * The seen state is a signature of the update list
 * (`kind:id:availableVersion`, sorted, joined) persisted in localStorage:
 * - entering Discover marks the current list seen, and the dot clears;
 * - a later check with the same signature stays seen, even if nothing was
 *   installed — seeing, not installing, is what clears it;
 * - a later check with a new signature (a new item, or a newer version)
 *   is unseen again, and the dot re-lights.
 *
 * Both dot owners subscribe to `registry/updates-seen` as well as
 * `registry/updates-available`, so marking seen in one place (Shell's
 * internal navigation, or a tray click that goes through `ui/navigate`)
 * clears the other place's dot in the same tick.
 */

import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryUpdate } from '@BBeBee/protocol'
import { REGISTRY_VIEWS } from '@bbebee/plugin-registry/views'

function serviceOf<T = unknown>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { reflect?: { get(key: string, required: boolean): unknown } }).reflect?.get?.(
    key,
    false,
  ) as T | undefined
}

interface RegistryServiceLike {
  updates?(): readonly RegistryUpdate[]
}

/** localStorage key holding the signature of the last seen update list. */
export const REGISTRY_SEEN_UPDATES_KEY = 'bbebee_registry_seen_updates'

export function registryUpdatesSignature(updates: readonly RegistryUpdate[]): string {
  return updates
    .map((u) => `${u.kind}:${u.id}:${u.availableVersion}`)
    .sort()
    .join('|')
}

export function readSeenUpdatesSignature(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage?.getItem(REGISTRY_SEEN_UPDATES_KEY) : null
  } catch {
    return null
  }
}

function writeSeenUpdatesSignature(signature: string): void {
  try {
    window.localStorage?.setItem(REGISTRY_SEEN_UPDATES_KEY, signature)
  } catch {
    // Seen state is a nicety, not data: a storage failure must not break navigation.
  }
}

function readCurrentUpdates(ctx: Context): readonly RegistryUpdate[] {
  try {
    return serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')?.updates?.() ?? []
  } catch {
    return []
  }
}

/**
 * Mark the registry's current update list as seen: persist its signature
 * and notify every dot owner. Safe to call when no check has run yet — the
 * empty signature simply means "nothing seen yet", so the first real check
 * still lights the dot.
 */
export function markRegistryUpdatesSeen(ctx: Context): void {
  const signature = registryUpdatesSignature(readCurrentUpdates(ctx))
  writeSeenUpdatesSignature(signature)
  try {
    ctx.emit('registry/updates-seen', signature)
  } catch {
    // The persisted signature already carries the state; a listener that
    // throws must not break the navigation that caused the mark.
  }
}

/**
 * Whether there are updates the user has not seen yet. True only when the
 * latest check found updates whose signature differs from the seen one.
 */
export function useRegistryUnseenUpdates(ctx: Context): boolean {
  const seenRef = useRef<string | null>(readSeenUpdatesSignature())
  const [unseen, setUnseen] = useState<boolean>(() => {
    const list = readCurrentUpdates(ctx)
    return list.length > 0 && registryUpdatesSignature(list) !== readSeenUpdatesSignature()
  })

  useEffect(() => {
    const onUpdates = (updates: readonly RegistryUpdate[]) => {
      setUnseen(
        Array.isArray(updates) &&
          updates.length > 0 &&
          registryUpdatesSignature(updates) !== seenRef.current,
      )
    }
    const onSeen = (signature: string) => {
      seenRef.current = signature
      writeSeenUpdatesSignature(signature)
      setUnseen(false)
    }
    const onNavigate = (routeId: string) => {
      if (routeId === REGISTRY_VIEWS.screen || routeId === '/registry') {
        markRegistryUpdatesSeen(ctx)
      }
    }
    const offUpdates = ctx.on('registry/updates-available', onUpdates)
    const offSeen = ctx.on('registry/updates-seen', onSeen)
    const offNavigate = ctx.on('ui/navigate', onNavigate)
    return () => {
      offUpdates?.()
      offSeen?.()
      offNavigate?.()
    }
  }, [ctx])

  return unseen
}
