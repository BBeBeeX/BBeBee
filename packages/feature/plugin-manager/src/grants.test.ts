import { describe, expect, it } from 'vitest'
import type { DbService } from '@BBeBee/protocol'
import { CapabilityGrantLedger } from './grants.js'

/**
 * In-memory stand-in for the two core tables the ledger touches. It
 * pattern-matches the ledger's fixed SQL and enforces the foreign key
 * the real databases run with: a `capability_grants` row without its
 * `plugin_records` parent throws, so a broken write order in the
 * ledger fails here, not in production.
 */
function createFakeDb() {
  const records = new Map<string, { version: string; source: string }>()
  const grants = new Map<string, string[]>()

  const db = {
    async exec(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.startsWith('INSERT INTO plugin_records')) {
        records.set(String(params[0]), { version: String(params[1]), source: String(params[2]) })
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM capability_grants')) {
        return { changes: grants.delete(String(params[0])) ? 1 : 0, lastInsertRowid: 0 }
      }
      if (s.startsWith('INSERT INTO capability_grants')) {
        const pluginId = String(params[0])
        if (!records.has(pluginId)) throw new Error('FOREIGN KEY constraint failed')
        const list = grants.get(pluginId) ?? []
        list.push(String(params[1]))
        grants.set(pluginId, list)
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM plugin_records')) {
        grants.delete(String(params[0])) // ON DELETE CASCADE
        records.delete(String(params[0]))
        return { changes: 1, lastInsertRowid: 0 }
      }
      throw new Error(`fake db: unexpected exec: ${s}`)
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

describe('CapabilityGrantLedger', () => {
  it('records grants per plugin, creating the plugin_records parent the FK requires', async () => {
    const { db, records, grants } = createFakeDb()
    const ledger = new CapabilityGrantLedger(db)

    await ledger.record('ext-audio', ['audio'], { version: '0.1.0' })
    await ledger.record('ext-net', ['net:host/api.example.com', 'fs:read:all'], { version: '2.0.0' })

    expect(Object.fromEntries(grants)).toEqual({
      'ext-audio': ['audio'],
      'ext-net': ['net:host/api.example.com', 'fs:read:all'],
    })
    expect(records.get('ext-audio')).toEqual({ version: '0.1.0', source: 'npm' })
  })

  it('replaces rather than merges: a dropped capability stops being granted', async () => {
    const { db, grants } = createFakeDb()
    const ledger = new CapabilityGrantLedger(db)

    await ledger.record('ext-audio', ['audio', 'fs:read:all'], { version: '0.1.0' })
    await ledger.record('ext-audio', ['audio'], { version: '0.1.1' })

    expect(grants.get('ext-audio')).toEqual(['audio'])
  })

  it('recording an empty set clears grants but keeps the install on record', async () => {
    const { db, records, grants } = createFakeDb()
    const ledger = new CapabilityGrantLedger(db)

    await ledger.record('ext-audio', ['audio'], { version: '0.1.0' })
    await ledger.record('ext-audio', [], { version: '0.2.0' })

    expect(grants.has('ext-audio')).toBe(false)
    expect(records.has('ext-audio')).toBe(true)
  })

  it('revoke removes the grants and the parent row', async () => {
    const { db, records, grants } = createFakeDb()
    const ledger = new CapabilityGrantLedger(db)

    await ledger.record('ext-audio', ['audio'], { version: '0.1.0' })
    await ledger.revoke('ext-audio')

    expect(grants.has('ext-audio')).toBe(false)
    expect(records.has('ext-audio')).toBe(false)
  })

  it('deduplicates a manifest that lists a capability twice', async () => {
    const { db, grants } = createFakeDb()
    const ledger = new CapabilityGrantLedger(db)

    await ledger.record('ext-audio', ['audio', 'audio'], { version: '0.1.0' })

    expect(grants.get('ext-audio')).toEqual(['audio'])
  })
})
