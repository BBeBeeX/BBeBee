/**
 * Session expiry, and getting back from it without the user noticing.
 *
 * docs/06 §5: expiry is an *event*, not an error — the source stays registered
 * and its cached catalogue stays browsable — and refresh is transparent and
 * **singular**: a burst of 401s triggers exactly one login, which every caller
 * awaits.
 *
 * The singularity is the part worth testing. An expired session fails every
 * request in flight at the same moment, so re-authenticating per failure is a
 * login storm against a backend that has just told you it is unhappy.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { SecretsNode } from '@bbebee/core-secrets-desktop'
import httpPlugin from '@bbebee/core-http-desktop'
import jsPlugin from '@bbebee/core-js-quickjs-desktop'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { AuthError, type RateLimitError } from '@BBeBee/protocol'
import { statusError } from './fetch.js'
import plugin from './index.js'

let server: Server
let origin: string
/** Flipped by `/login`; every search before it gets a 401. */
let signedIn = false
let logins = 0
/** When set, `/search` answers 200 with a login page instead of a 401. */
let softExpiry = false

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/login') {
      logins++
      signedIn = url.searchParams.get('pw') === 'correct'
      if (!signedIn) {
        res.writeHead(401)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }

    if (softExpiry) {
      // The case no status code signals: a login page served with a 200.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"login":true}')
      return
    }
    if (!signedIn) {
      res.writeHead(401)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ songs: [{ id: 's1', title: 'Jóga' }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

function document(over: Record<string, unknown> = {}) {
  return {
    sourceUrl: origin,
    sourceName: 'Form login',
    loginUi: [
      { id: 'user', label: 'Username', type: 'text' },
      { id: 'pw', label: 'Password', type: 'password' },
    ],
    loginUrl: '{{source.url}}/login?user={{login.user}}&pw={{login.pw}}',
    searchUrl: '{{source.url}}/search?q={{key}}',
    ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.title' },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
    ...over,
  }
}

async function app(docs: unknown[]) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-reauth') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(SecretsNode, {})
  await ctx.plugin(jsPlugin, {})
  await tick()
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify(docs))
  await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

function reset() {
  signedIn = false
  logins = 0
  softExpiry = false
}

describe('a form login', () => {
  it('is the flow a document with loginUi declares', async () => {
    reset()
    const ctx = await app([document()])
    const auth = ctx.sources.providers[0]!.auth
    expect(auth.flow.kind).toBe('form')
    expect(auth.flow.kind === 'form' && auth.flow.fields.map((f) => f.id)).toEqual(['user', 'pw'])
  }, 30_000)

  it('refuses to sign in with a field missing', async () => {
    reset()
    const ctx = await app([document()])
    await expect(ctx.sources.providers[0]!.auth.signIn({ user: 'alice' })).rejects.toThrow(
      /Password/,
    )
  }, 30_000)

  it('performs the login request and becomes authenticated', async () => {
    reset()
    const ctx = await app([document()])
    await ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'correct' })
    expect(logins).toBe(1)
    expect(ctx.sources.providers[0]!.auth.status.state).toBe('authenticated')
  }, 30_000)

  it('reports bad credentials as an AuthError, not as a transport failure', async () => {
    reset()
    const ctx = await app([document()])
    await expect(
      ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'wrong' }),
    ).rejects.toThrow(AuthError)
  }, 30_000)
})

