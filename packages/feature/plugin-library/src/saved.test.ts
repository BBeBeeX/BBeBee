/**
 * Favorites: one row per URN, pinned rows first, and a re-save that does not
 * reorder the shelf.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

const TRACK = 'BBeBee:demo:track:one'
const ALBUM = 'BBeBee:demo:album:first'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-library-saved') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin)
  await tick()
  return { ctx, library: ctx.library }
}

describe('saved items', () => {
  it('saves, unsaves and answers isSaved', async () => {
    const { library } = await harness()
    expect(await library.isSaved(TRACK)).toBe(false)

    await library.setSaved(TRACK, true)
    expect(await library.isSaved(TRACK)).toBe(true)

    await library.setSaved(TRACK, false)
    expect(await library.isSaved(TRACK)).toBe(false)
  })

  it('keeps the original addedAt when the same URN is saved twice', async () => {
    const { ctx, library } = await harness()
    await library.setSaved(ALBUM, true)
    const first = await ctx.db.get<{ added_at: number }>(
      'SELECT added_at FROM library_items WHERE urn = ?',
      [ALBUM],
    )

    await library.setSaved(ALBUM, true)
    const second = await ctx.db.get<{ added_at: number }>(
      'SELECT added_at FROM library_items WHERE urn = ?',
      [ALBUM],
    )
    expect(second?.added_at).toBe(first?.added_at)
  })

  it('lists newest first, pinned first, and filters by kind', async () => {
    const { library } = await harness()
    await library.setSaved(TRACK, true)
    await library.setSaved(ALBUM, true)
    await library.setPinned(TRACK, true)

    const all = await library.listSaved()
    expect(all.items.map((entry) => entry.urn)).toEqual([TRACK, ALBUM])
    expect(all.items[0]!.pinned).toBe(true)

    const albums = await library.listSaved('album')
    expect(albums.items.map((entry) => entry.urn)).toEqual([ALBUM])
  })

  it('refuses a pin on nothing, and a save of a facet', async () => {
    const { library } = await harness()
    await expect(library.setPinned(TRACK, true)).rejects.toMatchObject({ code: 'not-found' })
    await expect(library.setSaved('BBeBee:demo:genre:rock', true)).rejects.toMatchObject({
      code: 'invalid-urn',
    })
    await expect(library.setSaved('not-a-urn', true)).rejects.toMatchObject({ code: 'invalid-urn' })
  })

  it('emits library/changed with the URN kind it saved', async () => {
    const { ctx, library } = await harness()
    const seen: { kind: string; urns: readonly string[] }[] = []
    ctx.on('library/changed', (kind, urns) => void seen.push({ kind, urns }))

    await library.setSaved(ALBUM, true)
    await library.setSaved(ALBUM, false)

    expect(seen).toEqual([
      { kind: 'album', urns: [ALBUM] },
      { kind: 'album', urns: [ALBUM] },
    ])
  })
})
