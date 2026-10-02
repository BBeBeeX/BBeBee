/**
 * Renderer-side `ctx.fs`, `ctx.db` and `ctx.paths` over the IPC bridge.
 *
 * ADR-3 puts the kernel in the renderer, which is sandboxed — so Node is
 * unreachable there and `core-fs-node` cannot run in-process. These are the
 * "thin IPC clients" docs/02 §2 describes: they add no behaviour, they only
 * forward. The behaviour has exactly one home, in `core-*-node`, running in
 * main.
 *
 * The capability gate applies here as it does anywhere: these services read
 * their interception config and refuse out-of-scope work *before* the call
 * leaves the renderer.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import {
  assertDbForCaller,
  assertFs,
  assertOwnNamespace,
  capabilityConfigOf,
} from '@BBeBee/kernel'
import type { CapabilityConfig } from '@BBeBee/kernel'
import { pluginDirName as pluginDirNameLocal, uriContains } from '@BBeBee/protocol'
import type {
  DbService,
  Disposable,
  FileStat,
  FsService,
  Migration,
  PathsService,
  ReadOptions,
  SqlValue,
  Uri,
  WatchEvent,
  WellKnownDir,
  WriteOptions,
} from '@BBeBee/protocol'
import { requireBridge, unwrapBridgeResult, type BridgeApi, type BridgeHttpRequest } from './protocol.js'

export * from './protocol.js'

type Scope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

/* ── ctx.paths ─────────────────────────────────────────────────────────── */

/**
 * Paths are fetched once at startup, because `PathsService` promises
 * synchronous access and IPC cannot provide it.
 */
export class PathsBridge extends Service implements PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  readonly music?: Uri

  constructor(ctx: Context, snapshot: Record<string, string | undefined>) {
    super(ctx, 'paths')
    this.appData = snapshot['appData'] ?? ''
    this.cache = snapshot['cache'] ?? ''
    this.temp = snapshot['temp'] ?? ''
    this.logs = snapshot['logs'] ?? ''
    this.downloads = snapshot['downloads'] ?? ''
    if (snapshot['music']) this.music = snapshot['music']
    this.pluginRoot = snapshot['pluginRoot'] ?? `${this.appData}/plugins`
  }

  private readonly pluginRoot: string

  pluginData(pluginId: string): Uri {
    // Must agree with `core-paths-node` exactly, or the fs gate in the
    // renderer would classify a plugin's own directory differently from the
    // host that serves it. The name is computed by the shared helper.
    return `${this.pluginRoot}/${pluginDirNameLocal(pluginId)}`
  }

  get(kind: WellKnownDir): Uri | undefined {
    switch (kind) {
      case 'data':
        return this.appData
      case 'cache':
        return this.cache
      case 'temp':
        return this.temp
      case 'logs':
        return this.logs
      case 'downloads':
        return this.downloads
      case 'music':
        return this.music
      default:
        return undefined
    }
  }
}

/** Ask main for every well-known path. Call once, before `createApp`. */
export async function fetchPaths(bridge: BridgeApi = requireBridge()): Promise<
  Record<string, string | undefined>
> {
  const keys = ['appData', 'cache', 'temp', 'logs', 'downloads', 'music'] as const
  const out: Record<string, string | undefined> = {}
  for (const key of keys) {
    out[key] = unwrapBridgeResult<string | undefined>(await bridge.call('paths', key, []))
  }
  out['pluginRoot'] = `${out['appData']}/plugins`
  return out
}

/* ── ctx.fs ────────────────────────────────────────────────────────────── */

export class FsBridge extends Service implements FsService {
  static inject = ['paths']

  /** Main can watch; the bridge simply forwards nothing yet. See below. */
  readonly canWatch = false

  private readonly bridge: BridgeApi

  constructor(ctx: Context) {
    super(ctx, 'fs')
    this.bridge = requireBridge()
  }

  /** Identical classification to `core-fs-node`, so the gate agrees. */
  private scopeOf(uri: Uri, gate: CapabilityConfig | undefined): Scope {
    const paths = this.ctx.paths
    if (uriContains(paths.temp, uri)) return 'cache'
    if (uriContains(paths.cache, uri)) return 'cache'
    if (uriContains(paths.downloads, uri)) return 'downloads'
    if (uriContains(paths.logs, uri)) return 'logs'
    if (paths.music && uriContains(paths.music, uri)) return 'media'
    if (gate) {
      if (uriContains(paths.pluginData(gate.scopeId), uri)) return 'own'
      if (uriContains(paths.appData, uri)) return 'all'
    }
    if (uriContains(paths.appData, uri)) return 'own'
    return 'all'
  }

