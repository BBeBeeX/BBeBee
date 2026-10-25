/**
 * `ctx.http` for desktop — the M1 slice.
 *
 * A `fetch`-shaped client that is *not* subject to browser rules. In the
 * shipped desktop app the transport is the desktop host net engine, for
 * the CORS and header reasons in docs/02 §2; here it is a seam
 * (`config.fetch`) so the same service runs under test and in the host itself.
 *
 * Every request goes through the `http/request` waterfall, which is where auth
 * injection, retry, rate limiting and caching hook in M2 — the hook is live in
 * M1 with no listeners, so those plugins arrive to something that already
 * works (docs/02 §5).
 *
 * See docs/04-core-services.md §2 and docs/11 §4.5.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { assertHost, capabilityConfigOf } from '@BBeBee/kernel'
import {
  base64Decode,
  base64Encode,
  CapabilityError,
  NetworkError,
  randomHex,
} from '@BBeBee/protocol'
import type {
  Cookie,
  CookieJar,
  CookieJarService,
  DownloadRequest,
  FsService,
  HttpLogEntry,
  HttpRequest,
  HttpResponse,
  HttpRequestLog,
  SecretsService,
  Uri,
} from '@BBeBee/protocol'

export interface HttpNodeConfig {
  /**
   * Where cookie jars are persisted.
   *
   * Absent means in-memory jars that forget on restart — honest, and what a
   * build with no credential store should do. `jarStore(ctx.secrets, ctx.fs)`
   * is the shipped one.
   */
  jars?: JarStore
  /** Transport. Defaults to the runtime's `fetch`. */
  fetch?: typeof fetch
  /** Applied when a request does not set its own. */
  defaultTimeoutMs?: number
  /**
   * How long a download may go without receiving a byte.
   *
   * The request timeout covers headers only: a server that answers and then
   * stops sending would otherwise hold the transfer open indefinitely, which
   * on mobile means holding a wake lock indefinitely too.
   */
  stallTimeoutMs?: number
  /** Sent on every request unless overridden. */
  userAgent?: string
}

/**
 * Redirect hops we will follow before giving up.
 *
 * Matches what `fetch` allows, so raising the check to our own loop does not
 * change behaviour for honest servers.
 */
const MAX_REDIRECTS = 20

/** Schemes a redirect may lead to. Anything else is refused, not followed. */
const FOLLOWABLE_SCHEMES = new Set(['http:', 'https:'])

/**
 * How many exchanges the journal keeps, and how much of any one body. Both
 * are ceilings, not promises: an in-memory journal that grows with the
 * session is a leak with a friendly name, and a body copied whole would make
 * an audio download a second download.
 */
const HTTP_JOURNAL_CAP = 400
const HTTP_JOURNAL_BODY_BYTES = 200_000

/** Request headers whose values are credentials, by any spelling. */
const REDACTED_REQUEST_HEADERS = new Set(['authorization', 'proxy-authorization'])

function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (REDACTED_REQUEST_HEADERS.has(name.toLowerCase())) {
      out[name] = '<redacted>'
    } else if (name.toLowerCase() === 'cookie') {
      // Names are what a source debugger needs ("was buvid3 sent?"); the
      // values are session material and are never written down here.
      const names = value
        .split(';')
        .map((pair) => pair.split('=')[0]?.trim())
        .filter(Boolean)
      out[name] = names.map((name) => `${name}=<redacted>`).join('; ')
    } else {
      out[name] = value
    }
  }
  return out
}

function redactResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = name.toLowerCase() === 'set-cookie' ? '<redacted>' : value
  }
  return out
}

/** `Headers` as a plain record, through `forEach` — the one iteration that is typed everywhere. */
function headersOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

/**
 * Whether the body is worth copying for the log.
 *
 * Text shapes only — JSON, HTML, plain text, XML — because those are what a
 * log reader can read. Transfers are excluded by shape (audio, video, images,
 * `octet-stream`) and by intent (a `Range` request is the player seeking, not
 * a document being read), and so is anything the `Content-Length` already
 * says is far past the cap.
 */
function bodyWorthCapturing(req: HttpRequest, response: Response): boolean {
  if (!response.body) return false
  if (response.status === 204 || response.status === 304) return false
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (/^(audio|video|image)\//.test(contentType)) return false
  if (contentType.includes('octet-stream')) return false
  const length = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(length) && length > HTTP_JOURNAL_BODY_BYTES * 2) return false
  if (Object.keys(req.headers ?? {}).some((name) => name.toLowerCase() === 'range')) return false
  return true
}

/** Drain a tee'd copy of the body into the journal's text, capped. */
async function drainCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
  const reader = stream.getReader()
  const chunks: string[] = []
  let total = 0
  const decoder = new TextDecoder()
  while (total <= cap) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    chunks.push(text)
    total += text.length
  }
  try {
    await reader.cancel()
  } catch {
    // The copy's own death is not the request's problem.
  }
  const text = chunks.join('')
  return total > cap ? `${text.slice(0, cap)}…[truncated, ${total} chars in total]` : text
}

