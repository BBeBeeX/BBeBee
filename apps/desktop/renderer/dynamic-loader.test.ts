// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { App, LoadedPlugin } from '@BBeBee/kernel'
import type { PluginManifest } from '@BBeBee/protocol'
import {
  getBuiltinPluginRegistry,
  bundled,
  loadExternalPluginRegistry,
  installAndActivatePlugin,
  uninstallExternalPlugin,
} from './dynamic-loader.js'

describe('desktop dynamic-loader', () => {
  it('returns empty registry when desktop plugins bridge is missing', async () => {
    const original = window.BBeBee
    window.BBeBee = undefined

    const registry = await loadExternalPluginRegistry()
    expect(registry).toEqual({})

    window.BBeBee = original
  })

  it('discovers workspace plugins dynamically without codegen', async () => {
    const registry = getBuiltinPluginRegistry()
    const keys = Object.keys(registry)
    expect(keys.length).toBe(55)

    // Check a representative plugin
    const playerEntry = registry['@BBeBee/plugin-player']
    expect(playerEntry).toBeDefined()
    expect(playerEntry!.builtin).toBe(true)
    expect(playerEntry!.manifest.id).toBe('@BBeBee/plugin-player')
    expect(typeof playerEntry!.load).toBe('function')

    // Test that the module actually loads dynamically
    const playerModule = (await playerEntry!.load!()) as any
    expect(playerModule.default ?? playerModule).toBeDefined()

    // Also verify exported bundled registry matches
    expect(Object.keys(bundled).length).toBe(55)
  })

  it('scans and builds dynamic registry entries from installed plugins', async () => {
    const original = window.BBeBee
    const listInstalledMock = vi.fn().mockResolvedValue([
      {
        id: '@test/custom-scrobbler',
        version: '1.2.0',
        manifest: {
          id: '@test/custom-scrobbler',
          version: '1.2.0',
          displayName: 'Custom Scrobbler',
          entry: { main: './main.js' },
          capabilities: ['net:host/*'],
        },
        dirName: 'test_scrobbler',
      },
    ])

    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: listInstalledMock,
        install: vi.fn(),
        uninstall: vi.fn(),
      },
    }

    const registry = await loadExternalPluginRegistry()
    expect(listInstalledMock).toHaveBeenCalledTimes(1)
    expect(registry['@test/custom-scrobbler']).toBeDefined()

    const entry = registry['@test/custom-scrobbler']!
    expect(entry.builtin).toBe(false)
    expect(entry.manifest.id).toBe('@test/custom-scrobbler')
    expect(typeof entry.load).toBe('function')

    window.BBeBee = original
  })

  it('installs, registers, and activates external plugin', async () => {
    const original = window.BBeBee
    const installMock = vi.fn().mockResolvedValue({ ok: true, pluginId: 'sample-ext' })
    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn(),
        install: installMock,
        uninstall: vi.fn(),
      },
    }

    const registeredEntries: Record<string, unknown> = {}
    const mockApp: Partial<App> = {
      registerPlugin: vi.fn((id, entry) => {
        registeredEntries[id] = entry
      }),
      loadPlugin: vi.fn().mockResolvedValue({
        pluginId: 'sample-ext',
        state: 'active',
      } as LoadedPlugin),
    }

    const manifest: PluginManifest = {
      id: 'sample-ext',
      version: '1.0.0',
      displayName: 'Sample Ext',
      engines: { BBeBee: '^0.1.0' },
      entry: { main: './index.js' },
      capabilities: [],
    }

    const files = {
      'index.js': 'export default function() {}',
      'manifest.json': JSON.stringify(manifest),
    }

    const loaded = await installAndActivatePlugin(mockApp as App, 'sample-ext', files, manifest)
    expect(installMock).toHaveBeenCalledWith('sample-ext', files)
    expect(mockApp.registerPlugin).toHaveBeenCalledWith('sample-ext', expect.any(Object))
    expect(mockApp.loadPlugin).toHaveBeenCalledWith('sample-ext')
    expect(loaded.state).toBe('active')

    window.BBeBee = original
  })

  it('safely uninstalls: unloads fiber before deleting files', async () => {
    const original = window.BBeBee
    const order: string[] = []

    const uninstallMock = vi.fn().mockImplementation(async () => {
      order.push('disk-removed')
      return { ok: true }
    })

    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn(),
        install: vi.fn(),
        uninstall: uninstallMock,
      },
    }

    const mockApp: Partial<App> = {
      unloadPlugin: vi.fn().mockImplementation(async () => {
        order.push('fiber-unloaded')
      }),
    }

    await uninstallExternalPlugin(mockApp as App, 'sample-ext')
    expect(order).toEqual(['fiber-unloaded', 'disk-removed'])
    expect(mockApp.unloadPlugin).toHaveBeenCalledWith('sample-ext')
    expect(uninstallMock).toHaveBeenCalledWith('sample-ext')

    window.BBeBee = original
  })
})
