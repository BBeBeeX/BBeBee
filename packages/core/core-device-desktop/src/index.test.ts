/**
 * `ctx.device` on desktop, against a fake navigator and a fake bridge.
 *
 * The behaviour worth pinning is not "does it read navigator.onLine" — it is
 * what happens when the OS does not answer: no `connection`, no battery, no
 * bridge. Every one of those is normal on some desktop, and each used to be a
 * different way to fail a boot.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { BridgeEvent } from '@bbebee/core-desktop-bridge'
import plugin, {
  DeviceTauri,
  type BatteryLike,
  type NavigatorLike,
} from './index.js'

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    listeners,
    fire(type: string) {
      for (const cb of [...(listeners.get(type) ?? [])]) cb()
    },
    target: {
      addEventListener(type: string, cb: () => void) {
        const bucket = listeners.get(type) ?? new Set()
        bucket.add(cb)
        listeners.set(type, bucket)
      },
      removeEventListener(type: string, cb: () => void) {
        listeners.get(type)?.delete(cb)
      },
    },
  }
}

function fakeBridge() {
  const calls: { method: string; args: unknown[] }[] = []
  const subscribers = new Set<(e: BridgeEvent) => void>()
  return {
    calls,
    subscribers,
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

async function harness(nav: NavigatorLike = {}) {
  const win = fakeWindow()
  const bridge = fakeBridge()
  const ctx = new Context()
  await ctx.plugin(DeviceTauri, {
    navigator: nav,
    window: win.target,
    bridge: bridge.api as never,
    appVersion: '1.2.3',
    platform: 'linux',
  })
  return { ctx, win, bridge, device: ctx.device as DeviceTauri }
}

describe('identity', () => {
  it('reports a desktop form factor and its version', async () => {
    const { device } = await harness()
    expect(device.formFactor).toBe('desktop')
    expect(device.appVersion).toBe('1.2.3')
    expect(device.platform).toBe('linux')
  })

  it('falls back to a usable locale when the host has none', async () => {
    const { device } = await harness({})
    expect(device.locale).toBe('en')
  })
})

describe('network', () => {
  it('reports offline', async () => {
    const { device } = await harness({ onLine: false })
    await expect(device.network()).resolves.toMatchObject({ online: false })
  })

  it('treats an explicit data-saver as metered', async () => {
    // This is where StreamPrefs.saveData comes from, and it gates downloads.
    const { device } = await harness({ onLine: true, connection: { saveData: true } })
    await expect(device.network()).resolves.toMatchObject({ metered: true })
  })

  it('treats cellular as metered even without data-saver', async () => {
    const { device } = await harness({ onLine: true, connection: { type: 'cellular' } })
    await expect(device.network()).resolves.toMatchObject({ metered: true, type: 'cellular' })
  })

  it('is not metered on ordinary wifi', async () => {
    const { device } = await harness({ onLine: true, connection: { type: 'wifi' } })
    await expect(device.network()).resolves.toMatchObject({ metered: false, type: 'wifi' })
  })

  it('answers without a connection object at all', async () => {
    // Most desktops have no navigator.connection. Assuming metered there
    // would refuse every download on a machine with a cable in it.
    const { device } = await harness({ onLine: true })
    await expect(device.network()).resolves.toEqual({
      online: true,
      type: 'unknown',
      metered: false,
    })
  })

  it('notifies on online and offline transitions', async () => {
    const nav: NavigatorLike = { onLine: true }
    const { device, win } = await harness(nav)
    const seen: boolean[] = []
    device.onNetworkChange((s) => void seen.push(s.online))

    nav.onLine = false
    win.fire('offline')
    await Promise.resolve()
    nav.onLine = true
    win.fire('online')
    await Promise.resolve()

    expect(seen).toEqual([false, true])
  })

  it('notifies when the connection changes from unmetered to metered', async () => {
    const listeners = new Set<() => void>()
    const connection = {
      type: 'wifi',
      saveData: false,
      addEventListener: (_t: string, cb: () => void) => void listeners.add(cb),
      removeEventListener: (_t: string, cb: () => void) => void listeners.delete(cb),
    }
    const { device } = await harness({ onLine: true, connection })
    const seen: boolean[] = []
    device.onNetworkChange((s) => void seen.push(s.metered))

    connection.saveData = true
    for (const cb of listeners) cb()
    await Promise.resolve()
    expect(seen).toEqual([true])
  })

  it('stops notifying once the listener is disposed', async () => {
    const { device, win } = await harness({ onLine: true })
    const cb = vi.fn()
    const off = device.onNetworkChange(cb)
    off()
    win.fire('offline')
    await Promise.resolve()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('battery', () => {
  it('is undefined where there is no battery', async () => {
    // "There is no battery" is a real answer on a desktop, not a failure.
    const { device } = await harness({})
    await expect(device.battery()).resolves.toBeUndefined()
  })

  it('reports level and charging when the host has one', async () => {
    const battery: BatteryLike = { level: 0.42, charging: true }
    const { device } = await harness({ getBattery: async () => battery })
    await expect(device.battery()).resolves.toEqual({ level: 0.42, charging: true })
  })

  it('survives a host that rejects the request', async () => {
    const { device } = await harness({
      getBattery: async () => {
        throw new Error('blocked by policy')
      },
    })
    await expect(device.battery()).resolves.toBeUndefined()
  })
})

describe('media keys', () => {
  it('delivers a key pressed in main', async () => {
    const { device, bridge } = await harness()
    const seen: string[] = []
    device.onMediaKey((key) => void seen.push(key))

    bridge.push({ topic: 'media-key', key: 'play-pause' })
    bridge.push({ topic: 'media-key', key: 'next' })
    expect(seen).toEqual(['play-pause', 'next'])
  })

  it('asks main to watch only while someone is listening', async () => {
    const { device, bridge } = await harness()
    const off = device.onMediaKey(() => {})
    expect(bridge.calls.filter((c) => c.method === 'watchMediaKeys')).toHaveLength(1)

    off()
    const watch = bridge.calls.filter((c) => c.method === 'watchMediaKeys')
    expect(watch.at(-1)!.args).toEqual([false])
  })

  it('keeps watching while a second listener remains', async () => {
    const { device, bridge } = await harness()
    const offA = device.onMediaKey(() => {})
    device.onMediaKey(() => {})
    offA()

    const stops = bridge.calls.filter(
      (c) => c.method === 'watchMediaKeys' && c.args[0] === false,
    )
    expect(stops, 'the surviving listener still needs the keys').toHaveLength(0)
  })
})

describe('hotkeys', () => {
  it('registers with main and fires on a press', async () => {
    const { device, bridge } = await harness()
    const cb = vi.fn()
    device.registerHotkey('CommandOrControl+Alt+P', cb)

    expect(bridge.calls.some((c) => c.method === 'registerHotkey')).toBe(true)
    bridge.push({ topic: 'hotkey', accelerator: 'CommandOrControl+Alt+P' })
    expect(cb).toHaveBeenCalledOnce()
  })

  it('refcounts one accelerator across callers', async () => {
    // Two plugins binding MediaPlayPause: the first disposal must not silently
    // unbind the second.
    const { device, bridge } = await harness()
    const a = vi.fn()
    const b = vi.fn()
    const offA = device.registerHotkey('MediaPlayPause', a)
    device.registerHotkey('MediaPlayPause', b)

    expect(bridge.calls.filter((c) => c.method === 'registerHotkey')).toHaveLength(1)
    offA()
    expect(bridge.calls.filter((c) => c.method === 'unregisterHotkey')).toHaveLength(0)

    bridge.push({ topic: 'hotkey', accelerator: 'MediaPlayPause' })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  it('releases the accelerator in main when the last caller goes', async () => {
    const { device, bridge } = await harness()
    const off = device.registerHotkey('MediaNextTrack', () => {})
    off()
    expect(bridge.calls.filter((c) => c.method === 'unregisterHotkey')).toHaveLength(1)
  })

  it('survives an accelerator another application already owns', async () => {
    // A refused registration is a normal outcome, not something the caller
    // can act on — it must not reject.
    const ctx = new Context()
    await ctx.plugin(DeviceTauri, {
      navigator: {},
      bridge: {
        call: async (_s: string, method: string) => {
          if (method === 'registerHotkey') throw new Error('already registered')
          return undefined
        },
        on: () => () => {},
      } as never,
    })
    expect(() => ctx.device.registerHotkey('MediaPlayPause', () => {})).not.toThrow()
  })
})

describe('lifecycle', () => {
  it('releases every accelerator it took when unloaded', async () => {
    // Accelerators live in main; forgetting the local map leaves the next
    // launch unable to take them.
    const bridge = fakeBridge()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { navigator: {}, bridge: bridge.api as never })
    ctx.device.registerHotkey('MediaPlayPause', () => {})
    ctx.device.registerHotkey('MediaNextTrack', () => {})

    await fiber.dispose()
    const released = bridge.calls
      .filter((c) => c.method === 'unregisterHotkey')
      .map((c) => c.args[0])
    expect(released.sort()).toEqual(['MediaNextTrack', 'MediaPlayPause'])
  })

  it('stops listening to the window when unloaded', async () => {
    const win = fakeWindow()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, { navigator: {}, window: win.target })
    await fiber.dispose()

    const remaining = [...win.listeners.values()].reduce((n, set) => n + set.size, 0)
    expect(remaining).toBe(0)
  })

  it('works with no bridge at all', async () => {
    // A renderer whose preload failed still boots; it just has no media keys.
    const ctx = new Context()
    await ctx.plugin(DeviceTauri, { navigator: { onLine: true } })
    await expect(ctx.device.network()).resolves.toMatchObject({ online: true })
    expect(() => ctx.device.onMediaKey(() => {})()).not.toThrow()
  })
})
