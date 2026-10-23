import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { DEFAULT_APP_SETTINGS, SourceFormatError } from '@BBeBee/protocol'
import type {
  HttpRequest,
  HttpService,
  HttpResponse,
  ImportOptions,
  ImportReport,
  LyricSourceDefinition,
  PluginInfo,
  PluginUpdateInfo,
  RegistryEntry,
  RegistryIndex,
  RegistryTask,
  RegistryUpdate,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import { apply, RegistryPlugin } from './index.js'
import { REGISTRY_VIEWS } from './views.js'
import { LOCK_STORE_KEY } from './lock.js'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const DEFAULT_ENDPOINT = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main/registry.json'
const INDEX_CACHE_KEY = 'registry.index-cache'
const PREFS_KEY = 'registry.prefs'

function makeSourceRecord(sourceUrl: string, version?: string): SourceRecord {
  const doc: Record<string, unknown> = { sourceUrl, sourceName: 'Foo Music' }
  if (version) doc['version'] = version
  return {
    id: 'foo-music-1234',
    sourceUrl,
    name: 'Foo Music',
    type: 'music',
    doc: doc as unknown as SourceRecord['doc'],
    docJson: JSON.stringify(doc),
    docHash: 'deadbeef',
    enabled: true,
    sortOrder: 0,
    allowedHosts: ['foo.example'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
}

function makeLyricSource(id: string, version?: string): LyricSourceDefinition {
  return {
    id,
    name: id,
    enabled: true,
    sortOrder: 0,
    script: '// noop',
    ...(version ? { version } : {}),
  }
}

/** A theme known to pass WCAG AA in both schemes: a built-in, re-identified. */
function makePassingTheme(id: string, version?: string): ThemeDefinition {
  return {
    ...midnightPurpleTheme,
    id,
    name: 'Registry Theme',
    ...(version ? { version } : {}),
  }
}

function makeFailingTheme(id: string): ThemeDefinition {
  const base = makePassingTheme(id)
  return {
    ...base,
    tokens: {
      ...base.tokens,
      text: { ...base.tokens.text, primary: base.tokens.bg.app },
    },
  }
}

/* ── mocks ───────────────────────────────────────────────────────────────── */

function makeResponse(url: string, bytes: Uint8Array, status = 200): HttpResponse {
  const text = new TextDecoder().decode(bytes)
  return {
    status,
    headers: { 'content-type': 'application/json' },
    url,
    text: async () => text,
    json: async () => JSON.parse(text),
    bytes: async () => bytes,
    stream: () => new ReadableStream<Uint8Array>(),
  }
}

interface HttpSpec {
  /** URL → JSON body (a string body is served verbatim). */
  json?: Record<string, unknown>
  /** URL → raw bytes body. */
  bytes?: Record<string, Uint8Array>
  /** URL → response status override (4xx/5xx). */
  status?: Record<string, number>
  /** URL → transport failure. */
  fail?: Record<string, Error>
}

function makeHttp(spec: HttpSpec): HttpService {
  // Read through `spec` lazily: a test may mutate the spec between calls.
  const getBytes = (url: string): Uint8Array => {
    const failure = spec.fail?.[url]
    if (failure) throw failure
    const raw = spec.bytes?.[url]
    if (raw) return raw
    const body = spec.json?.[url]
    if (body !== undefined) {
      return typeof body === 'string' ? new TextEncoder().encode(body) : new TextEncoder().encode(JSON.stringify(body))
    }
    if (spec.status?.[url] !== undefined) return new Uint8Array()
    throw new Error(`http mock: no route for ${url}`)
  }

  const service = (async (req: HttpRequest) => {
    return makeResponse(req.url, getBytes(req.url), spec.status?.[req.url])
  }) as HttpService

  service.get = (async <T,>(url: string) => {
    const response = await service({ url, method: 'GET' })
    if (response.status >= 400) throw new Error(`http mock: status ${response.status} for ${url}`)
    return (await response.json()) as T
  }) as HttpService['get']

  service.post = (async () => {
    throw new Error('http mock: post not supported')
  }) as HttpService['post']

  service.download = (async () => {
    throw new Error('http mock: download not supported')
  }) as never

  Object.defineProperty(service, 'cookies', { value: {} })

  return service
}

function makeStore() {
  const data = new Map<string, unknown>()
  const store = {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key)
    }),
    keys: vi.fn(async (prefix?: string) =>
      [...data.keys()].filter((key) => !prefix || key.startsWith(prefix)),
    ),
    namespace: vi.fn(() => store),
  }
  return { store, data }
}

/** Drain microtasks and timers so the init-time `ctx.inject` callbacks have run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface SetupOptions {
  http?: HttpSpec
  index?: RegistryIndex
  sources?: SourceRecord[]
  lyricSources?: LyricSourceDefinition[]
  themes?: ThemeDefinition[]
  plugins?: PluginInfo[]
  /** Delegate result of plugin-manager.checkUpdates() for plugin update checks. */
  pluginUpdates?: PluginUpdateInfo[]
  /** Do not provide the plugin-manager service (tests the unavailable-service error). */
  omitPluginManager?: boolean
  registryAutoCheck?: boolean
  autoCheckDelayMs?: number
  autoCheckIntervalMs?: number
}

