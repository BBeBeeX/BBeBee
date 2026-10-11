/**
 * The task-center binding between the registry screen and the service.
 *
 * `useRegistryTasks` reads `ctx.contentRegistry.getTasks` — an optional
 * protocol method — structurally through `serviceOf`, the same discipline the
 * other registry hooks follow: the proxy is read inside the effect keyed on
 * `ctx`, never held in a dependency array. The list itself comes from the
 * service's `'registry/tasks-changed'` emissions (each payload is the full
 * snapshot), so React holds no task state machine — services own it,
 * components subscribe.
 *
 * A missing service *or* a service that does not implement the optional
 * methods degrades to an empty list — a stub or an older build must never
 * crash the screen, and the task button simply shows no badge.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { RegistryTask } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/** The slice of `ctx.contentRegistry` the task center reads. Read structurally, never by import. */
export interface RegistryTasksServiceLike {
  getTasks?(): readonly RegistryTask[]
  clearFinishedTasks?(): void
}

export interface UseRegistryTasksResult {
  /** The current snapshot, newest task first. Empty when tracking is unavailable. */
  tasks: readonly RegistryTask[]
  /** Tasks currently running — the header badge count. */
  runningCount: number
  /** True when the service exposes `clearFinishedTasks` (the drawer's 清空已完成 button). */
  canClear: boolean
  /** Removes every finished (success/failed) record; a no-op when the method is absent. */
  clearFinished: () => void
}

export function useRegistryTasks(ctx: Context): UseRegistryTasksResult {
  const getRegistry = useCallback(
    () => serviceOf<RegistryTasksServiceLike>(ctx, 'contentRegistry'),
    [ctx],
  )

  const [tasks, setTasks] = useState<readonly RegistryTask[]>([])

  useEffect(() => {
    // The service's own snapshot is the truth; the event keeps it live. Both
    // reads happen inside the effect so the serviceOf proxy never sits in a
    // dependency array.
    setTasks(getRegistry()?.getTasks?.() ?? [])
    const off = ctx.on('registry/tasks-changed', (next) => {
      setTasks(next ?? [])
    })
    return () => {
      off()
    }
  }, [ctx, getRegistry])

  return useMemo(() => {
    const registry = getRegistry()
    return {
      tasks,
      runningCount: tasks.filter((task) => task.status === 'running').length,
      canClear: typeof registry?.clearFinishedTasks === 'function',
      // Read the service again inside the handler — the same discipline as
      // every other handler on this screen.
      clearFinished: () => {
        getRegistry()?.clearFinishedTasks?.()
      },
    }
  }, [getRegistry, tasks])
}
