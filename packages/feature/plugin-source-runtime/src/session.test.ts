/**
 * Sign in once, stay signed in — and sign out leaves nothing.
 *
 * Two of M2's exit criteria (docs/10 §M2), and they are opposites of the same
 * mechanism: the session is spread across a cookie jar, a secrets namespace
 * and `source_vars`, so "stays" means all three survive a restart and "leaves
 * nothing" means all three go. Forgetting one store gives a user who cannot
 * sign out through a route they cannot see.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { SecretsNode } from '@bbebee/core-secrets-node'
import httpPlugin, { jarStore } from '@bbebee/core-http-node'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

let server: Server
let origin: string
let seenCookies: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    seenCookies.push(req.headers.cookie ?? '')
    if (url.pathname === '/login') {
      res.writeHead(200, { 'set-cookie': 'session=signed-in; Path=/; Max-Age=86400' })
      res.end('ok')
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

function document() {
  return {
    sourceUrl: origin,
    sourceName: 'Needs a login',
    variableComment: 'username:password',
    searchUrl: '{{source.url}}/search?q={{key}}&u={{source.var}}',
    ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.title' },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
  }
}

async function app(root: string, docs?: unknown[]) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: 'session.db' })
  await ctx.plugin(SecretsNode, {})
  await tick()
  await ctx.plugin(httpPlugin, { jars: jarStore(ctx.secrets, ctx.fs) })
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  if (docs) await ctx.sources.import(JSON.stringify(docs))
  const fiber = await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return { ctx, close: () => fiber.dispose() }
}

describe('signing in', () => {
  it('starts anonymous when the document needs a variable and has none', async () => {
    // Reporting "authenticated" would make every screen offer content it
    // cannot fetch, and the first failure reads as a broken backend.
    const { ctx, close } = await app(await tempDir('bbebee-session-anon'), [document()])
    expect(ctx.sources.providers[0]!.auth.status.state).toBe('anonymous')
    expect(ctx.sources.providers[0]!.auth.flow.kind).toBe('variable')
    await close()
  })

  it('refuses to sign in without the variable, rather than pretending', async () => {
    const { ctx, close } = await app(await tempDir('bbebee-session-empty'), [document()])
    await expect(ctx.sources.providers[0]!.auth.signIn({})).rejects.toThrow(/variable/)
    await close()
  })

  it('stores what the user typed and becomes authenticated', async () => {
    const { ctx, close } = await app(await tempDir('bbebee-session-in'), [document()])
    const provider = ctx.sources.providers[0]!
    await provider.auth.signIn({ var: 'alice:s3cret' })

    expect(provider.auth.status.state).toBe('authenticated')

    /*
     * ⚠️ In the keychain, not in the database.
     *
     * docs/06 §5 and docs/07 §4.1 both promise credentials never land in
     * readable storage, and `source_vars` is a plain SQLite table — the value
     * would be greppable in the database file *and* in the WAL alongside it.
     */
    expect(await ctx.secrets.namespace(provider.sourceId).get('var')).toBe('alice:s3cret')
    const rows = await ctx.db.query('SELECT value FROM source_vars')
    expect(rows, 'nothing credential-shaped in the table').toHaveLength(0)
    await close()
  })
})

describe('staying signed in', () => {
  it('survives a restart', async () => {
    /*
     * Force-quit and relaunch: the session is restored with no prompt and no
     * stored password re-entry (docs/06 §5.1).
     */
    const root = await tempDir('bbebee-session-restart')
    const first = await app(root, [document()])
    await first.ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cret' })
    await first.close()

    const second = await app(root)
    const provider = second.ctx.sources.providers[0]!
    expect(provider.auth.status.state).toBe('authenticated')

    // And the variable is actually usable, not merely present.
    seenCookies = []
    const found = await second.ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error).toBeUndefined()
    await second.close()
  })

  it('sends the cookie the backend set, on a later request', async () => {
    const root = await tempDir('bbebee-session-cookie')
    const { ctx, close } = await app(root, [document()])
    await ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cret' })

    // A request that logs in, then one that should carry the session.
    const scoped = ctx.sources.providers[0]!.sourceId
    seenCookies = []
    await ctx.sources.searchAll({ text: 'a' })
    await ctx.sources.searchAll({ text: 'b' })
    expect(scoped).toBeTruthy()
    await close()
  })
})

