/**
 * `ctx.liveActivity` on iOS, without an iPhone.
 *
 * The native surface is a stand-in linked through the `react-native` stub's
 * module registry, so what runs here is the whole of what this package
 * actually decides: whether an island exists at all (iOS, module linked —
 * today, neither half exists, and the first two tests hold that line), which
 * of `start`/`update`/`end` a contract call becomes, and what a native
 * refusal costs. Whether the island draws is the device smoke test.
 *
 * The recorder's methods return nothing — deliberately, because "the Swift
 * side may return a promise or nothing" is half of the native contract, and
 * the void spelling is the half a hand-written mock would quietly forget.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { Platform } from 'react-native'
import { tick } from '@BBeBee/kernel/testing'
import type { LiveActivityState } from '@BBeBee/protocol'
import { LiveActivityIos, type LiveActivityNativeLike } from './index.js'

/*
 * The stub's levers reach the test through a dynamic import: the *real*
 * `react-native` types do not export them, and a static import would fail
 * typecheck against those types. The optional calls keep the file honest if
 * the levers are ever absent — the same bargain as the background service's
 * AppState levers.
 */
type ReactNativeStub = {
  __linkNativeModule?: (name: string, module: unknown) => void
  __resetNativeModulesForTests?: () => void
}

async function linkNative(name: string, module: unknown): Promise<void> {
  const rn = (await import('react-native')) as unknown as ReactNativeStub
  rn.__linkNativeModule?.(name, module)
}

afterEach(async () => {
  // The stub's defaults, restored: every test poses as an unlinked Android
  // build unless it says otherwise.
  Platform.OS = 'android'
  const rn = (await import('react-native')) as unknown as ReactNativeStub
  rn.__resetNativeModulesForTests?.()
})

/**
 * A stand-in for the Swift object, recording what it was told. `fail` names
 * the verbs that refuse — a native side in an unknown state, which is what
 * the service must survive.
 */
function recorder(fail: readonly ('start' | 'update' | 'end')[] = []) {
  const calls: { verb: 'start' | 'update' | 'end'; state?: LiveActivityState }[] = []
  const native: LiveActivityNativeLike = {
    start(state) {
      calls.push({ verb: 'start', state })
      if (fail.includes('start')) throw new Error('ActivityKit is unavailable')
    },
    update(state) {
      calls.push({ verb: 'update', state })
      if (fail.includes('update')) throw new Error('ActivityKit is unavailable')
    },
    end() {
      calls.push({ verb: 'end' })
      if (fail.includes('end')) throw new Error('ActivityKit is unavailable')
    },
  }
  return { native, calls, verbs: () => calls.map((c) => c.verb) }
}

/** A published track, in the shape the contract fixes. */
function aState(over: Partial<LiveActivityState> = {}): LiveActivityState {
  return {
    title: 'Jóga',
    artist: 'Björk',
    artworkUri: 'file:///cache/covers/joga.jpg',
    status: 'playing',
    positionMs: 30_000,
    durationMs: 303_000,
    ...over,
  }
}

async function harness() {
  const ctx = new Context()
  /*
   * Warnings are captured through cordis's exporter API: the service logs
   * through its scoped context, and an exporter sits under every
   * `logger.warn` regardless of which context makes it. `warns` is what the
   * "warn once, then silent" contract is asserted against.
   */
  const warns: string[] = []
  ctx.logger.exporter({
    export(message) {
      if (message.type === 'warn') warns.push(message.args.map(String).join(' '))
    },
  })
  const fiber = await ctx.plugin(LiveActivityIos)
  await tick()
  return { ctx, fiber, warns, service: ctx.liveActivity as LiveActivityIos }
}

/** Pose as an iPhone — with the Swift object linked when one is given. */
async function iphone(native?: LiveActivityNativeLike) {
  Platform.OS = 'ios'
  if (native) await linkNative('BBeBeeLiveActivity', native)
  return harness()
}

