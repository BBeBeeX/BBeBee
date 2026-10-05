// @vitest-environment jsdom
/**
 * Tests for the global shortcut watcher (`src/shortcuts.ts`).
 *
 * The registration used to live in a `useEffect` of the desktop settings
 * screen; these tests carry the same intent — the configured accelerator is
 * bound to the right action — but at the feature layer where the logic now
 * lives, including the parts a view effect could never cover: re-binding on
 * a settings change, unregistering when disabled, and surviving the settings
 * screen being closed.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import type { Disposable } from 'cordis'
import { tick } from '@BBeBee/kernel/testing'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import type { AppSettings, StoreService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS, DEFAULT_SHORTCUTS_SETTINGS } from '@BBeBee/protocol'
import { SettingsPlugin } from './index.js'

class MemoryStore extends Service implements StoreService {
  private map = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'store')
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  async keys(): Promise<string[]> {
    return Array.from(this.map.keys())
  }

  namespace(): StoreService {
    return this
  }
}

/** Records every accelerator→handler pair, like the electron device service. */
class DeviceStub extends Service {
  readonly handlers = new Map<string, Set<() => void>>()

  constructor(ctx: Context) {
    super(ctx, 'device')
  }

  registerHotkey(accelerator: string, cb: () => void): Disposable {
    let bucket = this.handlers.get(accelerator)
    if (!bucket) {
      bucket = new Set()
      this.handlers.set(accelerator, bucket)
    }
    bucket.add(cb)
    return () => {
      const current = this.handlers.get(accelerator)
      if (!current) return
      current.delete(cb)
      if (!current.size) this.handlers.delete(accelerator)
    }
  }

  fire(accelerator: string): void {
    for (const cb of this.handlers.get(accelerator) ?? []) cb()
  }
}

class PlayerStub extends Service {
  state = { volume: 0.5, positionMs: 30000, trackUrn: 'urn:track:local:x' }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  togglePlay = vi.fn()
  previous = vi.fn()
  next = vi.fn()
  setVolume = vi.fn()
  seek = vi.fn()
}

class SourcesStub extends Service {
  setLoved = vi.fn()

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
}

class DesktopLyricsStub extends Service {
  toggleVisible = vi.fn()

  constructor(ctx: Context) {
    super(ctx, 'desktopLyrics')
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryStore)
  return ctx
}

describe('watchGlobalShortcuts', () => {
  it('registers the default bindings when the device service is present', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    for (const acc of Object.values(DEFAULT_SHORTCUTS_SETTINGS.keybindings)) {
      expect(device.handlers.has(acc), acc).toBe(true)
    }
  })

  it('registers nothing when no device service exists', async () => {
    const ctx = await harness()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    // No device service anywhere: the inject never fires and nothing throws.
    expect(serviceOf(ctx, 'settings')).toBeTruthy()
  })

  it('binds each accelerator to its player action', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    const player = serviceOf<PlayerStub>(ctx, 'player')!
    const kb = DEFAULT_SHORTCUTS_SETTINGS.keybindings

    device.fire(kb.playPause)
    expect(player.togglePlay).toHaveBeenCalledTimes(1)

    device.fire(kb.nextTrack)
    expect(player.next).toHaveBeenCalledTimes(1)

    device.fire(kb.prevTrack)
    expect(player.previous).toHaveBeenCalledTimes(1)

    // 0.5 ± 0.05, clamped to one decimal the same way the old effect did
    device.fire(kb.volumeUp)
    expect(player.setVolume).toHaveBeenLastCalledWith(0.55)

    device.fire(kb.volumeDown)
    expect(player.setVolume).toHaveBeenLastCalledWith(0.45)

    device.fire(kb.seekForward)
    expect(player.seek).toHaveBeenLastCalledWith(35000)

    device.fire(kb.seekBackward)
    expect(player.seek).toHaveBeenLastCalledWith(25000)
  })

  it('hides or shows the window through the desktop bridge', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const toggle = vi.fn()
    ;(window as unknown as { BBeBee: unknown }).BBeBee = { window: { toggle } }

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    device.fire(DEFAULT_SHORTCUTS_SETTINGS.keybindings.toggleWindow)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('toggles desktop lyrics through the desktop-lyrics service', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(DesktopLyricsStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    const dl = serviceOf<DesktopLyricsStub>(ctx, 'desktopLyrics')!
    device.fire(DEFAULT_SHORTCUTS_SETTINGS.keybindings.toggleLyrics)
    expect(dl.toggleVisible).toHaveBeenCalledTimes(1)
  })

  it('marks the current track loved through the sources service', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    const sources = serviceOf<SourcesStub>(ctx, 'sources')!
    device.fire(DEFAULT_SHORTCUTS_SETTINGS.keybindings.toggleLoved)
    expect(sources.setLoved).toHaveBeenCalledWith('urn:track:local:x', true)
  })

  it('rebinds accelerators when the keybindings change', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    const player = serviceOf<PlayerStub>(ctx, 'player')!
    const kb = DEFAULT_SHORTCUTS_SETTINGS.keybindings
    expect(device.handlers.has(kb.playPause)).toBe(true)

    const next: AppSettings['shortcuts'] = {
      enabled: true,
      keybindings: { ...kb, playPause: 'CommandOrControl+Alt+P' },
    }
    await ctx.settings.update({ shortcuts: next })
    await tick()

    expect(device.handlers.has(kb.playPause)).toBe(false)
    expect(device.handlers.has('CommandOrControl+Alt+P')).toBe(true)

    device.fire('CommandOrControl+Alt+P')
    expect(player.togglePlay).toHaveBeenCalledTimes(1)
  })

  it('unregisters every binding when shortcuts are disabled', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    expect(device.handlers.size).toBeGreaterThan(0)

    await ctx.settings.update({
      shortcuts: { ...DEFAULT_APP_SETTINGS.shortcuts, enabled: false },
    })
    await tick()

    expect(device.handlers.size).toBe(0)
  })

  it('picks the device service up when it loads after the settings plugin', async () => {
    const ctx = await harness()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    await ctx.plugin(DeviceStub)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    expect(device.handlers.size).toBeGreaterThan(0)
  })

  it('releases every binding when the settings plugin unloads', async () => {
    const ctx = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(PlayerStub)
    const fiber = await ctx.plugin(SettingsPlugin)
    await tick()

    const device = serviceOf<DeviceStub>(ctx, 'device')!
    expect(device.handlers.size).toBeGreaterThan(0)

    await fiber.dispose()
    await tick()

    expect(device.handlers.size).toBe(0)
  })
})
