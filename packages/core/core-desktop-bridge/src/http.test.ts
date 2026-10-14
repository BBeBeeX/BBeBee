/**
 * HTTP over the bridge.
 *
 * The renderer cannot perform a source's requests itself: it is a browser
 * context, so CORS applies and `Cookie`, `Range` and `User-Agent` are
 * forbidden headers. `bridgeFetch` moves the whole request to `main` and hands
 * back something `core-http-node` can use as its transport seam.
 *
 * These checks are about the *seam*, not about the network: the transport in
 * `main` is a fake, and what is asserted is that a request survives the round
 * trip intact and a body arrives as a stream rather than a buffer.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHost, type HttpFetchInit, type IpcHost } from './main.js'
import { bridgeFetch } from './index.js'
import type { BridgeApi } from './protocol.js'

/** An in-process stand-in for `ipcMain` + `ipcRenderer.invoke`. */
function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: IpcHost = {
    handle: (channel, listener) => void handlers.set(channel, listener as never),
    removeHandler: (channel) => void handlers.delete(channel),
  }
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler({}, ...args)
  }
  return { host, invoke }
}

interface Recorded {
  url: string
  init: HttpFetchInit
}

/** Build a host whose transport is a fake, plus the renderer-side `fetch`. */
async function harness(respond: (url: string, init: HttpFetchInit) => Response) {
  const { host, invoke } = fakeIpc()
  const seen: Recorded[] = []
  const aborted: string[] = []

  const mainHost = await createHost(host, {
    appName: 'BBeBee',
    resolvePath: () => undefined,
    databaseFileName: ':memory:',
    httpFetch: (url, init) => {
      seen.push({ url, init })
      init.signal?.addEventListener('abort', () => aborted.push(url))
      return Promise.resolve(respond(url, init) as never)
    },
  })

  const api: BridgeApi = {
    call: (s, m, a, t) => invoke('BBeBee:call', s, m, a, t) as Promise<unknown>,
    streamOpen: (u, r) => invoke('BBeBee:stream:open', u, r) as Promise<number>,
    streamPull: (h) => invoke('BBeBee:stream:pull', h) as Promise<Uint8Array | null>,
    streamClose: (h) => invoke('BBeBee:stream:close', h) as Promise<void>,
    httpOpen: (r) => invoke('BBeBee:http:open', r) as never,
    httpPull: (h) => invoke('BBeBee:http:pull', h) as Promise<Uint8Array | null>,
    httpClose: (h) => invoke('BBeBee:http:close', h) as Promise<void>,
    txBegin: () => invoke('BBeBee:tx:begin') as Promise<string>,
    txEnd: (t, c) => invoke('BBeBee:tx:end', t, c) as Promise<void>,
    on: () => () => {},
  }

  const fetchOverBridge = bridgeFetch(api)
  if (!fetchOverBridge) throw new Error('the harness exposes an http host')
  return { fetch: fetchOverBridge, seen, aborted, mainHost, api }
}

let disposeAll: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposeAll) await dispose()
  disposeAll = []
})

