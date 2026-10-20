import { describe, expect, it, vi } from 'vitest'
import type { DbService, PluginManifest } from '@BBeBee/protocol'
import { createApp } from '../bootstrap/app.js'
import { readCapabilityGrants } from './grants.js'

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
