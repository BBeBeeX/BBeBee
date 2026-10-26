/**
 * `plugin-car-mode` as a plugin and as a state machine.
 *
 * The machine is the product here, so its edges are pinned one by one: the
 * enable gate, trigger-scoped deactivation, the event payload on every real
 * transition, the charging proxy, and the optional integrations (haptics,
 * store) that must neither fire nor crash when absent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import type { CarModeTrigger } from '@BBeBee/protocol'
import plugin from './index.js'
import { CAR_MODE_ROUTES } from './views.js'

/* ── service doubles ────────────────────────────────────────────────────── */

/** `ctx.ui`, as far as this plugin is concerned: a place to contribute. */
class UiStub extends Service {
  readonly contributed: { id: string; path?: string; kind: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  contribute(c: { kind: string; id: string; path?: string }) {
    this.contributed.push({ kind: c.kind, id: c.id, ...(c.path ? { path: c.path } : {}) })
    return () => {}
  }
}

/** `ctx.haptics` — records every cue it is asked for. */
class HapticsStub extends Service {
  readonly calls: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'haptics')
  }

  get enabled() {
    return true
  }

  setEnabled() {}
  impact(style?: string) {
    this.calls.push(`impact:${style ?? 'light'}`)
  }
  notification(type?: string) {
    this.calls.push(`notification:${type ?? 'success'}`)
  }
  selection() {
    this.calls.push('selection')
  }
  tap() {
    this.calls.push('tap')
  }
}

/** `ctx.device` — a battery the test flips by hand. */
class DeviceStub extends Service {
  batteryState: { level: number; charging: boolean } | undefined = { level: 0.8, charging: false }

  constructor(ctx: Context) {
    super(ctx, 'device')
  }

  battery = async () => this.batteryState
}

/** `ctx.store` — an in-memory KV, so persistence is observable. */
class StoreStub extends Service {
  readonly map = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'store')
  }

  get = async <T>(key: string) => this.map.get(key) as T | undefined
  set = async (key: string, value: unknown) => {
    this.map.set(key, value)
  }
  delete = async (key: string) => {
    this.map.delete(key)
  }
  keys = async (prefix?: string) =>
    [...this.map.keys()].filter((key) => !prefix || key.startsWith(prefix))
  namespace = () => this as never
}

/* ── harness ────────────────────────────────────────────────────────────── */

interface HarnessOptions {
  ui?: boolean
  haptics?: boolean
  device?: boolean
  store?: boolean
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  const events: Array<[boolean, CarModeTrigger | undefined]> = []
  ctx.on('car-mode/changed', (active, trigger) => events.push([active, trigger]))

  if (options.ui !== false) await ctx.plugin(UiStub)
  if (options.haptics) await ctx.plugin(HapticsStub)
  if (options.device) await ctx.plugin(DeviceStub)
  if (options.store) await ctx.plugin(StoreStub)

  const fiber = await ctx.plugin(plugin)
  await tick()