  /** Refuse in the renderer, before the call crosses IPC. */
  private check(uri: Uri, mode: 'read' | 'write'): void {
    const config = this[Service.resolveConfig]()
    assertFs(config, mode, this.scopeOf(uri, capabilityConfigOf(config)))
  }

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    const res = await this.bridge.call('fs', method, args)
    return unwrapBridgeResult<T>(res)
  }

  async dir(kind: WellKnownDir) {
    return this.call<Uri | undefined>('dir', [kind])
  }

  // `join`/`basename`/`extname` are pure string work and synchronous in the
  // contract, so they are computed here rather than round-tripped.
  join(base: Uri, ...segments: string[]): Uri {
    const normalizedBase = base.replace(/\\/g, '/')
    const tail = segments.filter(Boolean).map((s) => s.replace(/\\/g, '/')).join('/')
    return tail ? `${normalizedBase.replace(/\/$/, '')}/${tail}` : normalizedBase
  }
  basename(uri: Uri): string {
    const normalized = uri.replace(/\\/g, '/')
    return decodeURIComponent(normalized.split('/').pop() ?? '')
  }
  extname(uri: Uri): string {
    const base = this.basename(uri)
    const dot = base.lastIndexOf('.')
    return dot > 0 ? base.slice(dot) : ''
  }

  async exists(uri: Uri) {
    this.check(uri, 'read')
    return this.call<boolean>('exists', [uri])
  }
  async stat(uri: Uri) {
    this.check(uri, 'read')
    return this.call<FileStat>('stat', [uri])
  }
  async list(uri: Uri) {
    this.check(uri, 'read')
    return this.call<FileStat[]>('list', [uri])
  }
  async mkdir(uri: Uri, opts?: { recursive?: boolean }) {
    this.check(uri, 'write')
    await this.call('mkdir', [uri, opts])
  }
  async remove(uri: Uri, opts?: { recursive?: boolean }) {
    this.check(uri, 'write')
    await this.call('remove', [uri, opts])
  }
  async move(from: Uri, to: Uri) {
    this.check(from, 'write')
    this.check(to, 'write')
    await this.call('move', [from, to])
  }
  async copy(from: Uri, to: Uri) {
    this.check(from, 'read')
    this.check(to, 'write')
    await this.call('copy', [from, to])
  }
  async readFile(uri: Uri, opts?: ReadOptions) {
    this.check(uri, 'read')
    // `signal` is a live object and cannot cross IPC; the rest is data.
    return this.call<string>('readFile', [uri, opts ? { encoding: opts.encoding } : undefined])
  }
  async readBytes(uri: Uri) {
    this.check(uri, 'read')
    return this.call<Uint8Array>('readBytes', [uri])
  }
  async writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions) {
    this.check(uri, 'write')
    await this.call('writeFile', [
      uri,
      data,
      opts ? { encoding: opts.encoding, append: opts.append } : undefined,
    ])
  }
  async freeSpace(uri: Uri) {
    this.check(uri, 'read')
    return this.call<number>('freeSpace', [uri])
  }
  async toPlayableUri(uri: Uri) {
    const raw = await this.call<Uri>('toPlayableUri', [uri])
    if (raw.startsWith('file://')) {
      return raw.replace(/^file:\/\//, 'bbebee-file://') as Uri
    }
    return raw
  }
  async pickDirectory() {
    return this.call<Uri | undefined>('pickDirectory', [])
  }

  /** Chunked over IPC, so a large file never materialises in one message. */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array> {
    this.check(uri, 'read')
    const bridge = this.bridge
    let handle: number | undefined
    return new ReadableStream<Uint8Array>({
      async start() {
        handle = await bridge.streamOpen(uri, range)
      },
      async pull(controller) {
        const chunk = await bridge.streamPull(handle!)
        if (chunk === null) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
      async cancel() {
        if (handle !== undefined) await bridge.streamClose(handle)
      },
    })
  }

  /**
   * Buffered, then written in one call.
   *
   * ⚠️ Unlike the read side this is not chunked, so a very large write is held
   * in renderer memory first. M0 has no such writer; the download plugin (M3)
   * will need a chunked counterpart before it lands.
   */
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array> {
    this.check(uri, 'write')
    const chunks: Uint8Array[] = []
    const write = (data: Uint8Array) => this.writeFile(uri, data, { append: opts?.append ?? false })
    return new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      async close() {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        await write(merged)
      },
    })
  }

  /**
   * ⚠️ Not bridged. `canWatch` is false, so callers poll — the same path the
   * mobile implementation takes. Forwarding watch events would need a push
   * channel, which M0 has no consumer for.
   */
  async watch(_uri: Uri, _cb: (ev: WatchEvent) => void): Promise<Disposable> {
    return () => {}
  }
}

