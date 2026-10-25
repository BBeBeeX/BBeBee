/**
 * `ctx.db` for iOS and Android, over `expo-sqlite`.
 *
 * The counterpart of `core-db-node`. Both run the same migrations and must
 * pass the same conformance suite; the only difference is the driver.
 *
 * See docs/04-core-services.md §5.
 */

import { openDatabaseAsync } from 'expo-sqlite'
import type { SQLiteDatabase } from 'expo-sqlite'
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

export interface DbExpoConfig {
  /** Database name within the app's SQLite directory. */
  databaseName?: string
  skipCoreMigrations?: boolean
  /**
   * How long a transaction may wait behind another before erroring, in ms.
   * 0 disables the check. See `guardNested`.
   */
  transactionTimeoutMs?: number
}

export class DbExpo extends Service implements DbService {
  private db!: SQLiteDatabase
  private readonly config: DbExpoConfig
  private queue: Promise<unknown> = Promise.resolve()
  private depth = 0
  private closed = false

  constructor(ctx: Context, config: DbExpoConfig = {}) {
    super(ctx, 'db')
    this.config = config
  }

  async [Service.init]() {
    this.db = await openDatabaseAsync(this.config.databaseName ?? 'BBeBee.db')

    await this.db.execAsync('PRAGMA journal_mode = WAL')
    await this.db.execAsync('PRAGMA synchronous = NORMAL')
    await this.db.execAsync('PRAGMA foreign_keys = ON')

    if (!this.config.skipCoreMigrations) {
      const runner = new MigrationRunner(this)
      // Before anything runs: a SQLite too old for the schema fails deep
      // inside a migration with an error that names a pragma rather than the
      // SDK that is actually the problem.
      await runner.assertSqliteVersion()
      await runner.apply('core', CORE_MIGRATIONS)
    }

    // Close behind whatever is still queued — see core-db-node.
    return () =>
      this.run(async () => {
        this.closed = true
        await this.db.closeAsync()
      })
  }

  /**
   * Serialise an operation behind everything already queued.
   *
   * **Never** bypasses, even while a transaction is open — see the matching
   * comment in `core-db-node`. Letting `depth > 0` short-circuit meant an
   * unrelated plugin's write joined the open transaction and was lost to its
   * rollback after its own promise had already resolved.
   */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      if (this.closed) throw new Error('db: database is closed')
      return fn()
    }
    const next = this.queue.then(guarded, guarded)
    this.queue = next.catch(() => undefined)
    return next
  }

  /* Unqueued primitives. Only the transaction view and `run` may call these. */

  /**
   * Enforce the `db:` grants before a statement reaches SQLite.
   *
   * The same gate `core-db-node` applies, and it belongs here for the same
   * reason the `*-scope` conformance suites exist: this implementation had
   * none at all, so `db:own` meant something on desktop and nothing on mobile
   * — one platform enforcing an invariant the other ignored, which is the
   * drift docs/04 §18 is written to prevent.
   */
  private guard(sql: string): void {
    assertDbForCaller(this[Service.resolveConfig](), sql)
  }

  /**
   * Drivers execute one statement per call and discard the rest in silence,
   * so a multi-statement string is refused rather than half-run.
   */
  private queryNow<T>(sql: string, params: SqlValue[]): Promise<T[]> {
    assertSingleStatement(sql)
    return this.db.getAllAsync<T>(sql, params as never)
  }

  private async getNow<T>(sql: string, params: SqlValue[]): Promise<T | undefined> {
    assertSingleStatement(sql)
    return (await this.db.getFirstAsync<T>(sql, params as never)) ?? undefined
  }

  private async execNow(
    sql: string,
    params: SqlValue[],
  ): Promise<{ changes: number; lastInsertRowid: number }> {
    assertSingleStatement(sql)
    const result = await this.db.runAsync(sql, params as never)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowId }
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
   * Execute multiple statements in one transaction, in a single call.
   *
   * The mobile twin of `core-db-node`'s batch path. There is no IPC to
   * amortize here, but the contract is the same all-or-nothing semantics —
   * a bulk write the scanner or a library import can issue without holding
   * the queue once per statement.
   */
  async execBatch(
    statements: Array<{ sql: string; params?: SqlValue[] }>,
  ): Promise<Array<{ changes: number; lastInsertRowid: number }>> {
    // Every statement gated before the first one runs: a batch refused
    // mid-transaction rolls back, but refusing before any work is done is
    // cheaper still and cannot leave a caller wondering how far it got.
    for (const s of statements) this.guard(s.sql)
    return this.transaction(async () => {
      const results: Array<{ changes: number; lastInsertRowid: number }> = []
      for (const s of statements) {
        results.push(await this.execNow(s.sql, s.params ?? []))
      }
      return results
    })
  }

  /**
   * Run `fn` atomically.
   *
   * Deliberately NOT `withTransactionAsync`: that helper issues a plain
   * `BEGIN`, which acquires a deferred lock and can fail on upgrade under
   * concurrency. Issuing `BEGIN IMMEDIATE` matches `core-db-node`, so both
   * platforms have the same locking behaviour rather than the same API call.
   */
  async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
    // The shared instance ALWAYS queues — it never joins a transaction already
    // in flight. Short-circuiting on `depth > 0` meant an unrelated plugin's
    // `db.transaction()` ran inside the open one, resolved successfully, and
    // then lost its writes to the outer rollback with no error at all.
    // Nesting lives on the view instead. See core-db-node for the full note.
    const wasInFlight = this.depth > 0
    return this.guardNested(
      this.run(async () => {
        await this.db.execAsync('BEGIN IMMEDIATE')
        this.depth++
        try {
          const result = await fn(this.txView())
          await this.db.execAsync('COMMIT')
          return result
        } catch (error) {
          try {
            await this.db.execAsync('ROLLBACK')
          } catch {
            // Already rolled back by SQLite.
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
   * See core-db-node's copy for the reasoning.
   */
  private guardNested<T>(work: Promise<T>, wasInFlight: boolean): Promise<T> {
    const timeoutMs = this.config.transactionTimeoutMs ?? 30_000
    if (!wasInFlight || timeoutMs <= 0) return work

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `db: a transaction has waited ${timeoutMs}ms behind another. If this ` +
              'call came from inside a transaction callback, use the `tx` argument ' +
              'rather than ctx.db — the shared service queues and will never run ' +
              'until the outer one finishes. If the outer transaction is genuinely ' +
              'this slow, raise `transactionTimeoutMs`.',
          ),
        )
      }, timeoutMs)
      work.then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  /**
   * The object handed to a transaction callback.
   *
   * Deliberately *not* `this`: it reaches the driver directly, so it never
   * re-enters the queue that `this` holds for the transaction's duration.
   */
  private txView(): DbService {
    // Gated like the shared instance: a transaction is not a way around the
    // capability gate.
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

/** A migration inside a transaction view must not open a second transaction. */
function asMigrationDb(view: DbService): MigrationDb {
  return {
    exec: view.exec.bind(view),
    query: view.query.bind(view),
    transaction: (fn) => fn(view),
  }
}

const _conforms: (db: DbExpo) => MigrationTx = (db) => db
void _conforms

export default DbExpo
