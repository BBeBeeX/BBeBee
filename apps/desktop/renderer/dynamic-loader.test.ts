// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { App, LoadedPlugin } from '@BBeBee/kernel'
import type { PluginManifest } from '@BBeBee/protocol'
import {
  composePluginWithUi,
  getBuiltinPluginRegistry,
  loadExternalPluginRegistry,
  installAndActivatePlugin,
  makeExternalEntry,
  pluginFileUrl,
  resolveActiveProviders,
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
    expect(Object.keys(registry).length).toBeGreaterThan(0)

    // Check a representative plugin
    const playerEntry = registry['@BBeBee/plugin-player']
    expect(playerEntry).toBeDefined()
    expect(playerEntry!.builtin).toBe(true)
    expect(playerEntry!.manifest.id).toBe('@BBeBee/plugin-player')
    expect(typeof playerEntry!.load).toBe('function')

    // Test that the module actually loads dynamically
    const playerModule = (await playerEntry!.load!()) as any
    expect(playerModule.default ?? playerModule).toBeDefined()

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

  it('blocks installation when security audit detects malicious code', async () => {
    const original = window.BBeBee
    const installMock = vi.fn()
    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn(),
        install: installMock,
        uninstall: vi.fn(),
      },
    }

    const mockApp: Partial<App> = {
      registerPlugin: vi.fn(),
      loadPlugin: vi.fn(),
    }

    const manifest: PluginManifest = {
      id: 'malicious-ext',
      version: '1.0.0',
      displayName: 'Malicious Ext',
      engines: { BBeBee: '^0.1.0' },
      entry: { main: './index.js' },
      capabilities: [],
    }

    const files = {
      'index.js': 'eval("badCode()"); fetch("https://evil.example.com");',
      'manifest.json': JSON.stringify(manifest),
    }

    await expect(
      installAndActivatePlugin(mockApp as App, 'malicious-ext', files, manifest),
    ).rejects.toThrow(/Installation blocked by security audit/)

    expect(installMock).not.toHaveBeenCalled()
    expect(mockApp.registerPlugin).not.toHaveBeenCalled()

    window.BBeBee = original
  })

  it('blocks installation when the entry is an .mjs file carrying malicious code', async () => {
    const original = window.BBeBee
    const installMock = vi.fn()
    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn(),
        install: installMock,
        uninstall: vi.fn(),
      },
    }

    const mockApp: Partial<App> = {
      registerPlugin: vi.fn(),
      loadPlugin: vi.fn(),
    }

    const manifest: PluginManifest = {
      id: 'malicious-mjs',
      version: '1.0.0',
      displayName: 'Malicious MJS',
      engines: { BBeBee: '^0.1.0' },
      entry: { main: './payload.mjs' },
      capabilities: [],
    }

    const files = {
      'payload.mjs': 'eval(atob("YmFkQ29kZSgp"));',
      'manifest.json': JSON.stringify(manifest),
    }

    await expect(
      installAndActivatePlugin(mockApp as App, 'malicious-mjs', files, manifest),
    ).rejects.toThrow(/Installation blocked by security audit/)

    expect(installMock).not.toHaveBeenCalled()
    expect(mockApp.registerPlugin).not.toHaveBeenCalled()

    window.BBeBee = original
  })

  it('scans the manifest entry file even when its extension is not a code extension', async () => {
    const original = window.BBeBee
    const installMock = vi.fn()
    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn(),
        install: installMock,
        uninstall: vi.fn(),
      },
    }

    const mockApp: Partial<App> = {
      registerPlugin: vi.fn(),
      loadPlugin: vi.fn(),
    }

    const manifest: PluginManifest = {
      id: 'odd-entry-ext',
      version: '1.0.0',
      displayName: 'Odd Entry Ext',
      engines: { BBeBee: '^0.1.0' },
      entry: { main: './boot.txt' },
      capabilities: [],
    }

    const files = {
      'boot.txt': 'eval("badCode()");',
      'manifest.json': JSON.stringify(manifest),
    }

    await expect(
      installAndActivatePlugin(mockApp as App, 'odd-entry-ext', files, manifest),
    ).rejects.toThrow(/Installation blocked by security audit/)

    expect(installMock).not.toHaveBeenCalled()

    window.BBeBee = original
  })

  it('refuses loading and marks quarantined when installed plugin hash is tampered', async () => {
    const original = window.BBeBee
    const listInstalledMock = vi.fn().mockResolvedValue([
      {
        id: '@test/tampered-plugin',
        version: '1.0.0',
        manifest: {
          id: '@test/tampered-plugin',
          version: '1.0.0',
          displayName: 'Tampered Plugin',
          entry: { main: './index.js' },
          capabilities: [],
        },
        dirName: 'test_tampered',
        sha256: 'tampered-sha-256',
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

    const lock = {
      version: 1 as const,
      records: {
        '@test/tampered-plugin': {
          id: '@test/tampered-plugin',
          kind: 'plugin' as const,
          repo: 'https://github.com/test/tampered-plugin',
          commit: 'c0ffee1',
          sha256: 'original-sha-256',
          installedAt: 123456789,
        },
      },
    }

    const registry = await loadExternalPluginRegistry({ lock })
    expect(registry['@test/tampered-plugin']).toBeDefined()
    const entry = registry['@test/tampered-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/tampered/)

    window.BBeBee = original
  })
})

describe('full-package tamper chain (audit W3)', () => {
  const MANIFEST = {
    id: 'full-chain-plugin',
    version: '1.0.0',
    displayName: 'Full Chain Plugin',
    entry: { main: './dist/index.js' },
    capabilities: [],
  }
  const PINNED = {
    'BBeBee.plugin.json': 'hash-manifest',
    'dist/index.js': 'hash-entry',
    'dist/helper.js': 'hash-helper',
  }

  async function loadWith(item: Record<string, unknown>, lockRecord: unknown) {
    const original = window.BBeBee
    // @ts-expect-error test mock
    window.BBeBee = {
      ...original,
      plugins: {
        listInstalled: vi.fn().mockResolvedValue([item]),
        install: vi.fn(),
        uninstall: vi.fn(),
      },
    }
    try {
      return await loadExternalPluginRegistry({
        lock: { 'full-chain-plugin': lockRecord } as never,
      })
    } finally {
      window.BBeBee = original
    }
  }

  const baseItem = {
    id: 'full-chain-plugin',
    version: '1.0.0',
    manifest: MANIFEST,
    dirName: 'full-chain-plugin',
    sha256: 'hash-entry',
    fileHashes: { ...PINNED },
  }

  it('loads when every on-disk file matches the pinned map', async () => {
    const registry = await loadWith(baseItem, { fileHashes: { ...PINNED } })
    const entry = registry['full-chain-plugin']!
    expect(entry).toBeDefined()
    expect(entry.quarantined).toBeUndefined()
  })

  it('quarantines when a NON-entry file was changed on disk', async () => {
    const item = { ...baseItem, fileHashes: { ...PINNED, 'dist/helper.js': 'hash-attacker' } }
    const registry = await loadWith(item, { fileHashes: { ...PINNED } })
    const entry = registry['full-chain-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/tampered/)
    await expect(entry.load!()).rejects.toThrow(/dist\/helper\.js/)
  })

  it('quarantines when an extra file appeared on disk', async () => {
    const item = { ...baseItem, fileHashes: { ...PINNED, 'dist/injected.js': 'hash-x' } }
    const registry = await loadWith(item, { fileHashes: { ...PINNED } })
    expect(registry['full-chain-plugin']!.quarantined).toBe(true)
  })

  it('quarantines when a pinned file is missing on disk', async () => {
    const rest: Record<string, string> = {}
    for (const [k, v] of Object.entries(PINNED)) {
      if (k !== 'dist/helper.js') rest[k] = v
    }
    const item = { ...baseItem, fileHashes: rest }
    const registry = await loadWith(item, { fileHashes: { ...PINNED } })
    const entry = registry['full-chain-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/tampered/)
  })

  it('quarantines when the sidecar reports no file hashes for a fully pinned package', async () => {
    const item: Record<string, unknown> = { ...baseItem }
    delete item['fileHashes']
    const registry = await loadWith(item, { fileHashes: { ...PINNED } })
    expect(registry['full-chain-plugin']!.quarantined).toBe(true)
  })

  it('quarantines a record with no integrity basis as unverified instead of failing open', async () => {
    const registry = await loadWith(baseItem, { unverified: true })
    const entry = registry['full-chain-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/unverified/)
  })

  it('quarantines a delisted plugin with the removed-from-registry reason (audit W3 liveness)', async () => {
    const registry = await loadWith(baseItem, { fileHashes: { ...PINNED }, delisted: true })
    const entry = registry['full-chain-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/delisted/)
    await expect(entry.load!()).rejects.toThrow(/已从注册表下架/)
  })

  it('resolveActiveProviders honours the selection, else the built-in, and never arbitrates critical keys', () => {
    const byKey = new Map<string, readonly string[]>([
      ['visualizer', ['@BBeBee/plugin-visualizer', 'third-viz']],
      ['player', ['@BBeBee/plugin-player', 'evil-player']],
      ['lyrics', ['only-one']],
    ])
    const npmIds = new Set(['third-viz', 'evil-player'])
    const isCritical = (k: string) => k === 'player'

    // No selection: the built-in (non-npm) provider wins.
    let active = resolveActiveProviders(byKey, undefined, npmIds, isCritical)
    expect(active.get('visualizer')).toBe('@BBeBee/plugin-visualizer')
    expect(active.has('player')).toBe(false) // critical: untouched
    expect(active.has('lyrics')).toBe(false) // single provider: untouched

    // The persisted user choice wins over the built-in default.
    active = resolveActiveProviders(byKey, { visualizer: 'third-viz' }, npmIds, isCritical)
    expect(active.get('visualizer')).toBe('third-viz')

    // A stale choice (provider gone) falls back to the built-in rule.
    active = resolveActiveProviders(byKey, { visualizer: 'ghost' }, npmIds, isCritical)
    expect(active.get('visualizer')).toBe('@BBeBee/plugin-visualizer')
  })

  it('quarantines a registry-banned plugin with the ban reason, ahead of delisting (audit W5)', async () => {
    const registry = await loadWith(baseItem, {
      fileHashes: { ...PINNED },
      delisted: true,
      blocked: 'malware: credential stealer',
    })
    const entry = registry['full-chain-plugin']!
    expect(entry.quarantined).toBe(true)
    await expect(entry.load!()).rejects.toThrow(/blocked/)
    await expect(entry.load!()).rejects.toThrow(/安全封禁/)
    await expect(entry.load!()).rejects.toThrow(/credential stealer/)
  })

  it('still honours the legacy entry-only pin for older records', async () => {
    const ok = await loadWith(baseItem, { sha256: 'hash-entry' })
    expect(ok['full-chain-plugin']!.quarantined).toBeUndefined()
    const bad = await loadWith({ ...baseItem, sha256: 'hash-other' }, { sha256: 'hash-entry' })
    expect(bad['full-chain-plugin']!.quarantined).toBe(true)
  })
})

describe('external plugin UI composition (makeExternalEntry / composePluginWithUi)', () => {
  type AnyDef = {
    name?: string
    apply: (ctx: { plugin: (def: unknown, config?: unknown) => void }) => void
  }

  const headlessDef = { name: 'headless', apply: vi.fn() }
  const uiDef = { name: 'ui', apply: vi.fn() }

  function manifestWith(entry: PluginManifest['entry']): PluginManifest {
    return {
      id: 'ui-plug',
      version: '1.0.0',
      displayName: 'UI Plug',
      engines: { BBeBee: '^0.1.0' },
      entry,
      capabilities: [],
    }
  }

  it('builds bbebee-plugin:// URLs with an encoded plugin id', () => {
    expect(pluginFileUrl('@test/ui-plug', 'dist/index.js')).toBe(
      'bbebee-plugin://app/%40test%2Fui-plug/dist/index.js',
    )
    expect(pluginFileUrl('ui-plug', 'dist/ui.js')).toBe('bbebee-plugin://app/ui-plug/dist/ui.js')
  })

  it('loads headless + UI modules and composes them in registration order', async () => {
    const importer = vi.fn(async (url: string) =>
      url.endsWith('/dist/ui.js') ? { default: uiDef } : { default: headlessDef },
    )
    const entry = makeExternalEntry(
      'ui-plug',
      manifestWith({ main: './dist/index.js', ui: { desktop: './dist/ui.js' } }),
      importer,
    )

    const def = (await entry.load!()) as AnyDef
    expect(importer.mock.calls.map(([url]) => url)).toEqual([
      'bbebee-plugin://app/ui-plug/dist/index.js',
      'bbebee-plugin://app/ui-plug/dist/ui.js',
    ])
    expect(def).not.toBe(headlessDef)
    expect(def.name).toBe('ui-plug')

    const registered: unknown[] = []
    def.apply({
      plugin: (d) => {
        registered.push(d)
      },
    })
    expect(registered).toEqual([headlessDef, uiDef])
  })

  it('degrades to headless-only when the UI module fails to import', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const importer = vi.fn(async (url: string) => {
      if (url.endsWith('/dist/ui.js')) throw new Error('UI file missing')
      return { default: headlessDef }
    })
    const entry = makeExternalEntry(
      'ui-plug',
      manifestWith({ main: './dist/index.js', ui: { desktop: './dist/ui.js' } }),
      importer,
    )

    await expect(entry.load!()).resolves.toBe(headlessDef)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load UI module for plugin "ui-plug"'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('returns the headless def itself when no UI is declared', async () => {
    const importer = vi.fn(async () => ({ default: headlessDef }))
    const entry = makeExternalEntry('ui-plug', manifestWith({ main: './dist/index.js' }), importer)

    await expect(entry.load!()).resolves.toBe(headlessDef)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importer).toHaveBeenCalledWith('bbebee-plugin://app/ui-plug/dist/index.js')
  })

  it('ignores entry.ui.mobile on desktop (no second import)', async () => {
    const importer = vi.fn(async () => ({ default: headlessDef }))
    const entry = makeExternalEntry(
      'ui-plug',
      manifestWith({ main: './dist/index.js', ui: { mobile: './dist/ui-mobile.js' } }),
      importer,
    )

    await expect(entry.load!()).resolves.toBe(headlessDef)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('keeps the headless plugin when the UI def throws during apply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const composite = composePluginWithUi('ui-plug', headlessDef, uiDef) as unknown as AnyDef
    const plugin = vi.fn((d: unknown) => {
      if (d === uiDef) throw new Error('ui boom')
    })

    expect(() => composite.apply({ plugin })).not.toThrow()
    expect(plugin).toHaveBeenCalledTimes(2)
    expect(plugin.mock.calls[0]?.[0]).toBe(headlessDef)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('UI for plugin "ui-plug" failed to activate'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('composePluginWithUi returns the headless def itself without a UI def', () => {
    expect(composePluginWithUi('ui-plug', headlessDef)).toBe(headlessDef)
    expect(composePluginWithUi('ui-plug', headlessDef, null)).toBe(headlessDef)
  })
})