/**
 * The in-memory journal behind `ctx.http.requestLog`.
 *
 * One entry per exchange, pushed the moment the response headers arrive (so
 * an in-flight request is visible), its body filled in later by the drain.
 * Capped oldest-first: a long session with a chatty source must not grow it.
 *
 * Detail capture is switchable: off, entries record the summary line only —
 * no headers, no bodies, nothing for a detail pane to show. Entries already
 * recorded keep whatever they captured; the switch answers "from now on".
 */
class HttpJournal {
  private entries: HttpLogEntry[] = []
  private nextSn = 1
  private capture = true

  get captureEnabled(): boolean {
    return this.capture
  }

  setCapture(enabled: boolean): void {
    this.capture = enabled
  }

  record(
    entry: Omit<HttpLogEntry, 'sn'> & { responseBody?: HttpLogEntry['responseBody'] },
  ): HttpLogEntry {
    const full: HttpLogEntry = { ...entry, sn: this.nextSn++ }
    this.entries.push(full)
    if (this.entries.length > HTTP_JOURNAL_CAP) {
      this.entries.splice(0, this.entries.length - HTTP_JOURNAL_CAP)
    }
    return full
  }

  all(): readonly HttpLogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }
}

export class HttpNode extends Service {
  static inject = ['fs']

  /** The UA a request carries when neither the config nor the caller sets one. */
  static readonly DEFAULT_USER_AGENT = 'BBeBee/0.1'

  private readonly config: Required<Omit<HttpNodeConfig, 'fetch' | 'jars'>> & {
    fetch: typeof fetch
  }
  /** What `setUserAgent('')` restores — the UA this platform was built with. */
  private readonly fallbackUserAgent: string
  readonly cookies: CookieJarService
  private readonly jars: MemoryJars
  private readonly journal = new HttpJournal()
  readonly requestLog: HttpRequestLog = {
    all: () => this.journal.all(),
    clear: () => this.journal.clear(),
    setCapture: (enabled) => this.journal.setCapture(enabled),
    captureEnabled: () => this.journal.captureEnabled,
  }

  constructor(ctx: Context, config: HttpNodeConfig = {}) {
    super(ctx, 'http')
    this.fallbackUserAgent = config.userAgent ?? HttpNode.DEFAULT_USER_AGENT
    this.config = {
      fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
      stallTimeoutMs: config.stallTimeoutMs ?? 60_000,
      userAgent: config.userAgent ?? HttpNode.DEFAULT_USER_AGENT,
    }
    this.jars = new MemoryJars(config.jars)
    this.cookies = this.jars
  }

  /**
   * Replace the default `User-Agent` mid-flight.
   *
   * The setting lives in `ctx.settings` — a layer above this package — so it
   * arrives here pushed by the composition root rather than polled, and it is
   * read per request in `followRedirects`, which is what makes the change
   * land on the next request rather than the next restart. An empty string
   * restores the built-in default; a document that declares its own
   * `header` rule still wins, because caller headers are merged in last.
   */
  setUserAgent(userAgent: string): void {
    const trimmed = typeof userAgent === 'string' ? userAgent.trim() : ''
    this.config.userAgent = trimmed.length > 0 ? trimmed : this.fallbackUserAgent
  }

  async [Service.init]() {
    /*
     * Persist jars through `ctx.secrets` when there is one.
     *
     * A nested `inject` rather than a required dependency: a build with no
     * credential store still needs HTTP, and in-memory jars that forget on
     * restart are the honest behaviour there. Wiring it here rather than at
     * every call site means a shell cannot forget to — and a shell that forgot
     * would produce an app where signing in appears to work and never sticks.
     */
    return this.ctx.inject(['secrets'], (scoped) => {
      this.jars.useStore(jarStore(scoped.secrets, this.ctx.fs))
      return () => this.jars.useStore(undefined)
    }).dispose
  }

  /**
   * The jar for the current scope, or none for an ungated caller.
   *
   * Read from the intercept config rather than passed in, because the scope is
   * a property of *who is asking* — the same service instance serves every
   * source, and each sees only its own jar.
   */
  private jarForScope(): CookieJar | undefined {
    const gate = capabilityConfigOf(this[Service.resolveConfig]())
    return gate?.scopeId ? this.cookies.jar(gate.scopeId) : undefined
  }

  /** `ctx.http(req)`. Cordis calls this for the service's own call signature. */
  protected [Service.invoke](req: HttpRequest): Promise<HttpResponse> {
    return this.request(req)
  }

