/**
 * Conformance suite for `ctx.db`.
 *
 * `core-db-desktop` and `core-db-mobile` drive different SQLite bindings, so the
 * behaviours the rest of the app relies on — transaction atomicity above all —
 * have to be asserted against both.
 */

import type { DbService } from '../index.js'
import { assert, assertEqual, assertRejects, type ConformanceSuite } from './harness.js'

export interface DbSubject {
  db: DbService
  /** A fresh, empty database. Each check gets its own. */
  reset(): Promise<void>
}

export const dbConformance: ConformanceSuite<DbSubject> = {
  service: 'db',
  checks: [
    {
      name: 'round-trips every SqlValue type',
      because: 'catalogue rows hold text, numbers, nulls, and artwork blobs',
      async run({ db }) {
        await db.exec('CREATE TABLE t (s TEXT, n INTEGER, f REAL, z TEXT, b BLOB)')
        const bytes = new Uint8Array([0, 1, 250, 255])
        await db.exec('INSERT INTO t VALUES (?, ?, ?, ?, ?)', ['text', 42, 1.5, null, bytes])

        const row = await db.get<{ s: string; n: number; f: number; z: null; b: Uint8Array }>(
          'SELECT * FROM t',
        )
        assert(row !== undefined, 'row should exist')
        assertEqual(row.s, 'text', 'text')
        assertEqual(row.n, 42, 'integer')
        assertEqual(row.f, 1.5, 'real')
        assertEqual(row.z, null, 'null')
        assertEqual(Array.from(row.b), [0, 1, 250, 255], 'blob')
      },
    },
    {
      name: 'get() returns undefined for no rows',
      because: 'callers distinguish "absent" from "null column"',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        assert((await db.get('SELECT * FROM t')) === undefined, 'empty result is undefined')
      },
    },
    {
      name: 'query() returns an empty array for no rows',
      because: 'list rendering maps over the result without a null check',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        assertEqual(await db.query('SELECT * FROM t'), [], 'empty result')
      },
    },
    {
      name: 'exec reports changes and lastInsertRowid',
      because: 'the FTS mapping table depends on the rowid it just inserted',
      async run({ db }) {
        await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT)')
        const first = await db.exec('INSERT INTO t (a) VALUES (?)', ['x'])
        assertEqual(first.changes, 1, 'changes')
        assert(first.lastInsertRowid > 0, 'lastInsertRowid should be positive')

        const second = await db.exec('INSERT INTO t (a) VALUES (?)', ['y'])
        assert(second.lastInsertRowid > first.lastInsertRowid, 'rowid should advance')

        const updated = await db.exec('UPDATE t SET a = ?', ['z'])
        assertEqual(updated.changes, 2, 'update affects both rows')
      },
    },
    {
      name: 'parameters are bound, not interpolated',
      because: 'smart-playlist rules compile to SQL from untrusted input',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        const hostile = "'); DROP TABLE t; --"
        await db.exec('INSERT INTO t VALUES (?)', [hostile])
        const row = await db.get<{ a: string }>('SELECT a FROM t')
        assertEqual(row?.a, hostile, 'value stored verbatim')
        // The table must still be there.
        assertEqual((await db.query('SELECT * FROM t')).length, 1, 'table survived')
      },
    },
    {
      name: 'transaction commits on success',
      because: 'the obvious half of atomicity',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        await db.transaction(async (tx) => {
          await tx.exec('INSERT INTO t VALUES (?)', ['one'])
          await tx.exec('INSERT INTO t VALUES (?)', ['two'])
        })
        assertEqual((await db.query('SELECT * FROM t')).length, 2, 'both rows committed')
      },
    },
    {
      name: 'transaction rolls back entirely on failure',
      because: 'a half-applied migration can make the database unbootable',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        await assertRejects(
          () =>
            db.transaction(async (tx) => {
              await tx.exec('INSERT INTO t VALUES (?)', ['one'])
              throw new Error('deliberate')
            }),
          'transaction should propagate the error',
          /deliberate/,
        )
        assertEqual((await db.query('SELECT * FROM t')).length, 0, 'insert was rolled back')
      },
    },
    {
      name: 'transaction rolls back on a constraint violation',
      because: 'the failure is raised by SQLite, not by the callback',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT PRIMARY KEY)')
        await db.exec('INSERT INTO t VALUES (?)', ['dup'])
        await assertRejects(
          () =>
            db.transaction(async (tx) => {
              await tx.exec('INSERT INTO t VALUES (?)', ['fresh'])
              await tx.exec('INSERT INTO t VALUES (?)', ['dup'])
            }),
          'constraint violation should reject',
          /constraint|unique/i,
        )
        assertEqual((await db.query('SELECT * FROM t')).length, 1, 'only the original row remains')
      },
    },
    {
      name: 'transaction returns the callback value',
      because: 'callers compute inside the transaction and use the result',
      async run({ db }) {
        const value = await db.transaction(async () => 'result')
        assertEqual(value, 'result', 'returned value')
      },
    },
    {
      name: 'a concurrent write during an open transaction is independent of it',
      because: 'otherwise an unrelated write silently vanishes when the transaction rolls back',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')

        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })

        // Hold a transaction open across an await, then roll it back.
        const txn = db
          .transaction(async (tx) => {
            await tx.exec('INSERT INTO t VALUES (?)', ['from-txn'])
            await gate
            throw new Error('deliberate rollback')
          })
          .catch(() => undefined)

        // A bystander write, issued while the transaction is open. It must
        // queue behind the transaction rather than join it.
        const bystander = db.exec('INSERT INTO t VALUES (?)', ['bystander'])

        release()
        await txn
        await bystander

        const rows = await db.query<{ a: string }>('SELECT a FROM t')
        const values = rows.map((r) => r.a)
        assert(
          values.includes('bystander'),
          `bystander write was lost to the transaction rollback (rows: ${JSON.stringify(values)})`,
        )
        assert(
          !values.includes('from-txn'),
          'the rolled-back transaction leaked a row',
        )
      },
    },
    {
      name: 'a concurrent TRANSACTION during an open one queues behind it',
      because:
        'joining silently gives the bystander no atomicity — its writes vanish with the outer rollback',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')

        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })

        const outer = db
          .transaction(async (tx) => {
            await tx.exec('INSERT INTO t VALUES (?)', ['outer'])
            await gate
            throw new Error('deliberate rollback')
          })
          .catch(() => undefined)

        // A different plugin opening its own transaction. It must wait, not
        // join — and must survive the outer rollback with its own atomicity.
        const bystander = db.transaction(async (tx) => {
          await tx.exec('INSERT INTO t VALUES (?)', ['bystander'])
        })

        release()
        await outer
        await bystander

        const values = (await db.query<{ a: string }>('SELECT a FROM t')).map((r) => r.a)
        assert(
          values.includes('bystander'),
          `bystander transaction was lost to the outer rollback (rows: ${JSON.stringify(values)})`,
        )
        assert(!values.includes('outer'), 'the rolled-back transaction leaked a row')
      },
    },
    {
      name: 'a transaction does not observe writes made outside it',
      because: 'dirty reads make "atomic" meaningless',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        await db.exec('INSERT INTO t VALUES (?)', ['before'])

        const seen = await db.transaction(async (tx) => {
          const rows = await tx.query<{ a: string }>('SELECT a FROM t')
          return rows.map((r) => r.a)
        })
        assertEqual(seen, ['before'], 'transaction sees committed state')
      },
    },
    {
      name: 'nested transactions join the outer one',
      because: 'SQLite has no nested BEGIN; defineSchema may run inside a caller transaction',
      async run({ db }) {
        await db.exec('CREATE TABLE t (a TEXT)')
        await db.transaction(async (outer) => {
          await outer.exec('INSERT INTO t VALUES (?)', ['outer'])
          await outer.transaction(async (inner) => {
            await inner.exec('INSERT INTO t VALUES (?)', ['inner'])
          })
        })
        assertEqual((await db.query('SELECT * FROM t')).length, 2, 'both rows present')
      },
    },
    {
      name: 'foreign keys are enforced',
      because: 'deleting a provider must cascade to its catalogue rows',
      async run({ db }) {
        await db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)')
        await db.exec(
          'CREATE TABLE child (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id) ON DELETE CASCADE)',
        )
        await db.exec('INSERT INTO parent VALUES (?)', ['a'])
        await db.exec('INSERT INTO child VALUES (?, ?)', ['c', 'a'])

        await assertRejects(
          () => db.exec('INSERT INTO child VALUES (?, ?)', ['bad', 'missing']),
          'foreign keys must be ON',
          /foreign key|constraint/i,
        )

        await db.exec('DELETE FROM parent WHERE id = ?', ['a'])
        assertEqual((await db.query('SELECT * FROM child')).length, 0, 'cascade removed the child')
      },
    },
    {
      name: 'defineSchema creates namespaced tables',
      because: 'a plugin platform where only the core may create tables is not one',
      async run({ db }) {
        await db.defineSchema('plugin:conformance', [
          { version: 1, up: 'CREATE TABLE {{ns}}_items (id TEXT PRIMARY KEY)' },
        ])
        await db.exec('INSERT INTO plugin_conformance_items VALUES (?)', ['x'])
        assertEqual(
          (await db.query('SELECT * FROM plugin_conformance_items')).length,
          1,
          'namespaced table is usable',
        )
      },
    },
    {
      name: 'defineSchema is idempotent',
      because: 'it runs on every boot',
      async run({ db }) {
        const migrations = [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }]
        await db.defineSchema('plugin:idem', migrations)
        // Would throw "table already exists" if migrations re-ran.
        await db.defineSchema('plugin:idem', migrations)
      },
    },
    {
      name: 'supports FTS5 with diacritic folding',
      because: 'library search depends on it, and it is a compile-time option',
      async run({ db }) {
        await db.exec(
          `CREATE VIRTUAL TABLE fts USING fts5(t, content='', contentless_delete=1,
             tokenize='unicode61 remove_diacritics 2')`,
        )
        await db.exec('INSERT INTO fts (rowid, t) VALUES (1, ?)', ['Björk'])
        assertEqual(
          (await db.query(`SELECT rowid FROM fts WHERE fts MATCH 'bjork'`)).length,
          1,
          'diacritic-folded match',
        )
        // contentless_delete requires SQLite >= 3.43.
        await db.exec('DELETE FROM fts WHERE rowid = 1')
        assertEqual(
          (await db.query(`SELECT rowid FROM fts WHERE fts MATCH 'bjork'`)).length,
          0,
          'index row was removable',
        )
      },
    },
  ],
}
