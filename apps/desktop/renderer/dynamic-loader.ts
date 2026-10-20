/**
 * Desktop dynamic plugin loader.
 *
 * Implements runtime discovery, loading, and installation of external
 * third-party plugins on desktop via the privileged `bbebee-plugin://` protocol.
 *
 * See docs/03-plugin-system.md §6.2.
 */

import type { Context, Plugin } from '@BBeBee/kernel'
import type { PluginManifest, RegistryLockFile, SecurityAuditService } from '@BBeBee/protocol'
import { manifestEntryFiles, scanCode, shouldScanFile } from '@BBeBee/toolkit'

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
  /** sha256 of every file in the plugin directory, as reported by the sidecar. */
  fileHashes?: Record<string, string>
}

/**
 * One plugin's integrity basis in the merged boot lock: either a legacy
 * entry-file hash, a full-package pin map, or an explicit `unverified`
 * marker for a record that carries no hashes at all.
 */
export interface PluginLockRecord {
  sha256?: string
  fileHashes?: Record<string, string>
  unverified?: boolean
  /**
   * Confirmed absent from the registry index by the liveness check
   * (audit W3): quarantine with a visible "removed from the registry"
   * reason. Only ever set after a successfully fetched index.
   */
  delisted?: boolean
  /**
   * Banned by the registry's blocked channel (audit W5): quarantine
   * with the registry's reason. Stronger than {@link delisted} and
   * wins the refusal messaging when both apply.
   */
  blocked?: string
}

/**
 * Provider arbitration (audit W5): for every NON-critical service key
 * with more than one provider, decide which single provider is in
 * effect. Cordis refuses a second registration of the same key inside
 * one isolate, so co-providers cannot simply all start — the losers
 * must be held back by the caller (boot enablement filtering, the
 * plugin-manager's runtime coordination).
 *
 * The winner is the user's persisted choice when it names a current
 * provider; otherwise a built-in (not npm-installed) provider wins —
 * the app must come up with its own services intact — falling back to
 * the first provider listed. Critical keys are never arbitrated:
 * their providers are locked on by policy and must not share the key
 * in the first place.
 */
export function resolveActiveProviders(
  providersByKey: ReadonlyMap<string, readonly string[]>,
  selection: Readonly<Record<string, string>> | undefined,
  npmInstalledIds: ReadonlySet<string>,
  isCriticalKey: (key: string) => boolean,
): Map<string, string> {
  const active = new Map<string, string>()
  for (const [key, providers] of providersByKey) {
    if (providers.length < 2 || isCriticalKey(key)) continue
    const chosen = selection?.[key]
    const winner =
      chosen && providers.includes(chosen)
        ? chosen
        : (providers.find((id) => !npmInstalledIds.has(id)) ?? providers[0]!)
    active.set(key, winner)
  }
  return active
}

/**
 * The tamper-chain verdict for one installed plugin, or undefined when
 * it may load. Full-package pins compare the ENTIRE on-disk file set
 * (changed, missing, or extra files all count); a record marked
 * unverified is refused with its own reason instead of the old fail-open
 * where a missing hash silently skipped the check. Lock records without
 * any integrity fields at all (e.g. hand-written lock entries) keep the
 * historical no-check behaviour.
 */
