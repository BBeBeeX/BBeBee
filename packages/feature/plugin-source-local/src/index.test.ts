/**
 * The local provider, end to end with the real scanner and the real registry.
 *
 * This is the first test in the workspace where the whole Stage 2 stack runs
 * together — scanner writes, `ctx.sources` indexes and reads, the provider
 * answers — which is the point: the seams between them are what M1 is for.
 */

import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import sourcesPlugin from '@bbebee/plugin-sources'
import scannerPlugin from '@bbebee/plugin-local-scanner'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { AudioMetadata, Uri } from '@BBeBee/protocol'
import plugin, { type SourceLocal } from './index.js'

const TAGS: Record<string, AudioMetadata> = {
  'joga.mp3': {
    title: 'Jóga',
    artist: 'Björk',
    albumArtist: 'Björk',
    album: 'Homogenic',
    trackNo: 2,
    year: 1997,
    durationMs: 302_000,
    hasArtwork: false,
  },
  'hunter.mp3': {
    title: 'Hunter',
    artist: 'Björk',
    albumArtist: 'Björk',
    album: 'Homogenic',
    trackNo: 1,
    year: 1997,
    hasArtwork: false,
  },
}

function codecPlugin(dir: string) {
  class CodecFake extends Service {
    constructor(ctx: Context) {
      super(ctx, 'codec')
    }
    async readMetadata(uri: Uri): Promise<AudioMetadata> {
      const name = decodeURIComponent(uri.split('/').pop() ?? '')
      return TAGS[name] ?? { title: name, artist: 'Unknown', hasArtwork: false }
    }
    async readArtwork(): Promise<Uint8Array | undefined> {
      return undefined
    }
    async decode() {
      throw new Error('not needed')
    }
    async probeDuration() {
      return 0
    }
    supportedFormats() {
      return ['mp3']
    }
    readonly dir = dir
  }
  return CodecFake
}

async function harness() {
  const dir = await tempDir('bbebee-local')
  for (const name of Object.keys(TAGS)) await writeFile(join(dir, name), 'audio')
  await writeFile(join(dir, 'readme.txt'), 'not audio')

  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-local-app') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(codecPlugin(dir))
  await ctx.plugin(sourcesPlugin, {})
  await ctx.plugin(scannerPlugin, {})
  await ctx.plugin(plugin, {})
  await tick()

  const uri = pathToFileURL(dir).href.replace(/\/$/, '')
  await ctx.scanner.addSpecifiedDir(uri)
  await ctx.scanner.scan()
  await tick()

  const provider = ctx.sources.get('local')!
  return { ctx, dir, uri, provider, local: ctx.sourceLocal as SourceLocal }
}

const idOf = (urn: string) => urn.split(':').slice(3).join(':')

describe('registration', () => {
  it('registers itself with ctx.sources', async () => {
    const { ctx, provider } = await harness()
    expect(provider.displayName).toBe('This device')
    expect(ctx.sources.providers.map((p) => p.sourceId)).toEqual(['local'])
    // A URN resolves to it, which is what the player uses.
    const track = (await ctx.sources.listTracks()).items[0]!
    expect(ctx.sources.forUrn(track.urn)?.sourceId).toBe('local')
  })

  it('declares only what it implements', async () => {
    // Over-declaring breaks the UI, under-declaring degrades it (docs/06 §9).
    const { provider } = await harness()
    const caps = provider.capabilities
    expect(caps.browse).toBe(true)
    expect(typeof provider.browse).toBe('function')
    expect(caps.search.tracks).toBe(true)
    expect(typeof provider.search).toBe('function')
    expect(caps.library.playlistWrite).toBe(false)
    expect(provider.library, 'no stub that throws — the member is absent').toBeUndefined()
    expect(caps.streaming.urlExpiry, 'a file never expires').toBe(false)
    expect(caps.streaming.seekable).toBe(true)
  })

  // Unregistration on unload is asserted in the lifecycle block below, where
  // the fiber is actually disposed.
})

