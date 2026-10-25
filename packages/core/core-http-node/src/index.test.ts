/**
 * The HTTP slice, against a real byte-serving server.
 *
 * A mocked `fetch` would prove the wrapper calls it; what needs proving is
 * `Range`, progress, timeouts and resumption over a socket that behaves like a
 * server — including the ones that stall.
 */

import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { CapabilityError } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { SecretsNode } from '@bbebee/core-secrets-node'
import type { Cookie } from '@BBeBee/protocol'
import plugin, {
  jarStore,
  splitJoinedSetCookie,
  type HttpNode,
  type HttpNodeConfig,
} from './index.js'

const PAYLOAD = Buffer.from(
  Array.from({ length: 5000 }, (_, i) => i % 251),
)

/** Two cookies on one line, the way a runtime without `getSetCookie()` sees them. */
const JOINED_SET_COOKIE =
  'session=abc123; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly, csrf=tok; Path=/; Max-Age=3600'

/**
 * A `Response` as an older runtime reports it: one joined `set-cookie` value
 * behind a `Headers` with no `getSetCookie()`. Iterable like every WHATWG
 * `Headers` is — that is not what the fallback lacks — but with no accessor
 * and no raw pairs. (Node's own `Headers` always has the accessor, so the fake
 * swaps the headers for that shape — otherwise the fallback is unreachable
 * here.)
 */
function withoutGetSetCookie(response: Response): Response {
  const map = new Map<string, string>()
  response.headers.forEach((value, name) => void map.set(name, value))
  const headers = {
    get: (name: string) => map.get(name.toLowerCase()) ?? null,
    forEach: (cb: (value: string, name: string) => void) => {
      for (const [name, value] of map) cb(value, name)
    },
    *entries(): MapIterator<[string, string]> {
      yield* map.entries()
    },
    [Symbol.iterator]: (): MapIterator<[string, string]> => map.entries(),
  } as unknown as Headers
  Object.defineProperty(response, 'headers', { value: headers })
  return response
}

const olderRuntimeFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init)
  return String(input).endsWith('/joined-cookie') ? withoutGetSetCookie(response) : response
}

let server: Server
let origin: string
/** A second server, standing in for an internal host a source may not reach. */
let secretServer: Server
let secretOrigin: string
/** Requests seen, so tests can assert what actually went out. */
const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/stall') {
      // Never responds: the timeout is the point.
      return
    }

    if (url.pathname === '/set-cookie') {
      res.writeHead(200, {
        'set-cookie': [
          'session=abc123; Path=/; Max-Age=3600; HttpOnly',
          'csrf=tok; Path=/; Max-Age=3600',
        ],
      })
      res.end('ok')
      return
    }
    if (url.pathname === '/joined-cookie') {
      // One header, two cookies, comma-joined — the wire shape a runtime with
      // no `getSetCookie()` has to make sense of.
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': JOINED_SET_COOKIE,
      })
      res.end('ok')
      return
    }
    if (url.pathname === '/set-foreign-cookie') {
      res.writeHead(200, { 'set-cookie': 'evil=1; Domain=evil.example; Max-Age=3600' })
      res.end('ok')
      return
    }
    if (url.pathname === '/login-redirect') {
      res.writeHead(302, {
        location: '/echo-cookie',
        'set-cookie': 'session=viaredirect; Path=/; Max-Age=3600',
      })
      res.end()
      return
    }
    if (url.pathname === '/echo-cookie') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(req.headers.cookie ?? '')
      return
    }
    if (url.pathname === '/echo-headers') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.headers))
      return
    }
    if (url.pathname === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ hello: 'world', echoed: req.headers['x-echo'] ?? null }))
      return
    }
    if (url.pathname === '/status') {
      res.writeHead(Number(url.searchParams.get('code') ?? 500))
      res.end('nope')
      return
    }
    if (url.pathname === '/redirect') {
      // The attack shape: a server the document author controls answers a
      // 302 pointing anywhere it likes.
      res.writeHead(302, { location: url.searchParams.get('to') ?? '/json' })
      res.end()
      return
    }
    if (url.pathname === '/loop') {
      res.writeHead(302, { location: '/loop' })
      res.end()
      return
    }

    // /bytes — a range-aware file server.
    const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''))
    if (range) {
      const start = Number(range[1])
      const end = range[2] ? Number(range[2]) : PAYLOAD.length - 1
      const slice = PAYLOAD.subarray(start, end + 1)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${end}/${PAYLOAD.length}`,
        'accept-ranges': 'bytes',
        etag: '"v1"',
      })
      res.end(slice)
      return
    }
    res.writeHead(200, {
      'content-length': String(PAYLOAD.length),
      'accept-ranges': 'bytes',
      etag: '"v1"',
    })
    res.end(PAYLOAD)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''

  secretServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/echo-headers') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.headers))
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('INTERNAL-SECRET')
  })
  await new Promise<void>((resolve) => secretServer.listen(0, '127.0.0.1', resolve))
  const secretAddress = secretServer.address()
  // Addressed as `localhost`, not `127.0.0.1`: host matching ignores ports, so
  // two ports on one address would make the redirect test pass without the
  // second hop ever being checked.
  secretOrigin =
    typeof secretAddress === 'object' && secretAddress
      ? `http://localhost:${secretAddress.port}`
      : ''
})

