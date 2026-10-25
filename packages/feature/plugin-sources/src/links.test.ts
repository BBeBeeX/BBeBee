/**
 * Recognising the same recording across sources.
 *
 * The behaviour under test is mostly about *restraint*: what the linker
 * refuses to do. A confident merge on a bad guess makes a user's library wrong
 * in a way they cannot see and cannot undo, so the tests are weighted towards
 * the cases where a naive matcher would over-reach.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { DbService, Track } from '@BBeBee/protocol'
import plugin from './index.js'
import { cacheEntities } from './cache.js'
import { linkManually, linkTracks, linksFor, unlink } from './links.js'

const NAV = 'nav-0001'
const JELLY = 'jelly-0002'

async function fixture(): Promise<{ db: DbService; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-links') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()

  const now = Date.now()
  for (const id of [NAV, JELLY]) {
    await ctx.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, `https://${id}.example`, id, '{}', id, now, now],
    )
  }
  return { db: ctx.db, ctx }
}

const track = (sourceId: string, id: string, over: Partial<Track> = {}): Track => ({
  urn: `BBeBee:${sourceId}:track:${id}`,
  title: 'Jóga',
  artists: [],
  ...over,
})

describe('exact identifiers', () => {
  it('links two sources that report the same ISRC', async () => {
    const { db } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await cacheEntities(db, JELLY, {
      tracks: [track(JELLY, 'b7', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    const links = await linksFor(db, `BBeBee:${NAV}:track:a1`)
    expect(links).toEqual([
      { urn: `BBeBee:${JELLY}:track:b7`, confidence: 1, method: 'isrc' },
    ])
  })

  it('sees through the two spellings of an ISRC', async () => {
    // `GB-AYE-75-00001` and `GBAYE7500001` are the same code, and two rows
    // that never match each other is the whole failure.
    const { db } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GB-AYE-75-00001' } })],
    })
    await cacheEntities(db, JELLY, {
      tracks: [track(JELLY, 'b7', { externalIds: { isrc: 'gbaye7500001' } })],
    })
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toHaveLength(1)
  })

  it('links on a MusicBrainz id too', async () => {
    const { db } = await fixture()
    const mbid = 'f0a1b2c3-0000-4000-8000-000000000001'
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1', { externalIds: { mbid } })] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7', { externalIds: { mbid } })] })
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect((await linksFor(db, `BBeBee:${NAV}:track:a1`))[0]?.method).toBe('mbid')
  })

  it('does not link two tracks that merely share a title', async () => {
    // Live versions, remasters and radio edits share titles and artists. An
    // identifier is evidence; a title is not.
    const { db } = await fixture()
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('does not link a track to itself', async () => {
    const { db } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await linkTracks(db, [`BBeBee:${NAV}:track:a1`])
    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('is idempotent, so re-caching does not multiply links', async () => {
    const { db } = await fixture()
    for (const source of [NAV, JELLY]) {
      await cacheEntities(db, source, {
        tracks: [track(source, 'x', { externalIds: { isrc: 'GBAYE7500001' } })],
      })
    }
    await linkTracks(db, [`BBeBee:${JELLY}:track:x`])
    await linkTracks(db, [`BBeBee:${JELLY}:track:x`])
    await linkTracks(db, [`BBeBee:${NAV}:track:x`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:x`)).toHaveLength(1)
  })
})

describe('what the user said', () => {
  it('records a manual link at full confidence', async () => {
    const { db } = await fixture()
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })
    await linkManually(db, `BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)

    expect((await linksFor(db, `BBeBee:${NAV}:track:a1`))[0]).toMatchObject({
      method: 'manual',
      confidence: 1,
    })
  })

  it('is never overwritten by a later automatic match', async () => {
    /*
     * A user who said "these are the same" has more information than any
     * matcher. An automated pass that demoted their answer would be undoing
     * work they cannot see was undone.
     */
    const { db } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await cacheEntities(db, JELLY, {
      tracks: [track(JELLY, 'b7', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await linkManually(db, `BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect((await linksFor(db, `BBeBee:${NAV}:track:a1`))[0]?.method).toBe('manual')
  })

  it('can be undone', async () => {
    const { db } = await fixture()
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })
    await linkManually(db, `BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)
    await unlink(db, `BBeBee:${JELLY}:track:b7`, `BBeBee:${NAV}:track:a1`)

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })
})

