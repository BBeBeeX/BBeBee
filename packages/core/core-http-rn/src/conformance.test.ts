/**
 * `httpConformance` against `core-http-rn` — plus the mobile gap that made
 * this file necessary.
 *
 * Until `expo/fetch` was aliased to a stub under Vitest, the shared suite ran
 * against `core-http-node` only, and the mobile transport was covered by
 * reading it. But the two runtimes genuinely differ in one place this service
 * depends on: expo builds `response.headers` through React Native's
 * whatwg-fetch polyfill, which has no `getSetCookie` and joins repeated values
 * — so a login's session and CSRF cookies arrive as one mangled string unless
 * `HttpRn` reads expo's raw pairs. The stub (`test/stubs/expo-fetch.ts`)
 * reproduces that shape rather than Node's, so the suite exercises the mobile
 * behaviour, and the multi-cookie regression at the bottom runs against the
 * transport as a phone would see it.
 *
 * The suite runs against a real socket, never a mock. The shared
 * `startByteServer` fixture is a devDependency of `core-http-node` and not of
 * this package — a core package imports only what it declares — so the routes
 * the suite's own header names are served by a small local server instead.
 */

// The SDK is not a dependency of this package — the real one belongs to
// `core-secrets-expo` — but under Vitest the specifier is aliased to
// `test/stubs/expo-secure-store.ts`, which is the point: the cookie jar must
// round-trip through the same credential-store surface a device uses.
// @ts-expect-error — unresolvable to tsc by design; see above.
import * as SecureStore from 'expo-secure-store'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { httpConformance } from '@BBeBee/protocol/conformance'
import type { FileStat, Uri, WellKnownDir } from '@BBeBee/protocol'
import { scopeContext } from '@BBeBee/kernel'
import { tick } from '@BBeBee/kernel/testing'
import { fetch as expoFetch } from 'expo/fetch'
import plugin from './index.js'

/* ── the socket ─────────────────────────────────────────────────────────── */

const PAYLOAD = Uint8Array.from({ length: 64 * 1024 }, (_, i) => i % 251)
const CHUNK_BYTES = 8 * 1024

