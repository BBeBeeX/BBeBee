/**
 * View hooks for `ctx.downloads`.
 *
 * Written once here and consumed by both shells (docs/08 §4): which events
 * invalidate the list, and the two derived values a screen needs — how much is
 * in flight, and how far along one task is.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadPolicy, DownloadTask } from '@BBeBee/protocol'
import { useServiceState } from '@BBeBee/toolkit/hooks'

/**
 * The download queue.
 *
 * One subscription to the whole list rather than a store per row: a task
 * changes state and bytes together, and the page renders all of them, so
 * anything finer would re-derive the same array in a dozen places.
 */
export function useDownloadTasks(ctx: Context): readonly DownloadTask[] {
  return useServiceState(
    ctx,
    [
      'download/queued',
      'download/progress',
      'download/completed',
      'download/failed',
      'download/changed',
    ],
    () => ctx.downloads.tasks,
  )
}

export interface DownloadSummary {
  /** Queued, running or paused. */
  active: number
  done: number
  failed: number
  /** Bytes actually on disk, across finished downloads. */
  bytes: number
}

/** The policy the queue is applying, for a settings-style toggle row. */
export function useDownloadPolicy(ctx: Context): DownloadPolicy {
  return useServiceState(ctx, ['download/changed'], () => ctx.downloads.policy)
}

/**
 * What a held task is waiting for, in the user's terms.
 *
 * A blocked task is the only place the policy is visible while it does its
 * job, so the sentence is shared rather than written twice.
 */
export function holdLabel(task: DownloadTask): string | undefined {
  if (!task.blocked) return undefined
  return task.blocked === 'wifi' ? 'Waiting for Wi-Fi' : 'Waiting for a charger'
}

/** The header line's numbers, derived once rather than twice per shell. */
export function summariseDownloads(tasks: readonly DownloadTask[]): DownloadSummary {
  let active = 0
  let done = 0
  let failed = 0
  let bytes = 0
  for (const task of tasks) {
    if (task.state === 'queued' || task.state === 'running' || task.state === 'paused') active++
    else if (task.state === 'done') {
      done++
      bytes += task.bytesDone
    } else if (task.state === 'failed') failed++
  }
  return { active, done, failed, bytes }
}

/**
 * A task's completion in `0..1`, or `undefined` when it cannot be known.
 *
 * `undefined` is the honest answer twice over: a queued task has not started,
 * and a server that sent no length gives a transfer with no maximum. A bar
 * that draws 0% for "still connecting" and for "half of an unknown total"
 * tells the user something false in both cases.
 */
export function downloadProgress(task: DownloadTask): number | undefined {
  if (task.state === 'done') return 1
  if (task.state === 'queued' || task.state === 'paused' || task.state === 'canceled') {
    return undefined
  }
  if (!task.bytesTotal || task.bytesTotal <= 0) return task.state === 'failed' ? 0 : undefined
  return Math.min(1, Math.max(0, task.bytesDone / task.bytesTotal))
}