/* ── ctx.db ────────────────────────────────────────────────────────────── */

export class DbBridge extends Service implements DbService {
  private readonly bridge: BridgeApi

  constructor(ctx: Context) {
    super(ctx, 'db')
    this.bridge = requireBridge()
  }

  private async call<T>(method: string, args: unknown[], token?: string): Promise<T> {
    const res = await this.bridge.call('db', method, args, token)
    return unwrapBridgeResult<T>(res)
  }

  /**
   * Enforce `db:own` before the statement leaves the renderer.
   *
   * Main cannot do this: it has one database context serving every caller and
   * no way to tell which plugin a bridge call came from. So the per-plugin
   * half of the gate has to run here — the same shape `core-db-node` uses in
   * process, via the same helper, so the two cannot drift.
   *
   * ⚠️ Renderer-side means a plugin that bypasses `ctx.db` and calls
   * `window.BBeBeeBridge` directly is not stopped by this. Main's own limits
   * (statement allowlist, ATTACH refusal) are what hold there.
   * See docs/03-plugin-system.md, "Where the gate actually runs".
   */
  private guard(sql: string): void {
    assertDbForCaller(this[Service.resolveConfig](), sql)
  }

  async query<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
    this.guard(sql)
    return this.call<T[]>('query', [sql, params])
  }
  async get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
    this.guard(sql)
    return this.call<T | undefined>('get', [sql, params])
  }
  async exec(sql: string, params: SqlValue[] = []) {
    this.guard(sql)
    return this.call<{ changes: number; lastInsertRowid: number }>('exec', [sql, params])
  }
  async defineSchema(namespace: string, migrations: Migration[]) {
    assertOwnNamespace(this[Service.resolveConfig](), namespace)
    await this.call('defineSchema', [namespace, migrations])
  }

  private txQueue: Promise<unknown> = Promise.resolve()

  /**
   * The callback runs in the renderer while the transaction stays open in
   * main, so statements are tagged with a token that routes them into it.
   *
   * The same rule as in-process applies: only calls made through the `tx`
   * argument join the transaction. An unrelated `ctx.db.exec()` sends no
   * token and therefore queues behind it in main.
   *
   * Concurrent transactions initiated from the renderer are serialized
   * client-side to prevent colliding on `txBegin`.
   */
  async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      const token = await this.bridge.txBegin()
      // Gated too: a transaction is not a way around the gate.
      const view: DbService = {
        query: (sql, params = []) => (this.guard(sql), this.call('query', [sql, params], token)),
        get: (sql, params = []) => (this.guard(sql), this.call('get', [sql, params], token)),
        exec: (sql, params = []) => (this.guard(sql), this.call('exec', [sql, params], token)),
        defineSchema: async (ns, migrations) => {
          assertOwnNamespace(this[Service.resolveConfig](), ns)
          await this.call('defineSchema', [ns, migrations], token)
        },
        transaction: <U>(inner: (tx: DbService) => Promise<U>) => inner(view),
      }

      try {
        const result = await fn(view)
        await this.bridge.txEnd(token, true)
        return result
      } catch (error) {
        await this.bridge.txEnd(token, false).catch(() => undefined)
        throw error
      }
    }

    const next = this.txQueue.then(execute, execute)
    this.txQueue = next.catch(() => undefined)
    return next as Promise<T>
  }
}

/* ── HTTP over the bridge ─────────────────────────────────────────────── */

/**
 * A `fetch` that runs in `main`.
 *
 * `core-http-node` takes its transport as a seam, and on desktop this is what
 * fills it. The renderer's own `fetch` cannot do the job: it is a browser
 * context, so a cross-origin request needs the *server's* permission, and a
 * Navidrome instance run by a stranger has never heard of this app. It also
 * refuses to set `Cookie`, `User-Agent` and `Range` — the three headers a
 * source needs most (docs/02 §2, docs/11 §4.5).
 *
 * The body is streamed rather than buffered, which is what keeps a seek by
 * `Range` cheap and lets a 60 MB FLAC play before it has finished arriving.
 *
 * Returns `undefined` when the preload exposes no http host, so a caller can
 * fall back to the platform `fetch` rather than fail to boot.
 */
