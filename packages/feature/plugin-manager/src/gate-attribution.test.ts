import { describe, expect, it, vi } from 'vitest'
import { Context, Service, symbols } from 'cordis'
import { assertHost, capabilityConfigOf, scopeContext, type GrantOptions } from '@BBeBee/kernel'
import type { RegistryPluginEntry } from '@BBeBee/protocol'
import { PluginManagerPlugin } from './index.js'

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
 * (`@BBeBee/plugin-registry-ui-desktop`, capabilities `[]`) calling
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

const MANAGER_ID = '@BBeBee/plugin-manager'
const UI_ID = '@BBeBee/plugin-registry-ui-desktop'
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

async function createGatedWorld() {
  const ctx = new Context()
  const seen: SeenCall[] = []
  const routes = new Map<string, unknown>()
  routes.set(INDEX_URL, { entries: [entryFor({ id: 'a-x', npm: '@t/a' })], blocked: [] })

  // A faithful stand-in for core-http-node: a callable Service whose
  // request path runs the REAL kernel gate against the config Cordis
  // resolved for the calling context, then serves canned routes.
  class GatedHttp extends Service {
    constructor(c: Context) {
      super(c, 'http')
    }

    protected [Service.invoke](req: { url: string }) {
      return this.request(req)
    }

    async request(req: { url: string }) {
      const config = this[Service.resolveConfig]()
      assertHost(config, req.url)
      seen.push({ url: req.url, pluginId: capabilityConfigOf(config)?.pluginId })
      const body = routes.get(req.url)
      if (body === undefined) {
        return {
          status: 404,
          json: async () => ({}),
          bytes: async () => new Uint8Array(0),
          headers: {} as Record<string, string>,
        }
      }
      return {
        status: 200,
        json: async () => body,
        bytes: async () => new Uint8Array(0),
        headers: {} as Record<string, string>,
      }
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

  const settingsData: Record<string, unknown> = { downloadRegion: 'global' }
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
  // own scopeContext carrying its manifest's capabilities.
  const managerScoped = scopeContext(ctx, { pluginId: MANAGER_ID, requested: MANAGER_CAPS })
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

  return { ctx, plugin: plugin!, rawPlugin, seen }
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