  /**
   * The one place a request actually goes out.
   *
   * Dispatched as a waterfall so a listener can rewrite the request, answer it
   * from a cache, or retry it — without this service knowing any of those
   * exist.
   */
  // `async` deliberately: a refused host must arrive as a *rejection* like
  // every other failure, not as a synchronous throw that callers would have to
  // wrap separately.
  async request(req: HttpRequest): Promise<HttpResponse> {
    // The `net:host/<glob>` gate, before anything else — including before the
    // waterfall, so a listener cannot be used to launder a host the caller was
    // never granted. Ungated callers (the kernel, core services, tests) pass
    // through; a plugin is held to its manifest. Without this the grant was a
    // manifest string with no meaning, exactly as `db:own` once was.
    assertHost(this[Service.resolveConfig](), req.url)
    // The terminal takes no arguments: `next` is closed over the original
    // request, so a listener rewrites it by mutating `req` in place. The
    // object here is the one every listener saw (docs/07 §5).
    return this.ctx.waterfall('http/request', req, () => this.send(req))
  }

  async get<T>(url: string, init: Omit<HttpRequest, 'url' | 'method'> = {}): Promise<T> {
    const response = await this.request({ ...init, url, method: 'GET' })
    return response.json<T>()
  }

  async post<T>(
    url: string,
    body: unknown,
    init: Omit<HttpRequest, 'url' | 'method' | 'body'> = {},
  ): Promise<T> {
    const response = await this.request({
      ...init,
      url,
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...init.headers },
    })
    return response.json<T>()
  }

  /**
   * Stream a URL to a file, resuming where asked.
   *
   * Written now rather than at M3 because it is the same code either way, and
   * because a `download` that exists only as a signature is the kind of
   * half-member docs/06 §1.1 warns about. The *policy* around it — the task
   * queue, the checkpoints, `wifi_only` — is M3's and lives in
   * `plugin-download`.
   */
  async download(req: DownloadRequest): Promise<{ bytes: number; etag?: string }> {
    const headers = { ...req.headers }
    if (req.resumeFrom) headers['range'] = `bytes=${req.resumeFrom}-`

    const response = await this.request({ ...req, headers, method: req.method ?? 'GET' })
    if (response.status >= 400) {
      throw new NetworkError(`download failed: ${response.status} for ${req.url}`)
    }

    const append = Boolean(req.resumeFrom) && response.status === 206
    const total = contentLengthOf(response, append ? (req.resumeFrom ?? 0) : 0)
    // Before a byte is written: the resume path uses the etag to decide
    // whether these bytes are even the same file, and discovering that after
    // the append is how a corrupt splice happens.
    req.onResponse?.({
      ...(response.headers['etag'] ? { etag: response.headers['etag'] } : {}),
      ...(total !== undefined ? { total } : {}),
    })

    const writer = this.ctx.fs.createWriteStream(req.to, { append }).getWriter()
    const reader = response.stream().getReader()
    let bytes = req.resumeFrom && append ? req.resumeFrom : 0

    try {
      for (;;) {
        const { done, value } = await withStallTimeout(
          reader.read(),
          this.config.stallTimeoutMs,
          req.url,
        )
        if (done) break
        await writer.write(value)
        bytes += value.byteLength
        req.onProgress?.(bytes, total)
      }
      await writer.close()
    } catch (error) {
      await writer.abort(error).catch(() => undefined)
      throw error
    }

    const etag = response.headers['etag']
    return { bytes, ...(etag ? { etag } : {}) }
  }

  private async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController()
    const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined
    const onAbort = () => controller.abort(req.signal?.reason)
    req.signal?.addEventListener('abort', onAbort)

    /*
     * ⚠️ The caller's signal has to outlive the *headers*.
     *
     * This used to be a `finally`, which detached the moment the response
     * resolved — and a response resolves when the headers arrive, with the
     * body still streaming. So `AbortSignal` worked for a request that had not
     * answered yet and silently did nothing for one that had, which is the
     * case that matters: the player cancels a prefetch mid-download when the
     * queue changes (MD-5), and cancelling a download that has already started
     * is the entire point.
     *
     * The header timeout *is* done when the headers arrive — that is what
     * `timeoutMs` means here — so it is cleared separately below.
     */
    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      if (timer) clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
    }

    try {
      const response = await this.followRedirects(req, controller, detach)
      if (timer) clearTimeout(timer)
      return response
    } catch (error) {
      detach()
      // A capability refusal is not a transport failure. It has to propagate
      // as itself: `NetworkError` is the one class the player retries with
      // backoff (docs/06 §7), so wrapping it would turn a blocked request into
      // an endlessly retried one and hide *why* it was blocked. This matters
      // now that the host check runs per redirect hop, inside this try.
      if (error instanceof CapabilityError) throw error
      throw new NetworkError(
        error instanceof Error ? error.message : String(error),
        undefined,
        { cause: error },
      )
    }
  }

  private async followRedirects(
    req: HttpRequest,
    controller: AbortController,
    /** Called once the response body has settled, so `send` can detach. */
    onSettled: () => void,
  ): Promise<HttpResponse> {
    const mode = req.redirect ?? 'follow'
    let url = req.url

    /*
     * The jar belongs to the *scope*, which is one imported source.
     *
     * `intercept('http', { scopeId })` is what `plugin-source-runtime` sets per
     * source (docs/06 §4.1), so two Navidrome servers get two jars and a cookie
     * set by one is never sent to the other. An ungated caller — the kernel, a
     * core service, a test — has no scope and therefore no jar, which is right:
     * there is no session to keep.
     */
    const jar = this.jarForScope()
    await jar?.ready

    /*
     * Caller credentials belong to the host the caller named. The
     * request may be redirected — method, body, and the headers that
     * describe the payload travel — but Authorization/Cookie do not:
     * the redirect target is chosen by the *server*, which is exactly
     * the party those credentials must not leak to. The strip is sticky
     * for the rest of the chain (a later hop back to the original host
     * does not resurrect them), matching fetch. Cookies the jar
     * computes per hop URL below are unaffected — they are already
     * scoped to each hop's URL by construction.
     */
    const originalHost = hostOf(url)
    const callerHeaders: Record<string, string> = { ...(req.headers ?? {}) }
    let credentialsStripped = false

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Every hop, not just the first. A listener may also have rewritten the
      // URL during the waterfall, and the rewritten host must be granted too.
      assertHost(this[Service.resolveConfig](), url)

      if (!credentialsStripped && originalHost !== '' && hostOf(url) !== originalHost) {
        for (const headerName of Object.keys(callerHeaders)) {
          if (CREDENTIAL_HEADER_NAMES.has(headerName.toLowerCase())) delete callerHeaders[headerName]
        }
        credentialsStripped = true
      }

      const cookieHeader = jar ? await cookieHeaderFor(jar, url) : undefined
      const startTime = Date.now()
      const requestHeaders: Record<string, string> = {
        'user-agent': this.config.userAgent,
        // Under an explicit header, so a document that sets its own Cookie
        // wins — it knows something the jar does not.
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...callerHeaders,
      }
      let response: Response
      try {
        response = await this.config.fetch(url, {
          method: req.method ?? 'GET',
          headers: requestHeaders,
          ...(req.body !== undefined ? { body: req.body as BodyInit } : {}),
          // Always manual: following internally would skip the check above.
          redirect: 'manual',
          signal: controller.signal,
        })
      } catch (error) {
        // A transport failure is a log entry too — the user reading the
        // journal should see the request that never got a response and why.
        this.journal.record({
          time: startTime,
          method: req.method ?? 'GET',
          url,
          requestHeaders: this.journal.captureEnabled
            ? redactRequestHeaders(requestHeaders)
            : {},
          ...(this.journal.captureEnabled &&
          req.body !== undefined &&
          typeof req.body === 'string'
            ? { requestBody: req.body.slice(0, HTTP_JOURNAL_BODY_BYTES) }
            : {}),
          responseHeaders: {},
          error: error instanceof Error ? error.message : String(error),
          detailed: this.journal.captureEnabled,
        })
        throw error
      }
      const durationMs = Date.now() - startTime
      this.ctx.logger.info(`[HTTP] ${req.method ?? 'GET'} ${url} -> ${response.status} (${durationMs}ms)`)

      // The journal entry goes in with the headers; the body fills in as the
      // tee'd copy drains, so the reader may see it arrive a beat later.
      const entry = this.journal.record({
        time: startTime,
        method: req.method ?? 'GET',
        url,
        status: response.status,
        durationMs,
        requestHeaders: this.journal.captureEnabled
          ? redactRequestHeaders(requestHeaders)
          : {},
        ...(this.journal.captureEnabled &&
        req.body !== undefined &&
        typeof req.body === 'string'
          ? { requestBody: req.body.slice(0, HTTP_JOURNAL_BODY_BYTES) }
          : {}),
        responseHeaders: this.journal.captureEnabled
          ? redactResponseHeaders(headersOf(response))
          : {},
        detailed: this.journal.captureEnabled,
      })

      // Before the redirect branch: a login flow sets its session cookie *on*
      // the 302, and reading it only from the final response drops it.
      if (jar) await storeSetCookies(jar, this.listSetCookies(response), url)

      const status = response.status
      const isRedirectStatus = status >= 300 && status < 400 && status !== 304
      const location = response.headers.get('location')

      // `redirect: 'error'` rejects on *any* redirect status, with or without
      // a Location — that is what `fetch` does, and a caller who asked to be
      // told about redirects is not served by silently handing back a 302 that
      // happened to be malformed.
      if (isRedirectStatus && mode === 'error') {
        throw new NetworkError(`unexpected ${status} redirect from ${url}`)
      }
      if (!isRedirectStatus || !location || mode !== 'follow') {
        // The body is captured through a tee, not by reading the caller's
        // copy: the request the caller sees behaves exactly as before, and
        // the journal drains its own branch in the background. Detail
        // capture off means no tee at all — the summary line is the entry.
        const body = response.body
        if (this.journal.captureEnabled && body && bodyWorthCapturing(req, response)) {
          const [main, copy] = body.tee()
          response = new Response(main, {
            status: response.status,
            statusText: response.statusText,
            // As a plain record, not as the Headers object: the global
            // `Response` here is whichever one the runtime has, and a record is
            // the one HeadersInit *every* of them understands — undici's
            // dictionary branch, React Native's whatwg-fetch object branch.
            // Handing the transport's own Headers object over relies on the
            // two classes being the same class, which holds on desktop and
            // nowhere else.
            headers: headersOf(response),
          })
          void drainCapped(copy, HTTP_JOURNAL_BODY_BYTES).then((text) => {
            entry.responseBody = text
          })
        }
        return wrap(response, req.onProgress, onSettled)
      }

      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new NetworkError(`malformed redirect from ${url}: ${location}`)
      }
      // A redirect may move hosts; it may not move *schemes* into something
      // that reads local state. `file:` and `data:` are refused by undici
      // today, but this transport is meant to be swappable — and a scheme
      // check is one line against a class of bug that is very hard to see.
      if (!FOLLOWABLE_SCHEMES.has(next.protocol)) {
        throw new NetworkError(`refusing a ${next.protocol} redirect from ${url}`)
      }
      // Discard the redirect body — it is never read, and leaving it
      // unconsumed pins the connection until GC. `cancel()` releases the
      // stream; it does not drain it, so the socket may or may not be
      // reusable, which is the transport's business rather than ours.
      await response.body?.cancel().catch(() => {})
      url = next.href
    }

    throw new NetworkError(`too many redirects: ${req.url}`)
  }

  /**
   * Every `set-cookie` header a response carries, not just the first.
   *
   * A login response routinely sets two — a session and a CSRF token — and
   * `headers.get('set-cookie')` joins them into one string that cannot be
   * naively split, because an `Expires` date contains a comma.
   *
   * Overridable on purpose, because runtimes disagree about where the split
   * actually lives. WHATWG runtimes (desktop undici, the Tauri host) expose
   * `getSetCookie()`; expo/fetch builds its `Headers` through React Native's
   * `whatwg-fetch` polyfill, which has neither that accessor nor a way to keep
   * repeated values apart — but its `FetchResponse` holds the raw
   * `[name, value][]` pairs it constructed the `Headers` from, and only the
   * transport that produced the response knows that. `HttpRn` overrides this
   * to read them; the default never names any transport, and its last resort
   * is the conservative splitter below rather than handing the jar one
   * mangled line.
   */
  protected listSetCookies(response: Response): string[] {
    const headers = response.headers as Headers & { getSetCookie?(): string[] }
    if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
    const joined = headers.get('set-cookie')
    return joined ? splitJoinedSetCookie(joined) : []
  }
}

