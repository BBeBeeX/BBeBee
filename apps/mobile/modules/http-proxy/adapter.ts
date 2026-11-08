/**
 * The pure half of the native http-proxy binding: the adapter that shapes the
 * `BbebeeHttpProxy` Expo module into the `fetch`-shaped transport
 * `HttpRn` uses for requests the settings marked `useProxy`.
 *
 * Split from `index.ts` for the same reason the audio engine's is: this file
 * has no `expo` import, so unit tests can exercise the mapping without a
 * native runtime. `index.ts` is the only file that touches
 * `requireNativeModule`, loaded for its side effect from `boot.ts`.
 *
 * ## Why a native module at all
 *
 * `expo/fetch` has no dispatcher and no proxy hook, and React Native's
 * XHR-backed fetch inherits neither. The proxy *config* travels with every
 * call (the native side is stateless) — only the boolean decision of whether
 * to use it lives in `HttpRn`.
 *
 * ## Redirects
 *
 * `HttpNode.followRedirects` always requests `redirect: 'manual'` and loops
 * in JS — per-hop host allowlist re-checks and cookie-jar injection depend on
 * it. The native side therefore must NOT follow redirects: Android sets
 * `followRedirects(false)`, iOS cancels in the session delegate. A final URL
 * different from the request URL is not expected here.
 *
 * ## Bodies
 *
 * Base64 in both directions, like the desktop bridge: a proxied request is a
 * source document fetch (JSON, HTML, lyrics) — small, and stream fidelity is
 * not a requirement of this transport. `FormData` is encoded through
 * `new Response(...)` first, which is what derives its boundary
 * `Content-Type`, the same trick `bridgeFetch` uses on desktop.
 */

import type { HttpProxyConfig } from '@BBeBee/protocol'

/** One call across the bridge, as the native side receives it. */
export interface ProxyFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Base64 of the body bytes; absent for GET/HEAD. */
  bodyBase64?: string
  timeoutMs?: number
  proxy: HttpProxyConfig
}

/** One answer, as the native side resolves it. */
export interface ProxyFetchResponse {
  status: number
  statusText: string
  /** The final URL — equals the request URL, since redirects are not followed. */
  url: string
  /**
   * Raw header pairs, in response order. Kept raw so `set-cookie` entries
   * stay separate, which `HttpRn.listSetCookies` reads through the same
   * `_rawHeaders` hole it already uses for expo's response shape. (iOS's
   * `allHeaderFields` merges repeated names — the one place cookie fidelity
   * degrades, documented in docs/services/contracts.md.)
   */
  headers: [string, string][]
  bodyBase64: string
}

/** The Kotlin/Expo surface — one method, stateless. */
export interface NativeHttpProxy {
  proxyFetch(options: ProxyFetchRequest): Promise<ProxyFetchResponse>
}

/** The `fetch`-shaped seam `HttpRn` consumes (`HttpProxyTransport`). */
export type ProxyTransport = (url: string, init: RequestInit) => Promise<Response>

export class ProxyTransportError extends Error {}

function base64ToBytes(base64: string): Uint8Array {
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob
  if (typeof atobFn === 'function') {
    const binary = atobFn(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  // Hermes ships `atob`; this branch only matters under a JS engine without
  // it (unit tests on some Node builds are fine — Node has it). Manual decode
  // rather than a dependency: base64 is one algorithm, and this module
  // carrying zero dependencies is part of its point.
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const size = clean.length * 0.75
  const bytes = new Uint8Array(Math.max(0, Math.floor(size) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0)))
  let out = 0
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    if (char === '=') break
    const value = table.indexOf(char)
    if (value === -1) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      if (out < bytes.length) bytes[out++] = (buffer >> bits) & 0xff
    }
  }
  return bytes.subarray(0, out)
}

function bytesToBase64(bytes: Uint8Array): string {
  const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa
  if (typeof btoaFn === 'function') {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoaFn(binary)
  }
  throw new ProxyTransportError('btoa is unavailable in this runtime')
}

/** Extract the exact body bytes and default `Content-Type` a `fetch` would send. */
async function encodeBody(
  body: BodyInit | null | undefined,
): Promise<{ bytes?: Uint8Array; contentType?: string }> {
  if (body === undefined || body === null) return {}
  if (typeof body === 'string') {
    return { bytes: new TextEncoder().encode(body) }
  }
  if (body instanceof Uint8Array) {
    return { bytes: body }
  }
  if (body instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(body) }
  }
  // FormData (and any other exotic BodyInit) through a Response: this derives
  // the multipart boundary Content-Type the server expects, exactly like
  // `bridgeFetch` does on desktop.
  const encoded = new Response(body as BodyInit)
  const contentType = encoded.headers.get('content-type') ?? undefined
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType }
}

