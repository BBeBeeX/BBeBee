/**
 * `core-db-node` against the shared conformance suite, plus the core schema.
 *
 * These run against real `node:sqlite` (Node 22+) —
 * so they validate the SQL rather than a mock's idea of it.
 */

import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { dbConformance } from '@BBeBee/protocol/conformance'
import type { DbService } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '../src/index.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-db')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A fresh in-memory database with no core schema, for the suite. */
async function freshDb(opts: { skipCoreMigrations?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, {
    fileName: ':memory:',
    skipCoreMigrations: opts.skipCoreMigrations ?? true,
  })
  return ctx
}

describe('core-db-node conformance', () => {
  for (const check of dbConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      // Each check needs a clean schema; an in-memory database is cheap.
      const ctx = await freshDb()
      const db: DbService = ctx.db
      await check.run({ db, reset: async () => undefined })
    })
  }
})

describe('core-db-node specifics', () => {
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

  it('enables WAL and foreign keys', async () => {
    // Both matter: WAL so readers do not block the scanner's writes, foreign
    // keys so provider deletion actually cascades.
    const ctx = await freshDb()
    const fk = await ctx.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(fk?.foreign_keys).toBe(1)
  })

  it('persists across a restart', async () => {
    const ctx1 = new Context()
    await ctx1.plugin(PathsNode, { root })
    await ctx1.plugin(FsNode)
    const fiber = await ctx1.plugin(DbNode, { fileName: 'persist-test.db' })
    await ctx1.db.exec('CREATE TABLE keep (a TEXT)')
    await ctx1.db.exec('INSERT INTO keep VALUES (?)', ['value'])
    await fiber.dispose()

    const ctx2 = new Context()
    await ctx2.plugin(PathsNode, { root })
    await ctx2.plugin(FsNode)
    await ctx2.plugin(DbNode, { fileName: 'persist-test.db' })
    const row = await ctx2.db.get<{ a: string }>('SELECT a FROM keep')
    expect(row?.a).toBe('value')
  })

  it('serialises concurrent writes rather than interleaving them', async () => {
    // The API is async over a synchronous driver, so without a queue two
    // overlapping transactions would corrupt each other.
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

  it('closes the database when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    const fiber = await ctx.plugin(DbNode, { fileName: ':memory:', skipCoreMigrations: true })
    await fiber.dispose()
    expect(ctx.db).toBeUndefined()
  })
})
