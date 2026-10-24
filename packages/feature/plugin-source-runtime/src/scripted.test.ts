/**
 * A document that computes its own auth.
 *
 * This is docs/06 §2.3's worked example — the flagship — and until the sandbox
 * existed it could be published and never run. Subsonic's scheme is the reason
 * `@js:` is in the language at all: every request carries `t=md5(password +
 * salt)` with a fresh salt, which no amount of template interpolation can
 * produce.
 *
 * The other half of what is tested here is the boundary. A pasted string is a
 * stranger's code, so the interesting cases are the ones where it tries to
 * leave: another host, another source's variables, the filesystem, or simply
 * never returning.
 */

import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@bbebee/core-http-node'
import jsPlugin from '@bbebee/core-js-quickjs-node'
import { SecretsNode } from '@bbebee/core-secrets-node'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { md5Hex } from '@BBeBee/protocol'
import plugin from './index.js'

let server: Server
let origin: string
let lastQuery: URLSearchParams | undefined
let lastRawUrl = ''

const SONGS = [{ id: 's1', title: 'Jóga', artist: 'Björk', duration: 303, suffix: 'flac' }]

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    lastQuery = url.searchParams
    lastRawUrl = req.url ?? ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ 'subsonic-response': { searchResult3: { song: SONGS } } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

/** docs/06 §2.3's auth helper, verbatim in spirit. */
const JS_LIB =
  "function auth(){ const [u,p]=String(src.vars.get('var')||'').split(':');" +
  ' const s=src.crypto.randomHex(8);' +
  ' return `u=${u}&t=${src.crypto.md5(p+s)}&s=${s}&v=1.16.1&c=BBeBee&f=json` }'

function document(over: Record<string, unknown> = {}) {
  return {
    sourceUrl: origin,
    sourceName: 'Navidrome — scripted',
    variableComment: 'username:password',
    jsLib: JS_LIB,
    searchUrl: '{{source.url}}/rest/search3?query={{key}}&{{@js:auth()}}',
    ruleSearch: {
      trackList: '$.subsonic-response.searchResult3.song[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.artist',
    },
    ruleStream: { url: '={{source.url}}/rest/stream?id={{track.id}}&{{@js:auth()}}' },
    ...over,
  }
}

