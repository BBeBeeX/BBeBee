/**
 * `core-lifecycle-mobile` against the `AppState` and splash-screen stubs.
 *
 * The tests drive the OS the way it delivers status changes — one
 * `__emitAppState` per event — and read the splash through `__state()`, whose
 * `hideWithoutPrevent` bit is the ordering the whole splash policy exists to
 * guarantee: never hidden before the app said it was ready, and never hidden
 * before the prevent settled.
 *
 * `react-native` and `expo-splash-screen` are aliased in `vitest.config.ts`;
 * the splash stub mirrors the SDK's top-level exports, so the service's
 * imports reach it unchanged, and the levers are reached through the package
 * name — as in `core-haptics-mobile`'s tests — rather than a path crossing
 * this package's root. The one thing the stub cannot do on its own is fail,
 * and half this service's contract is about failure — those cases script
 * rejections with `vi.spyOn`, because a stub that cannot fail cannot prove
 * the boot survives a splash module that argues.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { LifecyclePhase } from '@BBeBee/protocol'
import { LifecycleExpo } from './index.js'

type AppStateStub = {
  __emitAppState?: (status: 'active' | 'inactive' | 'background') => void
  __resetAppStateForTests?: () => void
}

type SplashStub = {
  preventAutoHideAsync(): Promise<boolean>
  hideAsync(): Promise<void>
  __state(): { readonly prevented: boolean; readonly hidden: boolean; readonly hideWithoutPrevent: boolean }
  __resetForTests(): void
}

async function appState(): Promise<AppStateStub> {
  return (await import('react-native')) as unknown as AppStateStub
}

async function splash(): Promise<SplashStub> {
  return (await import('expo-splash-screen')) as unknown as SplashStub
}

async function emitAppState(status: 'active' | 'inactive' | 'background'): Promise<void> {
  const rn = await appState()
  rn.__emitAppState?.(status)
  /*
   * The OS delivers the event and does not wait for the work. Two macrotask
   * boundaries drain everything the tick spawns — including the splash
   * promises' catch handlers — so assertions observe finished work rather
   * than winning a race by accident (same settling as the background
   * service's tests).
   */
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function harness() {
  const ctx = new Context()
  const fiber = await ctx.plugin(LifecycleExpo)
  return { ctx, fiber, lifecycle: ctx.lifecycle }
}

