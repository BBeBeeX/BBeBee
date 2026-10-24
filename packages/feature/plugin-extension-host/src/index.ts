/**
 * `plugin-extension-host` — `ctx.extensions`, the M5 extension host.
 *
 * A third-party extension runs inside a `ctx.js` realm and sees exactly the
 * `ext` bridge (protocol `extensions.ts`): scoped HTTP behind the extension's
 * declared `net:host/<glob>` capabilities, namespaced string storage, a log
 * sink, and the allowlisted canon events. One extension is one realm and one
 * set of subscriptions — the host plugin itself is the single fiber above
 * them, so unloading it disposes every realm through Cordis's own teardown.
 *
 * Why the bridge enforces capabilities rather than the kernel loader: a
 * registry plugin can reach all of `ctx` and must be gated before it loads;
 * realm code can reach *only* what the host exposes, so the check at the
 * bridge is the whole gate — there is no ambient surface to reach around
 * (the desktop loader's honesty note does not apply here).
 *
 * Layers: reaches the platform only through core services (`js`, `fs`,
 * `paths`, `store`, `http`), never an SDK.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import {
  CapabilityError,
  ExtensionNotFoundError,
  ExtensionQuarantinedError,
  EXTENSION_EVENTS,
  type Disposable,
  type ExtensionEventName,
  type ExtensionEventPayloads,
  type ExtensionHttpResponse,
  type ExtensionInstallInput,
  type ExtensionRecord,
  type ExtensionsService,
  type JsLimits,
  type JsRealm,
  type PluginManifest,
  allowsHost,
} from '@BBeBee/protocol'
import { makePrelude } from './prelude.js'

/** Two consecutive load failures quarantine an extension (M5's exit criterion). */
const QUARANTINE_AFTER = 2

/** Realm limits for extension code. Handlers do network work, so budget > rule budget. */
const EXTENSION_JS_LIMITS: Partial<JsLimits> = {
  timeoutMs: 2_000,
  budgetMs: 15_000,
}

export interface ExtensionHostConfig {
  /** Applied to every extension realm. Overriding the budget down is safe; up is a policy call. */
  limits?: Partial<JsLimits>
}

/** The persisted half of {@link ExtensionRecord}; `active` is runtime state. */
interface StoredRecord {
  id: string
  version: string
  displayName: string
  capabilities: string[]
  installedAt: number
  failures: number
  quarantined: boolean
}

interface ActiveExtension {
  realm: JsRealm
  queue: Promise<unknown>
  offs: Disposable[]
}

export class ExtensionHost extends Service implements ExtensionsService {
  static inject = ['js', 'fs', 'paths', 'store', 'http']

  private readonly records = new Map<string, StoredRecord>()
  private readonly active = new Map<string, ActiveExtension>()
  private recordsLoaded = false

  constructor(
    ctx: Context,
    private readonly config: ExtensionHostConfig = {},
  ) {
    super(ctx, 'extensions')
  }

  async [Service.init]() {
    await this.loadRecords()
    for (const record of this.records.values()) {
      if (record.quarantined) continue
      // A broken-at-boot extension must not break boot: activate() has
      // already counted the failure and persisted the counter by the time
      // this catch runs, which is the path that leads to quarantine.
      await this.activate(record.id).catch(() => {})
    }
    return () => {
      for (const id of [...this.active.keys()]) this.deactivate(id)
    }
  }

  /* ── records ─────────────────────────────────────────────────────────── */

  private async loadRecords(): Promise<void> {
    const stored = await this.store.get<Record<string, StoredRecord>>('records')
    if (stored) {
      for (const record of Object.values(stored)) this.records.set(record.id, record)
    }
    this.recordsLoaded = true
  }

  private get store() {
    // `namespace` returns a confined view; taking it per call keeps the host
    // honest about never touching another plugin's keys.
    return this.ctx.store.namespace('extensions')
  }

  private async persist(): Promise<void> {
    const out: Record<string, StoredRecord> = {}
    for (const record of this.records.values()) out[record.id] = record
    await this.store.set('records', out)
  }

  private record(id: string): StoredRecord {
    const record = this.records.get(id)
    if (!record) throw new ExtensionNotFoundError(id)
    return record
  }

  /* ── files ───────────────────────────────────────────────────────────── */

