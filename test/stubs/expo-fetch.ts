/**
 * A stand-in for `expo/fetch` under Vitest.
 *
 * `core-http-rn` imports its transport at module scope, which Metro resolves
 * and Node cannot. Aliasing the specifier here is what lets the shared
 * `httpConformance` suite — which until now ran against `core-http-node`
 * only — run against the mobile transport at all.
 *
 * What matters is the **shape**, not a reimplementation of expo's native
 * stack: the transfer work is Node's undici, but everything a caller can
 * observe is expo-shaped, because that shape is exactly what the mobile
 * transport's behaviour hangs on:
 *
 *  - `Headers` is React Native's — the `whatwg-fetch` polyfill that
 *    `expo/fetch` constructs its responses through (expo's own runtime
 *    asserts `globalThis.Headers` exists for precisely this reason). It has
 *    **no `getSetCookie`**, and repeated values are joined with `", "` on
 *    read. A multi-cookie fix that passed here through Node's richer
 *    `Headers` would be a fix that does not exist on a phone.
 *  - `FetchResponse` carries expo's escape hatch, `_rawHeaders`: the raw
 *    `[name, value][]` list, `set-cookie` entries kept separate. It is what
 *    `HttpRn.listSetCookies` reads, so the stub keeping it real — including
 *    `headers` being rebuilt from it on every access, as expo does — is what
 *    keeps that override honest under test.
 *
 * This file must not import `expo`: it loads in plain Node, standalone.
 */

/** `NativeHeadersType` in expo's `NativeRequest` — the wire, unparsed. */
type RawHeaders = [string, string][]

/**
 * React Native's `Headers` — whatwg-fetch's, which is what `expo/fetch` builds
 * responses with. Map-backed, names lower-cased, `append` joining into one
 * `", "`-separated value, iteration yielding `[name, value]` pairs. No
 * `getSetCookie`, because the polyfill predates it.
 */
class ExpoHeaders {
  private readonly map = new Map<string, string>()

  constructor(init?: Iterable<[string, string]> | Record<string, string>) {
    if (!init) return
    if (Symbol.iterator in init) {
      for (const [name, value] of init as Iterable<[string, string]>) this.append(name, value)
    } else {
      for (const [name, value] of Object.entries(init as Record<string, string>)) {
        this.append(name, value)
      }
    }
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this.map.get(key)
    this.map.set(key, existing !== undefined ? `${existing}, ${value}` : value)
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase())
  }

  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), value)
  }

  delete(name: string): void {
    this.map.delete(name.toLowerCase())
  }

  forEach(callback: (value: string, name: string, headers: this) => void, thisArg?: unknown): void {
    for (const [name, value] of this.map) callback.call(thisArg, value, name, this)
  }

  *entries(): MapIterator<[string, string]> {
    yield* this.map.entries()
  }

  keys(): MapIterator<string> {
    return this.map.keys()
  }

  values(): MapIterator<string> {
    return this.map.values()
  }

  [Symbol.iterator](): MapIterator<[string, string]> {
    return this.entries()
  }
}

/**
 * expo's `FetchResponse`, observed from the outside: metadata, a `Headers`
 * rebuilt from the raw pairs on every access (expo constructs a fresh one per
 * read rather than caching), the raw pairs themselves, and a real
 * `ReadableStream` body — the reason the transport is expo/fetch and not RN's
 * XHR-backed fetch at all.
 */
export class FetchResponse {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly redirected: boolean
  private readonly source: Response
  private readonly raw: RawHeaders

  constructor(source: Response, raw: RawHeaders) {
    this.source = source
    this.raw = raw
    this.status = source.status
    this.statusText = source.statusText
    this.url = source.url
    this.redirected = source.redirected
  }

  get headers(): ExpoHeaders {
    return new ExpoHeaders(this.raw)
  }

  /** The expo-shaped escape hatch `HttpRn.listSetCookies` reads. */
  get _rawHeaders(): RawHeaders {
    return this.raw
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }

  get type(): 'default' {
    return 'default'
  }

  get body(): ReadableStream<Uint8Array> | null {
    return this.source.body
  }

  get bodyUsed(): boolean {
    return this.source.bodyUsed
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.source.arrayBuffer()
  }

  text(): Promise<string> {
    return this.source.text()
  }

  json(): Promise<unknown> {
    return this.source.json()
  }

  clone(): FetchResponse {
    return new FetchResponse(this.source.clone(), this.raw.slice())
  }
}

/**
 * The transport. Delegates the transfer to undici, then re-covers the response
 * in the expo shape — including the raw pairs, which undici's own `forEach`
 * reports one entry per `set-cookie` value (that separation is exactly the
 * thing the mobile runtime loses when expo wraps the pairs into a
 * whatwg-fetch `Headers`, and exactly what `_rawHeaders` preserves).
 */
export async function fetch(input: string | URL, init?: RequestInit): Promise<FetchResponse> {
  const source = await globalThis.fetch(input, init)
  const raw: RawHeaders = []
  source.headers.forEach((value, key) => raw.push([key, value]))
  return new FetchResponse(source, raw)
}
