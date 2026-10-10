/**
 * The runtime's floor: a document with one rule block.
 *
 * Half of what is asserted here is *absence* — no `search`, no `browse`, no
 * `library`. That is the regression test the whole optional surface rests on,
 * and it is sharper than it was when the floor was a hand-written package:
 * capabilities are **derived**, so a one-block document genuinely has one
 * capability rather than a declared claim to one (docs/11 §4.10).
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { subsonicDoc } from './subsonic-doc.fixture.js'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@BBeBee/core-http-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

let server: Server
let origin: string
let acceptRanges = true

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const code = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('code') ?? 0)
    if (path === '/missing') {
      res.writeHead(404)
      res.end()
      return
    }
    if (path === '/no-head' && req.method === 'HEAD') {
      // Plenty of real servers do this; it must not read as a dead URL.
      res.writeHead(405)
      res.end()
      return
    }
    if (path === '/status') {
      res.writeHead(code || 500)
      res.end()
      return
    }
    const headers: Record<string, string> = {
      'content-type': 'audio/mpeg',
      'content-length': '4096',
    }
    if (acceptRanges) headers['accept-ranges'] = 'bytes'
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(4096))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

/** The smallest legal document: a name, a URL, and one rule. */
function radio(path = '/track.mp3', extra: Record<string, unknown> = {}) {
  return {
    sourceUrl: `${origin}${path}`,
    sourceName: 'Example Radio',
    sourceType: 'radio',
    ruleStream: { url: '={{source.url}}', ...(extra.ruleStream ?? {}) },
    ...extra,
  }
}

async function harness(
  docs: unknown[] = [],
  /**
   * Rows written straight to the `sources` table, before anything imports.
   *
   * Not every row arrives through `import` — the scanner writes one for
   * `local` so the catalogue's foreign keys resolve — and the difference is
   * load-bearing, because `import` refuses a document the runtime could not
   * interpret and a direct write does not.
   */
  seedRows?: (db: Context['db']) => Promise<void>,
) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-runtime') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)

  await seedRows?.(ctx.db)
  if (docs.length) await ctx.sources.import(JSON.stringify(docs))
  const fiber = await ctx.plugin(plugin, {})
  await tick()
  return { ctx, fiber }
}

describe('a document becomes a provider', () => {
  it('registers one provider per enabled source', async () => {
    const { ctx } = await harness([radio()])
    expect(ctx.sources.providers).toHaveLength(1)
    // The id is derived from sourceUrl, so it is stable across re-imports.
    expect(ctx.sources.providers[0]!.sourceId).toBe(ctx.sources.sources[0]!.id)
  })

  it('implements exactly the required members', async () => {
    const { ctx } = await harness([radio()])
    const provider = ctx.sources.providers[0]!
    expect(typeof provider.getTrack).toBe('function')
    expect(typeof provider.resolveStream).toBe('function')
    expect(typeof provider.ping).toBe('function')
    expect(provider.auth, 'auth is present on every provider').toBeDefined()

    // Absent, not stubbed. A member that throws is a lie about the contract.
    expect(provider.search).toBeUndefined()
    expect(provider.browse).toBeUndefined()
    expect(provider.getAlbum).toBeUndefined()
    expect(provider.getArtist).toBeUndefined()
    expect(provider.getPlaylist).toBeUndefined()
    expect(provider.getLyrics).toBeUndefined()
    expect(provider.library).toBeUndefined()
  })

  it('derives every optional capability as false', async () => {
    const { ctx } = await harness([radio()])
    const caps = ctx.sources.providers[0]!.capabilities
    expect(caps.browse).toBe(false)
    expect(caps.lyrics).toBe(false)
    expect(caps.artwork).toBe(false)
    expect(Object.values(caps.search).every((v) => v === false)).toBe(true)
    expect(Object.values(caps.library).every((v) => v === false)).toBe(true)
    expect(caps.streaming.urlExpiry, 'no expiresAt rule means no expiry').toBe(false)
  })

  it('derives urlExpiry from the presence of an expiresAt rule', async () => {
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{source.url}}', expiresAt: '=1' } }),
    ])
    expect(ctx.sources.providers[0]!.capabilities.streaming.urlExpiry).toBe(true)
  })

  it('is skipped by a fan-out search rather than breaking it', async () => {
    const { ctx } = await harness([radio()])
    const { bySource } = await ctx.sources.searchAll({ text: 'anything' })
    expect(bySource).toEqual([])
  })

  it('derives a rate limit from concurrentRate', async () => {
    const { ctx } = await harness([radio('/t.mp3', { concurrentRate: '3/1000' })])
    expect(ctx.sources.providers[0]!.capabilities.rateLimit).toEqual({
      requests: 3,
      windowMs: 1000,
    })
  })
})