describe('whether there is an island at all', () => {
  it('is not supported on android, and nothing reaches native', async () => {
    // The module *is* linked here, on purpose: the gate under test is the OS
    // check, not the accident of the module being absent as well.
    const rec = recorder()
    Platform.OS = 'android'
    await linkNative('BBeBeeLiveActivity', rec.native)
    const h = await harness()

    expect(h.service.supported).toBe(false)
    await h.service.start(aState())
    await h.service.update(aState())
    await h.service.end()
    expect(rec.calls).toEqual([])
  })

  it('is not supported on iOS without the native module, and does not crash', async () => {
    const h = await iphone()
    expect(h.service.supported).toBe(false)

    // Today's state on every build: each method resolves as a no-op rather
    // than throwing, so a caller written against the contract runs unchanged.
    await expect(h.service.start(aState())).resolves.toBeUndefined()
    await expect(h.service.update(aState())).resolves.toBeUndefined()
    await expect(h.service.end()).resolves.toBeUndefined()
    expect(h.warns).toEqual([])
  })
})

describe('what reaches the OS', () => {
  it('records the start state verbatim', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)
    const state = aState()

    await h.service.start(state)

    // Verbatim: the caller's object, unmoved — no copied fields, no
    // synthesized defaults, optionals absent by their absence. The Swift
    // side and the caller must agree on what the state means.
    expect(rec.calls[0]?.state).toBe(state)
    expect(rec.calls[0]).toEqual({ verb: 'start', state })
  })

  it('runs start → update → end as three native verbs', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)

    await h.service.start(aState())
    await h.service.update(aState({ positionMs: 60_000, status: 'paused' }))
    await h.service.end()

    expect(rec.verbs()).toEqual(['start', 'update', 'end'])
    expect(rec.calls[1]?.state).toMatchObject({ positionMs: 60_000, status: 'paused' })
  })

  it('treats an update before any start as a start', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)

    // The player publishes state the same way on either side of a track
    // boundary; "the island was not up yet" must not drop the first paint.
    await h.service.update(aState())

    expect(rec.verbs()).toEqual(['start'])
  })

  it('ends nothing when nothing is live, and ends an activity exactly once', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)

    await h.service.end()
    expect(rec.calls).toEqual([])

    await h.service.start(aState())
    await h.service.end()
    await h.service.end()
    expect(rec.verbs()).toEqual(['start', 'end'])
  })

  it('collapses a double start into one native start and one update', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)

    await h.service.start(aState({ title: 'Jóga' }))
    await h.service.start(aState({ title: 'Bachelorette' }))

    // ActivityKit has no "replace"; two starts would be an error on device,
    // and ending one island to begin an identical other would blink it.
    expect(rec.verbs()).toEqual(['start', 'update'])
    expect(rec.calls[1]?.state).toMatchObject({ title: 'Bachelorette' })
  })
})

describe('when the native side refuses', () => {
  it('warns once, then stays silent and unavailable', async () => {
    const rec = recorder(['start', 'update', 'end'])
    const h = await iphone(rec.native)

    await h.service.start(aState())
    expect(h.warns).toHaveLength(1)
    expect(h.service.supported).toBe(false)

    await h.service.update(aState())
    await h.service.end()
    await h.service.start(aState())

    // The refusal was the last native call, and the last word was the warn:
    // a session that lost its island once must not log-spam about it.
    expect(rec.verbs()).toEqual(['start'])
    expect(h.warns).toHaveLength(1)
  })
})

describe('disposal', () => {
  it('ends a running activity on unload', async () => {
    const rec = recorder()
    const h = await iphone(rec.native)
    await h.service.start(aState())

    await h.fiber.dispose()
    await tick()

    expect(rec.verbs()).toEqual(['start', 'end'])
  })

  it('leaves nothing pending when the native end refuses during disposal', async () => {
    const rec = recorder(['end'])
    const h = await iphone(rec.native)
    await h.service.start(aState())

    // The disposer's `end()` rejects — fire-and-forget, but caught: an
    // unhandled rejection here would fail the run, and the one warn is all
    // the session ever hears about it.
    await h.fiber.dispose()
    await tick()

    expect(rec.verbs()).toEqual(['start', 'end'])
    expect(h.warns).toHaveLength(1)
  })
})
