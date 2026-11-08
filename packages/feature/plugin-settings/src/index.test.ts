import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import type { AppSettings, StoreService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { SettingsPlugin } from './index.js'
import { SETTINGS_ROUTES, SETTINGS_VIEWS } from './views.js'

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

  it('deep-merges liquid glass tiers so a general-only patch keeps advanced', async () => {
    const ctx = await harness()
    await ctx.plugin(SettingsPlugin)
    await tick()

    const updated = await ctx.settings.update({
      liquidGlass: { general: { variant: 'clear' } },
    })
    expect(updated.liquidGlass?.general.variant).toBe('clear')
    expect(updated.liquidGlass?.general.enabled).toBe(
      DEFAULT_APP_SETTINGS.liquidGlass!.general.enabled,
    )
    expect(updated.liquidGlass?.advanced).toEqual(
      DEFAULT_APP_SETTINGS.liquidGlass!.advanced,
    )
  })

  it('normalizes manual mirror URL overrides', async () => {
    const ctx = await harness({
      npmRegistryUrl: 'https://registry.example.com/ ',
      githubRawBaseUrl: '',
    })
    await ctx.plugin(SettingsPlugin)
    await tick()

    const settings = await ctx.settings.get()
    expect(settings.npmRegistryUrl).toBe('https://registry.example.com')
    expect(settings.githubRawBaseUrl).toBeUndefined()

    // Clearing via update falls back to the region-derived default.
    const updated = await ctx.settings.update({ npmRegistryUrl: '   ' })
    expect(updated.npmRegistryUrl).toBeUndefined()
  })

  it('defaults new installs to follow-system without touching stored choices', async () => {
    // Fresh install: no stored language → the 'system' default, resolved
    // against the OS locale at runtime by ctx.i18n (BCP 47 → en fallback).
    const fresh = await harness()
    await fresh.plugin(SettingsPlugin)
    await tick()
    expect(DEFAULT_APP_SETTINGS.language).toBe('system')
    expect(fresh.settings.getSync().language).toBe('system')

    // Existing user: a stored explicit choice always wins over the default —
    // changing the default must never rewrite it.
    const existing = await harness({ language: 'zh' })
    await existing.plugin(SettingsPlugin)
    await tick()
    expect(existing.settings.getSync().language).toBe('zh')
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
      { kind: 'settings', id: SETTINGS_VIEWS.shortcutsCard },
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

// ── proxy password custody ────────────────────────────────────────────────

class MemorySecrets extends Service {
  private map = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx, 'secrets')
  }

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key)
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }
  async clear(): Promise<void> {
    this.map.clear()
  }
  namespace(): MemorySecrets {
    return this
  }
  /** Test view of every entry, keyed as the service wrote it. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.map)
  }
}

describe('proxy password custody', () => {
  it('stores the password in secrets — never in the settings document', async () => {
    const ctx = await harness()
    await ctx.plugin(MemorySecrets)
    await ctx.plugin(SettingsPlugin)
    await tick()

    await ctx.settings.update({
      proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890, sourceRules: {} },
    })
    await ctx.settings.setProxyPassword('s3cret')
    expect(await ctx.settings.hasProxyPassword()).toBe(true)
    // The document the store holds carries no password field at all.
    const stored = await ctx.store.get<AppSettings>('preferences')
    expect((stored?.proxy as { password?: unknown }).password).toBeUndefined()
    expect(JSON.stringify(stored)).not.toContain('s3cret')
  })

  it('clears and reports absence', async () => {
    const ctx = await harness()
    await ctx.plugin(MemorySecrets)
    await ctx.plugin(SettingsPlugin)
    await tick()

    await ctx.settings.setProxyPassword('s3cret')
    await ctx.settings.clearProxyPassword()
    expect(await ctx.settings.hasProxyPassword()).toBe(false)
  })

  it('migrates a legacy plaintext password out of the settings document', async () => {
    const ctx = await harness()
    await ctx.store.set('preferences', {
      proxy: { enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890, password: 'legacy' },
    })
    await ctx.plugin(MemorySecrets)
    await ctx.plugin(SettingsPlugin)
    await tick()

    // The legacy value moved to the secret under this plugin's scope (the
    // shells read `<pluginScope>/proxy.password` from the same file) ...
    const secrets = ctx.secrets as unknown as MemorySecrets
    const entries = Object.entries(secrets.snapshot())
    const stored = entries.filter(([key, value]) => key.endsWith('proxy.password') && value === 'legacy')
    expect(stored).toHaveLength(1)
    // ... and the document stopped carrying it.
    const storedDoc = await ctx.store.get<AppSettings>('preferences')
    expect((storedDoc?.proxy as { password?: unknown }).password).toBeUndefined()
    expect(await ctx.settings.hasProxyPassword()).toBe(true)
  })

  it('merges never resurrect a password into the document', async () => {
    const ctx = await harness()
    await ctx.plugin(MemorySecrets)
    await ctx.plugin(SettingsPlugin)
    await tick()

    // A patch shaped like a hand-edited legacy document arrives.
    await ctx.settings.update({
      proxy: { enabled: true, host: '10.0.0.1', password: 'sneaky' },
    } as never)
    const stored = await ctx.store.get<AppSettings>('preferences')
    expect(JSON.stringify(stored)).not.toContain('sneaky')
  })

})
