/**
 * A document nobody compiled, searching.
 *
 * This is the claim the whole string model rests on (docs/10 §M2): a
 * Subsonic-shaped source imported as *text* renders its search URL, fetches,
 * runs its rules, and returns tracks. The document under test is the reference
 * Subsonic document fixture, so a change to the rule engine that breaks
 * a real document fails here.
 */

import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import type { HttpRequest, HttpService, SourceRecord } from '@BBeBee/protocol'
import { DocumentSource } from './source.js'
import { subsonicDoc } from './subsonic-doc.fixture.js'

const SUBSONIC_RESPONSE = {
  'subsonic-response': {
    status: 'ok',
    searchResult3: {
      song: [
        { id: '1', title: 'Jóga', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 303, suffix: 'flac' },
        { id: '2', title: 'Bachelorette', artist: 'Björk', album: 'Homogenic', albumId: 'a1', duration: 315, suffix: 'flac' },
      ],
    },
  },
}

/** An `http` that records requests and replays a canned body. */
function fakeHttp(body: unknown, status = 200) {
  const requests: HttpRequest[] = []
  const http = (async (req: HttpRequest) => {
    requests.push(req)
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      status,
      headers: { 'content-type': 'application/json' },
      url: req.url,
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
      bytes: async () => new Uint8Array(),
      stream: () => new ReadableStream(),
    }
  }) as unknown as HttpService
  return { http, requests }
}

async function shippedDocument(): Promise<Record<string, unknown>> {
  return subsonicDoc()
}