/**
 * The expected total, given what the server actually did.
 *
 * `resumeFrom` is only part of the total when the server honoured the range
 * (206). A server that ignored it sends the whole body with a 200, and adding
 * the offset then reports a total larger than the file — a progress bar that
 * never reaches the end.
 */
/** Reject if a chunk does not arrive in time, so a dead stream is an error. */
async function withStallTimeout<T>(work: Promise<T>, ms: number, url: string): Promise<T> {
  if (ms <= 0) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new NetworkError(`download stalled for ${ms}ms: ${url}`)),
      ms,
    )
  })
  try {
    return await Promise.race([work, stalled])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function contentLengthOf(response: HttpResponse, alreadyHave: number): number | undefined {
  const raw = response.headers['content-length']
  if (!raw) return undefined
  const length = Number(raw)
  return Number.isFinite(length) ? length + alreadyHave : undefined
}

/**
 * `Response` → the contract's shape, with progress if anyone asked.
 *
 * `onSettled` fires once the body is finished with — read to the end,
 * cancelled, or failed — which is what tells `send` it may finally stop
 * bridging the caller's `AbortSignal`. Every path that consumes a body calls
 * it, because the one that does not is the one that leaks a listener.
 */
function wrap(
  response: Response,
  onProgress?: HttpRequest['onProgress'],
  onSettled: () => void = () => {},
): HttpResponse {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const total = Number(response.headers.get('content-length') ?? '') || undefined

  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    onSettled()
  }

  /*
   * A response with no body has nothing left to abort.
   *
   * Settling here rather than waiting for a read closes a leak on the calls
   * that never read one: `ping()` and the `Accept-Ranges` probe are HEADs that
   * look only at `status`, so nothing would ever have detached the caller's
   * `AbortSignal` listener — and a source that pings on a timer would
   * accumulate one per tick on a signal it holds for its whole lifetime.
   */
  if (!response.body) settle()

  const whole = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read()
    } finally {
      settle()
    }
  }

  return {
    status: response.status,
    headers,
    url: response.url,
    text: () => whole(() => response.text()),
    json: <T>() => whole(() => response.json() as Promise<T>),
    bytes: () => whole(async () => new Uint8Array(await response.arrayBuffer())),
    /*
     * Always wrapped, even with no `onProgress`.
     *
     * Handing back `response.body` directly is cheaper but gives no hook for
     * "the caller stopped reading", and cancellation is exactly what a
     * prefetch abandoned by a queue change needs to be observable.
     */
    stream: () => {
      const body = response.body
      if (!body) {
        settle()
        return emptyStream()
      }
      const reader = body.getReader()
      let loaded = 0
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              settle()
              controller.close()
              return
            }
            loaded += value.byteLength
            onProgress?.(loaded, total)
            controller.enqueue(value)
          } catch (error) {
            settle()
            controller.error(error)
          }
        },
        cancel(reason) {
          settle()
          return reader.cancel(reason)
        },
      })
    },
  }
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

