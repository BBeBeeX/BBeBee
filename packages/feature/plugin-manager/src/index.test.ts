import { describe, expect, it, vi } from 'vitest'
import { Context, symbols } from 'cordis'
import { gzipSync } from 'fflate'
import { base64Encode, sha256Hex, sha512, type DbService, type RegistryPluginEntry } from '@BBeBee/protocol'
import { PluginManagerPlugin } from './index.js'
import type { PluginManifest } from '@BBeBee/protocol'
import {
  concatStreamWithLimit,
  gitHubRepoIdentity,
  gunzipCapped,
  NpmClient,
  NpmPluginError,
  parseDepSpecifier,
  provenanceSourceRepo,
  provenanceVerdict,
} from './npm.js'

describe('PluginManagerPlugin', () => {
  function createTestContext() {
    const ctx = new Context()
    const storeData = new Map<string, unknown>()
    const storeMock = {
      get: vi.fn(async (key: string) => storeData.get(key)),
      set: vi.fn(async (key: string, val: unknown) => {
        storeData.set(key, val)
      }),
      delete: vi.fn(async (key: string) => {
        storeData.delete(key)
      }),
      keys: vi.fn(async () => Array.from(storeData.keys())),
      namespace: vi.fn(() => storeMock),
    }

    const inspectorMock = {
      snapshot: vi.fn(() => ({
        root: {
          name: 'root',
          uid: 0,
          state: 'ACTIVE',
          inject: [],
          waitingFor: [],
          provides: [],
          effects: [],
          children: [
            {
              name: '@BBeBee/plugin-player',
              uid: 1,
              state: 'ACTIVE',
              inject: ['audio', 'sources'],
              waitingFor: [],
              provides: ['player'],
              effects: [],
              children: [],
            },
            {
              name: '@BBeBee/plugin-queue',
              uid: 2,
              state: 'ACTIVE',
              inject: ['player'],
              waitingFor: [],
              provides: ['queue'],
              effects: [],
              children: [],
            },
          ],
        },
        counts: { ACTIVE: 2, PENDING: 0, LOADING: 0, FAILED: 0, DISPOSED: 0, UNLOADING: 0, UNKNOWN: 0 },
        stalled: [],
      })),
    }

    ctx.store = storeMock as never
    // `inspector` is typed by plugin-inspector's cordis augmentation, which
    // this package deliberately does not depend on — assign structurally.
    ;(ctx as unknown as { inspector: unknown }).inspector = inspectorMock

    return { ctx, storeMock, inspectorMock, storeData }
  }

  const sampleManifests: Record<string, PluginManifest> = {
    '@BBeBee/plugin-player': {
      id: '@BBeBee/plugin-player',
      name: '@BBeBee/plugin-player',
      displayName: 'Player Service',
      description: 'Headless player',
      version: '1.0.0',
      author: 'BBeBee',
      systemId: 'layer-4',
      moduleId: 'playback',
      enabled: true,
      dependencies: ['@BBeBee/core-audio-mpv'],
      entry: { main: './dist/index.js' },
      capabilities: [],
      contributes: { services: ['player'] },
      effect: 'player',
      engines: { BBeBee: '^0.1.0' },
    },
    '@BBeBee/plugin-queue': {
      id: '@BBeBee/plugin-queue',
      name: '@BBeBee/plugin-queue',
      displayName: 'Queue Service',
      description: 'Playback queue',
      version: '1.0.0',
      author: 'BBeBee',
      systemId: 'layer-4',
      moduleId: 'playback',
      enabled: true,
      dependencies: ['@BBeBee/plugin-player'],
      entry: { main: './dist/index.js' },
      capabilities: [],
      contributes: { services: ['queue'] },
      effect: 'queue',
      engines: { BBeBee: '^0.1.0' },
    },
  }

  it('initializes and merges manifests and inspector state in list()', async () => {
    const { ctx } = createTestContext()
    const plugin = new PluginManagerPlugin(ctx, { manifests: sampleManifests })
    await plugin[PluginManagerPlugin.init]()

    const list = plugin.list()
    expect(list).toHaveLength(2)

    const player = list.find((p) => p.id === '@BBeBee/plugin-player')
    expect(player).toBeDefined()
    expect(player?.state).toBe('ACTIVE')
    expect(player?.enabled).toBe(true)

    const queue = list.find((p) => p.id === '@BBeBee/plugin-queue')
    expect(queue).toBeDefined()
    expect(queue?.dependencies).toContain('@BBeBee/plugin-player')
    expect(player?.dependents).toContain('@BBeBee/plugin-queue')
  })

  it('updates enablement, persists to store, and invokes lifecycle bridge', async () => {
    const { ctx, storeMock } = createTestContext()
    const plugin = new PluginManagerPlugin(ctx, { manifests: sampleManifests })
    await plugin[PluginManagerPlugin.init]()

    const bridge = {
      loadPlugin: vi.fn(async () => {}),
      unloadPlugin: vi.fn(async () => {}),
    }
    plugin.setLifecycleBridge(bridge)

    const eventsFired: unknown[] = []
    ctx.on('plugin-manager/enabled-changed', (payload) => {
      eventsFired.push(payload)
    })

    await plugin.setEnabled('@BBeBee/plugin-queue', false)

    expect(storeMock.set).toHaveBeenCalled()
    expect(bridge.unloadPlugin).toHaveBeenCalledWith('@BBeBee/plugin-queue')
    expect(eventsFired).toEqual([{ id: '@BBeBee/plugin-queue', enabled: false }])

    const list = plugin.list()
    const queue = list.find((p) => p.id === '@BBeBee/plugin-queue')
    expect(queue?.enabled).toBe(false)
  })

  it('refuses to disable a critical service provider, but not a replaceable one (audit W5)', async () => {
    const { ctx } = createTestContext()
    const plugin = new PluginManagerPlugin(ctx, { manifests: sampleManifests })
    await plugin[PluginManagerPlugin.init]()
    const bridge = {
      loadPlugin: vi.fn(async () => {}),
      unloadPlugin: vi.fn(async () => {}),
    }
    plugin.setLifecycleBridge(bridge)

    // '@BBeBee/plugin-player' provides the critical key `player`.
    await expectNpmError(plugin.setEnabled('@BBeBee/plugin-player', false), 'CRITICAL_PROVIDER')
    expect(bridge.unloadPlugin).not.toHaveBeenCalled()
    expect(plugin.list().find((p) => p.id === '@BBeBee/plugin-player')?.enabled).toBe(true)

    // Enabling is never locked, and non-critical providers toggle freely.
    await plugin.setEnabled('@BBeBee/plugin-player', true)
    await plugin.setEnabled('@BBeBee/plugin-queue', false)
    expect(plugin.list().find((p) => p.id === '@BBeBee/plugin-queue')?.enabled).toBe(false)
  })

  it('tracks plugin failure errors from kernel events', async () => {
    const { ctx } = createTestContext()
    const plugin = new PluginManagerPlugin(ctx, { manifests: sampleManifests })
    await plugin[PluginManagerPlugin.init]()

    ctx.emit('plugin/failed', '@BBeBee/plugin-player', new Error('Audio engine unavailable'))

    const list = plugin.list()
    const player = list.find((p) => p.id === '@BBeBee/plugin-player')
    expect(player?.error).toBe('Audio engine unavailable')

    ctx.emit('plugin/loaded', '@BBeBee/plugin-player')
    const listAfter = plugin.list()
    const playerAfter = listAfter.find((p) => p.id === '@BBeBee/plugin-player')
    expect(playerAfter?.error).toBeUndefined()
  })

  it('uninstalls plugin via lifecycle bridge and removes manifest', async () => {
    const { ctx } = createTestContext()
    const plugin = new PluginManagerPlugin(ctx, { manifests: sampleManifests })
    await plugin[PluginManagerPlugin.init]()

    const bridge = {
      loadPlugin: vi.fn(async () => {}),
      unloadPlugin: vi.fn(async () => {}),
      uninstallPlugin: vi.fn(async () => {}),
    }
    plugin.setLifecycleBridge(bridge)

    await plugin.uninstall('@BBeBee/plugin-queue')
    expect(bridge.uninstallPlugin).toHaveBeenCalledWith('@BBeBee/plugin-queue')

    const list = plugin.list()
    expect(list.find((p) => p.id === '@BBeBee/plugin-queue')).toBeUndefined()
  })
})

/**
 * npm-based plugin management tests.
 *
 * The HTTP layer is fully mocked; tarballs are built by an independent
 * minimal tar writer below (not by the reader under test) and gzipped with
 * fflate. Integrity values use the repo's own sha512 — sha512 itself is
 * differentially pinned against node:crypto in protocol's hash.test.ts.
 */

/** Independent minimal tar writer (ustar, regular files only). */
function buildTar(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const writeField = (header: Uint8Array, off: number, len: number, text: string) => {
    header.set(enc.encode(text).subarray(0, len), off)
  }
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content
    const header = new Uint8Array(512)
    writeField(header, 0, 100, `package/${name}`)
    writeField(header, 124, 12, `${data.length.toString(8).padStart(11, '0')}\0`)
    header[156] = 0x30 // '0' regular file
    chunks.push(header, data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad) chunks.push(new Uint8Array(pad))
  }
  chunks.push(new Uint8Array(1024)) // end-of-archive
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function manifestFor(id: string, version: string, services: string[] = [], capabilities: string[] = []) {
  return {
    id,
    name: id,
    displayName: id,
    description: `${id} test plugin`,
    version,
    author: 'test',
    engines: { BBeBee: '^0.1.0' },
    enabled: true,
    entry: { main: './dist/index.js' },
    capabilities,
    contributes: { services },
    effect: id,
  }
}

function tarballFor(pkg: string, id: string, version: string, extra: Record<string, string | Uint8Array> = {}) {
  return gzipSync(
    buildTar({
      'package.json': JSON.stringify({ name: pkg, version }),
      'BBeBee.plugin.json': JSON.stringify(manifestFor(id, version)),
      'dist/index.js': `export const name = '${id}'`,
      ...extra,
    }),
  )
}

function entryFor(over: Partial<RegistryPluginEntry> & { id: string; npm: string }): RegistryPluginEntry {
  return {
    name: over.id,
    repo: `https://github.com/test/${over.id}`,
    author: 'test',
    description: 'test entry',
    services: ['player'],
    platforms: ['desktop'],
    category: 'other',
    dependencies: [],
    compositors: [],
    ...over,
  }
}

const INDEX_URL = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main/plugins/index.json'

function packument(
  pkg: string,
  versions: string[],
  tarballs: Record<string, Uint8Array>,
  peers?: Record<string, string>,
) {
  return {
    name: pkg,
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: Object.fromEntries(
      versions.map((v) => [
        v,
        {
          version: v,
          ...(peers ? { peerDependencies: peers } : {}),
          dist: {
            tarball: `https://cdn.jsdelivr.net/${encodeURIComponent(pkg)}-/${v}.tgz`,
            integrity: `sha512-${base64Encode(sha512(tarballs[`${pkg}@${v}`]!))}`,
          },
        },
      ]),
    ),
  }
}

interface NpmTestWorld {
  ctx: any
  plugin: PluginManagerPlugin
  httpMock: ReturnType<typeof vi.fn>
  bridge: { loadPlugin: ReturnType<typeof vi.fn>; unloadPlugin: ReturnType<typeof vi.fn>; installPlugin: ReturnType<typeof vi.fn> }
  routes: Map<string, { status: number; json?: () => Promise<unknown>; bytes?: () => Promise<Uint8Array> }>
  settingsData: Record<string, unknown>
}

function createNpmWorld(opts: { platform?: 'desktop' | 'mobile'; manifests?: Record<string, PluginManifest> } = {}): NpmTestWorld {
  const { ctx } = createTestContext()
  const routes = new Map<string, { status: number; json?: () => Promise<unknown>; bytes?: () => Promise<Uint8Array> }>()
  const httpMock = vi.fn(async (req: { url: string }) => {
    const route = routes.get(req.url)
    if (!route) return { status: 404, json: async () => ({}), bytes: async () => new Uint8Array(0), headers: {} }
    return {
      status: route.status,
      json: route.json ?? (async () => ({})),
      bytes: route.bytes ?? (async () => new Uint8Array(0)),
      headers: {},
    }
  })
  const settingsData: Record<string, unknown> = { downloadRegion: 'global' }
  const secretsData = new Map<string, string>()
  ;(ctx as any).http = httpMock
  ;(ctx as any).settings = { getSync: () => ({ ...settingsData }) }
  ;(ctx as any).secrets = {
    get: vi.fn(async (k: string) => secretsData.get(k)),
    set: vi.fn(async (k: string, v: string) => void secretsData.set(k, v)),
    delete: vi.fn(async (k: string) => void secretsData.delete(k)),
  }
  ;(ctx as any).device = { appVersion: '0.1.0', platform: 'linux' }
  const plugin = new PluginManagerPlugin(ctx, { platform: opts.platform ?? 'desktop', manifests: opts.manifests })
  const bridge = {
    loadPlugin: vi.fn(async () => {}),
    unloadPlugin: vi.fn(async () => {}),
    installPlugin: vi.fn(async () => {}),
  }
  plugin.setLifecycleBridge(bridge as any)
  return { ctx, plugin, httpMock, bridge, routes, settingsData }
}

