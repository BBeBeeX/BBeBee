import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { PluginManifest } from '@BBeBee/protocol'
import { BootstrapError, createApp } from './app.js'
import { diffSnapshots, snapshotContext, tick } from '../testing.js'

function manifest(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    version: '1.0.0',
    displayName: id,
    engines: { BBeBee: '^1.0.0' },
    entry: { main: './index.js' },
    capabilities: [],
    ...over,
  }
}

/** A registry entry for a first-party bundled plugin. */
function bundled(id: string, plugin: unknown, over: Partial<PluginManifest> = {}) {
  return { plugin: plugin as never, manifest: manifest(id, over), builtin: true }
}

describe('createApp', () => {
  it('brings up core services before feature plugins', async () => {
    // docs/02 §3: a feature plugin whose inject names a missing service sits
    // in PENDING forever, so bootstrap is awaited rather than fired off.
    const order: string[] = []

    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx: Context) => {
          order.push('core')
          ctx.provide('fakeFs', { ok: true })
        },
      ],
      registry: {
        feature: bundled('feature', {
          inject: ['fakeFs'],
          apply: () => void order.push('feature'),
        }),
      },
      config: { plugins: { feature: {} } },
    })

    await app.start()
    await tick()
    expect(order).toEqual(['core', 'feature'])
    await app.stop()
  })

  it('reports a configured plugin that is missing from the registry', async () => {
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {},
      config: { plugins: { ghost: {} } },
    })
    await app.start()
    expect(app.plugins).toEqual([
      expect.objectContaining({ pluginId: 'ghost', state: 'missing' }),
    ])
    await app.stop()
  })

  it('contains a failing plugin without stopping the app', async () => {
    // One bad third-party plugin must never become an unrecoverable boot.
    const healthy = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        bad: bundled('bad', () => {
          throw new Error('boom')
        }),
        good: bundled('good', healthy),
      },
      config: { plugins: { bad: {}, good: {} } },
    })

    await app.start()
    await tick()

    expect(app.plugins.find((p) => p.pluginId === 'bad')?.state).toBe('failed')
    expect(app.plugins.find((p) => p.pluginId === 'good')?.state).toBe('active')
    expect(healthy).toHaveBeenCalledTimes(1)
    await app.stop()
  })

  it('skips a quarantined plugin', async () => {
    // docs/03 §6.2: two consecutive failures and it is skipped until the user
    // re-enables it.
    const applied = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: { flaky: bundled('flaky', applied) },
      config: { plugins: { flaky: {} } },
      load: { failCounts: { flaky: 2 }, quarantineAfter: 2 },
    })

    await app.start()
    expect(app.plugins[0]?.state).toBe('quarantined')
    expect(applied).not.toHaveBeenCalled()
    await app.stop()
  })

  it('passes the configured config through to the plugin, untouched', async () => {
    // The loader used to splice an `instanceId` into every plugin's config.
    // Nothing needs one now: a plugin is activated once, and the only
    // multi-instance thing in the system — a music source — is a row in
    // `sources` that the runtime loads itself (docs/03 §6.4).
    const seen: unknown[] = []
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        src: bundled('src', (_ctx: Context, config: unknown) => void seen.push(config)),
      },
      config: { plugins: { src: { config: { baseUrl: 'https://home' } } } },
    })

    await app.start()
    await tick()
    expect(seen).toEqual([{ baseUrl: 'https://home' }])
    await app.stop()
  })

  it('ready() resolves only once the named service exists', async () => {
    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx: Context) => {
          setTimeout(() => ctx.provide('ui', { mounted: true }), 5)
        },
      ],
    })
    await app.start()

    const scoped = await app.ready(['ui'])
    expect((scoped as never as { ui: { mounted: boolean } }).ui.mounted).toBe(true)
    await app.stop()
  })

  it('refuses a second start', async () => {
    const app = createApp({ target: 'desktop', bootstrap: [] })
    await app.start()
    await expect(app.start()).rejects.toThrow(/already started/)
    await app.stop()
  })

  it('reports a plugin still waiting on a service as pending, not active', async () => {
    // `await ctx.plugin()` resolves as soon as the fiber settles — which
    // includes settling into PENDING. Reporting that as `active` makes the
    // inspector claim a plugin is healthy when it has never run, and points
    // debugging in exactly the wrong direction.
    const applied = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        waiting: bundled('waiting', { inject: ['neverArrives'], apply: applied }),
      },
      config: { plugins: { waiting: {} } },
    })

    await app.start()
    await tick()

    const record = app.plugins[0]!
    expect(record.state).toBe('pending')
    expect(record.waitingFor).toEqual(['neverArrives'])
    expect(applied).not.toHaveBeenCalled()
    await app.stop()
  })

  it('returns a copy of the plugin list', async () => {
    // stop() clears the internal array; an external holder must not see it.
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: { p: bundled('p', () => {}) },
      config: { plugins: { p: {} } },
    })
    await app.start()
    const held = app.plugins
    expect(held).toHaveLength(1)
    await app.stop()
    expect(held, 'caller observed internal mutation').toHaveLength(1)
  })
})

