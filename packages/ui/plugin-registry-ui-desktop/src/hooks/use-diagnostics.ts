/**
 * Diagnostics state for the registry diagnostics screen.
 *
 * Reads `ctx.contentRegistry.getDiagnostics` / `rescanEntry` — both optional
 * protocol methods — structurally through `serviceOf`, the same discipline
 * `RegistryScreen` follows: the proxy is read inside callbacks keyed on
 * `ctx`, never held in a hook dependency array.
 *
 * A missing service *or* a service that does not implement the optional
 * methods degrades to `serviceMissing` with a `null` report — a stub or an
 * older build must never crash the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryDiagnosticsReport } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/** The slice of `ctx.contentRegistry` the diagnostics screen reads. Read structurally, never by import. */
export interface RegistryDiagnosticsServiceLike {
  getDiagnostics?(): Promise<RegistryDiagnosticsReport>
  rescanEntry?(entryId: string): Promise<void>
}

/** The outcome of one `rescanEntry` call, for the batch button's failure count. */
export interface RescanOutcome {
  readonly ok: boolean
  readonly error?: string
}

export interface UseDiagnosticsResult {
  /** The last report, or `null` while loading / when the service is missing. */
  report: RegistryDiagnosticsReport | null
  loading: boolean
  error: string | null
  /** True when the service (or its optional diagnostics methods) is absent. */
  serviceMissing: boolean
  /** Re-generates the report (the button's refresh). */
  refresh: () => Promise<void>
  /** Re-scans one entry and refreshes the report afterwards (silently — no loading flash). */
  rescanEntry: (entryId: string) => Promise<RescanOutcome>
  /** True while a single `rescanEntry` call is in flight. */
  rescanning: boolean
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useDiagnostics(ctx: Context): UseDiagnosticsResult {
  const getRegistry = useCallback(
    () => serviceOf<RegistryDiagnosticsServiceLike>(ctx, 'contentRegistry'),
    [ctx],
  )

  const [report, setReport] = useState<RegistryDiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [serviceMissing, setServiceMissing] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const read = useCallback(
    async (opts?: { silent?: boolean }) => {
      const registry = getRegistry()
      if (!registry || !registry.getDiagnostics) {
        if (!mounted.current) return
        setServiceMissing(true)
        setReport(null)
        setLoading(false)
        return
      }
      if (!opts?.silent) setLoading(true)
      try {
        const next = await registry.getDiagnostics()
        if (!mounted.current) return
        setReport(next ?? null)
        setServiceMissing(false)
        setError(null)
      } catch (err) {
        if (!mounted.current) return
        setError(errorMessage(err))
      } finally {
        if (mounted.current && !opts?.silent) setLoading(false)
      }
    },
    [getRegistry],
  )

  const refresh = useCallback(async () => {
    await read()
  }, [read])

  const rescanEntry = useCallback(
    async (entryId: string): Promise<RescanOutcome> => {
      const registry = getRegistry()
      if (!registry?.rescanEntry) {
        setServiceMissing(true)
        return { ok: false, error: 'diagnostics service unavailable' }
      }
      setRescanning(true)
      try {
        await registry.rescanEntry(entryId)
      } catch (err) {
        return { ok: false, error: errorMessage(err) }
      } finally {
        setRescanning(false)
      }
      // Pick up the refreshed findings without blanking the page: the report
      // swaps in place, so a batch of rescans reads as one continuous update.
      await read({ silent: true })
      return { ok: true }
    },
    [getRegistry, read],
  )

  useEffect(() => {
    void read()
  }, [read])

  return { report, loading, error, serviceMissing, refresh, rescanEntry, rescanning }
}