export function pluginTamperReason(
  lockRecord: PluginLockRecord | undefined,
  item: { sha256?: string; fileHashes?: Record<string, string> },
): string | undefined {
  if (!lockRecord) return undefined
  if (lockRecord.unverified) {
    return 'unverified: the install record carries no integrity hashes, so the on-disk code cannot be trusted'
  }
  if (lockRecord.fileHashes) {
    const pinned = lockRecord.fileHashes
    const onDisk = item.fileHashes
    if (!onDisk) {
      return 'tampered code detected: the on-disk file set could not be hashed for a fully pinned package'
    }
    if (Object.keys(onDisk).length !== Object.keys(pinned).length) {
      return 'tampered code detected: the on-disk file set differs from the install record (files added or removed)'
    }
    for (const [path, hash] of Object.entries(pinned)) {
      const actual = onDisk[path]
      if (actual === undefined) {
        return `tampered code detected: file "${path}" from the install record is missing on disk`
      }
      if (actual.trim().toLowerCase() !== hash.trim().toLowerCase()) {
        return `tampered code detected: file "${path}" no longer matches the install record`
      }
    }
    return undefined
  }
  if (
    lockRecord.sha256 &&
    item.sha256 &&
    lockRecord.sha256.trim().toLowerCase() !== item.sha256.trim().toLowerCase()
  ) {
    return 'tampered code detected (sha256 mismatch against registry.lock.json)'
  }
  return undefined
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

/** Build the `bbebee-plugin://` URL for a file inside an installed plugin's directory. */
export function pluginFileUrl(pluginId: string, relPath: string): string {
  return `bbebee-plugin://app/${encodeURIComponent(pluginId)}/${relPath}`
}

/**
 * Imports one plugin entry module over `bbebee-plugin://`. Injectable via
 * `makeExternalEntry`'s third parameter so tests can substitute a fake
 * importer instead of performing real protocol imports.
 */
export type PluginModuleImporter = (url: string) => Promise<unknown>

function unwrapModuleDefault(mod: unknown): unknown {
  return (
    (mod && typeof mod === 'object' && 'default' in mod && (mod as { default?: unknown }).default) ||
    mod
  )
}

const importEntryModule: PluginModuleImporter = (url) => import(/* @vite-ignore */ url)

/**
 * Compose a headless plugin def with its optional UI def into a single def.
 *
 * The composite registers the headless def first, then the UI def, as child
 * fibers of the one registry entry: enabling, disabling, unloading and the
 * integrity check all follow the entry. A UI def that throws while
 * registering only loses the UI — the headless plugin stays active. Without
 * a UI def the headless def is returned unchanged.
 */
export function composePluginWithUi(
  pluginId: string,
  headlessDef: Plugin,
  uiDef?: Plugin | null,
): Plugin {
  if (!uiDef) return headlessDef
  const composite: Plugin.Object = {
    name: pluginId,
    apply(ctx: Context, config?: unknown) {
      ctx.plugin(headlessDef, config)
      try {
        ctx.plugin(uiDef)
      } catch (error) {
        console.warn(
          `[dynamic-loader] UI for plugin "${pluginId}" failed to activate; the headless plugin continues without it.`,
          error,
        )
      }
    },
  }
  return composite
}

/**
 * Build the dynamic registry entry for one installed external plugin.
 *
 * The entry's `load()` imports `entry.main` over `bbebee-plugin://`. When
 * the manifest also declares `entry.ui.desktop`, that module is imported
 * from the same package and composed with the headless def (see
 * `composePluginWithUi`) — one npm package, one version, one registry entry.
 * A UI module that fails to import degrades to headless-only with a warning
 * instead of failing the whole plugin. `entry.ui.mobile` is ignored here:
 * mobile has no dynamic loader yet.
 */
export function makeExternalEntry(
  pluginId: string,
  manifest: PluginManifest,
  importer: PluginModuleImporter = importEntryModule,
): DynamicRegistryEntry {
  const entryMain = (manifest.entry?.main ?? './index.js').replace(/^\.?\//, '')
  const uiDesktop = manifest.entry?.ui?.desktop?.replace(/^\.?\//, '')
  return {
    manifest,
    builtin: false,
    load: async () => {
      const headlessDef = unwrapModuleDefault(
        await importer(pluginFileUrl(pluginId, entryMain)),
      ) as Plugin
      if (!uiDesktop) return headlessDef
      let uiDef: Plugin
      try {
        uiDef = unwrapModuleDefault(await importer(pluginFileUrl(pluginId, uiDesktop))) as Plugin
      } catch (error) {
        console.warn(
          `[dynamic-loader] Failed to load UI module for plugin "${pluginId}" (${uiDesktop}); loading the headless plugin only.`,
          error,
        )
        return headlessDef
      }
      return composePluginWithUi(pluginId, headlessDef, uiDef)
    },
  }
}

/**
 * Scan for installed external plugins from the desktop host and build
 * dynamic registry entries with ESM imports over `bbebee-plugin://`.
 *
 * Verifies plugin integrity against `registry.lock.json` if available.
 * If tampered, refuses loading and marks quarantined.
 */
export async function loadExternalPluginRegistry(options?: {
  lock?: RegistryLockFile | Record<string, PluginLockRecord>
}): Promise<DynamicPluginRegistry> {
  const pluginsApi = typeof window !== 'undefined' ? window.BBeBee?.plugins : undefined
  if (!pluginsApi) return {}

  try {
    const list = await pluginsApi.listInstalled()
    const lockData = (options?.lock ?? (await pluginsApi.getLock?.())) as
      | RegistryLockFile
      | Record<string, PluginLockRecord>
      | undefined
    const records = (lockData && 'records' in lockData ? lockData.records : lockData) as
      | Record<string, PluginLockRecord>
      | undefined

    const registry: DynamicPluginRegistry = {}

    for (const item of list) {
      if (!item.id || !item.manifest || typeof item.manifest !== 'object') continue
      const manifest = item.manifest as PluginManifest

      const lockRecord = records?.[item.id]
      // A registry ban (audit W5) wins over both delisting and the
      // tamper verdict in messaging: it is the most actionable fact
      // for the user. All three quarantine.
      const refuseReason =
        lockRecord?.blocked !== undefined
          ? `blocked: this plugin has been banned by the registry （该插件已被注册表安全封禁）${lockRecord.blocked ? `: ${lockRecord.blocked}` : ''}`
          : lockRecord?.delisted
            ? 'delisted: this plugin has been removed from the registry （该插件已从注册表下架）'
            : pluginTamperReason(lockRecord, item)

      if (refuseReason) {
        console.error(
          `[dynamic-loader] Plugin "${item.id}" refused (${refuseReason}). Quarantined.`,
        )
        registry[item.id] = {
          manifest,
          builtin: false,
          quarantined: true,
          load: async () => {
            throw new Error(`Plugin "${item.id}" refused to load: ${refuseReason}`)
          },
        }
        continue
      }

      registry[item.id] = makeExternalEntry(item.id, manifest)
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

  // Pre-install security scan: reject if audit level is 'block'. Hosts
  // declared via the manifest's `net:host/<glob>` capabilities are
  // passed as the scan allowlist, mirroring plugin-manager's npm path.
  const scanner =
    options?.securityAudit ??
    (app as unknown as { ctx?: { securityAudit?: SecurityAuditService } }).ctx?.securityAudit
  const allowedHosts = (manifest.capabilities ?? [])
    .filter((c) => c.startsWith('net:host/'))
    .map((c) => c.slice('net:host/'.length).trim())
    .filter(Boolean)
  const scanContext = allowedHosts.length > 0 ? { allowedHosts } : undefined
  // Same selection as plugin-manager's npm path (the toolkit helpers):
  // all executable-text extensions, plus the manifest's entry files
  // whatever their extension — an unscanned entry is an unguarded one.
  const entryFiles = manifestEntryFiles(manifest.entry)
  for (const [filename, content] of Object.entries(files)) {
    if (typeof content === 'string' && shouldScanFile(filename, entryFiles)) {
      const report = scanner ? scanner.scan(content, scanContext) : scanCode(content, scanContext)
      if (report.level === 'block') {
        const issues = report.findings.map((f) => f.message).join('; ')
        throw new Error(`Installation blocked by security audit for "${pluginId}" (${filename}): ${issues}`)
      }
    }
  }

  // 1. Write plugin files to user's installed-plugins directory via main process
  await pluginsApi.install(pluginId, files)

  // 2. Build the dynamic RegistryEntry (headless def + optional bundled UI)
  const entry: DynamicRegistryEntry = makeExternalEntry(pluginId, manifest)

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
