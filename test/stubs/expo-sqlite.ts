/**
 * A stand-in for `expo-sqlite` under Vitest.
 *
 * `core-db-mobile` imports the driver at module scope, which is right for Metro
 * and impossible in Node. Aliasing it here is what lets the *second* `ctx.db`
 * implementation run the same suites as the first — and that matters more here
 * than anywhere else, because the gate is the thing MD-4 says used to be
 * present on desktop and absent on mobile. A capability that means one thing
 * on one platform and nothing on the other is worse than no capability.
 *
 * ⚠️ **Not a fake database.** It is `node:sqlite` behind the `expo-sqlite`
 * surface, so the SQL really runs, the migrations really apply, and a check
 * that passes here passed against SQLite rather than against a mock's opinion
 * of it. What it does not reproduce is the *SDK's* SQLite build — the version,
 * and therefore `contentless_delete=1` — which stays a device concern
 * (docs/11 §8).
 */

import { DatabaseSync } from 'node:sqlite'

export interface SQLiteRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>
  runAsync(sql: string, params?: unknown[]): Promise<SQLiteRunResult>
  closeAsync(): Promise<void>
}

/** `expo-sqlite` takes a name; `:memory:` is honoured the way the driver does. */
export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  const db = new DatabaseSync(name === ':memory:' ? ':memory:' : name)

  return {
    async execAsync(sql: string) {
      db.exec(sql)
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[]
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      return (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null
    },
    async runAsync(sql: string, params: unknown[] = []): Promise<SQLiteRunResult> {
      const result = db.prepare(sql).run(...(params as never[]))
      // `expo-sqlite` spells it `lastInsertRowId`; `node:sqlite` returns
      // bigints. Both differences are the driver's, so both are absorbed here
      // rather than in the service under test.
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async closeAsync() {
      db.close()
    },
  }
}