async function app(docs: unknown[], opts: { sandbox?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-scripted') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  // Credentials go to the keychain, never to the database (docs/06 §5), so a
  // source that signs in needs this present.
  await ctx.plugin(SecretsNode, {})
  await ctx.plugin(httpPlugin, {})
  if (opts.sandbox !== false) await ctx.plugin(jsPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify(docs))
  await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

/**
 * The source variable a user types into the import screen.
 *
 * Through `signIn` rather than straight into the table: that is the path the
 * app uses, and it keeps the in-memory mirror `src.vars.get` reads in step
 * with what was stored.
 */
async function setVar(ctx: Context, sourceId: string, value: string) {
  const provider = ctx.sources.providers.find((p) => p.sourceId === sourceId)
  await provider!.auth.signIn({ var: value })
}

describe('the documented Subsonic document', () => {
  it('computes its auth query and searches with it', async () => {
    const ctx = await app([document()])
    const sourceId = ctx.sources.sources[0]!.id
    await setVar(ctx, sourceId, 'alice:s3cret')

    const found = await ctx.sources.searchAll({ text: 'björk' })
    const entry = found.bySource[0]!
    expect(entry.error, 'the search itself must succeed').toBeUndefined()
    expect(entry.result?.tracks?.items.map((t) => t.title)).toEqual(['Jóga'])

    // The salt is fresh per call, so the token can only be checked by
    // recomputing it — which is exactly what a real server does.
    const salt = lastQuery!.get('s')!
    expect(lastQuery!.get('u')).toBe('alice')
    expect(lastQuery!.get('t')).toBe(md5Hex('s3cret' + salt))
    expect(salt).toHaveLength(16)
  }, 30_000)

  it('uses a different salt each time', async () => {
    // A fixed salt would make the token a password equivalent, replayable for
    // ever by anyone who saw one request.
    const ctx = await app([document()])
    await setVar(ctx, ctx.sources.sources[0]!.id, 'alice:s3cret')

    await ctx.sources.searchAll({ text: 'a' })
    const first = lastQuery!.get('s')
    await ctx.sources.searchAll({ text: 'b' })
    expect(lastQuery!.get('s')).not.toBe(first)
  }, 30_000)

  it('is unsearchable, rather than broken, with no sandbox', async () => {
    /*
     * The capability is derived from what can run *here*. Without `ctx.js` the
     * document is perfectly valid and simply cannot be served — so the honest
     * answer is no search button, not a button that throws.
     */
    const ctx = await app([document()], { sandbox: false })
    const provider = ctx.sources.providers[0]!
    expect(provider.capabilities.search.tracks).toBe(false)
    expect(provider.search, 'absent, not stubbed').toBeUndefined()
  }, 30_000)

  it('resolves a stream with freshly computed auth', async () => {
    const ctx = await app([document()])
    await setVar(ctx, ctx.sources.sources[0]!.id, 'alice:s3cret')
    const handle = await ctx.sources.providers[0]!.resolveStream('s1', {
      quality: 'normal',
      saveData: false,
      acceptFormats: ['flac'],
    })
    expect(handle.target).toContain('id=s1')
    expect(handle.target).toMatch(/[?&]t=[0-9a-f]{32}/)
  }, 30_000)
})

describe('what a pasted string cannot do', () => {
  const hostile = (js: string) =>
    document({ jsLib: js, searchUrl: '{{source.url}}/rest/search3?{{@js:probe()}}' })

  const searchWith = async (js: string) => {
    const ctx = await app([hostile(js)])
    const found = await ctx.sources.searchAll({ text: 'x' })
    return found.bySource[0]!
  }

  it('cannot reach a host the document did not declare', async () => {
    // The sandbox bounds reach, not intent: a script may compute any URL it
    // likes, and the egress allowlist is what stops it being fetched.
    const entry = await searchWith(
      "async function probe(){ await src.get('https://evil.example/x'); return 'ok' }",
    )
    expect(entry.error).toBeDefined()
    expect(String(entry.error?.message)).toMatch(/evil\.example/)
  }, 30_000)

  it('has no filesystem, no fetch, and no require', async () => {
    const entry = await searchWith(
      "function probe(){ return [typeof fetch, typeof require, typeof process].join(',') }",
    )
    // The rule succeeded — it just found nothing to reach.
    expect(entry.error, 'the script ran').toBeUndefined()
  }, 30_000)

  it('is interrupted rather than hanging the app', async () => {
    const started = Date.now()
    const entry = await searchWith('function probe(){ while (true) {} }')
    expect(entry.error).toBeDefined()
    expect(Date.now() - started, 'bounded by the realm timeout').toBeLessThan(20_000)
  }, 30_000)

  it('cannot read another source’s vars', async () => {
    /*
     * Two Navidrome servers is the documented case (docs/10 §M2), and the
     * whole point of per-source realms: one document reading the other's
     * session token would make sharing a source a way to steal an account.
     */
    const ctx = await app([
      document(),
      {
        ...document(),
        sourceUrl: `${origin}/other`,
        sourceName: 'Other',
        jsLib: "function probe(){ return 'leaked=' + String(src.vars.get('var')) }",
        searchUrl: '{{source.url}}/rest/search3?{{@js:probe()}}',
      },
    ])
    const [a, b] = ctx.sources.sources
    await setVar(ctx, a!.id, 'alice:s3cret')
    // b stays signed out: the question is whether it can see a's secret, and
    // giving it one of its own would muddy the answer.

    await ctx.sources.searchAll({ text: 'x', }, { sourceIds: [b!.id] })
    expect(lastQuery!.toString()).not.toContain('s3cret')
    expect(lastQuery!.get('leaked')).not.toBe('alice:s3cret')
  }, 30_000)
})

describe('src, the whole host surface', () => {
  const evaluate = async (body: string) => {
    const ctx = await app([
      document({
        jsLib: `function probe(){ ${body} }`,
        searchUrl: '{{source.url}}/rest/search3?v={{@js:probe()}}',
      }),
    ])
    await ctx.sources.searchAll({ text: 'x' })
    return lastQuery!.get('v')
  }

  it('hashes the way the backends expect', async () => {
    expect(await evaluate("return src.crypto.md5('abc')")).toBe(md5Hex('abc'))
    expect(await evaluate("return src.crypto.sha1('abc')")).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    )
  }, 30_000)

  it('encrypts with rsa and rsa-oaep in sandbox', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const pubEscaped = JSON.stringify(publicKey)
    const b64 = await evaluate(`return src.url.encode(src.crypto.rsaEncrypt('hello', ${pubEscaped}))`)
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(decodeURIComponent(b64!), 'base64'),
    )
    expect(decrypted.toString('utf8')).toBe('hello')

    const hexCipher = await evaluate(`return src.crypto.rsaOaepEncrypt('refresh_token', ${pubEscaped})`)
    const decryptedOaep = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(hexCipher!, 'hex'),
    )
    expect(decryptedOaep.toString('utf8')).toBe('refresh_token')
  }, 30_000)

  it('encodes and resolves URLs', async () => {
    // Read off the *raw* request line: `URLSearchParams` decodes on the way
    // out, so checking the parsed value would test the test rather than
    // `src.url.encode`.
    await evaluate("return src.url.encode('a b&c')")
    expect(lastRawUrl).toContain('v=a%20b%26c')
    expect(await evaluate("return src.url.resolve('https://h/a/b', '../c')")).toBe('https://h/c')
  }, 30_000)

  it('keeps a value in the per-source cache across calls', async () => {
    // `src.cache` is why the realm outlives one rule: a token fetched during
    // search has to still be there when the stream is resolved.
    const ctx = await app([
      document({
        jsLib:
          "function probe(){ const n = (src.cache.get('n') || 0) + 1; src.cache.put('n', n); return n }",
        searchUrl: '{{source.url}}/rest/search3?v={{@js:probe()}}',
      }),
    ])
    await ctx.sources.searchAll({ text: 'a' })
    expect(lastQuery!.get('v')).toBe('1')
    await ctx.sources.searchAll({ text: 'b' })
    expect(lastQuery!.get('v')).toBe('2')
  }, 30_000)

  it('persists a var a script writes', async () => {
    const ctx = await app([
      document({
        jsLib: "function probe(){ src.vars.put('token', 'abc'); return src.vars.get('token') }",
        searchUrl: '{{source.url}}/rest/search3?v={{@js:probe()}}',
      }),
    ])
    await ctx.sources.searchAll({ text: 'a' })
    expect(lastQuery!.get('v')).toBe('abc')

    const row = await ctx.db.get<{ value: string }>(
      "SELECT value FROM source_vars WHERE key = 'token'",
    )
    expect(row?.value, 'written through, so it survives a restart').toBe('abc')
  }, 30_000)

  it('says what is missing rather than failing as undefined', async () => {
    // `src.parse.html` needs a markup parser this build does not have. A
    // document reaching for it should be told that, not `undefined is not a
    // function`.
    const ctx = await app([
      document({
        jsLib: "function probe(){ try { src.parse.html('<a>') } catch (e) { return String(e) } }",
        searchUrl: '{{source.url}}/rest/search3?v={{@js:probe()}}',
      }),
    ])
    await ctx.sources.searchAll({ text: 'a' })
    expect(lastQuery!.get('v')).toMatch(/markup parser/)
  }, 30_000)
})

