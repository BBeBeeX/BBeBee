/**
 * `src` — the entire host surface a source document can see.
 *
 * docs/06 §8 lists it, and the list is the contract: there is no `fetch`, no
 * `require`, no timer that outlives the call, and no filesystem. Everything a
 * document can reach is a function installed here, which is what makes the
 * question "what can a pasted string do?" answerable by reading one file.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *  - **`get`/`post` go through the source's own scoped HTTP**, so the egress
 *    allowlist applies to a URL a script computed exactly as it does to one a
 *    template rendered. A `src.get` that bypassed it would make the allowlist
 *    decorative — the sandbox would bound reach everywhere except the one
 *    place a script would actually use.
 *  - **`vars` is credential-grade.** It is where a document keeps a session
 *    token, so it is per-source, never exported, and cleared by sign-out.
 */

import {
  base64Decode,
  base64Encode,
  hmacHex,
  md5Hex,
  randomHex,
  rsaEncrypt,
  rsaOaepEncrypt,
  sha1Hex,
  sha256Hex,
} from '@BBeBee/protocol'
import type { HttpService } from '@BBeBee/protocol'
import { fetchDocument, parseUrlObject, type RequestOptions } from './fetch.js'

/** What a script gets back from `src.get` / `src.post`. */
export interface HostResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface HostDeps {
  http: HttpService
  sourceId: string
  /** Refuses a URL outside the source's allowlist. Throws; never returns false. */
  assertAllowed(url: string): void
  /** Persistent, credential-grade, per source. */
  vars: {
    get(key: string): string | undefined
    put(key: string, value: string): void
  }
  cookies?: {
    get(name: string, url?: string): Promise<string | undefined>
    set(name: string, value: string, url?: string): Promise<void>
    all(url?: string): Promise<Record<string, string>>
  }
  log?(message: string): void
}

/**
 * The per-source scratch space.
 *
 * In memory and TTL-bounded by contract (docs/06 §3.4), so a document can
 * cache a token for its lifetime without the app having to decide when that
 * token stops being true.
 */
class SourceCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>()

  get(key: string): unknown {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== 0 && Date.now() > entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  put(key: string, value: unknown, ttlMs?: number): void {
    // A cache with no ceiling is a leak with a friendly name; a document that
    // caches per track would otherwise grow without bound for the session.
    if (this.entries.size >= 256 && !this.entries.has(key)) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    this.entries.set(key, {
      value,
      expiresAt: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : 0,
    })
  }

  clear(): void {
    this.entries.clear()
  }
}

/**
 * Build the `src` surface for one source.
 *
 * Returned as plain functions rather than an object graph: each is installed
 * into the realm individually, so what crosses the boundary is a call and a
 * cloned value — never a host object a script could hold on to.
 */
/**
 * Cap on `src.get` / `src.post` calls inside one `@js:` evaluation
 * (docs/06 §8). Host-side pipeline fetches (searchUrl, album, track list,
 * lyrics) do not go through here and are not counted: this budget exists
 * for the one place stranger code can itself drive HTTP — a rule that
 * loops `src.get` to turn one search into a crawl.
 *
 * Counted only after the allowlist passes, so a probe at an undeclared
 * host still fails with the allowlist error rather than the budget error.
 */
export const MAX_SRC_HTTP_CALLS_PER_EVALUATION = 8

