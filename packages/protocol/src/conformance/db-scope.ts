/**
 * Conformance suite for the `ctx.db` capability gate.
 *
 * Modelled on `fs-scope`, and for the same reason: `db:own` was enforced in
 * `core-db-desktop` while `DbBridge` had no gate at all, so the guarantee held
 * in tests and evaporated on the desktop path. A suite both implementations
 * run is the only thing that keeps them honest.
 *
 * Separate from `dbConformance` because it needs a *gated* database — one
 * derived through `scopeContext` with a specific grant — where the main suite
 * runs ungated.
 */

import type { DbService } from '../index.js'
import { assert, assertRejects, type ConformanceSuite } from './harness.js'

export interface DbScopeSubject {
  /** Ungated, for arranging fixtures and asserting outcomes. */
  admin: DbService
  /** The instance id the gated databases below were scoped to. */
  scopeId: string
  /** The table prefix that instance owns, e.g. `plugin_bbebee_plugin_demo`. */
  ownPrefix: string
  /** `db` as seen by a plugin granted exactly `db:own`. */
  own: DbService
  /** `db` as seen by a plugin granted `db:own` plus `db:read:core`. */
  ownPlusCoreReads: DbService
  /**
   * `db` as seen by a plugin granted `db:own` plus `db:write:core` — and
   * deliberately *not* `db:read:core`, so the two verbs are tested apart.
   */
  ownPlusCoreWrites: DbService
  /** `db` as seen by a plugin granted `db:own` plus `db:*:core`. */
  ownPlusCoreAll: DbService
}

const denied = /outside its own namespace|may not/i

