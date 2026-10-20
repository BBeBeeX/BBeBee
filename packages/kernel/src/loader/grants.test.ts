import { describe, expect, it, vi } from 'vitest'
import {
  PLUGIN_MANAGER_ID,
  PLUGIN_SETTINGS_ID,
  type DbService,
  type PluginManifest,
} from '@BBeBee/protocol'
import { createApp } from '../bootstrap/app.js'
import {
  createShellGrantResolver,
  readCapabilityGrants,
  readConfiguredAppSettings,
  withManagerPipelineGrants,
} from './grants.js'

/**
 * In-memory stand-in for the two core tables the grants flow touches.
 * `readCapabilityGrants` only ever SELECTs, so the write methods exist
 * to fail loudly if that ever changes; arrangements seed the maps
 * directly (the write side — plugin-manager's grant ledger — has its
 * own suite in that package).
 */
function createFakeDb() {
  const records = new Map<string, { version: string; source: string }>()
  const grants = new Map<string, string[]>()

  const db = {
    async exec(sql: string) {
      throw new Error(`fake db: read-side suite, unexpected exec: ${sql}`)
    },
    async query<T>(sql: string): Promise<T[]> {
      if (sql.includes('FROM capability_grants')) {
        return [...grants.entries()].flatMap(([plugin_id, caps]) =>
          caps.map((capability) => ({ plugin_id, capability })),
        ) as T[]
      }
      throw new Error(`fake db: unexpected query: ${sql}`)
    },
    async get() {
      return undefined
    },
    async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
      return fn(db as unknown as DbService)
    },
  }
  return { db: db as unknown as DbService, records, grants }
}

/** Seed one plugin's approval exactly as the ledger would have written it. */
function seedGrant(fake: ReturnType<typeof createFakeDb>, pluginId: string, caps: string[]) {
  fake.records.set(pluginId, { version: '1.0.0', source: 'npm' })
  fake.grants.set(pluginId, [...caps])
}

function manifest(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    engines: { BBeBee: '^1.0.0' },
    entry: { main: './index.js' },
    capabilities: [],
    ...over,
  }
}

describe('readCapabilityGrants', () => {
  it('aggregates rows per plugin into the loader shape', async () => {
    const fake = createFakeDb()
    seedGrant(fake, 'ext-audio', ['audio'])
    seedGrant(fake, 'ext-net', ['net:host/api.example.com', 'fs:read:all'])

    await expect(readCapabilityGrants(fake.db)).resolves.toEqual({
      'ext-audio': ['audio'],
      'ext-net': ['net:host/api.example.com', 'fs:read:all'],
    })
  })

  it('reads an empty table as no grants', async () => {
    const fake = createFakeDb()
    await expect(readCapabilityGrants(fake.db)).resolves.toEqual({})
  })
})

