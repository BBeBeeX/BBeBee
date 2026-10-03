/**
 * Desktop dynamic plugin loader.
 *
 * Implements runtime discovery, loading, and installation of external
 * third-party plugins on desktop via the privileged `bbebee-plugin://` protocol.
 *
 * See docs/03-plugin-system.md §6.2.
 */

import type { Plugin } from '@BBeBee/kernel'
import type { PluginManifest } from '@BBeBee/protocol'

export type DynamicLoadState =
  | 'active'
  | 'pending'
  | 'failed'
  | 'quarantined'
  | 'missing'
  | 'ungranted'

export interface DynamicRegistryEntry {
  plugin?: Plugin
  load?: () => Promise<unknown>
  manifest: PluginManifest
  builtin?: boolean
}

export type DynamicPluginRegistry = Record<string, DynamicRegistryEntry>

export interface DynamicLoadedPlugin {
  pluginId: string
  state: DynamicLoadState
  error?: Error
  waitingFor?: string[]
  dispose?: () => Promise<void>
}

export interface DynamicPluginHost {
  registerPlugin(id: string, entry: DynamicRegistryEntry): void
  loadPlugin(id: string): Promise<DynamicLoadedPlugin>
  unloadPlugin(id: string): Promise<void>
}

export interface InstalledPluginRecord {
  id: string
  version: string
  manifest: unknown
  dirName: string
}

/**
 * Dynamic registry of built-in workspace plugins discovered via Vite glob import.
 * Completely eliminates the need for static codegen on desktop.
 */
export function getBuiltinPluginRegistry(): DynamicPluginRegistry {
  const manifestFiles = import.meta.glob<PluginManifest>(
    '../../../packages/**/BBeBee.plugin.json',
    { eager: true, import: 'default' },
  )
  const moduleLoaders = import.meta.glob(
    '../../../packages/**/src/index.{ts,tsx}',
  )

  const registry: DynamicPluginRegistry = {}

  for (const [manifestPath, manifest] of Object.entries(manifestFiles)) {
    if (manifest.platforms && !manifest.platforms.includes('desktop')) {
      continue
    }

    const dir = manifestPath.slice(0, manifestPath.lastIndexOf('/'))
    const tsPath = `${dir}/src/index.ts`
    const tsxPath = `${dir}/src/index.tsx`
    const loader = moduleLoaders[tsPath] ?? moduleLoaders[tsxPath]

    if (!loader) {
      continue
    }

    registry[manifest.id] = {
      manifest,
      builtin: true,
      load: async () => {
        const mod = (await loader()) as Record<string, unknown> | null | undefined
        return (mod && typeof mod === 'object' && 'default' in mod && mod.default) || mod
      },
    }
  }

  return registry
}

export const bundled: DynamicPluginRegistry = getBuiltinPluginRegistry()

/**
 * Scan for installed external plugins from the desktop host and build
 * dynamic registry entries with ESM imports over `bbebee-plugin://`.
 */
export async function loadExternalPluginRegistry(): Promise<DynamicPluginRegistry> {
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (!pluginsApi) return {}

  try {
    const list = await pluginsApi.listInstalled()
    const registry: DynamicPluginRegistry = {}

    for (const item of list) {
      if (!item.id || !item.manifest || typeof item.manifest !== 'object') continue
      const manifest = item.manifest as PluginManifest
      const entryMain = (manifest.entry?.main ?? './index.js').replace(/^\.?\//, '')

      const entry: DynamicRegistryEntry = {
        manifest,
        builtin: false,
        load: async () => {
          const url = `bbebee-plugin://app/${encodeURIComponent(item.id)}/${entryMain}`
          const mod = await import(/* @vite-ignore */ url)
          return (mod && typeof mod === 'object' && 'default' in mod && mod.default) || mod
        },
      }

      registry[item.id] = entry
    }

    return registry
  } catch (error) {
    console.error('Failed to load external plugins registry:', error)
    return {}
  }
}

/**
 * Install plugin files into the user plugins directory, register it into the
 * running kernel registry, and immediately load and activate it.
 */
export async function installAndActivatePlugin(
  app: DynamicPluginHost,
  pluginId: string,
  files: Record<string, string>,
  manifest: PluginManifest,
): Promise<DynamicLoadedPlugin> {
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (!pluginsApi) {
    throw new Error('Desktop plugins bridge is unavailable')
  }

  // 1. Write plugin files to user's installed-plugins directory via main process
  await pluginsApi.install(pluginId, files)

  // 2. Build the dynamic RegistryEntry
  const entryMain = (manifest.entry?.main ?? './index.js').replace(/^\.?\//, '')
  const entry: DynamicRegistryEntry = {
    manifest,
    builtin: false,
    load: async () => {
      const url = `bbebee-plugin://app/${encodeURIComponent(pluginId)}/${entryMain}`
      const mod = await import(/* @vite-ignore */ url)
      return (mod && typeof mod === 'object' && 'default' in mod && mod.default) || mod
    },
  }

  // 3. Register into running app registry
  app.registerPlugin(pluginId, entry)

  // 4. Activate plugin in kernel
  return app.loadPlugin(pluginId)
}

/**
 * Safely uninstall an external plugin:
 * Disposes the Cordis fiber first, then removes files from disk.
 * (docs/03 §6.2: never remove disk files before fiber is disposed).
 */
export async function uninstallExternalPlugin(app: DynamicPluginHost, pluginId: string): Promise<void> {
  // 1. Dispose fiber first
  await app.unloadPlugin(pluginId)

  // 2. Delete files from disk
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (pluginsApi) {
    await pluginsApi.uninstall(pluginId)
  }
}