/* ── cookies ────────────────────────────────────────────────────────────── */

/**
 * Cookie jars, persisted through `ctx.secrets` when it is there.
 *
 * "Sign in once, stay signed in" (docs/10 §M2) is a cookie-jar property before
 * it is anything else, and the jar is credential material — so it goes to the
 * credential store rather than beside the database.
 *
 * ⚠️ It is **envelope-encrypted**, and that is forced by the platform, not a
 * preference: `expo-secure-store` caps a value at 2048 bytes and a jar is
 * routinely larger. So a random key lives in `ctx.secrets` and the jar itself
 * lives in a file encrypted under it (docs/04 §2.1). Without `ctx.secrets` the
 * jars stay in memory and are honest about forgetting.
 */
class MemoryJars implements CookieJarService {
  private readonly jars = new Map<string, MemoryJar>()

  constructor(private store: JarStore | undefined) {}

  /**
   * Adopt a persistent store once one exists.
   *
   * ⚠️ Only affects jars created *after* this. A jar already handed out has
   * already hydrated (from nothing) and callers hold it, so retrofitting one
   * would swap its contents under them. The credential store is a bootstrap
   * service and arrives before any source starts, so in practice this runs
   * first; the restriction is stated because "in practice" is not "always".
   */
  useStore(store: JarStore | undefined): void {
    this.store = store
  }

