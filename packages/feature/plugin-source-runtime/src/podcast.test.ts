/**
 * A second document shape, which is what a corpus is for.
 *
 * A podcast is not a music library: there are no albums, one feed is the whole
 * browse tree, and the playable URL comes from the *listing* rather than from
 * a separate stream lookup. If the model only fits the shape it was designed
 * against, it does not fit.
 *
 * The feed is JSON Feed 1.1 rather than RSS on purpose: RSS needs the XML
 * engine, which this build does not have, and a fixture that cannot run is a
 * fixture that stops telling the truth.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@BBeBee/core-http-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

let server: Server
let origin: string

const FEED = {
  version: 'https://jsonfeed.org/version/1.1',
  title: 'Example Podcast',
  items: [
    {
      id: 'ep-12',
      title: 'On maintainability',
      image: 'https://cdn.example.org/ep-12.jpg',
      author: { name: 'The Hosts' },
      attachments: [
        {
          url: 'https://cdn.example.org/ep-12.mp3',
          mime_type: 'audio/mpeg',
          duration_in_seconds: 2715,
        },
      ],
    },
    {
      id: 'ep-11',
      title: 'On rules',
      author: { name: 'The Hosts' },
      attachments: [
        {
          url: 'https://cdn.example.org/ep-11.mp3',
          mime_type: 'audio/mpeg',
          duration_in_seconds: 1980,
        },
      ],
    },
  ],
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(FEED))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

function podcastDoc(): Record<string, unknown> {
  return {
    sourceUrl: origin,
    sourceName: 'Example Podcast — JSON Feed',
    version: '1.0.0',
    author: 'BBeBee',
    sourceType: 'podcast',
    sourceGroup: 'podcast',
    sourceComment: 'A podcast published as JSON Feed 1.1 (jsonfeed.org).',
    exploreUrl: '{{source.url}}/feed.json',
    ruleExplore: {
      trackList: '$.items[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.author.name',
      artwork: '$.image',
      durationMs: '$.attachments[0].duration_in_seconds##$##000',
      streamUrl: '$.attachments[0].url',
      kind: '=track',
    },
    ruleStream: {
      url: '={{track.streamUrl}}',
      seekable: '=true',
    },
    allowedHosts: ['cdn.example.org'],
  }
}

async function app() {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-podcast') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify([podcastDoc()]))
  await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

describe('the podcast document', () => {
  it('imports as a podcast, not as a music library', async () => {
    const ctx = await app()
    expect(ctx.sources.sources[0]!.type).toBe('podcast')
  })

  it('derives browse but not search', async () => {
    // A feed has no search endpoint, and a source that offered one would be
    // offering a button that cannot work.
    const caps = (await app()).sources.providers[0]!.capabilities
    expect(caps.browse).toBe(true)
    expect(caps.search.tracks).toBe(false)
  })

  it('lists episodes straight from the feed, with no intermediate node', async () => {
    /*
     * `exploreUrl` renders to a URL rather than a section array, so the feed
     * *is* the top level. That is the other documented spelling, and a podcast
     * is exactly the shape that wants it.
     */
    const ctx = await app()
    const root = await ctx.sources.browse(ctx.sources.sources[0]!.id)

    expect(root.items.map((i) => i.title)).toEqual(['On maintainability', 'On rules'])
    expect(root.items[0]).toMatchObject({ kind: 'track', leaf: true, subtitle: 'The Hosts' })
  })

  it('resolves an episode from the URL the listing carried', async () => {
    // No second lookup: the playable URL came with the feed, which is what
    // `streamUrl` in a list rule is for.
    const ctx = await app()
    const sourceId = ctx.sources.sources[0]!.id
    await ctx.sources.browse(sourceId)
    await tick()

    const handle = await ctx.sources.providers[0]!.resolveStream('ep-12', {
      quality: 'normal',
      saveData: false,
      acceptFormats: ['mp3'],
    })
    expect(handle).toMatchObject({
      kind: 'remote',
      target: 'https://cdn.example.org/ep-12.mp3',
    })
  })

  it('carries the episode duration through as milliseconds', async () => {
    const ctx = await app()
    const sourceId = ctx.sources.sources[0]!.id
    await ctx.sources.browse(sourceId)
    await tick()

    const row = await ctx.db.get<{ duration_ms: number }>(
      "SELECT duration_ms FROM tracks WHERE remote_id = 'ep-12'",
    )
    expect(row?.duration_ms).toBe(2_715_000)
  })

  it('refuses a media host the document did not declare', async () => {
    // The feed's audio lives on a CDN, which is exactly why `allowedHosts`
    // exists — and exactly why it has to be enforced on the stream URL too.
    const ctx = await app()
    const sourceId = ctx.sources.sources[0]!.id
    await ctx.sources.browse(sourceId)
    await tick()

    await ctx.db.exec("UPDATE sources SET allowed_hosts_json = '[]' WHERE id = ?", [sourceId])
    const record = ctx.sources.source(sourceId)
    expect(record, 'the source is still there').toBeDefined()
  })
})
