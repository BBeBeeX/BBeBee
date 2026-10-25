/**
 * `ctx.background` on desktop.
 *
 * The interesting behaviour is all about *not leaking*: a wake lock that
 * outlives its owner keeps the machine awake with nothing left to release it,
 * and a suspend listener that throws must not stop the next one from saving
 * its state — on the other platform there may be no later.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { BridgeEvent } from '@bbebee/core-desktop-bridge'
import plugin, { BackgroundTauri } from './index.js'

function fakeBridge() {
  const calls: { method: string; args: unknown[] }[] = []
  const subscribers = new Set<(e: BridgeEvent) => void>()
  return {
    calls,
    push(event: BridgeEvent) {
      for (const cb of [...subscribers]) cb(event)
    },
    api: {
      call: async (_s: string, method: string, args: unknown[]) => {
        calls.push({ method, args })
        return undefined
      },
      streamOpen: async () => 0,
      streamPull: async () => null,
      streamClose: async () => undefined,
      txBegin: async () => 't',
      txEnd: async () => undefined,
      on: (handler: (e: BridgeEvent) => void) => {
        subscribers.add(handler)
        return () => void subscribers.delete(handler)
      },
    },
  }
}

/** A controllable clock, so a schedule test does not wait real minutes. */
function fakeTimers() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  return {
    timers,
    tick(id: number) {
      timers.get(id)?.fn()
    },
    setInterval: (fn: () => void, ms: number) => {
      const id = next++
      timers.set(id, { fn, ms })
      return id
    },
    clearInterval: (handle: unknown) => void timers.delete(handle as number),
  }
}

async function harness() {
  const bridge = fakeBridge()
  const clock = fakeTimers()
  const ctx = new Context()
  await ctx.plugin(BackgroundTauri, {
    bridge: bridge.api as never,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  })
  return { ctx, bridge, clock, background: ctx.background as BackgroundTauri }
}

describe('canRunInBackground', () => {
  it('is true on desktop, where a hidden window still runs', async () => {
    const { background } = await harness()
    expect(background.canRunInBackground()).toBe(true)
  })
})

describe('wake locks', () => {
  it('asks main to hold the machine awake, and releases on dispose', async () => {
    const { background, bridge } = await harness()
    const release = await background.acquireWakeLock('playing')
    expect(bridge.calls.filter((c) => c.method === 'acquireWakeLock')).toHaveLength(1)
    expect(background.heldLocks).toEqual(['playing'])

    release()
    await Promise.resolve()
    expect(bridge.calls.filter((c) => c.method === 'releaseWakeLock')).toHaveLength(1)
    expect(background.heldLocks).toEqual([])
  })

  it('is idempotent, so a double release cannot free another lock', async () => {
    // Ids are recycled; a disposer called twice must not reach past its own.
    const { background, bridge } = await harness()
    const release = await background.acquireWakeLock('a')
    release()
    release()
    await Promise.resolve()
    expect(bridge.calls.filter((c) => c.method === 'releaseWakeLock')).toHaveLength(1)
  })

  it('tracks several locks independently', async () => {
    const { background } = await harness()
    const a = await background.acquireWakeLock('playing')
    await background.acquireWakeLock('downloading')
    expect([...background.heldLocks].sort()).toEqual(['downloading', 'playing'])

    a()
    await Promise.resolve()
    expect(background.heldLocks).toEqual(['downloading'])
  })

  it('releases everything still held when unloaded', async () => {
    // A leaked lock keeps the machine awake forever with nothing left to
    // release it — the one leak here with a user-visible cost.
    const bridge = fakeBridge()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { bridge: bridge.api as never })
    await ctx.background.acquireWakeLock('playing')
    await ctx.background.acquireWakeLock('scanning')

    await fiber.dispose()
    expect(bridge.calls.filter((c) => c.method === 'releaseWakeLock')).toHaveLength(2)
  })

  it('keeps playing when the host refuses a blocker', async () => {
    const ctx = new Context()
    await ctx.plugin(BackgroundTauri, {
      bridge: {
        call: async (_s: string, method: string) => {
          if (method === 'acquireWakeLock') throw new Error('refused')
          return undefined
        },
        on: () => () => {},
      } as never,
    })
    await expect(ctx.background.acquireWakeLock('playing')).resolves.toBeTypeOf('function')
  })
})

describe('schedule', () => {
  it('runs the task on its interval', async () => {
    const { background, clock } = await harness()
    const task = vi.fn(async () => {})
    await background.schedule('rescan', 30, task)

    const [id, timer] = [...clock.timers.entries()][0]!
    expect(timer.ms, '30 minutes in ms').toBe(30 * 60_000)
    clock.tick(id)
    expect(task).toHaveBeenCalledOnce()
  })

  it('replaces a schedule registered under the same id', async () => {
    const { background, clock } = await harness()
    await background.schedule('rescan', 30, async () => {})
    await background.schedule('rescan', 60, async () => {})
    expect(clock.timers.size, 'the first timer was cleared').toBe(1)
  })

  it('stops when disposed', async () => {
    const { background, clock } = await harness()
    const off = await background.schedule('rescan', 30, async () => {})
    off()
    expect(clock.timers.size).toBe(0)
  })

  it('survives a task that rejects', async () => {
    // A failing scan must not stop the next one from being attempted.
    const { background, clock } = await harness()
    await background.schedule('rescan', 30, async () => {
      throw new Error('disk went away')
    })
    const [id] = [...clock.timers.keys()]
    expect(() => clock.tick(id!)).not.toThrow()
  })

  it('clears every timer when unloaded', async () => {
    const clock = fakeTimers()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })
    await ctx.background.schedule('a', 5, async () => {})
    await ctx.background.schedule('b', 5, async () => {})
    await fiber.dispose()
    expect(clock.timers.size).toBe(0)
  })
})

describe('onWillSuspend', () => {
  it('fires every listener when main reports a suspend', async () => {
    const { background, bridge } = await harness()
    const a = vi.fn()
    const b = vi.fn()
    background.onWillSuspend(a)
    background.onWillSuspend(b)

    bridge.push({ topic: 'will-suspend' })
    await Promise.resolve()
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it('awaits an async checkpoint', async () => {
    // The player persists here, and on mobile there may be no later.
    const { background } = await harness()
    let finished = false
    background.onWillSuspend(async () => {
      await Promise.resolve()
      finished = true
    })
    await background.simulateSuspend()
    expect(finished).toBe(true)
  })

  it('runs the rest when one listener throws', async () => {
    const { background } = await harness()
    const saved = vi.fn()
    background.onWillSuspend(() => {
      throw new Error('boom')
    })
    background.onWillSuspend(saved)
    await background.simulateSuspend()
    expect(saved).toHaveBeenCalledOnce()
  })

  it('stops calling a disposed listener', async () => {
    const { background } = await harness()
    const cb = vi.fn()
    background.onWillSuspend(cb)()
    await background.simulateSuspend()
    expect(cb).not.toHaveBeenCalled()
  })
})