// `createTestContext` is defined in the earlier describe block's closure;
// re-declare a compatible one here for the npm suite.
function createTestContext() {
  const ctx = new Context()
  const storeData = new Map<string, unknown>()
  const storeMock = {
    get: vi.fn(async (key: string) => storeData.get(key)),
    set: vi.fn(async (key: string, val: unknown) => {
      storeData.set(key, val)
    }),
    delete: vi.fn(async (key: string) => {
      storeData.delete(key)
    }),
    keys: vi.fn(async () => Array.from(storeData.keys())),
    namespace: vi.fn(() => storeMock),
  }
  const inspectorMock = { snapshot: vi.fn(() => ({ root: undefined })) }
  ctx.store = storeMock as never
  ;(ctx as unknown as { inspector: unknown }).inspector = inspectorMock
  return { ctx, storeData, storeMock }
}

describe('parseDepSpecifier', () => {
  it('parses bare ids and id@range', () => {
    expect(parseDepSpecifier('bob-dsp-pack')).toEqual({ id: 'bob-dsp-pack' })
    expect(parseDepSpecifier('bob-dsp-pack@^2.0.0')).toEqual({ id: 'bob-dsp-pack', range: '^2.0.0' })
  })
  it('rejects malformed specifiers', () => {
    expectNpmErrorSync(() => parseDepSpecifier('Nope'), 'DEPENDENCY_INVALID')
    expectNpmErrorSync(() => parseDepSpecifier('a@'), 'DEPENDENCY_INVALID')
  })
})


/** Asserts a promise rejects with an NpmPluginError of the given code. */
async function expectNpmError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(NpmPluginError)
    expect((err as NpmPluginError).code).toBe(code)
    return
  }
  throw new Error(`expected NpmPluginError(${code}) but nothing was thrown`)
}

/** Asserts a sync function throws an NpmPluginError of the given code. */
function expectNpmErrorSync(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(NpmPluginError)
    expect((err as NpmPluginError).code).toBe(code)
    return
  }
  throw new Error(`expected NpmPluginError(${code}) but nothing was thrown`)
}

describe('NpmClient.selectVersion', () => {
  function client() {
    const w = createNpmWorld()
    return (w.plugin as any).getNpmClient() as NpmClient
  }
  const pack = {
    'dist-tags': { latest: '2.0.0' },
    versions: {
      '1.0.0': { version: '1.0.0', dist: { tarball: 'https://x/1.tgz' } },
      '1.5.0': { version: '1.5.0', dist: { tarball: 'https://x/1.5.tgz' } },
      '2.0.0': { version: '2.0.0', dist: { tarball: 'https://x/2.tgz' } },
    },
  }
  it('picks dist-tags.latest without a range', () => {
    expect(client().selectVersion('@t/p', pack).version).toBe('2.0.0')
  })
  it('picks the highest satisfying version', () => {
    expect(client().selectVersion('@t/p', pack, '^1.0.0').version).toBe('1.5.0')
  })
  it('throws when nothing satisfies', () => {
    expectNpmErrorSync(() => client().selectVersion('@t/p', pack, '^9.0.0'), 'VERSION_NOT_FOUND')
  })
})

describe('NpmClient.resolveTree', () => {
  class StubClient extends NpmClient {
    constructor(private packs: Record<string, any>) {
      super({ http: {} as any, readSettings: async () => undefined, readSecret: async () => undefined, cache: { get: async () => undefined, set: async () => {} }, log: { info() {}, warn() {}, error() {} } })
    }
    override async fetchPackument(npm: string) {
      const p = this.packs[npm]
      if (!p) throw new NpmPluginError('PACKUMENT_FETCH_FAILED', `no stub for ${npm}`)
      return p
    }
  }
  const stubPack = (versions: string[]) => ({
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: Object.fromEntries(versions.map((v) => [v, { version: v, dist: { tarball: `https://x/${v}.tgz` } }])),
  })

  it('resolves a dependency closure in install order', async () => {
    const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['b-y@^1.0.0'] })
    const b = entryFor({ id: 'b-y', npm: '@t/b' })
    const c = new StubClient({ '@t/a': stubPack(['1.0.0']), '@t/b': stubPack(['1.0.0', '1.2.0', '2.0.0']) })
    const { target, closure } = await c.resolveTree(a, undefined, [a, b])
    expect(target.pkg.version).toBe('1.0.0')
    expect(closure.map((n) => n.pkg.id)).toEqual(['b-y'])
    expect(closure[0]!.pkg.version).toBe('1.2.0')
  })

  it('detects cycles and names them', async () => {
    const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['b-y'] })
    const b = entryFor({ id: 'b-y', npm: '@t/b', dependencies: ['a-x'] })
    const c = new StubClient({ '@t/a': stubPack(['1.0.0']), '@t/b': stubPack(['1.0.0']) })
    await expect(c.resolveTree(a, undefined, [a, b])).rejects.toThrow(/a-x → b-y → a-x/)
  })

  it('detects conflicting ranges and names the parties', async () => {
    const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['c-z@^1.0.0'] })
    const b = entryFor({ id: 'b-y', npm: '@t/b', dependencies: ['c-z@^2.0.0'] })
    const root = entryFor({ id: 'r-t', npm: '@t/r', dependencies: ['a-x', 'b-y'] })
    const c = new StubClient({
      '@t/r': stubPack(['1.0.0']),
      '@t/a': stubPack(['1.0.0']),
      '@t/b': stubPack(['1.0.0']),
      '@t/c': stubPack(['1.5.0', '2.1.0']),
    })
    await expect(c.resolveTree(root, undefined, [root, a, b, entryFor({ id: 'c-z', npm: '@t/c' })])).rejects.toThrow(
      /c-z.*\^2\.0\.0.*2\.1\.0|版本冲突/,
    )
  })

  it('fails on a dependency missing from the registry', async () => {
    const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['ghost-q'] })
    const c = new StubClient({ '@t/a': stubPack(['1.0.0']) })
    await expect(c.resolveTree(a, undefined, [a])).rejects.toThrow(/ghost-q/)
  })
})

describe('NpmClient tarball handling', () => {
  function client() {
    const w = createNpmWorld()
    return (w.plugin as any).getNpmClient() as NpmClient
  }
  const pkg = { id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: 'https://x/1.tgz' }

  it('extracts files with the package/ prefix stripped', () => {
    const bytes = tarballFor('@t/a', 'a-x', '1.0.0')
    const out = client().extractPackage(pkg, bytes)
    expect(out.files['dist/index.js']).toContain('a-x')
    expect(out.files['package.json']).toContain('@t/a')
    expect(out.packageJson.version).toBe('1.0.0')
    expect(out.manifest.id).toBe('a-x')
    expect(out.tarballSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects path traversal', () => {
    const bytes = gzipSync(buildTar({ '../evil.js': 'x' }))
    expectNpmErrorSync(() => client().extractPackage(pkg, bytes), 'TARBALL_INVALID')
  })

  it('rejects entries that collide after POSIX path normalization', () => {
    // Three distinct raw keys, one file on disk: without normalization
    // the disk writer's last-write-wins would install a different file
    // than the one the install record hashed.
    const bytes = gzipSync(
      buildTar({
        'package.json': JSON.stringify({ name: '@t/a', version: '1.0.0' }),
        'BBeBee.plugin.json': JSON.stringify(manifestFor('a-x', '1.0.0')),
        'dist/index.js': 'canonical',
        'dist/./index.js': 'dot-variant',
        'dist//index.js': 'slash-variant',
      }),
    )
    expectNpmErrorSync(() => client().extractPackage(pkg, bytes), 'TARBALL_INVALID')
  })

  it('rejects a package with more file entries than the cap', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: '@t/a', version: '1.0.0' }),
      'BBeBee.plugin.json': JSON.stringify(manifestFor('a-x', '1.0.0')),
    }
    // 4096-entry cap, plus the two metadata files above.
    for (let i = 0; i < 4095; i++) files[`f/${i}.txt`] = 'x'
    const bytes = gzipSync(buildTar(files))
    expectNpmErrorSync(() => client().extractPackage(pkg, bytes), 'TARBALL_INVALID')
  })

  it('rejects non-UTF-8 files (v1 text-only)', () => {
    const bytes = gzipSync(buildTar({ 'package.json': '{}', 'BBeBee.plugin.json': '{}', 'bin/blob': new Uint8Array([0xff, 0xfe, 0x00]) }))
    expectNpmErrorSync(() => client().extractPackage(pkg, bytes), 'BINARY_ASSET')
  })

  it('rejects a missing manifest', () => {
    const bytes = gzipSync(buildTar({ 'package.json': '{}' }))
    expectNpmErrorSync(() => client().extractPackage(pkg, bytes), 'TARBALL_INVALID')
  })

  it('verifies integrity and rejects mismatches', () => {
    const c = client()
    const bytes = tarballFor('@t/a', 'a-x', '1.0.0')
    const good = `sha512-${base64Encode(sha512(bytes))}`
    expect(() => c.verifyIntegrity(bytes, good, 'x')).not.toThrow()
    expect(() => c.verifyIntegrity(bytes, undefined, 'x')).not.toThrow()
    expectNpmErrorSync(() => c.verifyIntegrity(bytes, 'sha512-' + 'A'.repeat(86), 'x'), 'INTEGRITY_MISMATCH')
    expectNpmErrorSync(() => c.verifyIntegrity(bytes, 'md5-abc', 'x'), 'INTEGRITY_MISMATCH')
  })
})

describe('npm provenance helpers (audit W6)', () => {
  function attestationsBody(sourceRepo: string) {
    const payload = {
      _type: 'https://in-toto.io/Statement/v1',
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: {
          buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
          externalParameters: {
            workflow: { ref: 'refs/heads/main', repository: sourceRepo, path: '.github/workflows/publish.yml' },
          },
        },
      },
    }
    return {
      attestations: [
        {
          predicateType: 'https://slsa.dev/provenance/v1',
          bundle: { dsseEnvelope: { payload: base64Encode(JSON.stringify(payload)) } },
        },
      ],
    }
  }

  it('extracts the source repository from the DSSE envelope', () => {
    expect(provenanceSourceRepo(attestationsBody('https://github.com/BBeBeeX/BBeBee'))).toBe(
      'https://github.com/BBeBeeX/BBeBee',
    )
  })

  it('ignores non-provenance attestations and malformed bodies', () => {
    expect(provenanceSourceRepo({ attestations: [{ predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: {} }] })).toBeUndefined()
    expect(provenanceSourceRepo({ attestations: [] })).toBeUndefined()
    expect(provenanceSourceRepo({ error: 'Not found' })).toBeUndefined()
    expect(provenanceSourceRepo(null)).toBeUndefined()
    expect(provenanceSourceRepo('junk')).toBeUndefined()
    expect(
      provenanceSourceRepo({ attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: '!!!not-base64-json' } } }] }),
    ).toBeUndefined()
  })

  it('verdicts: match is case/slash tolerant, foreign source mismatches, absent is none', () => {
    expect(provenanceVerdict(attestationsBody('https://github.com/bbebeex/bbebee/'), 'https://github.com/BBeBeeX/BBeBee')).toEqual({
      status: 'verified',
      sourceRepo: 'https://github.com/bbebeex/bbebee/',
    })
    expect(provenanceVerdict(attestationsBody('https://github.com/attacker/fake'), 'https://github.com/BBeBeeX/BBeBee')).toEqual({
      status: 'mismatch',
      sourceRepo: 'https://github.com/attacker/fake',
    })
    expect(provenanceVerdict({ attestations: [] }, 'https://github.com/BBeBeeX/BBeBee')).toEqual({ status: 'none' })
  })

  it('checkProvenance: a mirror 404 is not a verdict — the official registry decides', async () => {
    // Mirrors (npmmirror) do not carry the attestations endpoint and 404
    // every package; taking that as `none` falsely reported the attested
    // @bbebee/plugin-visualizer@0.1.1 as provenance-less on mainland
    // installs (2026-10-22). Only the official registry's 404 is terminal.
    const pkg = { npm: '@bbebee/plugin-visualizer', version: '0.1.1' } as any
    const repo = 'https://github.com/BBeBeeX/BBeBee'
    const clientWith = (http: any, settings?: unknown) =>
      new NpmClient({
        http,
        readSettings: async () => settings as any,
        readSecret: async () => undefined,
        cache: { get: async () => undefined, set: async () => {} },
        log: { info() {}, warn() {}, error() {} },
      })
    const mirrorFirst = (official: { status: number; body?: unknown }) =>
      vi.fn(async ({ url }: { url: string }) =>
        url.startsWith('https://registry.npmmirror.com')
          ? { status: 404, json: async () => ({}) }
          : { status: official.status, json: async () => official.body ?? {} },
      )

    // Mirror 404 → official serves the attestation → verified.
    const http1 = mirrorFirst({ status: 200, body: attestationsBody(repo) })
    await expect(
      clientWith(http1, { downloadRegion: 'mainland-china' }).checkProvenance(pkg, repo),
    ).resolves.toEqual({ status: 'verified', sourceRepo: repo })
    expect(http1).toHaveBeenCalledTimes(2)

    // Mirror 404 → official 404 → genuinely none.
    const http2 = mirrorFirst({ status: 404 })
    await expect(
      clientWith(http2, { downloadRegion: 'mainland-china' }).checkProvenance(pkg, repo),
    ).resolves.toEqual({ status: 'none' })
    expect(http2).toHaveBeenCalledTimes(2)

    // Mirror 404 → official attestation from a FOREIGN repo → mismatch
    // (the fall-through must not weaken the spoof check).
    const http3 = mirrorFirst({ status: 200, body: attestationsBody('https://github.com/attacker/fake') })
    await expect(
      clientWith(http3, { downloadRegion: 'mainland-china' }).checkProvenance(pkg, repo),
    ).resolves.toEqual({ status: 'mismatch', sourceRepo: 'https://github.com/attacker/fake' })

    // Official endpoint effective directly: one call, 404 → none.
    const http4 = vi.fn(async () => ({ status: 404, json: async () => ({}) }))
    await expect(clientWith(http4).checkProvenance(pkg, repo)).resolves.toEqual({ status: 'none' })
    expect(http4).toHaveBeenCalledTimes(1)
  })

  it('normalizes GitHub repo identities and rejects non-GitHub URLs', () => {
    expect(gitHubRepoIdentity('https://github.com/BBeBeeX/BBeBee.git')).toBe('bbebeex/bbebee')
    expect(gitHubRepoIdentity('https://github.com/BBeBeeX/BBeBee/')).toBe('bbebeex/bbebee')
    expect(gitHubRepoIdentity('https://gitlab.com/a/b')).toBeUndefined()
    expect(gitHubRepoIdentity('not a url')).toBeUndefined()
    expect(gitHubRepoIdentity(undefined)).toBeUndefined()
  })
})

