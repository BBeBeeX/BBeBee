import { describe, expect, it, vi } from 'vitest'
import { Context, Service, symbols } from 'cordis'
import {
  assertHost,
  capabilityConfigOf,
  scopeContext,
  withManagerPipelineGrants,
  type GrantOptions,
} from '@BBeBee/kernel'
import {
  derivePluginManagerDownloadHosts,
  PLUGIN_MANAGER_ID,
  type AppSettings,
  type HttpService,
  type ManagerNetworkSettings,
  type RegistryPluginEntry,
} from '@BBeBee/protocol'
import { PluginManagerPlugin } from './index.js'
import { NpmClient, tarballAllowedHosts } from './npm.js'

/**
 * Regression: capability-gate ATTRIBUTION of the plugin-manager's
 * internal http calls.
 *
 * In the real shell every plugin is loaded through the kernel loader,
 * which applies it under `scopeContext(ctx, { pluginId, requested:
 * manifest.capabilities })`. Mediated services read their gate config
 * from the intercept chain of the context the service handle was
 * OBTAINED through (`Service.resolveConfig`) — so an internal call is
 * judged against whoever's context produced the handle, not against
 * the plugin that owns the operation. The market UI
 * (`@bbebee/plugin-registry-ui-desktop`, capabilities `[]`) calling
 * into the manager made the manager's registry-index fetch be judged
 * as the UI package: `… may not reach cdn.jsdelivr.net /
 * raw.githubusercontent.com`, and every market install died at step
 * one (field logs, 2026-10-20). Harnesses never saw it: they drive the
 * service from the unmediated root context, where the gate passes
 * silently.
 *
 * This world mirrors the shell exactly: a REAL gated http service
 * (same `assertHost(this[Service.resolveConfig](), url)` line as
 * core-http-node) provided by a sibling fiber, the manager loaded
 * under its own `scopeContext` with its manifest's capabilities, and a
 * zero-capability initiator loaded under its own `scopeContext`.
 */

const MANAGER_ID = '@bbebee/plugin-manager'
const UI_ID = '@bbebee/plugin-registry-ui-desktop'
const INDEX_URL = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main/plugins/index.json'

/** The manager manifest's declared capabilities, mirrored. */
const MANAGER_CAPS: GrantOptions['requested'] = [
  'db:read:core',
  'db:write:core',
  'net:host/raw.githubusercontent.com',
  'net:host/cdn.jsdelivr.net',
  'net:host/fastly.jsdelivr.net',
  'net:host/registry.npmjs.org',
  'net:host/registry.npmmirror.com',
  'net:host/cdn.npmmirror.com',
]

