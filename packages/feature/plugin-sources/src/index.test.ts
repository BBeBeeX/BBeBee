import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { NetworkError } from '@BBeBee/protocol'
import type { Capabilities, MediaProvider, SearchQuery, SearchResult, Track } from '@BBeBee/protocol'
import plugin, { Sources } from './index.js'

/** A provider with nothing but the required core, declaring no search. */
function fakeProvider(sourceId: string, overrides: Partial<MediaProvider> = {}): MediaProvider {
  const capabilities: Capabilities = {
    search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
    browse: false,
    recommend: false,
    lyrics: false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    sourceId,
    displayName: sourceId,
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    getTrack: async (id) => ({ urn: `BBeBee:${sourceId}:track:${id}` }) as Track,
    resolveStream: async () => ({ kind: 'remote', target: 'https://example.org/a.mp3', seekable: true }),
    ping: async () => true,
    ...overrides,
  }
}

/** A provider that searches, answering with `whenSearched`. */
function searchingProvider(
  sourceId: string,
  whenSearched: (query: SearchQuery) => Promise<SearchResult>,
): MediaProvider {
  const base = fakeProvider(sourceId)
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      search: { tracks: true, albums: false, artists: false, playlists: false, fullText: true },
      recommend: false,
    },
    search: whenSearched,
  }
}

/**
 * A context with the catalogue's dependencies: `ctx.sources` owns SQL now, so
 * it needs a real database rather than a fake — the queries are the behaviour.
 */
async function withSources(): Promise<{ ctx: Context; sources: Sources }> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-sources') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()
  return { ctx, sources: ctx.sources as Sources }
}