  private dirFor(id: string) {
    // Scoped ids (`@scope/name`) contain characters no directory name should
    // carry. The mapping is injective and filename-safe on every platform:
    // every character outside the conservative set becomes `~<hex>`.
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, (c) =>
      `~${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )
    return this.ctx.fs.join(this.ctx.paths.pluginData('plugin-extension-host'), safe)
  }

  /* ── ExtensionsService ───────────────────────────────────────────────── */

  async list(): Promise<ExtensionRecord[]> {
    if (!this.recordsLoaded) await this.loadRecords()
    return [...this.records.values()].map((record) => ({
      id: record.id,
      version: record.version,
      displayName: record.displayName,
      capabilities: record.capabilities,
      installedAt: record.installedAt,
      failures: record.failures,
      quarantined: record.quarantined,
      active: this.active.has(record.id),
    }))
  }

  async install(input: ExtensionInstallInput): Promise<ExtensionRecord> {
    const { manifest, main } = input
    validateManifest(manifest)
    if (typeof main !== 'string' || main.length === 0) {
      throw new Error('install: main must be a non-empty script string')
    }

    // Reinstalling over a live extension swaps the code atomically from the
    // realm's point of view: the old realm dies before the new files land.
    this.deactivate(manifest.id)

    const dir = this.dirFor(manifest.id)
    await this.ctx.fs.mkdir(dir, { recursive: true })
    await this.ctx.fs.writeFile(this.ctx.fs.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    await this.ctx.fs.writeFile(this.ctx.fs.join(dir, 'main.js'), main)

    if (!this.recordsLoaded) await this.loadRecords()
    this.records.set(manifest.id, {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName || manifest.id,
      capabilities: [...manifest.capabilities],
      installedAt: Date.now(),
      failures: 0,
      quarantined: false,
    })
    await this.persist()

    // A first load that throws is reported through the record (the failure
    // counter), not by un-installing: the user just saw where the code came
    // from and may prefer to update it rather than lose the slot.
    await this.activate(manifest.id).catch(() => {})
    const record = this.record(manifest.id)
    this.ctx.emit('extensions/changed')
    return { ...record, active: this.active.has(record.id) }
  }

  async activate(id: string): Promise<void> {
    if (!this.recordsLoaded) await this.loadRecords()
    if (this.active.has(id)) return
    const record = this.record(id)
    if (record.quarantined) throw new ExtensionQuarantinedError(id)

    const code = await this.ctx.fs.readFile(this.ctx.fs.join(this.dirFor(id), 'main.js'))
    const realm = await this.ctx.js.createRealm({
      ...EXTENSION_JS_LIMITS,
      ...this.config.limits,
    })

    /*
     * The flat host functions. Everything an extension can do enters through
     * one of these; the egress check lives inside `requestFor`, not at the
     * call site, so there is no `ext.http` path that skips it.
     *
     * Errors cross as *envelopes*, never as throws: a host exception does not
     * survive the QuickJS boundary with its name or message intact, and a
     * `CapabilityError` the author cannot read is a gate nobody can debug.
     * The prelude unwraps `{ __err, name, message }` back into a real Error
     * realm-side.
     */
    realm.expose('__hostLog', (message: unknown) => {
      if (typeof message === 'string' && message.length > 0) {
        this.ctx.logger.info(`ext ${id}: ${message.slice(0, 500)}`)
      }
      return undefined
    })
    const httpFn =
      (method: 'GET' | 'POST') =>
      (...args: unknown[]) =>
        guard(() =>
          method === 'GET'
            ? this.requestFor(id, 'GET', args[0], undefined, args[1])
            : this.requestFor(id, 'POST', args[0], args[1], args[2]),
        )
    realm.expose('__hostHttpGet', httpFn('GET'))
    realm.expose('__hostHttpPost', httpFn('POST'))

    const scoped = () => this.ctx.store.namespace(`ext:storage:${id}`)
    realm.expose(
      '__hostStorageGet',
      (key: unknown) => guard(() =>
        typeof key === 'string' ? scoped().get<string>(key) : Promise.resolve(undefined)),
    )
    realm.expose(
      '__hostStoragePut',
      (key: unknown, value: unknown) => guard(() =>
        typeof key === 'string' && typeof value === 'string'
          ? scoped().set(key, value)
          : Promise.reject(new Error('storage.put(key: string, value: string)'))),
    )
    realm.expose(
      '__hostStorageDelete',
      (key: unknown) => guard(() => (typeof key === 'string' ? scoped().delete(key) : undefined)),
    )
    realm.expose('__hostStorageKeys', () => guard(() => scoped().keys()))

    try {
      await realm.preload(makePrelude(id, EXTENSION_EVENTS))
      await realm.preload(code)
    } catch (error) {
      realm.dispose()
      record.failures += 1
      record.quarantined = record.failures >= QUARANTINE_AFTER
      await this.persist()
      if (record.quarantined) {
        this.ctx.logger.warn(`ext ${id}: quarantined after ${record.failures} load failures`)
        this.ctx.emit('extensions/changed')
      }
      throw new Error(`extension ${id} failed to load: ${String(error)}`, { cause: error })
    }

    record.failures = 0
    await this.persist()

    const offs: Disposable[] = []
    for (const event of EXTENSION_EVENTS) offs.push(this.subscribe(id, event, realm))
    this.active.set(id, { realm, queue: Promise.resolve(), offs })
  }

  deactivate(id: string): void {
    const entry = this.active.get(id)
    if (!entry) return
    this.active.delete(id)
    for (const off of entry.offs) off()
    /*
     * Subscriptions detach before the realm dies, so no event can arrive
     * between the two and dispatch into a disposed realm. Disposing while a
     * dispatch is mid-flight is the case the sandbox contract explicitly
     * supports ("torn down with a frame still parked on an await"); dispose
     * is idempotent and never throws.
     */
    entry.realm.dispose()
  }

  async uninstall(id: string, opts: { keepData?: boolean } = {}): Promise<void> {
    this.record(id)
    // Fiber-safe by construction: the realm dies and the subscriptions detach
    // before the first file is removed — a handler mid-flight completes or is
    // interrupted, but nothing reads a half-deleted directory afterwards.
    this.deactivate(id)
    await this.ctx.fs.remove(this.dirFor(id), { recursive: true })
    this.records.delete(id)
    await this.persist()
    if (!opts.keepData) {
      const scoped = this.ctx.store.namespace(`ext:storage:${id}`)
      for (const key of await scoped.keys()) await scoped.delete(key)
    }
    this.ctx.emit('extensions/changed')
  }

  /* ── the bridge's enforcement ────────────────────────────────────────── */

  /**
   * One egress path for both HTTP methods. The grant check happens before
   * anything is sent; a URL that does not parse never reaches the network.
   */
  private async requestFor(
    id: string,
    method: 'GET' | 'POST',
    url: unknown,
    body: unknown,
    options: unknown,
  ): Promise<ExtensionHttpResponse> {
    if (typeof url !== 'string') throw new Error('http: url must be a string')
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      throw new Error(`http: invalid url: ${url.slice(0, 200)}`)
    }
    const granted = this.records.get(id)?.capabilities ?? []
    if (!allowsHost(granted, host)) {
      throw new CapabilityError(`net:host/${host}`, `extension ${id} is not granted egress to ${host}`)
    }
    const headers =
      options && typeof options === 'object' && 'headers' in options
        ? pickStringRecord((options as { headers: unknown }).headers)
        : undefined
    const response = await this.ctx.http({
      url,
      method,
      headers,
      body: method === 'POST' && typeof body === 'string' ? body : undefined,
    })
    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    }
  }

  /**
   * Subscribe one active extension to one allowlisted canon event. The
   * switch keeps the listener signatures typed — the canon is the source of
   * truth for what each event carries.
   */
  private subscribe(id: string, event: ExtensionEventName, realm: JsRealm): Disposable {
    const dispatch = (payload: ExtensionEventPayloads[ExtensionEventName]) => {
      const entry = this.active.get(id)
      if (!entry || realm.disposed) return undefined
      // Serialized per extension: QuickJS is single-threaded per realm, and
      // two interleaved evals on one context is not a shape the sandbox
      // contract promises to survive.
      const run = () => realm.eval('__dispatch(evt, payload)', { evt: event, payload })
      const chained = entry.queue.then(run, run)
      // A rejection means the realm breached a limit (it is poisoned) or the
      // eval itself failed — either way this extension is done until the next
      // boot retries it fresh. The catch also keeps the chain resolvable for
      // whatever arrives next, though after deactivation nothing will.
      entry.queue = chained.then(
        () => undefined,
        (error: unknown) => {
          this.ctx.logger.warn(`ext ${id}: event dispatch failed: ${String(error)}`)
          this.deactivate(id)
        },
      )
      return chained
    }
    switch (event) {
      case 'player/track-changed':
        return this.ctx.on(event, (trackUrn, previous) => dispatch({ trackUrn, previous: previous ?? undefined }))
      case 'player/state-changed':
        return this.ctx.on(event, (state) => dispatch({ state }))
      case 'player/track-completed':
        return this.ctx.on(event, (play) => dispatch({ play }))
      case 'queue/changed':
        return this.ctx.on(event, (items) => dispatch({ items }))
    }
  }
}

function pickStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') out[key] = v
  }
  return out
}

/** Run a bridge call, converting any failure into a realm-readable envelope. */
async function guard(impl: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    return await impl()
  } catch (error) {
    return {
      __err: true,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function validateManifest(manifest: PluginManifest): void {
  if (!manifest || typeof manifest !== 'object') throw new Error('install: manifest required')
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-._]*$|^@[a-z0-9-]+\/[a-z0-9][a-z0-9-._]*$/.test(manifest.id)) {
    throw new Error(`install: bad manifest id: ${String(manifest.id)}`)
  }
  // Anti-spoofing: a first-party id would shadow the built-in set in every
  // user-facing list. Same rule the desktop installer applies to npm plugins.
  if (manifest.id.startsWith('@bbebee/')) {
    throw new Error('install: extension ids may not sit under the @bbebee/ scope')
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('install: manifest.version required')
  }
  if (manifest.entry?.main !== undefined && manifest.entry.main !== './main.js') {
    throw new Error(`install: entry.main must be './main.js' (single-file bundle), got ${manifest.entry.main}`)
  }
  if (manifest.capabilities === undefined || !Array.isArray(manifest.capabilities)) {
    throw new Error('install: manifest.capabilities array required (may be empty)')
  }
}

export const name = 'plugin-extension-host'
export const inject = ExtensionHost.inject

export async function apply(ctx: Context, config: ExtensionHostConfig = {}) {
  ctx.logger.info('plugin-extension-host: loaded')
  const fiber = await ctx.plugin(ExtensionHost, config)
  return () => void fiber.dispose()
}

export default { name, inject, apply }
