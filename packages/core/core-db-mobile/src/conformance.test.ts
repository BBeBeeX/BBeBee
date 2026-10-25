/**
 * `core-db-mobile` against the shared conformance suite.
 *
 * The twin of `core-db-desktop`'s, and the point of a suite is that both run it:
 * "the same migrations, the same conformance suite, only the driver differs"
 * is a claim this file either supports or refutes.
 *
 * `expo-sqlite` is aliased to `node:sqlite` behind the Expo surface, so the
 * statements run against real SQLite. What is genuinely device-only is the
 * SDK's SQLite *version* — `assertSqliteVersion` and `contentless_delete=1`
 * (docs/11 §8) — which the smoke matrix covers.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { dbConformance } from '@BBeBee/protocol/conformance'
import type { DbService } from '@BBeBee/protocol'
import { DbExpo } from './index.js'

async function freshDb(opts: { skipCoreMigrations?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(DbExpo, {
    databaseName: ':memory:',
    skipCoreMigrations: opts.skipCoreMigrations ?? true,
  })
  return ctx
}

describe('core-db-mobile conformance', () => {
  for (const check of dbConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await freshDb()
      const db: DbService = ctx.db
      await check.run({ db, reset: async () => undefined })
    })
  }
})

describe('core-db-mobile specifics', () => {
  it('applies the core schema on startup', async () => {
    const ctx = await freshDb({ skipCoreMigrations: false })
    const tables = await ctx.db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    const names = new Set(tables.map((t) => t.name))
    for (const expected of ['tracks', 'playlists', 'download_tasks', 'schema_migrations']) {
      expect(names, `missing ${expected}`).toContain(expected)
    }
  })

  it('enables foreign keys, so deleting a source cascades', async () => {
    const ctx = await freshDb()
    const fk = await ctx.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(fk?.foreign_keys).toBe(1)
  })

  it('refuses a multi-statement string rather than running half of it', async () => {
    // Both drivers execute one statement per call and discard the rest in
    // silence, which would let a migration record a version it half-applied.
    const ctx = await freshDb()
    await expect(
      ctx.db.exec('CREATE TABLE a (x TEXT); CREATE TABLE b (y TEXT)'),
    ).rejects.toThrow(/statement/i)
  })

  it('serialises concurrent writes rather than interleaving them', async () => {
    const ctx = await freshDb()
    await ctx.db.exec('CREATE TABLE t (n INTEGER)')

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ctx.db.transaction(async (tx) => {
          await tx.exec('INSERT INTO t VALUES (?)', [i])
        }),
      ),
    )

    const rows = await ctx.db.query<{ n: number }>('SELECT n FROM t ORDER BY n')
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('executes a batch in one transaction — all of it or none of it', async () => {
    // The mobile twin of the node batch path: no IPC to amortize, but the
    // same all-or-nothing semantics for bulk writes.
    const ctx = await freshDb()
    await ctx.db.exec('CREATE TABLE t (n INTEGER)')

    const results = await ctx.db.execBatch?.([
      { sql: 'INSERT INTO t VALUES (?)', params: [1] },
      { sql: 'INSERT INTO t VALUES (?)', params: [2] },
    ])
    expect(results?.map((r) => r.changes)).toEqual([1, 1])

    // A batch whose second statement is refused runs none of it: the guard
    // pass rejects before the transaction is ever entered.
    await expect(
      ctx.db.execBatch?.([
        { sql: 'INSERT INTO t VALUES (?)', params: [3] },
        { sql: 'CREATE TABLE a (x TEXT); CREATE TABLE b (y TEXT)' },
      ]),
    ).rejects.toThrow(/statement/i)
    const rows = await ctx.db.query<{ n: number }>('SELECT n FROM t ORDER BY n')
    expect(rows.map((r) => r.n)).toEqual([1, 2])
  })

  it('closes the database when the plugin unloads', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(DbExpo, {
      databaseName: ':memory:',
      skipCoreMigrations: true,
    })
    await fiber.dispose()
    expect(ctx.db).toBeUndefined()
  })
})
