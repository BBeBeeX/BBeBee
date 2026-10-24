/**
 * Latest npm versions for the visible plugin entries.
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
): PluginLatestMap {
  const [results, setResults] = useState<PluginLatestMap>(() => new Map())
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // ⚠️ `serviceOf` answers a fresh proxy per call — read it inside the
    // effect, keyed on `ctx`, never put it in a dependency array.
    const manager = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
    const getLatest = manager?.getNpmLatest
    if (!getLatest) return
    for (const entry of entries) {
      if (entry.kind !== 'plugin' || !entry.npm) continue
      if (requestedRef.current.has(entry.npm)) continue
      requestedRef.current.add(entry.npm)
      const npm = entry.npm
      void getLatest
        .call(manager, npm)
        .then((latest) => {
          if (latest) {
            setResults((prev) => new Map(prev).set(npm, latest))
          }
        })
        .catch(() => {
          // A failed lookup leaves the card without a version; the manager
          // already logs it, and the screen must not break over it.
        })
    }
  }, [ctx, entries])

  return results
}