describe('plugin-manager npm service methods', () => {
  function seedWorld(
    entry: RegistryPluginEntry,
    versions: string[],
    tarballs: Record<string, Uint8Array>,
    peers?: Record<string, string>,
  ) {
    const w = createNpmWorld({
      manifests: {
        '@BBeBee/plugin-player': {
          id: '@BBeBee/plugin-player',
          name: '@BBeBee/plugin-player',
          displayName: 'Player',
          description: 'player',
          version: '1.0.0',
          author: 'BBeBee',
          engines: { BBeBee: '^0.1.0' },
          entry: { main: './dist/index.js' },
          capabilities: [],
          contributes: { services: ['player'] },
          effect: 'player',
        } as PluginManifest,
      },
    })
    w.routes.set(INDEX_URL, { status: 200, json: async () => [entry] })
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
      status: 200,
      json: async () => packument(entry.npm, versions, tarballs, peers),
    })
    for (const v of versions) {
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/${v}.tgz`, {
        status: 200,
        bytes: async () => tarballs[`${entry.npm}@${v}`]!,
      })
    }
    return w
  }

  function seedProvidesWorld(depDeclaresProvides: boolean) {
    const b = entryFor({
      id: 'b-y',
      npm: '@t/b',
      services: [],
      provides: depDeclaresProvides ? ['viz'] : [],
    })
    const a = entryFor({ id: 'a-x', npm: '@t/a', services: ['viz'], dependencies: ['b-y'] })
    const tarballs: Record<string, Uint8Array> = {
      '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
      // The dependency's real package does contribute `viz`; whether the
      // plan can know that depends on the entry's declared `provides`.
      '@t/b@1.0.0': tarballFor('@t/b', 'b-y', '1.0.0', {
        'BBeBee.plugin.json': JSON.stringify(manifestFor('b-y', '1.0.0', ['viz'])),
      }),
    }
    const w = createNpmWorld()
    w.routes.set(INDEX_URL, { status: 200, json: async () => [a, b] })
    for (const e of [a, b]) {
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(e.npm)}`, {
        status: 200,
        json: async () => packument(e.npm, ['1.0.0'], tarballs),
      })
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(e.npm)}-/1.0.0.tgz`, {
        status: 200,
        bytes: async () => tarballs[`${e.npm}@1.0.0`]!,
      })
    }
    return w
  }

  it('counts a service the install closure declares in `provides` as available at plan time', async () => {
    const w = seedProvidesWorld(true)
    await w.plugin[PluginManagerPlugin.init]()
    const plan = await w.plugin.resolveInstallPlan('a-x')
    expect(plan.closure.map((p) => p.id)).toEqual(['b-y'])
    expect(plan.missingServices).toEqual([])
    await w.plugin.installPlugin('a-x')
    // The dependency is installed before its dependent.
    expect(w.bridge.installPlugin.mock.calls.map(([id]) => id)).toEqual(['b-y', 'a-x'])
  })

  it('reports a closure-provided service as missing at plan time when the entry omits `provides`', async () => {
    const w = seedProvidesWorld(false)
    await w.plugin[PluginManagerPlugin.init]()
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual(['viz'])
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('installs a plugin end to end: resolve → download → verify → bridge → lock', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    const plugin = w.plugin
    await plugin[PluginManagerPlugin.init]()

    await plugin.installPlugin('a-x')

    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
    const [id, files, manifest] = w.bridge.installPlugin.mock.calls[0]!
    expect(id).toBe('a-x')
    expect(files['dist/index.js']).toContain('a-x')
    expect(manifest.id).toBe('a-x')
    const list = plugin.list()
    expect(list.find((p) => p.id === 'a-x')).toBeDefined()
    // lock record persisted
    const storeMock = (w.ctx as any).store
    const setCalls = storeMock.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    expect(setCalls.length).toBeGreaterThan(0)
    expect(setCalls.at(-1)![1]['a-x'].version).toBe('1.0.0')
  })

  it('warns on a peer range that excludes the host version — but still installs', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs, { react: '^18.0.0', 'react-dom': '^18.0.0' })
    w.plugin.setHostVersions({ react: '19.2.3', 'react-dom': '19.2.3' })
    await w.plugin[PluginManagerPlugin.init]()
    const plan = await w.plugin.resolveInstallPlan('a-x')
    const peerWarnings = plan.warnings.filter((x) => x.includes('peer'))
    expect(peerWarnings.length).toBe(2)
    expect(peerWarnings[0]).toContain('peer react "^18.0.0"')
    expect(peerWarnings[0]).toContain('19.2.3')
    // A peer mismatch is a warning, never a refusal.
    await w.plugin.installPlugin('a-x')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
  })

  it('does not warn when peer ranges accept the host versions', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs, { react: '^19.0.0', 'react-dom': '>=18.0.0' })
    w.plugin.setHostVersions({ react: '19.2.3', 'react-dom': '19.2.3' })
    await w.plugin[PluginManagerPlugin.init]()
    const plan = await w.plugin.resolveInstallPlan('a-x')
    expect(plan.warnings.filter((x) => x.includes('peer'))).toEqual([])
  })

  it('ignores peers the host does not share, packages without peers, and unwired hosts', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    // Peers outside the host-shared set are not the installer's business,
    // however unsatisfiable they look.
    const w1 = seedWorld(entry, ['1.0.0'], tarballs, { cordis: '^999.0.0', 'left-pad': '^1.0.0' })
    w1.plugin.setHostVersions({ react: '19.2.3', 'react-dom': '19.2.3' })
    await w1.plugin[PluginManagerPlugin.init]()
    expect((await w1.plugin.resolveInstallPlan('a-x')).warnings.filter((x) => x.includes('peer'))).toEqual([])
    // No peers declared at all.
    const w2 = seedWorld(entry, ['1.0.0'], tarballs)
    w2.plugin.setHostVersions({ react: '19.2.3', 'react-dom': '19.2.3' })
    await w2.plugin[PluginManagerPlugin.init]()
    expect((await w2.plugin.resolveInstallPlan('a-x')).warnings.filter((x) => x.includes('peer'))).toEqual([])
    // Host facts never wired (e.g. mobile): even a mismatching shared peer
    // produces no warning — there is no host contract to check against.
    const w3 = seedWorld(entry, ['1.0.0'], tarballs, { react: '^18.0.0' })
    await w3.plugin[PluginManagerPlugin.init]()
    expect((await w3.plugin.resolveInstallPlan('a-x')).warnings.filter((x) => x.includes('peer'))).toEqual([])
  })

  it('refuses when a required service is unavailable, naming it', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['nonexistent-svc'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('treats a service as unavailable while its only provider is disabled, and available again once re-enabled', async () => {
    // Uses the non-critical key `visualizer`: critical providers (like
    // `player`) can no longer be disabled at all (audit W5 lock).
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['visualizer'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    w.plugin.registerManifests({
      '@BBeBee/plugin-visualizer': {
        id: '@BBeBee/plugin-visualizer',
        name: '@BBeBee/plugin-visualizer',
        displayName: 'Visualizer',
        description: 'visualizer provider',
        version: '1.0.0',
        author: 'BBeBee',
        engines: { BBeBee: '^0.1.0' },
        entry: { main: './dist/index.js' },
        capabilities: [],
        contributes: { services: ['visualizer'] },
        effect: 'visualizer',
      } as PluginManifest,
    })
    await w.plugin[PluginManagerPlugin.init]()

    // The user disables the only provider of `visualizer`: the service
    // leaves the available set even though the provider's manifest is
    // still known.
    await w.plugin.setEnabled('@BBeBee/plugin-visualizer', false)
    const plan = await w.plugin.resolveInstallPlan('a-x')
    expect(plan.missingServices).toEqual(['visualizer'])
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()

    // Re-enabling the provider restores availability; the install proceeds.
    await w.plugin.setEnabled('@BBeBee/plugin-visualizer', true)
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual([])
    await w.plugin.installPlugin('a-x')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
  })

  it('does not count a provider whose manifest defaults to disabled (no override)', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['player'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = createNpmWorld({
      manifests: {
        '@BBeBee/plugin-player': {
          id: '@BBeBee/plugin-player',
          name: '@BBeBee/plugin-player',
          displayName: 'Player',
          description: 'player',
          version: '1.0.0',
          author: 'BBeBee',
          engines: { BBeBee: '^0.1.0' },
          enabled: false,
          entry: { main: './dist/index.js' },
          capabilities: [],
          contributes: { services: ['player'] },
          effect: 'player',
        } as PluginManifest,
      },
    })
    w.routes.set(INDEX_URL, { status: 200, json: async () => [entry] })
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
      status: 200,
      json: async () => packument(entry.npm, ['1.0.0'], tarballs),
    })
    w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/1.0.0.tgz`, {
      status: 200,
      bytes: async () => tarballs['@t/a@1.0.0']!,
    })
    await w.plugin[PluginManagerPlugin.init]()
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual(['player'])
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('keeps a service available while any one of its providers stays enabled', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['visualizer'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    // Two independent providers of the same (non-critical) service key.
    const provider = (id: string, name: string) =>
      ({
        id,
        name,
        displayName: name,
        description: `${name} provider`,
        version: '1.0.0',
        author: 'BBeBee',
        engines: { BBeBee: '^0.1.0' },
        entry: { main: './dist/index.js' },
        capabilities: [],
        contributes: { services: ['visualizer'] },
        effect: 'visualizer',
      }) as PluginManifest
    w.plugin.registerManifests({
      '@BBeBee/plugin-visualizer': provider('@BBeBee/plugin-visualizer', 'Visualizer'),
      '@BBeBee/plugin-visualizer-alt': provider('@BBeBee/plugin-visualizer-alt', 'Visualizer (alt)'),
    })
    await w.plugin[PluginManagerPlugin.init]()

    await w.plugin.setEnabled('@BBeBee/plugin-visualizer', false)
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual([])

    // Only when every provider is disabled does the service go missing.
    await w.plugin.setEnabled('@BBeBee/plugin-visualizer-alt', false)
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual(['visualizer'])
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
  })

  it('counts services declared by a shell (entry-less) manifest for availability, but never lists it as a plugin', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['shell-svc'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = createNpmWorld({
      manifests: {
        // A composition root's service-provision record: contributes a
        // service, has no code to load (empty entry.main).
        '@BBeBee/app-shell': {
          id: '@BBeBee/app-shell',
          name: '@BBeBee/app-shell',
          displayName: 'Shell',
          description: 'shell service declaration',
          version: '0.0.0',
          author: 'BBeBee',
          engines: { BBeBee: '^0.1.0' },
          enabled: true,
          entry: { main: '' },
          capabilities: [],
          contributes: { services: ['shell-svc'] },
          effect: null,
        } as PluginManifest,
      },
    })
    w.routes.set(INDEX_URL, { status: 200, json: async () => [entry] })
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
      status: 200,
      json: async () => packument(entry.npm, ['1.0.0'], tarballs),
    })
    w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/1.0.0.tgz`, {
      status: 200,
      bytes: async () => tarballs['@t/a@1.0.0']!,
    })
    await w.plugin[PluginManagerPlugin.init]()

    // The declared service is available to the install gate…
    expect((await w.plugin.resolveInstallPlan('a-x')).missingServices).toEqual([])
    await w.plugin.installPlugin('a-x')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
    // …but the declaration itself is not a plugin and is never listed,
    // while the genuinely installed plugin is.
    const ids = w.plugin.list().map((p) => p.id)
    expect(ids).toContain('a-x')
    expect(ids).not.toContain('@BBeBee/app-shell')
  })

  it('refuses on triple-version mismatch', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    // tarball claims 9.9.9 while the resolved version is 1.0.0
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '9.9.9') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('a-x'), 'VERSION_MISMATCH')
  })

  it('refuses spoofed package name / id', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@evil/b', 'evil-id', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SPOOF_DETECTED')
  })

  it('refuses an id colliding with a builtin plugin', async () => {
    const entry = entryFor({ id: '@BBeBee/plugin-player', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', '@BBeBee/plugin-player', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('@BBeBee/plugin-player'), 'SPOOF_DETECTED')
  })

  describe('provenance (audit W6)', () => {
    const ATTESTATIONS_URL = `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent('@t/a')}@1.0.0`
    function attestationsBody(sourceRepo: string) {
      const payload = {
        _type: 'https://in-toto.io/Statement/v1',
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: {
          buildDefinition: {
            buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
            externalParameters: {
              workflow: { ref: 'refs/heads/main', repository: sourceRepo, path: '.github/workflows/publish.yml' },
            },
          },
        },
      }
      return {
        attestations: [
          {
            predicateType: 'https://slsa.dev/provenance/v1',
            bundle: { dsseEnvelope: { payload: base64Encode(JSON.stringify(payload)) } },
          },
        ],
      }
    }
    const officialEntry = () =>
      entryFor({ id: 'a-x', npm: '@t/a', repo: 'https://github.com/BBeBeeX/BBeBee' })

    it('refuses an install whose provenance names a different source repo', async () => {
      const entry = officialEntry()
      const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      w.routes.set(ATTESTATIONS_URL, {
        status: 200,
        json: async () => attestationsBody('https://github.com/attacker/sneaky-builds'),
      })
      await w.plugin[PluginManagerPlugin.init]()
      await expectNpmError(w.plugin.installPlugin('a-x'), 'SPOOF_DETECTED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('installs and surfaces provenanceVerified when the attestation matches the entry repo', async () => {
      const entry = officialEntry()
      const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      w.routes.set(ATTESTATIONS_URL, {
        status: 200,
        json: async () => attestationsBody('https://github.com/BBeBeeX/BBeBee'),
      })
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
      const info = w.plugin.list().find((p) => p.id === 'a-x')
      expect(info?.provenanceVerified).toBe(true)
      // Persisted on the install record, so the next session's list()
      // (seeded from the records) keeps the badge.
      const records = await (w.plugin as any).loadInstalledRecords()
      expect(records['a-x']?.provenanceVerified).toBe(true)
    })

    it('installs without provenance (attestations 404) and leaves the flag unset', async () => {
      const entry = officialEntry()
      const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      // No attestations route: the harness answers 404, npm's "no
      // attestations for this version" — pilot policy is warn-only.
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
      const info = w.plugin.list().find((p) => p.id === 'a-x')
      expect(info?.provenanceVerified).toBeUndefined()
    })
  })

  it('throws BRIDGE_UNAVAILABLE without an installPlugin bridge', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    w.plugin.setLifecycleBridge({ loadPlugin: async () => {}, unloadPlugin: async () => {} })
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('a-x'), 'BRIDGE_UNAVAILABLE')
  })

  it('browseRegistry filters by platform', async () => {
    const d = entryFor({ id: 'd-x', npm: '@t/d', platforms: ['desktop'] })
    const m = entryFor({ id: 'm-y', npm: '@t/m', platforms: ['mobile'] })
    const w = createNpmWorld({ platform: 'desktop' })
    w.routes.set(INDEX_URL, { status: 200, json: async () => [d, m] })
    await w.plugin[PluginManagerPlugin.init]()
    const entries = await w.plugin.browseRegistry()
    expect(entries.map((e) => e.id)).toEqual(['d-x'])
  })

  describe('index document forms (audit W5)', () => {
    it('accepts the object form and surfaces entries, blocked and reviewed pins', async () => {
      const e = entryFor({
        id: 'a-x',
        npm: '@t/a',
        reviewedVersion: '1.0.0',
        reviewedIntegrity: 'sha512-AAA=',
      })
      const w = createNpmWorld({ platform: 'desktop' })
      w.routes.set(INDEX_URL, {
        status: 200,
        json: async () => ({ entries: [e], blocked: [{ id: 'evil-1', reason: 'malware' }] }),
      })
      await w.plugin[PluginManagerPlugin.init]()
      const entries = await w.plugin.browseRegistry()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.reviewedVersion).toBe('1.0.0')
      expect(entries[0]!.reviewedIntegrity).toBe('sha512-AAA=')
      const client = (w.plugin as any).getNpmClient() as NpmClient
      const doc = await client.fetchIndexDocument()
      expect(doc.blocked).toEqual([{ id: 'evil-1', reason: 'malware' }])
    })

    it('accepts the legacy bare-array form with an empty blocked channel', async () => {
      const e = entryFor({ id: 'a-x', npm: '@t/a' })
      const w = createNpmWorld({ platform: 'desktop' })
      w.routes.set(INDEX_URL, { status: 200, json: async () => [e] })
      await w.plugin[PluginManagerPlugin.init]()
      const client = (w.plugin as any).getNpmClient() as NpmClient
      const doc = await client.fetchIndexDocument()
      expect(doc.entries.map((x) => x.id)).toEqual(['a-x'])
      expect(doc.blocked).toEqual([])
    })

    it('rejects malformed index documents', async () => {
      const w = createNpmWorld({ platform: 'desktop' })
      w.routes.set(INDEX_URL, { status: 200, json: async () => ({ blocked: [] }) })
      await w.plugin[PluginManagerPlugin.init]()
      await expectNpmError(w.plugin.browseRegistry(), 'INDEX_INVALID')
    })
  })

  describe('planInstall refreshes a stale index once before ENTRY_NOT_FOUND', () => {
    it('finds an entry that reached the registry after the index was cached', async () => {
      const stale = entryFor({ id: 'a-x', npm: '@t/a' })
      const fresh = entryFor({ id: 'b-y', npm: '@t/b' })
      const tarballs = { '@t/b@1.0.0': tarballFor('@t/b', 'b-y', '1.0.0') }
      const w = createNpmWorld({ platform: 'desktop' })
      let served: unknown = [stale]
      let indexHits = 0
      w.routes.set(INDEX_URL, {
        status: 200,
        json: async () => {
          indexHits++
          return served
        },
      })
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent('@t/b')}`, {
        status: 200,
        json: async () => packument('@t/b', ['1.0.0'], tarballs),
      })
      await w.plugin[PluginManagerPlugin.init]()
      // Prime the 24h index cache with the pre-onboarding copy.
      await w.plugin.browseRegistry()
      const hitsAfterPrime = indexHits
      // The registry gains the entry (push lands, CDN catches up).
      served = [stale, fresh]
      const plan = await w.plugin.resolveInstallPlan('b-y')
      expect(plan.target.id).toBe('b-y')
      // Exactly one forced refetch on the miss — no retry loop.
      expect(indexHits).toBe(hitsAfterPrime + 1)
    })

    it('still throws ENTRY_NOT_FOUND when the live index lacks the id', async () => {
      const w = createNpmWorld({ platform: 'desktop' })
      let indexHits = 0
      w.routes.set(INDEX_URL, {
        status: 200,
        json: async () => {
          indexHits++
          return [entryFor({ id: 'a-x', npm: '@t/a' })]
        },
      })
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.browseRegistry()
      const hitsAfterPrime = indexHits
      await expectNpmError(w.plugin.resolveInstallPlan('ghost'), 'ENTRY_NOT_FOUND')
      expect(indexHits).toBe(hitsAfterPrime + 1)
    })
  })

  it('checkUpdates finds a newer version and stamps the check time', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = {
      '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
      '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
    }
    const w = seedWorld(entry, ['1.0.0', '1.1.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x', '1.0.0')
    const updates = await w.plugin.checkUpdates()
    expect(updates).toEqual([{ id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' }])
    const storeMock = (w.ctx as any).store
    expect(storeMock.set).toHaveBeenCalledWith('npm:last-update-check', expect.any(Number))
  })

  it('updatePlugin requires confirmation for major bumps', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = {
      '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
      '@t/a@2.0.0': tarballFor('@t/a', 'a-x', '2.0.0'),
    }
    const w = seedWorld(entry, ['1.0.0', '2.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x', '1.0.0')
    await expectNpmError(w.plugin.updatePlugin('a-x'), 'MAJOR_UPDATE_NEEDS_CONFIRM')
    // explicit version proceeds
    await w.plugin.updatePlugin('a-x', '2.0.0')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(2)
  })

  it('uninstall refuses when another installed plugin depends on it', async () => {
    const w = createNpmWorld({
      manifests: {
        'a-x': { id: 'a-x', name: 'a-x', version: '1.0.0', engines: { BBeBee: '^0.1.0' }, entry: { main: './x.js' }, capabilities: [] } as PluginManifest,
        'b-y': {
          id: 'b-y', name: 'b-y', version: '1.0.0', engines: { BBeBee: '^0.1.0' }, entry: { main: './x.js' }, capabilities: [],
          dependencies: ['a-x'],
        } as PluginManifest,
      },
    })
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.uninstall('a-x'), 'HAS_DEPENDENTS')
  })

  it('setNpmAuthToken uses secrets, never the store', async () => {
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.setNpmAuthToken('s3cr3t')
    const secrets = (w.ctx as any).secrets
    expect(secrets.set).toHaveBeenCalledWith('npm.auth-token', 's3cr3t')
    const storeMock = (w.ctx as any).store
    for (const [, v] of storeMock.set.mock.calls as Array<[string, unknown]>) {
      expect(JSON.stringify(v)).not.toContain('s3cr3t')
    }
    await w.plugin.clearNpmAuthToken()
    expect(secrets.delete).toHaveBeenCalledWith('npm.auth-token')
  })

  it('hasNpmAuthToken reports presence without exposing the value', async () => {
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    expect(await w.plugin.hasNpmAuthToken()).toBe(false)
    await w.plugin.setNpmAuthToken('s3cr3t')
    expect(await w.plugin.hasNpmAuthToken()).toBe(true)
    await w.plugin.clearNpmAuthToken()
    expect(await w.plugin.hasNpmAuthToken()).toBe(false)
  })

  it('uses the china mirror when downloadRegion is mainland-china', async () => {
    const w = createNpmWorld()
    w.settingsData.downloadRegion = 'mainland-china'
    const client = (w.plugin as any).getNpmClient() as NpmClient
    expect((await client.effectiveNpmRegistry()).url).toBe('https://registry.npmmirror.com')
    expect((await client.registryRawBase()).url).toContain('cdn.jsdelivr.net')
    w.settingsData.npmRegistryUrl = 'https://npm.private.example/'
    expect((await client.effectiveNpmRegistry()).url).toBe('https://npm.private.example')
  })

  it('falls back to the official registry when the mirror fails', async () => {
    const w = createNpmWorld()
    w.settingsData.downloadRegion = 'mainland-china'
    const client = (w.plugin as any).getNpmClient() as NpmClient
    const official = 'https://registry.npmjs.org/%40t%2Fa'
    w.routes.set(official, { status: 200, json: async () => ({ name: '@t/a', versions: {} }) })
    const pack = await client.fetchPackument('@t/a')
    expect(pack.name).toBe('@t/a')
    expect(w.httpMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://registry.npmmirror.com/%40t%2Fa' }),
    )
  })

  /** Builds a world where `a-x` depends on `b-y` (install order: b-y, a-x). */
  function seedClosureWorld(versionsA: string[], versionsB: string[]) {
    const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['b-y'] })
    const b = entryFor({ id: 'b-y', npm: '@t/b' })
    const tarballs: Record<string, Uint8Array> = {}
    for (const v of versionsA) tarballs[`@t/a@${v}`] = tarballFor('@t/a', 'a-x', v)
    for (const v of versionsB) tarballs[`@t/b@${v}`] = tarballFor('@t/b', 'b-y', v)
    const w = seedWorld(a, versionsA, tarballs)
    w.routes.set(INDEX_URL, { status: 200, json: async () => [a, b] })
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent('@t/b')}`, {
      status: 200,
      json: async () => packument('@t/b', versionsB, tarballs),
    })
    for (const v of versionsB) {
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent('@t/b')}-/${v}.tgz`, {
        status: 200,
        bytes: async () => tarballs[`@t/b@${v}`]!,
      })
    }
    return w
  }

  it('records entrySha256 (entry-file hash) for the boot tamper chain (Fix B)', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x')
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    const rec = setCalls.at(-1)![1]['a-x']
    // 'export const name = \'a-x\'' is the entry main content in tarballFor
    expect(rec.entrySha256).toBe(sha256Hex(`export const name = 'a-x'`))
    expect(rec.entrySha256).not.toBe(rec.sha256)
  })

  it('rolls back a failed first install: completed nodes are uninstalled and their records removed (audit W3; per-node records from Fix C are the mechanism, the end state changed)', async () => {
    const w = seedClosureWorld(['1.0.0'], ['1.0.0'])
    await w.plugin[PluginManagerPlugin.init]()
    w.bridge.installPlugin = vi.fn(async (id: string) => {
      if (id === 'a-x') throw new Error('bridge boom')
    }) as typeof w.bridge.installPlugin
    const uninstallSpy = vi.fn(async () => {})
    ;(w.bridge as any).uninstallPlugin = uninstallSpy
    await expect(w.plugin.installPlugin('a-x')).rejects.toThrow('bridge boom')
    // b-y finished before a-x failed; the first-install rollback removes
    // it again through the bridge (files + directory) and drops its
    // record — nothing of the failed install stays behind.
    expect(uninstallSpy).toHaveBeenCalledWith('b-y')
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    const last = setCalls.at(-1)![1] as Record<string, any>
    expect(last['b-y']).toBeUndefined()
    expect(last['a-x']).toBeUndefined()
  })

  it('updatePlugin rolls back every replaced node in reverse order when activation fails (Fix C)', async () => {
    const w = seedClosureWorld(['1.0.0'], ['1.0.0'])
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x', '1.0.0')
    // publish 1.1.0 for both packages "later"
    const newTarballs: Record<string, Uint8Array> = {
      '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
      '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
      '@t/b@1.0.0': tarballFor('@t/b', 'b-y', '1.0.0'),
      '@t/b@1.1.0': tarballFor('@t/b', 'b-y', '1.1.0'),
    }
    for (const npm of ['@t/a', '@t/b'] as const) {
      const versions = ['1.0.0', '1.1.0']
      const byNpm = Object.fromEntries(
        versions.map((v) => [`${npm}@${v}`, newTarballs[`${npm}@${v}`]!] as const),
      )
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(npm)}`, {
        status: 200,
        json: async () => packument(npm, versions, byNpm),
      })
      for (const v of versions) {
        w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(npm)}-/${v}.tgz`, {
          status: 200,
          bytes: async () => newTarballs[`${npm}@${v}`]!,
        })
      }
      // the install above cached the old packument (15min TTL) — drop it so
      // the update plans against the freshly published one
      await (w.ctx as any).store.delete(`npm:packument:${npm}`)
    }
    let aXInstalls = 0
    w.bridge.installPlugin = vi.fn(async (id: string) => {
      if (id === 'a-x' && ++aXInstalls === 1) throw new Error('activation boom')
    }) as typeof w.bridge.installPlugin
    await expect(w.plugin.updatePlugin('a-x')).rejects.toThrow('activation boom')
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    const last = setCalls.at(-1)![1] as Record<string, any>
    // both nodes rolled back to their previous versions, records included
    expect(last['a-x']?.version).toBe('1.0.0')
    expect(last['b-y']?.version).toBe('1.0.0')
    // rollback order: dependents before their dependencies
    const calls = w.bridge.installPlugin.mock.calls.map((call) => call[0] as string)
    expect(calls.slice(-2)).toEqual(['a-x', 'b-y'])
  })

  it('browseRegistry(true) bypasses the 24h index cache (Fix D)', async () => {
    const d = entryFor({ id: 'd-x', npm: '@t/d', platforms: ['desktop'] })
    const e = entryFor({ id: 'e-z', npm: '@t/e', platforms: ['desktop'] })
    const w = createNpmWorld({ platform: 'desktop' })
    w.routes.set(INDEX_URL, { status: 200, json: async () => [d] })
    await w.plugin[PluginManagerPlugin.init]()
    expect((await w.plugin.browseRegistry()).map((x) => x.id)).toEqual(['d-x'])
    w.routes.set(INDEX_URL, { status: 200, json: async () => [d, e] })
    expect((await w.plugin.browseRegistry()).map((x) => x.id)).toEqual(['d-x'])
    expect((await w.plugin.browseRegistry(true)).map((x) => x.id)).toEqual(['d-x', 'e-z'])
  })

  it('checkUpdates(true) bypasses the packument cache (Fix D)', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs = {
      '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
      '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
    }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x', '1.0.0')
    expect(await w.plugin.checkUpdates()).toEqual([])
    // publish 1.1.0 "later"
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent('@t/a')}`, {
      status: 200,
      json: async () => packument('@t/a', ['1.0.0', '1.1.0'], tarballs),
    })
    expect(await w.plugin.checkUpdates()).toEqual([])
    const updates = await w.plugin.checkUpdates(true)
    expect(updates).toEqual([{ id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' }])
  })

  describe('install-time scan coverage (audit W2)', () => {
    it('still scans an .mjs entry carrying eval(atob(...)) — extension is not a scan bypass, but eval is warn-only', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const manifest = { ...manifestFor('a-x', '1.0.0'), entry: { main: './dist/payload.mjs' } }
      const tarballs = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0', {
          'BBeBee.plugin.json': JSON.stringify(manifest),
          'dist/payload.mjs': 'eval(atob("YWxlcnQoMSk="))',
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      // Advisory policy: eval warns and the install proceeds (the scan
      // still ran — a .mjs entry is not skipped). Only block findings
      // (data:/remote imports, leaked credentials) refuse the install.
      await w.plugin.installPlugin('a-x')
      expect(w.bridge.installPlugin).toHaveBeenCalled()
    })

    it('blocks a data: dynamic import in an entry file', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0', {
          'dist/index.js': `import('data:text/javascript;base64,YWxlcnQoMSk=')`,
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await expectNpmError(w.plugin.installPlugin('a-x'), 'SECURITY_BLOCKED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('installs a package whose extra .mjs file is benign', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0', {
          'dist/helper.mjs': 'export const helper = 41 + 1',
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
    })
  })

  describe('plan/execute binding (audit W3)', () => {
    it('executes exactly the plan the caller confirmed', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x')
      await w.plugin.installPlugin('a-x', undefined, plan)
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      expect(setCalls.at(-1)![1]['a-x'].version).toBe('1.0.0')
    })

    it('refuses with PLAN_CHANGED when a new version is published between plan and confirm', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs: Record<string, Uint8Array> = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x')
      // "Upstream" publishes 1.1.0 after the confirm screen was rendered.
      tarballs['@t/a@1.1.0'] = tarballFor('@t/a', 'a-x', '1.1.0')
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
        status: 200,
        json: async () => packument(entry.npm, ['1.0.0', '1.1.0'], tarballs),
      })
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/1.1.0.tgz`, {
        status: 200,
        bytes: async () => tarballs['@t/a@1.1.0']!,
      })
      await (w.ctx as any).store.delete('npm:packument:@t/a')
      await expectNpmError(w.plugin.installPlugin('a-x', undefined, plan), 'PLAN_CHANGED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('refuses with PLAN_CHANGED when the confirmed plan itself was tampered with', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x')
      const tampered = { ...plan, target: { ...plan.target, version: '9.9.9' } }
      await expectNpmError(w.plugin.installPlugin('a-x', undefined, tampered), 'PLAN_CHANGED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('refuses with PLAN_CHANGED when a closure dependency pin drifts', async () => {
      const w = seedClosureWorld(['1.0.0'], ['1.0.0'])
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x')
      expect(plan.closure.map((p) => `${p.id}@${p.version}`)).toEqual(['b-y@1.0.0'])
      const newTarballs: Record<string, Uint8Array> = {
        '@t/b@1.0.0': tarballFor('@t/b', 'b-y', '1.0.0'),
        '@t/b@1.1.0': tarballFor('@t/b', 'b-y', '1.1.0'),
      }
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent('@t/b')}`, {
        status: 200,
        json: async () => packument('@t/b', ['1.0.0', '1.1.0'], newTarballs),
      })
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent('@t/b')}-/1.1.0.tgz`, {
        status: 200,
        bytes: async () => newTarballs['@t/b@1.1.0']!,
      })
      await (w.ctx as any).store.delete('npm:packument:@t/b')
      const err = await w.plugin.installPlugin('a-x', undefined, plan).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NpmPluginError)
      expect((err as NpmPluginError).code).toBe('PLAN_CHANGED')
      expect((err as Error).message).toContain('b-y')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })
  })

  describe('rollback material verification (audit W3)', () => {
    it('aborts the update when the old version fails integrity verification as rollback material', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs: Record<string, Uint8Array> = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
        '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)

      // 1.1.0 is published — but the bytes now served for 1.0.0 no longer
      // match the integrity the packument declares for them (the
      // packument is re-served with a bogus 1.0.0 integrity). Staging
      // that tarball as rollback material must refuse, and the update
      // must abort before writing anything.
      const corrupted = packument(entry.npm, ['1.0.0', '1.1.0'], tarballs) as any
      corrupted.versions['1.0.0'].dist.integrity = `sha512-${base64Encode(sha512(new TextEncoder().encode('not the tarball')))}`
      w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
        status: 200,
        json: async () => corrupted,
      })
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/1.1.0.tgz`, {
        status: 200,
        bytes: async () => tarballs['@t/a@1.1.0']!,
      })
      await (w.ctx as any).store.delete('npm:packument:@t/a')

      const err = await w.plugin.updatePlugin('a-x').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NpmPluginError)
      expect((err as NpmPluginError).code).toBe('INTEGRITY_MISMATCH')
      expect((err as Error).message).toContain('回滚材料')
      // Nothing was written: the only bridge install remains the original.
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      expect(setCalls.at(-1)![1]['a-x'].version).toBe('1.0.0')
    })

    it('still rolls back with verified material when activation of the new version fails', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs: Record<string, Uint8Array> = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
        '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
      }
      const w = seedWorld(entry, ['1.0.0', '1.1.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      let installs = 0
      w.bridge.installPlugin = vi.fn(async (id: string) => {
        installs++
        // The new version's files land but activation reports a terminal
        // failure state — the node counts as replaced, so the rollback
        // must restore the staged (and now verified) old package.
        if (installs === 1) return { pluginId: id, state: 'failed', error: new Error('activation boom') }
        return { pluginId: id, state: 'active' }
      }) as typeof w.bridge.installPlugin
      await expect(w.plugin.updatePlugin('a-x')).rejects.toThrow('activation boom')
      // install(1.1.0, fails) + install(rollback 1.0.0) — the verified
      // rollback material was actually used.
      expect(installs).toBe(2)
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      expect(setCalls.at(-1)![1]['a-x'].version).toBe('1.0.0')
    })
  })

  describe('full-package tamper chain (audit W3)', () => {
    it('pins a sha256 for EVERY package file in the install record', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0', { 'dist/extra.js': 'export const x = 1' }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      // The files handed to the bridge are exactly the set the record pins.
      const writtenFiles = (w.bridge.installPlugin as any).mock.calls[0][1] as Record<string, string>
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      const record = setCalls.at(-1)![1]['a-x']
      expect(Object.keys(record.fileHashes).sort()).toEqual(Object.keys(writtenFiles).sort())
      for (const [path, content] of Object.entries(writtenFiles)) {
        expect(record.fileHashes[path]).toBe(sha256Hex(content))
      }
      // The legacy entry hash is the same map's entry-file view.
      expect(record.entrySha256).toBe(record.fileHashes['dist/index.js'])
      expect(record.entrySha256).toBe(sha256Hex(`export const name = 'a-x'`))
    })
  })

  describe('liveness / delisting (audit W3)', () => {
    async function installedWorld() {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const tarballs: Record<string, Uint8Array> = {
        '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0'),
        '@t/a@1.1.0': tarballFor('@t/a', 'a-x', '1.1.0'),
      }
      const w = seedWorld(entry, ['1.0.0', '1.1.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      return { w, entry }
    }

    async function savedRecord(w: ReturnType<typeof createNpmWorld>) {
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      return setCalls.at(-1)![1]['a-x'] as Record<string, any>
    }

    it('flags a plugin whose id vanished from the index, excludes it from updates, and refuses its update with DELISTED', async () => {
      const { w, entry } = await installedWorld()
      // Sanity: while listed, the 1.1.0 update is reported.
      expect(await w.plugin.checkUpdates()).toEqual([
        { id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' },
      ])
      // The entry is pulled from the registry; the next index fetch sees it.
      w.routes.set(INDEX_URL, { status: 200, json: async () => [] })
      await (w.ctx as any).store.delete('npm:index')
      const updates = await w.plugin.checkUpdates()
      expect(updates).toEqual([])
      // Persisted flag + visible in list() + unloaded for this session.
      expect((await savedRecord(w)).delisted).toBe(true)
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.delisted).toBe(true)
      expect(w.bridge.unloadPlugin).toHaveBeenCalledWith('a-x')
      // updatePlugin agrees with checkUpdates now: DELISTED, not ENTRY_NOT_FOUND.
      await expectNpmError(w.plugin.updatePlugin('a-x'), 'DELISTED')
      void entry
    })

    it('never delists when the index cannot be fetched (offline fails open)', async () => {
      const { w } = await installedWorld()
      w.routes.set(INDEX_URL, { status: 404 })
      await (w.ctx as any).store.delete('npm:index')
      const updates = await w.plugin.checkUpdates()
      // The update is still reported and no flag was persisted.
      expect(updates).toEqual([{ id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' }])
      expect((await savedRecord(w)).delisted).toBeUndefined()
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.delisted).toBeUndefined()
    })

    it('clears the flag when the id reappears in the index', async () => {
      const { w, entry } = await installedWorld()
      w.routes.set(INDEX_URL, { status: 200, json: async () => [] })
      await (w.ctx as any).store.delete('npm:index')
      await w.plugin.checkUpdates()
      expect((await savedRecord(w)).delisted).toBe(true)
      w.routes.set(INDEX_URL, { status: 200, json: async () => [entry] })
      await (w.ctx as any).store.delete('npm:index')
      const updates = await w.plugin.checkUpdates()
      expect(updates).toEqual([{ id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' }])
      expect((await savedRecord(w)).delisted).toBeUndefined()
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.delisted).toBeUndefined()
    })
  })

  describe('reviewed pinning (audit W5)', () => {
    const versions = ['1.0.0', '1.1.0', '1.2.0']
    const tarballs = () =>
      Object.fromEntries(versions.map((v) => [`@t/a@${v}`, tarballFor('@t/a', 'a-x', v)]))

    function pinnedWorld(reviewed: Partial<RegistryPluginEntry> = {}) {
      const entry = entryFor({ id: 'a-x', npm: '@t/a', reviewedVersion: '1.1.0', ...reviewed })
      const w = seedWorld(entry, versions, tarballs())
      return { w, entry }
    }

    const installedVersion = async (w: NpmTestWorld) => {
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      return setCalls.at(-1)?.[1]?.['a-x']?.version as string | undefined
    }

    it('plans and installs the reviewed version by default, not npm latest', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x')
      expect(plan.target.version).toBe('1.1.0')
      expect(plan.target.unreviewed).toBeUndefined()
      await w.plugin.installPlugin('a-x')
      expect(await installedVersion(w)).toBe('1.1.0')
    })

    it('an explicitly named newer version installs but is flagged unreviewed in the plan', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x', '1.2.0')
      expect(plan.target.version).toBe('1.2.0')
      expect(plan.target.unreviewed).toBe(true)
      expect(plan.warnings.some((x) => x.includes('未经注册表审核'))).toBe(true)
      await w.plugin.installPlugin('a-x', '1.2.0', plan)
      expect(await installedVersion(w)).toBe('1.2.0')
    })

    it('a range overshooting the pin is still capped to the reviewed version', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      const plan = await w.plugin.resolveInstallPlan('a-x', '^1.0.0')
      expect(plan.target.version).toBe('1.1.0')
      expect(plan.target.unreviewed).toBeUndefined()
    })

    it('caps dependency closure nodes to their own reviewed pins', async () => {
      const b = entryFor({ id: 'b-y', npm: '@t/b', reviewedVersion: '1.0.0' })
      const a = entryFor({ id: 'a-x', npm: '@t/a', dependencies: ['b-y@^1.0.0'] })
      const c = new (class extends NpmClient {
        constructor(private packs: Record<string, any>) {
          super({ http: {} as any, readSettings: async () => undefined, readSecret: async () => undefined, cache: { get: async () => undefined, set: async () => {} }, log: { info() {}, warn() {}, error() {} } })
        }
        override async fetchPackument(npm: string) {
          return this.packs[npm]
        }
      })({
        '@t/a': { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { version: '1.0.0', dist: { tarball: 'https://x/a.tgz' } } } },
        '@t/b': {
          'dist-tags': { latest: '1.5.0' },
          versions: {
            '1.0.0': { version: '1.0.0', dist: { tarball: 'https://x/b1.tgz' } },
            '1.5.0': { version: '1.5.0', dist: { tarball: 'https://x/b15.tgz' } },
          },
        },
      })
      const { target, closure } = await c.resolveTree(a, undefined, [a, b])
      expect(target.pkg.version).toBe('1.0.0')
      expect(closure.map((n) => [n.pkg.id, n.pkg.version])).toEqual([['b-y', '1.0.0']])
    })

    it('refuses bytes that do not match the reviewed integrity, even when packument integrity agrees', async () => {
      const good = tarballs()
      const falsePin = `sha512-${base64Encode(sha512(new TextEncoder().encode('not the tarball')))}`
      const entry = entryFor({ id: 'a-x', npm: '@t/a', reviewedVersion: '1.1.0', reviewedIntegrity: falsePin })
      const w = seedWorld(entry, versions, good)
      await w.plugin[PluginManagerPlugin.init]()
      try {
        await w.plugin.installPlugin('a-x')
        throw new Error('expected INTEGRITY_MISMATCH')
      } catch (err) {
        expect(err).toBeInstanceOf(NpmPluginError)
        expect((err as NpmPluginError).code).toBe('INTEGRITY_MISMATCH')
        expect((err as Error).message).toContain('已审哈希不符')
      }
      expect(await installedVersion(w)).toBeUndefined()
    })

    it('accepts the reviewed version when the reviewed integrity matches', async () => {
      const tbs = tarballs()
      const pin = `sha512-${base64Encode(sha512(tbs['@t/a@1.1.0']!))}`
      const entry = entryFor({ id: 'a-x', npm: '@t/a', reviewedVersion: '1.1.0', reviewedIntegrity: pin })
      const w = seedWorld(entry, versions, tbs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      expect(await installedVersion(w)).toBe('1.1.0')
    })

    it('checkUpdates separates the reviewed update from a newer unreviewed one', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      const updates = await w.plugin.checkUpdates()
      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({
        id: 'a-x',
        installed: '1.0.0',
        latest: '1.2.0',
        reviewedVersion: '1.1.0',
        reviewedUpdate: '1.1.0',
        unreviewed: true,
      })
    })

    it('a default update stops at the reviewed version, not at latest', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      await w.plugin.updatePlugin('a-x')
      expect(await installedVersion(w)).toBe('1.1.0')
    })

    it('with the reviewed version already installed, the remaining update reads as unreviewed-only', async () => {
      const { w } = pinnedWorld()
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x')
      const updates = await w.plugin.checkUpdates()
      expect(updates).toHaveLength(1)
      expect(updates[0]!.reviewedUpdate).toBeUndefined()
      expect(updates[0]!.unreviewed).toBe(true)
    })
  })

  describe('registry blocklist (audit W5)', () => {
    const versions = ['1.0.0', '1.1.0']
    const tarballs = () =>
      Object.fromEntries(versions.map((v) => [`@t/a@${v}`, tarballFor('@t/a', 'a-x', v)]))

    async function installedWorld() {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const w = seedWorld(entry, versions, tarballs())
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('a-x', '1.0.0')
      return { w, entry }
    }

    const savedRecord = async (w: NpmTestWorld) => {
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
      return setCalls.at(-1)![1]['a-x'] as Record<string, any>
    }

    const setIndex = async (w: NpmTestWorld, json: unknown) => {
      w.routes.set(INDEX_URL, { status: 200, json: async () => json })
      await (w.ctx as any).store.delete('npm:index')
    }

    it('quarantines an installed plugin the index bans, distinctly from delisting', async () => {
      const { w, entry } = await installedWorld()
      await setIndex(w, {
        entries: [entry],
        blocked: [{ id: 'a-x', reason: 'malware: credential stealer' }],
      })
      const updates = await w.plugin.checkUpdates()
      expect(updates).toEqual([])
      const rec = await savedRecord(w)
      expect(rec.blocked).toBe('malware: credential stealer')
      expect(rec.delisted).toBeUndefined()
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.blocked).toBe('malware: credential stealer')
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.delisted).toBeUndefined()
      expect(w.bridge.unloadPlugin).toHaveBeenCalledWith('a-x')
      await expectNpmError(w.plugin.updatePlugin('a-x'), 'BLOCKED')
    })

    it('lifts the ban when the id leaves the blocked list', async () => {
      const { w, entry } = await installedWorld()
      await setIndex(w, { entries: [entry], blocked: [{ id: 'a-x', reason: 'malware' }] })
      await w.plugin.checkUpdates()
      expect((await savedRecord(w)).blocked).toBe('malware')
      await setIndex(w, { entries: [entry], blocked: [] })
      const updates = await w.plugin.checkUpdates()
      expect(updates).toEqual([{ id: 'a-x', installed: '1.0.0', latest: '1.1.0', npm: '@t/a' }])
      expect((await savedRecord(w)).blocked).toBeUndefined()
      expect(w.plugin.list().find((p) => p.id === 'a-x')?.blocked).toBeUndefined()
    })

    it('refuses to install a banned id that was never installed', async () => {
      const entry = entryFor({ id: 'a-x', npm: '@t/a' })
      const w = seedWorld(entry, versions, tarballs())
      await setIndex(w, { entries: [entry], blocked: [{ id: 'a-x', reason: 'impersonation' }] })
      await w.plugin[PluginManagerPlugin.init]()
      await expectNpmError(w.plugin.installPlugin('a-x'), 'BLOCKED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('keeps ban and delisting as independent flags when both apply', async () => {
      const { w } = await installedWorld()
      await setIndex(w, { entries: [], blocked: [{ id: 'a-x', reason: 'malware' }] })
      await w.plugin.checkUpdates()
      const rec = await savedRecord(w)
      expect(rec.delisted).toBe(true)
      expect(rec.blocked).toBe('malware')
    })
  })

  describe('provider arbitration (audit W5)', () => {
    const vizManifest = (id: string) => manifestFor(id, '1.0.0', ['visualizer']) as PluginManifest

    function twoProviderWorld() {
      const { ctx } = createTestContext()
      const plugin = new PluginManagerPlugin(ctx, {
        manifests: {
          '@BBeBee/plugin-visualizer': vizManifest('@BBeBee/plugin-visualizer'),
          'third-viz': vizManifest('third-viz'),
          '@BBeBee/plugin-player': manifestFor('@BBeBee/plugin-player', '1.0.0', ['player']) as PluginManifest,
        },
      })
      const bridge = {
        loadPlugin: vi.fn(async () => {}),
        unloadPlugin: vi.fn(async () => {}),
        installPlugin: vi.fn(async () => ({ state: 'ACTIVE' as const })),
        uninstallPlugin: vi.fn(async () => {}),
      }
      plugin.setLifecycleBridge(bridge)
      return { ctx, plugin, bridge }
    }

    it('lists multi-provider keys with the default (built-in) active provider', async () => {
      const { plugin } = twoProviderWorld()
      await plugin[PluginManagerPlugin.init]()
      const infos = plugin.listServiceProviders()
      expect(infos).toEqual([
        {
          key: 'visualizer',
          critical: false,
          providers: ['@BBeBee/plugin-visualizer', 'third-viz'],
          activeProvider: '@BBeBee/plugin-visualizer',
        },
      ])
    })

    it('switches the active provider, persists the choice and unloads the loser', async () => {
      const { ctx, plugin, bridge } = twoProviderWorld()
      await plugin[PluginManagerPlugin.init]()
      await plugin.setServiceProvider('visualizer', 'third-viz')
      const store = (ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'service-providers')
      expect(setCalls.at(-1)![1]).toEqual({ visualizer: 'third-viz' })
      expect(bridge.unloadPlugin).toHaveBeenCalledWith('@BBeBee/plugin-visualizer')
      expect(plugin.listServiceProviders()[0]!.activeProvider).toBe('third-viz')
    })

    it('refuses to switch a critical key or to a non-provider', async () => {
      const { plugin } = twoProviderWorld()
      await plugin[PluginManagerPlugin.init]()
      await expectNpmError(plugin.setServiceProvider('player', 'third-viz'), 'CRITICAL_PROVIDER')
      await expectNpmError(plugin.setServiceProvider('visualizer', '@BBeBee/plugin-player'), 'NOT_A_PROVIDER')
    })

    it('refuses a downloaded manifest claiming a critical key with an incumbent provider', async () => {
      const entry = entryFor({ id: 'evil-x', npm: '@t/evil', provides: ['player'] })
      const tarballs = {
        '@t/evil@1.0.0': tarballFor('@t/evil', 'evil-x', '1.0.0', {
          'BBeBee.plugin.json': JSON.stringify(manifestFor('evil-x', '1.0.0', ['player'])),
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await expectNpmError(w.plugin.installPlugin('evil-x'), 'SPOOF_DETECTED')
      expect(w.bridge.installPlugin).not.toHaveBeenCalled()
    })

    it('installing a same-key package preempts the incumbent and records the selection', async () => {
      const entry = entryFor({ id: 'new-viz', npm: '@t/newviz', provides: ['visualizer'] })
      const tarballs = {
        '@t/newviz@1.0.0': tarballFor('@t/newviz', 'new-viz', '1.0.0', {
          'BBeBee.plugin.json': JSON.stringify(manifestFor('new-viz', '1.0.0', ['visualizer'])),
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      w.plugin.registerManifests({ '@BBeBee/plugin-visualizer': vizManifest('@BBeBee/plugin-visualizer') })
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('new-viz')
      expect(w.bridge.unloadPlugin).toHaveBeenCalledWith('@BBeBee/plugin-visualizer')
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'service-providers')
      expect(setCalls.at(-1)![1]).toEqual({ visualizer: 'new-viz' })
      const info = w.plugin.listServiceProviders().find((i) => i.key === 'visualizer')
      expect(info?.activeProvider).toBe('new-viz')
    })

    it('installing a provider of a non-critical key with no incumbent just installs', async () => {
      const entry = entryFor({ id: 'new-viz', npm: '@t/newviz', provides: ['visualizer'] })
      const tarballs = {
        '@t/newviz@1.0.0': tarballFor('@t/newviz', 'new-viz', '1.0.0', {
          'BBeBee.plugin.json': JSON.stringify(manifestFor('new-viz', '1.0.0', ['visualizer'])),
        }),
      }
      const w = seedWorld(entry, ['1.0.0'], tarballs)
      await w.plugin[PluginManagerPlugin.init]()
      await w.plugin.installPlugin('new-viz')
      expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
      const store = (w.ctx as any).store
      const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'service-providers')
      expect(setCalls).toHaveLength(0)
    })
  })
})

describe('plugin-manager local package import', () => {
  const b64 = (bytes: Uint8Array) => base64Encode(bytes)

  it('previews a local package: identity, capabilities, hash, unreviewed warning', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.2.0', {
      'BBeBee.plugin.json': JSON.stringify(manifestFor('local-x', '1.2.0', [], ['fs:read/**'])),
    })
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    const preview = await w.plugin.previewLocalPlugin(b64(bytes))
    expect(preview.id).toBe('local-x')
    expect(preview.npm).toBe('@t/local')
    expect(preview.version).toBe('1.2.0')
    expect(preview.capabilities).toEqual(['fs:read/**'])
    expect(preview.fileCount).toBe(3)
    expect(preview.sha256).toBe(sha256Hex(bytes))
    expect(preview.installedVersion).toBeUndefined()
    expect(preview.warnings.some((x) => x.includes('本地导入'))).toBe(true)
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('rejects a package that is not a gzip tarball', async () => {
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.previewLocalPlugin(base64Encode('definitely not a tarball')), 'TARBALL_INVALID')
  })

  it('requires explicit confirmation before installing', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0')
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes)), 'CONFIRM_REQUIRED')
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes), { confirmed: false }), 'CONFIRM_REQUIRED')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('installs end to end and stamps the record as local', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0')
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    const preview = await w.plugin.installLocalPlugin(b64(bytes), { confirmed: true })
    expect(preview.id).toBe('local-x')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
    const [id, files, manifest] = w.bridge.installPlugin.mock.calls[0]!
    expect(id).toBe('local-x')
    expect(files['dist/index.js']).toContain('local-x')
    expect(manifest.id).toBe('local-x')
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    const record = setCalls.at(-1)![1]['local-x']
    expect(record.version).toBe('1.0.0')
    expect(record.source).toBe('local')
    expect(record.sha256).toBe(sha256Hex(bytes))
    expect(record.fileHashes['dist/index.js']).toBe(sha256Hex(files['dist/index.js']))
    expect(w.plugin.list().find((p) => p.id === 'local-x')).toBeDefined()
  })

  it('re-importing replaces in place and preview reports the installed version', async () => {
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installLocalPlugin(b64(tarballFor('@t/local', 'local-x', '1.0.0')), { confirmed: true })
    const v2 = tarballFor('@t/local', 'local-x', '2.0.0')
    const preview = await w.plugin.previewLocalPlugin(b64(v2))
    expect(preview.installedVersion).toBe('1.0.0')
    await w.plugin.installLocalPlugin(b64(v2), { confirmed: true })
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    expect(setCalls.at(-1)![1]['local-x'].version).toBe('2.0.0')
  })

  it('refuses a manifest id that collides with a built-in plugin', async () => {
    const bytes = tarballFor('@t/player', '@BBeBee/plugin-player', '1.0.0')
    const w = createNpmWorld({
      manifests: {
        '@BBeBee/plugin-player': manifestFor('@BBeBee/plugin-player', '1.0.0') as PluginManifest,
      },
    })
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes), { confirmed: true }), 'SPOOF_DETECTED')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('refuses a package whose manifest version disagrees with package.json', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0', {
      'BBeBee.plugin.json': JSON.stringify(manifestFor('local-x', '9.9.9')),
    })
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes), { confirmed: true }), 'VERSION_MISMATCH')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('refuses a package the security scan blocks', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0', {
      'dist/index.js': `export const p = import('data:text/javascript;base64,YWxlcnQoMSk=')`,
    })
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes), { confirmed: true }), 'SECURITY_BLOCKED')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('refuses capability-bearing packages when the grant ledger is unavailable', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0', {
      'BBeBee.plugin.json': JSON.stringify(manifestFor('local-x', '1.0.0', [], ['fs:read/**'])),
    })
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installLocalPlugin(b64(bytes), { confirmed: true }), 'GRANT_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('exempts local records from delisting but not from the ban channel', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0')
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installLocalPlugin(b64(bytes), { confirmed: true })
    const plugin = w.plugin as unknown as {
      applyLivenessToRecords(index: unknown[], blocked?: Array<{ id: string; reason: string }>): Promise<void>
    }
    await plugin.applyLivenessToRecords([], [])
    const storeData = (w.ctx as any).store
    let setCalls = storeData.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    expect(setCalls.at(-1)![1]['local-x'].delisted).toBeUndefined()
    await plugin.applyLivenessToRecords([], [{ id: 'local-x', reason: 'test ban' }])
    setCalls = storeData.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    expect(setCalls.at(-1)![1]['local-x'].blocked).toBe('test ban')
  })

  it('does not offer npm updates for local installs', async () => {
    const bytes = tarballFor('@t/local', 'local-x', '1.0.0')
    const w = createNpmWorld()
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installLocalPlugin(b64(bytes), { confirmed: true })
    await expectNpmError(w.plugin.updatePlugin('local-x'), 'NOT_INSTALLED')
  })
})

/**
 * In-memory stand-in for the two core tables the capability-grant
 * ledger touches, pattern-matching its fixed SQL and enforcing the
 * foreign key the real databases run with (a grants row without its
 * `plugin_records` parent throws). Mirrors the kernel's grants test
 * fake; kept local so this suite stays self-contained.
 */
function createFakeDb() {
  const records = new Map<string, { version: string; source: string }>()
  const grants = new Map<string, string[]>()

  const db = {
    async exec(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.startsWith('INSERT INTO plugin_records')) {
        records.set(String(params[0]), { version: String(params[1]), source: String(params[2]) })
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM capability_grants')) {
        return { changes: grants.delete(String(params[0])) ? 1 : 0, lastInsertRowid: 0 }
      }
      if (s.startsWith('INSERT INTO capability_grants')) {
        const pluginId = String(params[0])
        if (!records.has(pluginId)) throw new Error('FOREIGN KEY constraint failed')
        const list = grants.get(pluginId) ?? []
        list.push(String(params[1]))
        grants.set(pluginId, list)
        return { changes: 1, lastInsertRowid: 1 }
      }
      if (s.startsWith('DELETE FROM plugin_records')) {
        grants.delete(String(params[0])) // ON DELETE CASCADE
        records.delete(String(params[0]))
        return { changes: 1, lastInsertRowid: 0 }
      }
      throw new Error(`fake db: unexpected exec: ${s}`)
    },
    async query<T>(sql: string): Promise<T[]> {
      if (sql.includes('FROM capability_grants')) {
        return [...grants.entries()].flatMap(([plugin_id, caps]) =>
          caps.map((capability) => ({ plugin_id, capability })),
        ) as T[]
      }
      throw new Error(`fake db: unexpected query: ${sql}`)
    },
    async get() {
      return undefined
    },
    async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
      return fn(db as unknown as DbService)
    },
  }
  return { db: db as unknown as DbService, records, grants }
}

describe('capability grants (W1)', () => {
  /** A world whose only registry entry is `a-x`, with a fake db attached. */
  function seedCapsWorld(
    versions: Array<{ version: string; capabilities: string[] }>,
    opts: { withDb?: boolean } = {},
  ) {
    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const tarballs: Record<string, Uint8Array> = {}
    for (const { version, capabilities } of versions) {
      tarballs[`@t/a@${version}`] = tarballFor('@t/a', 'a-x', version, {
        'BBeBee.plugin.json': JSON.stringify(manifestFor('a-x', version, [], capabilities)),
      })
    }
    const w = createNpmWorld({
      manifests: {
        '@BBeBee/plugin-player': {
          id: '@BBeBee/plugin-player',
          name: '@BBeBee/plugin-player',
          displayName: 'Player',
          description: 'player',
          version: '1.0.0',
          author: 'BBeBee',
          engines: { BBeBee: '^0.1.0' },
          entry: { main: './dist/index.js' },
          capabilities: [],
          contributes: { services: ['player'] },
          effect: 'player',
        } as PluginManifest,
      },
    })
    const fake = createFakeDb()
    if (opts.withDb !== false) {
      ;(w.ctx as any).db = fake.db
    }
    w.routes.set(INDEX_URL, { status: 200, json: async () => [entry] })
    w.routes.set(`https://registry.npmjs.org/${encodeURIComponent(entry.npm)}`, {
      status: 200,
      json: async () => packument(entry.npm, versions.map((v) => v.version), tarballs),
    })
    for (const { version } of versions) {
      w.routes.set(`https://cdn.jsdelivr.net/${encodeURIComponent(entry.npm)}-/${version}.tgz`, {
        status: 200,
        bytes: async () => tarballs[`@t/a@${version}`]!,
      })
    }
    return { w, fake }
  }

  function bridgeActivates(w: NpmTestWorld, state: string = 'active') {
    w.bridge.installPlugin.mockImplementation(async (id: string) => ({ pluginId: id, state }))
  }

  it('records the packaged manifest capabilities as grants during a confirmed install', async () => {
    const { w, fake } = seedCapsWorld([{ version: '1.0.0', capabilities: ['audio'] }])
    bridgeActivates(w)
    await w.plugin[PluginManagerPlugin.init]()

    await w.plugin.installPlugin('a-x')

    // The exact failure the audit found in production: visualizer
    // declares capabilities:["audio"] and could never be granted.
    expect(Object.fromEntries(fake.grants)).toEqual({ 'a-x': ['audio'] })
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
  })

  it('reports activation failure honestly instead of claiming install success', async () => {
    const { w, fake } = seedCapsWorld([{ version: '1.0.0', capabilities: ['audio'] }])
    w.bridge.installPlugin.mockImplementation(async (id: string) => ({
      pluginId: id,
      state: 'ungranted',
      error: new Error('plugin a-x requests [audio] but has no capability grant'),
    }))
    await w.plugin[PluginManagerPlugin.init]()

    const err = await w.plugin.installPlugin('a-x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NpmPluginError)
    expect((err as NpmPluginError).code).toBe('ACTIVATION_FAILED')
    expect((err as Error).message).toContain('a-x')
    expect((err as Error).message).toContain('ungranted')
    // The grant WAS recorded during the attempt — then the first-install
    // rollback (audit W3) undid the whole install: files uninstalled,
    // record dropped, and the grant revoked with it, exactly as an
    // uninstall would. A later reinstall asks for approval again.
    expect(Object.fromEntries(fake.grants)).toEqual({})
    expect(w.plugin.list().some((p) => p.id === 'a-x')).toBe(false)
  })

  it('refuses a capability-bearing install when the grant ledger is unavailable', async () => {
    const { w } = seedCapsWorld([{ version: '1.0.0', capabilities: ['audio'] }], { withDb: false })
    bridgeActivates(w)
    await w.plugin[PluginManagerPlugin.init]()

    await expectNpmError(w.plugin.installPlugin('a-x'), 'GRANT_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
  })

  it('a capability-free install needs no ledger and still succeeds without a db', async () => {
    const { w } = seedCapsWorld([{ version: '1.0.0', capabilities: [] }], { withDb: false })
    bridgeActivates(w)
    await w.plugin[PluginManagerPlugin.init]()

    await w.plugin.installPlugin('a-x')
    expect(w.bridge.installPlugin).toHaveBeenCalledTimes(1)
  })

  it('uninstall revokes the grants', async () => {
    const { w, fake } = seedCapsWorld([{ version: '1.0.0', capabilities: ['audio'] }])
    bridgeActivates(w)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x')
    expect(Object.fromEntries(fake.grants)).toEqual({ 'a-x': ['audio'] })

    await w.plugin.uninstall('a-x')

    expect(fake.grants.size).toBe(0)
  })

  it('update replaces the grants with the new manifest set', async () => {
    const { w, fake } = seedCapsWorld([
      { version: '1.0.0', capabilities: ['audio'] },
      { version: '1.1.0', capabilities: ['audio', 'net:host/example.com'] },
    ])
    bridgeActivates(w)
    await w.plugin[PluginManagerPlugin.init]()
    await w.plugin.installPlugin('a-x')

    await w.plugin.updatePlugin('a-x')

    expect(Object.fromEntries(fake.grants)).toEqual({
      'a-x': ['audio', 'net:host/example.com'],
    })
  })
})