export function createSourceHost(deps: HostDeps) {
  const cache = new SourceCache()
  let httpCallCount = 0

  const request = async (
    method: 'GET' | 'POST',
    url: string,
    body: string | undefined,
    opts: RequestOptions | undefined,
  ): Promise<HostResponse> => {
    const target = parseUrlObject(url)
    // The allowlist applies to a URL a script computed exactly as it does to
    // one a template rendered. This is the check that keeps the sandbox from
    // being a containment story with a hole in the middle.
    deps.assertAllowed(target.url)
    if (++httpCallCount > MAX_SRC_HTTP_CALLS_PER_EVALUATION) {
      throw new Error(
        `src HTTP budget exceeded: at most ${MAX_SRC_HTTP_CALLS_PER_EVALUATION} src.get/src.post calls per @js: evaluation`,
      )
    }

    const fetched = await fetchDocument(
      deps.http,
      {
        url: target.url,
        options: {
          ...target.options,
          ...opts,
          method,
          ...(body !== undefined ? { body } : {}),
        },
      },
      undefined,
      { sourceId: deps.sourceId, block: '@js:' },
    )
    return { status: fetched.status, headers: fetched.headers, body: fetched.text }
  }

  return {
    cache,
    /**
     * Reset the per-evaluation HTTP budget. Called by the runtime before
     * each `realm.eval`, so each rule evaluation gets its own 8 calls.
     * Concurrent evaluations on one realm share the counter — the budget
     * is a crawl brake, not a precise accounting under concurrency.
     */
    resetHttpCallCount: () => {
      httpCallCount = 0
    },
    /** Installed one by one into the realm. Names match docs/06 §8 exactly. */
    functions: {
      __src_get: (url: unknown, opts: unknown) =>
        request('GET', String(url), undefined, opts as RequestOptions | undefined),
      __src_post: (url: unknown, body: unknown, opts: unknown) =>
        request('POST', String(url), String(body ?? ''), opts as RequestOptions | undefined),

      __src_md5: (value: unknown) => md5Hex(String(value)),
      __src_sha1: (value: unknown) => sha1Hex(String(value)),
      __src_sha256: (value: unknown) => sha256Hex(String(value)),
      __src_hmac: (algorithm: unknown, key: unknown, message: unknown) =>
        hmacHex(hashName(algorithm), String(key), String(message)),
      __src_b64encode: (value: unknown) => base64Encode(String(value)),
      __src_b64decode: (value: unknown) => base64Decode(String(value)),
      __src_randomHex: (length: unknown) => randomHex(Number(length) || 16),
      __src_rsaEncrypt: (val: unknown, key: unknown) => rsaEncrypt(String(val), String(key)),
      __src_rsaOaepEncrypt: (val: unknown, key: unknown, label: unknown) =>
        rsaOaepEncrypt(String(val), String(key), label ? String(label) : ''),

      __src_cacheGet: (key: unknown) => cache.get(String(key)),
      __src_cachePut: (key: unknown, value: unknown, ttlMs: unknown) => {
        cache.put(String(key), value, typeof ttlMs === 'number' ? ttlMs : undefined)
      },

      __src_varsGet: (key: unknown) => deps.vars.get(String(key)),
      __src_varsPut: (key: unknown, value: unknown) => {
        deps.vars.put(String(key), String(value))
      },

      __src_cookieGet: (name: unknown, url: unknown) =>
        deps.cookies?.get(String(name), url ? String(url) : undefined),
      __src_cookieSet: (name: unknown, value: unknown, url: unknown) =>
        deps.cookies?.set(String(name), String(value), url ? String(url) : undefined),
      __src_cookieAll: (url: unknown) =>
        deps.cookies?.all(url ? String(url) : undefined),

      __src_urlEncode: (value: unknown) => encodeURIComponent(String(value)),
      __src_urlDecode: (value: unknown) => {
        try {
          return decodeURIComponent(String(value))
        } catch {
          // A malformed escape is the backend's, not the document's. Returning
          // the text unchanged beats failing the whole rule over it.
          return String(value)
        }
      },
      __src_urlResolve: (base: unknown, relative: unknown) => {
        try {
          return new URL(String(relative), String(base)).toString()
        } catch {
          return String(relative)
        }
      },

      __src_now: () => Date.now(),
      __src_log: (message: unknown) => {
        deps.log?.(`${deps.sourceId}: ${String(message)}`)
      },
    } satisfies Record<string, (...args: never[]) => unknown>,
  }
}

function hashName(value: unknown): 'md5' | 'sha1' | 'sha256' {
  const name = String(value).toLowerCase()
  return name === 'md5' || name === 'sha1' ? name : 'sha256'
}

/**
 * The realm-side shim that assembles `src` out of the installed functions.
 *
 * Preloaded before any `jsLib`, so a document's own helpers can use it. Written
 * as a script rather than built by installing an object because everything
 * crossing the boundary crosses as *data* — an object of host functions would
 * have to be rebuilt inside the realm regardless, and doing it here keeps the
 * shape in one readable place.
 *
 * `parse.html` / `parse.xml` and the AES pair are deliberately absent and say
 * so when called: a markup parser is not in this build, and a hand-rolled AES
 * would be worse than none. A document using either gets a message naming what
 * is missing rather than `undefined is not a function`.
 */
export const SRC_SHIM = `
globalThis.src = Object.freeze({
  get: (url, opts) => __src_get(url, opts),
  post: (url, body, opts) => __src_post(url, body, opts),
  parse: Object.freeze({
    json: (s) => JSON.parse(s),
    html: () => { throw new Error('src.parse.html needs a markup parser, which this build does not have') },
    xml: () => { throw new Error('src.parse.xml needs a markup parser, which this build does not have') },
  }),
  crypto: Object.freeze({
    md5: (s) => __src_md5(s),
    sha1: (s) => __src_sha1(s),
    sha256: (s) => __src_sha256(s),
    hmac: (alg, key, msg) => __src_hmac(alg, key, msg),
    base64Encode: (s) => __src_b64encode(s),
    base64Decode: (s) => __src_b64decode(s),
    randomHex: (n) => __src_randomHex(n),
    rsaEncrypt: (val, key) => __src_rsaEncrypt(val, key),
    rsaOaepEncrypt: (val, key, label) => __src_rsaOaepEncrypt(val, key, label),
    aesEncrypt: () => { throw new Error('src.crypto.aesEncrypt is not available in this build') },
    aesDecrypt: () => { throw new Error('src.crypto.aesDecrypt is not available in this build') },
  }),
  cache: Object.freeze({ get: (k) => __src_cacheGet(k), put: (k, v, ttl) => __src_cachePut(k, v, ttl) }),
  vars: Object.freeze({ get: (k) => __src_varsGet(k), put: (k, v) => __src_varsPut(k, v) }),
  cookie: Object.freeze({
    get: (name, url) => __src_cookieGet(name, url),
    set: (name, value, url) => __src_cookieSet(name, value, url),
    all: (url) => __src_cookieAll(url),
  }),
  url: Object.freeze({
    encode: (s) => __src_urlEncode(s),
    decode: (s) => __src_urlDecode(s),
    resolve: (b, r) => __src_urlResolve(b, r),
  }),
  time: Object.freeze({ now: () => __src_now() }),
  log: (m) => __src_log(m),
})
`