describe('grant wiring through createApp (resolveGrants)', () => {
  const resolveFromDb = async (ctx: unknown) => {
    const db = (ctx as { db?: DbService }).db
    return db ? readCapabilityGrants(db) : undefined
  }

  function gatedApp(fake: ReturnType<typeof createFakeDb>, applied: () => void) {
    return createApp({
      target: 'desktop',
      bootstrap: [
        (ctx) => {
          ctx.provide('db', fake.db as never)
        },
      ],
      registry: {
        'ext-tool': {
          plugin: { name: 'ext-tool', apply: applied } as never,
          manifest: manifest('ext-tool', { capabilities: ['audio'] }),
          // no `builtin` — a third-party plugin, so the gate applies
        },
      },
      config: { plugins: { 'ext-tool': {} } },
      resolveGrants: resolveFromDb,
    })
  }

  it('boots a capability-bearing third-party plugin whose grants are on record', async () => {
    const fake = createFakeDb()
    seedGrant(fake, 'ext-tool', ['audio'])
    const applied = vi.fn()
    const app = gatedApp(fake, applied)

    await app.start()

    expect(app.plugins.find((p) => p.pluginId === 'ext-tool')?.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
    await app.stop()
  })

  it('keeps the gate closed at boot when no grant exists', async () => {
    const fake = createFakeDb()
    const applied = vi.fn()
    const app = gatedApp(fake, applied)

    await app.start()

    expect(app.plugins.find((p) => p.pluginId === 'ext-tool')?.state).toBe('ungranted')
    expect(applied).not.toHaveBeenCalled()
    await app.stop()
  })

  it('a grant recorded mid-session is honoured by the next dynamic load (no restart)', async () => {
    const fake = createFakeDb()
    const applied = vi.fn()
    const app = gatedApp(fake, applied)

    await app.start()
    expect(app.plugins.find((p) => p.pluginId === 'ext-tool')?.state).toBe('ungranted')

    // What plugin-manager does on a confirmed install: the ledger write
    // lands in the table, then activation goes through app.loadPlugin.
    seedGrant(fake, 'ext-tool', ['audio'])
    const result = await app.loadPlugin('ext-tool')

    expect(result.state).toBe('active')
    expect(applied).toHaveBeenCalledTimes(1)
    await app.stop()
  })

  it('a revoked grant closes the gate again on the next load', async () => {
    const fake = createFakeDb()
    seedGrant(fake, 'ext-tool', ['audio'])
    const applied = vi.fn()
    const app = gatedApp(fake, applied)

    await app.start()
    expect(app.plugins.find((p) => p.pluginId === 'ext-tool')?.state).toBe('active')

    await app.unloadPlugin('ext-tool')
    fake.grants.delete('ext-tool')
    fake.records.delete('ext-tool')
    const result = await app.loadPlugin('ext-tool')

    expect(result.state).toBe('ungranted')
    await app.stop()
  })

  it('a failing resolver fails closed (static load options, gate shut)', async () => {
    const fake = createFakeDb()
    seedGrant(fake, 'ext-tool', ['audio'])
    const applied = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx) => {
          ctx.provide('db', fake.db as never)
        },
      ],
      registry: {
        'ext-tool': {
          plugin: { name: 'ext-tool', apply: applied } as never,
          manifest: manifest('ext-tool', { capabilities: ['audio'] }),
        },
      },
      config: { plugins: { 'ext-tool': {} } },
      resolveGrants: async () => {
        throw new Error('db unavailable')
      },
    })

    await app.start()

    expect(app.plugins.find((p) => p.pluginId === 'ext-tool')?.state).toBe('ungranted')
    expect(applied).not.toHaveBeenCalled()
    await app.stop()
  })
})

describe('withManagerPipelineGrants (settings-derived pipeline hosts)', () => {
  const MANIFEST_CAPS = ['db:read:core', 'db:write:core', 'net:host/registry.npmjs.org']

  it('unions ledger rows, manifest capabilities and the derived hosts — never replaces', () => {
    const out = withManagerPipelineGrants(
      { [PLUGIN_MANAGER_ID]: ['net:host/ledger.example.com'], 'ext-audio': ['audio'] },
      MANIFEST_CAPS,
      { npmRegistryUrl: 'https://npm.example.corp' },
    )
    const entry = out[PLUGIN_MANAGER_ID]!
    // Ledger row survives (a present `granted` entry replaces the
    // manifest in scopeContext, so dropping it here would strip it).
    expect(entry).toContain('net:host/ledger.example.com')
    // Manifest capabilities survive.
    expect(entry).toContain('db:read:core')
    expect(entry).toContain('db:write:core')
    // Derived: built-ins (incl. the npmmirror redirect companion) and
    // the user's custom registry host.
    expect(entry).toContain('net:host/cdn.npmmirror.com')
    expect(entry).toContain('net:host/raw.githubusercontent.com')
    expect(entry).toContain('net:host/npm.example.corp')
    // Deduped (registry.npmjs.org was both a manifest cap and derived).
    expect(entry.filter((c) => c === 'net:host/registry.npmjs.org')).toHaveLength(1)
    // No other plugin is touched, and no entry is invented for anyone else.
    expect(out['ext-audio']).toEqual(['audio'])
    expect(Object.keys(out).sort()).toEqual([PLUGIN_MANAGER_ID, 'ext-audio'].sort())
  })

  it('with no ledger and no settings, the entry is manifest ∪ built-in derived set', () => {
    const out = withManagerPipelineGrants({}, MANIFEST_CAPS, undefined)
    const entry = out[PLUGIN_MANAGER_ID]!
    for (const cap of MANIFEST_CAPS) expect(entry).toContain(cap)
    for (const host of [
      'registry.npmjs.org',
      'registry.npmmirror.com',
      'cdn.npmmirror.com',
      'raw.githubusercontent.com',
      'cdn.jsdelivr.net',
      'fastly.jsdelivr.net',
    ]) {
      expect(entry).toContain(`net:host/${host}`)
    }
    // Exactly the union — nothing else leaks in.
    expect(new Set(entry).size).toBe(entry.length)
    expect(entry).toHaveLength(MANIFEST_CAPS.length + 5)
  })

  it('introduces no wildcard grants', () => {
    const out = withManagerPipelineGrants({}, MANIFEST_CAPS, {
      npmRegistryUrl: 'https://npm.example.corp',
      githubRawBaseUrl: 'https://ghproxy.example.com/https://raw.githubusercontent.com/x/y/main',
    })
    for (const cap of out[PLUGIN_MANAGER_ID]!) {
      expect(cap).not.toContain('*')
    }
    expect(out[PLUGIN_MANAGER_ID]).toContain('net:host/ghproxy.example.com')
  })
})