afterAll(() => {
  server.close()
  secretServer.close()
})

async function harness() {
  const root = await tempDir('bbebee-http')
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  await ctx.plugin(plugin, { defaultTimeoutMs: 2000 })
  await tick()
  return { ctx, http: ctx.http as unknown as HttpNode, root }
}

describe('requests', () => {
  it('is callable, and sets arbitrary headers', async () => {
    // Not subject to browser rules: `user-agent` and friends are settable,
    // which is the reason this service exists at all (docs/02 §2).
    const { ctx } = await harness()
    const response = await ctx.http({ url: `${origin}/json`, headers: { 'x-echo': 'yes' } })

    expect(response.status).toBe(200)
    expect(await response.json<{ hello: string; echoed: string }>()).toEqual({
      hello: 'world',
      echoed: 'yes',
    })
    expect(seen.at(-1)!.headers['user-agent']).toContain('BBeBee')
  })

  it('gets and posts JSON', async () => {
    const { ctx } = await harness()
    expect(await ctx.http.get<{ hello: string }>(`${origin}/json`)).toMatchObject({
      hello: 'world',
    })
    expect(await ctx.http.post<{ hello: string }>(`${origin}/json`, { a: 1 })).toMatchObject({
      hello: 'world',
    })
  })

  it('reads bytes and streams them with progress', async () => {
    const { ctx } = await harness()
    const bytes = await (await ctx.http({ url: `${origin}/bytes` })).bytes()
    expect(bytes.length).toBe(PAYLOAD.length)

    const progress: number[] = []
    const response = await ctx.http({
      url: `${origin}/bytes`,
      onProgress: (loaded) => void progress.push(loaded),
    })
    const reader = response.stream().getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(progress.at(-1)).toBe(PAYLOAD.length)
  })

  it('asks for a byte range, which is what seeking a stream needs', async () => {
    const { ctx } = await harness()
    const response = await ctx.http({
      url: `${origin}/bytes`,
      headers: { range: 'bytes=1000-1099' },
    })
    expect(response.status).toBe(206)
    expect((await response.bytes()).length).toBe(100)
    expect(response.headers['content-range']).toContain('/5000')
  })

  it('times out rather than hanging forever', async () => {
    const { ctx } = await harness()
    await expect(ctx.http({ url: `${origin}/stall`, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('honours an external abort signal', async () => {
    const { ctx } = await harness()
    const abort = new AbortController()
    const inflight = ctx.http({ url: `${origin}/stall`, signal: abort.signal })
    abort.abort()
    await expect(inflight).rejects.toMatchObject({ code: 'network' })
  })

  it('maps a transport failure onto the taxonomy', async () => {
    // `NetworkError` is the one class the player retries with backoff.
    const { ctx } = await harness()
    await expect(ctx.http({ url: 'http://127.0.0.1:1/nothing' })).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('reports an error status without throwing', async () => {
    // A 404 is an answer, not a transport failure; the caller decides.
    const { ctx } = await harness()
    const response = await ctx.http({ url: `${origin}/status?code=404` })
    expect(response.status).toBe(404)
  })
})

describe('the request journal', () => {
  it('records the exchange: headers both ways, status, and the body', async () => {
    const { ctx, http } = await harness()
    await ctx.http({ url: `${origin}/json`, headers: { 'x-echo': 'yes' } })
    await tick()

    const entry = http.requestLog.all().at(-1)!
    expect(entry.method).toBe('GET')
    expect(entry.url).toBe(`${origin}/json`)
    expect(entry.status).toBe(200)
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    expect(entry.requestHeaders['x-echo']).toBe('yes')
    // The body came through the tee, not by consuming the caller's copy.
    expect(JSON.parse(entry.responseBody!)).toEqual({ hello: 'world', echoed: 'yes' })
  })

  it('redacts credentials but keeps cookie names', async () => {
    const { ctx, http } = await harness()
    await ctx.http({
      url: `${origin}/json`,
      headers: {
        cookie: 'buvid3=secret-buvid; SESSDATA=top-secret',
        authorization: 'Bearer token-value',
      },
    })
    await tick()

    const entry = http.requestLog.all().at(-1)!
    expect(entry.requestHeaders.cookie).toBe('buvid3=<redacted>; SESSDATA=<redacted>')
    expect(entry.requestHeaders.cookie).not.toContain('secret-buvid')
    expect(entry.requestHeaders.authorization).toBe('<redacted>')

    await ctx.http({ url: `${origin}/set-cookie` })
    await tick()
    const setCookieEntry = http.requestLog.all().at(-1)!
    expect(setCookieEntry.responseHeaders['set-cookie']).toBe('<redacted>')
    expect(setCookieEntry.responseHeaders['set-cookie']).not.toContain('abc123')
  })

  it('records a request that never got a response, with the reason', async () => {
    const { ctx, http } = await harness()
    // Port 1 on loopback refuses connections — a transport failure, not an
    // HTTP status, and exactly the case the journal must not drop.
    await expect(ctx.http({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow()
    await tick()

    const entry = http.requestLog.all().at(-1)!
    expect(entry.status).toBeUndefined()
    expect(entry.error).toBeTruthy()
  })

  it('records summary-only entries while capture is off, and resumes whole on', async () => {
    const { ctx, http } = await harness()
    http.requestLog.setCapture(false)
    await ctx.http({ url: `${origin}/json`, headers: { 'x-echo': 'yes' } })
    await tick()

    // Summary row: the line a list needs, nothing a detail pane could show.
    const offEntry = http.requestLog.all().at(-1)!
    expect(offEntry.status).toBe(200)
    expect(offEntry.detailed).toBe(false)
    expect(Object.keys(offEntry.requestHeaders)).toHaveLength(0)
    expect(offEntry.responseBody).toBeUndefined()

    // Switched back on, the next request is recorded whole — and the entry
    // made while capture was off stays a summary forever.
    http.requestLog.setCapture(true)
    await ctx.http({ url: `${origin}/json`, headers: { 'x-echo': 'yes' } })
    await tick()
    const onEntry = http.requestLog.all().at(-1)!
    expect(onEntry.detailed).toBe(true)
    expect(onEntry.requestHeaders['x-echo']).toBe('yes')
    expect(JSON.parse(onEntry.responseBody!)).toEqual({ hello: 'world', echoed: 'yes' })
    expect(offEntry.detailed).toBe(false)
  })

  it('skips bodies for transfers (a ranged request) and honours clear()', async () => {
    const { ctx, http } = await harness()
    await ctx.http({ url: `${origin}/bytes`, headers: { range: 'bytes=0-9' } })
    await tick()

    const entry = http.requestLog.all().at(-1)!
    expect(entry.status).toBe(206)
    expect(entry.responseBody).toBeUndefined()

    expect(http.requestLog.all().length).toBeGreaterThan(0)
    http.requestLog.clear()
    expect(http.requestLog.all()).toHaveLength(0)
  })
})

describe('the net:host gate', () => {
  it('refuses a host the plugin was not granted', async () => {
    // `net:host/<glob>` was a manifest string with no enforcement — the same
    // shape `db:own` once had. A plugin holding ctx.http could reach anything,
    // including intranet and cloud-metadata addresses (docs/03 §7).
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-demo',
      requested: ['net:host/*.example.org'] as never,
    })

    await expect(scoped.http({ url: `${origin}/json` })).rejects.toThrow(CapabilityError)
    await expect(scoped.http.get(`${origin}/json`)).rejects.toThrow(/may not reach/)
    await expect(
      scoped.http.download({ url: `${origin}/bytes`, to: 'file:///tmp/x' }),
    ).rejects.toThrow(CapabilityError)
  })

  it('allows a granted host', async () => {
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-demo',
      requested: ['net:host/127.0.0.1'] as never,
    })
    await expect(scoped.http({ url: `${origin}/json` })).resolves.toMatchObject({ status: 200 })
  })

  it('cannot be laundered by a waterfall listener rewriting the url', async () => {
    // The gate runs before the waterfall *and* after it, so a listener cannot
    // be used as a redirect to somewhere the caller was never granted.
    const { ctx } = await harness()
    ctx.on('http/request', ((req: { url: string }, next: () => unknown) => {
      req.url = 'http://169.254.169.254/latest/meta-data/'
      return next()
    }) as never)

    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-demo',
      requested: ['net:host/127.0.0.1'] as never,
    })
    await expect(scoped.http({ url: `${origin}/json` })).rejects.toThrow(/may not reach/)
  })

  it('re-checks the host on every redirect hop', async () => {
    // The bypass this pins: `fetch` follows a 3xx internally, so the gate saw
    // only the URL we asked for. A source server — which the document author
    // controls — answered one 302 pointing at an internal address, and the
    // per-source allowlist, the only egress control in the import trust model,
    // never saw it (docs/06 §8).
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-source-runtime',
      scopeId: 'a-source',
      requested: ['net:host/*'] as never,
      // The source's *own* host is allowed, so hop 1 passes and the test is
      // about hop 2 rather than about the first URL.
      allowedHosts: ['127.0.0.1'],
    })

    await expect(
      scoped.http({ url: `${origin}/json` }),
      'the source may reach its own host',
    ).resolves.toMatchObject({ status: 200 })

    await expect(
      scoped.http({ url: `${origin}/redirect?to=${encodeURIComponent(secretOrigin)}` }),
    ).rejects.toThrow(CapabilityError)
  })

  it('does not leak the redirect target body when the hop is refused', async () => {
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-source-runtime',
      scopeId: 'a-source',
      requested: ['net:host/*'] as never,
      allowedHosts: ['127.0.0.1'],
    })
    let body = ''
    try {
      const res = await scoped.http({
        url: `${origin}/redirect?to=${encodeURIComponent(secretOrigin)}`,
      })
      body = await res.text()
    } catch {
      // expected
    }
    expect(body).not.toContain('INTERNAL-SECRET')
  })

  it('still follows a redirect the caller is allowed to reach', async () => {
    // The fix must not break ordinary redirects — CDNs and login flows use
    // them constantly.
    const { ctx } = await harness()
    const response = await ctx.http({
      url: `${origin}/redirect?to=${encodeURIComponent('/json')}`,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ hello: 'world' })
  })

  it('gives up on a redirect loop instead of hanging', async () => {
    const { ctx } = await harness()
    await expect(ctx.http({ url: `${origin}/loop` })).rejects.toThrow(/too many redirects/)
  })

  it('redirect: error rejects any redirect status, Location or not', async () => {
    const { ctx } = await harness()
    await expect(
      ctx.http({ url: `${origin}/redirect?to=${encodeURIComponent('/json')}`, redirect: 'error' }),
    ).rejects.toThrow(/redirect/)
    // A 302 with no Location is still a redirect a caller asked to hear about.
    await expect(
      ctx.http({ url: `${origin}/status?code=302`, redirect: 'error' }),
    ).rejects.toThrow(/redirect/)
  })

  it('does not treat 304 as a redirect', async () => {
    // Not Modified shares the 3xx range and is an answer, not a hop.
    const { ctx } = await harness()
    await expect(
      ctx.http({ url: `${origin}/status?code=304`, redirect: 'error' }),
    ).resolves.toMatchObject({ status: 304 })
  })

  it('honours redirect: manual, returning the 3xx unfollowed', async () => {
    const { ctx } = await harness()
    const response = await ctx.http({
      url: `${origin}/redirect?to=${encodeURIComponent('/json')}`,
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
  })

  it('leaves ungated callers alone', async () => {
    // The kernel, core services and tests are trusted; only plugins are gated.
    const { ctx } = await harness()
    await expect(ctx.http({ url: `${origin}/json` })).resolves.toMatchObject({ status: 200 })
  })
})

describe('redirect credential stripping (audit W2)', () => {
  const credentialHeaders = {
    Authorization: 'Bearer top-secret-token',
    Cookie: 'session=caller-secret',
    'Proxy-Authorization': 'Basic cHJveHk6c2VjcmV0',
    'X-Keep': 'still-here',
  }

  it('keeps caller credentials on a same-host redirect', async () => {
    const { ctx } = await harness()
    const response = await ctx.http({
      url: `${origin}/redirect?to=${encodeURIComponent('/echo-headers')}`,
      headers: credentialHeaders,
    })
    const echoed = await response.json<Record<string, string>>()
    expect(echoed.authorization).toBe('Bearer top-secret-token')
    expect(echoed.cookie).toBe('session=caller-secret')
    expect(echoed['proxy-authorization']).toBe('Basic cHJveHk6c2VjcmV0')
    expect(echoed['x-keep']).toBe('still-here')
  })

  it('strips caller credentials on a cross-host redirect, keeps the rest', async () => {
    // Both hosts are granted (the capability gate is not what is under
    // test here) — the point is that a server-chosen target must not
    // receive credentials minted for the origin host.
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-demo',
      requested: ['net:host/127.0.0.1', 'net:host/localhost'] as never,
    })
    const target = `${secretOrigin}/echo-headers`
    const response = await scoped.http({
      url: `${origin}/redirect?to=${encodeURIComponent(target)}`,
      headers: credentialHeaders,
    })
    const echoed = await response.json<Record<string, string>>()
    expect(echoed.authorization).toBeUndefined()
    expect(echoed.cookie).toBeUndefined()
    expect(echoed['proxy-authorization']).toBeUndefined()
    expect(echoed['x-keep']).toBe('still-here')
  })
})

