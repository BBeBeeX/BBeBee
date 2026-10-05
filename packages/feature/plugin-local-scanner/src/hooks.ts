/**
 * View hooks for `ctx.scanner`.
 *
 * Written once here so both shells share them (docs/08 4). The interesting
 * part is progress: a scan emits per batch, and a settings screen that only
 * learned the outcome would sit still for minutes over a large library and
 * look broken.
 */

import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { ScanProgress, ScanSpecifiedDir, ScanSummary } from '@BBeBee/protocol'
import { shallowArrayEqual, useServiceState } from '@BBeBee/toolkit/hooks'

/** The configured folders. */
export function useScanSpecifiedDirs(ctx: Context): readonly ScanSpecifiedDir[] {
  return useServiceState(
    ctx,
    ['scan/specified-dirs-changed', 'scan/finished', 'scan/started', 'library/changed'],
    () => ctx.scanner.specifiedDirs,
    { isEqual: shallowArrayEqual },
  )
}

export interface ScanState {
  /** Present while a walk is in flight. */
  progress?: ScanProgress
  running: boolean
  /** The last completed walk, so a screen can say what happened. */
  lastSummary?: ScanSummary
}

/**
 * Live scan state.
 *
 * Subscribes to the batch events rather than polling: the scanner checkpoints
 * per batch precisely so progress is reportable, and a screen that polled
 * would either lag or burn a timer for nothing.
 */
export function useScanState(ctx: Context): ScanState {
  const [state, setState] = useState<ScanState>({ running: false })

  useEffect(() => {
    const offs = [
      ctx.on('scan/started', () => setState((prev) => ({ ...prev, running: true }))),
      ctx.on('scan/progress', (specifiedDirId: string, done: number, total?: number) =>
        setState((prev) => ({
          ...prev,
          running: true,
          progress: { specifiedDirId, done, ...(total === undefined ? {} : { total }) },
        })),
      ),
      ctx.on('scan/finished', (_specifiedDirId: string, summary: ScanSummary) =>
        // `progress` is cleared, not left at its last value: a bar frozen at
        // 90% after a finished scan is worse than no bar.
        setState({ running: false, lastSummary: summary }),
      ),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [ctx])

  return state
}

/**
 * What a scan did, in a sentence.
 *
 * Shared because both shells show it, and because "errors" must not be folded
 * into silence: a file that would not decode is surfaced as a count the user
 * can act on (docs/06 12).
 */
export function summarise(summary: ScanSummary | undefined): string {
  if (!summary) return ''
  const parts: string[] = []
  if (summary.added) parts.push(`${summary.added} added`)
  if (summary.updated) parts.push(`${summary.updated} updated`)
  if (summary.removed) parts.push(`${summary.removed} removed`)
  if (summary.errors) parts.push(`${summary.errors} could not be read`)

  /*
   * ⚠️ `incomplete` outranks the counts, and is not a footnote to them.
   *
   * A truncated scan — a symlink loop, an unreadable folder — imports what it
   * saw and deliberately removes nothing (docs/06 §12). Rendering that as
   * "nothing changed" tells the user their library is reconciled when the
   * opposite is true, which is the exact failure the flag exists to prevent.
   */
  if (summary.incomplete) {
    const prefix = summary.cancelled ? 'Scan cancelled' : 'Scan incomplete'
    const detail = parts.length > 0 ? parts.join(', ') : 'nothing imported'
    return `${prefix} — ${detail}. Some folders could not be read, so nothing was removed.`
  }

  return parts.length > 0 ? parts.join(', ') : 'nothing changed'
}