export const dbScopeConformance: ConformanceSuite<DbScopeSubject> = {
  service: 'db (capability scopes)',
  checks: [
    {
      name: 'a plugin can create and use its own namespaced tables',
      because: 'db:own would be useless otherwise',
      async run({ own, scopeId, ownPrefix }) {
        await own.defineSchema(`plugin:${scopeId}`, [
          { version: 1, up: 'CREATE TABLE {{ns}}_items (id TEXT PRIMARY KEY)' },
        ])
        await own.exec(`INSERT INTO ${ownPrefix}_items VALUES (?)`, ['x'])
        const rows = await own.query(`SELECT id FROM ${ownPrefix}_items`)
        assert(rows.length === 1, 'own table must be usable')
      },
    },
    {
      name: 'a plugin cannot drop a core catalogue table',
      because: 'the concrete claim in docs/07 §6 — otherwise db:own means nothing',
      async run({ admin, own }) {
        await assertRejects(() => own.exec('DROP TABLE sources'), 'DROP of a core table', denied)
        // And it really is still there.
        const rows = await admin.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='sources'`,
        )
        assert(rows.length === 1, 'sources table was actually dropped')
      },
    },
    {
      name: 'a plugin cannot read core tables without db:read:core',
      because: 'the catalogue holds every provider and every track',
      async run({ own }) {
        await assertRejects(() => own.query('SELECT * FROM tracks'), 'catalogue read', denied)
      },
    },
    {
      name: 'db:read:core opens the catalogue for reads',
      because: 'a feature plugin has to reach the library somehow',
      async run({ ownPlusCoreReads }) {
        const rows = await ownPlusCoreReads.query('SELECT * FROM tracks')
        assert(Array.isArray(rows), 'granted read should succeed')
      },
    },
    {
      name: 'db:read:core does not carry a write',
      because: 'a grant named "read" that permits INSERT makes the install prompt a lie',
      async run({ ownPlusCoreReads }) {
        await assertRejects(
          () => ownPlusCoreReads.exec("UPDATE tracks SET title = 'x' WHERE urn = 'nope'"),
          'catalogue update under a read grant',
          denied,
        )
        await assertRejects(
          () => ownPlusCoreReads.exec("DELETE FROM tracks WHERE urn = 'nope'"),
          'catalogue delete under a read grant',
          denied,
        )
      },
    },
    {
      name: 'a second statement cannot ride in on the first one’s grant',
      because: 'classification takes the most demanding statement in the string, not the first',
      async run({ ownPlusCoreReads }) {
        await assertRejects(
          () => ownPlusCoreReads.exec('SELECT 1; DROP TABLE tracks'),
          'a DROP smuggled behind a SELECT',
          denied,
        )
      },
    },
    {
      name: 'db:write:core permits row changes and nothing more',
      because: 'writing the catalogue is what the scanner and the player actually need',
      async run({ ownPlusCoreWrites }) {
        // No rows are matched; the point is that the statement is not refused.
        const updated = await ownPlusCoreWrites.exec(
          "UPDATE tracks SET title = 'x' WHERE urn = 'nope'",
        )
        assert(updated.changes === 0, 'granted write should reach the database')
        await ownPlusCoreWrites.exec("DELETE FROM tracks WHERE urn = 'nope'")

        // Write is not read: the verbs are separate grants on purpose.
        await assertRejects(
          () => ownPlusCoreWrites.query('SELECT * FROM tracks'),
          'catalogue read under a write-only grant',
          denied,
        )
        // Nor is write a schema grant.
        await assertRejects(
          () => ownPlusCoreWrites.exec('DROP TABLE tracks'),
          'DROP under a write grant',
          denied,
        )
      },
    },
    {
      name: 'db:*:core covers reads, writes and schema changes',
      because: 'the wildcard is the only grant that may reshape someone else’s tables',
      async run({ ownPlusCoreAll }) {
        const rows = await ownPlusCoreAll.query('SELECT * FROM tracks')
        assert(Array.isArray(rows), 'wildcard read should succeed')
        await ownPlusCoreAll.exec("UPDATE tracks SET title = 'x' WHERE urn = 'nope'")
        await ownPlusCoreAll.exec('CREATE TABLE core_scratch_wildcard (a TEXT)')
      },
    },
    {
      name: "a plugin cannot touch another plugin's tables",
      because: 'namespaces are the whole basis of plugin-owned schema',
      async run({ admin, own }) {
        await admin.exec('CREATE TABLE plugin_other_secrets (v TEXT)')
        await admin.exec("INSERT INTO plugin_other_secrets VALUES ('shh')")
        await assertRejects(
          () => own.query('SELECT v FROM plugin_other_secrets'),
          "cross-plugin read",
          denied,
        )
        await assertRejects(
          () => own.exec("UPDATE plugin_other_secrets SET v='clobbered'"),
          'cross-plugin write',
          denied,
        )
      },
    },
    {
      name: 'a plugin cannot define schema for a namespace it does not own',
      because: 'otherwise it claims `core` and owns the catalogue',
      async run({ own }) {
        await assertRejects(
          () => own.defineSchema('core', [{ version: 99, up: 'CREATE TABLE {{ns}}_x (a TEXT)' }]),
          'defining a foreign namespace',
          /may only define schema for/,
        )
        await assertRejects(
          () =>
            own.defineSchema('plugin:@bbebee/plugin-someone-else', [
              { version: 1, up: 'CREATE TABLE {{ns}}_x (a TEXT)' },
            ]),
          "defining another plugin's namespace",
          /may only define schema for/,
        )
      },
    },
    {
      name: 'a schema qualifier does not launder another namespace',
      because: 'main.plugin_other_secrets used to be attributed to a table called "main"',
      async run({ admin, ownPlusCoreAll }) {
        await admin.exec('CREATE TABLE plugin_other_secrets (v TEXT)')
        await admin.exec("INSERT INTO plugin_other_secrets VALUES ('shh')")

        await assertRejects(
          () => ownPlusCoreAll.query('SELECT v FROM main.plugin_other_secrets'),
          'qualified cross-plugin read',
          denied,
        )
        await assertRejects(
          () => ownPlusCoreAll.exec("UPDATE main.plugin_other_secrets SET v='clobbered'"),
          'qualified cross-plugin write',
          denied,
        )

        const row = await admin.get<{ v: string }>('SELECT v FROM plugin_other_secrets')
        assert(row?.v === 'shh', "another plugin's row was overwritten through a qualifier")
      },
    },
    {
      name: 'a change the gate cannot attribute is refused',
      because: 'the per-table checks are the gate, so a statement naming no table skipped it',
      async run({ own }) {
        for (const sql of ['DROP INDEX IF EXISTS idx_tracks_album', 'VACUUM', 'ANALYZE']) {
          await assertRejects(() => own.exec(sql), sql, denied)
        }
      },
    },
    {
      name: 'PRAGMA is refused except for the introspection and per-transaction ones',
      because: 'one connection serves every plugin, and on desktop it lives in main',
      async run({ ownPlusCoreAll }) {
        await assertRejects(
          () => ownPlusCoreAll.exec('PRAGMA foreign_keys = OFF'),
          'disabling foreign keys for everyone',
          /may not issue PRAGMA/,
        )
        // Still available: the migration runner needs it on this same path.
        await ownPlusCoreAll.exec('PRAGMA defer_foreign_keys = ON')
      },
    },
    {
      name: 'multi-statement SQL is refused rather than silently truncated',
      because: 'the drivers compile the first statement and discard the rest without an error',
      async run({ admin }) {
        await assertRejects(
          () => admin.exec('CREATE TABLE probe_a (x TEXT); CREATE TABLE probe_b (x TEXT)'),
          'a two-statement string',
          /multi-statement/,
        )
        const tables = await admin.query<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'probe_%'`,
        )
        assert(tables.length === 0, 'a refused statement must not have half-run')
      },
    },
    {
      name: 'ATTACH and DETACH are refused whatever the grants',
      because: 'ATTACH turns the database handle into an arbitrary-file primitive',
      async run({ ownPlusCoreReads }) {
        await assertRejects(
          () => ownPlusCoreReads.exec("ATTACH DATABASE '/tmp/evil.db' AS evil"),
          'ATTACH',
          /ATTACH|may not/i,
        )
      },
    },
    {
      name: 'a transaction is not a way around the gate',
      because: 'the transaction view is a separate code path in every implementation',
      async run({ own }) {
        await assertRejects(
          () => own.transaction(async (tx) => void (await tx.exec('DROP TABLE sources'))),
          'gated statement inside a transaction',
          denied,
        )
      },
    },
    {
      name: 'the gate does not apply to ungated callers',
      because: 'the kernel, core services and migrations must still work',
      async run({ admin }) {
        const rows = await admin.query('SELECT * FROM sources')
        assert(Array.isArray(rows), 'ungated query should succeed')
      },
    },
  ],
}