function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  const { store, data } = makeStore()
  ctx.provide('store', store)

  const httpSpec: HttpSpec = options.http ?? {
    json: { [DEFAULT_ENDPOINT]: options.index ?? { entries: [] } },
  }
  ctx.provide('http', makeHttp(httpSpec))

  const sources = {
    sources: options.sources ?? [],
    import: vi.fn(async (_input: string, _opts?: ImportOptions): Promise<ImportReport> => ({
      added: [],
      updated: [],
      unchanged: [],
      rejected: [],
      conflicts: [],
    })),
  }
  ctx.provide('sources', sources)

  const lyricSources = {
    getSources: vi.fn(() => options.lyricSources ?? []),
    registerSource: vi.fn(async () => {}),
  }
  ctx.provide('lyricSources', lyricSources)

  const theme = {
    getThemes: vi.fn(() => options.themes ?? []),
    registerTheme: vi.fn(() => () => {}),
  }
  ctx.provide('theme', theme)

  const pluginManager = {
    list: vi.fn(() => options.plugins ?? []),
    installPlugin: vi.fn(async (id: string) => `installed ${id}`),
    uninstall: vi.fn(async (id: string) => `uninstalled ${id}`),
    checkUpdates: vi.fn(async () => options.pluginUpdates ?? []),
  }
  if (!options.omitPluginManager) {
    ctx.provide('plugin-manager', pluginManager)
  }

  const settingsSnapshot = { ...DEFAULT_APP_SETTINGS, registryAutoCheck: options.registryAutoCheck ?? false }
  const settings = {
    getSync: vi.fn(() => ({ ...settingsSnapshot })),
    get: vi.fn(async () => ({ ...settingsSnapshot })),
    update: vi.fn(async (partial: Record<string, unknown>) => partial),
  }
  ctx.provide('settings', settings)

  const plugin = new RegistryPlugin(ctx, {
    ...(options.autoCheckDelayMs === undefined ? {} : { autoCheckDelayMs: options.autoCheckDelayMs }),
    ...(options.autoCheckIntervalMs === undefined ? {} : { autoCheckIntervalMs: options.autoCheckIntervalMs }),
  })

  return { ctx, plugin, data, httpSpec, sources, lyricSources, theme, pluginManager, settings }
}

async function setupInitialized(options: SetupOptions = {}) {
  const harness = setup(options)
  await harness.plugin[RegistryPlugin.init]()
  await settle()
  return harness
}

function entryOf(partial: Partial<RegistryEntry> & Pick<RegistryEntry, 'id' | 'kind' | 'name'>): RegistryEntry {
  return partial as RegistryEntry
}

/* ── semver (re-exported from @BBeBee/toolkit) ───────────────────────────── */