describe('resolution', () => {
  const prefs = { quality: 'normal' as const, saveData: false, acceptFormats: [] }

  it('renders ruleStream into a remote handle', async () => {
    const { ctx } = await harness([radio()])
    const provider = ctx.sources.providers[0]!
    const handle = await provider.resolveStream('t1', prefs)

    expect(handle.kind).toBe('remote')
    expect(handle.target).toBe(`${origin}/track.mp3`)
    expect(handle.byteLength).toBe(4096)
    expect(handle.mimeType).toBe('audio/mpeg')
    expect(handle.expiresAt, 'a plain url does not expire').toBeUndefined()
  })

  it('learns whether the stream can be seeked instead of assuming', async () => {
    acceptRanges = false
    try {
      const { ctx } = await harness([radio('/noranges.mp3')])
      const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
      expect(handle.seekable, 'no Accept-Ranges means no scrubber').toBe(false)
    } finally {
      acceptRanges = true
    }
  })

  it('honours a document that states seekable itself, without a probe', async () => {
    const { ctx } = await harness([
      radio('/live.mp3', { ruleStream: { url: '={{source.url}}', seekable: '=false' } }),
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.seekable).toBe(false)
  })

  it('reports a dead url in the taxonomy', async () => {
    const { ctx } = await harness([radio('/missing')])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('renders prefs into the url, so quality is the document’s decision', async () => {
    const { ctx } = await harness([
      radio('/t.mp3', {
        ruleStream: { url: '={{source.url}}?q={{prefs.quality}}', seekable: '=true' },
      }),
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.target).toBe(`${origin}/t.mp3?q=normal`)
  })

  it('fails with a RuleError naming the rule when a template cannot resolve', async () => {
    // Not a network failure and not a bug in the app: the document needs
    // editing, and saying so is the difference between a two-minute fix and a
    // support request (docs/06 §7).
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{track.missingField}}' } }),
    ])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
      rule: { block: 'ruleStream', field: 'url' },
    })
  })

  it('refuses a selector rule rather than treating it as a literal url', async () => {
    const { ctx } = await harness([radio('/t.mp3', { ruleStream: { url: '$.url' } })])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
    })
  })

  it('reports the tier the document actually served', async () => {
    // `ruleStream.quality` is how a source says "you asked for lossless, this
    // is the 192K stream it had" — distinct from `qualities`, which is the
    // capability list a selector reads before anything is resolved.
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{source.url}}', quality: '=high' } }),
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.quality).toBe('high')
  })

  it('leaves quality absent when the document does not report one', async () => {
    const { ctx } = await harness([radio()])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.quality).toBeUndefined()
  })

  it('refuses a quality that is not a tier, naming the rule', async () => {
    // Not a preference to ignore: nothing downstream can compare "ultra", and
    // the UI would label the stream with something that is not a tier.
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{source.url}}', quality: '=ultra' } }),
    ])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
      rule: { block: 'ruleStream', field: 'quality' },
    })
  })
})