interface SeenCall {
  url: string
  pluginId?: string
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

/** One canned route: a JSON/bytes body, or a redirect to another URL. */
interface Route {
  body?: unknown
  bytes?: Uint8Array
  redirectTo?: string
}

interface GatedWorldOptions {
  /** The world's live settings (the settings service serves a copy of this). */
  settings?: Record<string, unknown>
  /**
   * The grant entry the manager is loaded under. Defaults to the
   * shells' real composition — `withManagerPipelineGrants` over the
   * manifest mirror and the world's settings — so the world loads
   * the manager exactly as a boot would.
   */
  managerGranted?: readonly string[]
}

async function createGatedWorld(opts: GatedWorldOptions = {}) {
  const ctx = new Context()
  const seen: SeenCall[] = []
  const routes = new Map<string, Route>()
  routes.set(INDEX_URL, { body: { entries: [entryFor({ id: 'a-x', npm: '@t/a' })], blocked: [] } })

  // A faithful stand-in for core-http-node: a callable Service whose
  // request path runs the REAL kernel gate against the config Cordis
  // resolved for the calling context, then serves canned routes.
  // Redirects are followed the way the real service follows them:
  // the gate is re-asserted on EVERY hop before that hop's request
  // goes out, and every attempted hop is recorded (including the one
  // the gate refuses).
  class GatedHttp extends Service {
    constructor(c: Context) {
      super(c, 'http')
    }

    protected [Service.invoke](req: { url: string }) {
      return this.request(req)
    }

    async request(req: { url: string }) {
      const config = this[Service.resolveConfig]()
      const pluginId = capabilityConfigOf(config)?.pluginId
      let url = req.url
      for (let hop = 0; hop <= 5; hop++) {
        seen.push({ url, pluginId })
        assertHost(config, url)
        const route = routes.get(url)
        if (route?.redirectTo) {
          url = route.redirectTo
          continue
        }
        if (route === undefined) {
          return {
            status: 404,
            json: async () => ({}),
            bytes: async () => new Uint8Array(0),
            headers: {} as Record<string, string>,
          }
        }
        const body = route.body
        const bytes = route.bytes ?? new Uint8Array(0)
        return {
          status: 200,
          json: async () => body,
          bytes: async () => bytes,
          headers: {} as Record<string, string>,
        }
      }
      throw new Error('gated http stand-in: redirect loop')
    }
  }

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

  const settingsData: Record<string, unknown> = opts.settings ?? { downloadRegion: 'global' }
  const secretsData = new Map<string, string>()
  const secretsMock = {
    get: vi.fn(async (k: string) => secretsData.get(k)),
    set: vi.fn(async (k: string, v: string) => void secretsData.set(k, v)),
    delete: vi.fn(async (k: string) => void secretsData.delete(k)),
  }

  // Collaborators from a sibling fiber, exactly like the shell: the
  // gated http service plus the plain settings/secrets/device handles
  // the manager captures at init.
  await ctx.plugin((c) => {
    c.provide('settings', { getSync: () => ({ ...settingsData }) } as never)
    c.provide('secrets', secretsMock as never)
    c.provide('device', { appVersion: '0.1.0', platform: 'linux' } as never)
  })
  await ctx.plugin(GatedHttp as never, undefined as never)

  // The manager, loaded the way the kernel loader loads it: under its
  // own scopeContext. When the shells' resolver returns an entry for
  // it (it always does now), that entry REPLACES the manifest's
  // requested set in scopeContext — so the world passes the composed
  // entry as `granted`, exactly as the loader does.
  const managerGranted =
    opts.managerGranted ??
    withManagerPipelineGrants({}, MANAGER_CAPS, settingsData as ManagerNetworkSettings)[MANAGER_ID]
  const managerScoped = scopeContext(ctx, {
    pluginId: MANAGER_ID,
    requested: MANAGER_CAPS,
    granted: managerGranted,
  })
  managerScoped.plugin(PluginManagerPlugin, { platform: 'desktop' })
  let plugin: PluginManagerPlugin | undefined
  await vi.waitFor(() => {
    plugin = (ctx as unknown as Record<string, PluginManagerPlugin>)['plugin-manager']
    expect(plugin).toBeInstanceOf(PluginManagerPlugin)
  })
  const rawPlugin = (plugin as unknown as Record<symbol, PluginManagerPlugin>)[symbols.original]!
  // Let the init-time own-scope captures land (tolerantly — a capture
  // regression must fail the assertions below, not this setup).
  await vi
    .waitFor(
      () =>
        expect(
          (rawPlugin as unknown as { own?: { http?: unknown } }).own?.http,
        ).toBeDefined(),
      { timeout: 2_000 },
    )
    .catch(() => {})

  /** The manager's own captured http handle (its gate identity rides on it). */
  const managerHttp = (): HttpService => {
    const http = (rawPlugin as unknown as { own?: { http?: HttpService } }).own?.http
    expect(http, 'manager must have captured its own http handle at init').toBeDefined()
    return http!
  }

  /** An NpmClient riding the manager's own http, reading the world's settings live. */
  const npmClient = (): NpmClient =>
    new NpmClient({
      http: managerHttp(),
      readSettings: async () => ({ ...settingsData }) as unknown as AppSettings,
      readSecret: async () => undefined,
      cache: { get: async () => undefined, set: async () => {} },
      log: { info() {}, warn() {}, error() {} },
    })

  return { ctx, plugin: plugin!, rawPlugin, seen, routes, settingsData, managerHttp, npmClient }
}

describe('capability-gate attribution (foreign initiator)', () => {
  it('(a) a zero-capability UI initiator can drive the manager index fetch, attributed to the manager', async () => {
    const { ctx, seen } = await createGatedWorld()

    let outcome: Promise<{ entries?: RegistryPluginEntry[]; error?: Error }> | undefined
    const uiScoped = scopeContext(ctx, { pluginId: UI_ID, requested: [] })
    uiScoped.plugin({
      inject: ['plugin-manager'],
      apply(c: Context) {
        const mgr = (c as unknown as Record<string, PluginManagerPlugin>)['plugin-manager']!
        outcome = mgr.browseRegistry(true).then(
          (entries) => ({ entries }),
          (error: unknown) => ({ error: error as Error }),
        )
      },
    })
    await vi.waitFor(() => expect(outcome).toBeDefined())
    const result = await outcome!
    expect(result.error).toBeUndefined()
    expect(result.entries?.map((e) => e.id)).toEqual(['a-x'])

    // Every gated call the flow made was judged as the plugin-manager,
    // never as the zero-capability initiator.
    const indexCalls = seen.filter((s) => s.url === INDEX_URL)
    expect(indexCalls.length).toBeGreaterThan(0)
    for (const call of seen) {
      expect(call.pluginId).toBe(MANAGER_ID)
    }
  })

  it('(b) the same zero-capability initiator calling http directly is still refused', async () => {
    const { ctx } = await createGatedWorld()

    let outcome: Promise<{ error?: Error }> | undefined
    const uiScoped = scopeContext(ctx, { pluginId: UI_ID, requested: [] })
    uiScoped.plugin({
      inject: ['http'],
      apply(c: Context) {
        const http = (c as unknown as Record<string, (req: { url: string }) => Promise<unknown>>)['http']!
        outcome = http({ url: 'https://example.com/anything' }).then(
          () => ({}),
          (error: unknown) => ({ error: error as Error }),
        )
      },
    })
    await vi.waitFor(() => expect(outcome).toBeDefined())
    const result = await outcome!
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('may not reach example.com')
    expect(result.error?.message).toContain(UI_ID)
  })
})

describe('settings-derived pipeline hosts (the dynamic allowlist)', () => {
  const VISUALIZER_TARBALL_MIRROR =
    'https://registry.npmmirror.com/@bbebee/plugin-visualizer/-/plugin-visualizer-0.1.1.tgz'
  const VISUALIZER_TARBALL_CDN =
    'https://cdn.npmmirror.com/packages/%40bbebee/plugin-visualizer/0.1.1/plugin-visualizer-0.1.1.tgz'
  const visualizerPkg = {
    id: '@bbebee/plugin-visualizer',
    npm: '@bbebee/plugin-visualizer',
    version: '0.1.1',
    tarball: VISUALIZER_TARBALL_MIRROR,
  }

  it('(a) mainland defaults: the npmmirror → cdn.npmmirror.com redirect chain downloads under the manager identity', async () => {
    const world = await createGatedWorld({ settings: { downloadRegion: 'mainland-china' } })
    world.routes.set(VISUALIZER_TARBALL_MIRROR, { redirectTo: VISUALIZER_TARBALL_CDN })
    world.routes.set(VISUALIZER_TARBALL_CDN, { bytes: new Uint8Array([7, 7, 7]) })

    const out = await world.npmClient().downloadPackage(visualizerPkg)
    expect(Array.from(out)).toEqual([7, 7, 7])

    const hops = world.seen.filter((s) => s.url.includes('npmmirror'))
    expect(hops.map((h) => h.url)).toEqual([VISUALIZER_TARBALL_MIRROR, VISUALIZER_TARBALL_CDN])
    for (const hop of hops) expect(hop.pluginId).toBe(MANAGER_ID)
  })

  it('(a-control) under the pre-derivation static grant set, the same chain dies with the exact field error', async () => {
    // The grant set as it stood before the dynamic derivation: the
    // manifest's static hosts of the time, no derived companions —
    // cdn.npmmirror.com was in neither list, which is precisely the
    // mainland install failure from the field (2026-10-20).
    const legacyGranted = [
      'db:read:core',
      'db:write:core',
      'net:host/raw.githubusercontent.com',
      'net:host/cdn.jsdelivr.net',
      'net:host/fastly.jsdelivr.net',
      'net:host/registry.npmjs.org',
      'net:host/registry.npmmirror.com',
    ]
    const world = await createGatedWorld({
      settings: { downloadRegion: 'mainland-china' },
      managerGranted: legacyGranted,
    })
    world.routes.set(VISUALIZER_TARBALL_MIRROR, { redirectTo: VISUALIZER_TARBALL_CDN })
    world.routes.set(VISUALIZER_TARBALL_CDN, { bytes: new Uint8Array([7, 7, 7]) })

    const err = await world
      .npmClient()
      .downloadPackage(visualizerPkg)
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      )
    expect(err).toBeDefined()
    expect(err?.message).toContain(`${MANAGER_ID} may not reach cdn.npmmirror.com`)
  })

  it('(b) a user-configured registry host is granted to the manager; unconfigured hosts stay refused', async () => {
    const world = await createGatedWorld({
      settings: { downloadRegion: 'global', npmRegistryUrl: 'https://npm.example.corp' },
    })
    const corpTarball = 'https://npm.example.corp/@t/a/-/a-1.0.0.tgz'
    world.routes.set(corpTarball, { bytes: new Uint8Array([1, 2]) })

    const out = await world
      .npmClient()
      .downloadPackage({ id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: corpTarball })
    expect(Array.from(out)).toEqual([1, 2])

    // The derivation is a closed list, not a widening: a host nobody
    // configured is still refused, under the manager's own name.
    const err = await world.managerHttp()({ url: 'https://unconfigured.example/x' }).then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(err?.message).toContain(`${MANAGER_ID} may not reach unconfigured.example`)
  })

  it('(b-stale) a manager loaded BEFORE the custom registry was configured is still refused it — grants bake at load', async () => {
    // Pins the landed freshness semantics. The world's live settings
    // already carry the custom registry (the manager's endpoint
    // selection and tarball pre-check read settings live and follow
    // at once), but its grant entry was composed from the settings of
    // load time — without the custom host. Only the gate's copy lags,
    // until the manager's next load: `createShellGrantResolver`
    // re-derives at every resolution, so that load picks the host up
    // (the (b) world, where the same settings were present at load).
    const staleGranted = withManagerPipelineGrants({}, MANAGER_CAPS, { downloadRegion: 'global' })[
      MANAGER_ID
    ]
    const world = await createGatedWorld({
      settings: { downloadRegion: 'global', npmRegistryUrl: 'https://npm.example.corp' },
      managerGranted: staleGranted,
    })
    const corpTarball = 'https://npm.example.corp/@t/a/-/a-1.0.0.tgz'
    world.routes.set(corpTarball, { bytes: new Uint8Array([1, 2]) })

    const err = await world
      .npmClient()
      .downloadPackage({ id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: corpTarball })
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      )
    expect(err?.message).toContain(`${MANAGER_ID} may not reach npm.example.corp`)
  })

