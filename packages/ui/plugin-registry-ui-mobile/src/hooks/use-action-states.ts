/**
 * Per-entry install states for the given entries, kept live against the four
 * installed-content services — the mobile twin of the desktop package's
 * `useRegistryActionStates` (its `use-registry.ts` minus the desktop version
 * bridge, which mobile has no equivalent of).
 *
 * Derivation is synchronous per render (so a freshly loaded index never
 * paints a frame of wrong buttons) and re-derived whenever any
 * installed-content event fires. `bump` lets the caller force one extra
 * re-derivation — the backstop for a service whose change event has not
 * landed (or does not exist): changing `entries` itself cannot do it, because
 * the screen's backstop reshuffles the index object without touching the
 * entries array inside it.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntry } from '@BBeBee/protocol'
import {
  deriveRegistryActionStates,
  INSTALLED_CONTENT_EVENTS,
  readInstalledContentSnapshot,
} from './install-state.js'
import type { RegistryActionState } from './install-state.js'

export function useRegistryActionStates(
  ctx: Context,
  entries: readonly RegistryEntry[],
  bump = 0,
): ReadonlyMap<string, RegistryActionState> {
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const recompute = () => setNonce((n) => n + 1)
    const offs = INSTALLED_CONTENT_EVENTS.map((event) => ctx.on(event, recompute))
    return () => {
      for (const off of offs) off()
    }
  }, [ctx])

  return useMemo(
    () => deriveRegistryActionStates(entries, readInstalledContentSnapshot(ctx)),
    // `nonce` invalidates the memo when an installed-content event fires,
    // `bump` when the caller knows a service changed without an event.
    [ctx, entries, nonce, bump],
  )
}

export type { RegistryActionState }
