/**
 * Forward-only, namespaced migrations.
 *
 * Used by every `core-db-*` implementation to satisfy `DbService.defineSchema`,
 * so the semantics are identical on both platforms rather than reimplemented.
 *
 * See docs/07-data-model.md §6.
 */

import type { Migration, SqlValue } from '@BBeBee/protocol'
import { assertSingleStatement } from '../capability-gate/sql.js'

/** The slice of `DbService` a migration needs. Avoids a circular dependency. */
export interface MigrationTx {
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
}

export interface MigrationDb extends MigrationTx {
  /**
   * Run `fn` atomically. Required, not optional: without it a migration that
   * fails partway leaves tables created but the version unrecorded, and the
   * next boot re-runs it into "table already exists" — permanently unbootable.
   */
  transaction<T>(fn: (tx: MigrationTx) => Promise<T>): Promise<T>
}

export const CORE_NAMESPACE = 'core'

export const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  namespace  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, version)
)`

/**
 * Records which namespace owns which table prefix.
 *
 * `nsPrefix` is lossy — it folds `-`, `.`, and `_` to `_`, so `plugin:a-b` and
 * `plugin:a.b` both yield `plugin_a_b`. Two such plugins would silently share
 * tables, so the mapping is registered and a collision is refused up front.
 */
export const NAMESPACES_TABLE = `
CREATE TABLE IF NOT EXISTS schema_namespaces (
  prefix    TEXT PRIMARY KEY,
  namespace TEXT NOT NULL
)`

/**
 * Turn a namespace into a table prefix.
 *
 * `plugin:@bbebee/plugin-scrobble` becomes `plugin_bbebee_plugin_scrobble`, so
 * ownership is legible when reading the schema.
 *
 * ⚠️ Lossy by design (readability beats injectivity here). Uniqueness is
 * enforced separately against `schema_namespaces` — see `assertPrefixOwner`.
 */
export function nsPrefix(namespace: string): string {
  const slug = namespace
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) throw new Error(`namespace ${JSON.stringify(namespace)} produces an empty prefix`)
  return slug
}

/** Expand `{{ns}}` placeholders in a statement. */
export function expandNs(sql: string, namespace: string): string {
  return sql.replaceAll('{{ns}}', nsPrefix(namespace))
}

/** Escape a value for use in a `LIKE ... ESCAPE '\'` pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError'
  constructor(
    readonly namespace: string,
    readonly version: number,
    override readonly cause: unknown,
  ) {
    super(`migration ${namespace}@${version} failed: ${String(cause)}`)
  }
}

export class NamespaceCollisionError extends Error {
  override readonly name = 'NamespaceCollisionError'
  constructor(
    readonly namespace: string,
    readonly owner: string,
    readonly prefix: string,
  ) {
    super(
      `namespace ${JSON.stringify(namespace)} maps to table prefix ${JSON.stringify(prefix)}, ` +
        `which is already owned by ${JSON.stringify(owner)}`,
    )
  }
}

/**
 * The oldest SQLite the core schema can run on.
 *
 * Set by what the migrations actually use, not by taste:
 *
 *   3.25  `ALTER TABLE … RENAME COLUMN`, in v3
 *   3.38  `json_object()` built in rather than an optional extension, in v3
 *   3.43  `contentless_delete=1`, in v2 — without it a renamed or removed
 *         track leaves its row in the FTS index forever and search returns
 *         stale hits without bound
 *
 * Node 22 (desktop sidecar) and op-sqlite both ship newer. `expo-sqlite` is the one to watch:
 * an older SDK would fail deep inside migration v2 with a syntax error that
 * names none of this (docs/11 §8).
 */
export const MIN_SQLITE_VERSION = '3.43.0'

/** `'3.43.0'` → 3043000, SQLite's own `sqlite_version()` ordering. */
function versionNumber(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((p) => Number(p) || 0)
  return major * 1_000_000 + minor * 1000 + patch
}

export class MigrationRunner {
  constructor(private readonly db: MigrationDb) {}

  async init(): Promise<void> {
    await this.db.exec(MIGRATIONS_TABLE)
    await this.db.exec(NAMESPACES_TABLE)
  }

  /**
   * Refuse to migrate on a SQLite too old for the schema.
   *
   * Loud and early, because the alternative is a syntax error thrown from the
   * middle of a migration on a device, naming a pragma rather than the SDK
   * that is actually too old. A driver that cannot answer `sqlite_version()`
   * is trusted rather than refused — being unable to *check* is not evidence
   * of being too old, and refusing to boot over it would be worse.
   */
  async assertSqliteVersion(minimum = MIN_SQLITE_VERSION): Promise<void> {
    let actual: string | undefined
    try {
      const rows = await this.db.query<{ v: string }>('SELECT sqlite_version() AS v')
      actual = rows[0]?.v
    } catch {
      return
    }
    if (!actual) return

    if (versionNumber(actual) < versionNumber(minimum)) {
      throw new Error(
        `BBeBee needs SQLite >= ${minimum} but this host has ${actual}. ` +
          'The core schema uses contentless_delete=1 (3.43) for the search ' +
          'index and RENAME COLUMN (3.25) in the ADR-5 migration. On mobile ' +
          'this means the Expo SDK is too old; see docs/11 §8.',
      )
    }
  }

