import { describe, expect, it } from 'vitest'
import {
  beginTask,
  clearFinished,
  completeTask,
  createTaskRegistry,
  failTask,
  holdTaskForConfirmation,
  setTaskProgress,
  setTaskStage,
  snapshotTasks,
  TASK_HISTORY_LIMIT,
} from './tasks.js'
import type { TaskRegistryState } from './tasks.js'

function makeRegistry(limit = TASK_HISTORY_LIMIT): TaskRegistryState {
  return createTaskRegistry(limit)
}

function beginFoo(state: TaskRegistryState, now = 1000) {
  return beginTask(state, { entryId: 'foo', entryName: 'Foo', kind: 'theme', now })
}

describe('beginTask', () => {
  it('creates a running task at the download stage', () => {
    const state = makeRegistry()
    const task = beginFoo(state)
    expect(task).toMatchObject({
      entryId: 'foo',
      entryName: 'Foo',
      kind: 'theme',
      operation: 'install',
      stage: 'download',
      status: 'running',
      startedAt: 1000,
    })
    expect(task.id).toBeTruthy()
  })

  it('reuses and resets an active (pending/running) task instead of duplicating it', () => {
    const state = makeRegistry()
    const first = beginFoo(state, 1000)
    holdTaskForConfirmation(state, 'foo')
    failTask(state, 'foo', 'nope', 1100) // failed moves to history

    const second = beginFoo(state, 2000)
    expect(state.active.size).toBe(1)
    expect(second.id).not.toBe(first.id)
    expect(second).toMatchObject({ status: 'running', stage: 'download', startedAt: 2000 })
    expect(second.error).toBeUndefined()
    expect(second.finishedAt).toBeUndefined()

    // A still-active record is reused in place, id and all.
    holdTaskForConfirmation(state, 'foo')
    const reused = beginFoo(state, 3000)
    expect(reused.id).toBe(second.id)
    expect(reused.status).toBe('running')
    expect(reused.startedAt).toBe(3000)
  })
})

describe('setTaskStage / setTaskProgress', () => {
  it('advances the stage of the running task', () => {
    const state = makeRegistry()
    beginFoo(state)
    setTaskStage(state, 'foo', 'verify')
    expect(state.active.get('foo')?.stage).toBe('verify')
    setTaskStage(state, 'foo', 'install')
    expect(state.active.get('foo')?.stage).toBe('install')
  })

  it('is a no-op without a tracked task or after completion', () => {
    const state = makeRegistry()
    setTaskStage(state, 'ghost', 'verify')
    expect(state.active.size).toBe(0)

    beginFoo(state)
    completeTask(state, 'foo', 1500)
    setTaskStage(state, 'foo', 'verify')
    expect(state.finished[0]?.stage).toBe('download')
  })

  it('attaches progress only while running', () => {
    const state = makeRegistry()
    beginFoo(state)
    setTaskProgress(state, 'foo', { done: 0, total: 3 })
    expect(state.active.get('foo')?.progress).toEqual({ done: 0, total: 3 })

    completeTask(state, 'foo', 1500)
    // An honest tail: the count the code knew is completed, never faked beyond it.
    expect(state.finished[0]?.progress).toEqual({ done: 3, total: 3 })

    setTaskProgress(state, 'foo', { done: 1, total: 3 })
    expect(state.finished[0]?.progress).toEqual({ done: 3, total: 3 })
  })
})

describe('holdTaskForConfirmation', () => {
  it('parks a fetched task at pending, keeping its stage for context', () => {
    const state = makeRegistry()
    beginFoo(state)
    setTaskStage(state, 'foo', 'verify')
    holdTaskForConfirmation(state, 'foo')
    expect(state.active.get('foo')).toMatchObject({ status: 'pending', stage: 'verify' })
  })

  it('never resurrects a finished task', () => {
    const state = makeRegistry()
    beginFoo(state)
    completeTask(state, 'foo', 1500)
    holdTaskForConfirmation(state, 'foo')
    expect(state.finished[0]?.status).toBe('success')
    expect(state.active.size).toBe(0)
  })
})

describe('completeTask / failTask', () => {
  it('finalizes as success with finishedAt and moves the record to history', () => {
    const state = makeRegistry()
    beginFoo(state)
    completeTask(state, 'foo', 1500)
    expect(state.active.has('foo')).toBe(false)
    expect(state.finished[0]).toMatchObject({ entryId: 'foo', status: 'success', finishedAt: 1500 })
    expect(state.finished[0]?.error).toBeUndefined()
  })

  it('finalizes as failed with the extracted error text', () => {
    const state = makeRegistry()
    beginFoo(state)
    failTask(state, 'foo', 'the document was not imported', 1600)
    expect(state.finished[0]).toMatchObject({
      status: 'failed',
      error: 'the document was not imported',
      finishedAt: 1600,
    })
    expect(state.active.size).toBe(0)
  })

  it('ignores finalization for an untracked entry', () => {
    const state = makeRegistry()
    completeTask(state, 'ghost', 1500)
    failTask(state, 'ghost', 'boo', 1500)
    expect(state.finished).toEqual([])
  })
})

describe('history cap and clearFinished', () => {
  it('keeps only the newest finished records, and never trims active ones', () => {
    const state = makeRegistry(3)
    for (let i = 0; i < 5; i++) {
      beginTask(state, { entryId: `e-${i}`, entryName: `E${i}`, kind: 'plugin', now: i })
      failTask(state, `e-${i}`, 'boom', i + 0.5)
    }
    expect(state.finished.map((task) => task.entryId)).toEqual(['e-4', 'e-3', 'e-2'])

    // Active records are exempt from the cap.
    beginTask(state, { entryId: 'active', entryName: 'A', kind: 'theme', now: 100 })
    expect(state.active.size).toBe(1)
    expect(snapshotTasks(state)).toHaveLength(4)
  })

  it('clears every finished record but keeps pending/running ones', () => {
    const state = makeRegistry()
    beginFoo(state)
    holdTaskForConfirmation(state, 'foo') // pending
    beginTask(state, { entryId: 'bar', entryName: 'Bar', kind: 'theme', now: 1100 })
    completeTask(state, 'bar', 1200) // finished

    expect(clearFinished(state)).toBe(1)
    expect(state.finished).toEqual([])
    expect(state.active.get('foo')?.status).toBe('pending')
    expect(clearFinished(state)).toBe(0)
  })
})

describe('snapshotTasks', () => {
  it('orders newest → oldest across active and finished records, and freezes the rows', () => {
    const state = makeRegistry()
    beginTask(state, { entryId: 'old', entryName: 'Old', kind: 'theme', now: 1000 })
    completeTask(state, 'old', 1100)
    beginTask(state, { entryId: 'new', entryName: 'New', kind: 'plugin', now: 2000 })

    const snapshot = snapshotTasks(state)
    expect(snapshot.map((task) => task.entryId)).toEqual(['new', 'old'])

    // The snapshot is a copy: later mutations never leak into a payload already emitted.
    setTaskStage(state, 'new', 'verify')
    expect(snapshot[0]?.stage).toBe('download')
  })
})