  it('(c) a redirect OFF the derived set is refused mid-chain, even from an allowed start host', async () => {
    const world = await createGatedWorld({ settings: { downloadRegion: 'mainland-china' } })
    const start = 'https://registry.npmjs.org/@t/a/-/a-1.0.0.tgz'
    world.routes.set(start, { redirectTo: 'https://evil.example/x.tgz' })
    world.routes.set('https://evil.example/x.tgz', { bytes: new Uint8Array([6]) })

    const err = await world
      .npmClient()
      .downloadPackage({ id: 'a-x', npm: '@t/a', version: '1.0.0', tarball: start })
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      )
    expect(err?.message).toContain(`${MANAGER_ID} may not reach evil.example`)
    // The evil hop was attempted and refused at the gate: a redirect
    // target (remote data) never widens the derived set.
    expect(world.seen.map((s) => s.url)).toContain('https://evil.example/x.tgz')
  })

  it('(d) the tarball pre-check and the gate grants are one and the same derivation', () => {
    const matrix: Array<ManagerNetworkSettings | undefined> = [
      undefined,
      {},
      { downloadRegion: 'global' },
      { downloadRegion: 'mainland-china' },
      { npmRegistryUrl: 'https://npm.example.corp' },
      { githubRawBaseUrl: 'https://ghproxy.example.com/https://raw.githubusercontent.com/x/y/main' },
      { downloadRegion: 'mainland-china', npmRegistryUrl: 'https://npm.example.corp:8443' },
    ]
    for (const settings of matrix) {
      const derived = derivePluginManagerDownloadHosts(settings)
      expect([...tarballAllowedHosts(settings)].sort()).toEqual(derived)
      const grants = withManagerPipelineGrants({}, [], settings)[PLUGIN_MANAGER_ID]!
      expect([...grants].sort()).toEqual(derived.map((h) => `net:host/${h}`).sort())
    }
  })
})
