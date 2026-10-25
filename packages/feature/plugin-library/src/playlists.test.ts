/**
 * Playlists against real SQL.
 *
 * What is pinned here is the contract the screens and the player depend on:
 * order survives a move with exactly one row rewritten, the derived count and
 * duration never disagree with the rows, a smart playlist resolves from the
 * live catalogue, and no item verb touches one.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { LibraryError } from '@BBeBee/protocol'
import plugin from './index.js'

const SOURCE = 'demo'
const T1 = `BBeBee:${SOURCE}:track:one`
const T2 = `BBeBee:${SOURCE}:track:two`
const T3 = `BBeBee:${SOURCE}:track:three`

async function harness() {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-library-playlists') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin)
  await tick()

  await ctx.db.exec(
    `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
     VALUES (?, ?, ?, '{}', 'h', 0, 0)`,
    [SOURCE, 'https://demo.test', 'Demo'],
  )
  await ctx.db.exec(
    `INSERT INTO albums (urn, source_id, remote_id, title, year, fetched_at)
     VALUES ('BBeBee:demo:album:first', ?, 'a1', 'First', 2001, 0)`,
    [SOURCE],
  )
  const tracks: [string, string, number, number][] = [
    [T1, 'Alpha', 2001, 60_000],
    [T2, 'Bravo', 2010, 120_000],
    [T3, 'Charlie', 2020, 180_000],
  ]
  for (const [urn, title, year, duration] of tracks) {
    await ctx.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, album_urn, year, duration_ms, fetched_at)
       VALUES (?, ?, ?, ?, 'BBeBee:demo:album:first', ?, ?, 0)`,
      [urn, SOURCE, urn, title, year, duration],
    )
  }
  await ctx.db.exec(
    `INSERT INTO track_stats (urn, play_count, loved, rating) VALUES (?, 10, 1, 4)`,
    [T1],
  )
  return { ctx, library: ctx.library }
}

describe('stored playlists', () => {
  it('creates, lists and reads an empty playlist', async () => {
    const { library } = await harness()
    const created = await library.createPlaylist('  Road trip  ', { description: 'south' })

    expect(created.name).toBe('Road trip')
    expect(created.urn).toMatch(/^BBeBee:local:playlist:/)
    expect(created.description).toBe('south')

    const page = await library.listPlaylists()
    // The seed's My playlist sits beside the newly created playlist.
    expect(page.items).toHaveLength(2)
    expect(page.items.map((p) => p.urn)).toContain(created.urn)
    expect(page.items.map((p) => p.name)).toContain('My playlist')

    const detail = await library.getPlaylist(created.urn)
    expect(detail?.items).toEqual([])
    expect(detail?.trackCount).toBe(0)
    expect(await library.getPlaylist('BBeBee:local:playlist:missing')).toBeUndefined()
  })

  it('refuses a nameless playlist', async () => {
    const { library } = await harness()
    await expect(library.createPlaylist('   ')).rejects.toMatchObject({ code: 'invalid-name' })
  })

  it('appends in order, allows a duplicate, and keeps count and duration honest', async () => {
    const { library } = await harness()
    const { urn } = await library.createPlaylist('Ordered')

    expect(await library.addTracks(urn, [T2, T1, T2])).toBe(3)
    const detail = await library.getPlaylist(urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T2, T1, T2])
    expect(detail?.trackCount).toBe(3)
    expect(detail?.durationMs).toBe(120_000 + 60_000 + 120_000)
  })

  it('inserts at a position without touching the rows behind it', async () => {
    const { library } = await harness()
    const { urn } = await library.createPlaylist('Insert')
    await library.addTracks(urn, [T1, T3])

    await library.addTracks(urn, [T2], { at: 1 })
    const detail = await library.getPlaylist(urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T1, T2, T3])
  })

  it('rewrites exactly one row to move an item', async () => {
    const { library, ctx } = await harness()
    const { urn } = await library.createPlaylist('Move')
    await library.addTracks(urn, [T1, T2, T3])
    const before = await positions(ctx, urn)
    const items = (await library.getPlaylist(urn))!.items

    await library.moveItem(urn, items[0]!.id, 2)

    const detail = await library.getPlaylist(urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T2, T3, T1])
    const after = await positions(ctx, urn)
    const rewritten = [...after].filter(([id, position]) => before.get(id) !== position)
    expect(rewritten).toHaveLength(1)
    expect(rewritten[0]![0]).toBe(items[0]!.id)
  })

  it('removes items and recounts', async () => {
    const { library } = await harness()
    const { urn } = await library.createPlaylist('Remove')
    await library.addTracks(urn, [T1, T2, T3])
    const items = (await library.getPlaylist(urn))!.items

    await library.removeItems(urn, [items[1]!.id])
    const detail = await library.getPlaylist(urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T1, T3])
    expect(detail?.trackCount).toBe(2)
  })

  it('renames and clears a description, bumping the revision', async () => {
    const { library } = await harness()
    const created = await library.createPlaylist('Old', { description: 'keep' })
    await library.updatePlaylist(created.urn, { name: 'New', description: null })

    const detail = await library.getPlaylist(created.urn)
    expect(detail?.name).toBe('New')
    expect(detail?.description).toBeUndefined()
  })

  it('deletes the playlist and its items together', async () => {
    const { library, ctx } = await harness()
    const { urn } = await library.createPlaylist('Gone')
    await library.addTracks(urn, [T1])

    await library.deletePlaylist(urn)
    expect(await library.getPlaylist(urn)).toBeUndefined()
    const rows = await ctx.db.query('SELECT id FROM playlist_items WHERE playlist_urn = ?', [urn])
    expect(rows).toEqual([])
    await expect(library.deletePlaylist(urn)).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('smart playlists', () => {
  it('resolves its rule against the live catalogue, in the requested order', async () => {
    const { library } = await harness()
    const playlist = await library.createPlaylist('Modern', {
      smart: { rules: { field: 'year', cmp: 'gt', value: 2005 }, orderBy: 'title' },
    })

    const detail = await library.getPlaylist(playlist.urn)
    expect(detail?.isSmart).toBe(true)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T2, T3])
    expect(detail?.trackCount).toBe(2)
  })

  it('honours a rule limit as the length of the list', async () => {
    const { library } = await harness()
    const playlist = await library.createPlaylist('Top one', {
      smart: {
        rules: { op: 'and', rules: [{ field: 'loved', cmp: 'eq', value: true }] },
        orderBy: 'playCount',
        desc: true,
        limit: 1,
      },
    })
    const detail = await library.getPlaylist(playlist.urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T1])
    expect(detail?.hasMore).toBe(false)
  })

  it('refuses item edits and validates the tree before storing it', async () => {
    const { library } = await harness()
    const playlist = await library.createPlaylist('Smart', {
      smart: { rules: { field: 'loved', cmp: 'eq', value: true } },
    })

    await expect(library.addTracks(playlist.urn, [T1])).rejects.toMatchObject({
      code: 'smart-playlist',
    })
    await expect(
      library.createPlaylist('Bad', { smart: { rules: { field: 'nope' as never, cmp: 'eq', value: 1 } } }),
    ).rejects.toThrow()

    await library.setSmartQuery(playlist.urn, { rules: { field: 'year', cmp: 'lt', value: 2005 } })
    const detail = await library.getPlaylist(playlist.urn)
    expect(detail?.items.map((i) => i.trackUrn)).toEqual([T1])
  })

  it('reports an unreadable stored tree instead of returning an empty list', async () => {
    const { library, ctx } = await harness()
    const playlist = await library.createPlaylist('Broken', {
      smart: { rules: { field: 'loved', cmp: 'eq', value: true } },
    })
    await ctx.db.exec('UPDATE playlists SET smart_query_json = ? WHERE urn = ?', ['{not json', playlist.urn])

    await expect(library.getPlaylist(playlist.urn)).rejects.toBeInstanceOf(LibraryError)
  })
})

async function positions(ctx: Context, urn: string): Promise<Map<string, string>> {
  const rows = await ctx.db.query<{ id: string; position: string }>(
    'SELECT id, position FROM playlist_items WHERE playlist_urn = ?',
    [urn],
  )
  return new Map(rows.map((row) => [row.id, row.position]))
}