describe('the http/request waterfall', () => {
  it('lets a listener rewrite the request', async () => {
    // Where M2's auth injection, retry and rate limiting hook in.
    const { ctx } = await harness()
    // Mutate and call next: `next(somethingElse)` is silently ignored, which
    // is why the signature takes no arguments (docs/07 §5).
    ctx.on('http/request', ((req: { headers?: Record<string, string> }, next: () => unknown) => {
      req.headers = { ...req.headers, 'x-echo': 'injected' }
      return next()
    }) as never)

    const body = await ctx.http.get<{ echoed: string }>(`${origin}/json`)
    expect(body.echoed).toBe('injected')
  })

  it('lets a listener answer without going out', async () => {
    const { ctx } = await harness()
    const before = seen.length
    ctx.on('http/request', (() => ({
      status: 200,
      headers: {},
      url: 'cache://',
      text: async () => '',
      json: async () => ({ hello: 'cached' }),
      bytes: async () => new Uint8Array(),
      stream: () => new ReadableStream(),
    })) as never)

    expect(await ctx.http.get<{ hello: string }>(`${origin}/json`)).toEqual({ hello: 'cached' })
    expect(seen.length, 'nothing reached the server').toBe(before)
  })
})

describe('download', () => {
  it('writes a URL to a file', async () => {
    const { ctx, root } = await harness()
    const to = pathToFileURL(join(root, 'out.bin')).href
    const result = await ctx.http.download({ url: `${origin}/bytes`, to })

    expect(result.bytes).toBe(PAYLOAD.length)
    expect(result.etag).toBe('"v1"')
    expect(await readFile(join(root, 'out.bin'))).toEqual(PAYLOAD)
  })

  it('resumes from where it stopped', async () => {
    // The shape M3's task queue is built on: resume by byte offset, and the
    // etag is what says the remote file is still the same one.
    const { ctx, root } = await harness()
    const to = pathToFileURL(join(root, 'partial.bin')).href
    await ctx.fs.writeFile(to, PAYLOAD.subarray(0, 2000))

    const result = await ctx.http.download({ url: `${origin}/bytes`, to, resumeFrom: 2000 })
    expect(result.bytes).toBe(PAYLOAD.length)
    expect(await readFile(join(root, 'partial.bin'))).toEqual(PAYLOAD)
    expect(seen.at(-1)!.headers.range).toBe('bytes=2000-')
  })

  it('reports the etag and the full length before the body is written', async () => {
    // The resumer needs both *before* appending: a changed etag means the
    // bytes on disk are not the bytes that are coming, and discovering that
    // after the append is how a corrupt splice happens.
    const { ctx, root } = await harness()
    const to = pathToFileURL(join(root, 'partial.bin')).href
    await ctx.fs.writeFile(to, PAYLOAD.subarray(0, 2000))
    const headers: { etag?: string; total?: number }[] = []

    const result = await ctx.http.download({
      url: `${origin}/bytes`,
      to,
      resumeFrom: 2000,
      onResponse: (info) => void headers.push(info),
    })

    // `total` is the whole file, not the 3000 bytes this response carries —
    // a progress bar that showed the remainder would restart at 60%.
    expect(headers).toEqual([{ etag: '"v1"', total: PAYLOAD.length }])
    expect(result.bytes).toBe(PAYLOAD.length)
  })
})

