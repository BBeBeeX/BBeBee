import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { Lyrics, MediaProvider, TransportState } from '@BBeBee/protocol'
import pluginLyrics, { apply, cleanTrackTitle, LyricsPlugin, type LyricsConfig } from './index.js'

class PlayerStub extends Service {
  public transport: TransportState = {
    status: 'idle',
    positionMs: 0,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }

  setTrack(urn: string) {
    this.transport.trackUrn = urn
    this.ctx.emit('player/track-changed', urn)
  }

  setPosition(ms: number) {
    this.transport.positionMs = ms
    this.ctx.emit('player/position', ms, 180000)
  }
}

class SourcesStub extends Service {
  providers: MediaProvider[] = []
  lyricsMap = new Map<string, Lyrics>()
  sourceRecords = new Map<string, any>()
  getLyricsCallCount = 0
  customGetLyrics?: (id: string) => Promise<Lyrics | undefined>

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  source(id: string) {
    return this.sourceRecords.get(id)
  }

  forUrn(_urn: string) {
    return {
      id: 'mock-source',
      name: 'Mock Source',
      capabilities: { lyrics: true } as any,
      getLyrics: async (id: string) => {
        this.getLyricsCallCount++
        if (this.customGetLyrics) return await this.customGetLyrics(id)
        if (id === 'error-track') throw new Error('Network timeout')
        return this.lyricsMap.get(id)
      },
    } as unknown as MediaProvider
  }
}

class DbStub extends Service {
  lyricsRows = new Map<string, any>()

  constructor(ctx: Context) {
    super(ctx, 'db')
  }

  async query<T>(sql: string, params: any[]): Promise<T[]> {
    if (sql.includes('FROM lyrics')) {
      const row = this.lyricsRows.get(params[0])
      return row ? [row as T] : []
    }
    return []
  }

  async get<T>(sql: string, params: any[]): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params)
    return rows[0]
  }

  async exec(sql: string, params: any[]): Promise<void> {
    if (sql.includes('INSERT OR REPLACE INTO lyrics')) {
      this.lyricsRows.set(params[0], {
        format: params[2],
        content: params[3],
        synced: params[4],
        offset_ms: params[5],
        language: params[6],
        fetched_at: params[8],
      })
    } else if (sql.includes('DELETE FROM lyrics')) {
      if (params && params[0]) {
        this.lyricsRows.delete(params[0])
      } else {
        this.lyricsRows.clear()
      }
    } else if (sql.includes('UPDATE lyrics SET offset_ms')) {
      const row = this.lyricsRows.get(params[1])
      if (row) {
        row.offset_ms = params[0]
      }
    }
  }
}

async function createHarness(config?: LyricsConfig, sharedDbRows?: Map<string, any>) {
  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(SourcesStub)

  class CustomDbStub extends DbStub {
    constructor(c: Context) {
      super(c)
      if (sharedDbRows) {
        this.lyricsRows = sharedDbRows
      }
    }
  }
  await ctx.plugin(CustomDbStub)
  await ctx.plugin(LyricsPlugin, config)

  return {
    ctx,
    player: (ctx as any).player as PlayerStub,
    sources: (ctx as any).sources as SourcesStub,
    db: (ctx as any).db as DbStub,
  }
}

