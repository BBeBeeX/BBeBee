/**
 * Search → catalogue → play, across a restart.
 *
 * This is M2's central exit criterion (docs/10 §M2) reduced to one file: a
 * document imported as *text* searches a backend, the results become
 * catalogue rows, and a track is still playable after the app has been closed
 * and reopened — with no second search and no network call to find out how.
 *
 * The restart is the point. `resolveStream` running in the same process as the
 * search that produced the track proves almost nothing: the payload could be
 * living in memory. Building a second `Context` over the same database file is
 * what shows it went to disk and came back.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import httpPlugin from '@bbebee/core-http-desktop'
import sourcesPlugin from '@bbebee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { UrnKind } from '@BBeBee/protocol'
import plugin from './index.js'

/** What `ctx.player` passes; the document under test ignores all of it. */
const PREFS = { quality: 'normal' as const, saveData: false, acceptFormats: ['mp3', 'flac'] }

let server: Server
let origin: string
let searches = 0
let albumFetches = 0

const SONGS = [
  { id: 's1', title: 'Jóga', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 303, suffix: 'flac' },
  { id: 's2', title: 'Bachelorette', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 315, suffix: 'mp3' },
]

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/rest/getAlbumList2') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        'subsonic-response': { albumList2: { album: [{ id: 'a1', name: 'Homogenic', artist: 'Björk' }] } },
      }))
      return
    }
    if (path === '/rest/getAlbum') {
      albumFetches++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ 'subsonic-response': { album: { song: SONGS } } }))
      return
    }
    if (path === '/rest/search3') {
      searches++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', searchResult3: { song: SONGS } } }))
      return
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '4096', 'accept-ranges': 'bytes' })
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(4096))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

/**
 * A Subsonic-shaped document whose stream URL needs more than the URN's id.
 *
 * `{{track.quality}}` comes from `$.suffix` — a field `Track` has nowhere to
 * put, so it exists only in the stored payload. If the round trip is broken,
 * this is the rule that says so, rather than one that happens to work off the
 * id the URN already carries.
 */
function document() {
  return {
    sourceUrl: origin,
    sourceName: 'Navidrome — round trip',
    searchUrl: '{{source.url}}/rest/search3?query={{key}}&f=json',
    ruleSearch: {
      trackList: '$.subsonic-response.searchResult3.song[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.artist',
      album: '$.album',
      albumId: '$.albumId',
      durationMs: '$.duration##$##000',
      quality: '$.suffix',
    },
    exploreUrl: '[{"title":"Albums","url":"{{source.url}}/rest/getAlbumList2?type=newest"}]',
    ruleExplore: {
      trackList: '$.subsonic-response.albumList2.album[*]',
      trackId: '$.id',
      title: '$.name',
      artist: '$.artist',
      kind: '=album',
      childUrl: '={{source.url}}/rest/getAlbum?id={{item.id}}',
    },
    ruleTrackList: {
      trackList: '$.subsonic-response.album.song[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.artist',
      quality: '$.suffix',
    },
    ruleStream: { url: '={{source.url}}/rest/stream?id={{track.id}}&format={{track.quality}}' },
  }
}

/** A context over `root`, so a second one can be built over the same database. */
async function app(root: string, docs?: unknown[]) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: 'roundtrip.db' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  if (docs) await ctx.sources.import(JSON.stringify(docs))
  const fiber = await ctx.plugin(plugin, {})
  await tick()
  // Disposing the whole root fiber closes the database handle, which is what
  // makes the second context a genuine restart rather than a second reader.
  return { ctx, close: () => fiber.dispose() }
}