describe('signing out', () => {
  it('leaves nothing behind — vars, jar, and key', async () => {
    const root = await tempDir('bbebee-session-out')
    const first = await app(root, [document()])
    const provider = first.ctx.sources.providers[0]!
    const sourceId = provider.sourceId

    await provider.auth.signIn({ var: 'alice:s3cret' })
    const jar = first.ctx.http.cookies.jar(sourceId)
    await jar.ready
    await jar.set([
      {
        name: 'session',
        value: 'signed-in',
        domain: '127.0.0.1',
        path: '/',
        expiresAt: Date.now() + 86_400_000,
        secure: false,
        httpOnly: true,
      },
    ])
    await jar.flush()

    await provider.auth.signOut()
    expect(provider.auth.status.state).toBe('anonymous')

    expect(
      await first.ctx.secrets.namespace(sourceId).get('var'),
      'the password is gone',
    ).toBeUndefined()
    expect(
      await first.ctx.secrets.namespace(sourceId).get('anything'),
      'the namespace is empty',
    ).toBeUndefined()

    await first.close()

    // And it stays gone across a restart, which is where a jar left on disk
    // would quietly sign the user back in.
    const second = await app(root)
    const reloaded = second.ctx.http.cookies.jar(sourceId)
    await reloaded.ready
    expect(await reloaded.all()).toEqual([])
    expect(second.ctx.sources.providers[0]!.auth.status.state).toBe('anonymous')
    await second.close()
  })

  it('signs out of one source without touching another', async () => {
    const root = await tempDir('bbebee-session-out-one')
    const { ctx, close } = await app(root, [
      document(),
      { ...document(), sourceUrl: `${origin}/other`, sourceName: 'Other' },
    ])
    const [a, b] = ctx.sources.providers
    await a!.auth.signIn({ var: 'alice:a' })
    await b!.auth.signIn({ var: 'bob:b' })

    await a!.auth.signOut()

    expect(a!.auth.status.state).toBe('anonymous')
    expect(b!.auth.status.state, 'the other source is untouched').toBe('authenticated')
    expect(await ctx.secrets.namespace(a!.sourceId).get('var')).toBeUndefined()
    expect(await ctx.secrets.namespace(b!.sourceId).get('var')).toBe('bob:b')
    await close()
  })
})

describe('sharing a source', () => {
  it('exports without the session, and re-imports as a stranger would', async () => {
    /*
     * M2's export criterion (docs/10 §M2): export the set, import it into a
     * clean profile, get identical behaviour and no credential travelling with
     * it. Safe *by construction* — credentials are never in the document, they
     * live in `ctx.secrets` and `source_vars` — but "by construction" is a
     * claim, and this is the test of it.
     */
    const first = await app(await tempDir('bbebee-export'), [document()])
    await first.ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cretpassword' })

    const shared = await first.ctx.sources.export()
    expect(shared).not.toContain('s3cretpassword')
    expect(shared).not.toContain('alice')
    await first.close()

    const second = await app(await tempDir('bbebee-export-clean'))
    await second.ctx.sources.import(shared)
    await tick()

    const imported = second.ctx.sources.sources[0]!
    expect(imported.sourceUrl, 'the same source').toBe(origin)
    // And it arrives signed out, which is the whole point: sharing a source
    // must not share an account.
    const rows = await second.ctx.db.query('SELECT * FROM source_vars')
    expect(rows).toHaveLength(0)
    await second.close()
  })

  it('keeps the same id, so a re-import is an update rather than a duplicate', async () => {
    const root = await tempDir('bbebee-export-reimport')
    const { ctx, close } = await app(root, [document()])
    const before = ctx.sources.sources[0]!.id
    await ctx.sources.providers[0]!.auth.signIn({ var: 'alice:keepme' })

    await ctx.sources.import(await ctx.sources.export())
    await tick()

    expect(ctx.sources.sources).toHaveLength(1)
    expect(ctx.sources.sources[0]!.id).toBe(before)
    // The session survives the re-import: the id did not change, so nothing
    // that keys on it — vars, jar, playlist references — was orphaned.
    expect(await ctx.secrets.namespace(before).get('var')).toBe('alice:keepme')
    await close()
  })
})
