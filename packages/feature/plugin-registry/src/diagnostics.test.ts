/**
 * Diagnostics tests — `getDiagnostics()` / `rescanEntry()` and the state they
 * are built from. The harness mirrors `index.test.ts` (in-memory store, routed
 * http mock) but stays self-contained so the two files can evolve in parallel.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import type {
  Finding,
  HttpService,
  HttpRequest,
  HttpResponse,
  LyricSourceDefinition,
  PluginInfo,
  RegistryEntry,
  RegistryIndex,
  RegistryService,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import { RegistryPlugin } from './index.js'
import { LOCK_STORE_KEY } from './lock.js'
import type { RegistryLockFile } from '@BBeBee/protocol'
import {
  AUDIT_FINDINGS_KEY,
  CAPABILITY_MISMATCHES_KEY,
} from './diagnostics.js'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const REGISTRY_JSON_URL = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main/registry.json'
const INDEX_CACHE_KEY = 'registry.index-cache'

function entryOf(partial: Partial<RegistryEntry> & Pick<RegistryEntry, 'id' | 'kind' | 'name'>): RegistryEntry {
  return partial as RegistryEntry
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

function makeTheme(id: string, version?: string): ThemeDefinition {
  return {
    ...midnightPurpleTheme,
    id,
    name: `Theme ${id}`,
    ...(version ? { version } : {}),
  }
}

function makePluginInfo(id: string, version: string, dependencies: string[] = []): PluginInfo {
  return {
    id,
    name: id,
    displayName: id,
    version,
    systemId: 'layer-4',
    enabled: true,
    state: 'ACTIVE',
    waitingFor: [],
    dependencies,
    dependents: [],
  }
}

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

function lockRecordOf(id: string, kind: RegistryLockFile['records'][string]['kind'], installedAt = 1_000) {
  return { id, kind, repo: `https://github.com/example/${id}`, commit: 'c0ffee', sha256: 'a'.repeat(64), installedAt }
}

function auditFinding(level: 'block' | 'warn', message: string): Finding {
  return { ruleId: 'test-rule', level, message }
}

/* ── mocks (same shape as index.test.ts) ─────────────────────────────────── */

function makeResponse(url: string, body: string, status = 200): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    url,
    text: async () => body,
    json: async () => JSON.parse(body),
    bytes: async () => new TextEncoder().encode(body),
    stream: () => new ReadableStream<Uint8Array>(),
  }
}

interface HttpSpec {
  json?: Record<string, unknown>
  bytes?: Record<string, Uint8Array>
  fail?: Record<string, Error>
}

