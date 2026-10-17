/**
 * `ctx.db` for Node and desktop sidecar, over `node:sqlite`.
 *
 * `node:sqlite` ships with Node 22.12+, so there is no external native module
 * to rebuild on every upgrade.
 *
 * See docs/04-core-services.md §5.
 */

import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import {
  CORE_MIGRATIONS,
  MigrationRunner,
  assertDbForCaller,
  assertOwnNamespace,
  assertSingleStatement,
} from '@BBeBee/kernel'
import type { MigrationDb, MigrationTx } from '@BBeBee/kernel'
import type { DbService, Migration, SqlValue } from '@BBeBee/protocol'

export interface DbNodeConfig {
  /** File name under the app data directory. `:memory:` for tests. */
  fileName?: string
  /** Skip the core schema. Only useful in tests. */
  skipCoreMigrations?: boolean
  /**
   * How long a transaction may wait behind another before erroring, in ms.
   * 0 disables the check. See `guardNested`.
   */
  transactionTimeoutMs?: number
}

export class DbNode extends Service implements DbService {
  static inject = ['fs', 'paths']

  private db!: DatabaseSync
  private readonly config: DbNodeConfig
  /** Serialises writes; `node:sqlite` is synchronous but our API is not. */
  private queue: Promise<unknown> = Promise.resolve()
  private depth = 0
  private closed = false

  constructor(ctx: Context, config: DbNodeConfig = {}) {
    super(ctx, 'db')
    this.config = config
  }

  async [Service.init]() {
    const fileName = this.config.fileName ?? 'BBeBee.db'
    let location = ':memory:'

    if (fileName !== ':memory:') {
      const dir = await this.ctx.fs.dir('data')
      if (!dir) throw new Error('db: no data directory available')
      location = fileURLToPath(this.ctx.fs.join(dir, fileName))
    }

    this.db = new DatabaseSync(location)
    // WAL keeps readers from blocking the writer; NORMAL is the usual
    // durability/throughput trade for an app database.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')

    if (!this.config.skipCoreMigrations) {
      const runner = new MigrationRunner(this)
      // Before anything runs: a SQLite too old for the schema fails deep
      // inside a migration with an error that names a pragma rather than the
      // SDK that is actually the problem.
      await runner.assertSqliteVersion()
      await runner.apply('core', CORE_MIGRATIONS)
    }

    // Close behind whatever is still queued, not immediately: an operation
    // already in flight (another service's final flush, say) would otherwise
    // fail with "database is not open". Teardown order makes this unreachable
    // today, but the disposer should not depend on that ordering holding.
    return () =>
      this.run(() => {
        this.closed = true
        this.db.close()
      })
  }

  /* ── Queries ────────────────────────────────────────────────────────── */

  /**
   * Serialise an operation behind everything already queued.
   *
   * **Never** bypasses, even while a transaction is open. An earlier version
   * short-circuited when `depth > 0` so the transaction callback's own writes
   * could proceed — but it could not tell the callback's writes from an
   * unrelated plugin's, so a concurrent `db.exec()` landed inside the open
   * transaction: it read the transaction's uncommitted rows, and its own
   * write vanished when that transaction rolled back, despite its promise
   * having already resolved successfully.
   *
   * The transaction callback now gets a narrow view (see `transaction`) that
   * talks to the driver directly, so it never re-enters this queue and the
   * bypass is not needed.
   */
  private run<T>(fn: () => T): Promise<T> {
    const guarded = () => {
      if (this.closed) throw new Error('db: database is closed')
      return fn()
    }
    const next = this.queue.then(guarded, guarded)
    this.queue = next.catch(() => undefined)
    return next
  }

  /**
   * Enforce `db:own` before a statement reaches SQLite.
   *
   * Ungated callers (the kernel, core services, tests) pass through; a plugin
   * is confined to tables carrying its own namespace prefix. Without this,
   * `db:own` was a manifest string with no meaning and any plugin could
   * `DROP TABLE providers` — docs/07 §6 claimed otherwise.
   */
  private guard(sql: string): void {
    assertDbForCaller(this[Service.resolveConfig](), sql)
  }

  /* Unqueued primitives. Only the transaction view and `run` may call these. */

  /**
   * `prepare()` compiles the **first** statement and silently discards the
   * rest: `exec('CREATE TABLE a; CREATE TABLE b')` creates `a`, resolves
   * successfully, and leaves no trace that `b` never happened. A migration
   * written that way records its version as applied and drifts the schema
   * permanently, with no error to investigate. Refuse the shape instead.
   */
  private queryNow<T>(sql: string, params: SqlValue[]): T[] {
    assertSingleStatement(sql)
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }

  private getNow<T>(sql: string, params: SqlValue[]): T | undefined {
    assertSingleStatement(sql)
    return (this.db.prepare(sql).get(...(params as never[])) as T) ?? undefined
  }

  private execNow(sql: string, params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    assertSingleStatement(sql)
    const result = this.db.prepare(sql).run(...(params as never[]))
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  async query<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    this.guard(sql)
    return this.run(() => this.queryNow<T>(sql, params))
  }