let server: Server
let origin: string
/** Sockets held open by `/stall`, so `close()` is not a hang of its own. */
const stalled = new Set<ServerResponse>()

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/bytes') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
      const start = range ? Number(range[1]) : 0
      const end = range && range[2] ? Number(range[2]) : PAYLOAD.byteLength - 1
      const slice = PAYLOAD.subarray(start, end + 1)
      res.writeHead(range ? 206 : 200, {
        'content-type': 'application/octet-stream',
        'content-length': String(slice.byteLength),
        'accept-ranges': 'bytes',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${PAYLOAD.byteLength}` } : {}),
      })
      if (req.method === 'HEAD') {
        // The length reported is the length that *would* have been sent.
        res.end()
        return
      }
      // Written in pieces so `stream()` and `onProgress` see more than one.
      void (async () => {
        for (let at = 0; at < slice.byteLength; at += CHUNK_BYTES) {
          if (res.writableEnded || res.destroyed) return
          if (!res.write(slice.subarray(at, Math.min(at + CHUNK_BYTES, slice.byteLength)))) {
            await new Promise<void>((resolve) => {
              res.once('drain', resolve)
              res.once('close', resolve)
            })
          }
        }
        if (!res.destroyed) res.end()
      })().catch(() => undefined)
      return
    }
    if (url.pathname === '/echo') {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value.join(', ') : (value ?? '')
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, headers }))
      return
    }
    if (url.pathname === '/slow') {
      const ms = Number(url.searchParams.get('ms') ?? '100')
      // A client that gives up must not keep the process alive waiting to
      // answer it.
      const timer = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('late')
      }, ms)
      res.on('close', () => clearTimeout(timer))
      return
    }
    if (url.pathname === '/stall') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.write(new Uint8Array([1, 2, 3, 4]))
      stalled.add(res)
      res.on('close', () => stalled.delete(res))
      return
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: url.searchParams.get('to') ?? '/bytes' })
      res.end()
      return
    }
    if (url.pathname === '/status') {
      const code = Number(url.searchParams.get('code') ?? '200')
      res.writeHead(code, { 'content-type': 'text/plain' })
      res.end(code === 204 || code === 304 ? undefined : String(code))
      return
    }
    if (url.pathname === '/sign-in') {
      // The shape that broke mobile: two cookies on one response, the
      // session's `Expires` carrying the comma that made the joined string
      // unsplit-able by anything dumber than the conservative splitter.
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': [
          'session=abc123; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly',
          'csrf=tok; Path=/',
        ],
      })
      res.end('signed in')
      return
    }
    if (url.pathname === '/echo-cookie') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(req.headers.cookie ?? '')
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(async () => {
  for (const res of stalled) res.destroy()
  stalled.clear()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

/* ── the core services `HttpNode` needs a context to have ───────────────── */

/**
 * `HttpNode` declares `inject: ['fs']`, so a context without one never
 * initializes the plugin. The jar store's envelope files are the only thing
 * that touches `ctx.fs`, so this is a map — backed by a module-level store
 * because the "restart" test below builds a *second* context over the same
 * bytes, which is the whole point of that test.
 */
const files = new Map<string, string>()

class TestFs extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  async dir(kind: WellKnownDir): Promise<Uri> {
    return `memory:///${kind}`
  }

  join(base: Uri, ...segments: string[]): Uri {
    return `${base.replace(/\/$/, '')}/${segments.join('/')}`
  }

  async exists(uri: Uri): Promise<boolean> {
    return files.has(uri)
  }

  async readFile(uri: Uri): Promise<string> {
    const data = files.get(uri)
    if (data === undefined) throw new Error(`no such file: ${uri}`)
    return data
  }

  async writeFile(uri: Uri, data: string | Uint8Array): Promise<void> {
    files.set(uri, typeof data === 'string' ? data : new TextDecoder().decode(data))
  }

  async remove(uri: Uri): Promise<void> {
    files.delete(uri)
  }

  async list(dir: Uri): Promise<FileStat[]> {
    const prefix = `${dir.replace(/\/$/, '')}/`
    return [...files.keys()]
      .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
      .map((uri) => ({
        uri,
        name: uri.slice(prefix.length),
        isDirectory: false,
        size: files.get(uri)?.length ?? 0,
        mtime: 0,
      }))
  }
}

/**
 * `ctx.secrets` over the aliased expo-secure-store stub — the keychain's
 * surface with none of its guarantees, and honest about that in
 * `isHardwareBacked`.
 */
class TestSecrets extends Service {
  constructor(ctx: Context) {
    super(ctx, 'secrets')
  }

  readonly isHardwareBacked = false
  /** The cap that forces the jar's envelope encryption in the first place. */
  readonly maxValueBytes = 2048

  async get(key: string): Promise<string | undefined> {
    return (await SecureStore.getItemAsync(key)) ?? undefined
  }

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value)
  }

  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key)
  }

  /** The real SDK cannot enumerate keys; nothing in the jar path calls this. */
  async clear(): Promise<void> {}

  /** The jar store reads its keys back as written; no scoping is needed here. */
  namespace(): TestSecrets {
    return this
  }
}

/* ── harnesses ──────────────────────────────────────────────────────────── */

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TestFs)
  // Long enough that only the checks which set their own `timeoutMs` are
  // testing a timeout — otherwise the default would be what failed.
  await ctx.plugin(plugin, { defaultTimeoutMs: 10_000 })
  await tick()
  return ctx
}

/**
 * A source-shaped caller: scoped, with a jar, and with the credential store
 * wired — the same shape `plugin-source-runtime` runs under, and the only one
 * in which "sign in" means anything.
 */
