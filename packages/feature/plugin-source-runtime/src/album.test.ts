/**
 * The last leg of the pipeline: `childUrl` → `ruleAlbum` → `ruleTrackList`,
 * and lyrics.
 *
 * `getAlbum` needs the album's *document URL*, which is a URL the backend
 * chose — nothing about an id implies it. So it comes from the payload a
 * browse stored, and the interesting cases are the ones where it has not been
 * stored yet.
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
import { RuleError } from '@BBeBee/protocol'
import plugin from './index.js'

let server: Server
let origin: string
let lyricBody = '[00:12.00]Line one\n[00:15.50]Line two'

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/albums') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ albumList2: { album: [{ id: 'a1', name: 'Homogenic', artist: 'Björk' }] } }),
      )
      return
    }
    if (url.pathname === '/album') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          album: {
            name: 'Homogenic',
            artist: 'Björk',
            year: 1997,
            songCount: 2,
            song: [
              { id: 's1', title: 'Jóga', artist: 'Björk', duration: 303 },
              { id: 's2', title: 'Bachelorette', artist: 'Björk', duration: 315 },
            ],
          },
        }),
      )
      return
    }
    if (url.pathname === '/lyrics') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(lyricBody)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

function document(over: Record<string, unknown> = {}) {
  return {
    sourceUrl: origin,
    sourceName: 'Albums',
    exploreUrl: '[{"title":"Albums","url":"{{source.url}}/albums"}]',
    ruleExplore: {
      trackList: '$.albumList2.album[*]',
      trackId: '$.id',
      title: '$.name',
      artist: '$.artist',
      kind: '=album',
      childUrl: '={{source.url}}/album?id={{item.id}}',
    },
    ruleAlbum: {
      title: '$.album.name',
      artist: '$.album.artist',
      year: '$.album.year',
      trackCount: '$.album.songCount',
    },
    ruleTrackList: {
      trackList: '$.album.song[*]',
      trackId: '$.id',
      title: '$.title',
      artist: '$.artist',
      durationMs: '$.duration##$##000',
    },
    ruleStream: { url: '={{source.url}}/stream?id={{track.id}}' },
    ...over,
  }
}

async function app(docs: unknown[]) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-album') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
  await ctx.sources.import(JSON.stringify(docs))
  await ctx.plugin(plugin, {})
  await tick()
  await tick()
  return ctx
}

describe('getAlbum', () => {
  it('is offered only when both blocks are present and runnable', async () => {
    const ctx = await app([document()])
    expect(ctx.sources.providers[0]!.getAlbum).toBeTypeOf('function')

    const bare = await app([
      { sourceUrl: `${origin}/x`, sourceName: 'Bare', ruleStream: { url: '={{source.url}}' } },
    ])
    expect(bare.sources.providers[0]!.getAlbum, 'absent, not stubbed').toBeUndefined()
  })

  it('fetches the album document a browse cached, and lists its tracks', async () => {
    const ctx = await app([document()])
    const sourceId = ctx.sources.sources[0]!.id

    const root = await ctx.sources.browse(sourceId)
    await ctx.sources.browse(sourceId, root.items[0]!.id)
    await tick()

    const album = await ctx.sources.providers[0]!.getAlbum!('a1')
    expect(album).toMatchObject({ title: 'Homogenic', year: 1997, trackCount: 2 })
    expect(album.artists[0]?.name).toBe('Björk')
    expect(album.tracks.map((t) => t.title)).toEqual(['Jóga', 'Bachelorette'])
  })

  it('fills in the album a listing does not repeat', async () => {
    // A tracklist rarely names the album it is a listing *of*, and a track
    // with no album is one that cannot be navigated back from.
    const ctx = await app([document()])
    const sourceId = ctx.sources.sources[0]!.id
    const root = await ctx.sources.browse(sourceId)
    await ctx.sources.browse(sourceId, root.items[0]!.id)

    const album = await ctx.sources.providers[0]!.getAlbum!('a1')
    expect(album.tracks.every((t) => t.albumUrn === album.urn)).toBe(true)
  })

  it('carries payloads, so its tracks are playable later', async () => {
    const ctx = await app([document()])
    const sourceId = ctx.sources.sources[0]!.id
    const root = await ctx.sources.browse(sourceId)
    await ctx.sources.browse(sourceId, root.items[0]!.id)

    const album = await ctx.sources.providers[0]!.getAlbum!('a1')
    expect(Object.keys(album.payloads ?? {})).toEqual(album.tracks.map((t) => t.urn))
  })

  it('says the album was never browsed to, rather than "not found"', async () => {
    /*
     * The album may be perfectly real and simply not cached on this device.
     * Reporting it missing sends the user looking for a backend problem that
     * is not there.
     */
    const ctx = await app([document()])
    const failure = ctx.sources.providers[0]!.getAlbum!('never-seen')
    await expect(failure).rejects.toThrow(RuleError)
    await expect(failure).rejects.toThrow(/browse to it once/)
  })

  it('falls back to ruleAlbum.childUrl when the album was never browsed', async () => {
    const ctx = await app([
      document({
        ruleAlbum: {
          title: '$.album.name',
          artist: '$.album.artist',
          childUrl: '={{source.url}}/album?id={{album.id}}',
        },
      }),
    ])
    const album = await ctx.sources.providers[0]!.getAlbum!('a1')
    expect(album).toMatchObject({ title: 'Homogenic' })
    expect(album.tracks.map((t) => t.title)).toEqual(['Jóga', 'Bachelorette'])
  })
})