  return {
    ctx,
    fiber,
    events,
    ui: options.ui === false ? undefined : (ctx.ui as unknown as UiStub),
    haptics: options.haptics ? (ctx.haptics as unknown as HapticsStub) : undefined,
    device: options.device ? (ctx.device as unknown as DeviceStub) : undefined,
    store: options.store ? (ctx.store as unknown as StoreStub) : undefined,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* ── the plugin ─────────────────────────────────────────────────────────── */

describe('plugin-car-mode', () => {
  it('contributes the car-mode route once the ui registry is up', async () => {
    const { ui } = await harness()
    expect(ui?.contributed).toEqual([
      { kind: 'route', id: CAR_MODE_ROUTES.carMode, path: '/car-mode' },
    ])
  })

  it('loads with no ui registry at all, contributing nothing', async () => {
    const { ctx } = await harness({ ui: false })
    expect(ctx.carMode).toBeDefined()
  })

  it('claims ctx.carMode and starts from the default switches', async () => {
    const { ctx } = await harness()
    expect(ctx.carMode.enabled).toBe(true)
    expect(ctx.carMode.autoOnCharging).toBe(false)
    expect(ctx.carMode.active).toBe(false)
    expect(ctx.carMode.trigger).toBeUndefined()
  })
})

/* ── the state machine ──────────────────────────────────────────────────── */

describe('car-mode state machine', () => {
  it('activate is a no-op while the master switch is off', async () => {
    const { ctx, events } = await harness()
    ctx.carMode.setEnabled(false)
    expect(events).toEqual([]) // turning the switch off alone is no transition

    ctx.carMode.activate('manual')
    expect(ctx.carMode.active).toBe(false)
    expect(ctx.carMode.trigger).toBeUndefined()
    expect(events).toEqual([])
  })

  it('deactivate only lands when it names the active trigger', async () => {
    const { ctx, events } = await harness()
    ctx.carMode.activate('manual')

    // Charging ending must not kill a manually-enabled car mode.
    ctx.carMode.deactivate('charging')
    expect(ctx.carMode.active).toBe(true)
    expect(events).toEqual([[true, 'manual']])

    ctx.carMode.deactivate('manual')
    expect(ctx.carMode.active).toBe(false)
    expect(ctx.carMode.trigger).toBeUndefined()
    expect(events).toEqual([
      [true, 'manual'],
      [false, undefined],
    ])
  })

  it('emits the (active, trigger) pair on real transitions only', async () => {
    const { ctx, events } = await harness()

    ctx.carMode.activate('manual')
    expect(events).toEqual([[true, 'manual']])

    // Same trigger again: nothing visible moved, nothing emitted.
    ctx.carMode.activate('manual')
    expect(events).toEqual([[true, 'manual']])

    // A different trigger takes over: still active, but the pair changed.
    ctx.carMode.activate('charging')
    expect(ctx.carMode.active).toBe(true)
    expect(ctx.carMode.trigger).toBe('charging')
    expect(events).toEqual([
      [true, 'manual'],
      [true, 'charging'],
    ])

    // Deactivate with a stale trigger is not a transition.
    ctx.carMode.deactivate('manual')
    expect(ctx.carMode.active).toBe(true)

    ctx.carMode.deactivate('charging')
    expect(events).toEqual([
      [true, 'manual'],
      [true, 'charging'],
      [false, undefined],
    ])

    // Deactivate while inactive is a no-op.
    ctx.carMode.deactivate('manual')
    expect(events).toHaveLength(3)
  })

  it('setEnabled(false) ends an active mode; re-enabling does not restart it', async () => {
    const { ctx, events } = await harness()
    ctx.carMode.activate('manual')

    ctx.carMode.setEnabled(false)
    expect(ctx.carMode.active).toBe(false)
    expect(ctx.carMode.trigger).toBeUndefined()
    expect(events).toEqual([
      [true, 'manual'],
      [false, undefined],
    ])

    ctx.carMode.setEnabled(true)
    expect(ctx.carMode.active).toBe(false)
    expect(events).toHaveLength(2)
  })
})

/* ── the charging proxy ─────────────────────────────────────────────────── */

describe('car-mode charging proxy', () => {
  it('enters on a charging flip and leaves when charging ends', async () => {
    const { ctx, device, events } = await harness({ device: true })
    ctx.carMode.setAutoOnCharging(true)

    device!.batteryState = { level: 0.9, charging: true }
    ctx.emit('lifecycle/phase-changed', 'active', 'background')
    await tick()
    expect(ctx.carMode.active).toBe(true)
    expect(ctx.carMode.trigger).toBe('charging')
    expect(events).toEqual([[true, 'charging']])

    device!.batteryState = { level: 0.5, charging: false }
    ctx.emit('lifecycle/phase-changed', 'active', 'background')
    await tick()
    expect(ctx.carMode.active).toBe(false)
    expect(events).toEqual([
      [true, 'charging'],
      [false, undefined],
    ])
  })

  it('ignores the battery while autoOnCharging is off', async () => {
    const { ctx, device, events } = await harness({ device: true })
    device!.batteryState = { level: 0.9, charging: true }
    ctx.emit('lifecycle/phase-changed', 'active', 'background')
    await tick()
    expect(ctx.carMode.active).toBe(false)
    expect(events).toEqual([])
  })

  it('does not act on non-active phases', async () => {
    const { ctx, device } = await harness({ device: true })
    ctx.carMode.setAutoOnCharging(true)
    device!.batteryState = { level: 0.9, charging: true }
    ctx.emit('lifecycle/phase-changed', 'background', 'active')
    await tick()
    expect(ctx.carMode.active).toBe(false)
  })
})

/* ── the optional integrations ──────────────────────────────────────────── */

describe('car-mode integrations', () => {
  it('fires the success haptic on activation when the service is present', async () => {
    const { ctx, haptics } = await harness({ haptics: true })
    ctx.carMode.activate('manual')
    expect(haptics?.calls).toEqual(['notification:success'])

    // A trigger take-over is not an activation: one cue per activation.
    ctx.carMode.activate('charging')
    expect(haptics?.calls).toEqual(['notification:success'])
  })

  it('activates without a crash when no haptics service exists', async () => {
    const { ctx } = await harness()
    expect(() => ctx.carMode.activate('manual')).not.toThrow()
    expect(ctx.carMode.active).toBe(true)
  })

  it('persists the switches and restores them on the next load', async () => {
    const first = await harness({ store: true })
    first.ctx.carMode.setAutoOnCharging(true)
    first.ctx.carMode.setEnabled(false)
    await tick()
    expect(first.store?.map.get('car-mode.config')).toEqual({
      enabled: false,
      autoOnCharging: true,
    })
    await first.fiber.dispose()

    // A second context with the same store contents restores both switches.
    const ctx = new Context()
    await ctx.plugin(StoreStub)
    ;(ctx.store as unknown as StoreStub).map.set('car-mode.config', {
      enabled: false,
      autoOnCharging: true,
    })
    const fiber = await ctx.plugin(plugin)
    await tick()
    expect(ctx.carMode.enabled).toBe(false)
    expect(ctx.carMode.autoOnCharging).toBe(true)
    // The gate holds from the first moment: a restored "off" means activate
    // is inert until something re-enables the mode.
    ctx.carMode.activate('manual')
    expect(ctx.carMode.active).toBe(false)
    await fiber.dispose()
  })

  it('runs in-memory with no store at all', async () => {
    const { ctx } = await harness()
    expect(() => ctx.carMode.setEnabled(false)).not.toThrow()
    expect(ctx.carMode.enabled).toBe(false)
  })
})

/* ── logging & lifecycle ────────────────────────────────────────────────── */

describe('car-mode logging and lifecycle', () => {
  it('logs transitions through ctx.logger', async () => {
    const { ctx } = await harness()
    const info = vi.spyOn(ctx.logger, 'info')
    ctx.carMode.activate('manual')
    ctx.carMode.deactivate('manual')
    expect(info.mock.calls.flat().some((entry) => String(entry).includes('car-mode'))).toBe(true)
  })

  it('snapshots clean after unload, with every integration present', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(HapticsStub)
    await ctx.plugin(DeviceStub)
    await ctx.plugin(StoreStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    ctx.carMode.activate('manual')
    ctx.emit('lifecycle/phase-changed', 'active', 'background')
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('snapshots clean after unload when no dependency ever appeared', async () => {
    const ctx = new Context()
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
