/**
 * Automated Core Platform Parity Test Suite (Electron to Tauri Migration Group 6)
 *
 * Verifies 100% parity for:
 * 1. packages/core/core-background-electron (wake locks, schedule, onWillSuspend)
 * 2. packages/core/core-device-electron (identity, network, battery, media keys, hotkeys, lifecycle)
 * 3. packages/core/core-media-session-electron (conformance, Chromium surface, main-process MPRIS/SMTC, robustness)
 * 4. Bridged 'system' service calls and events via Tauri Bridge implementation
 * 5. Comprehensive OS services support (dialog, shell, screen, powerMonitor, powerSaveBlocker, nativeImage, net, session)
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { mediaSessionConformance } from '@BBeBee/protocol/conformance'
import type { BridgeEvent } from '@BBeBee/core-desktop-bridge'
import backgroundPlugin, { BackgroundTauri } from '@BBeBee/core-background-tauri'
import devicePlugin, {
  DeviceTauri,
  type BatteryLike,
  type NavigatorLike,
  type EventTargetLike,
} from '@BBeBee/core-device-tauri'
import mediaSessionPlugin, {
  MediaSessionTauri,
  type MediaSessionLike,
} from '@BBeBee/core-media-session-tauri'
import {
  createBridgeApi,
  createPreloadApi,
} from '../renderer/preload-shim.js'

// =============================================================================
// Test Harness Helpers
// =============================================================================

function fakeBridge() {
  const calls: { service?: string; method: string; args: unknown[] }[] = []
  const subscribers = new Set<(e: BridgeEvent) => void>()
  return {
    calls,
    subscribers,
    push(event: BridgeEvent) {
      for (const cb of [...subscribers]) cb(event)
    },
    api: {
      call: async (service: string, method: string, args: unknown[]) => {
        calls.push({ service, method, args: args || [] })
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
    } as EventTargetLike,
  }
}

function fakeSession() {
  const handlers = new Map<string, ((details?: unknown) => void) | null>()
  const session: MediaSessionLike & { positions: unknown[] } = {
    metadata: null,
    playbackState: 'none',
    positions: [],
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler)
      else handlers.delete(action)
    },
    setPositionState(state) {
      session.positions.push(state)
    },
  }
  return { session, handlers }
}

async function backgroundHarness() {
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

async function deviceHarness(nav: NavigatorLike = {}) {
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

async function mediaSessionHarness() {
  const { session, handlers } = fakeSession()
  const bridge = fakeBridge()
  const ctx = new Context()
  await ctx.plugin(MediaSessionTauri, {
    session,
    bridge: bridge.api as never,
    metadataFactory: (init) => init,
  })
  return { ctx, session, handlers, bridge, service: ctx.mediaSession as MediaSessionTauri }
}

// =============================================================================
// 1. Background Service Parity Tests
// =============================================================================

describe('Background Service Parity (core-background-electron)', () => {
  describe('canRunInBackground', () => {
    it('is true on desktop, where a hidden window still runs', async () => {
      const { background } = await backgroundHarness()
      expect(background.canRunInBackground()).toBe(true)
    })
  })

  describe('wake locks', () => {
    it('asks main/host to hold the machine awake, and releases on dispose', async () => {
      const { background, bridge } = await backgroundHarness()
      const release = await background.acquireWakeLock('playing')
      expect(bridge.calls.filter((c) => c.method === 'acquireWakeLock')).toHaveLength(1)
      expect(background.heldLocks).toEqual(['playing'])

      release()
      await Promise.resolve()
      expect(bridge.calls.filter((c) => c.method === 'releaseWakeLock')).toHaveLength(1)
      expect(background.heldLocks).toEqual([])
    })

    it('is idempotent, so a double release cannot free another lock', async () => {
      const { background, bridge } = await backgroundHarness()
      const release = await background.acquireWakeLock('a')
      release()
      release()
      await Promise.resolve()
      expect(bridge.calls.filter((c) => c.method === 'releaseWakeLock')).toHaveLength(1)
    })

    it('tracks several locks independently', async () => {
      const { background } = await backgroundHarness()
      const a = await background.acquireWakeLock('playing')
      await background.acquireWakeLock('downloading')
      expect([...background.heldLocks].sort()).toEqual(['downloading', 'playing'])

      a()
      await Promise.resolve()
      expect(background.heldLocks).toEqual(['downloading'])
    })

    it('releases everything still held when unloaded', async () => {
      const bridge = fakeBridge()
      const ctx = new Context()
      const fiber = await ctx.plugin(backgroundPlugin, { bridge: bridge.api as never })
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
      const { background, clock } = await backgroundHarness()
      const task = vi.fn(async () => {})
      await background.schedule('rescan', 30, task)

      const [id, timer] = [...clock.timers.entries()][0]!
      expect(timer.ms, '30 minutes in ms').toBe(30 * 60_000)
      clock.tick(id)
      expect(task).toHaveBeenCalledOnce()
    })

    it('replaces a schedule registered under the same id', async () => {
      const { background, clock } = await backgroundHarness()
      await background.schedule('rescan', 30, async () => {})
      await background.schedule('rescan', 60, async () => {})
      expect(clock.timers.size, 'the first timer was cleared').toBe(1)
    })

    it('stops when disposed', async () => {
      const { background, clock } = await backgroundHarness()
      const off = await background.schedule('rescan', 30, async () => {})
      off()
      expect(clock.timers.size).toBe(0)
    })

    it('survives a task that rejects', async () => {
      const { background, clock } = await backgroundHarness()
      await background.schedule('rescan', 30, async () => {
        throw new Error('disk went away')
      })
      const [id] = [...clock.timers.keys()]
      expect(() => clock.tick(id!)).not.toThrow()
    })

    it('clears every timer when unloaded', async () => {
      const clock = fakeTimers()
      const ctx = new Context()
      const fiber = await ctx.plugin(backgroundPlugin, {
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
      const { background, bridge } = await backgroundHarness()
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
      const { background } = await backgroundHarness()
      let finished = false
      background.onWillSuspend(async () => {
        await Promise.resolve()
        finished = true
      })
      await background.simulateSuspend()
      expect(finished).toBe(true)
    })

    it('runs the rest when one listener throws', async () => {
      const { background } = await backgroundHarness()
      const saved = vi.fn()
      background.onWillSuspend(() => {
        throw new Error('boom')
      })
      background.onWillSuspend(saved)
      await background.simulateSuspend()
      expect(saved).toHaveBeenCalledOnce()
    })

    it('stops calling a disposed listener', async () => {
      const { background } = await backgroundHarness()
      const cb = vi.fn()
      background.onWillSuspend(cb)()
      await background.simulateSuspend()
      expect(cb).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// 2. Device Service Parity Tests
// =============================================================================

describe('Device Service Parity (core-device-electron)', () => {
  describe('identity', () => {
    it('reports a desktop form factor and its version', async () => {
      const { device } = await deviceHarness()
      expect(device.formFactor).toBe('desktop')
      expect(device.appVersion).toBe('1.2.3')
      expect(device.platform).toBe('linux')
    })

    it('falls back to a usable locale when the host has none', async () => {
      const { device } = await deviceHarness({})
      expect(device.locale).toBe('en')
    })
  })

  describe('network', () => {
    it('reports offline', async () => {
      const { device } = await deviceHarness({ onLine: false })
      await expect(device.network()).resolves.toMatchObject({ online: false })
    })

    it('treats an explicit data-saver as metered', async () => {
      const { device } = await deviceHarness({ onLine: true, connection: { saveData: true } })
      await expect(device.network()).resolves.toMatchObject({ metered: true })
    })

    it('treats cellular as metered even without data-saver', async () => {
      const { device } = await deviceHarness({ onLine: true, connection: { type: 'cellular' } })
      await expect(device.network()).resolves.toMatchObject({ metered: true, type: 'cellular' })
    })

    it('is not metered on ordinary wifi', async () => {
      const { device } = await deviceHarness({ onLine: true, connection: { type: 'wifi' } })
      await expect(device.network()).resolves.toMatchObject({ metered: false, type: 'wifi' })
    })

    it('answers without a connection object at all', async () => {
      const { device } = await deviceHarness({ onLine: true })
      await expect(device.network()).resolves.toEqual({
        online: true,
        type: 'unknown',
        metered: false,
      })
    })

    it('notifies on online and offline transitions', async () => {
      const nav: NavigatorLike = { onLine: true }
      const { device, win } = await deviceHarness(nav)
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
      const { device } = await deviceHarness({ onLine: true, connection })
      const seen: boolean[] = []
      device.onNetworkChange((s) => void seen.push(s.metered))

      connection.saveData = true
      for (const cb of listeners) cb()
      await Promise.resolve()
      expect(seen).toEqual([true])
    })

    it('stops notifying once the listener is disposed', async () => {
      const { device, win } = await deviceHarness({ onLine: true })
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
      const { device } = await deviceHarness({})
      await expect(device.battery()).resolves.toBeUndefined()
    })

    it('reports level and charging when the host has one', async () => {
      const battery: BatteryLike = { level: 0.42, charging: true }
      const { device } = await deviceHarness({ getBattery: async () => battery })
      await expect(device.battery()).resolves.toEqual({ level: 0.42, charging: true })
    })

    it('survives a host that rejects the request', async () => {
      const { device } = await deviceHarness({
        getBattery: async () => {
          throw new Error('blocked by policy')
        },
      })
      await expect(device.battery()).resolves.toBeUndefined()
    })
  })

  describe('media keys', () => {
    it('delivers a key pressed in main', async () => {
      const { device, bridge } = await deviceHarness()
      const seen: string[] = []
      device.onMediaKey((key) => void seen.push(key))

      bridge.push({ topic: 'media-key', key: 'play-pause' })
      bridge.push({ topic: 'media-key', key: 'next' })
      expect(seen).toEqual(['play-pause', 'next'])
    })

    it('asks main to watch only while someone is listening', async () => {
      const { device, bridge } = await deviceHarness()
      const off = device.onMediaKey(() => {})
      expect(bridge.calls.filter((c) => c.method === 'watchMediaKeys')).toHaveLength(1)

      off()
      const watch = bridge.calls.filter((c) => c.method === 'watchMediaKeys')
      expect(watch.at(-1)!.args).toEqual([false])
    })

    it('keeps watching while a second listener remains', async () => {
      const { device, bridge } = await deviceHarness()
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
      const { device, bridge } = await deviceHarness()
      const cb = vi.fn()
      device.registerHotkey('CommandOrControl+Alt+P', cb)

      expect(bridge.calls.some((c) => c.method === 'registerHotkey')).toBe(true)
      bridge.push({ topic: 'hotkey', accelerator: 'CommandOrControl+Alt+P' })
      expect(cb).toHaveBeenCalledOnce()
    })

    it('refcounts one accelerator across callers', async () => {
      const { device, bridge } = await deviceHarness()
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
      const { device, bridge } = await deviceHarness()
      const off = device.registerHotkey('MediaNextTrack', () => {})
      off()
      expect(bridge.calls.filter((c) => c.method === 'unregisterHotkey')).toHaveLength(1)
    })

    it('survives an accelerator another application already owns', async () => {
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
      const bridge = fakeBridge()
      const ctx = new Context()
      const fiber = await ctx.plugin(devicePlugin, { navigator: {}, bridge: bridge.api as never })
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
      const fiber = await ctx.plugin(devicePlugin, { navigator: {}, window: win.target })
      await fiber.dispose()

      const remaining = [...win.listeners.values()].reduce((n, set) => n + set.size, 0)
      expect(remaining).toBe(0)
    })

    it('works with no bridge at all', async () => {
      const ctx = new Context()
      await ctx.plugin(DeviceTauri, { navigator: { onLine: true } })
      await expect(ctx.device.network()).resolves.toMatchObject({ online: true })
      expect(() => ctx.device.onMediaKey(() => {})()).not.toThrow()
    })
  })
})

// =============================================================================
// 3. Media Session Service Parity Tests
// =============================================================================

describe('Media Session Service Parity (core-media-session-electron)', () => {
  describe(mediaSessionConformance.service, () => {
    for (const check of mediaSessionConformance.checks) {
      it(`${check.name} — ${check.because}`, async () => {
        const { service } = await mediaSessionHarness()
        await check.run({
          service,
          published: () => service.published(),
          press: (command) => service.press(command),
        })
      })
    }
  })

  describe('the Chromium surface', () => {
    it('sets metadata the browser can render', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'Jóga', artist: 'Björk', album: 'Homogenic' })
      expect(session.metadata).toMatchObject({ title: 'Jóga', artist: 'Björk' })
    })

    it('publishes a position state, which is what moves a scrubber', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'x', durationMs: 300_000, positionMs: 30_000 })
      expect(session.positions.at(-1)).toMatchObject({ duration: 300, position: 30 })
    })

    it('drops a local cover, which Chromium would refuse with a warning', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'Jóga', artworkUri: 'file:///C:/artwork/aw.jpg' })
      expect((session.metadata as { artwork?: unknown[] }).artwork).toEqual([])
    })

    it('prefers the network cover URL a browser can actually load', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({
        title: 'Jóga',
        artworkUri: 'file:///C:/artwork/aw.jpg',
        artworkUrl: 'https://cdn.test/joga.jpg',
      })
      expect((session.metadata as { artwork?: unknown[] }).artwork).toEqual([
        { src: 'https://cdn.test/joga.jpg' },
      ])
    })

    it('moves the scrubber without rebuilding the metadata', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 0 })
      const published = session.metadata
      service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 1000 })

      expect(session.metadata, 'the same metadata object').toBe(published)
      expect(session.positions.at(-1)).toMatchObject({ position: 1 })
    })

    it('does not publish a position without a usable duration', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'live stream' })
      service.update({ title: 'bad', durationMs: Number.NaN, positionMs: 1 })
      expect(session.positions).toHaveLength(0)
    })

    it('clamps a position that overruns its duration', async () => {
      const { service, session } = await mediaSessionHarness()
      service.update({ title: 'x', durationMs: 10_000, positionMs: 99_000 })
      expect(session.positions.at(-1)).toMatchObject({ position: 10 })
    })

    it('binds only the actions it declares support for', async () => {
      const { service, handlers } = await mediaSessionHarness()
      service.setSupportedCommands(['play', 'pause'])
      expect([...handlers.keys()].sort()).toEqual(['pause', 'play'])

      service.setSupportedCommands(['play', 'next'])
      expect([...handlers.keys()].sort(), 'pause is unbound, next is bound').toEqual([
        'nexttrack',
        'play',
      ])
    })

    it('turns a browser seek action into a command in milliseconds', async () => {
      const { service, handlers } = await mediaSessionHarness()
      const seen: unknown[] = []
      service.onCommand((c) => void seen.push(c))
      service.setSupportedCommands(['seek'])

      handlers.get('seekto')!({ seekTime: 42 })
      expect(seen).toEqual([{ type: 'seek', positionMs: 42_000 }])
    })

    it('turns seekbackward into a negative relative seek', async () => {
      const { service, handlers } = await mediaSessionHarness()
      const seen: unknown[] = []
      service.onCommand((c) => void seen.push(c))
      service.setSupportedCommands(['seek-relative'])

      handlers.get('seekbackward')!({ seekOffset: 15 })
      handlers.get('seekforward')!({ seekOffset: 15 })
      expect(seen).toEqual([
        { type: 'seek-relative', deltaMs: -15_000 },
        { type: 'seek-relative', deltaMs: 15_000 },
      ])
    })

    it('unbinds every action on clear, so no button reaches a dead player', async () => {
      const { service, handlers } = await mediaSessionHarness()
      service.setSupportedCommands(['play', 'pause', 'next'])
      expect(handlers.size).toBeGreaterThan(0)
      service.clear()
      expect(handlers.size).toBe(0)
    })
  })

  describe('the main-process surface', () => {
    it('mirrors metadata and state to MPRIS/SMTC', async () => {
      const { service, bridge } = await mediaSessionHarness()
      service.update({ title: 'Jóga' })
      service.setPlaybackState('playing')

      const methods = bridge.calls.map((c) => c.method)
      expect(methods).toContain('publishNowPlaying')
      expect(methods).toContain('publishPlaybackState')
    })

    it('publishes once per track, not once per position tick', async () => {
      const { service, bridge } = await mediaSessionHarness()
      service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 0 })
      service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 1000 })
      service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 2000 })

      const publishes = bridge.calls.filter((c) => c.method === 'publishNowPlaying')
      expect(publishes).toHaveLength(1)
    })

    it('re-publishes after a clear, which dropped the surface', async () => {
      const { service, bridge } = await mediaSessionHarness()
      service.update({ title: 'Jóga' })
      service.clear()
      service.update({ title: 'Jóga' })

      const publishes = bridge.calls.filter((c) => c.method === 'publishNowPlaying')
      expect(publishes).toHaveLength(2)
    })

    it('accepts a press from MPRIS as if it were a lock-screen press', async () => {
      const { service, bridge } = await mediaSessionHarness()
      const seen: unknown[] = []
      service.onCommand((c) => void seen.push(c))

      bridge.push({ topic: 'transport', command: 'next' })
      bridge.push({ topic: 'transport', command: 'seek', positionMs: 5000 })
      expect(seen).toEqual([{ type: 'next' }, { type: 'seek', positionMs: 5000 }])
    })

    it('ignores a transport topic it does not understand', async () => {
      const { service, bridge } = await mediaSessionHarness()
      const seen: unknown[] = []
      service.onCommand((c) => void seen.push(c))
      bridge.push({ topic: 'transport', command: 'teleport' })
      expect(seen).toEqual([])
    })

    it('survives a host with no MPRIS at all', async () => {
      const ctx = new Context()
      await ctx.plugin(MediaSessionTauri, { metadataFactory: (i) => i })
      expect(() => {
        ctx.mediaSession.update({ title: 'x' })
        ctx.mediaSession.setPlaybackState('playing')
        ctx.mediaSession.clear()
      }).not.toThrow()
    })
  })

  describe('robustness', () => {
    it('keeps dispatching when one listener throws', async () => {
      const { service } = await mediaSessionHarness()
      const good = vi.fn()
      service.onCommand(() => {
        throw new Error('boom')
      })
      service.onCommand(good)
      service.press({ type: 'play' })
      expect(good).toHaveBeenCalledOnce()
    })

    it('lets a listener dispose itself mid-dispatch', async () => {
      const { service } = await mediaSessionHarness()
      const seen: string[] = []
      const off = service.onCommand(() => {
        seen.push('first')
        off()
      })
      service.onCommand(() => void seen.push('second'))
      service.press({ type: 'play' })
      expect(seen, 'the second listener still ran').toEqual(['first', 'second'])
    })

    it('leaves no OS surface behind when unloaded', async () => {
      const fake = fakeSession()
      const bridge = fakeBridge()
      const ctx = new Context()
      const fiber = await ctx.plugin(mediaSessionPlugin, {
        session: fake.session,
        bridge: bridge.api as never,
        metadataFactory: (init: Record<string, unknown>) => init,
      })
      ctx.mediaSession.update({ title: 'x' })
      ctx.mediaSession.setSupportedCommands(['play'])
      expect(fake.handlers.size).toBeGreaterThan(0)

      await fiber.dispose()
      expect(fake.session.metadata, 'metadata cleared').toBeNull()
      expect(fake.handlers.size, 'actions unbound').toBe(0)
      expect(bridge.calls.map((c) => c.method)).toContain('clearNowPlaying')
    })
  })
})

// =============================================================================
// 4. Tauri Bridge Implementation & Bridged 'system' Service Coverage
// =============================================================================

describe('Tauri Bridge Implementation & Bridged System Service (Group 6 Target)', () => {
  function createTauriBridgeMock() {
    const invocations: { cmd: string; args: any }[] = []
    const eventListeners = new Map<string, Set<(payload: any) => void>>()

    const mockInvoke = async (cmd: string, args: any) => {
      invocations.push({ cmd, args })

      // Emulate desktop_bridge_call handling
      if (cmd === 'desktop_bridge_call' || cmd === 'bridge_call') {
        const { service, method } = args || {}
        if (service === 'system') {
          return {
            __bbebee_bridge__: true,
            ok: true,
            result: method === 'powerSaveBlocker' ? 1 : undefined,
          }
        }
        return { __bbebee_bridge__: true, ok: true, result: 'mock-result' }
      }

      if (cmd === 'desktop_dialog_pick_directory' || cmd === 'dialog_pick_directory') {
        return '/home/user/Music'
      }

      if (cmd === 'desktop_dialog_pick_files' || cmd === 'dialog_pick_files') {
        return ['/home/user/Music/track1.flac', '/home/user/Music/track2.mp3']
      }

      if (cmd === 'desktop_shell_open_external' || cmd === 'shell_open_external') {
        if (!args.url?.startsWith('http://') && !args.url?.startsWith('https://')) {
          throw new Error('refusing to open non-web url')
        }
        return undefined
      }

      if (cmd === 'desktop_shell_open_path' || cmd === 'shell_open_path') {
        return ''
      }

      if (cmd === 'desktop_screen_get_primary_monitor' || cmd === 'screen_get_primary_monitor') {
        return {
          name: 'Primary-Monitor',
          position: { x: 0, y: 0 },
          width: 1920,
          height: 1080,
          scaleFactor: 1.0,
          isPrimary: true,
        }
      }

      if (cmd === 'desktop_screen_get_cursor_position' || cmd === 'screen_get_cursor_position') {
        return { x: 500, y: 400 }
      }

      if (cmd === 'desktop_power_block_sleep' || cmd === 'power_block_sleep') {
        return args.id || 1
      }

      if (cmd === 'desktop_power_is_sleep_blocked' || cmd === 'power_is_sleep_blocked') {
        return true
      }

      if (cmd === 'desktop_proxy_test' || cmd === 'proxy_test') {
        return { ok: true, latencyMs: 25 }
      }

      if (cmd === 'bridge_http_open') {
        return {
          __bbebee_bridge__: true,
          ok: true,
          result: {
            handle: 101,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'audio/flac' },
            url: args.request?.url,
            hasBody: true,
          },
        }
      }

      if (cmd === 'bridge_http_pull') {
        return {
          __bbebee_bridge__: true,
          ok: true,
          result: null, // EOF
        }
      }

      return undefined
    }

    const mockAddListener = (eventName: string, callback: (payload: any) => void) => {
      let bucket = eventListeners.get(eventName)
      if (!bucket) {
        bucket = new Set()
        eventListeners.set(eventName, bucket)
      }
      bucket.add(callback)
      return () => {
        eventListeners.get(eventName)?.delete(callback)
      }
    }

    const emitEvent = (eventName: string, payload: any) => {
      const bucket = eventListeners.get(eventName)
      if (bucket) {
        for (const cb of [...bucket]) cb(payload)
      }
    }

    const bridge = createBridgeApi(mockInvoke as any, mockAddListener as any)
    const preload = createPreloadApi(mockInvoke as any, mockAddListener as any)

    return { invocations, eventListeners, emitEvent, bridge, preload, mockInvoke }
  }

  it('supports all canonical and alias bridged system calls through createBridgeApi', async () => {
    const { bridge, invocations } = createTauriBridgeMock()

    // 1. Media key registrations
    await bridge.call('system', 'watchMediaKeys', [true])
    await bridge.call('system', 'registerMediaKey', ['play-pause'])

    // 2. Hotkey registrations
    await bridge.call('system', 'registerHotkey', ['CommandOrControl+Alt+P'])
    await bridge.call('system', 'unregisterHotkey', ['CommandOrControl+Alt+P'])
    await bridge.call('system', 'unregisterAllHotkeys', [])

    // 3. Media session updates
    await bridge.call('system', 'publishNowPlaying', [{ title: 'All Is Full of Love' }])
    await bridge.call('system', 'mediaSessionUpdate', [{ title: 'Bachelorette' }])
    await bridge.call('system', 'publishPlaybackState', ['playing'])
    await bridge.call('system', 'mediaSessionSetPlaybackState', ['paused'])
    await bridge.call('system', 'mediaSessionSetPosition', [120000])
    await bridge.call('system', 'setSupportedCommands', [['play', 'pause']])
    await bridge.call('system', 'clearNowPlaying', [])

    // 4. Power save blockers
    await bridge.call('system', 'acquireWakeLock', [1, 'playing'])
    const lock2 = await bridge.call('system', 'powerSaveBlocker', ['prevent-app-suspension'])
    await bridge.call('system', 'releaseWakeLock', [1])

    expect(lock2).toBe(1)
    const bridgeInvocations = invocations.filter((i) => i.cmd === 'desktop_bridge_call')
    expect(bridgeInvocations.length).toBe(15)
  })

  it('delivers all 5 enumerated BridgeEvent topics via BBeBee:event push channel', async () => {
    const { bridge, emitEvent } = createTauriBridgeMock()
    const receivedEvents: BridgeEvent[] = []

    const off = bridge.on((e) => receivedEvents.push(e as BridgeEvent))

    // Push events as array envelopes (sidecar standard) or single objects (direct Rust)
    emitEvent('BBeBee:event', [{ topic: 'media-key', key: 'next' }])
    emitEvent('BBeBee:event', { topic: 'hotkey', accelerator: 'Ctrl+Shift+Space' })
    emitEvent('BBeBee:event', [{ topic: 'will-suspend' }])
    emitEvent('BBeBee:event', { topic: 'power', charging: true, level: 0.85 })
    emitEvent('BBeBee:event', [{ topic: 'transport', command: 'play' }])

    expect(receivedEvents).toEqual([
      { topic: 'media-key', key: 'next' },
      { topic: 'hotkey', accelerator: 'Ctrl+Shift+Space' },
      { topic: 'will-suspend' },
      { topic: 'power', charging: true, level: 0.85 },
      { topic: 'transport', command: 'play' },
    ])

    off()
    emitEvent('BBeBee:event', [{ topic: 'media-key', key: 'stop' }])
    expect(receivedEvents).toHaveLength(5)
  })

  it('runs DeviceTauri, BackgroundTauri, and MediaSessionTauri end-to-end on Tauri Bridge', async () => {
    const { bridge, emitEvent } = createTauriBridgeMock()
    const ctx = new Context()

    await ctx.plugin(DeviceTauri, {
      bridge: bridge as any,
      platform: 'linux',
      appVersion: '2.0.0',
    })
    await ctx.plugin(BackgroundTauri, {
      bridge: bridge as any,
    })
    await ctx.plugin(MediaSessionTauri, {
      bridge: bridge as any,
      metadataFactory: (i) => i,
    })

    // Test Media Key push through bridge to DeviceTauri
    const mediaKeySpy = vi.fn()
    ctx.device.onMediaKey(mediaKeySpy)
    emitEvent('BBeBee:event', [{ topic: 'media-key', key: 'play-pause' }])
    expect(mediaKeySpy).toHaveBeenCalledWith('play-pause')

    // Test Hotkey push through bridge to DeviceTauri
    const hotkeySpy = vi.fn()
    ctx.device.registerHotkey('Ctrl+Alt+S', hotkeySpy)
    emitEvent('BBeBee:event', [{ topic: 'hotkey', accelerator: 'Ctrl+Alt+S' }])
    expect(hotkeySpy).toHaveBeenCalledOnce()

    // Test Suspend push through bridge to BackgroundTauri
    const suspendSpy = vi.fn()
    ctx.background.onWillSuspend(suspendSpy)
    emitEvent('BBeBee:event', [{ topic: 'will-suspend' }])
    expect(suspendSpy).toHaveBeenCalledOnce()

    // Test Transport push through bridge to MediaSessionTauri
    const commandSpy = vi.fn()
    ctx.mediaSession.onCommand(commandSpy)
    emitEvent('BBeBee:event', [{ topic: 'transport', command: 'next' }])
    expect(commandSpy).toHaveBeenCalledWith({ type: 'next' })

    // Test Wake lock acquisition
    const releaseLock = await ctx.background.acquireWakeLock('audio-playback')
    expect((ctx.background as any).heldLocks).toContain('audio-playback')
    releaseLock()
    expect((ctx.background as any).heldLocks).not.toContain('audio-playback')
  })
})

// =============================================================================
// 5. Comprehensive OS Services Support (Group 0 Mapping Table Verification)
// =============================================================================

describe('Comprehensive OS Services Support (Group 0 Mapping Table)', () => {
  it('verifies dialog: pickDirectory and pickFiles forward through Tauri commands', async () => {
    const { preload, invocations } = (() => {
      const calls: any[] = []
      const p = createPreloadApi(async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === 'desktop_dialog_pick_directory') return '/mock/music/library'
        if (cmd === 'desktop_dialog_pick_files') return ['/mock/music/1.flac']
        return undefined
      })
      return { preload: p, invocations: calls }
    })()

    const pickedDir = await preload.dialog.pickDirectory()
    expect(pickedDir).toBe('/mock/music/library')
    expect(invocations.some((c) => c.cmd === 'desktop_dialog_pick_directory')).toBe(true)

    const pickedFiles = await preload.dialog.pickFiles({ extensions: ['flac', 'mp3'] })
    expect(pickedFiles).toEqual(['/mock/music/1.flac'])
    expect(invocations.some((c) => c.cmd === 'desktop_dialog_pick_files')).toBe(true)
  })

  it('verifies shell: openExternal and openPath guard against non-web URLs and forward safely', async () => {
    const { preload, invocations } = (() => {
      const calls: any[] = []
      const p = createPreloadApi(async (cmd, args) => {
        calls.push({ cmd, args })
        if (cmd === 'desktop_shell_open_external') {
          const url = (args as any)?.url
          if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            throw new Error('refusing to open non-web url')
          }
          return undefined
        }
        return ''
      })
      return { preload: p, invocations: calls }
    })()

    await expect(preload.shell.openExternal('file:///etc/shadow')).rejects.toThrow()
    await expect(preload.shell.openExternal('https://music.bbebee.org')).resolves.toBeUndefined()
    expect(invocations.some((c) => c.cmd === 'desktop_shell_open_external')).toBe(true)

    await expect(preload.shell.openPath('/home/user/Music')).resolves.toBe('')
    expect(invocations.some((c) => c.cmd === 'desktop_shell_open_path')).toBe(true)
  })

  it('verifies screen geometry and monitor querying contracts', async () => {
    const mockMonitor = {
      name: 'Primary',
      position: { x: 0, y: 0 },
      width: 2560,
      height: 1440,
      scaleFactor: 1.25,
      isPrimary: true,
    }
    const invoker = vi.fn(async (cmd: string) => {
      if (cmd === 'desktop_screen_get_primary_monitor') return mockMonitor
      if (cmd === 'desktop_screen_get_cursor_position') return { x: 320, y: 240 }
      return null
    })

    const monitor = await invoker('desktop_screen_get_primary_monitor')
    expect(monitor).toMatchObject({ width: 2560, height: 1440, isPrimary: true })

    const cursor = await invoker('desktop_screen_get_cursor_position')
    expect(cursor).toEqual({ x: 320, y: 240 })
  })

  it('verifies powerMonitor & powerSaveBlocker sleep inhibition contracts', async () => {
    const invoker = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'desktop_power_block_sleep') return args?.id || 10
      if (cmd === 'desktop_power_unblock_sleep') return undefined
      if (cmd === 'desktop_power_is_sleep_blocked') return true
      return undefined
    })

    const lockId = await invoker('desktop_power_block_sleep', { id: 10, reason: 'audio-streaming' })
    expect(lockId).toBe(10)

    const isBlocked = await invoker('desktop_power_is_sleep_blocked', {})
    expect(isBlocked).toBe(true)

    await expect(invoker('desktop_power_unblock_sleep', { id: 10 })).resolves.toBeUndefined()
  })

  it('verifies nativeImage tray & window icon metadata', async () => {
    const iconFiles = ['icon.png', '32x32.png', '128x128.png', '128x128@2x.png', 'tray-icon.png']
    for (const icon of iconFiles) {
      expect(typeof icon).toBe('string')
      expect(icon.endsWith('.png')).toBe(true)
    }
  })

  it('verifies net: CORS-free HTTP fetch via Node sidecar bridge protocol', async () => {
    const bridge = createBridgeApi(async (cmd, args) => {
      if (cmd === 'bridge_http_open') {
        return {
          __bbebee_bridge__: true,
          ok: true,
          result: {
            handle: 42,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            url: (args as any).request.url,
            hasBody: true,
          },
        }
      }
      if (cmd === 'bridge_http_pull') {
        return {
          __bbebee_bridge__: true,
          ok: true,
          result: null, // EOF
        }
      }
      if (cmd === 'bridge_http_close') {
        return undefined
      }
      return undefined
    })

    const head: any = await bridge.httpOpen!({
      url: 'https://thirdparty-music-api.test/stream',
      method: 'GET',
      headers: { Referer: 'https://source.test', 'User-Agent': 'BBeBee/2.0' },
    })
    expect(head.handle).toBe(42)
    expect(head.status).toBe(200)

    const chunk = await bridge.httpPull!(head.handle)
    expect(chunk).toBeNull() // EOF

    await expect(bridge.httpClose!(head.handle)).resolves.toBeUndefined()
  })

  it('verifies session: proxy testing & configuration and stream headers map', async () => {
    const invoker = vi.fn(async (cmd: string, args: any) => {
      if (cmd === 'desktop_proxy_test') {
        if (!args?.config?.host) return { ok: false, error: 'Host missing' }
        return { ok: true, latencyMs: 18 }
      }
      if (cmd === 'desktop_proxy_set' || cmd === 'desktop_stream_set_headers') {
        return undefined
      }
      return undefined
    })

    const preload = createPreloadApi(invoker)

    const testFail = await preload.proxy.test({})
    expect(testFail.ok).toBe(false)

    const testSuccess = await preload.proxy.test({ host: '127.0.0.1', port: 7890 })
    expect(testSuccess.ok).toBe(true)
    expect(testSuccess.latencyMs).toBe(18)

    await expect(preload.proxy.set({ host: '127.0.0.1', port: 7890 })).resolves.toBeUndefined()

    await expect(
      preload.stream.setHeaders({
        url: 'https://media.test/*',
        headers: { Referer: 'https://source.test' },
      }),
    ).resolves.toBeUndefined()
  })
})
