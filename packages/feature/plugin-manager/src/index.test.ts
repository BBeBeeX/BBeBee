import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { PluginManagerPlugin } from './index.js'
import type { PluginManifest } from '@BBeBee/protocol'

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
})
