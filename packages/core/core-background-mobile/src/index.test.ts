/**
 * `ctx.background` on mobile.
 *
 * The OS scheduler's whole point is running work while the app is *away* —
 * which means a schedule would never fire during a normal session of actual
 * use. These tests drive the `AppState` stub the way the OS delivers status
 * changes and hold the foreground resume to the contract the desktop timer
 * keeps without trying: a due window fires at most once, whoever the
 * dispatcher is.
 *
 * `expo-background-task`, `expo-task-manager` and `expo-keep-awake` are
 * mocked here rather than aliased in `vitest.config.ts`. They reach the
 * native runtime at *module scope* (`requireNativeModule`,
 * `globalThis.ExpoGlobal`) and cannot be evaluated in Node at all, so a
 * recording fake of their surface is the only thing a test can load. The
 * fakes do nothing but record — a test that strays into genuinely native
 * behaviour fails rather than passing against a pretend runtime.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import plugin, { BackgroundExpo } from './index.js'

vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(),
}))

vi.mock('expo-background-task', () => ({
  registerTaskAsync: vi.fn(async () => {}),
  unregisterTaskAsync: vi.fn(async () => {}),
  BackgroundTaskResult: { Success: 'success' },
}))

vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
}))

type AppStateStub = {
  __emitAppState?: (status: 'active' | 'inactive' | 'background') => void
  __resetAppStateForTests?: () => void
}

async function emitAppState(status: 'active' | 'inactive' | 'background'): Promise<void> {
  const rn = (await import('react-native')) as unknown as AppStateStub
  rn.__emitAppState?.(status)
  /*
   * The service reacts to `AppState` in a fire-and-forget continuation (the
   * OS delivers the event, it does not wait for the work). Let the queue
   * settle — two macrotask boundaries drain every microtask the tick spawns,
   * including the chained awaits inside `runScheduled` — so the assertions
   * observe finished work rather than winning a race by accident.
   */
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/** A controllable clock, so due-ness does not need real time to pass. */
function fakeClock() {
  let now = 1_700_000_000_000
  return {
    now: () => now,
    advanceMinutes: (minutes: number) => {
      now += minutes * 60_000
    },
  }
}

async function harness() {
  const clock = fakeClock()
  const ctx = new Context()
  const fiber = await ctx.plugin(BackgroundExpo, { now: clock.now })
  return { ctx, fiber, clock, background: ctx.background as BackgroundExpo }
}

beforeEach(async () => {
  vi.clearAllMocks()
  const rn = (await import('react-native')) as unknown as AppStateStub
  rn.__resetAppStateForTests?.()
})

describe('schedule', () => {
  it('registers the OS task with the interval as a minimum hint', async () => {
    const { background } = await harness()
    await background.schedule('rescan', 30, async () => {})

    const { registerTaskAsync } = (await import('expo-background-task')) as unknown as {
      registerTaskAsync: ReturnType<typeof vi.fn>
    }
    expect(registerTaskAsync).toHaveBeenCalledOnce()
    const [name, options] = registerTaskAsync.mock.calls[0] as [string, { minimumInterval: number }]
    expect(name).toBe('bbebee.background.dispatch')
    expect(options.minimumInterval).toBe(30)
  })

  it('survives a task that rejects', async () => {
    const { background, clock } = await harness()
    const survivor = vi.fn(async () => {})
    await background.schedule('doomed', 30, async () => {
      throw new Error('disk went away')
    })
    await background.schedule('survivor', 30, survivor)

    clock.advanceMinutes(31)
    await emitAppState('background')
    await emitAppState('active')
    expect(survivor).toHaveBeenCalledOnce()
  })
})

describe('foreground resume', () => {
  it('runs a due task when the app returns to active', async () => {
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    await background.schedule('rescan', 30, task)

    clock.advanceMinutes(31)
    await emitAppState('background')
    await emitAppState('active')
    expect(task).toHaveBeenCalledOnce()
  })

  it('does not run a task that is not yet due', async () => {
    // Mirrors the desktop timer: `setInterval` opens the first window a full
    // interval after scheduling, and so does this.
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    await background.schedule('rescan', 30, task)

    clock.advanceMinutes(5)
    await emitAppState('background')
    await emitAppState('active')
    expect(task).not.toHaveBeenCalled()
  })

  it('an OS wake-up and a foreground resume share one due window', async () => {
    // The dedup is the point: the OS may run the task in the background and
    // the user then opens the app before the next interval elapses. Both
    // dispatchers call the same `runScheduled`, and the run stamped inside it
    // is what keeps the window from firing twice.
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    await background.schedule('rescan', 30, task)

    clock.advanceMinutes(31)
    await emitAppState('background')

    await background.runScheduled() // the OS dispatcher's path
    await emitAppState('active') // the foreground tick, same window
    expect(task).toHaveBeenCalledOnce()

    // The next window is still reachable.
    clock.advanceMinutes(30)
    await emitAppState('inactive')
    await emitAppState('active')
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('a foreground run does not hand the window to the OS dispatcher', async () => {
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    await background.schedule('rescan', 30, task)

    clock.advanceMinutes(31)
    await emitAppState('background')

    await emitAppState('active') // foreground first
    await background.runScheduled() // OS wake-up for the same window
    expect(task).toHaveBeenCalledOnce()
  })

  it('runs nothing when no task is scheduled', async () => {
    const { background } = await harness()
    await emitAppState('background')
    await expect(background.runScheduled()).resolves.toBeUndefined()
  })
})

describe('onWillSuspend', () => {
  it('fires the checkpoint once, on the way out', async () => {
    const { background } = await harness()
    const checkpoint = vi.fn()
    background.onWillSuspend(checkpoint)

    await emitAppState('background')
    expect(checkpoint).toHaveBeenCalledOnce()

    // Still backgrounded — a further status change is not a second leaving.
    await emitAppState('inactive')
    expect(checkpoint).toHaveBeenCalledOnce()
  })

  it('does not fire the checkpoint when the app returns to active', async () => {
    const { background } = await harness()
    const checkpoint = vi.fn()
    background.onWillSuspend(checkpoint)

    await emitAppState('background')
    await emitAppState('active')
    expect(checkpoint).toHaveBeenCalledOnce()
  })

  it('keeps the checkpoint alive after another listener is disposed', async () => {
    // The AppState subscription belongs to the service now — it also drives
    // the foreground tick — so it may not disappear just because the last
    // suspend listener went away.
    const { background } = await harness()
    const kept = vi.fn()
    const dropped = vi.fn()
    const offDropped = background.onWillSuspend(dropped)
    background.onWillSuspend(kept)

    offDropped()
    await emitAppState('background')
    expect(dropped).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledOnce()
  })
})

describe('disposal', () => {
  it('a disposed schedule no longer runs', async () => {
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    const off = await background.schedule('rescan', 30, task)
    off()

    clock.advanceMinutes(31)
    await emitAppState('background')
    await emitAppState('active')
    expect(task).not.toHaveBeenCalled()
  })

  it('unloading the service detaches the AppState listener', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {})
    const task = vi.fn(async () => {})
    await ctx.background.schedule('rescan', 30, task)

    await fiber.dispose()
    await emitAppState('background')
    await emitAppState('active')
    expect(task).not.toHaveBeenCalled()
  })
})