  jar(name: string): CookieJar {
    let jar = this.jars.get(name)
    if (!jar) {
      jar = new MemoryJar(name, this.store)
      this.jars.set(name, jar)
    }
    return jar
  }

  async destroy(name: string): Promise<void> {
    this.jars.delete(name)
    await this.store?.delete(name)
  }

  async list(): Promise<string[]> {
    const stored = (await this.store?.list()) ?? []
    return [...new Set([...this.jars.keys(), ...stored])]
  }
}

/** Where a jar's bytes go. Implemented over `ctx.secrets` — see `jarStore`. */
export interface JarStore {
  read(name: string): Promise<Cookie[] | undefined>
  write(name: string, cookies: Cookie[]): Promise<void>
  delete(name: string): Promise<void>
  list(): Promise<string[]>
}

class MemoryJar implements CookieJar {
  readonly ready: Promise<void>
  private cookies: Cookie[] = []
  /** Serialises saves against each other and against `clear()`. */
  private writes: Promise<void> = Promise.resolve()

  constructor(
    readonly name: string,
    private readonly store?: JarStore,
  ) {
    /*
     * `ready` is part of the contract for a reason: a request that goes out
     * before the persisted jar has loaded is a request with no session, and
     * the user sees a spurious sign-in prompt on every cold start. Callers
     * await this before the first request.
     */
    this.ready = this.hydrate()
  }

  private async hydrate(): Promise<void> {
    if (!this.store) return
    try {
      this.cookies = (await this.store.read(this.name)) ?? []
    } catch {
      // An unreadable jar means "sign in again", which is recoverable.
      this.cookies = []
    }
  }

  /**
   * Queue a save. Never awaited by a request — a slow disk must not slow a
   * fetch — but strictly ordered against every other jar operation.
   *
   * ⚠️ The ordering is the whole reason this is a queue rather than a bare
   * `void store.write(...)`. `clear()` is what `signOut()` calls, and an
   * in-flight save landing *after* the delete rewrites the file and signs the
   * user back in. Measured: the jar came back after being cleared.
   */
  private persist(): void {
    if (!this.store) return
    const store = this.store
    // Session cookies (no expiry) are deliberately not written: they are
    // defined to last for the session, and persisting them would resurrect a
    // login the server considers over.
    const snapshot = this.cookies.filter((c) => c.expiresAt !== undefined)
    this.writes = this.writes
      .then(() => store.write(this.name, snapshot))
      .catch(() => undefined)
  }

  /** Everything queued so far. `clear()` and tests await it. */
  private settled(): Promise<void> {
    return this.writes
  }

  async get(url: string): Promise<Cookie[]> {
    const host = hostOf(url)
    const now = Date.now()
    // Expired cookies are dropped rather than replayed, which otherwise
    // produces a confusing "logged in but every request fails" state.
    this.cookies = this.cookies.filter((c) => !c.expiresAt || c.expiresAt > now)
    // A bare `endsWith` sends example.com's cookie to evilexample.com. The
    // boundary is a dot, or an exact match — RFC 6265 §5.1.3.
    return this.cookies.filter((c) => {
      const domain = c.domain.replace(/^\./, '').toLowerCase()
      return host === domain || host.endsWith(`.${domain}`)
    })
  }

