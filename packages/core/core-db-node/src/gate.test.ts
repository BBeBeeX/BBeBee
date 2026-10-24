/**
 * `db:own`.
 *
 * The capability existed as a manifest string with no enforcement while
 * docs/07 §6 claimed the gate "rejects statements referencing other
 * namespaces' prefixes". These pin the behaviour the doc describes.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { nsPrefix, scopeContext, tablesReferenced } from '@BBeBee/kernel'
import { dbScopeConformance } from '@BBeBee/protocol/conformance'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '../src/index.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string
beforeAll(async () => { root = await tempDir('bbebee-dbgate') })
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

async function gated(grants: string[], scopeId = '@bbebee/plugin-demo') {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await mkdtemp(join(root, 'c-')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  const scoped = scopeContext(ctx, {
    pluginId: scopeId, scopeId, requested: grants as never,
  })
  return { admin: ctx.db, db: scoped.db, ctx }
}

describe('tablesReferenced', () => {
  it('finds the tables a statement touches', () => {
    expect(tablesReferenced('SELECT * FROM tracks').sort()).toEqual(['tracks'])
    expect(tablesReferenced('INSERT INTO plugin_x_notes (a) VALUES (1)')).toEqual(['plugin_x_notes'])
    expect(tablesReferenced('UPDATE sources SET a=1')).toEqual(['sources'])
    expect(tablesReferenced('SELECT * FROM a JOIN b ON a.id=b.id').sort()).toEqual(['a', 'b'])
    expect(tablesReferenced('CREATE TABLE IF NOT EXISTS z (a TEXT)')).toEqual(['z'])
  })
})

describe('db:own', () => {
  it('permits the plugin its own namespaced tables', async () => {
    const { db } = await gated(['db:own'])
    await db.defineSchema('plugin:@bbebee/plugin-demo', [
      { version: 1, up: 'CREATE TABLE {{ns}}_items (id TEXT)' },
    ])
    await expect(
      db.exec('INSERT INTO plugin_bbebee_plugin_demo_items VALUES (?)', ['x']),
    ).resolves.toMatchObject({ changes: 1 })
  })

  it('refuses a core catalogue table', async () => {
    // The concrete claim: a plugin cannot DROP TABLE sources.
    const { db } = await gated(['db:own'])
    await expect(db.exec('DROP TABLE sources')).rejects.toThrow(/outside its own namespace/)
    await expect(db.query('SELECT * FROM tracks')).rejects.toThrow(/outside its own namespace/)
  })

  it('refuses another plugin tables', async () => {
    const { db } = await gated(['db:own'])
    await expect(db.query('SELECT * FROM plugin_other_secrets')).rejects.toThrow(
      /outside its own namespace/,
    )
  })

  it('db:read:core opens the catalogue for reads', async () => {
    const { db } = await gated(['db:own', 'db:read:core'])
    await expect(db.query('SELECT * FROM tracks')).resolves.toEqual([])
  })

  it('refuses defining a namespace the plugin does not own', async () => {
    // Otherwise `db:own` means nothing: claim `core` and own the catalogue.
    const { db } = await gated(['db:own'])
    await expect(
      db.defineSchema('core', [{ version: 99, up: 'CREATE TABLE {{ns}}_x (a TEXT)' }]),
    ).rejects.toThrow(/may only define schema for/)
  })

  it('refuses ATTACH regardless of grants', async () => {
    const { db } = await gated(['db:own', 'db:read:core'])
    await expect(db.exec("ATTACH DATABASE '/tmp/x.db' AS x")).rejects.toThrow(/may not issue ATTACH/)
  })

  it('leaves ungated callers alone', async () => {
    // The kernel, core services and tests are trusted; only plugins are gated.
    const { admin } = await gated(['db:own'])
    await expect(admin.query('SELECT * FROM tracks')).resolves.toEqual([])
  })
})

describe('core-db-node db-scope conformance', () => {
  for (const check of dbScopeConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const scopeId = '@bbebee/plugin-demo'
      const { admin, db } = await gated(['db:own'], scopeId)
      const { db: reads } = await gated(['db:own', 'db:read:core'], scopeId)
      const { db: writes } = await gated(['db:own', 'db:write:core'], scopeId)
      const { db: all } = await gated(['db:own', 'db:*:core'], scopeId)
      await check.run({
        admin,
        scopeId,
        ownPrefix: nsPrefix(`plugin:${scopeId}`),
        own: db,
        ownPlusCoreReads: reads,
        ownPlusCoreWrites: writes,
        ownPlusCoreAll: all,
      })
    })
  }
})
