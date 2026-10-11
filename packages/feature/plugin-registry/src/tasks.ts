/**
 * The registry task center's state machine — pure, context-free logic.
 *
 * A task is one tracked registry operation (install/update of one entry) as
 * it moves through the download → verify → install stages. The service layer
 * (`index.ts`) calls into this module at the natural points of its existing
 * code paths and re-emits a full snapshot after every mutation; everything
 * that decides *what a task is* lives here so it can be tested without a
 * context, a store or a network.
 *
 * Records are intentionally **in-memory only**: a task is short-lived
 * activity reporting, not user data — persistence would leave stale rows
 * claiming a running install after a crash. Finished records are capped (the
 * most recent `limit`), while active (pending/running) ones are never trimmed
 * by the cap and never removed by `clearFinished` — a pending task is the
 * user's "awaiting confirmation" and survives until the same entry is acted
 * on again or the app restarts.
 */

import type { RegistryEntryKind, RegistryTask } from '@BBeBee/protocol'

/** How many finished (success/failed) records are kept, most recent first. */
export const TASK_HISTORY_LIMIT = 50

/** The service-internal, mutable shape behind the protocol's readonly `RegistryTask`. */
export interface MutableRegistryTask {
  id: string
  entryId: string
  entryName: string
  kind: RegistryEntryKind
  operation: 'install' | 'update'
  stage: RegistryTask['stage']
  status: RegistryTask['status']
  progress?: { done: number; total: number }
  error?: string
  startedAt: number
  finishedAt?: number
}

/** The task registry's full state: active records keyed by entry, finished records newest-first. */
export interface TaskRegistryState {
  /** Pending/running records, one per entry at most, keyed by entry id. */
  readonly active: Map<string, MutableRegistryTask>
  /** Finished records, newest first, trimmed to the history limit. Reassigned wholesale by `clearFinished`. */
  finished: MutableRegistryTask[]
  /** The history cap (exposed so tests can exercise trimming with a small limit). */
  readonly limit: number
}

let taskSequence = 0

function nextTaskId(): string {
  taskSequence += 1
  return `registry-task-${taskSequence}`
}

export function createTaskRegistry(limit: number = TASK_HISTORY_LIMIT): TaskRegistryState {
  return { active: new Map(), finished: [], limit }
}

export interface BeginTaskInput {
  readonly entryId: string
  readonly entryName: string
  readonly kind: RegistryEntryKind
  readonly operation?: RegistryTask['operation']
  /** Wall-clock for `startedAt`; injected so tests are deterministic. */
  readonly now: number
}

/**
 * Start (or resume) the task for one entry.
 *
 * An active (pending/running) record for the entry is reused and reset —
 * status `running`, stage back to `download`, error and progress cleared —
 * so a re-fetch after an abandoned confirmation dialog does not pile up
 * duplicates. A finished record stays in history and a fresh one begins.
 */
export function beginTask(state: TaskRegistryState, input: BeginTaskInput): MutableRegistryTask {
  const existing = state.active.get(input.entryId)
  if (existing) {
    existing.status = 'running'
    existing.stage = 'download'
    existing.operation = input.operation ?? existing.operation
    existing.error = undefined
    existing.progress = undefined
    existing.startedAt = input.now
    existing.finishedAt = undefined
    return existing
  }
  const task: MutableRegistryTask = {
    id: nextTaskId(),
    entryId: input.entryId,
    entryName: input.entryName,
    kind: input.kind,
    operation: input.operation ?? 'install',
    stage: 'download',
    status: 'running',
    startedAt: input.now,
  }
  state.active.set(input.entryId, task)
  return task
}

/**
 * Advance the stage of the entry's active task. A no-op when no task is
 * tracked (rescans) or the task already finished — stage reporting must
 * never resurrect a record or overwrite a verdict.
 */
export function setTaskStage(state: TaskRegistryState, entryId: string, stage: RegistryTask['stage']): void {
  const task = state.active.get(entryId)
  if (!task || task.status !== 'running') return
  task.stage = stage
}

/** Attach measurable progress to the entry's active running task. */
export function setTaskProgress(
  state: TaskRegistryState,
  entryId: string,
  progress: { done: number; total: number },
): void {
  const task = state.active.get(entryId)
  if (!task || task.status !== 'running') return
  task.progress = { ...progress }
}

/**
 * Park the entry's task at `pending` — the fetch succeeded but the install
 * has not started yet ("等待确认"). The stage is kept for context; only the
 * status changes.
 */
export function holdTaskForConfirmation(state: TaskRegistryState, entryId: string): void {
  const task = state.active.get(entryId)
  if (!task || task.status === 'success' || task.status === 'failed') return
  task.status = 'pending'
}

/**
 * Finalize the entry's active task as `success`, moving it to the finished
 * list. Known progress is completed (`done = total`) — an honest tail to a
 * count the code really knew, never an invented percentage.
 */
export function completeTask(state: TaskRegistryState, entryId: string, now: number): void {
  const task = state.active.get(entryId)
  if (!task) return
  state.active.delete(entryId)
  task.status = 'success'
  task.error = undefined
  if (task.progress) task.progress.done = task.progress.total
  task.finishedAt = now
  state.finished.unshift(task)
  trimFinished(state)
}

/** Finalize the entry's active task as `failed`, keeping the extracted error text. */
export function failTask(state: TaskRegistryState, entryId: string, error: string, now: number): void {
  const task = state.active.get(entryId)
  if (!task) return
  state.active.delete(entryId)
  task.status = 'failed'
  task.error = error
  task.finishedAt = now
  state.finished.unshift(task)
  trimFinished(state)
}

/** Drop the oldest finished records beyond the cap. Active records are never touched. */
function trimFinished(state: TaskRegistryState): void {
  if (state.finished.length > state.limit) {
    state.finished.length = state.limit
  }
}

/**
 * Remove every finished (success/failed) record. Pending/running ones are
 * kept — they are either in flight or the user's un-confirmed install, and
 * neither is "finished".
 *
 * @returns how many records were removed.
 */
export function clearFinished(state: TaskRegistryState): number {
  const removed = state.finished.length
  state.finished = []
  return removed
}

/** The entry's active (pending/running) task, if one is tracked. */
export function activeTaskFor(state: TaskRegistryState, entryId: string): MutableRegistryTask | undefined {
  return state.active.get(entryId)
}

/**
 * The full read-only snapshot for `getTasks()` and the change event: active
 * records first (newest started first), then finished (newest first) — one
 * ordering, newest → oldest, the drawer renders as-is.
 */
export function snapshotTasks(state: TaskRegistryState): readonly RegistryTask[] {
  const active = [...state.active.values()].sort((a, b) => b.startedAt - a.startedAt)
  return [...active, ...state.finished].map(freezeTask)
}

function freezeTask(task: MutableRegistryTask): RegistryTask {
  return {
    id: task.id,
    entryId: task.entryId,
    entryName: task.entryName,
    kind: task.kind,
    operation: task.operation,
    stage: task.stage,
    status: task.status,
    ...(task.progress ? { progress: { ...task.progress } } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
    startedAt: task.startedAt,
    ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
  }
}
