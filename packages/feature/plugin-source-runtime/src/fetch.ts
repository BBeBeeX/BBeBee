/**
 * Fetching the document a rule is evaluated against.
 *
 * A rule that produces a URL may instead produce a **URL object**: the URL, a
 * comma, and a JSON options blob. Kept because it is
 * compact enough to live in a form field on a phone (docs/06 §3.5):
 *
 *     https://api.example.org/search,{"method":"POST","body":"q={{key}}"}
 *
 * ⚠️ Splitting on the comma is not as simple as it looks: a URL may contain
 * commas, and a body certainly may. The split is at the *first* comma that is
 * followed by something parsing as a JSON object — anything else is part of
 * the URL.
 */

import {
  AuthError,
  NetworkError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RuleError,
  isRetryable,
} from '@BBeBee/protocol'
import type { HttpRequest, HttpService } from '@BBeBee/protocol'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD'
  body?: string
  headers?: Record<string, string>
  /** Decode a non-UTF-8 response — `gbk`, `big5`, `shift_jis`. */
  charset?: string
  /** Attempts before the call is an error; default 1 (docs/06 §3.5). */
  retry?: number
}

export interface ParsedUrl {
  url: string
  options: RequestOptions
}

/**
 * Split a rendered rule into a URL and its options.
 *
 * Tolerant on purpose: a document whose options blob is malformed gets the
 * whole string treated as a URL, which fails as a bad request naming the URL
 * rather than as a parse error naming nothing.
 */
export function parseUrlObject(rendered: string): ParsedUrl {
  const text = rendered.trim()

  for (let i = text.indexOf(','); i !== -1; i = text.indexOf(',', i + 1)) {
    const tail = text.slice(i + 1).trim()
    if (!tail.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(tail)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { url: text.slice(0, i).trim(), options: normalise(parsed as Record<string, unknown>) }
      }
    } catch {
      // Not an options blob after all — this comma belongs to the URL.
    }
  }
  return { url: text, options: {} }
}

function normalise(raw: Record<string, unknown>): RequestOptions {
  const out: RequestOptions = {}
  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : undefined
  if (method === 'GET' || method === 'POST' || method === 'HEAD') out.method = method
  if (typeof raw.body === 'string') out.body = raw.body
  if (typeof raw.charset === 'string') out.charset = raw.charset
  if (typeof raw.retry === 'number' && raw.retry > 0) out.retry = Math.min(raw.retry, 5)
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.headers)) {
      if (typeof v === 'string') headers[k] = v
    }
    if (Object.keys(headers).length > 0) out.headers = headers
  }
  return out
}

/** A fetched document, parsed as far as its content type allows. */
export interface FetchedDocument {
  /** Parsed JSON, or the raw text when it is not JSON. */
  value: unknown
  text: string
  /** The URL after redirects — what a relative link in the body resolves against. */
  baseUrl: string
  status: number
  headers: Record<string, string>
}

/**
 * Fetch and parse.
 *
 * JSON is parsed; anything else is handed on as text, because the regex engine
 * works on text and the markup engines will parse it themselves when they
 * land. A body that claims to be JSON and is not comes back as text rather
 * than as an error — a backend serving an HTML error page with a JSON
 * content type is common, and the rule that then finds nothing is a better
 * diagnostic than a parse failure two layers down.
 */
export async function fetchDocument(
  http: HttpService,
  target: ParsedUrl,
  extraHeaders: Record<string, string> | undefined,
  site: FetchSite,
): Promise<FetchedDocument> {
  const request: HttpRequest = {
    url: target.url,
    method: target.options.method ?? 'GET',
    ...(target.options.body !== undefined ? { body: target.options.body } : {}),
    ...(extraHeaders || target.options.headers
      ? { headers: { ...extraHeaders, ...target.options.headers } }
      : {}),
  }

  const response = await withRetries(target.options.retry ?? 1, async () => {
    // Not wrapped: whatever `ctx.http` throws is already in the taxonomy — a
    // capability refusal, a transport failure — and re-wrapping it would
    // flatten a `CapabilityError` into something retryable.
    const res = await http(request)
    if (res.status >= 400) {
      throw statusError(res.status, target.url, site.sourceId, retryAfterOf(res.headers))
    }
    return res
  })

  const text = await decode(response, target.options.charset, site)
  site.onBody?.(text)
  const contentType = response.headers['content-type'] ?? ''
  let value: unknown = text
  if (contentType.includes('json') || looksLikeJson(text)) {
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
  }

  return {
    value,
    text,
    baseUrl: response.url || target.url,
    status: response.status,
    headers: response.headers,
  }
}