describe('semver re-export', () => {
  it('keeps the ./semver subpath working after the move to the toolkit', async () => {
    const mod = await import('./semver.js')
    expect(mod.compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(mod.normalizeVersion('v2.3.4')).toBe('2.3.4')
  })
})

/* ── view contributions ──────────────────────────────────────────────────── */

describe('ui contributions', () => {
  it('contributes the registry route and the settings card when a ui service exists', async () => {
    const contributions: Array<{ kind?: string; id: string }> = []
    const harness = setup()
    harness.ctx.provide('ui', {
      contribute: (c: { kind?: string; id: string }) => {
        contributions.push(c)
        return () => {}
      },
    })
    await harness.plugin[RegistryPlugin.init]()
    await settle()

    expect(contributions).toEqual([
      expect.objectContaining({
        kind: 'route',
        id: REGISTRY_VIEWS.screen,
        path: '/registry',
        placement: ['tray'],
      }),
      expect.objectContaining({
        kind: 'settings',
        id: REGISTRY_VIEWS.settingsCard,
        section: 'sources',
        display: 'card',
      }),
    ])
  })
})

/* ── lastCheckedAt ───────────────────────────────────────────────────────── */

describe('lastCheckedAt', () => {
  it('is undefined before the first check and set after one', async () => {
    const { plugin } = await setupInitialized({
      index: { entries: [] },
    })
    expect(plugin.lastCheckedAt()).toBeUndefined()

    await plugin.checkUpdates()
    expect(plugin.lastCheckedAt()).toBeGreaterThan(0)
  })
})

describe('lastIndexFetchFailed', () => {
  it('tracks whether getIndex fell back to the cached copy', async () => {
    const { plugin, httpSpec, data } = await setupInitialized({
      index: { entries: [entryOf({ id: 'known', kind: 'theme', name: 'Known' })] },
    })
    await plugin.getIndex()
    expect(plugin.lastIndexFetchFailed()).toBe(false)

    // Offline: getIndex resolves with the cache, and says so.
    httpSpec.fail = { [DEFAULT_ENDPOINT]: new Error('offline') }
    data.set(INDEX_CACHE_KEY, { fetchedAt: 1, index: { entries: [] } })
    await plugin.getIndex()
    expect(plugin.lastIndexFetchFailed()).toBe(true)

    // Back online: the flag clears on the next good fetch.
    httpSpec.fail = undefined
    await plugin.getIndex()
    expect(plugin.lastIndexFetchFailed()).toBe(false)
  })
})

/* ── getIndex ────────────────────────────────────────────────────────────── */

describe('getIndex', () => {
  it('fetches the index and caches the last good copy', async () => {
    const index: RegistryIndex = { entries: [], generatedAt: '2026-01-01T00:00:00Z' }
    const { plugin, data } = await setupInitialized({ index })

    await expect(plugin.getIndex()).resolves.toEqual(index)
    const cached = data.get(INDEX_CACHE_KEY) as { fetchedAt: number; index: RegistryIndex }
    expect(cached.fetchedAt).toBeGreaterThan(0)
    expect(cached.index).toEqual(index)
  })

  it('falls back to the cached copy when the network fails', async () => {
    const good: RegistryIndex = { entries: [entryOf({ id: 'known', kind: 'theme', name: 'Known' })] }
    const { plugin, data } = await setupInitialized({
      http: { fail: { [DEFAULT_ENDPOINT]: new Error('offline') } },
    })
    data.set(INDEX_CACHE_KEY, { fetchedAt: 1, index: good })

    await expect(plugin.getIndex()).resolves.toEqual(good)
  })

  it('returns an empty index when the network fails and no cache exists', async () => {
    const { plugin } = await setupInitialized({
      http: { fail: { [DEFAULT_ENDPOINT]: new Error('offline') } },
    })
    await expect(plugin.getIndex()).resolves.toEqual({ entries: [] })
  })

  it('drops malformed entries and keeps valid ones', async () => {
    const { plugin } = await setupInitialized({
      http: {
        json: {
          [DEFAULT_ENDPOINT]: {
            entries: [
              { id: 'good', kind: 'theme', name: 'Good', version: '1.0.0' },
              { kind: 'theme', name: 'No id' },
              { id: 'bad-kind', kind: 'car', name: 'Bad kind' },
              'not an object',
            ],
          },
        },
      },
    })
    const index = await plugin.getIndex()
    expect(index.entries.map((entry) => entry.id)).toEqual(['good'])
  })

  it('refuses a malformed index document, serving the cache instead', async () => {
    const good: RegistryIndex = { entries: [entryOf({ id: 'known', kind: 'theme', name: 'Known' })] }
    const { plugin, data } = await setupInitialized({
      http: { json: { [DEFAULT_ENDPOINT]: { nope: true } } },
    })
    data.set(INDEX_CACHE_KEY, { fetchedAt: 1, index: good })

    await expect(plugin.getIndex()).resolves.toEqual(good)
  })

  it('prefers a configured endpoint over the default', async () => {
    const mirror = 'https://mirror.example/registry.json'
    const { plugin, data } = await setupInitialized({
      http: { json: { [mirror]: { entries: [{ id: 'from-mirror', kind: 'theme', name: 'Mirror' }] } } },
    })
    data.set(PREFS_KEY, { endpoint: mirror })

    const index = await plugin.getIndex()
    expect(index.entries.map((entry) => entry.id)).toEqual(['from-mirror'])
  })
})

/* ── checkUpdates ────────────────────────────────────────────────────────── */

describe('checkUpdates', () => {
  it('matches music sources by sourceUrl and treats a missing doc version as 0.0.0', async () => {
    const entry = entryOf({
      id: 'music-foo',
      kind: 'music-source',
      name: 'Foo Music',
      version: '1.1.0',
      sourceUrl: 'https://foo.example',
      downloadUrl: 'https://cdn.example/foo.json',
    })
    const { plugin } = await setupInitialized({
      index: { entries: [entry] },
      sources: [makeSourceRecord('https://foo.example')],
    })

    const updates = await plugin.checkUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      kind: 'music-source',
      id: 'music-foo',
      installedVersion: '0.0.0',
      availableVersion: '1.1.0',
      downloadUrl: 'https://cdn.example/foo.json',
    })
  })

  it('reports no update when the installed version equals the published one', async () => {
    const entry = entryOf({
      id: 'music-foo',
      kind: 'music-source',
      name: 'Foo Music',
      version: '1.0.0',
      sourceUrl: 'https://foo.example',
    })
    const { plugin } = await setupInitialized({
      index: { entries: [entry] },
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    await expect(plugin.checkUpdates()).resolves.toEqual([])
  })

  it('matches lyric sources by id and flags builtin installs', async () => {
    const { plugin } = await setupInitialized({
      index: {
        entries: [
          entryOf({ id: 'builtin-lrclib', kind: 'lyric-source', name: 'LRCLIB', version: '1.2.0' }),
          entryOf({ id: 'my-lyric', kind: 'lyric-source', name: 'My Lyric', version: '2.0.0' }),
          entryOf({ id: 'not-installed', kind: 'lyric-source', name: 'Ghost', version: '9.9.9' }),
        ],
      },
      lyricSources: [makeLyricSource('builtin-lrclib', '1.0.0'), makeLyricSource('my-lyric', '2.0.0')],
    })

    const updates = await plugin.checkUpdates()
    expect(updates.map((update) => update.id)).toEqual(['builtin-lrclib'])
    expect(updates[0]?.builtin).toBe(true)
    expect(updates[0]?.installedVersion).toBe('1.0.0')
  })

  it('matches themes by id', async () => {
    const { plugin } = await setupInitialized({
      index: {
        entries: [
          entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '2.0.0' }),
          entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External' }),
        ],
      },
      themes: [makePassingTheme('reg-theme', '1.0.0')],
    })

    const updates = await plugin.checkUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ kind: 'theme', id: 'reg-theme', installedVersion: '1.0.0', availableVersion: '2.0.0' })
  })

  it('delegates plugin update checks to the plugin-manager and maps the results', async () => {
    const { plugin, pluginManager } = await setupInitialized({
      index: {
        entries: [
          entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', npm: '@bbebee/ext-plugin' }),
          entryOf({ id: 'other-plugin', kind: 'plugin', name: 'Other' }),
        ],
      },
      pluginUpdates: [{ id: 'ext-plugin', installed: '0.8.0', latest: '0.9.0', npm: '@bbebee/ext-plugin' }],
    })

    const updates = await plugin.checkUpdates()
    expect(pluginManager.checkUpdates).toHaveBeenCalled()
    expect(updates).toEqual([
      {
        kind: 'plugin',
        id: 'ext-plugin',
        name: 'External',
        installedVersion: '0.8.0',
        availableVersion: '0.9.0',
      },
    ])
  })

  it('skips entries without a version', async () => {
    const { plugin } = await setupInitialized({
      index: {
        entries: [entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme' })],
      },
      themes: [makePassingTheme('reg-theme', '1.0.0')],
    })
    await expect(plugin.checkUpdates()).resolves.toEqual([])
  })

  it('emits the event with the full list, including when it is empty', async () => {
    const { ctx, plugin, httpSpec, data } = await setupInitialized({
      index: { entries: [entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '2.0.0' })] },
      themes: [makePassingTheme('reg-theme', '2.0.0')],
    })

    const seen: (readonly RegistryUpdate[])[] = []
    ctx.on('registry/updates-available', (updates) => seen.push(updates))

    await plugin.checkUpdates()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual([])

    // The registry publishes a newer version; the next check emits the update.
    httpSpec.json = {
      [DEFAULT_ENDPOINT]: { entries: [entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '3.0.0' })] },
    }
    await plugin.checkUpdates()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual([
      expect.objectContaining({ id: 'reg-theme', installedVersion: '2.0.0', availableVersion: '3.0.0' }),
    ])

    const prefs = data.get(PREFS_KEY) as { lastCheckAt?: number }
    expect(prefs.lastCheckAt).toBeGreaterThan(0)
  })

  it('skips every kind when no collaborator has been captured yet', async () => {
    // `setup()` without init: the optional collaborators are captured by the
    // init-time inject callbacks, so none of them is available here.
    const { plugin } = setup({
      index: { entries: [entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '2.0.0' })] },
      themes: [makePassingTheme('reg-theme', '1.0.0')],
    })
    await plugin.checkUpdates()
    expect(plugin.updates()).toEqual([])
  })
})

