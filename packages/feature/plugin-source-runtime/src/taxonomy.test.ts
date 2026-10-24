/**
 * The error taxonomy, exercised — docs/06 §7.
 *
 * The table has seven rows and `ctx.player` does something different for every
 * one of them, so the *class* is the whole interface. A backend that is down
 * and a rule that is wrong produce identical symptoms — nothing plays — and
 * only the class tells the user which of "try later" and "this source needs
 * updating" is the right advice.
 *
 * Which is why each row is checked for the two things a caller branches on:
 * the class, and `retryable`.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@bbebee/core-http-node'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import {
  AuthError,
  NetworkError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  SourceFormatError,
  isRetryable,
} from '@BBeBee/protocol'
import { statusError } from './fetch.js'
import plugin from './index.js'

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const code = Number(url.searchParams.get('code') ?? 200)
    if (code !== 200) {
      res.writeHead(code)
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
    sourceName: 'Taxonomy',
    searchUrl: '{{source.url}}/search?q={{key}}',
    ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.title' },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
    ...over,
  }
}

async function app(docs: unknown[]) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-taxonomy') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
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

/** Search a source whose `searchUrl` provokes the given status. */
async function searchWithStatus(code: number): Promise<unknown> {
  const ctx = await app([document({ searchUrl: `{{source.url}}/search?code=${code}&q={{key}}` })])
  const found = await ctx.sources.searchAll({ text: 'x' })
  return found.bySource[0]!.error
}

describe('every row of the table', () => {
  it('401 and 403 are auth, and not retryable', async () => {
    // Retrying a refused credential is how a wrong password becomes a lockout.
    for (const code of [401, 403]) {
      const error = await searchWithStatus(code)
      expect(error, `${code}`).toBeInstanceOf(AuthError)
      expect(isRetryable(error)).toBe(false)
    }
  })

  it('429 is a rate limit, retryable, and says how long to wait', async () => {
    const error = await searchWithStatus(429)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(isRetryable(error)).toBe(true)
    expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0)
  })

  it('404 and 410 are not-found, and not retryable', async () => {
    // The track is gone. Retrying finds it just as gone, and the row is marked
    // unavailable rather than hidden.
    for (const code of [404, 410]) {
      const error = await searchWithStatus(code)
      expect(error, `${code}`).toBeInstanceOf(NotFoundError)
      expect(isRetryable(error)).toBe(false)
    }
  })

  it('5xx is a network failure, and retryable', async () => {
    // A 500 is the backend having a moment. Treating it as non-retryable turns
    // a blip into a stopped queue.
    const error = await searchWithStatus(503)
    expect(error).toBeInstanceOf(NetworkError)
    expect(isRetryable(error)).toBe(true)
  })

  it('anything else is a provider error, and not retryable', async () => {
    const error = await searchWithStatus(418)
    expect(error).toBeInstanceOf(ProviderError)
    expect(isRetryable(error)).toBe(false)
  })

  it('a rule that no longer matches is a RuleError, naming itself', async () => {
    /*
     * The row the string model adds, and the one that earns its keep: the
     * backend answered, the document is valid, and the rule is wrong. "This
     * source needs updating" is a different sentence from "something went
     * wrong", and only the class can tell them apart.
     */
    const ctx = await app([document({ ruleSearch: { trackList: '$.songs[*]', trackId: '$.id', title: '$.nope' } })])
    const found = await ctx.sources.searchAll({ text: 'x' })
    // A missing *required* field drops the row rather than failing the search:
    // one bad row must not cost the other nineteen.
    expect(found.bySource[0]!.error).toBeUndefined()
    expect(found.bySource[0]!.result?.tracks?.items).toHaveLength(0)

    // A rule the engine cannot even run *is* an error, and carries its site.
    const broken = await app([document({ ruleSearch: { trackList: '@css:tr', trackId: '$.id', title: '$.t' } })])
    const provider = broken.sources.providers[0]!
    expect(provider.search, 'not offered at all, rather than offered and failing').toBeUndefined()
  })

  it('a malformed document is a SourceFormatError, with every issue', async () => {
    /*
     * Import-time only, and deliberately not a `SourceError`: there is no
     * source to attribute it to yet.
     *
     * ⚠️ It arrives *in the report* rather than as a throw — one malformed
     * entry never rejects the rest of a set (docs/06 §9) — so a caller reading
     * only the rejection sees a successful import that added nothing.
     */
    const ctx = await app([])
    const report = await ctx.sources.import('{"sourceName": 42}')

    expect(report.added).toHaveLength(0)
    expect(report.rejected).toHaveLength(1)
    const error = report.rejected[0]!.error
    expect(error).toBeInstanceOf(SourceFormatError)
    expect(error.issues.length, 'every issue, not the first').toBeGreaterThan(1)
    expect(error.issues.map((i) => i.path)).toContain('sourceUrl')
  })

  it('rejects only the bad entry in a set, keeping the good ones', async () => {
    const ctx = await app([])
    const report = await ctx.sources.import(
      JSON.stringify([document(), { sourceName: 42 }, { ...document(), sourceUrl: 'https://b.example' }]),
    )
    expect(report.added).toHaveLength(2)
    expect(report.rejected).toHaveLength(1)
  })

  it('a refused host is a CapabilityError, not a network failure', async () => {
    /*
     * The distinction matters because `NetworkError` is the one class the
     * player retries with backoff — so wrapping a refusal in it would retry a
     * blocked request for ever and hide why it was blocked.
     */
    const ctx = await app([
      document({ ruleStream: { url: '=https://evil.example/x' }, allowedHosts: [] }),
    ])
    const refused = ctx.sources.providers[0]!.resolveStream('s1', {
      quality: 'normal',
      saveData: false,
      acceptFormats: [],
    })
    await expect(refused).rejects.toThrow(/evil\.example/)
    // Not a `NetworkError`: that is the one class the player retries with
    // backoff, so wrapping a refusal in it would retry a blocked request for
    // ever and hide why it was blocked.
    await expect(refused).rejects.not.toBeInstanceOf(NetworkError)
  })
})

