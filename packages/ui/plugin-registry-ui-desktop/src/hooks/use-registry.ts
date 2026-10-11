/**
 * The React bindings between the registry screen and the services.
 *
 * `useRegistryActionStates` subscribes to the installed-content services'
 * change events and re-derives per-entry action states; `useAppVersion` asks
 * the desktop bridge for the running version once. Neither holds domain
 * state React could mutate — services own it, components subscribe.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntry } from '@BBeBee/protocol'
import {
  deriveRegistryActionStates,
  INSTALLED_CONTENT_EVENTS,
  readInstalledContentSnapshot,
  type InstalledContentSnapshot,
  type RegistryActionState,
} from './install-state.js'

/**
 * Per-entry install states for the given entries, kept live against the four
 * installed-content services.
 *
 * Derivation is synchronous per render (so a freshly loaded index never
 * paints a frame of wrong buttons) and re-derived whenever any
 * installed-content event fires. `bump` lets the caller force one extra
 * re-derivation — the backstop for a service whose change event has not
 * landed (or does not exist): changing `entries` itself cannot do it, because
 * the screen's backstop reshuffles the index object without touching the
 * entries array inside it.
 */
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

/**
 * The running app's version, from the desktop bridge (`window.BBeBee`).
 *
 * `undefined` is a normal state here — tests, mobile, or a shell whose
 * preload predates the bridge — and the caller must not block installs on an
 * unknown version.
 */
export function useAppVersion(): string | undefined {
  const [version, setVersion] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const bridge = (window as unknown as { BBeBee?: { getAppVersion?: () => Promise<string> } }).BBeBee
    bridge
      ?.getAppVersion?.()
      .then((v) => {
        if (!cancelled && typeof v === 'string' && v) setVersion(v)
      })
      .catch(() => {
        // An unavailable version must not break the screen; gating degrades.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return version
}

/** Re-exported so the screen imports one hooks module. */
export type { InstalledContentSnapshot, RegistryActionState }