describe('plugin-sources', () => {
  it('activates and claims its service', async () => {
    const { ctx } = await withSources()
    expect(ctx.sources).toBeInstanceOf(Sources)
  })

  it('leaves nothing behind when unloaded', async () => {
    // The architecture's central claim, applied to this plugin (docs/09 §6).
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-leak') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('registration', () => {
  it('registers, announces, and unregisters through the disposer', async () => {
    const { ctx, sources } = await withSources()
    const events: string[] = []
    ctx.on('source/registered', (id) => void events.push(`+${id}`))
    ctx.on('source/unregistered', (id) => void events.push(`-${id}`))

    const dispose = sources.register(fakeProvider('local'))
    expect(sources.get('local')?.displayName).toBe('local')
    expect(sources.providers).toHaveLength(1)

    dispose()
    expect(sources.get('local')).toBeUndefined()
    expect(sources.providers).toHaveLength(0)
    expect(events).toEqual(['+local', '-local'])
  })

  it('refuses a duplicate instance id rather than shadowing one', async () => {
    // Two providers on one instance id makes every URN in that namespace
    // ambiguous — the exact thing the URN scheme prevents (docs/07 §1).
    const { sources } = await withSources()
    const first = fakeProvider('navidrome-home')
    sources.register(first)
    const dispose = sources.register(fakeProvider('navidrome-home'))

    expect(sources.providers).toHaveLength(1)
    expect(sources.get('navidrome-home')).toBe(first)

    // The rejected registration's disposer must not remove the incumbent.
    dispose()
    expect(sources.get('navidrome-home')).toBe(first)
  })

  it('resolves a urn to the provider that owns it', async () => {
    const { sources } = await withSources()
    sources.register(fakeProvider('local'))
    sources.register(fakeProvider('navidrome-home'))

    expect(sources.forUrn('BBeBee:local:track:9f2c')?.sourceId).toBe('local')
    expect(sources.forUrn('BBeBee:navidrome-home:album:41af')?.sourceId).toBe('navidrome-home')
    expect(sources.forUrn('BBeBee:jellyfin-nas:track:1')).toBeUndefined()
    expect(sources.forUrn('not-a-urn')).toBeUndefined()
  })
})

describe('searchAll', () => {
  const query = { text: 'bjork' }
  const hit = (title: string): SearchResult => ({
    tracks: { items: [{ title } as Track], hasMore: false },
  })

  it('reports a failing provider instead of dropping it', async () => {
    // The whole point of the per-provider shape: the UI can say
    // "Navidrome: 1 result · Jellyfin: unreachable" (docs/06 §2).
    const { sources } = await withSources()
    sources.register(searchingProvider('navidrome-home', async () => hit('Jóga')))
    sources.register(
      searchingProvider('jellyfin-nas', async () => {
        throw new NetworkError('connection refused', 'jellyfin-nas')
      }),
    )

    const { bySource } = await sources.searchAll(query)
    expect(bySource.map((p) => p.sourceId)).toEqual(['navidrome-home', 'jellyfin-nas'])
    expect(bySource[0]!.result?.tracks?.items[0]?.title).toBe('Jóga')
    expect(bySource[1]!.error?.code).toBe('network')
    expect(bySource[1]!.result).toBeUndefined()
  })

  it('maps a raw throw onto the taxonomy rather than letting it escape', async () => {
    const { sources } = await withSources()
    sources.register(
      searchingProvider('rude', async () => {
        throw new Error('kaboom')
      }),
    )

    const { bySource } = await sources.searchAll(query)
    expect(bySource[0]!.error?.code).toBe('provider')
    expect(bySource[0]!.error?.sourceId).toBe('rude')
  })

  it('reports a slow provider as pending without failing the search', async () => {
    const { sources } = await withSources()
    sources.register(searchingProvider('fast', async () => hit('Hyperballad')))
    sources.register(searchingProvider('slow', () => new Promise(() => {})))

    const { bySource } = await sources.searchAll(query, { timeoutMs: 20 })
    const slow = bySource.find((p) => p.sourceId === 'slow')!
    expect(slow.pending).toBe(true)
    expect(slow.error).toBeUndefined()
    expect(bySource.find((p) => p.sourceId === 'fast')!.result).toBeDefined()
  })

  it('skips providers that cannot search, and honours sourceIds', async () => {
    // A provider implementing only the required core must never be called for
    // an optional member — that is what `capabilities` is for (docs/06 §1).
    const { sources } = await withSources()
    let asked = 0
    sources.register(fakeProvider('http-url'))
    sources.register(
      searchingProvider('navidrome-home', async () => {
        asked++
        return hit('Army of Me')
      }),
    )
    sources.register(searchingProvider('jellyfin-nas', async () => hit('Isobel')))

    const all = await sources.searchAll(query)
    expect(all.bySource.map((p) => p.sourceId)).toEqual(['navidrome-home', 'jellyfin-nas'])

    const one = await sources.searchAll(query, { sourceIds: ['navidrome-home'] })
    expect(one.bySource.map((p) => p.sourceId)).toEqual(['navidrome-home'])
    expect(asked).toBe(2)
  })

  it('returns an empty fan-out when nothing is registered', async () => {
    const { sources } = await withSources()
    await expect(sources.searchAll(query)).resolves.toEqual({ bySource: [] })
  })

  it('gives each source its own interface filter', async () => {
    // What the per-interface toggles on the search screen pass through: one
    // fan-out, three different asks. A provider absent from the map keeps the
    // query's own `types`.
    const { sources } = await withSources()
    const seen: Record<string, SearchQuery['types']> = {}
    const capture = (id: string) =>
      searchingProvider(id, async (q) => {
        seen[id] = q.types
        return hit(id)
      })
    sources.register(capture('both'))
    sources.register(capture('songs-only'))
    sources.register(capture('artists-only'))
    sources.register(capture('unspecified'))

    await sources.searchAll(query, {
      typesBySource: {
        both: ['track', 'artist'],
        'songs-only': ['track'],
        'artists-only': ['artist'],
      },
    })

    expect(seen['both']).toEqual(['track', 'artist'])
    expect(seen['songs-only']).toEqual(['track'])
    expect(seen['artists-only']).toEqual(['artist'])
    expect(seen['unspecified']).toBeUndefined()
  })

  it('caches results asked for through a gated caller with no db grants', async () => {
    // The search screen runs on the UI package's context (docs/08 §2), which
    // holds no db capabilities. The write belongs to this service, on the
    // handle captured at init — through a holder, like `Catalog` and
    // `SourceStore`. Reached directly, the captured handle was re-shadowed
    // with the caller: the search returned results and the catalogue stayed
    // empty, so the queue fell back to showing URNs and the player bar had no
    // cover.
    const { ctx, sources } = await withSources()
    const report = await sources.import(
      JSON.stringify({ sourceUrl: 'https://bili.test', sourceName: 'Bili', ruleStream: { url: '=x' } }),
    )
    const sourceId = report.added[0]!.id
    const track = {
      urn: `BBeBee:${sourceId}:track:1`,
      title: '极端天气 MV',
      artists: [],
    } as Track
    sources.register(
      searchingProvider(sourceId, async () => ({ tracks: { items: [track], hasMore: false } })),
    )

    const ui = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-sources-ui-desktop',
      requested: [],
    })
    await (ui.sources as Sources).searchAll(query)

    const cached = await sources.getTracks([track.urn])
    expect(cached.map((t) => t.title)).toEqual(['极端天气 MV'])
  })
})