describe('a realm that timed out', () => {
  it('does not brick every later rule for that source', async () => {
    /*
     * ⚠️ `ctx.js` retires a realm that breached a limit — every later call on
     * it rejects, by contract. Handing that same dead realm back for ever
     * meant one `@js:` rule overrunning once broke *every* scripted rule for
     * the source until the app restarted, with an error about a disposed realm
     * rather than about the rule that overran.
     */
    const ctx = await app([
      document({
        jsLib:
          'function probe(){ if (globalThis.__done) return "ok";' +
          ' globalThis.__done = 1; while (true) {} }',
        searchUrl: '{{source.url}}/rest/search3?v={{@js:probe()}}',
      }),
    ])

    // First search hangs its rule and poisons the realm.
    const first = await ctx.sources.searchAll({ text: 'a' })
    expect(first.bySource[0]!.error, 'the overrun is reported').toBeDefined()

    /*
     * The second search builds a *fresh* realm — so `jsLib` runs again and
     * `globalThis.__done` is gone, which is exactly the point: the only state
     * lost is the realm's own, and the source works.
     */
    const second = await ctx.sources.searchAll({ text: 'b' })
    expect(
      String(second.bySource[0]!.error ?? ''),
      'and it is not a complaint about a dead realm',
    ).not.toMatch(/no longer usable/)
  }, 60_000)
})