  async get<T = Record<string, SqlValue>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T | undefined> {
    this.guard(sql)
    return this.run(() => this.getNow<T>(sql, params))
  }

  async exec(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<{ changes: number; lastInsertRowid: number }> {
    this.guard(sql)
    return this.run(() => this.execNow(sql, params))
  }

  /**
   * Run `fn` atomically.
   *
   * `BEGIN IMMEDIATE` takes the write lock up front rather than upgrading
   * mid-transaction, which is what turns a concurrent writer into an
   * immediate, retryable failure instead of a surprise deadlock.
   *
   * Nesting is expressed on the `tx` argument, not here: `tx.transaction()`
   * joins the transaction already open. A call on the shared service always
   * queues — see below.
   */
  async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
    // The shared instance ALWAYS queues — it never joins a transaction that is
    // already in flight.
    //
    // An earlier version short-circuited on `depth > 0` so that nesting would
    // work, but the shared instance cannot tell a nested call from an
    // unrelated plugin's: a bystander `db.transaction()` executed immediately
    // inside the open transaction, resolved successfully, and then lost its
    // writes to the outer rollback with no error of any kind. Nesting is
    // expressed on the *view* instead (`txView().transaction`), which is
    // reachable only from inside a callback and joins by design.
    const wasInFlight = this.depth > 0
    return this.guardNested(
      this.run(async () => {
        this.db.exec('BEGIN IMMEDIATE')
        this.depth++
        try {
          const result = await fn(this.txView())
          this.db.exec('COMMIT')
          return result
        } catch (error) {
          try {
            this.db.exec('ROLLBACK')
          } catch {
            // Already rolled back by SQLite (e.g. a constraint abort).
          }
          throw error
        } finally {
          this.depth--
        }
      }),
      wasInFlight,
    )
  }

  /**
   * Turn the one deadlock this design permits into a diagnosable error.
   *
   * Queuing is right for a bystander, but a callback that reaches for the
   * shared `ctx.db.transaction()` instead of its `tx` argument now queues
   * behind the very transaction it is running inside, and waits forever. That
   * is a programming error, and a silent hang is a miserable way to learn it.
   */
  private guardNested<T>(work: Promise<T>, wasInFlight: boolean): Promise<T> {
    const timeoutMs = this.config.transactionTimeoutMs ?? 30_000
    if (!wasInFlight || timeoutMs <= 0) return work

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            'db: a transaction has waited ' +
              `${timeoutMs}ms behind another. If this call came from inside a ` +
              'transaction callback, use the `tx` argument rather than ctx.db — ' +
              'the shared service queues and will never run until the outer one ' +
              'finishes. If the outer transaction is genuinely this slow, raise ' +
              '`transactionTimeoutMs`.',
          ),
        )
      }, timeoutMs)
      work.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  /**
   * The object handed to a transaction callback.
   *
   * Deliberately *not* `this`: it talks to the driver directly, bypassing the
   * queue that `this` holds for the duration of the transaction. Handing out
   * the shared instance is what let unrelated concurrent calls join the open
   * transaction and lose their writes to its rollback.
   */
  private txView(): DbService {
    // Gated like the shared instance: a transaction is not a way around the
    // capability gate. Missing this left `db:own` enforced on the direct path
    // and unenforced inside any transaction.
    const view: DbService = {
      query: async <T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) => {
        this.guard(sql)
        return this.queryNow<T>(sql, params)
      },
      get: async <T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) => {
        this.guard(sql)
        return this.getNow<T>(sql, params)
      },
      exec: async (sql: string, params: SqlValue[] = []) => {
        this.guard(sql)
        return this.execNow(sql, params)
      },
      transaction: <U>(inner: (tx: DbService) => Promise<U>) => inner(view),
      defineSchema: (namespace, migrations) => {
        assertOwnNamespace(this[Service.resolveConfig](), namespace)
        return new MigrationRunner(asMigrationDb(view))
          .apply(namespace, migrations)
          .then(() => undefined)
      },
    }
    return view
  }

  async defineSchema(namespace: string, migrations: Migration[]): Promise<void> {
    // A gated plugin may only define its own namespace. Otherwise `db:own`
    // means nothing: a plugin could claim `core` and own the catalogue.
    assertOwnNamespace(this[Service.resolveConfig](), namespace)
    await new MigrationRunner(this).apply(namespace, migrations)
  }
}

/**
 * Adapt a `DbService` for `MigrationRunner`.
 *
 * A migration running inside a transaction view must NOT open a second
 * transaction — it is already in one — so `transaction` passes straight
 * through rather than issuing another BEGIN.
 */
function asMigrationDb(view: DbService): MigrationDb {
  return {
    exec: view.exec.bind(view),
    query: view.query.bind(view),
    transaction: (fn) => fn(view),
  }
}

// `MigrationRunner` needs exactly this shape; asserting it here means a
// contract change fails at compile time rather than at first migration.
const _conforms: (db: DbNode) => MigrationTx = (db) => db
void _conforms

export default DbNode