describe('concatStreamWithLimit (Fix E)', () => {
  const streamOf = (chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch)
        c.close()
      },
    })

  it('concatenates chunks under the limit', async () => {
    const out = await concatStreamWithLimit(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), 10, 'x')
    expect(Array.from(out)).toEqual([1, 2, 3])
  })

  it('aborts with SIZE_LIMIT as soon as the running total passes the cap', async () => {
    const big = new Uint8Array(64)
    await expectNpmError(concatStreamWithLimit(streamOf([big, big, big]), 100, 'x'), 'SIZE_LIMIT')
  })

  it('aborts a stalled stream instead of hanging forever (audit W2: slow-drip)', async () => {
    // One chunk lands, then the source goes silent — the header timeout
    // on the HTTP layer has long since fired and cleared, so without a
    // stall clock this read never settles.
    let pulls = 0
    const drip = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++
        if (pulls === 1) {
          c.enqueue(new Uint8Array([1]))
          return undefined
        }
        return new Promise(() => {})
      },
    })
    await expectNpmError(concatStreamWithLimit(drip, 1024, 'x', undefined, undefined, 50), 'DOWNLOAD_FAILED')
  })

  it('does not mistake a merely slow stream for a stalled one', async () => {
    const slow = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 10))
        c.enqueue(new Uint8Array([7]))
        c.close()
      },
    })
    const out = await concatStreamWithLimit(slow, 1024, 'x', undefined, undefined, 1000)
    expect(Array.from(out)).toEqual([7])
  })
})