describe('readConfiguredAppSettings', () => {
  it('prefers the live settings service when it exists', async () => {
    const ctx = {
      settings: { getSync: () => ({ downloadRegion: 'mainland-china' }) },
      store: {
        namespace: () => {
          throw new Error('store must not be consulted when the live service answers')
        },
      },
    }
    await expect(readConfiguredAppSettings(ctx as never)).resolves.toEqual({
      downloadRegion: 'mainland-china',
    })
  })

  it('falls back to the persisted document in the settings namespace (the boot pass)', async () => {
    const seen: Array<[string, string]> = []
    const ctx = {
      store: {
        namespace: (ns: string) => ({
          get: async (key: string) => {
            seen.push([ns, key])
            return { npmRegistryUrl: 'https://npm.example.corp' }
          },
        }),
      },
    }
    await expect(readConfiguredAppSettings(ctx as never)).resolves.toEqual({
      npmRegistryUrl: 'https://npm.example.corp',
    })
    expect(seen).toEqual([[PLUGIN_SETTINGS_ID, 'preferences']])
  })

  it('a throwing live service falls through to the persisted document; total failure is undefined', async () => {
    const ctx = {
      settings: {
        getSync: () => {
          throw new Error('half-initialised')
        },
      },
      store: {
        namespace: () => ({
          get: async () => {
            throw new Error('store down')
          },
        }),
      },
    }
    await expect(readConfiguredAppSettings(ctx as never)).resolves.toBeUndefined()
    await expect(readConfiguredAppSettings({} as never)).resolves.toBeUndefined()
  })
})

describe('createShellGrantResolver (the boots’ composition)', () => {
  it('layers the derived hosts over ledger + manifest; undefined without a db', async () => {
    const fake = createFakeDb()
    seedGrant(fake, 'ext-tool', ['audio'])
    const resolver = createShellGrantResolver({
      managerManifestCapabilities: ['db:read:core', 'db:write:core'],
    })
    const ctx = {
      db: fake.db,
      store: {
        namespace: () => ({
          get: async () => ({ npmRegistryUrl: 'https://npm.example.corp' }),
        }),
      },
    }
    const out = await resolver(ctx as never)
    expect(out?.['ext-tool']).toEqual(['audio'])
    expect(out?.[PLUGIN_MANAGER_ID]).toContain('db:read:core')
    expect(out?.[PLUGIN_MANAGER_ID]).toContain('net:host/npm.example.corp')
    expect(out?.[PLUGIN_MANAGER_ID]).toContain('net:host/cdn.npmmirror.com')

    await expect(resolver({} as never)).resolves.toBeUndefined()
  })
})