  async set(cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      const at = this.cookies.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path,
      )
      if (at >= 0) this.cookies[at] = cookie
      else this.cookies.push(cookie)
    }
    this.persist()
  }

  async all(): Promise<Cookie[]> {
    return [...this.cookies]
  }

  async remove(name: string, domain?: string): Promise<void> {
    this.cookies = this.cookies.filter(
      (c) => !(c.name === name && (domain === undefined || c.domain === domain)),
    )
    this.persist()
  }

  async clear(): Promise<void> {
    this.cookies = []
    // Behind whatever is queued, so a save already in flight cannot land after
    // the delete and resurrect the session.
    await this.settled()
    // Deleted, not written empty: `clear()` is what `signOut()` calls, and
    // "sign out leaves nothing" means the stored copy goes too.
    await this.store?.delete(this.name)
  }

  /**
   * Resolve once every queued save has landed.
   *
   * Part of the jar's own surface rather than a test hook: anything that needs
   * to observe the stored bytes — an export, a backup, a sign-out audit — has
   * the same problem the tests do.
   */
  async flush(): Promise<void> {
    await this.settled()
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Header names that carry *caller* credentials. On a cross-host
 * redirect these are stripped (see `followRedirects`); cookie headers
 * the jar computes per hop URL are a separate, already-scoped channel.
 */
const CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
])

