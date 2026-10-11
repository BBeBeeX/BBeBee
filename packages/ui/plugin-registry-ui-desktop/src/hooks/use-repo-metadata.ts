/**
 * Lazy repo-stats binding for the registry screen.
 *
 * Reads `ctx.registryMetadata` through `serviceOf` only — and tolerates its
 * absence (the service is deferred, and mobile runs none of this UI): a
 * missing service means every entry simply has no stats and nothing is
 * requested.
 *
 * Requests fire once per visible repository: a ref remembers what has already
 * been asked, so re-renders, re-filters and tab switches never duplicate a
 * fetch (the service merges and TTL-caches the rest). Unmounting does not
 * cancel — the service owns the in-flight work and the cache — and each
 * resolved promise lands in the returned map, whose new identity re-renders
 * the caller.
 */

import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntry, RegistryMetadataService, RegistryRepoStats } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { entryRepo, repoKey } from '../utils/repo.js'

/** `'owner/repo'` → the stats that arrived for it. Absent = nothing yet. */
export type RepoStatsMap = ReadonlyMap<string, RegistryRepoStats>

export function useRepoMetadata(
  ctx: Context,
  entries: readonly RegistryEntry[],
  enabled: boolean,
): RepoStatsMap {
  const [results, setResults] = useState<RepoStatsMap>(() => new Map())
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled) return
    // ⚠️ `serviceOf` answers a fresh proxy per call — read it inside the
    // effect, keyed on `ctx`, never put it in a dependency array.
    const service = serviceOf<RegistryMetadataService>(ctx, 'registryMetadata')
    if (!service) return
    for (const entry of entries) {
      const ref = entryRepo(entry)
      if (!ref) continue
      const key = repoKey(ref)
      if (requestedRef.current.has(key)) continue
      requestedRef.current.add(key)
      void service
        .getRepoStats(ref.owner, ref.repo)
        .then((stats) => {
          setResults((prev) => new Map(prev).set(key, stats))
        })
        .catch(() => {
          // The service contract never rejects; a stray failure must not
          // break the screen — the entry just stays without stats.
        })
    }
  }, [ctx, entries, enabled])

  return results
}