/** The message an aborted fetch carries — `HttpNode` re-wraps it as a NetworkError. */
function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Build the transport from the native surface.
 * One call = one stateless native round trip; the proxy config travels with
 * the request, so a settings change needs no native-side invalidation.
 * `init.signal` is honoured on the JS side (the native call is not
 * cancellable mid-flight, so an aborted request's native twin drains to its
 * own timeout and is dropped) — `HttpNode.send` aborts through the same
 * signal for headers-timeout and caller cancellation, so the caller-visible
 * behaviour is a rejection either way.
 */
export function buildProxyTransport(native: NativeHttpProxy): ProxyTransport {
  return async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    const absorb = (list: Headers) => {
      list.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
    }
    if (init.headers) absorb(new Headers(init.headers))

    const encoded = method !== 'GET' && method !== 'HEAD' ? await encodeBody(init.body) : {}
    if (encoded.contentType && !headers['content-type']) {
      headers['content-type'] = encoded.contentType
    }

    const proxy = (init as RequestInit & { proxy?: HttpProxyConfig }).proxy
    if (!proxy || !proxy.host || !proxy.port) {
      throw new ProxyTransportError('proxy transport called without a proxy config')
    }

    // `HttpNode.send` signals timeouts through the AbortController, which the
    // native call cannot observe mid-flight; the native side gets its own
    // ceiling so a dead proxy cannot hold a socket forever.
    const timeoutMs =
      typeof (init as RequestInit & { timeoutMs?: number }).timeoutMs === 'number'
        ? (init as RequestInit & { timeoutMs?: number }).timeoutMs
        : 30_000

    // Before the call, not only around it: an already-aborted request must
    // never reach the native side, and a race cannot be relied on for that —
    // it settles in registration order, so an already-resolved native promise
    // would beat a synchronously-rejected guard.
    const signal = init.signal
    if (signal?.aborted) throw abortError()

    const call = native.proxyFetch({
      url,
      method,
      headers,
      ...(encoded.bytes && encoded.bytes.byteLength > 0
        ? { bodyBase64: bytesToBase64(encoded.bytes) }
        : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      proxy,
    })

    const result =
      signal && typeof signal.addEventListener === 'function'
        ? await Promise.race([
            call,
            new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(abortError()), { once: true })
            }),
          ])
        : await call

    const bytes = base64ToBytes(result.bodyBase64 ?? '')
    const response = new Response(
      // RN's lib types are strict about BodyInit; the bytes are exactly what
      // it wants but not by its variance rules.
      bytes.byteLength > 0 ? (bytes as unknown as BodyInit) : null,
      {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers.map(
          ([name, value]) => [name, value] as [string, string],
        ),
      },
    )
    // The constructed `Response` reports url '' (it has no Request); the
    // native final URL shadows it for `HttpResponse.url`, which
    // `fetchDocument` reads as a page's `baseUrl`.
    Object.defineProperty(response, 'url', { value: result.url || url, configurable: true })
    // The raw pair list, where `listSetCookies` looks for it — same hole
    // expo's own responses use, so no new reading path is introduced.
    Object.defineProperty(response, '_rawHeaders', { value: result.headers, configurable: true })
    return response
  }
}

/**
 * The native stream-relay surface: one registration call; the listener,
 * token table and loopback HTTP handling live natively (ServerSocket +
 * OkHttp on Android, NWListener + URLSession on iOS).
 */
export interface NativeStreamRelay {
  relayRegister(options: {
    url: string
    headers: Record<string, string>
    proxy: HttpProxyConfig
  }): Promise<{ url: string }>
}

/** What `core-audio-mpv`'s `streamProxyResolver` consumes. */
export interface StreamRelay {
  /**
   * Register a real upstream (+ the source's headers, + the proxy to route
   * it through) and get back the loopback URL the engine plays.
   */
  register(req: { url: string; headers?: Record<string, string>; proxy: HttpProxyConfig }): Promise<string>
}

/**
 * Build the relay seam from the native surface.
 *
 * The proxy config travels with every registration — the native side holds
 * no settings state, so a settings flip lands on the next registered stream
 * with nothing to invalidate. A registration that answers no URL throws;
 * `resolveProxied` in `core-audio-mpv` turns that into an honest direct play.
 */
export function createStreamRelay(native: NativeStreamRelay): StreamRelay {
  return {
    async register({ url, headers, proxy }) {
      if (!/^https?:\/\//i.test(url)) {
        throw new ProxyTransportError(`relay: refusing to register ${url.split(':')[0] ?? 'invalid'}// — only http/https is served`)
      }
      const result = await native.relayRegister({
        url,
        headers: headers ?? {},
        proxy,
      })
      const local = result?.url
      if (typeof local !== 'string' || !local.startsWith('http://127.0.0.1:')) {
        throw new ProxyTransportError('relay: native side returned no loopback URL')
      }
      return local
    },
  }
}
