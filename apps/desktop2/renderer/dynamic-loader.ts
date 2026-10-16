/**
 * Desktop dynamic plugin loader.
 *
 * Implements runtime discovery, loading, and installation of external
 * third-party plugins on desktop via the privileged `bbebee-plugin://` protocol.
 *
 * See docs/03-plugin-system.md §6.2.
 */

import type { Plugin } from '@BBeBee/kernel'
import type { PluginManifest, RegistryLockFile, SecurityAuditService } from '@BBeBee/protocol'
import { scanCode } from '@BBeBee/toolkit'

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
  quarantined?: boolean
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
  sha256?: string
}

/**
 * Dynamic registry of built-in workspace plugins discovered via Vite glob import.
 * Completely eliminates the need for static codegen on desktop.
 */
export function getBuiltinPluginRegistry(): DynamicPluginRegistry {
  const manifestFiles = import.meta.glob<PluginManifest>(
    [
      '../../../packages/{core,logs,feature,ui}/**/BBeBee.plugin.json',
      '!../../../packages/**/*-expo/**',
      '!../../../packages/**/*-rn/**',
      '!../../../packages/**/*-mobile/**',
    ],
    { eager: true, import: 'default' },
  )
  const moduleLoaders = import.meta.glob([
    '../../../packages/{core,logs,feature,ui}/**/src/index.{ts,tsx}',
    '!../../../packages/**/*-expo/**',
    '!../../../packages/**/*-rn/**',
    '!../../../packages/**/*-mobile/**',
    '!../../../packages/ui/ui-kit-mobile/**',
    '!../../../packages/core/core-db-node/**',
    '!../../../packages/core/core-fs-node/**',
    '!../../../packages/core/core-paths-node/**',
  ])

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
 *
 * Verifies plugin integrity against `registry.lock.json` if available.
 * If tampered, refuses loading and marks quarantined.
 */
export async function loadExternalPluginRegistry(options?: {
  lock?: RegistryLockFile | Record<string, { sha256?: string }>
}): Promise<DynamicPluginRegistry> {
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (!pluginsApi) return {}

  try {
    const list = await pluginsApi.listInstalled()
    const lockData = (options?.lock ?? (await pluginsApi.getLock?.())) as
      | RegistryLockFile
      | Record<string, { sha256?: string }>
      | undefined
    const records = (lockData && 'records' in lockData ? lockData.records : lockData) as
      | Record<string, { sha256?: string }>
      | undefined

    const registry: DynamicPluginRegistry = {}

    for (const item of list) {
      if (!item.id || !item.manifest || typeof item.manifest !== 'object') continue
      const manifest = item.manifest as PluginManifest
      const entryMain = (manifest.entry?.main ?? './index.js').replace(/^\.?\//, '')

      const lockRecord = records?.[item.id]
      const isTampered = Boolean(
        lockRecord?.sha256 &&
          item.sha256 &&
          lockRecord.sha256.trim().toLowerCase() !== item.sha256.trim().toLowerCase(),
      )

      if (isTampered) {
        console.error(
          `[dynamic-loader] Plugin "${item.id}" integrity mismatch against registry.lock.json (tampered). Quarantined.`,
        )
        registry[item.id] = {
          manifest,
          builtin: false,
          quarantined: true,
          load: async () => {
            throw new Error(
              `Plugin "${item.id}" refused to load: tampered code detected (sha256 mismatch against registry.lock.json)`,
            )
          },
        }
        continue
      }

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
 *
 * Runs a pre-install security scan: if level is 'block', rejects installation.
 */
export async function installAndActivatePlugin(
  app: DynamicPluginHost,
  pluginId: string,
  files: Record<string, string>,
  manifest: PluginManifest,
  options?: {
    securityAudit?: SecurityAuditService
  },
): Promise<DynamicLoadedPlugin> {
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (!pluginsApi) {
    throw new Error('Desktop plugins bridge is unavailable')
  }

  // Pre-install security scan: reject if audit level is 'block'
  const scanner =
    options?.securityAudit ??
    (app as unknown as { ctx?: { securityAudit?: SecurityAuditService } }).ctx?.securityAudit
  for (const [filename, content] of Object.entries(files)) {
    if (typeof content === 'string' && (filename.endsWith('.js') || filename.endsWith('.ts'))) {
      const report = scanner ? scanner.scan(content) : scanCode(content)
      if (report.level === 'block') {
        const issues = report.findings.map((f) => f.message).join('; ')
        throw new Error(`Installation blocked by security audit for "${pluginId}" (${filename}): ${issues}`)
      }
    }
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