describe('plugin-lyrics', () => {
  it('has valid plugin shape and exports', () => {
    expect(pluginLyrics.name).toBe('plugin-lyrics')
    expect(typeof apply).toBe('function')
  })

  it('initializes in idle state when no song is playing', async () => {
    const { ctx } = await createHarness()
    expect(ctx.lyrics.state.status).toBe('idle')
  })

  it('loads lyrics when player changes track', async () => {
    const { ctx, player, sources } = await createHarness()

    const sampleLrc = `[00:01.00]Hello world\n[00:05.00]Second line`
    sources.lyricsMap.set('s1', {
      format: 'lrc',
      content: sampleLrc,
      synced: true,
    })

    player.setTrack('BBeBee:mock:track:s1')

    // Wait for async fetch
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe(sampleLrc)
  })

  it('transitions to no-lyrics state when source has no lyrics', async () => {
    const { ctx, player } = await createHarness()

    player.setTrack('BBeBee:mock:track:unknown')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(ctx.lyrics.state.lyrics).toBeUndefined()
  })

  it('handles source errors gracefully without crashing', async () => {
    const { ctx, player } = await createHarness()

    player.setTrack('BBeBee:mock:track:error-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('error')
    expect(ctx.lyrics.state.error).toContain('Network timeout')
  })

  it('synchronizes active lyric index upon position updates', async () => {
    const { ctx, player, sources } = await createHarness()

    sources.lyricsMap.set('sync-track', {
      format: 'lrc',
      content: `[00:02.00]Line 1\n[00:06.00]Line 2`,
      synced: true,
    })

    let lastEmittedIdx = -1
    ctx.on('lyrics/active-changed', (idx) => {
      lastEmittedIdx = idx
    })

    player.setTrack('BBeBee:mock:track:sync-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    player.setPosition(1000)
    expect(lastEmittedIdx).toBe(-1)

    player.setPosition(3000)
    expect(lastEmittedIdx).toBe(0)

    player.setPosition(7000)
    expect(lastEmittedIdx).toBe(1)
  })

  it('persists and loads from SQLite database cache', async () => {
    const { player, sources, db } = await createHarness()

    sources.lyricsMap.set('cached-track', {
      format: 'lrc',
      content: `[00:01.00]Cached lyric`,
      synced: true,
    })

    player.setTrack('BBeBee:mock:track:cached-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(db.lyricsRows.has('BBeBee:mock:track:cached-track')).toBe(true)
  })

  it('caches negative lookup in memory to prevent repeated provider queries', async () => {
    const { player, sources, ctx } = await createHarness()

    // 1st play: unknown track without lyrics
    player.setTrack('BBeBee:mock:track:no-lrc-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(sources.getLyricsCallCount).toBe(1)

    // Repeat play / track re-triggered (e.g. single-loop or queue replay)
    player.setTrack('BBeBee:mock:track:no-lrc-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    // Should NOT have made a 2nd call to provider!
    expect(sources.getLyricsCallCount).toBe(1)
  })

  it('persists negative lookup to database with format none and restores it', async () => {
    const { player, sources, db } = await createHarness()

    player.setTrack('BBeBee:mock:track:empty-lrc')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const row = db.lyricsRows.get('BBeBee:mock:track:empty-lrc')
    expect(row).toBeDefined()
    expect(row.format).toBe('none')
    expect(row.content).toBe('')
    expect(sources.getLyricsCallCount).toBe(1)

    // Create a new harness sharing the same db to simulate app restart
    const harness2 = await createHarness(undefined, db.lyricsRows)
    harness2.sources.getLyricsCallCount = 0

    harness2.player.setTrack('BBeBee:mock:track:empty-lrc')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(harness2.ctx.lyrics.state.status).toBe('no-lyrics')
    // Should hit DB negative cache and NOT call provider
    expect(harness2.sources.getLyricsCallCount).toBe(0)
  })

  it('expires negative cache after configured TTL and re-queries', async () => {
    // 40ms negative cache TTL
    const { player, sources } = await createHarness({ negativeCacheTtlMs: 40 })

    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sources.getLyricsCallCount).toBe(1)

    // Query again before TTL -> hits negative cache
    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sources.getLyricsCallCount).toBe(1)

    // Wait until TTL expires (>40ms)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Query again after TTL -> cache expired, queries provider again
    player.setTrack('BBeBee:mock:track:expiring-track')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sources.getLyricsCallCount).toBe(2)
  })

  it('clears negative cache when retry is called', async () => {
    const { player, sources, ctx, db } = await createHarness()

    player.setTrack('BBeBee:mock:track:retry-track')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.lyrics.state.status).toBe('no-lyrics')
    expect(sources.getLyricsCallCount).toBe(1)
    expect(db.lyricsRows.get('BBeBee:mock:track:retry-track')?.format).toBe('none')

    // Now lyrics become available
    sources.lyricsMap.set('retry-track', {
      format: 'lrc',
      content: '[00:01.00]Now available',
      synced: true,
    })

    // Calling retry should clear negative cache and fetch the newly available lyrics
    await ctx.lyrics.retry()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sources.getLyricsCallCount).toBe(2)
    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:01.00]Now available')
    expect(db.lyricsRows.get('BBeBee:mock:track:retry-track')?.format).toBe('lrc')
  })

  it('queries ctx.lyricSources when audio source supports external lyric source', async () => {
    class LyricSourcesStub extends Service {
      lastQuery?: any
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics(query: any) {
        this.lastQuery = query
        return {
          format: 'lrc' as const,
          content: '[00:02.00]External Lyric',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const sources = (ctx as any).sources as SourcesStub
    const lyricSources = (ctx as any).lyricSources as LyricSourcesStub

    sources.sourceRecords.set('mock', {
      id: 'mock',
      name: 'Mock Source',
      needsLyricSource: true,
      doc: {},
    })

    player.transport.trackUrn = 'BBeBee:mock:track:external-needed'
    player.transport.durationMs = 200000
    player.transport.nowPlaying = {
      title: 'External Song',
      artist: 'External Artist',
    }

    player.setTrack('BBeBee:mock:track:external-needed')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:02.00]External Lyric')
    expect(ctx.lyrics.state.supportsLyricSource).toBe(true)
    expect(ctx.lyrics.state.sourceType).toBe('lyric-source')
    expect(lyricSources.lastQuery).toBeDefined()
    expect(lyricSources.lastQuery.title).toBe('External Song')
    expect(lyricSources.lastQuery.artist).toBe('External Artist')
  })

  it('does NOT query lyricSources when audio source has needsLyricSource set to false', async () => {
    class LyricSourcesStub extends Service {
      searchCount = 0
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics() {
        this.searchCount++
        return {
          format: 'lrc' as const,
          content: '[00:01.00]Should Not Be Called',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const sources = (ctx as any).sources as SourcesStub
    const lyricSources = (ctx as any).lyricSources as LyricSourcesStub

    sources.sourceRecords.set('disabled-src', {
      id: 'disabled-src',
      name: 'Disabled Lyric Source',
      needsLyricSource: false,
      doc: { ruleLyric: { url: 'https://example.com/lrc' } },
    })

    sources.lyricsMap.set('local-only-track', {
      format: 'lrc',
      content: '[00:03.00]Source Provider Builtin Lyric',
      synced: true,
      offsetMs: 0,
    })

    player.transport.trackUrn = 'BBeBee:disabled-src:track:local-only-track'
    player.transport.nowPlaying = {
      title: 'Builtin Song',
      artist: 'Builtin Artist',
    }

    player.setTrack('BBeBee:disabled-src:track:local-only-track')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:03.00]Source Provider Builtin Lyric')
    expect(ctx.lyrics.state.supportsLyricSource).toBe(false)
    expect(ctx.lyrics.state.sourceType).toBe('audio-provider')
    expect(lyricSources.searchCount).toBe(0) // LyricSources was NOT called!
  })

  it('prefers audio provider lyrics first, and falls back to lyricSources if audio provider has no lyrics', async () => {
    class LyricSourcesStub extends Service {
      searchCount = 0
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics() {
        this.searchCount++
        return {
          format: 'lrc' as const,
          content: '[00:05.00]Fallback External Lyric',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const sources = (ctx as any).sources as SourcesStub
    const lyricSources = (ctx as any).lyricSources as LyricSourcesStub

    sources.sourceRecords.set('hybrid-src', {
      id: 'hybrid-src',
      name: 'Hybrid Source',
      needsLyricSource: true,
      doc: { ruleLyric: { lyric: '=builtin' } },
    })

    // Track 1: Has built-in lyrics on the provider
    sources.lyricsMap.set('has-provider-lyric', {
      format: 'lrc',
      content: '[00:01.00]Provider Lyric',
      synced: true,
      offsetMs: 0,
    })

    player.transport.trackUrn = 'BBeBee:hybrid-src:track:has-provider-lyric'
    player.transport.nowPlaying = { title: 'Song 1', artist: 'Artist 1' }
    player.setTrack('BBeBee:hybrid-src:track:has-provider-lyric')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:01.00]Provider Lyric')
    expect(ctx.lyrics.state.sourceType).toBe('audio-provider')
    expect(lyricSources.searchCount).toBe(0) // Provider had lyrics, so lyricSources was NOT called!

    // Track 2: Provider has no lyrics (returns undefined), should fall back to lyricSources
    player.transport.trackUrn = 'BBeBee:hybrid-src:track:no-provider-lyric'
    player.transport.nowPlaying = { title: 'Song 2', artist: 'Artist 2' }
    player.setTrack('BBeBee:hybrid-src:track:no-provider-lyric')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:05.00]Fallback External Lyric')
    expect(ctx.lyrics.state.sourceType).toBe('lyric-source')
    expect(lyricSources.searchCount).toBe(1) // Fallback was invoked!
  })

  it('supports lyricSources for local files by default', async () => {
    class LyricSourcesStub extends Service {
      lastQuery?: any
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics(query: any) {
        this.lastQuery = query
        return {
          format: 'lrc' as const,
          content: '[00:04.00]Local File Lyric from LRCLIB',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const lyricSources = (ctx as any).lyricSources as LyricSourcesStub

    player.transport.trackUrn = 'BBeBee:local:track:hash123'
    player.transport.nowPlaying = {
      title: 'Jay Chou - Sunny Day',
      artist: 'Jay Chou',
    }

    player.setTrack('BBeBee:local:track:hash123')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:04.00]Local File Lyric from LRCLIB')
    expect(ctx.lyrics.state.supportsLyricSource).toBe(true)
    expect(lyricSources.lastQuery).toBeDefined()
  })

  it('re-fetches lyrics when nowPlaying metadata arrives asynchronously on player/state-changed', async () => {
    class LyricSourcesStub extends Service {
      queries: any[] = []
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics(query: any) {
        this.queries.push(query)
        if (query.title === 'Sunny Day') {
          return {
            format: 'lrc' as const,
            content: '[00:01.00]Sunny Day Lyrics',
            synced: true,
          }
        }
        return undefined
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(LyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub

    // Start with NO nowPlaying metadata (simulating async DB lookup in player)
    player.transport.trackUrn = 'BBeBee:mock:track:async-track'
    player.transport.nowPlaying = undefined

    player.setTrack('BBeBee:mock:track:async-track')
    await new Promise((resolve) => setTimeout(resolve, 50))

    // At first, no lyrics were found because title was not ready
    expect(ctx.lyrics.state.status).toBe('no-lyrics')

    // Now player resolves nowPlaying asynchronously and emits player/state-changed
    player.transport.nowPlaying = {
      title: 'Sunny Day',
      artist: 'Jay Chou',
    }
    ctx.emit('player/state-changed', player.transport)

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Now lyrics are fetched and ready!
    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:01.00]Sunny Day Lyrics')
  })

  it('persists fetched lyrics to SQLite and reuses DB cache on subsequent queries', async () => {
    const sharedDbRows = new Map<string, any>()
    const { ctx, player, sources } = await createHarness(undefined, sharedDbRows)

    sources.lyricsMap.set('cache-test', {
      format: 'lrc',
      content: '[00:05.00]Cached Lyric Content',
      synced: true,
      offsetMs: 0,
    })

    player.setTrack('BBeBee:mock:track:cache-test')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.status).toBe('ready')
    expect(ctx.lyrics.state.lyrics?.content).toBe('[00:05.00]Cached Lyric Content')
    expect(sources.getLyricsCallCount).toBe(1)
    expect(sharedDbRows.has('BBeBee:mock:track:cache-test')).toBe(true)

    // Now start a fresh instance sharing the same SQLite DB rows (simulating restart)
    const secondHarness = await createHarness(undefined, sharedDbRows)
    const lyricsFromCache = await secondHarness.ctx.lyrics.getLyricsForTrack('BBeBee:mock:track:cache-test')

    expect(lyricsFromCache).toBeDefined()
    expect(lyricsFromCache?.content).toBe('[00:05.00]Cached Lyric Content')
    // Source was NOT queried again because it came from SQLite DB!
    expect(secondHarness.sources.getLyricsCallCount).toBe(0)
  })

  it('persists offset updates to database cache', async () => {
    const sharedDbRows = new Map<string, any>()
    const { ctx, player, sources } = await createHarness(undefined, sharedDbRows)

    sources.lyricsMap.set('offset-test', {
      format: 'lrc',
      content: '[00:05.00]Offset Test',
      synced: true,
      offsetMs: 0,
    })

    player.setTrack('BBeBee:mock:track:offset-test')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(ctx.lyrics.state.offsetMs).toBe(0)
    ctx.lyrics.setOffset(250)
    expect(ctx.lyrics.state.offsetMs).toBe(250)

    const row = sharedDbRows.get('BBeBee:mock:track:offset-test')
    expect(row?.offset_ms).toBe(250)
  })

  it('clears cache via clearCache method', async () => {
    const sharedDbRows = new Map<string, any>()
    const { ctx, player, sources } = await createHarness(undefined, sharedDbRows)

    sources.lyricsMap.set('clear-test', {
      format: 'lrc',
      content: '[00:05.00]To Be Cleared',
      synced: true,
      offsetMs: 0,
    })

    player.setTrack('BBeBee:mock:track:clear-test')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(sharedDbRows.size).toBe(1)
    await ctx.lyrics.clearCache('BBeBee:mock:track:clear-test')
    expect(sharedDbRows.size).toBe(0)
  })

  it('cleanTrackTitle normalizes remastered and version noise from track titles', () => {
    expect(cleanTrackTitle('Demo Song (2021 Remastered)')).toBe('Demo Song')
    expect(cleanTrackTitle('Hotel California - 2013 Remaster')).toBe('Hotel California')
    expect(cleanTrackTitle('Let It Be (Remastered 2009)')).toBe('Let It Be')
    expect(cleanTrackTitle('Creep (Live at the Astoria)')).toBe('Creep')
    expect(cleanTrackTitle('One Last Kiss')).toBe('One Last Kiss')
    expect(cleanTrackTitle('Song (feat. Artist)')).toBe('Song')
  })

  it('deduplicates concurrent in-flight getLyricsForTrack calls into a single fetch', async () => {
    const { ctx, sources } = await createHarness()

    let resolveLyrics: (l: Lyrics) => void
    const slowFetchPromise = new Promise<Lyrics>((resolve) => {
      resolveLyrics = resolve
    })

    // Mock a slow provider that takes some time to resolve
    sources.customGetLyrics = async () => {
      return await slowFetchPromise
    }

    // Fire 3 concurrent calls for the exact same track
    const p1 = ctx.lyrics.getLyricsForTrack('BBeBee:mock:track:concurrent-test')
    const p2 = ctx.lyrics.getLyricsForTrack('BBeBee:mock:track:concurrent-test')
    const p3 = ctx.lyrics.getLyricsForTrack('BBeBee:mock:track:concurrent-test')

    // Resolve the promise
    resolveLyrics!({
      format: 'lrc',
      content: '[00:01.00]Concurrent Result',
      synced: true,
    })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1?.content).toBe('[00:01.00]Concurrent Result')
    expect(r2?.content).toBe('[00:01.00]Concurrent Result')
    expect(r3?.content).toBe('[00:01.00]Concurrent Result')

    // Only 1 underlying fetch occurred, not 3!
    expect(sources.getLyricsCallCount).toBe(1)
  })

  it('does NOT re-trigger fetch on player/state-changed if already loading or metadata is unchanged', async () => {
    class CountingLyricSourcesStub extends Service {
      callCount = 0
      constructor(c: Context) {
        super(c, 'lyricSources')
      }
      async searchLyrics() {
        this.callCount++
        return {
          format: 'lrc' as const,
          content: '[00:01.00]Synced Lyrics',
          synced: true,
        }
      }
    }

    const ctx = new Context()
    await ctx.plugin(PlayerStub)
    await ctx.plugin(SourcesStub)
    await ctx.plugin(DbStub)
    await ctx.plugin(CountingLyricSourcesStub)
    await ctx.plugin(LyricsPlugin)

    const player = (ctx as any).player as PlayerStub
    const lyricSources = (ctx as any).lyricSources as CountingLyricSourcesStub

    player.transport.nowPlaying = { title: 'First Song', artist: 'Artist' }
    player.setTrack('BBeBee:mock:track:state-dup-test')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(lyricSources.callCount).toBe(1)
    expect(ctx.lyrics.state.status).toBe('ready')

    // Emit state-changed with same title & artist (e.g. buffer update or volume change)
    ctx.emit('player/state-changed', player.transport)
    ctx.emit('player/state-changed', player.transport)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Still only called once!
    expect(lyricSources.callCount).toBe(1)
  })
})
