import { describe, expect, it, vi } from 'vitest'
import { Context, Service, symbols } from 'cordis'
import { assertHost, capabilityConfigOf, scopeContext } from '@BBeBee/kernel'
import type { RegistryIndex } from '@BBeBee/protocol'
import { RegistryPlugin } from './index.js'

/**
 * Regression: capability-gate ATTRIBUTION of the registry service's
 * internal http/store use.
 *
 * Same family as the plugin-manager gate-attribution tests (see that
 * package): mediated service handles are Cordis traceable proxies
 * bound to the context they were obtained through, and a handle held
 * in a direct field of the service is re-wrapped against the
 * ACCESSING context whenever a method is invoked through the
 * service's own proxy — so this service's index fetch, made with its
 * constructor-captured `ctx.http`, was judged against the invoking
 * market UI package's empty grants instead of this service's
 * `net:host/*`, and its store reads/writes landed in the caller's
 * namespace. The service now keeps its internal collaborators in a
 * plain holder object (`own`), which no proxy re-traces.
 *
 * This world mirrors the shell: a REAL gated http service (same
 * `assertHost(this[Service.resolveConfig](), url)` line as
 * core-http-node) and a namespace-recording store, both provided by
 * sibling fibers; the registry loaded under its own `scopeContext`
 * with its manifest's capabilities; a zero-capability initiator
 * loaded under its own.
 */

const REGISTRY_ID = '@BBeBee/plugin-registry'
const UI_ID = '@BBeBee/plugin-registry-ui-desktop'
const ENDPOINT = 'https://cdn.jsdelivr.net/gh/test/registry@main/index.json'

interface SeenCall {
  kind: 'http' | 'store'
  detail: string
  pluginId?: string
}

async function createGatedWorld() {
  const ctx = new Context()
  const seen: SeenCall[] = []
  const storeData = new Map<string, unknown>()
  storeData.set('registry.prefs', { endpoint: ENDPOINT })

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
      seen.push({ kind: 'http', detail: req.url, pluginId: capabilityConfigOf(config)?.pluginId })
      if (req.url === ENDPOINT) {
        return {
          status: 200,
          json: async () => ({ entries: [{ id: 's-1', kind: 'music-source', name: 'S1' }] }),
          text: async () => '',
          bytes: async () => new Uint8Array(0),
          headers: {} as Record<string, string>,
        }
      }
      return {
        status: 404,
        json: async () => ({}),
        text: async () => '',
        bytes: async () => new Uint8Array(0),
        headers: {} as Record<string, string>,
      }
    }

    async get<T>(url: string): Promise<T> {
      const res = await this.request({ url })
      return res.json() as Promise<T>
    }
  }

  class RecordingStore extends Service {
    constructor(c: Context) {
      super(c, 'store')
    }

    private scope(): string | undefined {
      return capabilityConfigOf(this[Service.resolveConfig]())?.scopeId
    }

    async get(key: string) {
      seen.push({ kind: 'store', detail: `get:${key}`, pluginId: this.scope() })
      return storeData.get(key)
    }

    async set(key: string, value: unknown) {
      seen.push({ kind: 'store', detail: `set:${key}`, pluginId: this.scope() })
      storeData.set(key, value)
    }

    async delete(key: string) {
      seen.push({ kind: 'store', detail: `delete:${key}`, pluginId: this.scope() })
      storeData.delete(key)
    }

    async keys() {
      return Array.from(storeData.keys())
    }

    namespace() {
      return this
    }
  }

  await ctx.plugin(GatedHttp as never, undefined as never)
  await ctx.plugin(RecordingStore as never, undefined as never)
  // A settings sibling so the registry's init-time settings capture
  // lands and its auto-check setup stays inert.
  await ctx.plugin((c) => {
    c.provide('settings', {
      getSync: () => ({ registryAutoCheck: false }),
      get: async () => ({ registryAutoCheck: false }),
    } as never)
  })

  // The registry, loaded the way the kernel loader loads it: under
  // its own scopeContext carrying its manifest's capabilities.
  const registryScoped = scopeContext(ctx, { pluginId: REGISTRY_ID, requested: ['net:host/*'] })
  registryScoped.plugin(RegistryPlugin, {})
  let plugin: RegistryPlugin | undefined
  await vi.waitFor(() => {
    plugin = (ctx as unknown as Record<string, RegistryPlugin>)['contentRegistry']
    expect(plugin).toBeInstanceOf(RegistryPlugin)
  })
  const rawPlugin = (plugin as unknown as Record<symbol, RegistryPlugin>)[symbols.original]!
  // Let the init-time store capture land (tolerantly).
  await vi
    .waitFor(
      () =>
        expect((rawPlugin as unknown as { own?: { store?: unknown } }).own?.store).toBeDefined(),
      { timeout: 2_000 },
    )
    .catch(() => {})

  return { ctx, plugin: plugin!, seen, storeData }
}

describe('capability-gate attribution (registry, foreign initiator)', () => {
  it('a zero-capability UI initiator can drive getIndex, attributed to the registry', async () => {
    const { ctx, seen } = await createGatedWorld()

    let outcome: Promise<{ index?: RegistryIndex; error?: Error }> | undefined
    const uiScoped = scopeContext(ctx, { pluginId: UI_ID, requested: [] })
    uiScoped.plugin({
      inject: ['contentRegistry'],
      apply(c: Context) {
        const reg = (c as unknown as Record<string, RegistryPlugin>)['contentRegistry']!
        outcome = reg.getIndex().then(
          (index) => ({ index }),
          (error: unknown) => ({ error: error as Error }),
        )
      },
    })
    await vi.waitFor(() => expect(outcome).toBeDefined())
    const result = await outcome!
    expect(result.error).toBeUndefined()
    expect(result.index?.entries.map((e) => e.id)).toEqual(['s-1'])

    // The direct index fetch ran, judged as the registry…
    const httpCalls = seen.filter((s) => s.kind === 'http')
    expect(httpCalls.length).toBeGreaterThan(0)
    for (const call of httpCalls) {
      expect(call.pluginId).toBe(REGISTRY_ID)
    }
    // …and every store touch (prefs read, cache write) carried the
    // registry's namespace, never the initiator's.
    const storeCalls = seen.filter((s) => s.kind === 'store')
    expect(storeCalls.length).toBeGreaterThan(0)
    for (const call of storeCalls) {
      expect(call.pluginId).toBe(REGISTRY_ID)
    }
  })
})