beforeEach(async () => {
  vi.clearAllMocks()
  ;(await appState()).__resetAppStateForTests?.()
  ;(await splash()).__resetForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('initial state', () => {
  it('reads the phase from AppState.currentState at init', async () => {
    // Pose as a process the OS woke while backgrounded — Android can launch
    // straight into the background for a background task.
    const rn = await appState()
    rn.__emitAppState?.('background')

    const { lifecycle } = await harness()
    expect(lifecycle.phase).toBe('background')
    expect(lifecycle.launchKind).toBe('cold')
  })

  it('starts active and cold on a normal launch', async () => {
    const { lifecycle } = await harness()
    expect(lifecycle.phase).toBe('active')
    expect(lifecycle.launchKind).toBe('cold')
  })
})

describe('phase transitions', () => {
  it('emits the event and the callbacks with (phase, previous) pairs', async () => {
    const { ctx, lifecycle } = await harness()
    const seen: Array<[LifecyclePhase, LifecyclePhase]> = []
    const event = vi.fn((phase: LifecyclePhase, previous: LifecyclePhase) => {
      seen.push([phase, previous])
    })
    const callback = vi.fn((phase: LifecyclePhase, previous: LifecyclePhase) => {
      seen.push([phase, previous])
    })
    ctx.on('lifecycle/phase-changed', event)
    lifecycle.onPhaseChange(callback)

    await emitAppState('inactive')
    await emitAppState('background')

    expect(seen).toEqual([
      ['inactive', 'active'],
      ['inactive', 'active'],
      ['background', 'inactive'],
      ['background', 'inactive'],
    ])
    expect(lifecycle.phase).toBe('background')
  })

  it('drops a status that does not change the phase', async () => {
    const { ctx, lifecycle } = await harness()
    const event = vi.fn()
    const callback = vi.fn()
    ctx.on('lifecycle/phase-changed', event)
    lifecycle.onPhaseChange(callback)

    await emitAppState('active')
    expect(event).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(lifecycle.phase).toBe('active')
  })

  it('stops a disposed callback without disturbing the others', async () => {
    const { lifecycle } = await harness()
    const kept = vi.fn()
    const dropped = vi.fn()
    const off = lifecycle.onPhaseChange(dropped)
    lifecycle.onPhaseChange(kept)

    off()
    await emitAppState('inactive')
    expect(dropped).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledWith('inactive', 'active')
  })
})

describe('launchKind', () => {
  it('flips to resume on background → active, and stays there', async () => {
    const { lifecycle } = await harness()

    await emitAppState('background')
    expect(lifecycle.launchKind).toBe('cold')

    await emitAppState('active')
    expect(lifecycle.launchKind).toBe('resume')

    // 'resume' is sticky: later transitions never revisit the question.
    await emitAppState('inactive')
    await emitAppState('active')
    expect(lifecycle.launchKind).toBe('resume')
  })

  it('stays cold across an inactive bounce — the app switcher, not a backgrounding', async () => {
    const { lifecycle } = await harness()
    await emitAppState('inactive')
    await emitAppState('active')
    expect(lifecycle.launchKind).toBe('cold')
  })

  it('counts a return routed through inactive as a resume', async () => {
    // iOS may deliver background → inactive → active when the app comes
    // forward via the switcher; the process was backgrounded either way.
    const { lifecycle } = await harness()
    await emitAppState('background')
    await emitAppState('inactive')
    await emitAppState('active')
    expect(lifecycle.launchKind).toBe('resume')
  })
})

describe('the splash', () => {
  it('prevents at boot, hides once, idempotently, in that order', async () => {
    const { lifecycle } = await harness()
    const hideAsync = vi.spyOn(await splash(), 'hideAsync')

    await lifecycle.hideSplash()
    await lifecycle.hideSplash()
    await lifecycle.hideSplash()

    expect(hideAsync).toHaveBeenCalledOnce()
    const state = (await splash()).__state()
    expect(state.prevented).toBe(true)
    expect(state.hidden).toBe(true)
    expect(state.hideWithoutPrevent).toBe(false)
  })

  it('survives a preventAutoHideAsync rejection: warns once, boots, still hides', async () => {
    const ctx = new Context()
    vi.spyOn(await splash(), 'preventAutoHideAsync').mockRejectedValueOnce(
      new Error('native splash module refused'),
    )
    const warn = vi.spyOn(ctx.logger, 'warn')

    const fiber = await ctx.plugin(LifecycleExpo)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('preventAutoHideAsync rejected'),
    )

    // The service is fully functional: phases still flow, the splash still
    // hides — without the prevent ever having succeeded.
    const event = vi.fn()
    ctx.on('lifecycle/phase-changed', event)
    await emitAppState('background')
    expect(event).toHaveBeenCalledWith('background', 'active')

    await ctx.lifecycle.hideSplash()
    expect((await splash()).__state().hidden).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)

    await fiber.dispose()
  })

  it('warns and resolves when hideAsync rejects', async () => {
    const { ctx, lifecycle } = await harness()
    vi.spyOn(await splash(), 'hideAsync').mockRejectedValueOnce(new Error('no splash view'))
    const warn = vi.spyOn(ctx.logger, 'warn')

    await expect(lifecycle.hideSplash()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hideAsync rejected'))
  })
})

describe('disposal', () => {
  it('after the fiber is disposed, AppState events fire nothing further', async () => {
    const { ctx, fiber, lifecycle } = await harness()
    const event = vi.fn()
    const callback = vi.fn()
    ctx.on('lifecycle/phase-changed', event)
    lifecycle.onPhaseChange(callback)

    await fiber.dispose()
    await emitAppState('background')
    await emitAppState('active')

    expect(event).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })
})