async function signedInHarness(scopeId: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TestFs)
  await ctx.plugin(TestSecrets)
  await tick()
  await ctx.plugin(plugin, {})
  await tick()
  return scopeContext(ctx, {
    pluginId: '@bbebee/plugin-source-runtime',
    scopeId,
    requested: ['net:host/*'] as never,
  })
}

beforeEach(() => {
  // The stub stores are module-level so a "restart" can see them; each test
  // starts from a device that has never signed in.
  files.clear()
  SecureStore.__resetForTests()
})

/* ── the shared contract ────────────────────────────────────────────────── */

describe(`${httpConformance.service} conformance — core-http-rn`, () => {
  for (const check of httpConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const ctx = await harness()
      await check.run({ http: ctx.http, origin, payload: PAYLOAD })
    })
  }
})

/* ── the mobile gap ─────────────────────────────────────────────────────── */

describe('multi-set-cookie through the mobile transport', () => {
  it('the transport is expo-shaped: no getSetCookie, raw pairs kept separate', async () => {
    // The premise the jar fix stands on, pinned: if expo's surface ever
    // changes, this fails and says so before a login silently stops sticking
    // on a phone.
    const response = await expoFetch(`${origin}/sign-in`, { method: 'POST' })
    expect(
      (response.headers as unknown as { getSetCookie?: unknown }).getSetCookie,
      'expo Headers must not grow a getSetCookie silently — the override assumes its absence',
    ).toBeUndefined()
    const raw = response._rawHeaders.filter(([name]) => name.toLowerCase() === 'set-cookie')
    expect(raw).toHaveLength(2)
    expect(raw.map(([, value]) => value)).toEqual([
      'session=abc123; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly',
      'csrf=tok; Path=/',
    ])
  })

  it('lands both cookies of a sign-in response in the jar, via ctx.secrets', async () => {
    const ctx = await signedInHarness('src-a')
    await ctx.http({ url: `${origin}/sign-in`, method: 'POST' })

    const jar = ctx.http.cookies.jar('src-a')
    await jar.ready
    const stored = await jar.all()
    expect(
      stored.map((c) => c.name).sort(),
      'the joined header must arrive as two cookies, not one mangled one',
    ).toEqual(['csrf', 'session'])
    expect(stored.find((c) => c.name === 'session')?.value).toBe('abc123')
    expect(stored.find((c) => c.name === 'csrf')?.value).toBe('tok')
    // The `Expires` date survived as a date — the comma that made desktop's
    // join unsplit-able is not the mobile path's problem, and must not become
    // a mangled attribute either.
    expect(stored.find((c) => c.name === 'session')?.expiresAt).toBe(
      Date.parse('Wed, 21 Oct 2037 07:28:00 GMT'),
    )

    // And it is sent back — the thing the user actually experiences.
    const echoed = await ctx.http({ url: `${origin}/echo-cookie` })
    const sent = await echoed.text()
    expect(sent).toContain('session=abc123')
    expect(sent).toContain('csrf=tok')

    // And the jar is credential material: its key went to the store, the same
    // way it would on a device.
    await jar.flush()
    expect(await ctx.secrets.get('jar-key:src-a')).toBeTruthy()
  })

  it('reloads the session from the credential store after a restart', async () => {
    const first = await signedInHarness('src-a')
    await first.http({ url: `${origin}/sign-in`, method: 'POST' })
    await first.http.cookies.jar('src-a').flush()

    // A cold start: a new context over the same stores.
    const second = await signedInHarness('src-a')
    const reloaded = second.http.cookies.jar('src-a')
    await reloaded.ready
    const stored = (await reloaded.all()).map((c) => c.name)
    expect(stored).toContain('session')
    // `csrf` carries no expiry, so it is a session cookie by construction —
    // deliberately not persisted, per the jar's own rule.
    expect(stored).not.toContain('csrf')
  })
})
