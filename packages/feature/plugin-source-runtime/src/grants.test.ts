/**
 * The runtime, under the grants it actually ships with.
 *
 * ⚠️ Every other test here runs *ungated* — a bare `Context` has no capability
 * config, so `assertDb` and `assertHost` wave everything through. That is why
 * a plugin holding `db:read:core` could write `source_vars` in green CI and
 * throw `CapabilityError` on a user's machine: sign-out failed, the in-memory
 * mirror was never cleared, and the UI showed "signed in" until restart.
 *
 * So this file scopes the runtime with the manifest's own capability list and
 * exercises the paths that touch mediated services.
 */

import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { SecretsNode } from '@bbebee/core-secrets-desktop'
import httpPlugin from '@bbebee/core-http-desktop'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner, scopeContext } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { PluginManifest } from '@BBeBee/protocol'
import plugin from './index.js'

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ songs: [{ id: 's1', title: 'Jóga' }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

/** The capabilities the shipped manifest asks for — not a convenient subset. */
async function shippedGrants(): Promise<string[]> {
  const raw = await readFile(new URL('../BBeBee.plugin.json', import.meta.url), 'utf8')
  return (JSON.parse(raw) as PluginManifest).capabilities
}

function document() {
  return {
    sourceUrl: origin,
    sourceName: 'Gated',
    variableComment: 'username:password',
    searchUrl: '{{source.url}}/search?q={{key}}&u={{source.var}}',
    ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.title' },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
  }
}

async function app() {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-grants') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(SecretsNode, {})
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify([document()]))

  // The runtime, held to its manifest exactly as the kernel would.
  const gated = scopeContext(ctx, {
    pluginId: '@bbebee/plugin-source-runtime',
    requested: (await shippedGrants()) as never,
  })
  await gated.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

describe('under the shipped grants', () => {
  it('starts and registers its source', async () => {
    const ctx = await app()
    expect(ctx.sources.providers).toHaveLength(1)
  })

  it('signs in', async () => {
    const ctx = await app()
    await ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cret' })
    expect(ctx.sources.providers[0]!.auth.status.state).toBe('authenticated')
  })

  it('signs out completely', async () => {
    /*
     * The regression this file exists for. `signOut` wipes three stores, one
     * of which is a core table the runtime may only *read* — so it threw
     * `CapabilityError`, the mirror was never cleared, and the UI went on
     * showing "signed in" until the app restarted.
     */
    const ctx = await app()
    const provider = ctx.sources.providers[0]!
    await provider.auth.signIn({ var: 'alice:s3cret' })

    await expect(provider.auth.signOut()).resolves.toBeUndefined()
    expect(provider.auth.status.state).toBe('anonymous')
    expect(await ctx.secrets.namespace(provider.sourceId).get('var')).toBeUndefined()
  })

  it('stores a variable a script wrote', async () => {
    // `src.vars.put` writes the same core table, through the same door.
    const ctx = await app()
    const sourceId = ctx.sources.sources[0]!.id
    await expect(ctx.sources.writeVar(sourceId, 'page', '3')).resolves.toBeUndefined()
    expect(await ctx.sources.readVars(sourceId)).toEqual({ page: '3' })
  })

  it('searches, which is what the net grant is for', async () => {
    const ctx = await app()
    await ctx.sources.providers[0]!.auth.signIn({ var: 'alice:s3cret' })
    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]!.error).toBeUndefined()
  })
})

describe('what a failed check leaves in the database', () => {
  it('does not store the credential the URL carried', async () => {
    /*
     * ⚠️ `statusError` builds its message from the *rendered* URL, and for a
     * Subsonic document that URL carries `u=<username>` and
     * `t=<md5(password+salt)>`. Stored verbatim in `sources.last_error` that
     * is a credential at rest in a plain SQLite table — greppable in the file
     * and in the WAL — and it went out on `source/checked` besides.
     */
    const ctx = await app()
    const provider = ctx.sources.providers[0]!
    await provider.auth.signIn({ var: 'alice:hunter2secret' })

    const seen: string[] = []
    ctx.on('source/checked', (_id, report) => void seen.push(JSON.stringify(report)))

    // Point the source at a 401 so the check fails with a rendered URL.
    await ctx.sources.check([provider.sourceId]).catch(() => undefined)

    const row = await ctx.db.get<{ last_error: string | null }>(
      'SELECT last_error FROM sources WHERE id = ?',
      [provider.sourceId],
    )
    const stored = row?.last_error ?? ''
    expect(stored).not.toContain('hunter2secret')
    expect(stored, 'and no query string at all').not.toContain('?')
    expect(seen.join(''), 'nor in what listeners were handed').not.toContain('hunter2secret')
  })
})