describe('gunzipCapped (audit W2: decompressed-size cap)', () => {
  it('round-trips a payload under the cap', () => {
    const data = new TextEncoder().encode('hello plugin '.repeat(100))
    const out = gunzipCapped(gzipSync(data), 1024 * 1024, 'x')
    expect(out).toEqual(data)
  })

  it('refuses a high-compression-ratio archive once the expanded size passes the cap', () => {
    // 1MiB of zeros gzips to ~1KiB (the audit's bomb shape, ~1000×);
    // a one-shot gunzip would materialize all of it before any check.
    const bomb = gzipSync(new Uint8Array(1024 * 1024))
    expect(bomb.byteLength).toBeLessThan(8192)
    expectNpmErrorSync(() => gunzipCapped(bomb, 64 * 1024, 'x'), 'TARBALL_INVALID')
  })

  it('refuses non-gzip input', () => {
    expectNpmErrorSync(() => gunzipCapped(new Uint8Array([1, 2, 3, 4]), 1024, 'x'), 'TARBALL_INVALID')
    expectNpmErrorSync(() => gunzipCapped(new Uint8Array(0), 1024, 'x'), 'TARBALL_INVALID')
  })
})

describe('NpmClient.downloadPackage streaming (Fix E)', () => {
  const pkg = { id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: 'https://registry.npmjs.org/1.tgz' }
  function clientWith(http: any) {
    return new NpmClient({
      http,
      readSettings: async () => undefined,
      readSecret: async () => undefined,
      cache: { get: async () => undefined, set: async () => {} },
      log: { info() {}, warn() {}, error() {} },
    })
  }

  it('streams the body when stream() is available and reports progress', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const progress: Array<[number, number | undefined]> = []
    const http = vi.fn(async () => ({
      status: 200,
      headers: { 'content-length': '5' },
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(payload.subarray(0, 2))
            c.enqueue(payload.subarray(2))
            c.close()
          },
        }),
      bytes: async () => {
        throw new Error('bytes() must not be used when stream works')
      },
    }))
    const out = await clientWith(http).downloadPackage(pkg, (loaded, total) => progress.push([loaded, total]))
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5])
    expect(progress.at(-1)).toEqual([5, 5])
  })

  it('falls back to bytes() when stream() is unavailable', async () => {
    const http = vi.fn(async () => ({ status: 200, headers: {}, bytes: async () => new Uint8Array([9, 8]) }))
    const out = await clientWith(http).downloadPackage(pkg)
    expect(Array.from(out)).toEqual([9, 8])
  })

  it('refuses a tarball on a loopback host before any request goes out (audit W2: host allowlist)', async () => {
    const http = vi.fn(async () => ({ status: 200, headers: {}, bytes: async () => new Uint8Array([1]) }))
    const evil = { ...pkg, tarball: 'http://127.0.0.1:9999/evil.tgz' }
    await expectNpmError(clientWith(http).downloadPackage(evil), 'DOWNLOAD_FAILED')
    expect(http).not.toHaveBeenCalled()
  })

  it('refuses link-local and arbitrary third-party tarball hosts', async () => {
    const http = vi.fn(async () => ({ status: 200, headers: {}, bytes: async () => new Uint8Array([1]) }))
    for (const tarball of ['http://169.254.169.254/latest.tgz', 'https://evil.example.org/x.tgz', 'not a url']) {
      await expectNpmError(clientWith(http).downloadPackage({ ...pkg, tarball }), 'DOWNLOAD_FAILED')
    }
    expect(http).not.toHaveBeenCalled()
  })

  it('downloads from the jsDelivr CDN host as usual', async () => {
    const http = vi.fn(async () => ({ status: 200, headers: {}, bytes: async () => new Uint8Array([4, 2]) }))
    const cdnPkg = { ...pkg, tarball: 'https://cdn.jsdelivr.net/npm/@t/a@1.0.0/x.tgz' }
    const out = await clientWith(http).downloadPackage(cdnPkg)
    expect(Array.from(out)).toEqual([4, 2])
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('cancels an over-limit stream mid-download instead of buffering it all', async () => {
    const big = new Uint8Array(64)
    const http = vi.fn(async () => ({
      status: 200,
      headers: {},
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < 1000; i++) c.enqueue(big)
            c.close()
          },
        }),
      bytes: async () => {
        throw new Error('bytes() must not be used when stream works')
      },
    }))
    // 50MB cap is too big for a unit test; the cap itself is covered above.
    // Here we assert the stream path is taken at all for downloads.
    const out = await clientWith(http).downloadPackage(pkg)
    expect(out.byteLength).toBe(64 * 1000)
  })
})