describe('the required core', () => {
  it('resolves a track to a local file', async () => {
    const { ctx, provider } = await harness()
    const track = (await ctx.sources.listTracks()).items.find((t) => t.title === 'Jóga')!

    const handle = await provider.resolveStream(idOf(track.urn), {
      quality: 'lossless',
      saveData: false,
      acceptFormats: ['mp3'],
    })

    expect(handle.kind).toBe('local')
    expect(handle.target).toMatch(/joga\.mp3$/)
    expect(handle.seekable).toBe(true)
    expect(handle.expiresAt, 'a file does not expire').toBeUndefined()
  })

  it('reports a missing file as not-found rather than failing at play time', async () => {
    const { ctx, dir, provider } = await harness()
    const track = (await ctx.sources.listTracks()).items.find((t) => t.title === 'Jóga')!
    await rm(join(dir, 'joga.mp3'))

    await expect(
      provider.resolveStream(idOf(track.urn), {
        quality: 'lossless',
        saveData: false,
        acceptFormats: [],
      }),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('fetches one track and several', async () => {
    const { ctx, provider } = await harness()
    const tracks = (await ctx.sources.listTracks()).items
    const one = await provider.getTrack(idOf(tracks[0]!.urn))
    expect(one.title).toBe(tracks[0]!.title)

    const many = await provider.getTracks!(tracks.map((t) => idOf(t.urn)))
    expect(many.map((t) => t.title).sort()).toEqual(['Hunter', 'Jóga'])
  })

  it('pings cheaply', async () => {
    const { provider } = await harness()
    expect(await provider.ping()).toBe(true)
  })
})

describe('auth', () => {
  it('signs in trivially and signs out completely', async () => {
    // The `flow: 'none'` case: four lines, and sign-out still means something.
    const { ctx, provider } = await harness()
    expect(provider.auth.flow.kind).toBe('none')
    await provider.auth.signIn({})
    expect(provider.auth.status.state).toBe('authenticated')

    expect((await ctx.sources.counts()).tracks).toBe(2)
    const purged: string[] = []
    ctx.on('source/signed-out', (id) => void purged.push(id))

    await provider.auth.signOut()
    expect(provider.auth.status.state).toBe('anonymous')
    expect(await ctx.sources.counts(), 'nothing of this source is left').toMatchObject({
      tracks: 0,
      albums: 0,
      artists: 0,
    })
    expect(purged, 'listeners get to purge what they derived').toEqual(['local'])
  })
})

describe('browse and search', () => {
  it('browses the folder tree, and shows only files that imported', async () => {
    const { provider } = await harness()
    const page = await provider.browse!()

    const titles = page.items.map((i) => i.title).sort()
    expect(titles, 'the .txt never became a track').toEqual(['Hunter', 'Jóga'])
    expect(page.items.every((i) => i.kind === 'track' && i.urn)).toBe(true)
  })

  it('searches through the shared FTS index', async () => {
    const { provider } = await harness()
    const result = await provider.search!({ text: 'bjork' })
    expect(result.tracks?.items.map((t) => t.title).sort()).toEqual(['Hunter', 'Jóga'])
  })

  it('returns an album with its tracks in order', async () => {
    const { ctx, provider } = await harness()
    const albums = await ctx.sources.listAlbums()
    const album = await provider.getAlbum!(idOf(albums.items[0]!.urn))
    expect(album.title).toBe('Homogenic')
    expect(album.tracks.map((t) => t.title)).toEqual(['Hunter', 'Jóga'])
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const dir = await tempDir('bbebee-local-leak')
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-local-leak-app') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(codecPlugin(dir))
    await ctx.plugin(sourcesPlugin, {})
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)

    await fiber.dispose()
    await tick()
    expect(ctx.sources.providers, 'the provider goes with its plugin').toHaveLength(0)

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
