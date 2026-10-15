/**
 * View hooks for `ctx.audioConverter`.
 */

import type { Context } from 'cordis'
import type {
  AudioConverterConfig,
  ConvertTask,
} from '@BBeBee/protocol'
import { useServiceState } from '@BBeBee/toolkit/hooks'

export interface TaskSummary {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  bytesSaved: number
}

export function summarizeTasks(tasks: readonly ConvertTask[]): TaskSummary {
  let pending = 0
  let processing = 0
  let completed = 0
  let failed = 0
  let cancelled = 0
  let bytesSaved = 0

  for (const t of tasks) {
    if (t.status === 'pending') pending++
    else if (t.status === 'processing') processing++
    else if (t.status === 'completed') {
      completed++
      if (t.sourceSize > 0 && t.outputSize && t.outputSize < t.sourceSize) {
        bytesSaved += (t.sourceSize - t.outputSize)
      }
    } else if (t.status === 'failed') failed++
    else if (t.status === 'cancelled') cancelled++
  }

  return {
    total: tasks.length,
    pending,
    processing,
    completed,
    failed,
    cancelled,
    bytesSaved,
  }
}

export function useAudioConverterTasks(ctx: Context): readonly ConvertTask[] {
  return useServiceState(
    ctx,
    [
      'audio-converter/tasks-changed',
      'audio-converter/task-progress',
      'audio-converter/task-completed',
      'audio-converter/task-failed',
    ],
    () => ctx.audioConverter?.getTasks() ?? [],
  )
}

export function useAudioConverterConfig(ctx: Context): AudioConverterConfig {
  return useServiceState(
    ctx,
    ['settings/changed'],
    () =>
      ctx.audioConverter?.getConfig() ?? {
        defaultFormat: 'mp3',
        maxConcurrency: 2,
        taskTimeoutMs: 300_000,
        autoCleanTemp: true,
      },
  )
}
