/** `ctx.http` — outbound HTTP and persistent cookie jars. See docs/04-core-services.md §2. */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Uri } from '../common.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'

export interface HttpRequest {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
  /** Named cookie jar. Provider instances get their own via `ctx.isolate('http')`. */
  jar?: string
  onProgress?: (loaded: number, total?: number) => void
  /**
   * Route this one request through the proxy configured in settings.
   *
   * Set by the layer that knows *who is asking* — the source runtime per
   * imported source, the lyric-source sandbox per document, the player per
   * track's provider — never by the caller arbitrarily: the flag is a routing
   * *wish*, and the enforcement point (the desktop sidecar, the mobile native
   * client) resolves it against the config it holds itself. A caller that
   * could name its own proxy would be a caller that could point every
   * credential-bearing request at a machine it controls. Absent or false
   * means "go direct"; a marked request with no dialable config also goes
   * direct — the wish the transport may honestly decline.
   */
  useProxy?: boolean
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  /** Final URL, after redirects. */
  url: string
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  bytes(): Promise<Uint8Array>
  stream(): ReadableStream<Uint8Array>
}

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms. Absent means a session cookie. */
  expiresAt?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

/**
 * A persistent, per-instance cookie jar.
 *
 * Signing in once must be enough: the jar is rehydrated at startup so a
 * cookie-backed session survives a restart with no stored password.
 * See docs/06-music-sources.md §4.1.
 */
export interface CookieJar {
  readonly name: string
  /**
   * Resolves once the persisted jar has loaded. Await this before the first
   * request, or a cold start races an empty jar into a spurious 401.
   */
  readonly ready: Promise<void>
  get(url: string): Promise<Cookie[]>
  set(cookies: Cookie[]): Promise<void>
  /** Every cookie, for export or inspection. Never logged. */
  all(): Promise<Cookie[]>
  remove(name: string, domain?: string): Promise<void>
  /** Empties the jar AND deletes its persisted copy. Called by `signOut()`. */
  clear(): Promise<void>
  /**
   * Resolve once every queued save has landed.
   *
   * Saves are queued rather than awaited by `set` — a slow disk must not slow
   * a request — so anything that needs to *observe* the stored bytes has to
   * wait for them: an export, a backup, a sign-out audit. An implementation
   * that writes synchronously satisfies this with `Promise.resolve()`.
   */
  flush(): Promise<void>
}

export interface CookieJarService {
  /** Returns the named jar, creating and rehydrating it on first access. */
  jar(name: string): CookieJar
  /** Forget a jar entirely, including its stored bytes. */
  destroy(name: string): Promise<void>
  list(): Promise<string[]>
}

/**
 * A transfer to a local file.
 *
 * `onResponse` is what a resuming caller needs and nothing else gives it: the
 * `etag` identifies the remote version *now*, before the body is streamed, so
 * a changed file can be restarted rather than spliced. A caller that resumes
 * with the stored `etag` as `If-Range` gets correctness from the server side;
 * one that wants to decide itself reads it here.
 */
export interface DownloadRequest extends HttpRequest {
  /** The local file the body is written to. */
  to: Uri
  /** Byte offset to append from, sent as a `Range` header. */
  resumeFrom?: number
  /** Called once the headers arrive, before any body byte is written. */
  onResponse?: (info: { etag?: string; total?: number }) => void
}

/**
 * One recorded HTTP exchange, for the request log a user can open and read.
 *
 * Credentials never appear here, per the rule that governs every other
 * debugging surface: `cookie`/`authorization` request headers and
 * `set-cookie` response headers are reduced to their header *names* (or a
 * redaction marker), because a log a user can expand is a log that gets
 * pasted into threads.
 *
 * `responseBody` is captured only for text-shaped bodies (JSON, HTML, plain
 * text) and truncated at a ceiling — an audio stream is a transfer, not a
 * document, and has nothing a log reader would want. It fills in when the
 * body drain finishes, so a reader may see it absent on an entry that is
 * otherwise complete.
 */
export interface HttpLogEntry {
  /** Monotonic within one app run. */
  sn: number
  /** Epoch ms, when the request started. */
  time: number
  method: string
  url: string
  /** Absent when the request itself threw (transport failure, abort). */
  status?: number
  durationMs?: number
  requestHeaders: Record<string, string>
  requestBody?: string
  responseHeaders: Record<string, string>
  responseBody?: string
  /** The failure message when the request or its handling threw. */
  error?: string
  /**
   * Whether this exchange was recorded *with* its headers and bodies. A
   * summary-only entry (detail capture switched off when it flew) carries
   * the line a list needs and nothing a detail pane could show — which is
   * what makes it not expandable, rather than expandable-onto-nothing.
   */
  detailed: boolean
}

/** The in-memory journal behind `HttpService.requestLog`. Newest last. */
export interface HttpRequestLog {
  all(): readonly HttpLogEntry[]
  clear(): void
  /**
   * Whether new entries record headers and bodies. On (the default) every
   * exchange is recorded whole; off, only the summary line — the switch is
   * the user's, and it changes entries from now on, not the ones already
   * recorded.
   */
  setCapture(enabled: boolean): void
  captureEnabled(): boolean
}

export interface HttpService {
  (req: HttpRequest): Promise<HttpResponse>
  get<T>(url: string, init?: Omit<HttpRequest, 'url' | 'method'>): Promise<T>
  post<T>(
    url: string,
    body: unknown,
    init?: Omit<HttpRequest, 'url' | 'method' | 'body'>,
  ): Promise<T>
  /** Download to a Uri with resume support. Used by `plugin-download`. */
  download(req: DownloadRequest): Promise<{ bytes: number; etag?: string }>
  /**
   * Replace the default `User-Agent` sent with every request that does not
   * set its own. Live: the next request picks it up, no restart. An empty
   * string restores the implementation's built-in default. Optional — a
   * transport that cannot change it after construction may omit it.
   */
  setUserAgent?(userAgent: string): void
  readonly cookies: CookieJarService
  /**
   * The request journal, when this build keeps one. Optional because a
   * transport with nothing interesting to record (a mock, a proxy without
   * bodies) should not have to pretend.
   */
  readonly requestLog?: HttpRequestLog
}

declare module 'cordis' {
  interface Context {
    http: HttpService
  }
}