describe('bootstrap failure', () => {
  it('unwinds started core services and allows a retry', async () => {
    // A failing core service IS fatal — nothing works without fs. But it must
    // fail cleanly rather than leaving `started` latched with a half-built
    // context that stop() cannot clean up.
    const firstDown = vi.fn()
    let failNext = true

    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx: Context) => {
          ctx.provide('first', { ok: true })
          return firstDown
        },
        () => {
          if (failNext) throw new Error('core boom')
        },
      ],
    })

    await expect(app.start()).rejects.toThrow(BootstrapError)
    // The core service that did start was rolled back.
    expect(firstDown).toHaveBeenCalledTimes(1)

    // `started` was reset, so the shell can retry after fixing the cause.
    failNext = false
    await expect(app.start()).resolves.toBeUndefined()
    await app.stop()
  })

  it('names the failing core service', async () => {
    const app = createApp({
      target: 'desktop',
      bootstrap: [
        () => {},
        () => {
          throw new Error('boom')
        },
      ],
    })
    await expect(app.start()).rejects.toThrow(/bootstrap entry #1/)
  })
})

describe('capability grants', () => {
  it('refuses an ungranted third-party plugin rather than trusting its manifest', async () => {
    // Fail closed: a host that forgets to pass grants must not hand a
    // third-party plugin everything it declared for itself.
    const applied = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        thirdParty: {
          plugin: applied,
          manifest: manifest('thirdParty', { capabilities: ['net:host/*'] }),
          // builtin omitted → not first-party
        },
      },
      config: { plugins: { thirdParty: {} } },
    })

    await app.start()
    expect(app.plugins[0]?.state).toBe('ungranted')
    expect(applied).not.toHaveBeenCalled()
    await app.stop()
  })

  it('loads a third-party plugin once granted', async () => {
    const applied = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        thirdParty: {
          plugin: applied,
          manifest: manifest('thirdParty', { capabilities: ['net:host/*.example.org'] }),
        },
      },
      config: { plugins: { thirdParty: {} } },
      load: { grants: { thirdParty: ['net:host/*.example.org'] } },
    })

    await app.start()
    await tick()
    expect(app.plugins[0]?.state).toBe('active')
    await app.stop()
  })

  it('trusts a bundled plugin manifest without an explicit grant', async () => {
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: { core: bundled('core', () => {}, { capabilities: ['fs:read:all'] }) },
      config: { plugins: { core: {} } },
    })
    await app.start()
    await tick()
    expect(app.plugins[0]?.state).toBe('active')
    await app.stop()
  })
})

describe('quarantine', () => {
  it('skips a repeatedly failing plugin without touching the others', async () => {
    // A single bad plugin must not become an unrecoverable boot loop, and
    // quarantining it must not take the rest of the graph with it.
    const broken = vi.fn()
    const healthy = vi.fn()
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: { broken: bundled('broken', broken), healthy: bundled('healthy', healthy) },
      config: { plugins: { broken: {}, healthy: {} } },
      load: { failCounts: { broken: 2 }, quarantineAfter: 2 },
    })

    await app.start()
    await tick()

    const byId = Object.fromEntries(app.plugins.map((p) => [p.pluginId, p.state]))
    expect(byId).toEqual({ broken: 'quarantined', healthy: 'active' })
    expect(broken).not.toHaveBeenCalled()
    expect(healthy).toHaveBeenCalledTimes(1)
    await app.stop()
  })
})