describe('getLyrics', () => {
  const withLyrics = (lyric: string) => document({ ruleLyric: { lyric } })

  it('is offered only when the document describes lyrics', async () => {
    const ctx = await app([document()])
    expect(ctx.sources.providers[0]!.getLyrics).toBeUndefined()
    expect(ctx.sources.providers[0]!.capabilities.lyrics).toBe(false)

    const withRule = await app([withLyrics('=nothing')])
    expect(withRule.sources.providers[0]!.capabilities.lyrics).toBe(true)
  })

  it('fetches when the rule produces a URL', async () => {
    const ctx = await app([withLyrics('={{source.url}}/lyrics?id={{track.id}}')])
    const lyrics = await ctx.sources.providers[0]!.getLyrics!('s1')
    expect(lyrics?.content).toContain('Line one')
  })

  it('takes the rule’s own output when it is not a URL', async () => {
    // Both shapes exist in real documents, and requiring a flag to say which
    // would be a field every author forgets.
    const ctx = await app([withLyrics('=La la la')])
    expect((await ctx.sources.providers[0]!.getLyrics!('s1'))?.content).toBe('La la la')
  })

  it('recognises a timed sheet without being told', async () => {
    lyricBody = '[00:12.00]Line one\n[00:15.50]Line two'
    const ctx = await app([withLyrics('={{source.url}}/lyrics')])
    const lyrics = await ctx.sources.providers[0]!.getLyrics!('s1')
    expect(lyrics).toMatchObject({ format: 'lrc', synced: true })
  })

  it('treats plain text as plain, not as a broken sheet', async () => {
    lyricBody = 'Just some words\nAnd more words'
    const ctx = await app([withLyrics('={{source.url}}/lyrics')])
    const lyrics = await ctx.sources.providers[0]!.getLyrics!('s1')
    expect(lyrics).toMatchObject({ format: 'plain', synced: false })
  })

  it('returns nothing rather than an empty sheet', async () => {
    // A lyrics pane rendering zero lines reads as "loading, for ever".
    lyricBody = '   '
    const ctx = await app([withLyrics('={{source.url}}/lyrics')])
    expect(await ctx.sources.providers[0]!.getLyrics!('s1')).toBeUndefined()
  })

  it('returns nothing when the rule cannot resolve', async () => {
    const ctx = await app([withLyrics('={{track.nothing}}')])
    expect(await ctx.sources.providers[0]!.getLyrics!('s1')).toBeUndefined()
  })
})