describe('the relation itself', () => {
  it('reads the same from either end', async () => {
    // Stored once with a CHECK keeping `urn_a < urn_b`, so the two directions
    // cannot disagree — but only if the read looks at both columns.
    const { db } = await fixture()
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })
    await linkManually(db, `BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toHaveLength(1)
    expect(await linksFor(db, `BBeBee:${JELLY}:track:b7`)).toHaveLength(1)
  })

  it('orders the best evidence first', async () => {
    const { db } = await fixture()
    const third = 'third-0003'
    await db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [third, `https://${third}.example`, third, '{}', third, Date.now(), Date.now()],
    )
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })
    await cacheEntities(db, third, { tracks: [track(third, 'c9')] })

    await linkManually(db, `BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)
    await db.exec(
      `INSERT INTO track_links (urn_a, urn_b, confidence, method, created_at)
       VALUES (?, ?, 0.8, 'fuzzy', ?)`,
      ...[[`BBeBee:${NAV}:track:a1`, `BBeBee:${third}:track:c9`, Date.now()].sort() as never],
    )

    const links = await linksFor(db, `BBeBee:${NAV}:track:a1`)
    expect(links[0]?.confidence).toBe(1)
  })
})

describe('through the service', () => {
  it('reads links, and lets the user make and unmake one', async () => {
    // `ctx.sources` is what a shell talks to; the linker is an implementation
    // detail it should never have to import.
    const { db, ctx } = await fixture()
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7')] })

    expect(await ctx.sources.linksFor(`BBeBee:${NAV}:track:a1`)).toEqual([])

    await ctx.sources.link(`BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)
    expect(await ctx.sources.linksFor(`BBeBee:${NAV}:track:a1`)).toEqual([
      { urn: `BBeBee:${JELLY}:track:b7`, confidence: 1, method: 'manual' },
    ])

    await ctx.sources.unlink(`BBeBee:${NAV}:track:a1`, `BBeBee:${JELLY}:track:b7`)
    expect(await ctx.sources.linksFor(`BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('links a cached search result to what the catalogue already had', async () => {
    /*
     * The real path: a track arrives from a search, is cached, and is linked
     * on the way past — over the URNs just written, not over the library.
     */
    const { db, ctx } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GBAYE7500001' } })],
    })

    const cached = await cacheEntities(db, JELLY, {
      tracks: [track(JELLY, 'b7', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await linkTracks(db, cached.trackUrns)

    expect(await ctx.sources.linksFor(`BBeBee:${NAV}:track:a1`)).toEqual([
      { urn: `BBeBee:${JELLY}:track:b7`, confidence: 1, method: 'isrc' },
    ])
  })
})

describe('ordering that agrees with the constraint', () => {
  it('links a pair whose ids order differently in JS and SQLite', async () => {
    /*
     * ⚠️ `CHECK (urn_a < urn_b)` uses SQLite's BINARY collation — UTF-8 bytes
     * — while JavaScript's `<` compares UTF-16 code units. They disagree above
     * the BMP, and an emoji in a track id is enough: the pair was rejected,
     * the INSERT threw inside the cache write, and the whole batch lost its
     * `library/changed` emit and therefore its FTS indexing.
     */
    const { db } = await fixture()
    const isrc = { isrc: 'GBAYE7500001' }
    await cacheEntities(db, NAV, { tracks: [track(NAV, '\u{1F600}', { externalIds: isrc })] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, '�', { externalIds: isrc })] })

    await expect(linkTracks(db, [`BBeBee:${JELLY}:track:�`])).resolves.toBeGreaterThan(0)
    expect(await linksFor(db, `BBeBee:${NAV}:track:\u{1F600}`)).toHaveLength(1)
  })

  it('unlinks the same pair it linked', async () => {
    const { db } = await fixture()
    const a = `BBeBee:${NAV}:track:\u{1F600}`
    const b = `BBeBee:${JELLY}:track:�`
    await cacheEntities(db, NAV, { tracks: [track(NAV, '\u{1F600}')] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, '�')] })

    await linkManually(db, a, b)
    expect(await linksFor(db, a)).toHaveLength(1)
    await unlink(db, a, b)
    expect(await linksFor(db, a)).toEqual([])
  })
})

describe('removing a source', () => {
  it('takes its identity rows with it', async () => {
    /*
     * ⚠️ `external_ids` and `track_links` key on a URN by value, so the FK
     * cascade never reaches them. Left behind, a removed source's ISRCs keep
     * matching — the *next* source imported gets linked to tracks that do not
     * exist, and "also available on…" offers a failover to nothing.
     */
    const { db, ctx } = await fixture()
    const isrc = { isrc: 'GBAYE7500001' }
    await cacheEntities(db, NAV, { tracks: [track(NAV, 'a1', { externalIds: isrc })] })
    await cacheEntities(db, JELLY, { tracks: [track(JELLY, 'b7', { externalIds: isrc })] })
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    await ctx.sources.remove(NAV, { forgetCatalogue: true })

    expect(await db.query('SELECT * FROM external_ids'), 'no ghost identifiers').toHaveLength(1)
    expect(await db.query('SELECT * FROM track_links'), 'no ghost links').toHaveLength(0)
  })

  it('leaves them alone when the catalogue is kept', async () => {
    // Removing a source without forgetting its catalogue is how a user
    // disables a backend but keeps what it found.
    const { db, ctx } = await fixture()
    await cacheEntities(db, NAV, {
      tracks: [track(NAV, 'a1', { externalIds: { isrc: 'GBAYE7500001' } })],
    })
    await ctx.sources.remove(NAV)
    expect(await db.query('SELECT * FROM external_ids')).toHaveLength(1)
  })
})

describe('identifiers that would poison matching', () => {
  const cache = async (db: Awaited<ReturnType<typeof fixture>>['db'], source: string, id: string, isrc: string) =>
    cacheEntities(db, source, { tracks: [track(source, id, { externalIds: { isrc } })] })

  it('drops an identifier that normalises to nothing', async () => {
    /*
     * `isrc: "???"` normalises to `''`, and every such row then matches every
     * other one — at confidence 1.00, the score that means "certainly the same
     * recording".
     */
    const { db } = await fixture()
    await cache(db, NAV, 'a1', '???')
    await cache(db, JELLY, 'b7', '!!!')
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await db.query('SELECT * FROM external_ids')).toHaveLength(0)
    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('drops the all-zero placeholder taggers write into whole libraries', async () => {
    // Measured: twenty-four tracks sharing one produced 276 links.
    const { db } = await fixture()
    await cache(db, NAV, 'a1', '000000000000')
    await cache(db, JELLY, 'b7', '000000000000')
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('drops something that is not an ISRC at all', async () => {
    const { db } = await fixture()
    await cache(db, NAV, 'a1', 'unknown')
    await cache(db, JELLY, 'b7', 'unknown')
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toEqual([])
  })

  it('still links a well-formed one', async () => {
    // The guard must not cost the case it exists to protect.
    const { db } = await fixture()
    await cache(db, NAV, 'a1', 'GB-AYE-75-00001')
    await cache(db, JELLY, 'b7', 'GBAYE7500001')
    await linkTracks(db, [`BBeBee:${JELLY}:track:b7`])

    expect(await linksFor(db, `BBeBee:${NAV}:track:a1`)).toHaveLength(1)
  })

  it('drops a malformed MusicBrainz id', async () => {
    const { db } = await fixture()
    for (const source of [NAV, JELLY]) {
      await cacheEntities(db, source, {
        tracks: [track(source, 'x', { externalIds: { mbid: 'not-a-uuid' } })],
      })
    }
    await linkTracks(db, [`BBeBee:${JELLY}:track:x`])
    expect(await linksFor(db, `BBeBee:${NAV}:track:x`)).toEqual([])
  })
})

describe('a link failure never costs the batch', () => {
  it('still announces the tracks when linking throws', async () => {
    /*
     * ⚠️ Linking is a *relationship* problem; the rows are already written. It
     * shared the cache write's catch, so one bad pair swallowed
     * `library/changed` for the whole batch — fifty good tracks silently never
     * reached the FTS index and could not be found by search.
     */
    const { db, ctx } = await fixture()
    const changed: string[] = []
    ctx.on('library/changed', (kind, urns) => {
      if (kind === 'track') changed.push(...urns)
    })

    // A track already in the catalogue sharing the ISRC, so a link really is
    // attempted — without a match there is nothing to fail on.
    await cacheEntities(db, JELLY, {
      tracks: [track(JELLY, 'b9', { externalIds: { isrc: 'GBAYE7500002' } })],
    })

    // Break linking specifically, leaving the track write intact.
    await db.exec('DROP TABLE track_links')

    ctx.sources.register({
      sourceId: NAV,
      displayName: 'Nav',
      capabilities: { search: { tracks: true, albums: false, artists: false, playlists: false } },
      auth: { flow: { kind: 'none' } },
      search: async () => ({
        tracks: {
          items: [track(NAV, 'a2', { externalIds: { isrc: 'GBAYE7500002' } })],
          hasMore: false,
        },
      }),
    } as never)

    const found = await ctx.sources.searchAll({ text: 'x' })
    expect(found.bySource[0]?.error, 'the search itself is unaffected').toBeUndefined()
    await tick()

    expect(changed, 'the rows were written and announced').toContain(`BBeBee:${NAV}:track:a2`)
    expect(
      await db.query('SELECT urn FROM tracks WHERE remote_id = ?', ['a2']),
      'and they really are in the catalogue',
    ).toHaveLength(1)
  })
})
