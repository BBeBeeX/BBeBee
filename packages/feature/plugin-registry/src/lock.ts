/**
 * `registry.lock.json` manager (§1.4d).
 *
 * Persists and validates pinned integrity metadata { id, kind, repo, commit, sha256, installedAt }
 * in the user data directory via `ctx.paths` / `ctx.fs` and `ctx.store`.
 */

import type { FsService, PathsService, RegistryLockFile, RegistryLockRecord, StoreService } from '@BBeBee/protocol'

export const LOCK_FILE_NAME = 'registry.lock.json'
export const LOCK_STORE_KEY = 'registry.lock'

export class RegistryLockManager {
  private readonly fs?: FsService
  private readonly paths?: PathsService
  private readonly store?: StoreService

  constructor(options: { fs?: FsService; paths?: PathsService; store?: StoreService } = {}) {
    this.fs = options.fs
    this.paths = options.paths
    this.store = options.store
  }

  private get lockUri(): string | undefined {
    if (this.paths?.appData && this.fs) {
      return this.fs.join(this.paths.appData, LOCK_FILE_NAME)
    }
    return undefined
  }

  async read(): Promise<RegistryLockFile> {
    const uri = this.lockUri
    if (uri && this.fs) {
      try {
        const exists = await this.fs.exists(uri)
        if (exists) {
          const content = await this.fs.readFile(uri)
          const parsed = JSON.parse(content) as unknown
          if (this.isValidLockFile(parsed)) {
            return parsed
          }
        }
      } catch {
        // Fall back to store
      }
    }

    if (this.store) {
      try {
        const stored = await this.store.get<RegistryLockFile>(LOCK_STORE_KEY)
        if (this.isValidLockFile(stored)) {
          return stored
        }
      } catch {
        // Fall back to empty
      }
    }

    return { version: 1, records: {} }
  }

  async write(lock: RegistryLockFile): Promise<void> {
    const json = JSON.stringify(lock, null, 2)
    const uri = this.lockUri

    if (uri && this.fs) {
      try {
        await this.fs.writeFile(uri, json)
      } catch {
        // Continue to store
      }
    }

    if (this.store) {
      try {
        await this.store.set(LOCK_STORE_KEY, lock)
      } catch {
        // ignore
      }
    }
  }

  async getRecord(id: string): Promise<RegistryLockRecord | undefined> {
    const lock = await this.read()
    return lock.records[id]
  }

  async setRecord(record: RegistryLockRecord): Promise<void> {
    const lock = await this.read()
    const next: RegistryLockFile = {
      version: 1,
      records: {
        ...lock.records,
        [record.id]: record,
      },
    }
    await this.write(next)
  }

  async removeRecord(id: string): Promise<void> {
    const lock = await this.read()
    if (!lock.records[id]) return
    const nextRecords = { ...lock.records }
    delete nextRecords[id]
    await this.write({
      version: 1,
      records: nextRecords,
    })
  }

  private isValidLockFile(val: unknown): val is RegistryLockFile {
    if (typeof val !== 'object' || val === null) return false
    const obj = val as Record<string, unknown>
    return obj['version'] === 1 && typeof obj['records'] === 'object' && obj['records'] !== null
  }
}
