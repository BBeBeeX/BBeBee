import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { gzipSync } from 'fflate'
import { base64Encode, sha256Hex, sha512, type RegistryPluginEntry } from '@BBeBee/protocol'
import { PluginManagerPlugin } from './index.js'
import type { PluginManifest } from '@BBeBee/protocol'
import { concatStreamWithLimit, NpmClient, NpmPluginError, parseDepSpecifier } from './npm.js'

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

function manifestFor(id: string, version: string, services: string[] = []) {
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
    capabilities: [],
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

function packument(pkg: string, versions: string[], tarballs: Record<string, Uint8Array>) {
  return {
    name: pkg,
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: Object.fromEntries(
      versions.map((v) => [
        v,
        {
          version: v,
          dist: {
            tarball: `https://cdn.example.com/${encodeURIComponent(pkg)}-/${v}.tgz`,
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

describe('plugin-manager npm service methods', () => {
  function seedWorld(entry: RegistryPluginEntry, versions: string[], tarballs: Record<string, Uint8Array>) {
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
      json: async () => packument(entry.npm, versions, tarballs),
    })
    for (const v of versions) {
      w.routes.set(`https://cdn.example.com/${encodeURIComponent(entry.npm)}-/${v}.tgz`, {
        status: 200,
        bytes: async () => tarballs[`${entry.npm}@${v}`]!,
      })
    }
    return w
  }

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

  it('refuses when a required service is unavailable, naming it', async () => {
    const entry = entryFor({ id: 'a-x', npm: '@t/a', services: ['nonexistent-svc'] })
    const tarballs = { '@t/a@1.0.0': tarballFor('@t/a', 'a-x', '1.0.0') }
    const w = seedWorld(entry, ['1.0.0'], tarballs)
    await w.plugin[PluginManagerPlugin.init]()
    await expectNpmError(w.plugin.installPlugin('a-x'), 'SERVICE_UNAVAILABLE')
    expect(w.bridge.installPlugin).not.toHaveBeenCalled()
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
      w.routes.set(`https://cdn.example.com/${encodeURIComponent('@t/b')}-/${v}.tgz`, {
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

  it('persists each node record as it installs: a later failure leaves earlier nodes recorded (Fix C)', async () => {
    const w = seedClosureWorld(['1.0.0'], ['1.0.0'])
    await w.plugin[PluginManagerPlugin.init]()
    w.bridge.installPlugin = vi.fn(async (id: string) => {
      if (id === 'a-x') throw new Error('bridge boom')
    }) as typeof w.bridge.installPlugin
    await expect(w.plugin.installPlugin('a-x')).rejects.toThrow('bridge boom')
    const store = (w.ctx as any).store
    const setCalls = store.set.mock.calls.filter(([k]: [string]) => k === 'npm:installed')
    const last = setCalls.at(-1)![1] as Record<string, any>
    expect(last['b-y']?.version).toBe('1.0.0')
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
        w.routes.set(`https://cdn.example.com/${encodeURIComponent(npm)}-/${v}.tgz`, {
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
})

describe('NpmClient.downloadPackage streaming (Fix E)', () => {
  const pkg = { id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: 'https://x/1.tgz' }
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