describe('updates', () => {
  it('returns the previous result without re-fetching', async () => {
    const { plugin } = await setupInitialized({
      index: { entries: [entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '2.0.0' })] },
      themes: [makePassingTheme('reg-theme', '1.0.0')],
    })
    const http = (plugin as unknown as { own: { http: HttpService } }).own.http
    const getSpy = vi.fn(http.get.bind(http))
    http.get = getSpy as HttpService['get']

    await plugin.checkUpdates()
    expect(plugin.updates()).toHaveLength(1)
    const fetchesAfterCheck = getSpy.mock.calls.length

    plugin.updates()
    plugin.updates()
    expect(getSpy.mock.calls.length).toBe(fetchesAfterCheck)
  })
})

/* ── fetchEntryDetails ───────────────────────────────────────────────────── */

describe('fetchEntryDetails', () => {
  it('returns the music document allowlist for the confirm dialog', async () => {
    const url = 'https://cdn.example/foo.json'
    const { plugin } = await setupInitialized({
      http: {
        json: { [url]: { sourceUrl: 'https://foo.example', allowedHosts: ['foo.example', 'cdn.foo.example'] } },
      },
    })
    const details = await plugin.fetchEntryDetails(
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', downloadUrl: url }),
    )
    expect(details.allowedHosts).toEqual(['foo.example', 'cdn.foo.example'])
    expect(details.isBuiltinInstall).toBe(false)
    expect(details.isLocallyModified).toBeUndefined()
  })

  it('flags a locally modified music source in fetchEntryDetails', async () => {
    const url = 'https://cdn.example/foo.json'
    const modifiedRecord = {
      ...makeSourceRecord('https://foo.example', '1.0.0'),
      locallyModified: true,
    }
    const { plugin } = await setupInitialized({
      http: {
        json: { [url]: { sourceUrl: 'https://foo.example', allowedHosts: ['foo.example'] } },
      },
      sources: [modifiedRecord],
    })
    const details = await plugin.fetchEntryDetails(
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', downloadUrl: url, sourceUrl: 'https://foo.example' }),
    )
    expect(details.isLocallyModified).toBe(true)
  })

  it('flags a builtin lyric-source install and surfaces its hosts', async () => {
    const url = 'https://cdn.example/lrclib.json'
    const { plugin } = await setupInitialized({
      http: { json: { [url]: { allowedHosts: ['lrclib.net'] } } },
    })
    const details = await plugin.fetchEntryDetails(
      entryOf({ id: 'builtin-lrclib', kind: 'lyric-source', name: 'LRCLIB', downloadUrl: url }),
    )
    expect(details.isBuiltinInstall).toBe(true)
    expect(details.allowedHosts).toEqual(['lrclib.net'])
  })

  it('returns the entry itself for a plugin (v2 fields), without fetching', async () => {
    const { plugin } = await setupInitialized({
      http: {
        fail: { 'https://api.github.com/repos/charlie/plugin/commits/HEAD': new Error('must not be fetched') },
      },
    })
    const entry = entryOf({
      id: 'ext-plugin',
      kind: 'plugin',
      name: 'External',
      repoUrl: 'https://github.com/charlie/plugin',
      npm: '@bbebee/ext-plugin',
      services: ['http'],
      platforms: ['desktop'],
    })
    const details = await plugin.fetchEntryDetails(entry)
    expect(details.entry).toEqual(entry)
    expect(details.repoUrl).toBe('https://github.com/charlie/plugin')
    expect(details.securityAudit).toBeUndefined()
    expect(details.allowedHosts).toBeUndefined()
  })
})

/* ── install ─────────────────────────────────────────────────────────────── */

