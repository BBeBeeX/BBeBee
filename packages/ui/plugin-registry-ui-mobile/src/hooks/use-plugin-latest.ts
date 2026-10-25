/**
 * Latest npm versions for the visible plugin entries — the mobile twin of the
 * desktop package's hook, kept behaviourally identical.
 *
 * The registry index carries no plugin version (schema v2: version truth
 * lives on npm), so the plugin cards' title versions and the
 * latest-version badges of installed plugins with updates need a live
 * answer. It comes from the plugin-manager's `getNpmLatest`, which reads
 * the npm client's packument cache — cheap after the first lookup, and
 * never throwing (a failed lookup just leaves the card without a version).
 *
 * Requests fire once per package name: a ref remembers what has already
 * been asked, so re-renders and tab switches never duplicate a fetch, and
 * entries sharing a package share the answer through the map key.
 *
 * A refresh must break both staleness layers: when `refreshSignal`
 * changes, the dedup set is cleared and the re-requests go out with
 * `force`, skipping the packument cache too. Without this, the refresh
 * button only re-read the index (which carries no plugin versions) while
 * the cards kept showing the first lookup's answer.
 */

import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type { PluginManagerService, RegistryEntry } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/** npm package name → its `dist-tags.latest`, when the lookup answered. */
export type PluginLatestMap = ReadonlyMap<string, string>

export function usePluginLatestVersions(
  ctx: Context,
  entries: readonly RegistryEntry[],
  refreshSignal = 0,
): PluginLatestMap {
  const [results, setResults] = useState<PluginLatestMap>(() => new Map())
  const requestedRef = useRef<Set<string>>(new Set())
  const signalRef = useRef(refreshSignal)

  useEffect(() => {
    // ⚠️ `serviceOf` answers a fresh proxy per call — read it inside the
    // effect, keyed on `ctx`, never put it in a dependency array.
    const manager = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
    const getLatest = manager?.getNpmLatest
    if (!getLatest) return
    // A changed signal is a refresh: re-ask everything, forced. Any
    // other re-run keeps the once-per-package dedup.
    const force = refreshSignal !== signalRef.current
    if (force) {
      signalRef.current = refreshSignal
      requestedRef.current.clear()
    }
    for (const entry of entries) {
      if (entry.kind !== 'plugin' || !entry.npm) continue
      if (requestedRef.current.has(entry.npm)) continue
      requestedRef.current.add(entry.npm)
      const npm = entry.npm
      void getLatest
        .call(manager, npm, force)
        .then((latest) => {
          if (latest) {
            setResults((prev) => new Map(prev).set(npm, latest))
          }
        })
        .catch(() => {
          // A failed lookup leaves the card without a version; the manager
          // already logs it, and the screen must not break over it.
          // On a forced refresh the previous value stays for the same
          // reason — a transient failure must not blank live cards.
        })
    }
  }, [ctx, entries, refreshSignal])

  return results
}
