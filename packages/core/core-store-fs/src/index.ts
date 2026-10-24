/**
 * `ctx.store` — namespaced key/value, backed by one JSON file via `ctx.fs`.
 *
 * **One implementation for both platforms**, deviating from the original plan
 * in docs/04 §4 (a JSON file on desktop, a `kv` table in the app database on
 * mobile). Two reasons:
 *
 *  1. Boot order. `ctx.store` comes up before `ctx.db` — the kernel reads
 *     configuration through `fs` and `store` before a database exists. Making
 *     mobile's store depend on `db` would invert that.
 *  2. There was nothing platform-specific left once it goes through `ctx.fs`.
 *     A second implementation would have been two copies of the same code
 *     with twice the drift.
 *
 * The size worry that motivated "not AsyncStorage" does not apply: this is a
 * plain file, so it has no per-value ceiling.
 *
 * See docs/04-core-services.md §4.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { storageNamespace } from '@BBeBee/kernel'
import type { FsService, StoreService, Uri } from '@BBeBee/protocol'

/** See the note on the field below — this key must not be a string. */
const OWN_FS = Symbol('BBeBee.store.ownFs')

export interface StoreConfig {
  /** File name under the app data directory. */
  fileName?: string
  /** Milliseconds to batch writes over. 0 writes synchronously. */
  flushDelayMs?: number
  /** Preloaded initial store data to skip redundant disk reads during startup. */
  initialData?: Record<string, unknown>
}

/** The shared, mutable document. One per app, regardless of namespaces. */
interface Document {
  data: Record<string, unknown>
  loaded: boolean
}

const LEGACY_PLUGIN_SCOPE = '@BBeBee/'
const CURRENT_PLUGIN_SCOPE = '@bbebee/'

/** Map a legacy `@BBeBee/` plugin id to its current `@bbebee/` form. */
function currentPluginId(id: string): string {
  return id.startsWith(LEGACY_PLUGIN_SCOPE)
    ? `${CURRENT_PLUGIN_SCOPE}${id.slice(LEGACY_PLUGIN_SCOPE.length)}`
    : id
}

/**
 * One-time, copy-if-absent migration for the manifest-id rename
 * (`@BBeBee/` → `@bbebee/`, to match the plugins' future npm names).
 *
 * Store keys are namespaced by plugin id (the capability gate's scopeId),
 * so renaming the ids orphans every plugin's persisted data unless the
 * legacy namespaced keys are carried over. This runs on every load —
 * idempotent by construction (existing new keys always win) — and keeps
 * the legacy keys in place, so the migration is reversible and a
 * mid-migration crash loses nothing. Two manager records get their
 * inner ids remapped as well, since those records are keyed/valued by
 * plugin id: `enabled` (id → bool) and `service-providers`
 * (service key → provider id). npm install records are keyed by
 * registry entry id, not manifest id, so they copy verbatim.
 */
export function migrateLegacyPluginNamespaces(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(LEGACY_PLUGIN_SCOPE)) continue
    const newKey = `${CURRENT_PLUGIN_SCOPE}${key.slice(LEGACY_PLUGIN_SCOPE.length)}`
    if (newKey in out) continue
    if (key === '@bbebee/plugin-manager:enabled' && value && typeof value === 'object') {
      out[newKey] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([id, enabled]) => [
          currentPluginId(id),
          enabled,
        ]),
      )
    } else if (
      key === '@bbebee/plugin-manager:service-providers' &&
      value &&
      typeof value === 'object'
    ) {
      out[newKey] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([service, provider]) => [
          service,
          typeof provider === 'string' ? currentPluginId(provider) : provider,
        ]),
      )
    } else {
      out[newKey] = value
    }
  }
  return out
}

export class StoreFs extends Service implements StoreService {
  static inject = ['fs', 'paths']

  private readonly fileName: string
  private readonly flushDelayMs: number
  private readonly doc: Document = { data: {}, loaded: false }
  /**
   * The filesystem as *this service* sees it, captured at init.
   *
   * `store.json` belongs to the store, not to whichever plugin happens to be
   * calling `set()`. Reading `this.ctx.fs` inside a caller's stack resolves
   * through that caller's interception, so a plugin granted only `db:own`
   * would have its unrelated settings write refused — and the store would
   * silently stop persisting. See docs/03 §4, "The one exception".
   *
   * ⚠️ Keyed by symbol, and that is load-bearing. Cordis hands a service back
   * re-bound to whoever is *reading* it: a plain `this[OWN_FS]`, read while a
   * gated plugin is on the stack, returns that plugin's intercepted `fs` and
   * throws the capture away. Its proxy passes symbol keys straight through,
   * so this one property comes back as captured.
   */
  private [OWN_FS]!: FsService
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> | undefined
  private loading: Promise<void> | undefined
  private prefix = ''

  constructor(ctx: Context, config: StoreConfig = {}) {
    super(ctx, 'store')
    this.fileName = config.fileName ?? 'store.json'
    this.flushDelayMs = config.flushDelayMs ?? 50
    if (config.initialData) {
      // The desktop shell preloads store.json itself and hands it over
      // here, so initial data needs the same legacy-namespace migration
      // as a disk load (doLoad is skipped once loaded is true).
      this.doc.data = migrateLegacyPluginNamespaces({ ...config.initialData })
      this.doc.loaded = true
    }
  }

