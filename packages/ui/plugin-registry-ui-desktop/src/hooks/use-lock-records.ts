/**
 * The registry lock file as a per-entry map, for the 已安装 tab.
 *
 * Reads `ctx.contentRegistry.getLockFile?.()` — an optional method on the
 * service, so a registry build without the lock manager (or a test stub that
 * predates it) degrades to an empty map and the cards simply omit the
 * commit/installed-at line. One call fetches every record: walking per-entry
 * `getLockRecord` would spend a promise per card for the same payload.
 *
 * Re-read on the installed-content events, so an install or uninstall made
 * anywhere in the app refreshes the lock line without a manual refresh.
 */

import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryLockRecord } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { INSTALLED_CONTENT_EVENTS } from './install-state.js'

/** Structural slice of the registry service this hook reads. */
interface LockFileServiceLike {
  getLockFile?: () => Promise<{ records?: Record<string, RegistryLockRecord> }>
}

/** Entry id → its lock record. Absent = no lock information available. */
export type RegistryLockRecordsMap = ReadonlyMap<string, RegistryLockRecord>

export function useRegistryLockRecords(ctx: Context, enabled: boolean): RegistryLockRecordsMap {
  const [records, setRecords] = useState<RegistryLockRecordsMap>(() => new Map())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const read = () => {
      // ⚠️ `serviceOf` answers a fresh proxy per call — read it inside the
      // effect and its event callbacks, keyed on `ctx`, never in a
      // dependency array.
      const registry = serviceOf<LockFileServiceLike>(ctx, 'contentRegistry')
      const file = registry?.getLockFile?.()
      if (!file) {
        // Optional method absent — degrade quietly to "no lock info".
        setRecords(new Map())
        return
      }
      void file
        .then((lockFile) => {
          if (!cancelled) setRecords(new Map(Object.entries(lockFile?.records ?? {})))
        })
        .catch(() => {
          // An unreadable lock file must not break the tab; cards just show
          // the version line alone.
          if (!cancelled) setRecords(new Map())
        })
    }

    read()
    const offs = INSTALLED_CONTENT_EVENTS.map((event) => ctx.on(event, read))
    return () => {
      cancelled = true
      for (const off of offs) off()
    }
  }, [ctx, enabled])

  return records
}
