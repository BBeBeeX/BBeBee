/**
 * `ctx.device` on a phone, against the expo-module stubs.
 *
 * The twin of `core-device-desktop`'s suite, and shaped by the same question:
 * not "does it read the OS", but what happens when the OS does not answer. A
 * permissions refusal, a device that will not report its connection type, a
 * build without a battery — each of those is a normal phone, and each used to
 * be a different way to fail a boot. `expo-network`, `expo-battery`,
 * `expo-application` and `react-native` are aliased to stubs under Vitest
 * (see the root `vitest.config.ts`), each with a lever to script both the
 * happy numbers and the refusals.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'cordis'
import * as Network from 'expo-network'
import * as Battery from 'expo-battery'
import * as Application from 'expo-application'
import plugin, { DeviceExpo, type DeviceExpoConfig } from './index.js'

async function harness(config: DeviceExpoConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(DeviceExpo, config)
  return { ctx, device: ctx.device as DeviceExpo }
}

beforeEach(async () => {
  // Reset every stub's lever, the way the OS resets between launches.
  const network = Network as unknown as { __resetForTests?: () => void }
  const battery = Battery as unknown as { __resetForTests?: () => void }
  const application = Application as unknown as { __resetForTests?: () => void }
  network.__resetForTests?.()
  battery.__resetForTests?.()
  application.__resetForTests?.()
})

describe('identity', () => {
  it('reports its platform, form factor and version', async () => {
    const { device } = await harness({ appVersion: '1.2.3' })
    expect(device.platform === 'android' || device.platform === 'ios').toBe(true)
    expect(device.formFactor).toBe('phone')
    expect(device.appVersion).toBe('1.2.3')
  })

  it('falls back to 0.0.0 when the native bundle has no version', async () => {
    // A dev client or a test runner has no embedded version string.
    ;(Application as unknown as { __setApplicationVersionForTests: (v: string | null) => void })
      .__setApplicationVersionForTests(null)
    const { device } = await harness()
    expect(device.appVersion).toBe('0.0.0')
  })

  it('falls back to a usable locale when the host has none', async () => {
    // No native Settings/I18n module in a bare JS runtime — "en" keeps every
    // formatter working rather than crashing the boot.
    const { device } = await harness({ locale: undefined })
    expect(typeof device.locale).toBe('string')
    expect(device.locale.length).toBeGreaterThan(0)
  })
})

describe('network', () => {
  it('maps the connection types the download policies branch on', async () => {
    const set = (Network as unknown as {
      __setNetworkForTests: (state: Network.NetworkState) => void
    }).__setNetworkForTests

    set({ type: Network.NetworkStateType.WIFI, isConnected: true, isInternetReachable: true })
    const { device } = await harness()
    await expect(device.network()).resolves.toEqual({
      online: true,
      type: 'wifi',
      metered: false,
    })

    set({ type: Network.NetworkStateType.CELLULAR, isConnected: true, isInternetReachable: true })
    // Cellular is metered: this is what StreamPrefs.saveData rides on, and
    // erring towards "not metered" would spend someone's data plan.
    await expect(device.network()).resolves.toEqual({
      online: true,
      type: 'cellular',
      metered: true,
    })

    set({ type: Network.NetworkStateType.NONE, isConnected: false, isInternetReachable: false })
    await expect(device.network()).resolves.toEqual({
      online: false,
      type: 'none',
      metered: false,
    })
  })

  it('answers unknown-and-online rather than lying about offline', async () => {
    // A device that will not say its connection type is normal; claiming
    // offline would stop every download and kill every stream.
    ;(Network as unknown as {
      __setNetworkForTests: (state: Network.NetworkState) => void
    }).__setNetworkForTests({
      type: Network.NetworkStateType.UNKNOWN,
      isConnected: true,
      isInternetReachable: undefined,
    })
    const { device } = await harness()
    await expect(device.network()).resolves.toEqual({
      online: true,
      type: 'unknown',
      metered: false,
    })
  })

  it('survives a module that refuses to answer', async () => {
    // A permissions refusal or an unlinked module. "Unknown and online" keeps
    // the app usable — the degradation rule the whole service runs on.
    ;(Network as unknown as { __setNetworkForTests: (state: false) => void })
      .__setNetworkForTests(false)
    const { device } = await harness()
    await expect(device.network()).resolves.toEqual({
      online: true,
      type: 'unknown',
      metered: false,
    })
  })

  it('notifies on network transitions', async () => {
    const { device } = await harness()
    const seen: NetworkStateish[] = []
    device.onNetworkChange((s) => void seen.push({ online: s.online, type: s.type }))

    ;(Network as unknown as {
      __emitNetworkChange: (state: Network.NetworkState) => void
    }).__emitNetworkChange({
      type: Network.NetworkStateType.NONE,
      isConnected: false,
      isInternetReachable: false,
    })
    // The listener re-reads the state through `network()` before dispatching.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(seen).toEqual([{ online: false, type: 'none' }])
  })

  it('subscribes to the OS once for every listener, and unsubscribes with the last', async () => {
    // One native subscription per caller is a native leak per caller — the
    // refcount is the point.
    const { device } = await harness()
    const network = Network as unknown as {
      addNetworkStateListener: (cb: (s: Network.NetworkState) => void) => { remove(): void }
    }
    const spy = vi.spyOn(network, 'addNetworkStateListener')

    const offA = device.onNetworkChange(() => {})
    const offB = device.onNetworkChange(() => {})
    expect(spy).toHaveBeenCalledTimes(1)

    offA()
    // Still subscribed while B listens.
    expect(spy).toHaveBeenCalledTimes(1)
    offB()

    // A later caller gets a fresh subscription.
    device.onNetworkChange(() => {})
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('stops notifying once the listener is disposed', async () => {
    const { device } = await harness()
    const cb = vi.fn()
    const off = device.onNetworkChange(cb)
    off()
    ;(Network as unknown as {
      __emitNetworkChange: (state: Network.NetworkState) => void
    }).__emitNetworkChange({
      type: Network.NetworkStateType.WIFI,
      isConnected: true,
      isInternetReachable: true,
    })
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('battery', () => {
  it('reports level and charging', async () => {
    const { device } = await harness()
    await expect(device.battery()).resolves.toEqual({ level: 0.75, charging: true })
  })

  it('treats a full battery as charging', async () => {
    // FULL is the "leave it on the dock" state; a plugin pausing downloads
    // because "not charging" would be wrong exactly there.
    ;(Battery as unknown as {
      __setBatteryForTests: (b?: { state?: number } | false) => void
    }).__setBatteryForTests({ state: Battery.BatteryState.FULL })
    const { device } = await harness()
    await expect(device.battery()).resolves.toEqual({ level: 0.75, charging: true })
  })

  it('is undefined where there is no battery', async () => {
    // A simulator or a device that will not say: `undefined` is the contract
    // for "no answer", and every caller already handles it.
    ;(Battery as unknown as { __setBatteryForTests: (b: false) => void })
      .__setBatteryForTests(false)
    const { device } = await harness()
    await expect(device.battery()).resolves.toBeUndefined()
  })
})

describe('desktop-only surfaces', () => {
  it('answers media keys and hotkeys with a no-op disposer, not a throw', async () => {
    // A plugin written once for both targets calls these on a phone too; the
    // contract asks for "nothing will happen", not a crash.
    const { device } = await harness()
    expect(() => device.onMediaKey(() => {})()).not.toThrow()
    expect(() => device.registerHotkey('MediaPlayPause', () => {})()).not.toThrow()
  })
})

describe('lifecycle', () => {
  it('releases the native subscription when unloaded', async () => {
    const network = Network as unknown as {
      addNetworkStateListener: (cb: (s: Network.NetworkState) => void) => { remove(): void }
    }
    const spy = vi.spyOn(network, 'addNetworkStateListener')
    const remove = vi.fn()
    spy.mockImplementation(() => ({ remove }))

    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {})
    ctx.device.onNetworkChange(() => {})

    await fiber.dispose()
    expect(remove).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('keeps notifying while someone listens', async () => {
    const { device } = await harness()
    const seen: boolean[] = []
    device.onNetworkChange((s) => void seen.push(s.online))
    ;(Network as unknown as {
      __emitNetworkChange: (state: Network.NetworkState) => void
    }).__emitNetworkChange({
      type: Network.NetworkStateType.CELLULAR,
      isConnected: true,
      isInternetReachable: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([true])
  })
})

type NetworkStateish = { online: boolean; type: string }