  async [Service.init]() {
    this[OWN_FS] = this.ctx.fs
    await this.load()
    return async () => {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer)
        this.flushTimer = undefined
      }
      // Flush on the way out so a shutdown never loses a batched write — the
      // last second of settings is exactly the second the user just changed.
      await this.enqueueFlush()
    }
  }

  /* ── Namespacing ────────────────────────────────────────────────────── */

  /**
   * The namespace a plugin's keys are confined to.
   *
   * Derived from the capability gate's `scopeId`, so `ctx.store`,
   * `ctx.secrets`, and the cookie jar all agree — a plugin does not have to
   * remember to prefix anything. See docs/03-plugin-system.md §5.
   */
  private get effectivePrefix(): string {
    const injected = storageNamespace(this[Service.resolveConfig]())
    return injected ? `${injected}:${this.prefix}` : this.prefix
  }

  namespace(ns: string): StoreService {
    // Share the document and the flush machinery; only the prefix differs.
    const child = Object.create(this) as StoreFs
    Object.defineProperty(child, 'prefix', { value: `${this.prefix}${ns}:`, writable: false })
    return child
  }

  /* ── Reads and writes ───────────────────────────────────────────────── */

  async get<T>(key: string): Promise<T | undefined> {
    await this.load()
    return this.doc.data[this.effectivePrefix + key] as T | undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.load()
    this.doc.data[this.effectivePrefix + key] = value
    await this.schedule()
  }

  async delete(key: string): Promise<void> {
    await this.load()
    delete this.doc.data[this.effectivePrefix + key]
    await this.schedule()
  }

  async keys(prefix?: string): Promise<string[]> {
    await this.load()
    const scope = this.effectivePrefix
    return Object.keys(this.doc.data)
      .filter((k) => k.startsWith(scope))
      .map((k) => k.slice(scope.length))
      .filter((k) => !prefix || k.startsWith(prefix))
  }

  /* ── Persistence ────────────────────────────────────────────────────── */

  private async fileUri(): Promise<Uri> {
    const dir = await this[OWN_FS].dir('data')
    if (!dir) throw new Error('store: no data directory available')
    return this[OWN_FS].join(dir, this.fileName)
  }

  private async load(): Promise<void> {
    if (this.doc.loaded) return
    // Concurrent first reads must share one disk read, not race each other
    // into repeated parses — and, worse, into overlapping `loaded` writes.
    this.loading ??= this.doLoad().finally(() => {
      this.loading = undefined
    })
    return this.loading
  }

  private async doLoad(): Promise<void> {
    if (this.doc.loaded) return
    const uri = await this.fileUri()
    try {
      if (await this[OWN_FS].exists(uri)) {
        this.doc.data = JSON.parse(await this[OWN_FS].readFile(uri)) as Record<string, unknown>
      } else if (await this[OWN_FS].exists(`${uri}.tmp`)) {
        /*
         * The store is missing but its temp file is not.
         *
         * That is the crash window of a non-atomic replace: on mobile
         * `ctx.fs.move` has to clear the destination before it can move onto
         * it (see `core-fs-expo`), so there is a moment where the new contents
         * exist only under `.tmp`. The alternative to adopting it is starting
         * empty — silently discarding a write that had already succeeded — so
         * this recovers rather than shrugs. On a platform with a real atomic
         * rename this branch simply never runs.
         */
        this.doc.data = JSON.parse(
          await this[OWN_FS].readFile(`${uri}.tmp`),
        ) as Record<string, unknown>
        this.ctx.logger.warn(`store: recovered ${uri} from an interrupted write`)
        this.doc.data = migrateLegacyPluginNamespaces(this.doc.data)
        this.doc.loaded = true
        await this.enqueueFlush()
        return
      }
    } catch (error) {
      // A corrupt store must not brick the app: settings are recoverable,
      // an unbootable app is not. Keep the bad file for diagnosis.
      this.ctx.logger.error(`store: could not read ${uri}, starting empty: ${String(error)}`)
      try {
        await this[OWN_FS].move(uri, `${uri}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
      this.doc.data = {}
    }
    this.doc.data = migrateLegacyPluginNamespaces(this.doc.data)
    this.doc.loaded = true
  }

  /**
   * Queue a write.
   *
   * With `flushDelayMs: 0` the returned promise settles only once the write
   * has landed, so `await store.set(...)` genuinely means "persisted". With a
   * delay it resolves immediately and the batch lands later — which is why
   * `Service.init`'s disposer flushes on the way out.
   */
  private schedule(): Promise<void> {
    if (this.flushDelayMs === 0) return this.enqueueFlush()

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        void this.enqueueFlush()
      }, this.flushDelayMs)
    }
    return Promise.resolve()
  }

  /** Serialise writes so two flushes cannot interleave their temp files. */
  private enqueueFlush(): Promise<void> {
    const next = (this.pending ?? Promise.resolve()).then(
      () => this.flush(),
      () => this.flush(),
    )
    this.pending = next.catch(() => undefined)
    return next
  }

  /** Write the document atomically: temp file, then rename over the target. */
  private async flush(): Promise<void> {
    const uri = await this.fileUri()
    const tmp = `${uri}.tmp`
    const payload = JSON.stringify(this.doc.data, null, 2)
    try {
      await this[OWN_FS].writeFile(tmp, payload)
      // A rename is atomic on both platforms, so a crash mid-write leaves the
      // previous store intact rather than a truncated one.
      await this[OWN_FS].move(tmp, uri)
    } catch (error) {
      this.ctx.logger.error(`store: flush failed: ${String(error)}`)
      // Do not leave a half-written temp file behind to confuse the next boot.
      await this[OWN_FS].remove(tmp).catch(() => undefined)
    }
  }
}

export default StoreFs