describe('cookies', () => {
  it('keeps jars apart and drops expired cookies', async () => {
    // ⚠️ In-memory only in M1 — persistence lands in M2 (docs/04 §2.1).
    const { ctx } = await harness()
    const home = ctx.http.cookies.jar('navidrome-home')
    const work = ctx.http.cookies.jar('navidrome-work')

    await home.set([
      { name: 'session', value: 'abc', domain: 'example.org', path: '/', secure: true, httpOnly: true },
      {
        name: 'stale',
        value: 'x',
        domain: 'example.org',
        path: '/',
        secure: true,
        httpOnly: true,
        expiresAt: Date.now() - 1000,
      },
    ])

    expect((await home.get('https://example.org/rest')).map((c) => c.name)).toEqual(['session'])
    expect(await work.all(), 'jars never see each other').toEqual([])

    await home.clear()
    expect(await home.all()).toEqual([])
  })

  it('does not hand example.com cookies to evilexample.com', async () => {
    // `host.endsWith(domain)` has no boundary: the attacker registers a domain
    // that ends with yours. RFC 6265 §5.1.3 wants a dot or an exact match.
    const { ctx } = await harness()
    const jar = ctx.http.cookies.jar('site')
    await jar.set([
      {
        name: 'session',
        value: 'secret',
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ])

    expect(await jar.get('https://example.com/')).toHaveLength(1)
    expect(await jar.get('https://api.example.com/')).toHaveLength(1)
    expect(await jar.get('https://evilexample.com/'), 'not a subdomain').toHaveLength(0)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-http-leak') })
    await ctx.plugin(FsNode)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('splitJoinedSetCookie (the fallback when a Headers has no raw pairs)', () => {
  it('leaves a single cookie alone', () => {
    expect(splitJoinedSetCookie('session=abc; Path=/')).toEqual(['session=abc; Path=/'])
  })

  it('returns nothing for an empty header', () => {
    expect(splitJoinedSetCookie('')).toEqual([])
  })

  it('splits a session and a CSRF token joined with ", "', () => {
    expect(splitJoinedSetCookie('session=abc; Path=/; HttpOnly, csrf=tok; Secure')).toEqual([
      'session=abc; Path=/; HttpOnly',
      'csrf=tok; Secure',
    ])
  })

  it('does not split inside an RFC 1123 Expires date', () => {
    const header = 'a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT'
    expect(splitJoinedSetCookie(header)).toEqual([header])
  })

  it('does not split inside the dash-form dates real servers send', () => {
    // Google's shape: two cookies, both dates dash-form with weekday commas,
    // joined with ", ".
    expect(
      splitJoinedSetCookie(
        'NID=204=t; expires=Sat, 24-Oct-2026 08:26:03 GMT; path=/; domain=.google.com; HttpOnly, ' +
          '1P_JAR=2026-10-01; expires=Mon, 23-Nov-2026 08:26:03 GMT; path=/; domain=.google.com',
      ),
    ).toEqual([
      'NID=204=t; expires=Sat, 24-Oct-2026 08:26:03 GMT; path=/; domain=.google.com; HttpOnly',
      '1P_JAR=2026-10-01; expires=Mon, 23-Nov-2026 08:26:03 GMT; path=/; domain=.google.com',
    ])
  })

  it('splits when the next cookie really does start after a date', () => {
    expect(splitJoinedSetCookie('a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT, b=2')).toEqual([
      'a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT',
      'b=2',
    ])
  })

  it('keeps two Expires attributes before the next cookie intact', () => {
    expect(
      splitJoinedSetCookie(
        'a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Expires=Thu, 22 Oct 2015 07:28:00 GMT, b=2',
      ),
    ).toEqual([
      'a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Expires=Thu, 22 Oct 2015 07:28:00 GMT',
      'b=2',
    ])
  })

  it('does not split a comma inside a plain cookie value', () => {
    expect(splitJoinedSetCookie('a=1,2; Path=/')).toEqual(['a=1,2; Path=/'])
  })

  it('does not split a comma inside a quoted value', () => {
    expect(splitJoinedSetCookie('a="x,y=z"; Path=/')).toEqual(['a="x,y=z"; Path=/'])
    expect(splitJoinedSetCookie('a="x,y"; Path=/, b=2')).toEqual(['a="x,y"; Path=/', 'b=2'])
  })

  it('trims the whitespace a join leaves behind', () => {
    expect(splitJoinedSetCookie('  a=1  ,  b=2  ')).toEqual(['a=1', 'b=2'])
  })
})

describe('cookie jars that survive a restart', () => {
  /**
   * "Sign in once, stay signed in" (docs/10 §M2) is a cookie-jar property
   * before it is anything else, and the jar is credential material — so it is
   * envelope-encrypted through `ctx.secrets` rather than left beside the
   * database.
   */
  async function jarHarness(root: string) {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(SecretsNode, {})
    await tick()
    await ctx.plugin(plugin, { jars: jarStore(ctx.secrets, ctx.fs) })
    await tick()
    return ctx
  }

  const cookie = (over: Partial<Cookie> = {}): Cookie => ({
    name: 'session',
    value: 'abc123',
    domain: 'music.example.org',
    path: '/',
    expiresAt: Date.now() + 86_400_000,
    secure: true,
    httpOnly: true,
    ...over,
  })

  it('does not read a jar file that has never been written', async () => {
    // Same reason as the secrets store: on desktop `fs` is an IPC bridge, and
    // a rejected call is logged by the host before this side's `catch`
    // runs — so a source nobody has signed in to printed an ENOENT stack.
    const root = await tempDir('bbebee-jar-fresh')
    const ctx = await jarHarness(root)
    const readFile = vi.spyOn(FsNode.prototype, 'readFile')
    try {
      await ctx.http.cookies.jar('never-signed-in').ready
      expect(readFile).not.toHaveBeenCalled()
    } finally {
      readFile.mockRestore()
    }
  })

  it('reloads a jar after a restart', async () => {
    const root = await tempDir('bbebee-jar')
    const first = await jarHarness(root)
    const jar = first.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie()])
    await jar.flush()

    const second = await jarHarness(root)
    const reloaded = second.http.cookies.jar('nav')
    await reloaded.ready
    expect((await reloaded.get('https://music.example.org/x')).map((c) => c.value)).toEqual([
      'abc123',
    ])
  })

  it('does not resurrect a session cookie', async () => {
    // A cookie with no expiry is defined to last for the session. Persisting
    // it would restore a login the server already considers over.
    const root = await tempDir('bbebee-jar-session')
    const first = await jarHarness(root)
    const jar = first.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie({ expiresAt: undefined })])
    await jar.flush()

    const second = await jarHarness(root)
    const reloaded = second.http.cookies.jar('nav')
    await reloaded.ready
    expect(await reloaded.all()).toEqual([])
  })

  it('keeps two sources’ jars apart', async () => {
    // The documented case: two Navidrome servers, and a cookie set by one is
    // never sent to the other.
    const root = await tempDir('bbebee-jar-two')
    const ctx = await jarHarness(root)
    const a = ctx.http.cookies.jar('source-a')
    const b = ctx.http.cookies.jar('source-b')
    await Promise.all([a.ready, b.ready])

    await a.set([cookie({ value: 'a-session' })])
    expect(await b.get('https://music.example.org/x')).toEqual([])
  })

  it('leaves nothing behind when cleared', async () => {
    // This is `signOut()`. "Nothing" has to include the stored copy.
    const root = await tempDir('bbebee-jar-clear')
    const first = await jarHarness(root)
    const jar = first.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie()])
    await jar.clear()

    const second = await jarHarness(root)
    const reloaded = second.http.cookies.jar('nav')
    await reloaded.ready
    expect(await reloaded.all()).toEqual([])
  })

  it('does not leave the cookie readable on disk', async () => {
    const root = await tempDir('bbebee-jar-disk')
    const ctx = await jarHarness(root)
    const jar = ctx.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie({ value: 'hunter2secret' })])
    await jar.flush()

    const dir = await ctx.fs.dir('data')
    const raw = await ctx.fs.readFile(ctx.fs.join(dir!, 'jar-nav.bin'))
    expect(raw).not.toContain('hunter2secret')
  })

  it('forgets a jar whose key is gone', async () => {
    // Envelope encryption's failure mode, and the one that matters: without
    // the key the file is bytes, so losing the key *is* signing out.
    const root = await tempDir('bbebee-jar-key')
    const first = await jarHarness(root)
    const jar = first.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie()])
    await jar.flush()
    await first.secrets.delete('jar-key:nav')

    const second = await jarHarness(root)
    const reloaded = second.http.cookies.jar('nav')
    await reloaded.ready
    expect(await reloaded.all()).toEqual([])
  })

  it('still works with no credential store at all', async () => {
    // A build with no secrets keeps jars in memory and is honest about it.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-jar-none') })
    await ctx.plugin(FsNode)
    await ctx.plugin(plugin, {})
    await tick()

    const jar = ctx.http.cookies.jar('nav')
    await jar.ready
    await jar.set([cookie()])
    expect(await jar.all()).toHaveLength(1)
  })
})