describe('install', () => {
  it('routes a music source through ctx.sources.import with the fetched text', async () => {
    const url = 'https://cdn.example/foo-1.1.0.json'
    const document = JSON.stringify({ sourceUrl: 'https://foo.example', sourceName: 'Foo Music', version: '1.1.0' })
    const harness = await setupInitialized({
      http: { json: { [url]: document } },
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    harness.sources.import.mockResolvedValueOnce({
      added: [],
      updated: [{ record: makeSourceRecord('https://foo.example', '1.1.0'), changedFields: ['version'] }],
      unchanged: [],
      rejected: [],
      conflicts: [],
    })

    await harness.plugin.install(
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', downloadUrl: url, sourceUrl: 'https://foo.example' }),
    )
    expect(harness.sources.import).toHaveBeenCalledWith(document, { originUri: url })
  })

  it('forwards overwrite option to ctx.sources.import', async () => {
    const url = 'https://cdn.example/foo-1.1.0.json'
    const document = JSON.stringify({ sourceUrl: 'https://foo.example', sourceName: 'Foo Music', version: '1.1.0' })
    const harness = await setupInitialized({
      http: { json: { [url]: document } },
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    harness.sources.import.mockResolvedValueOnce({
      added: [],
      updated: [{ record: makeSourceRecord('https://foo.example', '1.1.0'), changedFields: ['version'] }],
      unchanged: [],
      rejected: [],
      conflicts: [],
    })

    await harness.plugin.install(
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', downloadUrl: url, sourceUrl: 'https://foo.example' }),
      { overwrite: true },
    )
    expect(harness.sources.import).toHaveBeenCalledWith(document, { originUri: url, overwrite: true })
  })

  it('throws with the rejection messages when the music document is not imported', async () => {
    const url = 'https://cdn.example/foo-broken.json'
    const harness = await setupInitialized({
      http: { json: { [url]: '{ "sourceUrl": broken' } },
    })
    harness.sources.import.mockResolvedValueOnce({
      added: [],
      updated: [],
      unchanged: [],
      rejected: [{ index: 0, sourceName: 'Foo Music', error: new SourceFormatError('missing ruleStream') }],
      conflicts: [],
    })

    await expect(
      harness.plugin.install(
        entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', downloadUrl: url, sourceUrl: 'https://foo.example' }),
      ),
    ).rejects.toThrow(/not imported — Foo Music: missing ruleStream/)
  })

  it('refuses a theme that fails the contrast check and registers one that passes', async () => {
    const failingUrl = 'https://cdn.example/bad-theme.json'
    const passingUrl = 'https://cdn.example/good-theme.json'
    const harness = await setupInitialized({
      http: {
        json: {
          [failingUrl]: makeFailingTheme('bad-theme'),
          [passingUrl]: makePassingTheme('good-theme', '2.0.0'),
        },
      },
    })

    await expect(
      harness.plugin.install(entryOf({ id: 'bad-theme', kind: 'theme', name: 'Bad', downloadUrl: failingUrl })),
    ).rejects.toThrow(/failed the contrast check/)
    expect(harness.theme.registerTheme).not.toHaveBeenCalled()

    await harness.plugin.install(entryOf({ id: 'good-theme', kind: 'theme', name: 'Good', downloadUrl: passingUrl }))
    expect(harness.theme.registerTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'good-theme', version: '2.0.0' }),
    )
  })

  it('refuses a lyric source without id/name/script and registers a complete one', async () => {
    const badUrl = 'https://cdn.example/bad-lyric.json'
    const goodUrl = 'https://cdn.example/good-lyric.json'
    const harness = await setupInitialized({
      http: {
        json: {
          [badUrl]: { id: 'x', name: 'No script here' },
          [goodUrl]: { id: 'good-lyric', name: 'Good Lyric', script: 'return null', allowedHosts: ['lyrics.example'] },
        },
      },
    })

    await expect(
      harness.plugin.install(entryOf({ id: 'bad-lyric', kind: 'lyric-source', name: 'Bad', downloadUrl: badUrl })),
    ).rejects.toThrow(/missing non-empty id\/name\/script/)

    await harness.plugin.install(entryOf({ id: 'good-lyric', kind: 'lyric-source', name: 'Good', downloadUrl: goodUrl }))
    expect(harness.lyricSources.registerSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'good-lyric', script: 'return null' }),
    )
  })

  it('delegates a plugin install to plugin-manager.installPlugin and writes no registry lock record', async () => {
    const harness = await setupInitialized()
    await harness.plugin.install(
      entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', npm: '@bbebee/ext-plugin', services: ['http'] }),
    )
    expect(harness.pluginManager.installPlugin).toHaveBeenCalledWith('ext-plugin')
    expect(await harness.plugin.getLockRecord('ext-plugin')).toBeUndefined()
  })

  it('surfaces a plugin-manager install failure', async () => {
    const harness = await setupInitialized()
    harness.pluginManager.installPlugin.mockRejectedValueOnce(new Error('npm: install failed: ETARGET'))
    await expect(
      harness.plugin.install(entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', npm: '@bbebee/ext-plugin' })),
    ).rejects.toThrow(/ETARGET/)
  })

  it('refuses a plugin install with guidance when the plugin-manager is unavailable', async () => {
    const harness = await setupInitialized({ omitPluginManager: true })
    await expect(
      harness.plugin.install(entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', npm: '@bbebee/ext-plugin' })),
    ).rejects.toThrow(/Settings → Plugin Market/)
  })

  it('refuses an entry without a downloadUrl', async () => {
    const { plugin } = await setupInitialized()
    await expect(
      plugin.install(entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music' })),
    ).rejects.toThrow(/no downloadUrl/)
  })
})

/* ── author repository artifact chain & security audit (Group 5) ─────────── */

describe('author repository artifact chain and security audit (Group 5)', () => {
  it('discovers registry index entries via GitHub Contents API across 4 directories', async () => {
    const musicItem = {
      id: 'music-api-source',
      kind: 'music-source',
      name: 'API Music Source',
      version: '1.0.0',
      repoUrl: 'https://github.com/alice/music-source',
    }
    const lyricItem = {
      id: 'lyric-api-source',
      kind: 'lyric-source',
      name: 'API Lyric Source',
      version: '1.2.0',
      repoUrl: 'https://github.com/bob/lyric-source',
    }
    const pluginItem = {
      id: 'plugin-api',
      kind: 'plugin',
      name: 'API Plugin',
      npm: '@bbebee/plugin-api',
      services: ['http'],
      platforms: ['desktop'],
      repoUrl: 'https://github.com/charlie/plugin',
    }
    const themeItem = {
      id: 'theme-api',
      kind: 'theme',
      name: 'API Theme',
      version: '1.0.0',
      repoUrl: 'https://github.com/dave/theme',
    }

    const harness = await setupInitialized({
      http: {
        json: {
          'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents/music-sources': [
            { name: 'alice.json', type: 'file', download_url: 'https://cdn.example/music.json' },
          ],
          'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents/lyric-sources': [
            { name: 'bob.json', type: 'file', download_url: 'https://cdn.example/lyric.json' },
          ],
          'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents/plugins': [
            { name: 'charlie.json', type: 'file', download_url: 'https://cdn.example/plugin.json' },
          ],
          'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents/themes': [
            { name: 'dave.json', type: 'file', download_url: 'https://cdn.example/theme.json' },
          ],
          'https://cdn.example/music.json': musicItem,
          'https://cdn.example/lyric.json': lyricItem,
          'https://cdn.example/plugin.json': pluginItem,
          'https://cdn.example/theme.json': themeItem,
        },
      },
    })

    const index = await harness.plugin.getIndex(true)
    expect(index.entries.length).toBe(4)
    expect(index.entries.map((e) => e.id)).toEqual([
      'music-api-source',
      'lyric-api-source',
      'plugin-api',
      'theme-api',
    ])
    // Schema v2 plugin fields survive sanitization.
    const pluginEntry = index.entries.find((e) => e.id === 'plugin-api')
    expect(pluginEntry?.npm).toBe('@bbebee/plugin-api')
    expect(pluginEntry?.services).toEqual(['http'])
    expect(pluginEntry?.platforms).toEqual(['desktop'])
  })

  it('installs a plugin without fetching the author repository (npm delegation)', async () => {
    // No http routes at all: any author-repo fetch would throw "no route".
    const harness = await setupInitialized({ http: { json: {} } })
    await harness.plugin.install(
      entryOf({ id: 'bad-plugin', kind: 'plugin', name: 'Bad Plugin', repoUrl: 'https://github.com/evil-author/bad-plugin', npm: '@evil/bad-plugin' }),
    )
    expect(harness.pluginManager.installPlugin).toHaveBeenCalledWith('bad-plugin')
  })

  it('keeps historical plugin lock records readable while new installs write none', async () => {
    const harness = await setupInitialized()
    // A record written by the retired GitHub-bundle flow.
    harness.data.set(LOCK_STORE_KEY, {
      version: 1,
      records: {
        'legacy-plugin': {
          id: 'legacy-plugin',
          kind: 'plugin',
          repo: 'https://github.com/good-author/safe-plugin',
          commit: 'commit-v1-sha',
          sha256: 'abc123',
          installedAt: 123,
        },
      },
    })

    const record = await harness.plugin.getLockRecord('legacy-plugin')
    expect(record?.kind).toBe('plugin')
    expect(record?.commit).toBe('commit-v1-sha')

    await harness.plugin.install(
      entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', npm: '@bbebee/ext-plugin' }),
    )
    expect(harness.pluginManager.installPlugin).toHaveBeenCalledWith('ext-plugin')
    expect(await harness.plugin.getLockRecord('ext-plugin')).toBeUndefined()
  })
})

/* ── the daily automatic check ───────────────────────────────────────────── */

describe('automatic checks', () => {
  it('schedules a check shortly after boot when enabled', async () => {
    const { ctx, data } = await setupInitialized({
      index: { entries: [] },
      registryAutoCheck: true,
      autoCheckDelayMs: 10,
      autoCheckIntervalMs: 3_600_000,
    })
    const seen: (readonly RegistryUpdate[])[] = []
    ctx.on('registry/updates-available', (updates) => seen.push(updates))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen.length).toBeGreaterThanOrEqual(1)
    const prefs = data.get(PREFS_KEY) as { lastCheckAt?: number }
    expect(prefs.lastCheckAt).toBeGreaterThan(0)
  })

  it('does not schedule when the toggle is off, and follows it when it flips', async () => {
    const harness = await setupInitialized({
      index: { entries: [] },
      registryAutoCheck: false,
      autoCheckDelayMs: 10,
    })
    const internals = harness.plugin as unknown as { autoCheckCancel?: () => void }
    expect(internals.autoCheckCancel).toBeUndefined()

    harness.ctx.emit('settings/changed', { ...DEFAULT_APP_SETTINGS, registryAutoCheck: true })
    expect(typeof internals.autoCheckCancel).toBe('function')

    harness.ctx.emit('settings/changed', { ...DEFAULT_APP_SETTINGS, registryAutoCheck: false })
    expect(internals.autoCheckCancel).toBeUndefined()
  })
})

/* ── the github-fetch download layer (Group 6) ───────────────────────────── */

describe('github-fetch integration', () => {
  it('walks the acceleration prefix chain when the official Contents API fails', async () => {
    const prefix = 'https://ghproxy.example.com'
    const base = 'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents'
    const harness = await setupInitialized({
      http: {
        status: {
          [`${base}/music-sources`]: 403,
          [`${base}/lyric-sources`]: 403,
          [`${base}/plugins`]: 403,
          [`${base}/themes`]: 403,
        },
        json: {
          [`${prefix}/${base}/music-sources`]: [
            { name: 'alice.json', type: 'file', download_url: 'https://cdn.example/music.json' },
          ],
          [`${prefix}/${base}/lyric-sources`]: [],
          [`${prefix}/${base}/plugins`]: [],
          [`${prefix}/${base}/themes`]: [],
          'https://cdn.example/music.json': {
            id: 'music-foo',
            kind: 'music-source',
            name: 'Foo Music',
            version: '1.0.0',
          },
        },
      },
    })
    harness.settings.getSync.mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      registryAutoCheck: false,
      githubAccelerationPrefixes: [prefix],
    })

    // Every directory answered through the prefix candidate; the author-hosted
    // download_url stayed a single official candidate.
    const index = await harness.plugin.getIndex()
    expect(index.entries.map((entry) => entry.id)).toEqual(['music-foo'])
  })

  it('serves the legacy registry.json fallback through jsDelivr when raw fails', async () => {
    const rawRegistryJson =
      'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main/registry.json'
    const viaJsDelivr = 'https://cdn.jsdelivr.net/gh/BBeBeeX/B_Be_Bee-registry@main/registry.json'
    const harness = await setupInitialized({
      http: {
        status: { [rawRegistryJson]: 403 },
        json: {
          [viaJsDelivr]: { entries: [{ id: 'via-jsdelivr', kind: 'theme', name: 'Via jsDelivr' }] },
        },
      },
    })

    const index = await harness.plugin.getIndex()
    expect(index.entries.map((entry) => entry.id)).toEqual(['via-jsdelivr'])
  })

  it('uses a configured endpoint override verbatim even with prefixes configured', async () => {
    const mirror = 'https://mirror.example/registry.json'
    const harness = await setupInitialized({
      http: { json: { [mirror]: { entries: [{ id: 'from-mirror', kind: 'theme', name: 'Mirror' }] } } },
    })
    harness.settings.getSync.mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      registryAutoCheck: false,
      githubAccelerationPrefixes: ['https://ghproxy.example.com'],
    })
    harness.data.set(PREFS_KEY, { endpoint: mirror })

    const index = await harness.plugin.getIndex()
    expect(index.entries.map((entry) => entry.id)).toEqual(['from-mirror'])
  })
})