function makeHttp(spec: HttpSpec): HttpService {
  const getBytes = (url: string): Uint8Array => {
    const failure = spec.fail?.[url]
    if (failure) throw failure
    const raw = spec.bytes?.[url]
    if (raw) return raw
    const body = spec.json?.[url]
    if (body !== undefined) {
      return new TextEncoder().encode(JSON.stringify(body))
    }
    throw new Error(`http mock: no route for ${url}`)
  }

  const service = (async (req: HttpRequest) => {
    return makeResponse(req.url, new TextDecoder().decode(getBytes(req.url)))
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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface SetupOptions {
  http?: HttpSpec
  sources?: SourceRecord[]
  lyricSources?: LyricSourceDefinition[]
  themes?: ThemeDefinition[]
  plugins?: PluginInfo[]
}

function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  const { store, data } = makeStore()
  ctx.provide('store', store)
  ctx.provide('http', makeHttp(options.http ?? {}))

  ctx.provide('sources', { sources: options.sources ?? [] })
  ctx.provide('lyricSources', { getSources: () => options.lyricSources ?? [] })
  ctx.provide('theme', { getThemes: () => options.themes ?? [] })
  ctx.provide('plugin-manager', { list: () => options.plugins ?? [] })

  const settingsSnapshot = { ...DEFAULT_APP_SETTINGS, registryAutoCheck: false }
  ctx.provide('settings', {
    getSync: () => ({ ...settingsSnapshot }),
    get: async () => ({ ...settingsSnapshot }),
  })

  const plugin = new RegistryPlugin(ctx)
  return { ctx, plugin, data }
}

async function setupInitialized(options: SetupOptions = {}) {
  const harness = setup(options)
  await harness.plugin[RegistryPlugin.init]()
  await settle()
  return harness
}

/** Seed the persisted index cache directly — the diagnostics read it verbatim. */
function seedIndexCache(data: Map<string, unknown>, entries: RegistryEntry[], fetchedAt = Date.now()): void {
  data.set(INDEX_CACHE_KEY, { fetchedAt, index: { entries } satisfies RegistryIndex })
}

function seedLock(data: Map<string, unknown>, records: Record<string, ReturnType<typeof lockRecordOf>>): void {
  data.set(LOCK_STORE_KEY, { version: 1, records } satisfies RegistryLockFile)
}

/* ── duplicate index ids ─────────────────────────────────────────────────── */

describe('getDiagnostics — index anomalies', () => {
  it('reports duplicate index ids as a conflict and a metadata warning, keeping the first entry', async () => {
    const harness = await setupInitialized({
      http: {
        json: {
          [REGISTRY_JSON_URL]: {
            entries: [
              entryOf({ id: 'dupe', kind: 'theme', name: 'First', version: '1.0.0' }),
              entryOf({ id: 'dupe', kind: 'theme', name: 'Second' }),
            ],
          },
        },
      },
    })

    const index = await harness.plugin.getIndex()
    expect(index.entries.map((entry) => entry.name)).toEqual(['First'])

    const report = await harness.plugin.getDiagnostics()
    const duplicate = report.conflicts.find((item) => item.id === 'duplicate-id:dupe')
    expect(duplicate).toBeDefined()
    expect(duplicate?.kind).toBe('theme')
    const anomaly = report.warnings.find((item) => item.id === 'metadata-anomalies')
    expect(anomaly?.message).toContain('dupe')
  })

  it('emits no anomaly warning for a clean index', async () => {
    const harness = await setupInitialized({
      http: {
        json: { [REGISTRY_JSON_URL]: { entries: [entryOf({ id: 'clean', kind: 'theme', name: 'Clean' })] } },
      },
    })
    await harness.plugin.getIndex()
    const report = await harness.plugin.getDiagnostics()
    expect(report.warnings.find((item) => item.id === 'metadata-anomalies')).toBeUndefined()
  })
})

/* ── lock vs installed ───────────────────────────────────────────────────── */

describe('getDiagnostics — lock/integrity conflicts', () => {
  it('reports a lock record whose content is no longer installed (lock-orphan)', async () => {
    const harness = await setupInitialized({
      lyricSources: [],
    })
    seedLock(harness.data, { 'gone-lyric': lockRecordOf('gone-lyric', 'lyric-source') })

    const report = await harness.plugin.getDiagnostics()
    const orphan = report.conflicts.find((item) => item.id === 'lock-orphan:gone-lyric')
    expect(orphan).toBeDefined()
    expect(orphan?.kind).toBe('lyric-source')
  })

  it('reports installed content matching an index entry without a lock record, exempting builtins', async () => {
    const harness = await setupInitialized({
      lyricSources: [makeLyricSource('my-lyric', '1.0.0'), makeLyricSource('builtin-lrclib', '1.0.0')],
      themes: [makeTheme('my-theme', '1.0.0')],
    })
    seedIndexCache(harness.data, [
      entryOf({ id: 'my-lyric', kind: 'lyric-source', name: 'My Lyric' }),
      entryOf({ id: 'builtin-lrclib', kind: 'lyric-source', name: 'LRCLIB' }),
      entryOf({ id: 'my-theme', kind: 'theme', name: 'My Theme' }),
    ])

    const report = await harness.plugin.getDiagnostics()
    const ids = report.conflicts.map((item) => item.id)
    expect(ids).toContain('lock-missing:my-lyric')
    expect(ids).toContain('lock-missing:my-theme')
    // The builtin lyric source ships with the app and never gets a lock record.
    expect(ids).not.toContain('lock-missing:builtin-lrclib')
  })

  it('flags a music source only when the index entry proves registry provenance', async () => {
    const harness = await setupInitialized({
      sources: [makeSourceRecord('https://foo.example', '1.0.0')],
    })
    seedIndexCache(harness.data, [
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', sourceUrl: 'https://foo.example' }),
    ])

    const report = await harness.plugin.getDiagnostics()
    expect(report.conflicts.map((item) => item.id)).toContain('lock-missing:music-foo')

    // Installed content absent from the index may be a manual import — the
    // registry cannot judge it, so it stays silent rather than guessing.
    const manual = await setupInitialized({ sources: [makeSourceRecord('https://manual.example', '1.0.0')] })
    const manualReport = await manual.plugin.getDiagnostics()
    expect(manualReport.conflicts.filter((item) => item.id.startsWith('lock-missing:'))).toEqual([])
  })

  it('reports a music-source lock record as orphaned only when its entry is in the index', async () => {
    const harness = await setupInitialized({
      sources: [], // the entry exists in the index but nothing is installed
    })
    seedIndexCache(harness.data, [
      entryOf({ id: 'music-foo', kind: 'music-source', name: 'Foo Music', sourceUrl: 'https://foo.example' }),
    ])
    seedLock(harness.data, { 'music-foo': lockRecordOf('music-foo', 'music-source') })

    const report = await harness.plugin.getDiagnostics()
    expect(report.conflicts.map((item) => item.id)).toContain('lock-orphan:music-foo')

    // Without the index entry, installedness cannot be determined — skipped.
    const blind = await setupInitialized()
    seedLock(blind.data, { 'no-such-source': lockRecordOf('no-such-source', 'music-source') })
    const blindReport = await blind.plugin.getDiagnostics()
    expect(blindReport.conflicts.filter((item) => item.id.startsWith('lock-orphan:'))).toEqual([])
  })
})

/* ── security-audit risks & rescan ───────────────────────────────────────── */

describe('getDiagnostics — audit risks and rescanEntry', () => {
  it('generates a risk per entry with persisted findings, and rescanEntry clears a fixed one', async () => {
    const harness = await setupInitialized({
      http: {
        json: { 'https://cdn.example/foo.json': { sourceUrl: 'https://foo.example' } },
      },
      sources: [],
    })
    seedIndexCache(harness.data, [
      entryOf({
        id: 'music-foo',
        kind: 'music-source',
        name: 'Foo Music',
        sourceUrl: 'https://foo.example',
        downloadUrl: 'https://cdn.example/foo.json',
      }),
    ])
    harness.data.set(AUDIT_FINDINGS_KEY, {
      'music-foo': {
        level: 'block',
        findings: [auditFinding('block', 'Dangerous constructor'), auditFinding('warn', 'Suspicious string')],
        checkedAt: 1_234,
      },
    })

    const before = await harness.plugin.getDiagnostics()
    const risk = before.risks.find((item) => item.id === 'audit:music-foo')
    expect(risk).toBeDefined()
    expect(risk?.entryId).toBe('music-foo')
    expect(risk?.message).toContain('1 个 block')
    expect(risk?.message).toContain('1 个 warn')
    expect(risk?.message).toContain('Dangerous constructor')

    // The document now scans clean: the record is deleted, the risk disappears.
    await harness.plugin.rescanEntry('music-foo')
    const findings = harness.data.get(AUDIT_FINDINGS_KEY) as Record<string, unknown>
    expect(findings['music-foo']).toBeUndefined()
    const after = await harness.plugin.getDiagnostics()
    expect(after.risks).toEqual([])
  })

  it('replaces stale findings with the fresh scan result on rescan', async () => {
    const harness = await setupInitialized({
      http: {
        bytes: {
          'https://cdn.example/foo.json': new TextEncoder().encode(
            JSON.stringify({ sourceUrl: 'https://foo.example', allowedHosts: ['foo.example'] }),
          ),
        },
      },
    })
    seedIndexCache(harness.data, [
      entryOf({
        id: 'music-foo',
        kind: 'music-source',
        name: 'Foo Music',
        sourceUrl: 'https://foo.example',
        downloadUrl: 'https://cdn.example/foo.json',
      }),
    ])

    // No persisted findings at all → fetchEntryDetails persists the (empty) outcome.
    await harness.plugin.rescanEntry('music-foo')
    expect(harness.data.get(AUDIT_FINDINGS_KEY)).toEqual({})
  })

  it('rejects a rescan for an entry missing from the cached index', async () => {
    const harness = await setupInitialized()
    seedIndexCache(harness.data, [entryOf({ id: 'known', kind: 'theme', name: 'Known' })])

    await expect(harness.plugin.rescanEntry('ghost')).rejects.toThrow(/not in the cached index/)
  })
})

/* ── capability mismatches ───────────────────────────────────────────────── */

describe('getDiagnostics — capability mismatches', () => {
  it('records the mismatch when fetchEntryDetails rejects and reports it as a conflict', async () => {
    const harness = await setupInitialized({
      http: {
        json: {
          'https://api.github.com/repos/mismatch-author/ext-plugin/commits/HEAD': { sha: 'commit111' },
          'https://raw.githubusercontent.com/mismatch-author/ext-plugin/commit111/manifest.json': {
            id: 'ext-plugin',
            version: '1.0.0',
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

    await expect(harness.plugin.fetchEntryDetails(entry)).rejects.toThrow(/capabilities mismatch/)

    const stored = harness.data.get(CAPABILITY_MISMATCHES_KEY) as Record<string, { expected: string[]; actual: string[] }>
    expect(stored['ext-plugin']).toMatchObject({ expected: ['net:host/*'], actual: ['net:host/*', 'device:bluetooth'] })

    const report = await harness.plugin.getDiagnostics()
    const conflict = report.conflicts.find((item) => item.id === 'cap-mismatch:ext-plugin')
    expect(conflict).toBeDefined()
    expect(conflict?.message).toContain('device:bluetooth')
  })
})

/* ── plugin dependencies ─────────────────────────────────────────────────── */

describe('getDiagnostics — plugin dependencies', () => {
  it('reports installed plugins whose declared dependencies are missing', async () => {
    const harness = await setupInitialized({
      plugins: [makePluginInfo('p1', '1.0.0', ['p2', 'p3']), makePluginInfo('p2', '1.0.0')],
    })

    const report = await harness.plugin.getDiagnostics()
    const conflict = report.conflicts.find((item) => item.id === 'deps-unmet:p1')
    expect(conflict).toBeDefined()
    expect(conflict?.message).toContain('p3')
    expect(conflict?.message).not.toContain('p2、')
  })
})

/* ── fetch-failure warnings ──────────────────────────────────────────────── */

describe('getDiagnostics — fetch failure warnings', () => {
  it('warns about the failed fetch, the exhausted candidate chain and the stale cache', async () => {
    const harness = await setupInitialized({
      http: { fail: { [REGISTRY_JSON_URL]: new Error('offline') } },
    })
    seedIndexCache(harness.data, [], Date.now() - 30 * 60 * 60 * 1000) // 30h old

    await harness.plugin.getIndex()
    expect(harness.plugin.lastIndexFetchFailed()).toBe(true)

    const report = await harness.plugin.getDiagnostics()
    const ids = report.warnings.map((item) => item.id)
    expect(ids).toContain('index-fetch-failed')
    expect(ids).toContain('github-chain-failure')
    expect(ids).toContain('index-cache-stale')

    // Back online: the failures clear (the fresh cache write postdates the chain failure).
    const good = await setupInitialized({
      http: { json: { [REGISTRY_JSON_URL]: { entries: [] } } },
    })
    await good.plugin.getIndex()
    const cleanReport = await good.plugin.getDiagnostics()
    expect(cleanReport.warnings.map((item) => item.id)).toEqual([])
  })

  it('does not report a stale cache when the cached copy is fresh', async () => {
    const harness = await setupInitialized({
      http: { fail: { [REGISTRY_JSON_URL]: new Error('offline') } },
    })
    seedIndexCache(harness.data, [], Date.now())

    await harness.plugin.getIndex()
    const report = await harness.plugin.getDiagnostics()
    const ids = report.warnings.map((item) => item.id)
    expect(ids).toContain('index-fetch-failed')
    expect(ids).not.toContain('index-cache-stale')
  })
})

/* ── info group ──────────────────────────────────────────────────────────── */

describe('getDiagnostics — info group', () => {
  it('includes the lock summary and per-kind installed overviews', async () => {
    const harness = await setupInitialized({
      lyricSources: [makeLyricSource('lrclib', '2.0.0')],
      plugins: [makePluginInfo('ext-plugin', '1.0.0')],
    })
    seedLock(harness.data, {
      'ext-plugin': lockRecordOf('ext-plugin', 'plugin', 5_000),
      'some-theme': lockRecordOf('some-theme', 'theme', 6_000),
    })

    const report = await harness.plugin.getDiagnostics()
    const summary = report.info.find((item) => item.id === 'lock-summary')
    expect(summary).toBeDefined()
    expect(summary?.message).toContain('共 2 条')
    expect(summary?.message).toContain('插件 1')
    expect(summary?.message).toContain('界面主题 1')

    const pluginOverview = report.info.find((item) => item.id === 'installed-overview:plugin')
    expect(pluginOverview?.message).toContain('ext-plugin@1.0.0')
    const lyricOverview = report.info.find((item) => item.id === 'installed-overview:lyric-source')
    expect(lyricOverview?.message).toContain('lrclib@2.0.0')

    // No themes installed → no theme overview item.
    expect(report.info.find((item) => item.id === 'installed-overview:theme')).toBeUndefined()
  })

  it('summarizes an empty registry cleanly', async () => {
    const harness = await setupInitialized()
    const report = await harness.plugin.getDiagnostics()
    expect(report.info.find((item) => item.id === 'lock-summary')?.message).toContain('尚无锁记录')
    expect(report.conflicts).toEqual([])
    expect(report.risks).toEqual([])
  })
})

/* ── optional-method contract ─────────────────────────────────────────────── */

describe('optional-method contract', () => {
  it('lets a minimal RegistryService implementation omit both diagnostics methods', async () => {
    const stub: RegistryService = {
      getIndex: async () => ({ entries: [] }),
      checkUpdates: async () => [],
      updates: () => [],
      fetchEntryDetails: async (entry) => ({ entry }),
      install: async () => {},
      setPluginInstaller: () => {},
    }
    // Optional chaining resolves without throwing on a stub that never grew
    // the diagnostics surface — the pre-existing shape stays valid.
    expect(stub.getDiagnostics).toBeUndefined()
    expect(stub.rescanEntry).toBeUndefined()
    expect(stub.getDiagnostics?.()).toBeUndefined()
    expect(stub.rescanEntry?.('anything')).toBeUndefined()
  })
})