function recordFor(doc: Record<string, unknown>): SourceRecord {
  return {
    id: 'music-example-org-35be9fe2',
    sourceUrl: String(doc.sourceUrl),
    name: String(doc.sourceName),
    type: 'music',
    doc: doc as never,
    docJson: JSON.stringify(doc),
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

describe('the shipped Subsonic document', () => {
  it('declares itself searchable', async () => {
    // Derived, not asserted by the document: the rules it uses are all in
    // engines this build can run.
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    expect(source.capabilities.search.tracks).toBe(true)
    expect(source.provider().search, 'present, not stubbed').toBeTypeOf('function')
  })

  it('renders the search URL from the template', async () => {
    const { http, requests } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    await source.search({ text: 'björk' })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('https://music.example.org/rest/search3')
    expect(requests[0]!.url, 'the search text reaches {{key}}').toContain('query=björk')
  })

  it('turns the response into tracks', async () => {
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const result = await source.search({ text: 'björk' })

    const tracks = result.tracks!.items
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      urn: 'BBeBee:music-example-org-35be9fe2:track:1',
      title: 'Jóga',
      albumTitle: 'Homogenic',
    })
    expect(tracks[0]!.artists[0]!.name).toBe('Björk')
  })

  it('converts the seconds-based duration with the ## replacement', async () => {
    // `$.duration##$##000` is how every seconds-based API becomes durationMs,
    // and getting it wrong shows up as a scrubber that never moves.
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const result = await source.search({ text: 'x' })
    expect(result.tracks!.items[0]!.durationMs).toBe(303_000)
  })

  it('pages by incrementing the cursor', async () => {
    const { http, requests } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    const first = await source.search({ text: 'x' })
    expect(first.tracks!.cursor).toBe('2')

    await source.search({ text: 'x' }, { cursor: '2' })
    // This document does not use {{page}}, so the URL is the same — which is
    // exactly why paging cannot be trusted to `hasMore` alone.
    expect(requests).toHaveLength(2)
  })

  it('refuses a host the document did not declare', async () => {
    const doc = await shippedDocument()
    doc.searchUrl = '=http://169.254.169.254/latest/meta-data/'
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(doc), { http })
    await expect(source.search({ text: 'x' })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('search types', () => {
  /*
   * A document with both interfaces, which is what the per-interface toggles
   * on the search screen exist for. `types` has to mean exactly what it says:
   * asking for artists must not fetch the track document, and asking for
   * tracks must not run the artist rules.
   */
  const ARTIST_RESPONSE = {
    'subsonic-response': {
      searchResult3: { artist: [{ id: 'ar1', name: 'Björk' }] },
    },
  }

  const withArtistRules = async (): Promise<Record<string, unknown>> => {
    const doc = await shippedDocument()
    return {
      ...doc,
      ruleSearchArtist: {
        trackList: '$.subsonic-response.searchResult3.artist[*]',
        trackId: '$.id',
        title: '$.name',
      },
    }
  }

  it('runs only the track rules when types names tracks', async () => {
    const { http, requests } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await withArtistRules()), { http })
    const result = await source.search({ text: 'x', types: ['track'] })
    expect(result.tracks!.items).toHaveLength(2)
    expect(result.artists).toBeUndefined()
    expect(requests).toHaveLength(1)
  })

  it('runs only the artist rules when types names artists', async () => {
    const { http, requests } = fakeHttp(ARTIST_RESPONSE)
    const source = new DocumentSource(recordFor(await withArtistRules()), { http })
    const result = await source.search({ text: 'x', types: ['artist'] })
    expect(result.tracks, 'the track half was not asked for').toBeUndefined()
    expect(result.artists!.items[0]).toMatchObject({ name: 'Björk' })
    expect(requests).toHaveLength(1)
  })

  it('serves a document whose only search interface is artists', async () => {
    // The artist search can live on its own URL, with no `searchUrl` at all —
    // the provider still has to expose `search`, or that interface is
    // unreachable from the search screen.
    const doc = await withArtistRules()
    delete doc.searchUrl
    doc.searchArtistUrl = 'https://music.example.org/rest/searchArtist?query={{key}}'
    const { http } = fakeHttp(ARTIST_RESPONSE)
    const source = new DocumentSource(recordFor(doc), { http })

    expect(source.capabilities.search.tracks).toBe(false)
    expect(source.capabilities.search.artists).toBe(true)
    expect(source.provider().search, 'present, not stubbed').toBeTypeOf('function')

    const result = await source.provider().search!({ text: 'x' })
    expect(result.tracks).toBeUndefined()
    expect(result.artists!.items).toHaveLength(1)
  })

  it('refuses a type the document cannot serve', async () => {
    // The shipped document has no artist rules; a caller that asks for
    // artists anyway gets told, rather than a silently empty result.
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    await expect(source.search({ text: 'x', types: ['artist'] })).rejects.toThrow(RuleError)
  })
})

describe('rules that do not hold up', () => {
  const withRules = async (over: Record<string, unknown>) => {
    const doc = await shippedDocument()
    return { ...doc, ruleSearch: { ...(doc.ruleSearch as object), ...over } }
  }

  it('drops a row missing a required field rather than importing it half-built', async () => {
    const { http } = fakeHttp({
      'subsonic-response': {
        searchResult3: { song: [{ id: '1' }, { id: '2', title: 'Real' }] },
      },
    })
    const notes: string[] = []
    const source = new DocumentSource(recordFor(await shippedDocument()), {
      http,
      log: (m) => void notes.push(m),
    })
    const result = await source.search({ text: 'x' })

    expect(result.tracks!.items).toHaveLength(1)
    // Counted, not hidden: three of twenty results reads as a thin backend
    // rather than as a broken rule.
    expect(notes.join(' ')).toContain('dropped 1')
  })

  it('raises a RuleError for a duration it cannot coerce', async () => {
    const { http } = fakeHttp({
      'subsonic-response': {
        searchResult3: { song: [{ id: '1', title: 'x', duration: 'ages' }] },
      },
    })
    const doc = await withRules({ durationMs: '$.duration' })
    const source = new DocumentSource(recordFor(doc), { http })
    // Not NaN in the catalogue: that surfaces much later as a scrubber that
    // does not move, with nothing to connect it to.
    await expect(source.search({ text: 'x' })).rejects.toThrow(RuleError)
  })

  it('accepts the duration spellings documents actually use', async () => {
    for (const [written, expected] of [
      ['213', 213],
      ['3:33', 213_000],
      ['1:02:03', 3_723_000],
      ['213.5s', 213_500],
    ] as const) {
      const { http } = fakeHttp({
        'subsonic-response': {
          searchResult3: { song: [{ id: '1', title: 'x', duration: written }] },
        },
      })
      const doc = await withRules({ durationMs: '$.duration' })
      const source = new DocumentSource(recordFor(doc), { http })
      const result = await source.search({ text: 'x' })
      expect(result.tracks!.items[0]!.durationMs, written).toBe(expected)
    }
  })

  it('is not searchable when its rules need an engine this build lacks', async () => {
    // A perfectly good document that this build cannot serve. Declaring the
    // capability anyway offers a button the runtime would fail.
    const doc = await withRules({ trackList: '@css:li.song' })
    const { http } = fakeHttp(SUBSONIC_RESPONSE)
    const source = new DocumentSource(recordFor(doc), { http })
    expect(source.capabilities.search.tracks).toBe(false)
    expect(source.provider().search).toBeUndefined()
  })

  it('maps a backend error onto the taxonomy', async () => {
    const { http } = fakeHttp({}, 503)
    const source = new DocumentSource(recordFor(await shippedDocument()), { http })
    await expect(source.search({ text: 'x' })).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('derives streaming qualities from ruleStream.qualities, doc.qualities, or fallback', async () => {
    const docBase = await shippedDocument()
    const { http } = fakeHttp({})

    // 1. ruleStream.qualities
    const docWithRuleStreamQualities = {
      ...docBase,
      ruleStream: { ...((docBase.ruleStream as any) || {}), qualities: ['low', 'normal', 'high'] },
    }
    const s1 = new DocumentSource(recordFor(docWithRuleStreamQualities), { http })
    expect(s1.capabilities.streaming.qualities).toEqual(['low', 'normal', 'high'])

    // 2. doc.qualities
    const docWithDocQualities = {
      ...docBase,
      qualities: ['normal', 'hi-res'],
    }
    const s2 = new DocumentSource(recordFor(docWithDocQualities), { http })
    expect(s2.capabilities.streaming.qualities).toEqual(['normal', 'hi-res'])

    // 3. ruleStream.qualities takes precedence over doc.qualities
    const docWithBoth = {
      ...docBase,
      qualities: ['normal'],
      ruleStream: { ...((docBase.ruleStream as any) || {}), qualities: ['lossless', 'hi-res'] },
    }
    const s3 = new DocumentSource(recordFor(docWithBoth), { http })
    expect(s3.capabilities.streaming.qualities).toEqual(['lossless', 'hi-res'])

    // 4. Default fallback when url has no prefs.quality
    const s4 = new DocumentSource(recordFor(docBase), { http })
    expect(s4.capabilities.streaming.qualities).toEqual(['normal'])
  })
})