describe('cookies on the wire', () => {
  /**
   * The jar is per *scope*, and a scope is one imported source (docs/06 §4.1).
   * That is what makes "two Navidrome servers, independent auth state" true
   * rather than aspirational.
   */
  async function scoped(scopeId: string, root: string, config: HttpNodeConfig = {}) {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(SecretsNode, {})
    await tick()
    await ctx.plugin(plugin, { jars: jarStore(ctx.secrets, ctx.fs), ...config })
    await tick()
    // The same helper the kernel uses to scope a plugin, so the test exercises
    // the real path rather than a hand-built config the service might read
    // differently.
    const scopedCtx = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-source-runtime',
      scopeId,
      requested: ['net:host/*'] as never,
    })
    return { ctx, http: scopedCtx.http }
  }

  it('stores a set-cookie and sends it back', async () => {
    const root = await tempDir('bbebee-wire')
    const { http } = await scoped('src-a', root)
    await http({ url: `${origin}/set-cookie` })
    const echoed = await http({ url: `${origin}/echo-cookie` })
    expect(await echoed.text()).toContain('session=abc123')
  })

  it('does not send one source’s cookie to another source', async () => {
    const root = await tempDir('bbebee-wire-two')
    const a = await scoped('src-a', root)
    await a.http({ url: `${origin}/set-cookie` })

    const b = await scoped('src-b', root)
    const echoed = await b.http({ url: `${origin}/echo-cookie` })
    expect(await echoed.text()).not.toContain('abc123')
  })

  it('reads a cookie set on a redirect, not only on the final response', async () => {
    // A login flow sets its session cookie *on* the 302. Reading only the
    // final response drops it, and the user appears never to have signed in.
    const root = await tempDir('bbebee-wire-redirect')
    const { http } = await scoped('src-a', root)
    await http({ url: `${origin}/login-redirect` })
    const echoed = await http({ url: `${origin}/echo-cookie` })
    expect(await echoed.text()).toContain('session=viaredirect')
  })

  it('withholds a secure cookie from a plaintext request', async () => {
    // A LAN server on http would otherwise have its session sent in the clear
    // by a redirect it did not choose.
    const root = await tempDir('bbebee-wire-secure')
    const { ctx, http } = await scoped('src-a', root)
    const jar = ctx.http.cookies.jar('src-a')
    await jar.ready
    await jar.set([
      {
        name: 'session',
        value: 'secret',
        domain: '127.0.0.1',
        path: '/',
        expiresAt: Date.now() + 60_000,
        secure: true,
        httpOnly: true,
      },
    ])
    const echoed = await http({ url: `${origin}/echo-cookie` })
    expect(await echoed.text()).not.toContain('secret')
  })

  it('refuses a Domain the server does not own', async () => {
    // Cookie injection: a backend setting a cookie for an unrelated host, which
    // the jar would then send there.
    const root = await tempDir('bbebee-wire-domain')
    const { ctx, http } = await scoped('src-a', root)
    await http({ url: `${origin}/set-foreign-cookie` })
    const stored = await ctx.http.cookies.jar('src-a').all()
    expect(stored.map((c) => c.domain)).not.toContain('evil.example')
  })

  it('lets a request set its own Cookie header', async () => {
    // The document knows something the jar does not.
    const root = await tempDir('bbebee-wire-explicit')
    const { http } = await scoped('src-a', root)
    await http({ url: `${origin}/set-cookie` })
    const echoed = await http({
      url: `${origin}/echo-cookie`,
      headers: { cookie: 'session=mine' },
    })
    expect(await echoed.text()).toContain('session=mine')
  })

  it('splits a joined set-cookie when the transport has no getSetCookie', async () => {
    // The last runtime shape: a `Headers` that reports every cookie as one
    // comma-joined string, with no `getSetCookie()` and no raw pairs. Splitting
    // on commas alone would cut the `Expires` date in half; the conservative
    // splitter is what keeps both cookies whole.
    const root = await tempDir('bbebee-wire-joined')
    const { ctx, http } = await scoped('src-a', root, {
      fetch: olderRuntimeFetch,
    })
    await http({ url: `${origin}/joined-cookie` })

    const jar = ctx.http.cookies.jar('src-a')
    await jar.ready
    const stored = await jar.all()
    expect(
      stored.map((c) => c.name).sort(),
      'the joined header must arrive as two cookies, not one mangled one',
    ).toEqual(['csrf', 'session'])
    expect(stored.find((c) => c.name === 'session')?.value).toBe('abc123')
    // The `Expires` date survived as a date, not as a pair of mangled
    // attributes around the comma.
    expect(stored.find((c) => c.name === 'session')?.expiresAt).toBe(
      Date.parse('Wed, 21 Oct 2037 07:28:00 GMT'),
    )

    const echoed = await http({ url: `${origin}/echo-cookie` })
    const sent = await echoed.text()
    expect(sent).toContain('session=abc123')
    expect(sent).toContain('csrf=tok')
  })
})