/* ── the task center (Group 3) ───────────────────────────────────────────── */

describe('registry task center', () => {
  const musicUrl = 'https://cdn.example/foo-task.json'
  const musicDocument = JSON.stringify({ sourceUrl: 'https://foo.example', sourceName: 'Task Music' })
  const musicEntry = () =>
    entryOf({
      id: 'music-task',
      kind: 'music-source',
      name: 'Task Music',
      downloadUrl: musicUrl,
      sourceUrl: 'https://foo.example',
    })

  it('walks the lifecycle: fetch creates the task, the install completes it', async () => {
    const harness = await setupInitialized({
      http: { json: { [musicUrl]: musicDocument } },
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    harness.sources.import.mockResolvedValueOnce({
      added: [makeSourceRecord('https://foo.example', '1.1.0')],
      updated: [],
      unchanged: [],
      rejected: [],
      conflicts: [],
    })

    const seen: (readonly RegistryTask[])[] = []
    harness.ctx.on('registry/tasks-changed', (tasks) => seen.push(tasks))

    // The fetch runs download → verify, then parks at pending ("Awaiting confirmation").
    await harness.plugin.fetchEntryDetails(musicEntry())
    let tasks = harness.plugin.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      entryId: 'music-task',
      entryName: 'Task Music',
      kind: 'music-source',
      operation: 'install',
      status: 'pending',
      stage: 'verify',
    })
    expect(tasks[0]?.startedAt).toBeGreaterThan(0)
    expect(tasks[0]?.finishedAt).toBeUndefined()

    // The install resumes the same record and lands it as success.
    await harness.plugin.install(musicEntry())
    tasks = harness.plugin.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'success', stage: 'install' })
    expect(tasks[0]?.finishedAt).toBeGreaterThan(0)
    expect(tasks[0]?.error).toBeUndefined()

    // Every mutation announced the FULL snapshot; the last one matches getTasks().
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(seen[seen.length - 1]).toEqual(harness.plugin.getTasks())
  })

  it('reports the install stage while a domain import is in flight', async () => {
    const harness = await setupInitialized({
      http: { json: { [musicUrl]: musicDocument } },
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    let releaseImport: () => void = () => {}
    harness.sources.import.mockImplementationOnce(
      async () =>
        new Promise<ImportReport>((resolve) => {
          releaseImport = () =>
            resolve({
              added: [makeSourceRecord('https://foo.example', '1.1.0')],
              updated: [],
              unchanged: [],
              rejected: [],
              conflicts: [],
            })
        }),
    )

    const pendingInstall = harness.plugin.install(musicEntry())
    await vi.waitFor(() => expect(harness.plugin.getTasks()[0]?.stage).toBe('install'))
    expect(harness.plugin.getTasks()[0]).toMatchObject({ status: 'running' })

    releaseImport()
    await pendingInstall
    expect(harness.plugin.getTasks()[0]?.status).toBe('success')
  })

  it('fails the task when fetchEntryDetails throws, keeping the error text', async () => {
    const harness = await setupInitialized({
      http: { fail: { [musicUrl]: new Error('offline') } },
    })
    await expect(harness.plugin.fetchEntryDetails(musicEntry())).rejects.toThrow(/offline/)

    const tasks = harness.plugin.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ entryId: 'music-task', status: 'failed', stage: 'download' })
    expect(tasks[0]?.error).toContain('offline')
    expect(tasks[0]?.finishedAt).toBeGreaterThan(0)
  })

  it('fails the task with the error text when the install throws', async () => {
    const failingUrl = 'https://cdn.example/bad-theme-task.json'
    const harness = await setupInitialized({
      http: { json: { [failingUrl]: makeFailingTheme('bad-theme-task') } },
    })

    await expect(
      harness.plugin.install(entryOf({ id: 'bad-theme-task', kind: 'theme', name: 'Bad', downloadUrl: failingUrl })),
    ).rejects.toThrow(/failed the contrast check/)

    const tasks = harness.plugin.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'failed' })
    expect(tasks[0]?.error).toContain('failed the contrast check')
  })

  it('keeps a task pending when the dialog is abandoned, and reuses it on the next fetch', async () => {
    const harness = await setupInitialized({
      http: { json: { [musicUrl]: musicDocument } },
    })
    await harness.plugin.fetchEntryDetails(musicEntry())
    const first = harness.plugin.getTasks()[0]
    expect(first?.status).toBe('pending')

    // The user dismissed the confirm dialog. A later fetch of the same entry
    // resets the same record instead of piling up a duplicate.
    await harness.plugin.fetchEntryDetails(musicEntry())
    const tasks = harness.plugin.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe(first?.id)
    expect(tasks[0]?.status).toBe('pending')
  })

  it('produces no task when the diagnostics rescan re-fetches an entry', async () => {
    const harness = await setupInitialized({
      http: { json: { [musicUrl]: musicDocument } },
      sources: [makeSourceRecord('https://foo.example')],
    })
    harness.data.set(INDEX_CACHE_KEY, { fetchedAt: 1, index: { entries: [musicEntry()] } })

    await harness.plugin.rescanEntry('music-task')
    expect(harness.plugin.getTasks()).toEqual([])
  })

  it('clears only finished tasks — a pending one survives', async () => {
    const harness = await setupInitialized({
      http: {
        json: { [musicUrl]: musicDocument },
        fail: { 'https://cdn.example/broken-task.json': new Error('offline') },
      },
    })
    await expect(
      harness.plugin.fetchEntryDetails(
        // A music source: its fetch actually downloads, so the failure is real.
        entryOf({
          id: 'broken-task',
          kind: 'music-source',
          name: 'Broken',
          downloadUrl: 'https://cdn.example/broken-task.json',
        }),
      ),
    ).rejects.toThrow(/offline/)
    await harness.plugin.fetchEntryDetails(musicEntry())

    expect(harness.plugin.getTasks()).toHaveLength(2)
    harness.plugin.clearFinishedTasks()

    const remaining = harness.plugin.getTasks()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ entryId: 'music-task', status: 'pending' })
  })
})