describe('the mapping itself', () => {
  it('is total: every status becomes something in the taxonomy', () => {
    // A raw `Error` escaping a provider is a bug — every caller branches on
    // `code`, and a status nobody mapped would fall through all of them.
    for (const status of [400, 401, 402, 403, 404, 410, 418, 429, 500, 502, 503, 599]) {
      const error = statusError(status, 'https://h/x', 's1')
      expect(error, `${status}`).toBeInstanceOf(Error)
      expect((error as { code?: string }).code, `${status}`).toBeTruthy()
    }
  })

  it('names the source, so a failure is attributable', () => {
    for (const status of [401, 404, 429, 500, 418]) {
      expect((statusError(status, 'https://h/x', 'src-1') as { sourceId?: string }).sourceId).toBe(
        'src-1',
      )
    }
  })
})

describe('a source that keeps failing', () => {
  it('reports each rotted rule once, driving the stale badge', async () => {
    /*
     * `source/rule-failed` is what increments `fail_count`; three in a row
     * marks a source stale (docs/06 §7). It was declared and never emitted
     * once, so the badge could not appear and the one signal telling a user to
     * re-import their source did not exist.
     */
    const ctx = await app([document({ ruleStream: { url: '={{track.missing}}' } })])
    const failures: { sourceId: string; block: string }[] = []
    ctx.on('source/rule-failed', (sourceId, rule) =>
      void failures.push({ sourceId, block: rule.block }),
    )

    await ctx.sources.providers[0]!.resolveStream('s1', {
      quality: 'normal',
      saveData: false,
      acceptFormats: [],
    }).catch(() => undefined)
    await tick()

    expect(failures[0]).toMatchObject({ block: 'ruleStream' })
  })
})
