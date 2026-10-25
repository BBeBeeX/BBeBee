/**
 * MD-4 on the *other* driver.
 *
 * The reason this file exists is the reason MD-4 exists: `db:own` was enforced
 * in `core-db-desktop` and not in `core-db-mobile`, so the same manifest string
 * meant one thing on desktop and nothing on mobile — and nothing said so,
 * because the suite only ever ran against one implementation. M1's definition
 * of done asks for the `db-scope` suite on both, so here is the second.
 *
 * `expo-sqlite` is aliased to `node:sqlite` behind the Expo surface
 * (`test/stubs/expo-sqlite.ts`), so the statements really run against SQLite.
 * What stays on the device is the SDK's own SQLite *build* — its version, and
 * therefore `contentless_delete=1` (docs/11 §8).
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { nsPrefix, scopeContext } from '@BBeBee/kernel'
import { dbScopeConformance } from '@BBeBee/protocol/conformance'
import { DbExpo } from './index.js'

const SCOPE = '@bbebee/plugin-demo'

async function gated(grants: string[], scopeId = SCOPE) {
  const ctx = new Context()
  await ctx.plugin(DbExpo, { databaseName: ':memory:' })
  const scoped = scopeContext(ctx, {
    pluginId: scopeId,
    scopeId,
    requested: grants as never,
  })
  return { admin: ctx.db, db: scoped.db }
}

describe('db:own on expo-sqlite', () => {
  it('permits the plugin its own namespaced tables', async () => {
    const { db } = await gated(['db:own'])
    await db.defineSchema(`plugin:${SCOPE}`, [
      { version: 1, up: 'CREATE TABLE {{ns}}_items (id TEXT)' },
    ])
    await expect(
      db.exec(`INSERT INTO ${nsPrefix(`plugin:${SCOPE}`)}_items VALUES (?)`, ['x']),
    ).resolves.toMatchObject({ changes: 1 })
  })

  it('refuses a core catalogue table', async () => {
    const { db } = await gated(['db:own'])
    await expect(db.exec('DROP TABLE sources')).rejects.toThrow(/outside its own namespace/)
    await expect(db.query('SELECT * FROM tracks')).rejects.toThrow(/outside its own namespace/)
  })

  it('refuses ATTACH regardless of grants', async () => {
    // An arbitrary-file primitive if it got through, on either platform.
    const { db } = await gated(['db:own', 'db:read:core'])
    await expect(db.exec("ATTACH DATABASE '/tmp/x.db' AS x")).rejects.toThrow(/may not issue ATTACH/)
  })

  it('leaves ungated callers alone', async () => {
    const { admin } = await gated(['db:own'])
    await expect(admin.query('SELECT * FROM tracks')).resolves.toEqual([])
  })
})

describe('core-db-mobile db-scope conformance', () => {
  for (const check of dbScopeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { admin, db } = await gated(['db:own'])
      const { db: reads } = await gated(['db:own', 'db:read:core'])
      const { db: writes } = await gated(['db:own', 'db:write:core'])
      const { db: all } = await gated(['db:own', 'db:*:core'])
      await check.run({
        admin,
        scopeId: SCOPE,
        ownPrefix: nsPrefix(`plugin:${SCOPE}`),
        own: db,
        ownPlusCoreReads: reads,
        ownPlusCoreWrites: writes,
        ownPlusCoreAll: all,
      })
    })
  }
})