/* ── the plugin entry point ──────────────────────────────────────────────── */

describe('apply', () => {
  it('registers the registry service on ctx', async () => {
    const ctx = new Context()
    const { store } = makeStore()
    ctx.provide('store', store)
    ctx.provide('http', makeHttp({ json: { [DEFAULT_ENDPOINT]: { entries: [] } } }))

    const dispose = await apply(ctx)
    expect(ctx.reflect.get('contentRegistry', false)).toBeInstanceOf(RegistryPlugin)
    await dispose()
  })
})

/* ── discovery: the generated index is not an entry ────────────────────── */

describe('discovery and the generated plugins/index.json', () => {
  it('does not count the generated index document as a malformed entry', async () => {
    const base = 'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents'
    const harness = await setupInitialized({
      http: {
        json: {
          [`${base}/music-sources`]: [],
          [`${base}/lyric-sources`]: [],
          [`${base}/plugins`]: [
            { name: 'index.json', type: 'file', download_url: 'https://cdn.example/plugins-index.json' },
            { name: 'bbebeex-good.json', type: 'file', download_url: 'https://cdn.example/good.json' },
            { name: 'bbebeex-broken.json', type: 'file', download_url: 'https://cdn.example/broken.json' },
          ],
          [`${base}/themes`]: [],
          // The generated index document itself: an object with
          // `entries`/`blocked`, no id/name — not an entry.
          'https://cdn.example/plugins-index.json': {
            entries: [{ id: 'inside-the-index', kind: 'plugin', name: 'Not A Discovery Result' }],
            blocked: [],
          },
          'https://cdn.example/good.json': {
            id: 'good-plugin',
            kind: 'plugin',
            name: 'Good Plugin',
            npm: '@bbebee/good-plugin',
          },
          // A genuinely malformed entry file: no id, no name.
          'https://cdn.example/broken.json': { nope: true },
        },
      },
    })

    const index = await harness.plugin.getIndex(true)
    expect(index.entries.map((e) => e.id)).toEqual(['good-plugin'])

    // Only the genuinely malformed file may be counted as dropped —
    // the generated index must not inflate the count (the field logs
    // showed a phantom "dropped 1 malformed entries" on every boot
    // precisely because discovery tried to eat the index as an entry).
    const cached = harness.data.get(INDEX_CACHE_KEY) as { anomalies?: { dropped: number } } | undefined
    expect(cached?.anomalies?.dropped).toBe(1)
  })
})

