/**
 * `plugin-library` as a plugin: it claims its service, reads and writes the
 * curation tables against real SQL, and unloads without leaving a listener or
 * a timer behind.
 *
 * The per-table behaviour is pinned in `playlists.test.ts`, `saved.test.ts`
 * and `collections.test.ts`; this file is the lifecycle and the event
 * contract — the two things every consumer of `ctx.library` depends on
 * regardless of which verb it calls.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { LibraryService } from '@BBeBee/protocol'
import plugin from './index.js'

export async function harness() {
  const ctx = new Context()
  // `ctx.db` is a service that needs `fs` and `paths` before it activates, so
  // the harness loads them exactly as a shell does.
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-library') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  const fiber = await ctx.plugin(plugin)
  await tick()
  return { ctx, fiber, library: ctx.library }
}

describe('plugin-library', () => {
  it('activates and claims ctx.library', async () => {
    const { library } = await harness()
    // Identity comparisons on service objects are unreliable — each access
    // through the tracing proxy is a different object (docs/09 §3). What a
    // consumer depends on is the contract, so that is what is asserted: the
    // protocol's `LibraryService` accepts this service, and it answers.
    const asContract: LibraryService = library
    expect(typeof asContract.setSaved).toBe('function')
    // A fresh library is seeded with one default playlist — the curation page
    // must not open empty.
    expect((await asContract.listPlaylists()).items.map((p) => p.name)).toEqual(['My playlist'])
  })

  it('seeds a local user profile, and renames it', async () => {
    const { library } = await harness()
    const profile = await library.getProfile()
    expect(profile.name).toBe('Mine')
    // A UUID: version 4 nibble and the RFC variant nibble.
    expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    // ensure() is idempotent: the same row comes back, no second insert.
    expect((await library.getProfile()).id).toBe(profile.id)

    const renamed = await library.updateProfile({ name: '  Bee  ' })
    expect(renamed.name).toBe('Bee')
    expect((await library.getProfile()).name).toBe('Bee')
    expect((await library.getProfile()).id).toBe(profile.id)
    await expect(library.updateProfile({ name: '   ' })).rejects.toMatchObject({ code: 'invalid-name' })
  })

  it('emits library/changed for playlist edits and collections-changed for collections', async () => {
    const { ctx, library } = await harness()
    const libraryEvents: { kind: string; urns: readonly string[] }[] = []
    let collections = 0
    ctx.on('library/changed', (kind, urns) => void libraryEvents.push({ kind, urns }))
    ctx.on('library/collections-changed', () => void collections++)

    const playlist = await library.createPlaylist('Road trip')
    await library.updatePlaylist(playlist.urn, { name: 'Long road trip' })
    await library.deletePlaylist(playlist.urn)

    expect(libraryEvents.map((e) => e.kind)).toEqual(['playlist', 'playlist', 'playlist'])
    expect(libraryEvents[0]!.urns).toEqual([playlist.urn])

    await library.createCollection('Shelf')
    expect(collections).toBe(1)
  })

  it('survives a listener that throws, because the row is already written', async () => {
    const { ctx, library } = await harness()
    ctx.on('library/changed', () => {
      throw new Error('a screen blew up')
    })

    const playlist = await library.createPlaylist('Resilient')
    const page = await library.listPlaylists()
    expect(page.items.map((p) => p.urn)).toContain(playlist.urn)
  })
})

describe('plugin-library lifecycle', () => {
  it('snapshots clean after unload', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-library-leak') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