describe('importing documents', () => {
  const doc = (extra: Record<string, unknown> = {}) => ({
    sourceUrl: 'https://music.example.org',
    sourceName: 'Example',
    ruleStream: { url: '={{source.url}}' },
    ...extra,
  })

  it('adds a source, and reports it', async () => {
    const { sources } = await withSources()
    const report = await sources.import(JSON.stringify(doc()))

    expect(report.added).toHaveLength(1)
    expect(report.rejected).toEqual([])
    expect(sources.sources).toHaveLength(1)
    expect(sources.source(report.added[0]!.id)).toBeDefined()
  })

  it('stores an import requested through a gated caller with no db grants', async () => {
    // The import screen runs on the UI package's context (docs/08 §2), which
    // holds no db capabilities. A Service method reached through that context
    // sees `this.ctx` as the *caller's*, so the transaction used to be gated
    // by the caller's grants — refused with the UI plugin's name on the
    // error. The write belongs to this service, on the handle captured at
    // init, exactly like `Catalog` and `SourceStore` before it.
    const { ctx, sources } = await withSources()
    const ui = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-sources-ui-desktop',
      requested: [],
    })

    const report = await (ui.sources as Sources).import(JSON.stringify(doc()))

    expect(report.rejected).toEqual([])
    expect(report.added).toHaveLength(1)
    expect(sources.sources).toHaveLength(1)
  })

  it('round-trips byte for byte through export', async () => {
    // The promise in docs/07 §4.1: export emits what was imported. A
    // re-serialisation reorders keys and normalises spacing, and the first
    // time a user's document comes back different they stop trusting export.
    const original =
      '{\n  "sourceName": "Example",\n  "sourceUrl": "https://music.example.org",\n' +
      '  "ruleStream": {"url": "={{source.url}}"},\n  "unknownFutureField": [1, 2]\n}'
    const { sources } = await withSources()
    await sources.import(original)

    const exported = await sources.export()
    // The stored text is the exact slice that came in...
    expect(sources.sources[0]!.docJson).toBe(original)
    // ...and export emits that slice, not a rebuilt copy of it.
    expect(exported).toContain('"sourceName": "Example"')
    expect(exported.indexOf('"sourceName"')).toBeLessThan(exported.indexOf('"sourceUrl"'))

    const parsed = JSON.parse(exported) as Record<string, unknown>[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.unknownFutureField).toEqual([1, 2])
  })

  it('export → import is a no-op, not a phantom update', async () => {
    // The only user-facing path the byte-for-byte promise exists for. A
    // re-serialised export came back as `updated` with an *empty* change
    // list, rewrote doc_hash, and restarted the source for nothing.
    const original =
      '{\n  "sourceName": "Example",\n  "sourceUrl": "https://music.example.org",\n' +
      '  "ruleStream": {"url": "={{source.url}}"}\n}'
    const { sources } = await withSources()
    await sources.import(original)
    const before = sources.sources[0]!

    const report = await sources.import(await sources.export())

    expect(report.updated, 'nothing changed, so nothing was updated').toEqual([])
    expect(report.added).toEqual([])
    expect(report.unchanged).toHaveLength(1)
    expect(sources.sources[0]!.docHash, 'the hash is stable').toBe(before.docHash)
  })

  it('survives arbitrary formatting through a full round trip', async () => {
    const original =
      '[\n\n  {"sourceUrl":"https://a.test","sourceName":"A",\n' +
      '   "ruleStream":{"url":"=x"}},\n' +
      '  {   "sourceName" : "B" ,  "sourceUrl" : "https://b.test" ,\n' +
      '      "ruleStream" : { "url" : "=y" }   }\n]'
    const { sources } = await withSources()
    await sources.import(original)

    const first = await sources.export()
    const report = await sources.import(first)
    expect(report.unchanged).toHaveLength(2)
    // And exporting again is idempotent, which is what makes the round trip
    // safe to repeat.
    expect(await sources.export()).toBe(first)
  })

  it('rebuilds only a document carrying app-maintained fields', async () => {
    // There is no way to remove a key from text without reformatting it, so
    // this one case is honestly re-serialised — and the stripped field is
    // gone, which is the point.
    const { sources } = await withSources()
    await sources.import(
      JSON.stringify({ ...doc(), respondTime: 180, weight: 3 }),
    )
    const exported = await sources.export()
    expect(exported).not.toContain('respondTime')
    expect(exported).not.toContain('weight')
    expect(JSON.parse(exported)).toHaveLength(1)
  })

  it('omits sources nobody could import', async () => {
    // The local-files placeholder and a migration leftover are rows, not
    // documents: exporting them produces a file `import()` rejects.
    const { ctx, sources } = await withSources()
    await ctx.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    await sources.import(JSON.stringify(doc()))

    const exported = JSON.parse(await sources.export()) as Record<string, unknown>[]
    expect(exported).toHaveLength(1)
    expect(exported[0]!.sourceUrl).toBe('https://music.example.org')
  })

  it('omits a row the ADR-5 migration carried across', async () => {
    // Shaped exactly as migration v3 writes it: a `bbebee://migrated/` URL
    // and a document that says it has no rules. Exporting it would produce a
    // file whose re-import fails on the scheme check — and the round-trip
    // promise is that export → import is a no-op.
    const { ctx, sources } = await withSources()
    const migratedDoc = JSON.stringify({
      sourceUrl: 'bbebee://migrated/nas',
      sourceName: 'NAS',
      sourceComment: 'Migrated from a pre-ADR-5 provider.',
    })
    await ctx.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, enabled,
                            imported_at, updated_at, last_error)
       VALUES ('nas', 'bbebee://migrated/nas', 'NAS', ?, 'migrated-nas', 0, 0, 0, 'needs a document')`,
      [migratedDoc],
    )
    await sources.import(JSON.stringify(doc()))

    const text = await sources.export()
    expect(text, 'the placeholder never reaches a shared file').not.toContain('migrated')

    // And what did come out still round-trips.
    const report = await sources.import(text)
    expect(report.rejected).toEqual([])
    expect(report.unchanged).toHaveLength(1)
  })

  it('exports an empty set as an empty array', async () => {
    const { sources } = await withSources()
    expect(JSON.parse(await sources.export())).toEqual([])
  })

  it('re-importing the same document is an update, not a duplicate', async () => {
    const { sources } = await withSources()
    const first = await sources.import(JSON.stringify(doc()))
    const again = await sources.import(JSON.stringify(doc()))

    expect(again.added).toEqual([])
    expect(again.unchanged).toHaveLength(1)
    expect(sources.sources).toHaveLength(1)
    // Identity is preserved, so every URN and cached row still resolves.
    expect(again.unchanged[0]!.id).toBe(first.added[0]!.id)
  })

  it('reports which fields an update changed', async () => {
    const { sources } = await withSources()
    await sources.import(JSON.stringify(doc()))
    const report = await sources.import(JSON.stringify(doc({ sourceName: 'Renamed' })))

    expect(report.updated).toHaveLength(1)
    expect(report.updated[0]!.changedFields).toEqual(['sourceName'])
  })

  it('does not re-enable a source the user switched off', async () => {
    // An author publishing an update must not undo the user's own decision.
    const { sources } = await withSources()
    const report = await sources.import(JSON.stringify(doc()))
    const id = report.added[0]!.id
    await sources.setEnabled(id, false)

    await sources.import(JSON.stringify(doc({ sourceName: 'Renamed' })))
    expect(sources.source(id)!.enabled).toBe(false)
  })

  it('one malformed entry never rejects the rest of a set', async () => {
    const { sources } = await withSources()
    const set = JSON.stringify([
      doc({ sourceUrl: 'https://a.test' }),
      { sourceName: 'no url, no rules' },
      doc({ sourceUrl: 'https://b.test' }),
    ])

    const report = await sources.import(set)
    expect(report.added).toHaveLength(2)
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]!.index).toBe(1)
    // The structured issues survive, so the screen can list them per path.
    expect(report.rejected[0]!.error.issues.length).toBeGreaterThan(0)
    expect(sources.sources).toHaveLength(2)
  })

  it('reports a storage failure on one entry without losing the others', async () => {
    // Two distinct guarantees, and they pull in different directions. The
    // documented one is *partial* import: one bad entry in a set of forty
    // must not cost the other thirty-nine. What was broken is what happened
    // around it — a `put` that threw rejected the whole call, so the report
    // was lost, `refresh()` never ran, and the in-memory list went stale
    // while rows sat committed in the database.
    //
    // So: the write is one transaction (a crash mid-import cannot leave half
    // a set), and each entry has its own catch (a bad entry is data, not an
    // outage).
    const { ctx, sources } = await withSources()
    const set = JSON.stringify([doc({ sourceUrl: 'https://a.test' }), doc({ sourceUrl: 'https://b.test' })])

    // The write happens on the transaction handle, so that is what fails.
    let inserts = 0
    const realTransaction = ctx.db.transaction.bind(ctx.db)
    ;(ctx.db as { transaction: unknown }).transaction = <T,>(fn: (tx: never) => Promise<T>) =>
      realTransaction(async (tx) => {
        const guarded = {
          ...tx,
          exec: async (sql: string, params?: never[]) => {
            if (sql.includes('INSERT INTO sources') && ++inserts === 2) {
              throw new Error('disk full')
            }
            return tx.exec(sql, params)
          },
        }
        return fn(guarded as never)
      })

    const report = await sources.import(set)
    ;(ctx.db as { transaction: unknown }).transaction = realTransaction

    // The call resolves with a report rather than throwing it away, the good
    // entry is stored, and the failure is attributable to its position.
    expect(report.added).toHaveLength(1)
    expect(report.added[0]!.sourceUrl).toBe('https://a.test')
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]!.index).toBe(1)
    // The review screen renders the issues, so the underlying failure has to
    // be among them — "could not be stored" alone is not investigable.
    expect(report.rejected[0]!.error.issues).toContainEqual({
      path: '',
      message: 'could not be stored: disk full',
    })
    // And the in-memory list matches the database, which is what went stale.
    expect(sources.sources).toHaveLength(1)
  })

  it('selects a subset of a set when asked', async () => {
    const { sources } = await withSources()
    const set = JSON.stringify([doc({ sourceUrl: 'https://a.test' }), doc({ sourceUrl: 'https://b.test' })])
    const report = await sources.import(set, { select: ['https://b.test'] })

    expect(report.added).toHaveLength(1)
    expect(report.added[0]!.sourceUrl).toBe('https://b.test')
  })

  it('emits one event per source, not two', async () => {
    // Emitting `imported` *and* `changed` for an update made the runtime stop
    // and start that source twice, with duplicate registration events.
    const { ctx, sources } = await withSources()
    await sources.import(JSON.stringify(doc()))

    const events: string[] = []
    ctx.on('source/imported', () => void events.push('imported'))
    ctx.on('source/changed', () => void events.push('changed'))
    await sources.import(JSON.stringify(doc({ sourceName: 'Renamed' })))

    expect(events).toEqual(['changed'])
  })

  it('records the egress allowlist the user was shown', async () => {
    const { sources } = await withSources()
    await sources.import(JSON.stringify(doc({ allowedHosts: ['cdn.example.org'] })))
    expect(sources.sources[0]!.allowedHosts).toEqual(['cdn.example.org', 'music.example.org'])
  })

  it('removing keeps the library unless asked otherwise', async () => {
    const { sources } = await withSources()
    const id = (await sources.import(JSON.stringify(doc()))).added[0]!.id

    await sources.remove(id)
    expect(sources.source(id)?.enabled, 'kept, disabled').toBe(false)

    await sources.remove(id, { forgetCatalogue: true })
    expect(sources.source(id)).toBeUndefined()
  })
})

describe('getAlbum optimizations', () => {
  it('deduplicates concurrent in-flight getAlbum calls and uses cache on subsequent read', async () => {
    const { sources } = await withSources()
    const report = await sources.import(
      JSON.stringify({
        sourceUrl: 'https://remote-test.example.org',
        sourceName: 'Remote Test',
        ruleStream: { url: '={{source.url}}' },
      }),
    )
    const sourceId = report.added[0]!.id

    let callCount = 0
    const provider = fakeProvider(sourceId, {
      getAlbum: async (id) => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 30))
        return {
          urn: `BBeBee:${sourceId}:album:${id}`,
          title: 'Remote Album',
          artists: [{ urn: `BBeBee:${sourceId}:artist:a`, name: 'Remote Artist', role: 'main', ordinal: 0 }],
          tracks: [
            {
              urn: `BBeBee:${sourceId}:track:${id}_1`,
              title: 'Track 1',
              durationMs: 180000,
            } as Track,
          ],
        }
      },
    })

    sources.register(provider)

    // 1. Concurrent calls: both should await the exact same in-flight task
    const urn = `BBeBee:${sourceId}:album:123`
    const [res1, res2] = await Promise.all([
      sources.getAlbum(urn),
      sources.getAlbum(urn),
    ])

    expect(callCount).toBe(1)
    expect(res1?.title).toBe('Remote Album')
    expect(res2?.title).toBe('Remote Album')
    expect(res1?.tracks).toHaveLength(1)

    // 2. Subsequent call: should hit the local SQLite cache rather than calling provider again
    const res3 = await sources.getAlbum(urn)
    expect(callCount).toBe(1)
    expect(res3?.title).toBe('Remote Album')
    expect(res3?.tracks).toHaveLength(1)

    // 3. Paged call with cursor: should bypass initial-page cache and hit provider
    await sources.getAlbum(urn, { cursor: '2' })
    expect(callCount).toBe(2)
  })

  it('queues concurrent cache writes sequentially without transaction error', async () => {
    const { sources } = await withSources()
    const report = await sources.import(
      JSON.stringify({
        sourceUrl: 'https://batch-test.example.org',
        sourceName: 'Batch Test',
        ruleStream: { url: '={{source.url}}' },
      }),
    )
    const sourceId = report.added[0]!.id

    // Fire 5 concurrent cache calls
    const writes = Array.from({ length: 5 }, (_, i) =>
      sources.getAlbum(`BBeBee:${sourceId}:album:bulk_${i}`),
    )

    const provider = fakeProvider(sourceId, {
      getAlbum: async (id) => ({
        urn: `BBeBee:${sourceId}:album:${id}`,
        title: `Album ${id}`,
        artists: [],
        tracks: [
          {
            urn: `BBeBee:${sourceId}:track:${id}_0`,
            title: `Track ${id}`,
          } as Track,
        ],
      }),
    })
    sources.register(provider)

    const results = await Promise.all(writes)
    expect(results).toHaveLength(5)
    for (const r of results) {
      expect(r?.tracks).toHaveLength(1)
    }
  })
})