/** Where a fetch came from, so a failure names the rule and not just the URL. */
export interface FetchSite {
  sourceId: string
  /** e.g. 'searchUrl'. Used to attribute a decode failure. */
  block: string
  onBody?: (text: string) => void
}

/**
 * Decode the body, honouring `charset`.
 *
 * The reason this exists is that audio
 * sources may scrape web pages that still routinely ship
 * in GBK or Big5. `response.text()` decodes as UTF-8 unconditionally, so those
 * came back as replacement characters — a source that fetched, parsed, and
 * imported a page of mojibake without one error along the way.
 */
async function decode(
  response: { text(): Promise<string>; bytes(): Promise<Uint8Array> },
  charset: string | undefined,
  site: FetchSite,
): Promise<string> {
  if (!charset) return response.text()

  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset)
  } catch {
    /*
     * An unsupported label is the author's mistake and is reported as one.
     * Falling back to UTF-8 would be the same silent mojibake this exists to
     * prevent, with the added insult that the document *said* what to do.
     * Which labels work depends on the build's ICU, so the message says so.
     */
    throw new RuleError(
      `charset ${JSON.stringify(charset)} is not one this build can decode`,
      { block: site.block, field: 'charset' },
      site.sourceId,
    )
  }
  return decoder.decode(await response.bytes())
}

/** Cap on the backoff between attempts, and on `retryAfterMs` from a 429. */
const MAX_BACKOFF_MS = 2000

/**
 * Run `attempt` up to `attempts` times, retrying only what can succeed.
 *
 * docs/06 §3.5: `retry` is "attempts before the call is an error; default 1".
 * Retrying a 404 or a 401 is how a broken source becomes a slow broken source,
 * so only `retryable` failures come back round — and a 429 waits the interval
 * it asked for rather than a guess.
 */
async function withRetries<T>(attempts: number, attempt: () => Promise<T>): Promise<T> {
  const total = Math.max(1, Math.min(attempts, 5))
  for (let i = 1; ; i++) {
    try {
      return await attempt()
    } catch (error) {
      if (i >= total || !isRetryable(error)) throw error
      /*
       * ⚠️ A server's own `Retry-After` is honoured up to a much higher
       * ceiling than the backoff cap.
       *
       * Clamping the ask to `MAX_BACKOFF_MS` meant a backend asking for four
       * seconds was re-hit at two — so the retry was guaranteed to be refused
       * again, and the polite thing the server told us was worse than useless.
       * The exponential backoff is what `MAX_BACKOFF_MS` is for; an explicit
       * instruction is different and gets its own limit.
       */
      const asked = error instanceof RateLimitError ? error.retryAfterMs : 0
      const wait = asked
        ? Math.min(asked, MAX_RETRY_AFTER_MS)
        : Math.min(100 * 2 ** (i - 1), MAX_BACKOFF_MS)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

/**
 * A status code, as the error class the player branches on.
 *
 * The same mapping `resolveStream`'s probe uses, and for the same reason: a
 * 401 that reads as "not found" skips the re-login path, and a 500 that reads
 * as non-retryable turns a blip into a stopped queue (docs/06 §7).
 */
export function statusError(
  status: number,
  url: string,
  sourceId: string,
  retryAfterMs?: number,
): Error {
  if (status === 404 || status === 410) return new NotFoundError(`${status} for ${url}`, sourceId)
  if (status === 401 || status === 403) return new AuthError(`${status} for ${url}`, sourceId)
  if (status === 429) {
    // The server said how long; inventing a minute either hammers it early or
    // idles the queue long after it was ready.
    return new RateLimitError(`rate limited by ${hostOf(url)}`, retryAfterMs ?? 60_000, sourceId)
  }
  if (status >= 500) return new NetworkError(`${status} from ${url}`, sourceId)
  return new ProviderError(`${status} for ${url}`, sourceId)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}


/**
 * `Retry-After`, in milliseconds.
 *
 * Both spellings: a delta in seconds, or an HTTP date. A server that says
 * neither gets `undefined` and the caller's own default — but most that send a
 * 429 do say, and honouring it is the difference between backing off politely
 * and being rate-limited again immediately.
 */
function retryAfterOf(headers: Record<string, string>): number | undefined {
  const raw = headers['retry-after']
  if (!raw) return undefined

  const seconds = Number(raw.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)

  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return undefined
  return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_AFTER_MS)
}

/**
 * The longest a server may ask us to wait inside one call.
 *
 * Beyond this the request has failed as far as the user is concerned; the
 * queue should move on rather than hold a slot open for minutes.
 */
const MAX_RETRY_AFTER_MS = 60_000
