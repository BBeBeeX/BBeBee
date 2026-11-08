/**
 * The sidecar's loopback stream relay — how a *playback stream* goes through
 * the configured proxy without the audio engine knowing a proxy exists.
 *
 * The engine (prebuilt, out of repo) fetches stream URLs itself with plain
 * mpv/libavformat; it cannot be taught per-load proxying. So the proxying
 * happens one hop away from it: a caller registers the real upstream URL
 * (plus the source's own headers and whether that stream is proxy-routed)
 * and gets back `http://127.0.0.1:<port>/s/<token>`; the engine plays that
 * loopback URL; this relay fetches the real upstream — through the proxy
 * dispatcher when the entry says so — and pipes the bytes, forwarding the
 * `Range` exchanges mpv's seeking depends on.
 *
 * Trust posture, stated plainly: the relay is an **un-gated egress point**
 * for whoever can call `stream:register` — the same trust level as the
 * renderer's `httpOpen` bridge (see the security note in
 * `core-desktop-bridge/main.ts`). What it does *not* do is let a caller
 * choose the proxy: whether a registered stream is proxied is decided by the
 * proxy config this side holds (pushed by the shell, never by the renderer),
 * and the upstream fetch reuses `ProxyRegistry`'s dispatcher.
 *
 * Containment: loopback bind only, 128-bit random tokens, a sliding TTL and
 * a hard entry cap so a registration loop cannot grow the table without
 * bound, and an upstream scheme allowlist of http/https.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetch as undiciFetch } from 'undici'
import type { Dispatcher } from 'undici'

/** Uniqueness of a token: 16 random bytes is not guessable in any practical sense. */
const TOKEN_BYTES = 16
/** Registrations outlive any sane track; a seek reuses the same token, so no per-request expiry. */
const ENTRY_TTL_MS = 2 * 60 * 60 * 1000
/** Ceiling on live registrations — a loop must evict, not grow. */
const MAX_ENTRIES = 128

/** Headers mpv sends that describe the *exchange*, not the caller — forwarded upstream. */
const FORWARDED_REQUEST_HEADERS = new Set(['range', 'if-range', 'accept', 'accept-encoding', 'icy-metadata'])

/** Upstream response headers worth passing to mpv; everything hop-by-hop or session-shaped is dropped. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'strict-transport-security',
])

export interface RelayRegistration {
  /** The real upstream URL. Only http/https is served. */
  url: string
  /** The source's own request headers (`Referer`, `User-Agent`, `Cookie`, …). */
  headers?: Record<string, string>
  /** Whether this stream is routed through the configured proxy. */
  useProxy?: boolean
}

interface RelayEntry {
  url: string
  headers: Record<string, string>
  useProxy: boolean
  lastAccess: number
}

export interface RelayLogger {
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

export class StreamRelay {
  private server: Server | null = null
  private port = 0
  private starting: Promise<void> | null = null
  private readonly entries = new Map<string, RelayEntry>()

  constructor(
    /** The live proxy dispatcher, resolved per fetch (config can change mid-track). */
    private readonly dispatcherFor: () => Dispatcher | null,
    private readonly logger?: RelayLogger,
    /** The upstream fetch. Tests inject a mock; production uses undici's. */
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {}

  /**
   * Register one stream and return the loopback URL the engine plays.
   *
   * Idempotently starts the listener on first use; the port is the OS's
   * choice, so nothing else in the app (or the user's machine) had to agree
   * on a number.
   */
  async register(input: RelayRegistration): Promise<string> {
    const parsed = new URL(String(input?.url ?? ''))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`relay: refusing to register ${parsed.protocol || 'invalid'}// — only http/https is served`)
    }
    await this.ensureListening()
    this.sweep()

    const token = randomBytes(TOKEN_BYTES).toString('hex')
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      if (typeof name === 'string' && typeof value === 'string' && !/[\r\n]/.test(name + value)) {
        headers[name.toLowerCase()] = value
      }
    }
    this.entries.set(token, {
      url: parsed.toString(),
      headers,
      useProxy: input.useProxy === true,
      lastAccess: Date.now(),
    })
    this.logger?.info?.('relay: registered stream %s (proxy: %s)', parsed.host, String(input.useProxy === true))
    return `http://127.0.0.1:${this.port}/s/${token}`
  }

  /** How many registrations are live — diagnostics only. */
  get size(): number {
    return this.entries.size
  }

  dispose(): void {
    this.entries.clear()
    if (this.server) {
      this.server.close()
      this.server = null
      this.port = 0
    }
  }

  private ensureListening(): Promise<void> {
    if (this.server && this.port) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.serve(req, res)
      })
      server.once('error', (error) => {
        this.starting = null
        this.server = null
        this.port = 0
        reject(error)
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        this.port = address.port
        this.server = server
        this.starting = null
        this.logger?.info?.('relay: listening on 127.0.0.1:%d', this.port)
        resolve()
      })
    })
    return this.starting
  }

  private sweep(): void {
    const now = Date.now()
    for (const [token, entry] of this.entries) {
      if (now - entry.lastAccess > ENTRY_TTL_MS) this.entries.delete(token)
    }
    while (this.entries.size >= MAX_ENTRIES) {
      let oldest: string | null = null
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [token, entry] of this.entries) {
        if (entry.lastAccess < oldestAt) {
          oldestAt = entry.lastAccess
          oldest = token
        }
      }
      if (!oldest) break
      this.entries.delete(oldest)
    }
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = /^\/s\/([0-9a-f]+)$/.exec(req.url ?? '')?.[1]
    const entry = token ? this.entries.get(token) : undefined
    if (!entry) {
      // A token is capability, not identity: an unknown or expired one gets
      // the same flat 404, with nothing to distinguish "never existed" from
      // "expired" for a prober.
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    entry.lastAccess = Date.now()

    // Registered headers are the source's word about itself; the engine's own
    // headers ride along where they describe the exchange (Range for seeks).
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) continue
      if (typeof value === 'string' && FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
        headers[name.toLowerCase()] = value
      }
    }
    for (const [name, value] of Object.entries(entry.headers)) {
      headers[name] = value
    }

    // The proxy decision is this side's: the entry only carries the *wish*,
    // resolved here against the current registry. A wish without a dialable
    // config goes direct — same contract as every marked request.
    const dispatcher = entry.useProxy ? this.dispatcherFor() : null
    if (entry.useProxy && !dispatcher) {
      this.logger?.warn?.('relay: proxy requested for %s but none is configured — fetching direct', new URL(entry.url).host)
    }

    const abort = new AbortController()
    // The engine hanging up (seek, stop, next track) must not leave the
    // upstream fetch running.
    req.on('close', () => abort.abort())
    res.on('close', () => abort.abort())

    try {
      const response = await this.fetchImpl(entry.url, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        redirect: 'follow',
        signal: abort.signal,
        ...(dispatcher ? { dispatcher } : {}),
      })

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        if (!DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders[key.toLowerCase()] = value
      })
      res.writeHead(response.status, responseHeaders)
      if (req.method === 'HEAD' || !response.body) {
        res.end()
        return
      }
      await pipeline(Readable.fromWeb(response.body as never), res)
    } catch (error) {
      // A client-initiated abort is the normal end of a seek/stop, not an error.
      if (!abort.signal.aborted) {
        this.logger?.warn?.('relay: upstream fetch for %s failed: %s', new URL(entry.url).host, String(error))
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' })
        }
        res.end('relay: upstream failed')
      } else if (!res.writableEnded) {
        res.destroy()
      }
    }
  }
}