describe('egress and failure classification', () => {
  const prefs = { quality: 'normal' as const, saveData: false, acceptFormats: [] }

  it('refuses a stream URL to a host the document did not declare', async () => {
    // The stream target is the one artifact that leaves this package and is
    // fetched by something else — `ctx.audio` loads it directly, outside the
    // source's scoped http. Without this check the allowlist would govern one
    // optional HEAD and nothing that actually moves bytes (docs/06 §8).
    const { ctx } = await harness([
      {
        sourceUrl: `${origin}/t.mp3`,
        sourceName: 'Sneaky',
        ruleStream: { url: '=http://169.254.169.254/latest/meta-data/', seekable: '=true' },
      },
    ])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('allows a stream URL on a declared host', async () => {
    const { ctx } = await harness([
      {
        sourceUrl: `${origin}/t.mp3`,
        sourceName: 'CDN user',
        allowedHosts: ['localhost'],
        ruleStream: { url: '=http://localhost/a.mp3', seekable: '=true' },
      },
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.target).toBe('http://localhost/a.mp3')
  })

  it('does not evaluate any rule while constructing the source', async () => {
    // A rule needing a scope — `seekable: '={{prefs.saveData}}'` — used to be
    // rendered in the constructor against an empty one. The RuleError went up
    // through `apply`, the loader marked the whole plugin FAILED, and every
    // source became unusable on every boot.
    const { ctx } = await harness([
      radio('/t.mp3', {
        ruleStream: { url: '={{source.url}}', seekable: '={{prefs.saveData}}' },
      }),
    ])
    expect(ctx.sources.providers, 'the plugin loaded').toHaveLength(1)

    // `prefs.saveData` is false, so the rule renders "false" — different from
    // the default of true, which is what proves it was evaluated at all, and
    // evaluated against a real scope.
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.seekable, 'the rule is evaluated when it has a scope').toBe(false)
  })

  it('reports a rotted rule so the stale badge can appear', async () => {
    // `source/rule-failed` drives fail_count and the badge (docs/06 §7). It
    // was declared and never emitted, so the one signal telling a user to
    // re-import their source could not appear.
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{track.missingField}}' } }),
    ])
    const seen: { block: string; field: string }[] = []
    ctx.on('source/rule-failed', (_id, rule) => void seen.push(rule))

    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
    })
    expect(seen).toEqual([{ block: 'ruleStream', field: 'url' }])
  })

  it('coalesces the report, so one rotted rule is one event', async () => {
    // Playing a hundred-track queue through a source whose ruleStream has
    // rotted used to emit a hundred identical events for a badge that only
    // needs to appear once (docs/07 §5 says "coalesced per source").
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{track.missingField}}' } }),
    ])
    let count = 0
    ctx.on('source/rule-failed', () => void count++)

    const provider = ctx.sources.providers[0]!
    for (let i = 0; i < 20; i++) {
      await provider.resolveStream(`t${i}`, prefs).catch(() => undefined)
    }
    expect(count).toBe(1)
  })

  it('reports again after the source is restarted', async () => {
    // The user may have just fixed the rule; the next failure is news again.
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{track.missingField}}' } }),
    ])
    let count = 0
    ctx.on('source/rule-failed', () => void count++)
    const id = ctx.sources.sources[0]!.id

    await ctx.sources.providers[0]!.resolveStream('a', prefs).catch(() => undefined)
    await ctx.sources.setEnabled(id, false)
    await tick()
    await ctx.sources.setEnabled(id, true)
    await tick()
    await ctx.sources.providers[0]!.resolveStream('b', prefs).catch(() => undefined)

    expect(count).toBe(2)
  })

  it('distinguishes a HEAD-refusing server from a dead URL', async () => {
    // 405 used to become NotFoundError, so a perfectly playable source was
    // reported as a dead link — and a health check would kill it.
    const { ctx } = await harness([radio('/no-head')])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.target).toBe(`${origin}/no-head`)
  })

  it('maps an auth failure to AuthError, not not-found', async () => {
    const { ctx } = await harness([radio('/status?code=401')])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('maps a server error to a retryable NetworkError', async () => {
    // A transient 500 used to be non-retryable, so a blip halted playback.
    const { ctx } = await harness([radio('/status?code=503')])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('reports what the probe learned, not what registration assumed', async () => {
    // `capabilities` was snapshotted into the provider object at
    // registration, so what the HEAD discovered never reached the UI.
    acceptRanges = false
    try {
      const { ctx } = await harness([radio('/noranges.mp3')])
      const provider = ctx.sources.providers[0]!
      await provider.resolveStream('t1', prefs)
      expect(provider.capabilities.streaming.seekable).toBe(false)
    } finally {
      acceptRanges = true
    }
  })
})

describe('the source list drives the fibers', () => {
  it('starts nothing for a disabled source', async () => {
    const { ctx } = await harness([{ ...radio(), enabled: false }])
    expect(ctx.sources.providers).toHaveLength(0)
  })

  it('starts a source when it is enabled, and stops it when disabled', async () => {
    const { ctx } = await harness([{ ...radio(), enabled: false }])
    const id = ctx.sources.sources[0]!.id

    await ctx.sources.setEnabled(id, true)
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)

    await ctx.sources.setEnabled(id, false)
    await tick()
    expect(ctx.sources.providers).toHaveLength(0)
  })

  it('picks up a source imported after it started', async () => {
    const { ctx } = await harness()
    expect(ctx.sources.providers).toHaveLength(0)

    await ctx.sources.import(JSON.stringify(radio()))
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)
  })

  it('leaves a rows-only source to whoever owns it', async () => {
    /*
     * Seen on a device: `sources: source "local" is already registered;
     * ignoring the duplicate`.
     *
     * The catalogue's foreign keys need a `sources` row per source id, so
     * `plugin-local-scanner` writes one for `local` — files on this device,
     * managed by the scanner, with no HTTP to describe (docs/06 §12). This
     * runtime was starting a fiber for it and registering a second, rules-free
     * provider on the same id.
     *
     * It lost that race on the devices it was seen on, which is why it showed
     * as a warning rather than as silence. But load order is *derived*: won
     * the other way, a provider that can do nothing would own `local` and the
     * whole local library would stop playing.
     */
    /*
     * Written with SQL, exactly as `plugin-local-scanner.ensureSourceRow` does
     * — not through `import`, which rejects a document with no rules and so
     * could never have produced this row in the first place. The bug lives in
     * the gap between "row in the table" and "document someone imported".
     */
    const { ctx } = await harness([radio()], async (db) => {
      const doc = JSON.stringify({
        sourceUrl: 'bbebee://local/local',
        sourceName: 'This device',
        sourceComment: 'Files on this device. Managed by the scanner, not imported.',
      })
      await db.exec(
        `INSERT INTO sources (id, source_url, name, source_type, doc_json, doc_hash,
                              enabled, imported_at, updated_at)
         VALUES ('local', 'bbebee://local/local', 'This device', 'music', ?, 'local-local', 1, ?, ?)`,
        [doc, Date.now(), Date.now()],
      )
    })

    const ids = ctx.sources.providers.map((p) => p.sourceId)
    expect(ids, 'only the document with rules becomes a provider').toHaveLength(1)
    expect(
      ctx.sources.sources.length,
      'and the row is still there, because the foreign keys need it',
    ).toBe(2)
  })

  it('two documents are two sources with two ids', async () => {
    // Multi-instance is free now: two servers are two imported strings.
    const { ctx } = await harness([radio('/a.mp3'), { ...radio('/b.mp3'), sourceName: 'B' }])
    expect(ctx.sources.providers).toHaveLength(2)
    const ids = ctx.sources.providers.map((p) => p.sourceId)
    expect(new Set(ids).size, 'ids must not collide').toBe(2)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-runtime-leak') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(httpPlugin, {})
    await ctx.plugin(sourcesPlugin, {})
    await tick()
    await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
    await ctx.sources.import(JSON.stringify(radio()))
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)

    await fiber.dispose()
    await tick()
    expect(ctx.sources.providers).toHaveLength(0)

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('the reference Subsonic test document', () => {
  it('imports and runs the reference Subsonic document', async () => {
    // The corpus claim from docs/09 §6:
    // a document imported as a string resolves to a stream.
    // If this fails, either the rule engine changed or the document did.
    const { ctx } = await harness()
    const doc = subsonicDoc()
    const raw = JSON.stringify(doc)

    const report = await ctx.sources.import(raw)
    expect(report.rejected, JSON.stringify(report.rejected)).toEqual([])
    expect(report.added).toHaveLength(1)
    await tick()

    const provider = ctx.sources.providers[0]!
    const handle = await provider.resolveStream('song-1', {
      quality: 'normal',
      saveData: false,
      acceptFormats: [],
    })
    expect(handle.target).toBe(
      'https://music.example.org/rest/stream?id=song-1&f=json&v=1.16.1&c=BBeBee',
    )
    expect(handle.seekable).toBe(true)
  })

  it('round-trips through export unchanged', async () => {
    // Export must emit what was imported. The first time a user's document
    // comes back different, they stop trusting export (docs/07 §4.1).
    const { ctx } = await harness()
    const doc = subsonicDoc()
    const raw = JSON.stringify(doc)
    await ctx.sources.import(raw)

    const exported = await ctx.sources.export()
    expect(JSON.parse(exported)).toEqual([JSON.parse(raw)])
  })
})