  async appliedVersions(namespace: string): Promise<number[]> {
    const rows = await this.db.query<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE namespace = ? ORDER BY version',
      [namespace],
    )
    return rows.map((r) => Number(r.version))
  }

  /** Claim the prefix for this namespace, or throw if another owns it. */
  private async assertPrefixOwner(namespace: string): Promise<string> {
    const prefix = nsPrefix(namespace)
    const existing = await this.db.query<{ namespace: string }>(
      'SELECT namespace FROM schema_namespaces WHERE prefix = ?',
      [prefix],
    )
    const owner = existing[0]?.namespace
    if (owner === undefined) {
      await this.db.exec('INSERT INTO schema_namespaces (prefix, namespace) VALUES (?, ?)', [
        prefix,
        namespace,
      ])
    } else if (owner !== namespace) {
      throw new NamespaceCollisionError(namespace, owner, prefix)
    }
    return prefix
  }

  /**
   * Apply every migration not yet recorded, in version order.
   *
   * Each migration's statements and its bookkeeping row commit **together**, so
   * an interruption leaves the database exactly at a version boundary.
   */
  async apply(namespace: string, migrations: Migration[]): Promise<number> {
    await this.init()
    await this.assertPrefixOwner(namespace)

    const seen = new Set<number>()
    for (const m of migrations) {
      if (seen.has(m.version)) {
        // Would otherwise half-apply: the first records the version, the second
        // executes its statements and then fails on the primary-key conflict.
        throw new Error(`namespace ${namespace} declares version ${m.version} more than once`)
      }
      seen.add(m.version)
    }

    const applied = new Set(await this.appliedVersions(namespace))
    for (const v of applied) {
      if (!seen.has(v)) {
        // The database is ahead of the code — a downgrade. Refuse rather than
        // attempt a rollback; a half-applied downgrade is worse than a clear
        // failure. See docs/07 §6.
        throw new Error(
          `database has ${namespace}@${v} applied but this build declares only ` +
            `[${[...seen].sort((a, b) => a - b).join(', ')}]; refusing to run against a ` +
            `newer schema (downgrade unsupported)`,
        )
      }
    }

    const pending = [...migrations]
      .sort((a, b) => a.version - b.version)
      .filter((m) => !applied.has(m.version))

    for (const migration of pending) {
      if (typeof migration.up === 'function') {
        try {
          await this.db.transaction(async (tx) => {
            await (migration.up as (tx: MigrationTx) => Promise<void>)(tx)
            await tx.exec(
              'INSERT INTO schema_migrations (namespace, version, applied_at) VALUES (?, ?, ?)',
              [namespace, migration.version, Date.now()],
            )
          })
        } catch (cause) {
          throw new MigrationError(namespace, migration.version, cause)
        }
        continue
      }

      const statements = (Array.isArray(migration.up) ? migration.up : [migration.up]).map((s) =>
        expandNs(s, namespace),
      )

      // A driver compiles one statement per call and discards the rest in
      // silence, so `up: 'CREATE TABLE a; CREATE TABLE b'` would create `a`,
      // record the version as applied, and leave the schema permanently short
      // of `b` with nothing to investigate. Refuse before anything runs —
      // `up` accepts an array precisely so several statements are expressible.
      try {
        for (const sql of statements) assertSingleStatement(sql)
      } catch (cause) {
        throw new MigrationError(namespace, migration.version, cause)
      }

      try {
        await this.db.transaction(async (tx) => {
          for (const sql of statements) {
            await tx.exec(sql)
          }
          await tx.exec(
            'INSERT INTO schema_migrations (namespace, version, applied_at) VALUES (?, ?, ?)',
            [namespace, migration.version, Date.now()],
          )
        })
      } catch (cause) {
        throw new MigrationError(namespace, migration.version, cause)
      }
    }

    return pending.length
  }

  /**
   * Drop every table belonging to a namespace, plus its bookkeeping rows.
   *
   * Called on uninstall when the user chooses "remove data". Defaulting to
   * *keep* is the safer choice, so this is never automatic.
   */
  async dropNamespace(namespace: string): Promise<string[]> {
    await this.init()
    const prefix = nsPrefix(namespace)

    // `_` is a single-character wildcard in LIKE, so an unescaped
    // `plugin_a_%` also matches `plugin_ax_t` — another plugin's tables.
    const rows = await this.db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\'`,
      [`${escapeLike(prefix)}\\_%`],
    )
    // Belt and braces: never trust the pattern alone for a destructive op.
    const tables = rows.map((r) => r.name).filter((name) => name.startsWith(`${prefix}_`))

    await this.db.transaction(async (tx) => {
      // Plugin tables may reference each other; dropping a parent first would
      // trip an FK violation under the `PRAGMA foreign_keys = ON` the docs
      // require. Deferring moves enforcement to commit, by which point every
      // table in the set is gone.
      await tx.exec('PRAGMA defer_foreign_keys = ON')
      for (const name of tables) {
        // Identifier, not a value — quoted rather than bound. `name` came from
        // sqlite_master and passed the startsWith guard above.
        await tx.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`)
      }
      await tx.exec('DELETE FROM schema_migrations WHERE namespace = ?', [namespace])
      await tx.exec('DELETE FROM schema_namespaces WHERE namespace = ?', [namespace])
    })

    return tables
  }
}