export const name = 'core-http-desktop'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.http` is usable.
 */
export async function apply(ctx: Context, config: HttpNodeConfig = {}) {
  ctx.logger.info('core-http-desktop: loaded')
  const fiber = await ctx.plugin(HttpNode, config)
  return () => void fiber.dispose()
}

export default { name, apply }


/**
 * A `JarStore` over `ctx.secrets` and the filesystem.
 *
 * Envelope encryption, because the platform forces it: `expo-secure-store`
 * caps a value at 2048 bytes and a cookie jar is routinely larger. So the
 * *key* — small, and the only thing that must be protected — goes in the
 * credential store, and the jar goes in a file encrypted under it (docs/04
 * §2.1). Losing the key makes the file unreadable, which is the intended
 * behaviour of "sign out leaves nothing".
 */
export function jarStore(secrets: SecretsService, fs: FsService): JarStore {
  const keyFor = async (name: string): Promise<string> => {
    const existing = await secrets.get(`jar-key:${name}`)
    if (existing) return existing
    const minted = randomHex(32)
    await secrets.set(`jar-key:${name}`, minted)
    return minted
  }

  const fileFor = async (name: string): Promise<Uri | undefined> => {
    const dir = await fs.dir('data')
    // A jar name is a source id — already slug-shaped — but this is a path, so
    // it is sanitised rather than trusted.
    return dir ? fs.join(dir, `jar-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`) : undefined
  }

  return {
    async read(name) {
      const file = await fileFor(name)
      if (!file) return undefined
      // A source that has never signed in has no jar, which is the common
      // case and not an error. It is asked rather than caught because on
      // desktop `fs` is an IPC bridge whose rejections are logged in main
      // before this `catch` runs — one ENOENT stack per request otherwise.
      if (!(await fs.exists(file))) return undefined
      try {
        const cipher = await fs.readFile(file)
        const parsed: unknown = JSON.parse(xorText(base64Decode(cipher), await keyFor(name)))
        return Array.isArray(parsed) ? (parsed as Cookie[]) : undefined
      } catch {
        // Missing, or written under a key that is gone. Either way: signed out.
        return undefined
      }
    },

    async write(name, cookies) {
      const file = await fileFor(name)
      if (!file) return
      const body = base64Encode(xorText(JSON.stringify(cookies), await keyFor(name)))
      await fs.writeFile(file, body)
    },

    async delete(name) {
      // The key first: without it the file is bytes, so a failure to remove
      // the file cannot leave a readable jar behind.
      await secrets.delete(`jar-key:${name}`)
      const file = await fileFor(name)
      if (file) await fs.remove(file).catch(() => undefined)
    },

    async list() {
      const dir = await fs.dir('data')
      if (!dir) return []
      try {
        const entries = await fs.list(dir)
        return entries
          .map((entry) => /^jar-(.+)\.bin$/.exec(entry.name)?.[1])
          .filter((name): name is string => name !== undefined)
      } catch {
        return []
      }
    },
  }
}

function xorText(value: string, key: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    out += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return out
}


/* ── cookies on the wire ────────────────────────────────────────────────── */

/** `name=value; name=value` for the cookies this jar holds for `url`. */
async function cookieHeaderFor(jar: CookieJar, url: string): Promise<string | undefined> {
  const cookies = await jar.get(url)
  if (cookies.length === 0) return undefined
  // `secure` cookies are withheld from a plaintext request. A LAN Navidrome on
  // http would otherwise have its session sent in the clear by a redirect it
  // did not choose.
  const secureOk = url.startsWith('https:')
  const usable = cookies.filter((c) => !c.secure || secureOk)
  if (usable.length === 0) return undefined
  return usable.map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * Read `set-cookie` into the jar.
 *
 * Deliberately small. This is not a full RFC 6265 parser and does not try to
 * be: it handles the attributes a session depends on — expiry, domain, path,
 * the flags — and ignores the rest rather than guessing at them. The lines
 * arrive already separated (see `listSetCookies`); nothing here has to guess
 * where one cookie ends.
 */
async function storeSetCookies(jar: CookieJar, lines: string[], url: string): Promise<void> {
  if (lines.length === 0) return

  const requestHost = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()

  const cookies: Cookie[] = []
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';')
    const eq = pair?.indexOf('=') ?? -1
    if (!pair || eq <= 0) continue

    const cookie: Cookie = {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: requestHost,
      path: '/',
      secure: false,
      httpOnly: false,
    }

    for (const attribute of attributes) {
      const [rawName, ...rest] = attribute.split('=')
      const name = rawName?.trim().toLowerCase()
      const value = rest.join('=').trim()
      if (name === 'domain' && value) {
        /*
         * A server may only widen to its own registrable parent, never to an
         * unrelated host. Without this check a compromised backend could set a
         * cookie for a domain it does not own, and the jar would then send it
         * there — the classic cookie-injection shape.
         */
        const candidate = value.replace(/^\./, '').toLowerCase()
        if (requestHost === candidate || requestHost.endsWith(`.${candidate}`)) {
          cookie.domain = candidate
        }
      } else if (name === 'path' && value.startsWith('/')) {
        cookie.path = value
      } else if (name === 'secure') {
        cookie.secure = true
      } else if (name === 'httponly') {
        cookie.httpOnly = true
      } else if (name === 'samesite' && value) {
        const mode = value.toLowerCase()
        if (mode === 'strict' || mode === 'lax' || mode === 'none') cookie.sameSite = mode
      } else if (name === 'max-age' && value) {
        const seconds = Number(value)
        // Max-Age wins over Expires where both are present, per RFC 6265 §5.3.
        if (Number.isFinite(seconds)) cookie.expiresAt = Date.now() + seconds * 1000
      } else if (name === 'expires' && value && cookie.expiresAt === undefined) {
        const at = Date.parse(value)
        if (Number.isFinite(at)) cookie.expiresAt = at
      }
    }
    cookies.push(cookie)
  }
  if (cookies.length > 0) await jar.set(cookies)
}

/**
 * Split a *joined* `set-cookie` value into the cookies it carries.
 *
 * This is the fallback for runtimes with neither `getSetCookie()` (desktop
 * undici has it) nor a raw-pair escape hatch (expo/fetch has that, and
 * `HttpRn` reads it) — a `Headers` that reports one `set-cookie` string with
 * every cookie the server sent, comma-joined. Splitting it on commas alone is
 * wrong in the most common place a comma appears: an `Expires` date
 * (`Expires=Wed, 21 Oct 2015 07:28:00 GMT`).
 *
 * So the split is conservative, not clever: a comma starts a new cookie only
 * when what follows looks like a *new* `name=value` pair — a non-empty run of
 * token characters (RFC 2616's `token`, which cookie names are) ending in
 * `=`. A date continuation (`21 Oct 2015 …`, `21-Oct-2015 …`) runs into a
 * space or a digit-without-`=` first and so never splits, while the joined
 * next cookie (`csrf=tok`) does. Commas inside a quoted value are skipped
 * outright. What this refuses to decide it leaves joined — one mangled cookie
 * is no worse than the single-string behaviour it replaces, and both raw
 * sources above make it unreachable on the shipped platforms.
 */
const COOKIE_NAME_CHARS = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function splitJoinedSetCookie(joined: string): string[] {
  const cookies: string[] = []
  let start = 0
  let inQuotes = false
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i]
    if (ch === '"') {
      // A quoted cookie value may hold commas (RFC 6265 `cookie-value`); a
      // stray quote at worst leaves us joined, which is the safe direction.
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes && opensNewCookie(joined, i + 1)) {
      cookies.push(joined.slice(start, i))
      start = i + 1
    }
  }
  cookies.push(joined.slice(start))
  return cookies.map((cookie) => cookie.trim()).filter((cookie) => cookie.length > 0)
}

/** Whether the text at `from` opens a new `name=value` pair. */
function opensNewCookie(header: string, from: number): boolean {
  let i = from
  while (i < header.length && (header[i] === ' ' || header[i] === '\t')) i++
  const nameStart = i
  while (i < header.length && COOKIE_NAME_CHARS.test(header[i] ?? '')) i++
  return i > nameStart && header[i] === '='
}