describe('a pasted string plays music, later', () => {
  it('caches what it searched, and plays it after a restart', async () => {
    const root = await tempDir('bbebee-roundtrip')
    searches = 0

    const { ctx: first, close: closeFirst } = await app(root, [document()])
    const changed: { kind: UrnKind; urns: string[] }[] = []
    first.on('library/changed', (kind, urns) => void changed.push({ kind, urns }))

    const found = await first.sources.searchAll({ text: 'björk' })
    const entry = found.bySource[0]!
    expect(entry.error, 'the search itself must succeed').toBeUndefined()
    expect(entry.result?.tracks?.items).toHaveLength(2)
    await tick()

    // ── the rows reached the catalogue ────────────────────────────────────
    const rows = await first.db.query<{ urn: string; title: string; raw_json: string | null }>(
      'SELECT urn, title, raw_json FROM tracks ORDER BY urn',
    )
    expect(rows.map((r) => r.title)).toEqual(['Jóga', 'Bachelorette'])
    expect(
      rows.every((r) => r.raw_json !== null),
      'every cached track carries the payload ruleStream will need',
    ).toBe(true)

    // The indexer and every library count listen for this.
    expect(changed.some((c) => c.kind === 'track' && c.urns.length === 2)).toBe(true)

    const urn = rows.find((r) => r.title === 'Jóga')!.urn
    await closeFirst()

    // ── restart: a new context over the same file ─────────────────────────
    const searchesBefore = searches
    const { ctx: second, close: closeSecond } = await app(root)

    expect(second.sources.sources, 'the imported source is still there').toHaveLength(1)
    const provider = second.sources.providers[0]!
    const handle = await provider.resolveStream(urn.split(':').pop()!, PREFS)

    expect(handle.kind).toBe('remote')
    // `format=flac` can only have come from `$.suffix`, which lives nowhere
    // but the stored payload — proof the round trip went through the disk.
    expect(handle.target).toContain('id=s1')
    expect(handle.target).toContain('format=flac')
    expect(searches, 'resolution never re-runs a search').toBe(searchesBefore)

    // ── and the cached rows are searchable without the network ────────────
    const offline = await second.sources.searchLocal('jóga')
    expect(
      offline.tracks?.items.map((t) => t.title),
      'the FTS index was built from the cache write',
    ).toEqual(['Jóga'])
    expect(searches, 'a local search asks no backend anything').toBe(searchesBefore)

    await closeSecond()
  })

  it('keeps a payload when a later search comes back without one', async () => {
    /*
     * A re-cache must not be able to make a track *less* playable. Overwriting
     * `raw_json` unconditionally would mean any code path that writes a track
     * without a payload — an album listing, a playlist, a library sync —
     * silently unplays every track it touched.
     */
    const root = await tempDir('bbebee-roundtrip-keep')
    const { ctx, close } = await app(root, [document()])
    await ctx.sources.searchAll({ text: 'björk' })
    await tick()

    const before = await ctx.db.get<{ raw_json: string | null; urn: string }>(
      "SELECT urn, raw_json FROM tracks WHERE title = 'Jóga'",
    )
    expect(before?.raw_json).toBeTruthy()

    const { cacheEntities } = await import('@bbebee/plugin-sources')
    await cacheEntities(ctx.db, ctx.sources.sources[0]!.id, {
      tracks: [{ urn: before!.urn, title: 'Jóga', artists: [] }],
    })

    const after = await ctx.db.get<{ raw_json: string | null }>(
      'SELECT raw_json FROM tracks WHERE urn = ?',
      [before!.urn],
    )
    expect(after?.raw_json).toBe(before?.raw_json)
    await close()
  })
})

describe('a browsed track plays, later', () => {
  it('caches the leaves of a descent, and plays one after a restart', async () => {
    /*
     * The same round trip as search, by the other route in. It is a separate
     * test because it was a separate hole: `browse` returned entries and
     * nothing wrote them, so a track found by browsing played until the app
     * was closed and then could not be resolved at all.
     */
    const root = await tempDir('bbebee-browse-roundtrip')
    albumFetches = 0

    const { ctx: first, close: closeFirst } = await app(root, [document()])
    const sourceId = first.sources.sources[0]!.id

    const sections = await first.sources.browse(sourceId)
    expect(sections.items.map((i) => i.title)).toEqual(['Albums'])

    const albums = await first.sources.browse(sourceId, sections.items[0]!.id)
    expect(albums.items[0]).toMatchObject({ title: 'Homogenic', kind: 'album' })
    // An album is both: somewhere to descend into, *and* something with an
    // identity worth caching — its payload carries the childUrl getAlbum needs.
    expect(albums.items[0]!.leaf, 'somewhere to go').toBe(false)
    expect(albums.items[0]!.urn, 'and something to remember').toBe(
      `BBeBee:${sourceId}:album:a1`,
    )

    const songs = await first.sources.browse(sourceId, albums.items[0]!.id)
    expect(songs.items.map((i) => i.title)).toEqual(['Jóga', 'Bachelorette'])
    await tick()

    const rows = await first.db.query<{ urn: string; raw_json: string | null }>(
      'SELECT urn, raw_json FROM tracks ORDER BY urn',
    )
    expect(rows, 'the leaves were cached; the folders were not').toHaveLength(2)
    expect(rows.every((r) => r.raw_json !== null)).toBe(true)

    const urn = songs.items[0]!.urn!
    await closeFirst()

    const fetchesBefore = albumFetches
    const { ctx: second, close: closeSecond } = await app(root)
    const handle = await second.sources.providers[0]!.resolveStream(urn.split(':').pop()!, PREFS)

    expect(handle.target).toContain('id=s1')
    expect(handle.target, 'from $.suffix, which lives only in the payload').toContain('format=flac')
    expect(albumFetches, 'resolution never re-walks the tree').toBe(fetchesBefore)

    await closeSecond()
  })

  it('refuses to browse a source that cannot', async () => {
    // The capability is derived and visible, so a caller reaching this ignored
    // it; naming the source beats a stack trace from inside a provider.
    const root = await tempDir('bbebee-browse-cannot')
    const doc = document()
    delete (doc as Record<string, unknown>).exploreUrl
    const { ctx, close } = await app(root, [doc])

    await expect(ctx.sources.browse(ctx.sources.sources[0]!.id)).rejects.toThrow(/cannot browse/)
    await close()
  })
})