describe('wiring itself to the credential store', () => {
  it('persists jars without the caller passing a store', async () => {
    /*
     * A shell that had to build the jar store by hand is a shell that can
     * forget to — and forgetting produces an app where signing in appears to
     * work and never sticks. So `ctx.http` adopts `ctx.secrets` itself when
     * there is one.
     */
    const root = await tempDir('bbebee-selfwire')
    const build = async () => {
      const ctx = new Context()
      await ctx.plugin(PathsNode, { root })
      await ctx.plugin(FsNode)
      await ctx.plugin(SecretsNode, {})
      await tick()
      // No `jars` config: the point is that none is needed.
      await ctx.plugin(plugin, {})
      await tick()
      return ctx
    }

    const first = await build()
    const jar = first.http.cookies.jar('src-a')
    await jar.ready
    await jar.set([
      {
        name: 'session',
        value: 'persisted',
        domain: 'music.example.org',
        path: '/',
        expiresAt: Date.now() + 60_000,
        secure: false,
        httpOnly: true,
      },
    ])
    await jar.flush()

    const second = await build()
    const reloaded = second.http.cookies.jar('src-a')
    await reloaded.ready
    expect((await reloaded.all()).map((c) => c.value)).toEqual(['persisted'])
  })

  it('keeps working when there is no credential store', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-selfwire-none') })
    await ctx.plugin(FsNode)
    await ctx.plugin(plugin, {})
    await tick()

    const jar = ctx.http.cookies.jar('src-a')
    await jar.ready
    await jar.set([
      {
        name: 'session',
        value: 'memory-only',
        domain: 'music.example.org',
        path: '/',
        expiresAt: Date.now() + 60_000,
        secure: false,
        httpOnly: true,
      },
    ])
    expect(await jar.all()).toHaveLength(1)
  })
})
