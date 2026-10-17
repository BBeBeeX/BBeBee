/**
 * Storage services: `ctx.store` (KV), `ctx.db` (SQL), `ctx.secrets` (credentials).
 * See docs/04-core-services.md §4–§6.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'

/* ── ctx.store ──────────────────────────────────────────────────────────── */

/** Small, frequently read settings. Not for anything you would want to query. */
export interface StoreService {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  /** A view confined to a prefix. Plugins receive a pre-namespaced store. */
  namespace(ns: string): StoreService
}

/* ── ctx.db ─────────────────────────────────────────────────────────────── */

export type SqlValue = string | number | null | Uint8Array

export type MigrationFn = (tx: {
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
}) => Promise<void>

export interface Migration {
  version: number
  up: string | string[] | MigrationFn
  /** Development only. Production refuses to downgrade — see docs/07 §6. */
  down?: string | string[] | MigrationFn
}

export interface DbService {
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>
  exec(
    sql: string,
    params?: SqlValue[],
  ): Promise<{ changes: number; lastInsertRowid: number }>
  transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T>

  /**
   * Register a plugin-owned schema.
   *
   * `{{ns}}` in each statement expands to a sanitised prefix derived from the
   * namespace, so tables cannot collide and ownership is legible in the
   * schema. A plugin platform where only the core may create tables is not
   * really a platform.
   */
  defineSchema(namespace: string, migrations: Migration[]): Promise<void>
}

/* ── ctx.secrets ────────────────────────────────────────────────────────── */

/**
 * Credential storage. Tokens live here and nowhere else.
 *
 * Note the size ceiling: `expo-secure-store` caps a value at 2048 bytes, so
 * anything larger (a cookie jar, for instance) must be envelope-encrypted with
 * a key kept here rather than stored here directly. See docs/04 §2.1.
 */
export interface SecretsService {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** Remove every secret in this namespace. Used by `signOut()`. */
  clear(): Promise<void>
  namespace(ns: string): SecretsService
  /** False when no OS keychain is available; callers may warn the user. */
  readonly isHardwareBacked: boolean
  /** Largest value this backend accepts, in bytes. */
  readonly maxValueBytes: number
}

declare module 'cordis' {
  interface Context {
    store: StoreService
    db: DbService
    secrets: SecretsService
  }
}