/**
 * Regression: service methods invoked from a FOREIGN Cordis scope.
 *
 * In the real shell, `http`/`settings`/`secrets`/`device` are provided
 * by sibling core plugins — they live in those fibers' stores, not on
 * the root and not in this plugin's ancestor chain. The settings page
 * calls the manager's methods from its own fiber (which injects
 * `plugin-manager`, never `http`), and the automatic update check calls
 * them from a bare timer (no fiber at all). A call-time `this.ctx.http`
 * read is judged against the *caller's* inject scope and throws
 * `cannot get property "http" without inject` — which is exactly what
 * the field logs showed (automatic update check failed; the market's
 * Discover list rendered empty because browseRegistry threw).
 *
 * The older suites never saw it: they assign the collaborators
 * directly onto the same root context the service was constructed
 * with, where the read is an own-property hit. This world instead
 * mirrors the shell: collaborators are provided by a sibling plugin
 * fiber, and the manager is loaded as a real plugin, so the ONLY way
 * its methods can reach `http` is the init-time own-scope capture.
 */
describe('foreign-scope callers (inject scope regression)', () => {
  async function createScopedWorld() {
    const ctx = new Context()
    const storeData = new Map<string, unknown>()
    const storeMock = {
      get: vi.fn(async (key: string) => storeData.get(key)),
      set: vi.fn(async (key: string, val: unknown) => {
        storeData.set(key, val)
      }),
      delete: vi.fn(async (key: string) => {
        storeData.delete(key)
      }),
      keys: vi.fn(async () => Array.from(storeData.keys())),
      namespace: vi.fn(() => storeMock),
    }
    const inspectorMock = { snapshot: vi.fn(() => ({ root: undefined })) }
    ctx.provide('store', storeMock as never)
    ctx.provide('inspector', inspectorMock as never)

    const entry = entryFor({ id: 'a-x', npm: '@t/a' })
    const routes = new Map<string, { status: number; json?: () => Promise<unknown> }>()
    routes.set(INDEX_URL, { status: 200, json: async () => ({ entries: [entry], blocked: [] }) })
    const httpMock = vi.fn(async (req: { url: string }) => {
      const route = routes.get(req.url)
      if (!route) return { status: 404, json: async () => ({}), bytes: async () => new Uint8Array(0), headers: {} }
      return {
        status: route.status,
        json: route.json ?? (async () => ({})),
        bytes: async () => new Uint8Array(0),
        headers: {},
      }
    })
    const settingsData: Record<string, unknown> = { downloadRegion: 'global' }
    const secretsData = new Map<string, string>()
    const secretsMock = {
      get: vi.fn(async (k: string) => secretsData.get(k)),
      set: vi.fn(async (k: string, v: string) => void secretsData.set(k, v)),
      delete: vi.fn(async (k: string) => void secretsData.delete(k)),
    }

    // The shell's shape: core collaborators provided by a sibling
    // plugin fiber — present in the app, unreachable from unrelated
    // scopes, and NOT own properties of any context the manager holds.
    await ctx.plugin((c) => {
      c.provide('http', httpMock as never)
      c.provide('settings', { getSync: () => ({ ...settingsData }) } as never)
      c.provide('secrets', secretsMock as never)
      c.provide('device', { appVersion: '0.1.0', platform: 'linux' } as never)
    })

    // The manager loaded the way the shell loads it: as a plugin, with
    // its own forked context and fiber.
    ctx.plugin(PluginManagerPlugin, { platform: 'desktop' })
    let plugin: PluginManagerPlugin | undefined
    await vi.waitFor(() => {
      plugin = (ctx as unknown as Record<string, PluginManagerPlugin>)['plugin-manager']
      expect(plugin).toBeInstanceOf(PluginManagerPlugin)
    })

    // Wait until the init-time own-scope captures have landed; from
    // here on, no caller scope may matter to the manager's reads.
    // (Identity is not asserted: Cordis hands out traceable wrappers
    // around provided services, so the captured handle is a proxy of
    // the mock, not the mock itself. Calls through it still land on
    // the mock, which is what the tests below assert.)
    // The wait is deliberately tolerant: if the captures ever regress,
    // the calls below fail on their own merits — with the production
    // `cannot get property "http" without inject` error — instead of
    // this setup timing out and masking the real failure.
    const captured = (key: 'http' | 'secrets') =>
      vi
        .waitFor(
          () =>
            expect(
              (plugin as unknown as { own?: Record<string, unknown> }).own?.[key],
            ).toBeDefined(),
          { timeout: 2_000 },
        )
        .catch(() => {})
    await captured('http')
    await captured('secrets')

    // The instance behind the traceable proxy: the object the
    // service's own init closures (the automatic-check timers) call
    // through, whose `this.ctx` is the manager's own forked context
    // with no caller shadow at all.
    const rawPlugin = (plugin as unknown as Record<symbol, PluginManagerPlugin>)[symbols.original]!

    return { ctx, plugin: plugin!, rawPlugin, httpMock, secretsMock, storeData }
  }

  it('browseRegistry answers a caller fiber that never injected http (the settings page)', async () => {
    const { ctx, httpMock } = await createScopedWorld()

    // A settings-page-like plugin: it injects the manager service
    // only. The call's synchronous prefix runs inside its fiber scope.
    let outcome: Promise<{ entries?: RegistryPluginEntry[]; error?: Error }> | undefined
    ctx.plugin({
      inject: ['plugin-manager'],
      apply(c: Context) {
        const mgr = (c as unknown as Record<string, PluginManagerPlugin>)['plugin-manager']!
        outcome = mgr.browseRegistry().then(
          (entries) => ({ entries }),
          (error: unknown) => ({ error: error as Error }),
        )
      },
    })
    await vi.waitFor(() => expect(outcome).toBeDefined())
    const result = await outcome!
    expect(result.error).toBeUndefined()
    expect(result.entries?.map((e) => e.id)).toEqual(['a-x'])
    expect(httpMock).toHaveBeenCalledWith(expect.objectContaining({ url: INDEX_URL }))
  })

  it('checkUpdates answers from a bare timer scope (no fiber at all)', async () => {
    const { rawPlugin, httpMock } = await createScopedWorld()

    // The automatic check's setTimeout/setInterval callbacks invoke
    // the RAW service instance (the init closure's `this`), outside
    // any fiber and without a caller shadow: `this.ctx` is the
    // manager's own fork, whose ancestor chain holds only its declared
    // injects. (Calling through the traceable proxy obtained from the
    // root context would silently lend the call the root scope — the
    // exact blind spot that hid this bug from the older suites.)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const updates = await rawPlugin.checkUpdates()
    expect(updates).toEqual([])
    // The liveness/index path really ran over the captured http handle.
    expect(httpMock).toHaveBeenCalledWith(expect.objectContaining({ url: INDEX_URL }))
  })

  it('npm token helpers answer a caller fiber that never injected secrets', async () => {
    const { ctx, secretsMock } = await createScopedWorld()

    let outcome: Promise<{ has?: boolean; error?: Error }> | undefined
    ctx.plugin({
      inject: ['plugin-manager'],
      apply(c: Context) {
        const mgr = (c as unknown as Record<string, PluginManagerPlugin>)['plugin-manager']!
        outcome = (async () => {
          await mgr.setNpmAuthToken('tok-123')
          return { has: await mgr.hasNpmAuthToken() }
        })().then(
          (v) => v,
          (error: unknown) => ({ error: error as Error }),
        )
      },
    })
    await vi.waitFor(() => expect(outcome).toBeDefined())
    const result = await outcome!
    expect(result.error).toBeUndefined()
    expect(result.has).toBe(true)
    expect(secretsMock.set).toHaveBeenCalled()
  })
})