describe('an expired session', () => {
  it('re-authenticates and retries, transparently', async () => {
    reset()
    const ctx = await app([document()])
    await ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'correct' })

    // The server forgets. The next search should recover without the user
    // being told anything.
    signedIn = false
    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error, 'the search succeeded').toBeUndefined()
    expect(found.bySource[0]!.result?.tracks?.items).toHaveLength(1)
    expect(logins, 'logged in again exactly once').toBe(2)
  }, 30_000)

  it('logs in once for a burst of failures, not once each', async () => {
    /*
     * The shape an expiry actually has: everything in flight fails at the same
     * moment. One in-flight promise; everyone awaits it.
     */
    reset()
    const ctx = await app([document()])
    await ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'correct' })
    signedIn = false

    const provider = ctx.sources.providers[0]!
    await Promise.all([
      provider.search!({ text: 'a' }),
      provider.search!({ text: 'b' }),
      provider.search!({ text: 'c' }),
      provider.search!({ text: 'd' }),
    ])
    expect(logins, 'one refresh, four callers').toBe(2)
  }, 30_000)

  it('gives up after one retry rather than storming the backend', async () => {
    // A second failure is information: the credentials are wrong, not stale,
    // and that needs the user rather than another attempt.
    reset()
    const ctx = await app([document({ loginUrl: '{{source.url}}/login?user=x&pw=wrong' })])
    await ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'correct' }).catch(() => {})

    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error).toBeDefined()
    expect(logins, 'the initial attempt plus one refresh').toBeLessThanOrEqual(2)
  }, 30_000)

  it('marks the source expired and says so, rather than unregistering it', async () => {
    /*
     * Expiry is an event, not an error: the source stays registered and its
     * cached catalogue stays browsable, so the shell offers a re-login in
     * place instead of making the source vanish.
     */
    reset()
    const ctx = await app([document({ loginUrl: '{{source.url}}/login?user=x&pw=wrong' })])
    const expired: string[] = []
    ctx.on('source/auth-expired', (id) => void expired.push(id))

    await ctx.sources.searchAll({ text: 'x' })
    await tick()

    expect(expired).toContain(ctx.sources.sources[0]!.id)
    expect(ctx.sources.providers, 'still registered').toHaveLength(1)
    expect(ctx.sources.providers[0]!.auth.status.state).toBe('expired')
  }, 30_000)

  it('catches an expiry that arrives as a 200', async () => {
    /*
     * No HTTP status reliably signals "the server started answering with the
     * login page again" — plenty serve that with a 200. `loginCheckJs` is the
     * document saying what its own backend does.
     */
    reset()
    const ctx = await app([
      document({ loginCheckJs: 'return !result.login' }),
    ])
    await ctx.sources.providers[0]!.auth.signIn({ user: 'alice', pw: 'correct' })

    softExpiry = true
    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error, 'a 200 login page is still an expiry').toBeDefined()
    expect(logins, 'and it triggered a refresh').toBe(2)
  }, 30_000)
})

describe('a variable source', () => {
  it('cannot refresh itself, and says so', async () => {
    // Its credentials are static: an expired session needs the user, and
    // retrying the same variable for ever would just hide that.
    reset()
    const ctx = await app([
      {
        sourceUrl: origin,
        sourceName: 'Variable',
        variableComment: 'user:password',
        searchUrl: '{{source.url}}/search?q={{key}}&v={{source.var}}',
        ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.title' },
        ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
      },
    ])
    await ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cret' })

    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error).toBeDefined()
    expect(logins, 'no login was attempted').toBe(0)
    expect(ctx.sources.providers[0]!.auth.status.state).toBe('expired')
  }, 30_000)
})

describe('a refused login leaves nothing behind', () => {
  it('does not report authenticated after the backend said no', async () => {
    /*
     * ⚠️ `status` is derived from whether the fields are stored, so persisting
     * them *before* attempting the login left the source reporting
     * "authenticated" with a password the backend had just rejected — and
     * every later request then failed with no prompt to fix it, because as far
     * as the app was concerned the user was signed in.
     */
    reset()
    const ctx = await app([document()])
    const auth = ctx.sources.providers[0]!.auth

    await expect(auth.signIn({ user: 'alice', pw: 'wrong' })).rejects.toThrow(AuthError)
    expect(auth.status.state).toBe('anonymous')
  }, 30_000)

  it('leaves the credentials out of the keychain too', async () => {
    reset()
    const ctx = await app([document()])
    const provider = ctx.sources.providers[0]!
    await provider.auth.signIn({ user: 'alice', pw: 'wrong' }).catch(() => undefined)

    const stored = ctx.secrets.namespace(provider.sourceId)
    expect(await stored.get('pw')).toBeUndefined()
    expect(await stored.get('user')).toBeUndefined()
  }, 30_000)

  it('and a correct login afterwards still works', async () => {
    // The undo must not poison the next attempt.
    reset()
    const ctx = await app([document()])
    const auth = ctx.sources.providers[0]!.auth
    await auth.signIn({ user: 'alice', pw: 'wrong' }).catch(() => undefined)
    await auth.signIn({ user: 'alice', pw: 'correct' })
    expect(auth.status.state).toBe('authenticated')
  }, 30_000)
})

describe('Retry-After', () => {
  it('waits the interval the server named, not a guess', async () => {
    // Inventing a minute either hammers the server early or idles the queue
    // long after it was ready.
    const error = statusError(429, 'https://h/x', 's1', 1500) as RateLimitError
    expect(error.retryAfterMs).toBe(1500)
  })

  it('falls back only when the server said nothing', async () => {
    expect((statusError(429, 'https://h/x', 's1') as RateLimitError).retryAfterMs).toBe(60_000)
  })
})
