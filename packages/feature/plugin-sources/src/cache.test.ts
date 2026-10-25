/**
 * The write half of the catalogue.
 *
 * Most of these are about what a *second* write does. The first one is easy;
 * the failure mode that matters is a re-cache that makes the catalogue worse
 * than it was — a known year replaced by null, a payload erased, a real album
 * title flattened by a stub — because that degrades the more the app is used
 * and never announces itself.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { DbService, Track } from '@BBeBee/protocol'
import plugin from './index.js'
import { MAX_PAYLOAD_BYTES, cacheEntities } from './cache.js'

const SOURCE = 'music-example-org-35be9fe2'
const OTHER = 'other-source-0000'

async function fixture(): Promise<DbService> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-cache') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()

  const now = Date.now()
  for (const id of [SOURCE, OTHER]) {
    await ctx.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, `https://${id}.example`, id, '{}', id, now, now],
    )
  }
  return ctx.db
}

const track = (over: Partial<Track> = {}): Track => ({
  urn: `BBeBee:${SOURCE}:track:s1`,
  title: 'Jóga',
  artists: [
    { urn: `BBeBee:${SOURCE}:artist:bjork`, name: 'Björk', role: 'main', ordinal: 0 },
  ],
  ...over,
})

describe('writing tracks', () => {
  it('stores the row and reports the urn', async () => {
    const db = await fixture()
    const written = await cacheEntities(db, SOURCE, { tracks: [track()] })

    expect(written.trackUrns).toEqual([`BBeBee:${SOURCE}:track:s1`])
    const row = await db.get<{ title: string; remote_id: string; sort_title: string }>(
      'SELECT title, remote_id, sort_title FROM tracks',
    )
    expect(row).toMatchObject({ title: 'Jóga', remote_id: 's1' })
  })

  it('files the sort key the way the scanner does', async () => {
    // Two writers with two collations put "The Beatles" in two places in one
    // list, which is why the function lives in the protocol.
    const db = await fixture()
    await cacheEntities(db, SOURCE, { tracks: [track({ title: 'The Bends' })] })
    const row = await db.get<{ sort_title: string }>('SELECT sort_title FROM tracks')
    expect(row?.sort_title).toBe('bends')
  })

  it('writes artist credits as a join, with the role', async () => {
    const db = await fixture()
    await cacheEntities(db, SOURCE, { tracks: [track()] })
    const credits = await db.query<{ artist_urn: string; role: string; ordinal: number }>(
      'SELECT artist_urn, role, ordinal FROM track_artists',
    )
    expect(credits).toEqual([
      { artist_urn: `BBeBee:${SOURCE}:artist:bjork`, role: 'main', ordinal: 0 },
    ])
  })

  it('replaces credits rather than accumulating them', async () => {
    // A backend that dropped a featured artist means the credit is gone. A
    // merge would keep it for ever with nothing able to remove it.
    const db = await fixture()
    await cacheEntities(db, SOURCE, {
      tracks: [track({
        artists: [
          { urn: `BBeBee:${SOURCE}:artist:bjork`, name: 'Björk', role: 'main', ordinal: 0 },
          { urn: `BBeBee:${SOURCE}:artist:guest`, name: 'Guest', role: 'featured', ordinal: 1 },
        ],
      })],
    })
    await cacheEntities(db, SOURCE, { tracks: [track()] })

    const credits = await db.query<{ artist_urn: string }>('SELECT artist_urn FROM track_artists')
    expect(credits).toHaveLength(1)
  })

  it('creates the album row a track references', async () => {
    // `album_urn` is a foreign key, and a search returns tracks naming an
    // album it did not also return.
    const db = await fixture()
    await cacheEntities(db, SOURCE, {
      tracks: [track({ albumUrn: `BBeBee:${SOURCE}:album:a1`, albumTitle: 'Homogenic' })],
    })
    const album = await db.get<{ title: string }>('SELECT title FROM albums')
    expect(album?.title).toBe('Homogenic')
  })
})

describe('a second write must not make the catalogue worse', () => {
  it('keeps a payload when the new result has none', async () => {
    const db = await fixture()
    await cacheEntities(db, SOURCE, {
      tracks: [track()],
      payloads: { [`BBeBee:${SOURCE}:track:s1`]: { id: 's1', suffix: 'flac' } },
    })
    await cacheEntities(db, SOURCE, { tracks: [track()] })

    const row = await db.get<{ raw_json: string }>('SELECT raw_json FROM tracks')
    expect(JSON.parse(row!.raw_json)).toEqual({ id: 's1', suffix: 'flac' })
  })

  it('replaces a payload when the new result has a fresher one', async () => {
    // The other half: a re-search carries a fresher stream token, and keeping
    // the stale one would be the same bug pointing the other way.
    const db = await fixture()
    const urn = `BBeBee:${SOURCE}:track:s1`
    await cacheEntities(db, SOURCE, { tracks: [track()], payloads: { [urn]: { token: 'old' } } })
    await cacheEntities(db, SOURCE, { tracks: [track()], payloads: { [urn]: { token: 'new' } } })

    const row = await db.get<{ raw_json: string }>('SELECT raw_json FROM tracks')
    expect(JSON.parse(row!.raw_json)).toEqual({ token: 'new' })
  })

  it('keeps a year the new result does not carry', async () => {
    const db = await fixture()
    await cacheEntities(db, SOURCE, { tracks: [track({ year: 1997 })] })
    await cacheEntities(db, SOURCE, { tracks: [track()] })
    const row = await db.get<{ year: number | null }>('SELECT year FROM tracks')
    expect(row?.year).toBe(1997)
  })

  it('does not let a stub album title overwrite a real one', async () => {
    const db = await fixture()
    const albumUrn = `BBeBee:${SOURCE}:album:a1`
    await cacheEntities(db, SOURCE, {
      albums: [{ urn: albumUrn, title: 'Homogenic', artists: [], year: 1997 }],
    })
    // A track whose result carried no album title writes a stub.
    await cacheEntities(db, SOURCE, { tracks: [track({ albumUrn })] })

    const album = await db.get<{ title: string; year: number | null }>(
      'SELECT title, year FROM albums',
    )
    expect(album).toMatchObject({ title: 'Homogenic', year: 1997 })
  })
})

describe('what it refuses to write', () => {
  it('skips a track urn belonging to another source', async () => {
    /*
     * A provider cannot forge one — the runtime builds every URN from its own
     * record — but this is the layer where a bug in one source would
     * overwrite another's rows, silently and with no way to attribute it.
     */
    const db = await fixture()
    const written = await cacheEntities(db, SOURCE, {
      tracks: [track({ urn: `BBeBee:${OTHER}:track:s1` }), track()],
    })

    expect(written.trackUrns).toEqual([`BBeBee:${SOURCE}:track:s1`])
    const rows = await db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(rows, 'the foreign row was skipped, the good one kept').toHaveLength(1)
  })

  it('skips an artist credit belonging to another source', async () => {
    const db = await fixture()
    await cacheEntities(db, SOURCE, {
      tracks: [track({
        artists: [{ urn: `BBeBee:${OTHER}:artist:x`, name: 'X', role: 'main', ordinal: 0 }],
      })],
    })
    expect(await db.query('SELECT * FROM track_artists')).toHaveLength(0)
    expect(await db.query('SELECT * FROM tracks'), 'the track itself still lands').toHaveLength(1)
  })

  it('drops an oversized payload rather than storing half of one', async () => {
    // Half a JSON document is not a JSON document, and storing one fails to
    // parse later at a point with no way to explain itself.
    const db = await fixture()
    const urn = `BBeBee:${SOURCE}:track:s1`
    await cacheEntities(db, SOURCE, {
      tracks: [track()],
      payloads: { [urn]: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) } },
    })
    const row = await db.get<{ raw_json: string | null }>('SELECT raw_json FROM tracks')
    expect(row?.raw_json).toBeNull()
  })

  it('drops a payload that cannot be serialised at all', async () => {
    const db = await fixture()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(
      cacheEntities(db, SOURCE, {
        tracks: [track()],
        payloads: { [`BBeBee:${SOURCE}:track:s1`]: circular },
      }),
      'a provider bug degrades playback; it does not fail the search',
    ).resolves.toBeDefined()
  })

  it('writes nothing, and touches no transaction, for an empty result', async () => {
    const db = await fixture()
    expect(await cacheEntities(db, SOURCE, {})).toEqual({ trackUrns: [], albumUrns: [] })
  })
})

