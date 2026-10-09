import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import {
  formatLrcTimestamp,
  normalizeToLyrics,
} from './normalizer.js'
import { checkAllowedHost, executeLyricSource } from './sandbox.js'
import {
  BUILTIN_LYRIC_SOURCES,
  BUILTIN_LRCLIB_SOURCE,
  LyricSourcesPlugin,
  STORE_LYRIC_SOURCES_KEY,
} from './index.js'
import type { HttpRequest, HttpService, LyricSourceDefinition } from '@BBeBee/protocol'

describe('Lyrics Normalizer', () => {
  it('formats milliseconds into standard LRC timestamp', () => {
    expect(formatLrcTimestamp(0)).toBe('[00:00.00]')
    expect(formatLrcTimestamp(65430)).toBe('[01:05.43]')
    expect(formatLrcTimestamp(125890)).toBe('[02:05.89]')
  })

  it('normalizes standard LRC string', () => {
    const raw = `[00:10.50]Hello world\n[00:15.00]Second line`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:10.50]Hello world')
  })

  it('normalizes LRCLIB JSON structure', () => {
    const raw = {
      id: 123,
      trackName: 'Test Song',
      syncedLyrics: `[00:05.00]Synced test\n[00:10.00]Another line`,
      plainLyrics: 'Synced test\nAnother line',
    }
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toBe(raw.syncedLyrics)
  })

  it('normalizes Netease dual-lyric structure with translations', () => {
    const raw = {
      lrc: { lyric: `[00:01.00]Hello\n[00:05.00]World` },
      tlyric: { lyric: `[00:01.00]你好\n[00:05.00]世界` },
    }
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:01.00]Hello')
    expect(lyrics?.content).toContain('[00:01.00]你好')
    expect(lyrics?.content).toContain('[00:05.00]World')
    expect(lyrics?.content).toContain('[00:05.00]世界')
  })

  it('normalizes line arrays with millisecond timestamps', () => {
    const raw = [
      { timeMs: 12000, text: 'First line' },
      { timeMs: 18500, text: 'Second line', translation: '第二行' },
    ]
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:12.00]First line')
    expect(lyrics?.content).toContain('[00:18.50]Second line')
    expect(lyrics?.content).toContain('[00:18.50]第二行')
  })

  it('handles TTML markup', () => {
    const raw = `<?xml version="1.0" encoding="utf-8"?><tt><body><div><p begin="00:01.00">Lyric</p></div></body></tt>`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('ttml')
    expect(lyrics?.synced).toBe(true)
  })

  it('handles plain text lyrics without timestamps', () => {
    const raw = `Just some plain lyrics\nNo timestamps here\nEnjoy the song`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('plain')
    expect(lyrics?.synced).toBe(false)
  })
})

describe('Sandbox & Security Boundaries', () => {
  it('strictly passes ONLY title, artist, and duration to the script', async () => {
    const source: LyricSourceDefinition = {
      id: 'test-sandbox-props',
      name: 'Sandbox Test',
      enabled: true,
      sortOrder: 0,
      script: `
        async function searchLyrics(query) {
          // Check that only title, artist, and duration are accessible
          const keys = Object.keys(query).sort();
          return JSON.stringify({
            keys,
            title: query.title,
            artist: query.artist,
            duration: query.duration,
            extra: query.sensitiveToken,
          });
        }
      `,
    }

    // Pass extra sensitive fields that must NOT leak
    const leakAttempt: any = {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      duration: 354000,
      sensitiveToken: 'secret_token_123',
      filePath: '/etc/passwd',
      urn: 'BBeBee:track:123',
    }

    const raw = await executeLyricSource(source, leakAttempt)
    const parsed = JSON.parse(raw as string)

    expect(parsed.keys).toEqual(['artist', 'duration', 'title'])
    expect(parsed.title).toBe('Bohemian Rhapsody')
    expect(parsed.artist).toBe('Queen')
    expect(parsed.duration).toBe(354000)
    expect(parsed.extra).toBeUndefined()
  })

  it('blocks host access to window, document, and process', async () => {
    const source: LyricSourceDefinition = {
      id: 'test-host-access',
      name: 'Host Access Test',
      enabled: true,
      sortOrder: 0,
      script: `
        async function searchLyrics(query) {
          const hasProcess = typeof process !== 'undefined';
          const hasWindow = typeof window !== 'undefined';
          const hasDoc = typeof document !== 'undefined';
          return JSON.stringify({ hasProcess, hasWindow, hasDoc });
        }
      `,
    }

    const raw = await executeLyricSource(source, { title: 'T', artist: 'A', duration: 100 })
    const parsed = JSON.parse(raw as string)
    expect(parsed.hasProcess).toBe(false)
    expect(parsed.hasWindow).toBe(false)
    expect(parsed.hasDoc).toBe(false)
  })

  it('enforces allowedHosts whitelist', () => {
    expect(() => {
      checkAllowedHost('https://api.evil.com/leak', ['lrclib.net', 'music.163.com'])
    }).toThrow(/blocked: not in allowedHosts/)

    expect(() => {
      checkAllowedHost('https://lrclib.net/api/get', ['lrclib.net'])
    }).not.toThrow()

    expect(() => {
      checkAllowedHost('https://sub.lrclib.net/api/get', ['lrclib.net'])
    }).not.toThrow()
  })
})