export function bridgeFetch(bridge: BridgeApi = requireBridge()): typeof fetch | undefined {
  const open = bridge.httpOpen?.bind(bridge)
  const pull = bridge.httpPull?.bind(bridge)
  const close = bridge.httpClose?.bind(bridge)
  if (!open || !pull || !close) return undefined

  return async function bridgedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    /*
     * ⚠️ **Never `new Request(input, init)` here.**
     *
     * A `Request`'s header list carries the "request" guard, and in a browser
     * that guard silently drops every *forbidden request header* — `Cookie`
     * among them. This function exists to send `Cookie`. Normalising through a
     * `Request` would therefore delete the one header the whole bridge was
     * built for, and delete it *quietly*: signing in would appear to work and
     * never stick, which is the failure docs/06 §5.1 is written against.
     *
     * It is also a bug no test in this repo can see. Node's `fetch` does not
     * implement the guard, so a check that asserts `Cookie` survives passes in
     * Node and would have failed in the renderer — the exact shape of leak the
     * conformance suites exist to prevent. `Headers` on its own carries the
     * "none" guard and strips nothing, so the parts are assembled by hand.
     */
    const source = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
    const url = source ? source.url : String(input)
    const method = (init.method ?? source?.method ?? 'GET').toUpperCase()

    const headers: Record<string, string> = {}
    const absorb = (list: Headers) => {
      list.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
    }
    if (source) absorb(source.headers)
    if (init.headers) absorb(new Headers(init.headers))

    /*
     * The body, encoded the way `fetch` would encode it.
     *
     * `Response` rather than `Request` for the same guard reason — and it is
     * not just a workaround: it is what derives the `Content-Type` for a
     * `FormData` body, boundary and all, which a caller cannot write by hand.
     */
    let bodyBytes: Uint8Array | undefined
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = init.body ?? (source ? await source.arrayBuffer() : undefined)
      if (raw !== undefined && raw !== null) {
        const encoded = new Response(raw as BodyInit)
        const contentType = encoded.headers.get('content-type')
        // Only as a default: a caller that set its own knows something the
        // encoder does not.
        if (contentType && !headers['content-type']) headers['content-type'] = contentType
        bodyBytes = new Uint8Array(await encoded.arrayBuffer())
      }
    }

    const redirect = init.redirect ?? source?.redirect
    const signal = init.signal ?? source?.signal

    const wire: BridgeHttpRequest = {
      url,
      method,
      headers,
      ...(bodyBytes && bodyBytes.byteLength > 0 ? { body: bytesToBase64(bodyBytes) } : {}),
      ...(redirect ? { redirect } : {}),
    }

    const head = await open(wire)

    /*
     * Abort has to reach `main`, not just this side.
     *
     * Dropping the stream locally would leave the socket open there until the
     * server closed it — which for a stalled stream is never, and the wake
     * lock a download holds would be held for exactly that long.
     */
    const onAbort = () => void close(head.handle).catch(() => undefined)
    signal?.addEventListener('abort', onAbort, { once: true })

    // `Response` throws on a body with these statuses rather than ignoring it,
    // so the status the server actually sent would be lost to a TypeError.
    const bodyForbidden = head.status === 204 || head.status === 205 || head.status === 304

    const body =
      head.hasBody && !bodyForbidden
      ? new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await pull(head.handle)
              if (chunk === null) {
                controller.close()
                return
              }
              // IPC hands back a structured-cloned view; copying detaches it
              // from a buffer the channel may reuse.
              controller.enqueue(new Uint8Array(chunk))
            } catch (error) {
              controller.error(error)
            }
          },
          cancel() {
            return close(head.handle)
          },
        })
      : null

    // A forbidden-body response still holds a socket in main until told.
    if (head.hasBody && bodyForbidden) void close(head.handle).catch(() => undefined)

    const response = new Response(body, {
      status: head.status,
      statusText: head.statusText,
      // `Response` refuses a body on 204/304 and would throw rather than
      // return the status the server actually sent.
      headers: toHeaderList(head.headers),
    })

    // `Response.url` is read-only and empty for a synthesised response, so the
    // final URL after redirects would otherwise be lost — and that is what
    // relative link resolution in a source document is built on.
    Object.defineProperty(response, 'url', { value: head.url, configurable: true })
    return response
  }
}

/** `set-cookie` arrives newline-joined, because folding it loses cookies. */
function toHeaderList(headers: Record<string, string>): [string, string][] {
  const out: [string, string][] = []
  for (const [name, value] of Object.entries(headers)) {
    if (name === 'set-cookie') {
      for (const cookie of value.split('\n')) out.push([name, cookie])
    } else {
      out.push([name, value])
    }
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