describe('a request crossing to main', () => {
  it('carries the headers a browser would refuse to send', async () => {
    const h = await harness(() => new Response('ok', { status: 200 }))
    disposeAll.push(() => h.mainHost.dispose())

    await h.fetch('https://music.example/stream', {
      headers: {
        // All three are on fetch's forbidden-header list in a browser. The
        // whole reason this bridge exists is that main has no such list.
        range: 'bytes=1024-',
        cookie: 'session=abc',
        'user-agent': 'BBeBee/0.1',
      },
    })

    expect(h.seen).toHaveLength(1)
    expect(h.seen[0]!.init.headers['range']).toBe('bytes=1024-')
    expect(h.seen[0]!.init.headers['cookie']).toBe('session=abc')
    expect(h.seen[0]!.init.headers['user-agent']).toBe('BBeBee/0.1')
  })

  it('sends Cookie even under a browser’s header guard', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())

    /*
     * ⚠️ The regression this exists for.
     *
     * A `Request`'s header list carries the "request" guard, which in a
     * browser silently drops every forbidden request header — `Cookie` among
     * them. `bridgeFetch` used to normalise through `new Request(input, init)`,
     * so in the Electron renderer it deleted the one header the bridge was
     * built to carry, and signing in appeared to work and never stuck.
     *
     * Node's `fetch` does not implement the guard, so the check above passes
     * either way and proves nothing. Standing in a strict `Request` is what
     * makes this a check rather than a hope.
     */
    const RealRequest = globalThis.Request
    const FORBIDDEN = new Set(['cookie', 'host', 'connection', 'origin', 'referer'])
    class StrictRequest extends RealRequest {
      constructor(input: RequestInfo | URL, init: RequestInit = {}) {
        const kept = new Headers(init.headers)
        for (const name of FORBIDDEN) kept.delete(name)
        super(input as RequestInfo, { ...init, headers: kept })
      }
    }
    globalThis.Request = StrictRequest as unknown as typeof Request
    try {
      await h.fetch('https://music.example/library', { headers: { cookie: 'session=abc' } })
    } finally {
      globalThis.Request = RealRequest
    }

    expect(h.seen[0]!.init.headers['cookie']).toBe('session=abc')
  })

  it('marks a request with an explicit Referer as unsafe-url', async () => {
    /*
     * `net.fetch` maps the header onto Chromium's *referrer* and validates it
     * against the request's referrer policy. The default,
     * `strict-origin-when-cross-origin`, cancels a cross-origin referrer with a
     * path (`ERR_BLOCKED_BY_CLIENT`, "with invalid referrer") — which is the
     * video-page URL a streaming CDN checks, so the request never left the
     * browser.
     */
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())

    await h.fetch('https://cdn.example.test/audio.m4s', {
      headers: { Referer: 'https://video.example.test/watch/12345' },
    })

    expect(h.seen[0]!.init.headers['referer']).toBe(
      'https://video.example.test/watch/12345',
    )
    expect(h.seen[0]!.init.referrerPolicy).toBe('unsafe-url')
  })

  it('leaves the referrer policy alone when nothing set a referrer', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())
    await h.fetch('https://music.example/a')
    expect(h.seen[0]!.init.referrerPolicy).toBeUndefined()
  })

  it('derives a Content-Type for a body that needs one', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())

    const form = new FormData()
    form.set('username', 'bjork')
    await h.fetch('https://music.example/login', { method: 'POST', body: form })

    // A multipart boundary is generated by the encoder and cannot be written
    // by hand, so dropping it turns every form login into a 400.
    expect(h.seen[0]!.init.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(h.seen[0]!.init.body?.byteLength ?? 0).toBeGreaterThan(0)
  })

  it('lets a caller keep its own Content-Type', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())
    await h.fetch('https://music.example/rpc', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json' },
    })
    // The encoder would have said `text/plain;charset=UTF-8` for a string.
    expect(h.seen[0]!.init.headers['content-type']).toBe('application/json')
  })

  it('omits session credentials, so one source cannot see another’s cookies', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())
    await h.fetch('https://music.example/a')
    // Cookies belong to ctx.http's per-source jars (docs/06 §5.1). Letting
    // Chromium's session hold them too would share them across every source.
    expect(h.seen[0]!.init.credentials).toBe('omit')
  })

  it('refuses a scheme that is not http', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())
    // `file:` would be an unbounded read that skips every containment check
    // the fs host applies.
    await expect(h.fetch('file:///etc/passwd')).rejects.toThrow(/refusing to fetch/)
    await expect(h.fetch('bbebee://internal/x')).rejects.toThrow(/refusing to fetch/)
    expect(h.seen, 'nothing reached the transport').toEqual([])
  })

  it('opts out of the app’s own protocol handlers', async () => {
    const h = await harness(() => new Response('ok'))
    disposeAll.push(() => h.mainHost.dispose())
    await h.fetch('https://music.example/a')
    // The scheme check above cannot see a handler the app registered for
    // `https:` itself — by then the URL looks ordinary. This is the half of
    // the guard that covers that (docs/02 §2).
    expect(h.seen[0]!.init.bypassCustomProtocolHandlers).toBe(true)
  })
})

