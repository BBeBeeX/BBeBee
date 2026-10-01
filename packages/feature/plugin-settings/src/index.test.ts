import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import type { AppSettings, StoreService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { SettingsPlugin } from './index.js'
import { SETTINGS_ROUTES } from './views.js'

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

async function harness(initialStored?: Partial<AppSettings>) {
  const ctx = new Context()
  await ctx.plugin(MemoryStore)
  if (initialStored) {
    await ctx.store.set('preferences', initialStored)
  }
  return ctx
}

describe('plugin-settings', () => {
  it('loads with default settings when store is empty', async () => {
    const ctx = await harness()
    await ctx.plugin(SettingsPlugin)
    await tick()

    const settings = await ctx.settings.get()
    expect(settings).toEqual(DEFAULT_APP_SETTINGS)
    expect(ctx.settings.getSync()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('loads persisted settings merged with defaults', async () => {
    const ctx = await harness({ theme: 'light', defaultVolume: 50 })
    await ctx.plugin(SettingsPlugin)
    await tick()

    const settings = await ctx.settings.get()
    expect(settings.theme).toBe('light')
    expect(settings.defaultVolume).toBe(50)
    expect(settings.language).toBe(DEFAULT_APP_SETTINGS.language)
  })

  it('updates settings, persists them, and emits settings/changed event', async () => {
    const ctx = await harness()
    await ctx.plugin(SettingsPlugin)
    await tick()

    const listener = vi.fn()
    ctx.on('settings/changed', listener)

    const updated = await ctx.settings.update({ theme: 'light', crossfadeEnabled: true })
    expect(updated.theme).toBe('light')
    expect(updated.crossfadeEnabled).toBe(true)
    expect(listener).toHaveBeenCalledWith(updated)

    // Verify stored in ctx.store
    const stored = await ctx.store.get<AppSettings>('preferences')
    expect(stored?.theme).toBe('light')
    expect(stored?.crossfadeEnabled).toBe(true)
  })

  it('resets settings back to defaults', async () => {
    const ctx = await harness({ theme: 'light', defaultVolume: 20 })
    await ctx.plugin(SettingsPlugin)
    await tick()

    await ctx.settings.reset()
    const current = await ctx.settings.get()
    expect(current).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('contributes /settings route when ui service is registered', async () => {
    const ctx = await harness()
    await ctx.plugin(UiStub)
    await ctx.plugin(SettingsPlugin)
    await tick()

    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributed).toEqual([
      { kind: 'route', id: SETTINGS_ROUTES.main, path: '/settings' },
    ])
  })

  it('allows plugins to contribute settings entries dynamically', async () => {
    const ctx = await harness()
    await ctx.plugin(SettingsPlugin)
    await tick()

    const off = ctx.settings.contribute({
      id: 'custom.plugin.settings',
      section: 'playback',
      title: 'Custom Feature',
      description: 'Custom description',
    })

    expect(ctx.settings.getContributions()).toEqual([
      expect.objectContaining({
        kind: 'settings',
        id: 'custom.plugin.settings',
        section: 'playback',
        title: 'Custom Feature',
      }),
    ])

    off()
    expect(ctx.settings.getContributions()).toEqual([])
  })
})

describe('plugin-settings lifecycle', () => {
  it('snapshots clean after unload', async () => {
    const ctx = await harness()
    await ctx.plugin(UiStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(SettingsPlugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