describe('artwork a listing carried', () => {
  it('creates the row its foreign key points at', async () => {
    /*
     * ⚠️ `tracks.artwork_id` is a foreign key, so writing one for artwork
     * nobody registered fails the *whole* transaction — and a cache failure is
     * caught and logged, so a source whose listings carry cover URLs silently
     * cached nothing at all. Found by the first fixture with artwork in its
     * list rule.
     */
    const db = await fixture()
    const written = await cacheEntities(db, SOURCE, {
      tracks: [
        track({ artwork: { id: 'https://cdn.example/a.jpg', sourceUrl: 'https://cdn.example/a.jpg' } }),
      ],
    })

    expect(written.trackUrns, 'the write went through').toHaveLength(1)
    const row = await db.get<{ artwork_id: string }>('SELECT artwork_id FROM tracks')
    expect(row?.artwork_id).toBe('https://cdn.example/a.jpg')
    const art = await db.get<{ source_url: string }>('SELECT source_url FROM artworks')
    expect(art?.source_url).toBe('https://cdn.example/a.jpg')
  })

  it('keeps an album’s artwork rather than dropping it', async () => {
    const db = await fixture()
    await cacheEntities(db, SOURCE, {
      albums: [
        {
          urn: `BBeBee:${SOURCE}:album:a1`,
          title: 'Homogenic',
          artists: [],
          artwork: { id: 'art-1', sourceUrl: 'https://cdn.example/cover.jpg' },
        },
      ],
    })
    const row = await db.get<{ artwork_id: string }>('SELECT artwork_id FROM albums')
    expect(row?.artwork_id).toBe('art-1')
  })

  it('does not re-register artwork it already knows', async () => {
    const db = await fixture()
    const artwork = { id: 'art-1', sourceUrl: 'https://cdn.example/cover.jpg' }
    await cacheEntities(db, SOURCE, { tracks: [track({ artwork })] })
    await cacheEntities(db, SOURCE, { tracks: [track({ artwork })] })
    expect(await db.query('SELECT id FROM artworks')).toHaveLength(1)
  })
})