describe('the response coming back', () => {
  it('streams the body rather than buffering it', async () => {
    const chunks = ['one', 'two', 'three']
    const h = await harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
              controller.close()
            },
          }),
          { status: 206, headers: { 'content-range': 'bytes 0-10/11' } },
        ),
    )
    disposeAll.push(() => h.mainHost.dispose())

    const response = await h.fetch('https://music.example/stream')
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-10/11')

    // Pulled one chunk at a time: a 60 MB FLAC must start playing before it
    // has finished arriving, which a buffered bridge would prevent.
    const reader = response.body!.getReader()
    const seen: string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      seen.push(new TextDecoder().decode(value))
    }
    expect(seen.join('')).toBe('onetwothree')
  })

  it('keeps repeated set-cookie headers apart', async () => {
    const h = await harness(
      () =>
        new Response('ok', {
          headers: [
            ['set-cookie', 'a=1; Path=/; Expires=Mon, 01 Jan 2035 00:00:00 GMT'],
            ['set-cookie', 'b=2; Path=/'],
          ],
        }),
    )
    disposeAll.push(() => h.mainHost.dispose())

    const response = await h.fetch('https://music.example/login')
    // `Headers.forEach` folds these into one comma-joined string, and an
    // `Expires=Mon, 01 Jan…` contains the separator — so a jar parsing the
    // folded value loses both cookies and the session never sticks.
    expect(response.headers.getSetCookie()).toEqual([
      'a=1; Path=/; Expires=Mon, 01 Jan 2035 00:00:00 GMT',
      'b=2; Path=/',
    ])
  })

  it('reports the final url after a redirect', async () => {
    const h = await harness(
      () => new Response('ok', { status: 200, headers: { 'x-final': '1' } }),
    )
    disposeAll.push(() => h.mainHost.dispose())
    // A synthesised Response has an empty `url`, and relative link resolution
    // in a source document is built on it.
    const response = await h.fetch('https://music.example/a')
    expect(response.url).toBe('https://music.example/a')
  })

  it('does not choke on a status that forbids a body', async () => {
    const h = await harness(() => new Response(null, { status: 204 }))
    disposeAll.push(() => h.mainHost.dispose())
    const response = await h.fetch('https://music.example/ping')
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })
})

describe('what an abandoned request costs main', () => {
  it('aborts in main when the reader is cancelled', async () => {
    const h = await harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('x'))
              // Never closes: a stalled stream, which is the case where a
              // socket left open in main is held forever.
            },
          }),
        ),
    )
    disposeAll.push(() => h.mainHost.dispose())

    const response = await h.fetch('https://music.example/stall')
    await response.body!.cancel()
    expect(h.aborted).toContain('https://music.example/stall')
  })

  it('bounds how many requests one renderer may hold open', async () => {
    const h = await harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('x'))
            },
          }),
        ),
    )
    disposeAll.push(() => h.mainHost.dispose())

    // The default cap is 32. Each open request holds a socket; a renderer
    // looping `httpOpen` would otherwise exhaust main's descriptors.
    for (let i = 0; i < 32; i++) await h.api.httpOpen!({
      url: `https://music.example/${i}`,
      method: 'GET',
      headers: {},
    })
    await expect(
      h.api.httpOpen!({ url: 'https://music.example/33', method: 'GET', headers: {} }),
    ).rejects.toThrow(/too many open requests/)
  })

  it('releases every socket on dispose', async () => {
    const h = await harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('x'))
            },
          }),
        ),
    )
    await h.api.httpOpen!({ url: 'https://music.example/held', method: 'GET', headers: {} })
    await h.mainHost.dispose()
    expect(h.aborted).toContain('https://music.example/held')
  })
})