describe('theme packs', () => {
  it('installs a pack document by registering every variant with registry origin', async () => {
    const packUrl = 'https://cdn.example/acme-pack.json'
    const packDoc = {
      id: 'acme-pack',
      name: 'Acme Pack',
      version: '1.0.0',
      author: 'Acme',
      description: 'Two variants',
      variants: [makePassingTheme('acme-a', '1.0.0'), makePassingTheme('acme-b', '1.0.0')],
    }
    const harness = await setupInitialized({ http: { json: { [packUrl]: packDoc } } })

    await harness.plugin.install(
      entryOf({ id: 'acme-pack', kind: 'theme', name: 'Acme Pack', version: '1.0.0', downloadUrl: packUrl }),
    )

    expect(harness.theme.registerTheme).toHaveBeenCalledTimes(2)
    expect(harness.theme.registerTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acme-a', origin: 'registry', packId: 'acme-pack' }),
    )
    expect(harness.theme.registerTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acme-b', origin: 'registry', packId: 'acme-pack' }),
    )
    const record = await harness.plugin.getLockRecord('acme-pack')
    expect(record?.kind).toBe('theme')
  })

  it('refuses a pack when any variant fails the contrast check', async () => {
    const packUrl = 'https://cdn.example/bad-pack.json'
    const packDoc = {
      id: 'bad-pack',
      name: 'Bad Pack',
      variants: [makePassingTheme('ok-one', '1.0.0'), makeFailingTheme('bad-one')],
    }
    const harness = await setupInitialized({ http: { json: { [packUrl]: packDoc } } })

    await expect(
      harness.plugin.install(entryOf({ id: 'bad-pack', kind: 'theme', name: 'Bad Pack', downloadUrl: packUrl })),
    ).rejects.toThrow(/variant "bad-one".*failed the contrast check/)
    expect(harness.theme.registerTheme).not.toHaveBeenCalled()
  })

  it('carries pack summary fields through index sanitizing', async () => {
    const harness = await setupInitialized({
      index: {
        entries: [
          entryOf({
            id: 'deepmono',
            kind: 'theme',
            name: 'Deep Mono',
            version: '1.0.0',
            variantCount: 2,
            variants: [
              { id: 'deepmono-graphite', name: 'Graphite', isDark: true },
              { id: 'deepmono-paper', name: 'Paper', isDark: false },
            ],
            previewColors: ['#121214', '#17171A', '#E4E4E7'],
          } as never),
        ],
      },
    })
    const index = await harness.plugin.getIndex()
    const entry = index.entries.find((e) => e.id === 'deepmono')
    expect(entry?.variantCount).toBe(2)
    expect(entry?.variants?.map((v) => v.id)).toEqual(['deepmono-graphite', 'deepmono-paper'])
    expect(entry?.previewColors).toEqual(['#121214', '#17171A', '#E4E4E7'])
  })
})