describe('stop() unloads everything', () => {
  it('leaves no listeners, services, or effects behind', async () => {
    // The claim from docs/09 §6, applied to a whole app: this is the test that
    // every plugin in the workspace will eventually be run through.
    const ctx = new Context()
    const before = snapshotContext(ctx)

    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        noisy: bundled('noisy', (c: Context) => {
            c.provide('noisy', { v: 1 })
            return c.effect(function* () {
              yield c.on('player/state-changed', () => {})
              const timer = setInterval(() => {}, 1000)
              yield () => clearInterval(timer)
            }, 'noisy-effects')
        }),
      },
      config: { plugins: { noisy: {} } },
    })

    // Reuse the app's own context for the comparison.
    const appCtxBefore = snapshotContext(app.ctx)
    await app.start()
    await tick()
    await app.stop()
    await tick()

    const problems = diffSnapshots(appCtxBefore, snapshotContext(app.ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
    void before
  })

  it('keeps tearing down after a disposer throws', async () => {
    // One badly-behaved plugin used to abort the whole shutdown, leaking every
    // listener, timer, and handle registered after it — surfacing as random
    // crashes at process exit.
    const order: string[] = []
    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx: Context) => {
          ctx.provide('coreThing', { ok: true })
          return () => void order.push('core-down')
        },
      ],
      registry: {
        first: bundled('first', () => () => void order.push('first-down')),
        exploding: bundled('exploding', () => () => {
          order.push('exploding-attempted')
          throw new Error('disposer boom')
        }),
        last: bundled('last', () => () => void order.push('last-down')),
      },
      config: { plugins: { first: {}, exploding: {}, last: {} } },
    })

    await app.start()
    await tick()
    await expect(app.stop()).resolves.toBeUndefined()
    await tick()

    expect(order).toEqual(['last-down', 'exploding-attempted', 'first-down', 'core-down'])
  })

  it('disposes feature plugins before the core services they use', async () => {
    const order: string[] = []
    const app = createApp({
      target: 'desktop',
      bootstrap: [
        (ctx: Context) => {
          ctx.provide('coreThing', { ok: true })
          return () => void order.push('core-down')
        },
      ],
      registry: {
        feature: bundled('feature', {
          inject: ['coreThing'],
          apply: () => () => void order.push('feature-down'),
        }),
      },
      config: { plugins: { feature: {} } },
    })

    await app.start()
    await tick()
    await app.stop()
    await tick()

    expect(order).toEqual(['feature-down', 'core-down'])
  })

  it('dynamically registers and loads a plugin at runtime', async () => {
    const executed: string[] = []
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {},
      config: { plugins: {} },
    })

    await app.start()
    await tick()

    expect(app.plugins).toHaveLength(0)

    // Register dynamically
    app.registerPlugin(
      'dynamic-1',
      bundled('dynamic-1', {
        apply: () => {
          executed.push('started')
          return () => {
            executed.push('stopped')
          }
        },
      }),
    )

    const loaded = await app.loadPlugin('dynamic-1')
    expect(loaded.state).toBe('active')
    expect(executed).toEqual(['started'])
    expect(app.plugins.find((p) => p.pluginId === 'dynamic-1')?.state).toBe('active')

    // Calling loadPlugin again on active plugin returns the same record
    const reloaded = await app.loadPlugin('dynamic-1')
    expect(reloaded).toBe(loaded)

    // Unload dynamically
    await app.unloadPlugin('dynamic-1')
    expect(executed).toEqual(['started', 'stopped'])
    expect(app.plugins.find((p) => p.pluginId === 'dynamic-1')).toBeUndefined()

    await app.stop()
  })

  it('gating ungranted capabilities on dynamic third-party plugins', async () => {
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {},
      config: { plugins: {} },
    })

    await app.start()

    // Register a non-builtin third-party plugin that requests capabilities without user grant
    app.registerPlugin('third-party', {
      manifest: manifest('third-party', { capabilities: ['db:read:core'] }),
      builtin: false,
      plugin: {
        apply: () => {},
      },
    })

    const loaded = await app.loadPlugin('third-party')
    expect(loaded.state).toBe('ungranted')
    expect(loaded.error?.message).toContain('has no capability grant')

    await app.stop()
  })
})