describe('LyricSourcesPlugin Service', () => {
  it('ships builtins generated from the sources/ documents', () => {
    // The per-platform code lives in sources/<dir>/; this package only
    // consumes the compiled module. Pin that the wiring stayed intact.
    expect(BUILTIN_LYRIC_SOURCES.length).toBeGreaterThan(0)
    expect(BUILTIN_LRCLIB_SOURCE.id).toBe('builtin-lrclib')
    expect(BUILTIN_LRCLIB_SOURCE.allowedHosts).toContain('lrclib.net')
    expect(BUILTIN_LRCLIB_SOURCE.version).toBe('1.3.0')
    expect(BUILTIN_LRCLIB_SOURCE.script).toContain('/api/get')
    expect(BUILTIN_LRCLIB_SOURCE.script).toContain('/api/search')
  })

  it('manages sources and priority execution', async () => {
    const ctx = new Context()
    await ctx.plugin(LyricSourcesPlugin)

    const sources = ctx.lyricSources.getSources()
    expect(sources.length).toBeGreaterThanOrEqual(1)
    expect(sources[0]?.id).toBe('builtin-lrclib')

    // Register a custom mock source with higher priority (sortOrder = -1)
    const customSource: LyricSourceDefinition = {
      id: 'custom-priority',
      name: 'Custom High Priority Source',
      enabled: true,
      sortOrder: -1,
      script: `
        async function searchLyrics(query) {
          if (query.title === 'PrioritySong') {
            return '[00:01.00]Priority Lyric';
          }
          return null;
        }
      `,
    }

    await ctx.lyricSources.registerSource(customSource)

    const list = ctx.lyricSources.getSources()
    expect(list[0]?.id).toBe('custom-priority')

    // Search lyrics should hit the custom source
    const result = await ctx.lyricSources.searchLyrics({
      title: 'PrioritySong',
      artist: 'Singer',
      duration: 180000,
    })

    expect(result).toBeDefined()
    expect(result?.content).toBe('[00:01.00]Priority Lyric')
    expect(result?.synced).toBe(true)

    // Disable custom source
    await ctx.lyricSources.setEnabled('custom-priority', false)
    const disabledList = ctx.lyricSources.getSources()
    const foundDisabled = disabledList.find((s) => s.id === 'custom-priority')
    expect(foundDisabled?.enabled).toBe(false)

    // Test source directly
    const testResult = await ctx.lyricSources.testSource('custom-priority', {
      title: 'PrioritySong',
      artist: 'Singer',
      duration: 180000,
    })
    expect(testResult.ok).toBe(true)
    expect(testResult.lyrics?.content).toBe('[00:01.00]Priority Lyric')

    // Remove source
    const removed = await ctx.lyricSources.removeSource('custom-priority')
    expect(removed).toBe(true)
    const afterRemove = await ctx.lyricSources.getSources()
    expect(afterRemove.some((s) => s.id === 'custom-priority')).toBe(false)
  })

  it('executes LRCLIB source with exact match /api/get', async () => {
    const mockHttp: HttpService = (async (req: HttpRequest) => {
      expect(req.url).toContain('https://lrclib.net/api/get')
      expect(req.url).toContain('track_name=Yellow')
      expect(req.url).toContain('artist_name=Coldplay')
      expect(req.url).toContain('duration=269')
      expect(req.headers?.['Lrclib-Client']).toBe('BBeBee-MusicPlayer/1.0.0')

      const responseBody = JSON.stringify({
        id: 999,
        trackName: 'Yellow',
        artistName: 'Coldplay',
        duration: 269,
        syncedLyrics: '[00:15.00]Look at the stars\n[00:20.00]Look how they shine for you',
        plainLyrics: 'Look at the stars\nLook how they shine for you',
      })

      return {
        status: 200,
        headers: {},
        text: async () => responseBody,
        json: async () => JSON.parse(responseBody),
        arrayBuffer: async () => new ArrayBuffer(0),
        stream: () => ({} as any),
      }
    }) as unknown as HttpService

    const raw = await executeLyricSource(
      BUILTIN_LRCLIB_SOURCE,
      { title: 'Yellow', artist: 'Coldplay', duration: 269000 },
      { http: mockHttp },
    )

    const normalized = normalizeToLyrics(raw)
    expect(normalized).toBeDefined()
    expect(normalized?.format).toBe('lrc')
    expect(normalized?.synced).toBe(true)
    expect(normalized?.content).toContain('[00:15.00]Look at the stars')
  })

  it('executes LRCLIB source with fallback /api/search when /api/get returns 404', async () => {
    let searchCalled = false
    const mockHttp: HttpService = (async (req: HttpRequest) => {
      if (req.url.includes('/api/get')) {
        return {
          status: 404,
          headers: {},
          text: async () => JSON.stringify({ error: 'Not found' }),
          json: async () => ({ error: 'Not found' }),
          arrayBuffer: async () => new ArrayBuffer(0),
          stream: () => ({} as any),
        }
      }

      if (req.url.includes('/api/search')) {
        searchCalled = true
        expect(req.url).toContain('Coldplay')
        const responseBody = JSON.stringify([
          {
            id: 1001,
            trackName: 'Yellow (Live)',
            artistName: 'Coldplay',
            duration: 320,
            syncedLyrics: '[00:10.00]Live version',
          },
          {
            id: 1002,
            trackName: 'Yellow',
            artistName: 'Coldplay',
            duration: 269,
            syncedLyrics: '[00:15.00]Studio matched by duration',
          },
        ])

        return {
          status: 200,
          headers: {},
          text: async () => responseBody,
          json: async () => JSON.parse(responseBody),
          arrayBuffer: async () => new ArrayBuffer(0),
          stream: () => ({} as any),
        }
      }

      throw new Error(`Unexpected url: ${req.url}`)
    }) as unknown as HttpService

    const raw = await executeLyricSource(
      BUILTIN_LRCLIB_SOURCE,
      { title: 'Yellow', artist: 'Coldplay', duration: 269000 },
      { http: mockHttp },
    )

    expect(searchCalled).toBe(true)
    const normalized = normalizeToLyrics(raw)
    expect(normalized).toBeDefined()
    expect(normalized?.content).toBe('[00:15.00]Studio matched by duration')
  })

  it('returns the instrumental marker on an exact instrumental match', async () => {
    const mockHttp: HttpService = (async (_req: HttpRequest) => {
      const responseBody = JSON.stringify({
        id: 5001,
        trackName: 'Yellow',
        artistName: 'Coldplay',
        duration: 269,
        instrumental: true,
        syncedLyrics: '',
        plainLyrics: null,
      })

      return {
        status: 200,
        headers: {},
        text: async () => responseBody,
        json: async () => JSON.parse(responseBody),
        arrayBuffer: async () => new ArrayBuffer(0),
        stream: () => ({} as any),
      }
    }) as unknown as HttpService

    const raw = await executeLyricSource(
      BUILTIN_LRCLIB_SOURCE,
      { title: 'Yellow', artist: 'Coldplay', duration: 269000 },
      { http: mockHttp },
    )

    expect(raw).toBe('[00:00.00]纯音乐，请欣赏')
  })

  it('propagates network error when all endpoints throw', async () => {
    const failingHttp: HttpService = (async () => {
      throw new Error('Network request failed: getaddrinfo EAI_AGAIN')
    }) as unknown as HttpService

    await expect(
      executeLyricSource(
        BUILTIN_LRCLIB_SOURCE,
        { title: 'Any Song', artist: 'Any Artist', duration: 180000 },
        { http: failingHttp },
      ),
    ).rejects.toThrow('Network request failed: getaddrinfo EAI_AGAIN')
  })

  it('supports URLSearchParams in sandbox script', async () => {
    const source: LyricSourceDefinition = {
      id: 'test-url-params',
      name: 'URLSearchParams Test',
      enabled: true,
      sortOrder: 0,
      script: `
        async function searchLyrics(query) {
          const params = new URLSearchParams({ track: query.title, artist: query.artist });
          params.append('duration', String(query.duration));
          return '[00:00.00]' + params.toString();
        }
      `,
    }

    const raw = await executeLyricSource(source, { title: 'Hello', artist: 'Adele', duration: 240000 })
    expect(raw).toBe('[00:00.00]track=Hello&artist=Adele&duration=240000')
  })

  it('upgrades outdated stored builtin source on init', async () => {
    const ctx = new Context()
    const fakeStore: Record<string, unknown> = {
      [STORE_LYRIC_SOURCES_KEY]: [
        {
          id: 'builtin-lrclib',
          name: 'Old LRCLIB',
          version: '1.0.0',
          author: 'Old',
          enabled: false,
          sortOrder: 5,
          allowedHosts: ['lrclib.net'],
          script: 'old script without toQueryString',
        },
      ],
    }

    ctx.provide('store', {
      get: async (k: string) => fakeStore[k],
      set: async (k: string, v: unknown) => {
        fakeStore[k] = v
      },
    })

    const plugin = new LyricSourcesPlugin(ctx)
    await plugin[Service.init]()

    const sources = plugin.getSources()
    const builtin = sources.find((s) => s.id === 'builtin-lrclib')
    expect(builtin).toBeDefined()
    expect(builtin?.version).toBe(BUILTIN_LRCLIB_SOURCE.version)
    expect(builtin?.enabled).toBe(false)
    expect(builtin?.sortOrder).toBe(5)
    expect(builtin?.script).toContain('toQueryString')
  })

  it('preserves newer registry-updated stored builtin source on init', async () => {
    const ctx = new Context()
    const fakeStore: Record<string, unknown> = {
      [STORE_LYRIC_SOURCES_KEY]: [
        {
          id: 'builtin-lrclib',
          name: 'Updated LRCLIB',
          version: '2.0.0',
          author: 'LRCLIB Community',
          enabled: true,
          sortOrder: 2,
          allowedHosts: ['lrclib.net'],
          script: '// updated script from registry',
        },
      ],
    }

    ctx.provide('store', {
      get: async (k: string) => fakeStore[k],
      set: async (k: string, v: unknown) => {
        fakeStore[k] = v
      },
    })

    const plugin = new LyricSourcesPlugin(ctx)
    await plugin[Service.init]()

    const sources = plugin.getSources()
    const builtin = sources.find((s) => s.id === 'builtin-lrclib')
    expect(builtin).toBeDefined()
    expect(builtin?.version).toBe('2.0.0')
    expect(builtin?.name).toBe('Updated LRCLIB')
    expect(builtin?.script).toBe('// updated script from registry')
    expect(builtin?.enabled).toBe(true)
    expect(builtin?.sortOrder).toBe(2)
  })

  it('testSource reports clean error when no lyrics found', async () => {
    const emptyHttp: HttpService = (async (req: HttpRequest) => {
      if (req.url.includes('/api/get')) {
        return {
          status: 404,
          headers: {},
          text: async () => JSON.stringify({ error: 'Not found' }),
          json: async () => ({ error: 'Not found' }),
          arrayBuffer: async () => new ArrayBuffer(0),
          stream: () => ({} as any),
        }
      }
      return {
        status: 200,
        headers: {},
        text: async () => JSON.stringify([]),
        json: async () => [],
        arrayBuffer: async () => new ArrayBuffer(0),
        stream: () => ({} as any),
      }
    }) as unknown as HttpService

    const ctx = new Context()
    ctx.provide('http', emptyHttp)
    await ctx.plugin(LyricSourcesPlugin)

    const res = await ctx.lyricSources.testSource('builtin-lrclib', {
      title: 'Nonexistent Song',
      artist: 'Unknown Artist',
      duration: 100000,
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('未检索到匹配歌词')
  })

  it('preserves lyricSources capability context when called from another scoped plugin context', async () => {
    let seenConfig: unknown
    class DummyHttp extends Service {
      static override readonly name = 'http'
      constructor(c: Context) {
        super(c, 'http')
      }
      async [Service.invoke](_req: HttpRequest) {
        seenConfig = this[Service.resolveConfig]()
        return {
          status: 200,
          headers: {},
          text: async () => JSON.stringify({ syncedLyrics: '[00:01.00]Scoped Lyric' }),
          json: async () => ({ syncedLyrics: '[00:01.00]Scoped Lyric' }),
          arrayBuffer: async () => new ArrayBuffer(0),
          stream: () => ({} as any),
        }
      }
    }

    const root = new Context()
    await root.plugin(DummyHttp)

    // plugin-lyric-sources has net:host/*
    const scopedSources = root.intercept('http', {
      pluginId: '@BBeBee/plugin-lyric-sources',
      granted: ['net:host/*'],
    })
    await scopedSources.plugin(LyricSourcesPlugin)

    // settings-ui-desktop has no net:host/*
    const scopedSettings = root.intercept('http', {
      pluginId: '@BBeBee/plugin-settings-ui-desktop',
      granted: [],
    })

    const svcFromSettings = scopedSettings.reflect.get('lyricSources', false) as LyricSourcesPlugin
    const res = await svcFromSettings.testSource('builtin-lrclib', {
      title: 'Yellow',
      artist: 'Coldplay',
      duration: 269000,
    })

    expect(res.ok).toBe(true)
    expect(seenConfig).toMatchObject({
      pluginId: '@BBeBee/plugin-lyric-sources',
    })
  })
})
