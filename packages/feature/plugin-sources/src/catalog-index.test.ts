/**
 * The batched FTS index.
 *
 * `Catalog.index` used to run four statements per track; it now indexes a
 * whole batch in a constant handful of statements. These tests pin the
 * semantics the batching must preserve: rowid stability across re-indexing,
 * cleanup of gone tracks, and tolerance of duplicates/empties.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { DbService } from '@BBeBee/protocol'
import { Catalog } from './catalog.js'

async function fixture(): Promise<{ db: DbService; catalog: Catalog }> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-catalog-index') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:', skipCoreMigrations: true })
  await tick()
  const db = ctx.db as DbService

  await db.exec(`CREATE TABLE artists (urn TEXT PRIMARY KEY, name TEXT NOT NULL)`)
  await db.exec(`CREATE TABLE albums (urn TEXT PRIMARY KEY, title TEXT NOT NULL)`)
  await db.exec(
    `CREATE TABLE tracks (
       urn TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       album_urn TEXT REFERENCES albums(urn)
     )`,
  )
  await db.exec(
    `CREATE TABLE track_artists (
       track_urn TEXT NOT NULL,
       artist_urn TEXT NOT NULL REFERENCES artists(urn),
       ordinal INTEGER NOT NULL DEFAULT 0
     )`,
  )
  await db.exec(
    `CREATE VIRTUAL TABLE tracks_fts USING fts5(
       title, artist_names, album_title,
       content='', contentless_delete=1,
       tokenize='unicode61 remove_diacritics 2'
     )`,
  )
  await db.exec(
    `CREATE TABLE tracks_fts_map (
       rowid INTEGER PRIMARY KEY AUTOINCREMENT,
       urn   TEXT NOT NULL UNIQUE
     )`,
  )

  await db.exec(`INSERT INTO artists (urn, name) VALUES ('a:bjork', 'Björk')`)
  await db.exec(`INSERT INTO albums (urn, title) VALUES ('al:homogenic', 'Homogenic')`)
  const tracks: [string, string, string | null][] = [
    ['t:joga', 'Jóga', 'al:homogenic'],
    ['t:hunter', 'Hunter', 'al:homogenic'],
    ['t:xtal', 'Xtal', null],
  ]
  for (const [urn, title, albumUrn] of tracks) {
    await db.exec(`INSERT INTO tracks (urn, title, album_urn) VALUES (?, ?, ?)`, [urn, title, albumUrn])
    await db.exec(`INSERT INTO track_artists (track_urn, artist_urn, ordinal) VALUES (?, ?, 0)`, [
      urn,
      'a:bjork',
    ])
  }

  return { db, catalog: new Catalog(db) }
}

async function ftsHits(db: DbService, term: string): Promise<string[]> {
  const rows = await db.query<{ urn: string }>(
    `SELECT m.urn AS urn FROM tracks_fts f
       JOIN tracks_fts_map m ON m.rowid = f.rowid
      WHERE tracks_fts MATCH ?`,
    [term],
  )
  return rows.map((r) => r.urn).sort()
}

describe('catalog.index (batched)', () => {
  it('indexes a batch so every track is searchable', async () => {
    const { db, catalog } = await fixture()
    await catalog.index(['t:joga', 't:hunter', 't:xtal'])

    expect(await ftsHits(db, 'joga')).toEqual(['t:joga'])
    expect(await ftsHits(db, 'björk')).toEqual(['t:hunter', 't:joga', 't:xtal'])
    expect(await ftsHits(db, 'homogenic')).toEqual(['t:hunter', 't:joga'])
  })

  it('keeps rowids stable across re-indexing (no duplicate hits)', async () => {
    const { db, catalog } = await fixture()
    await catalog.index(['t:joga', 't:hunter'])
    const before = await db.query<{ urn: string; rowid: number }>(
      `SELECT urn, rowid FROM tracks_fts_map ORDER BY urn`,
    )

    // Rename the track, then re-index: same rowid, one hit, new title.
    await db.exec(`UPDATE tracks SET title = 'Jóga (Remaster)' WHERE urn = 't:joga'`)
    await catalog.index(['t:joga'])

    const after = await db.query<{ urn: string; rowid: number }>(
      `SELECT urn, rowid FROM tracks_fts_map ORDER BY urn`,
    )
    expect(after).toEqual(before)
    expect(await ftsHits(db, 'remaster')).toEqual(['t:joga'])
    expect(await ftsHits(db, 'joga')).toEqual(['t:joga'])
  })

  it('drops the index entry when the track row is gone', async () => {
    const { db, catalog } = await fixture()
    await catalog.index(['t:joga', 't:xtal'])
    expect(await ftsHits(db, 'xtal')).toEqual(['t:xtal'])

    await db.exec(`DELETE FROM tracks WHERE urn = 't:xtal'`)
    await catalog.index(['t:xtal'])

    expect(await ftsHits(db, 'xtal')).toEqual([])
    const map = await db.query(`SELECT urn FROM tracks_fts_map WHERE urn = 't:xtal'`)
    expect(map).toEqual([])
    // The surviving track is untouched.
    expect(await ftsHits(db, 'joga')).toEqual(['t:joga'])
  })

  it('tolerates duplicates and empty input', async () => {
    const { db, catalog } = await fixture()
    await catalog.index([])
    await catalog.index(['t:joga', 't:joga', 't:hunter'])

    expect(await ftsHits(db, 'joga')).toEqual(['t:joga'])
    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tracks_fts_map WHERE urn = 't:joga'`,
    )
    expect(count?.n).toEqual(1)
  })

  it('indexes urns unknown to the map but missing from tracks as a no-op', async () => {
    const { db, catalog } = await fixture()
    await catalog.index(['t:nope'])
    expect(await ftsHits(db, 'nope')).toEqual([])
    expect(await db.query(`SELECT * FROM tracks_fts_map`)).toEqual([])
  })
})
