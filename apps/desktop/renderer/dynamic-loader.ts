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
}

/**
 * One plugin's recall state in the merged boot lock. The boot-time
 * tamper chain was removed 2026-10-24, so this carries only the two
 * recall channels: a registry ban and a delisting. Any hash fields a
 * record or the sidecar still carries are ignored.
 */
export interface PluginLockRecord {
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
 * True when the webview is WebView2 (Windows): it cannot resolve custom
 * schemes natively, so wry serves every registered scheme as
 * `http://<scheme>.localhost` and the webview must address that form —
 * the same contract the shim's `files.toServableUrl` applies to
 * `bbebee-file://`. The platform comes from the shim's host report
 * (`window.BBeBee.platform`, the source boot.ts uses), falling back to
 * the UA under plain-browser test rigs.
 */
function isWindowsWebview(): boolean {
  const w = globalThis as {
    window?: { BBeBee?: { platform?: string }; navigator?: { userAgent?: string } }
  }
  const shimPlatform = w.window?.BBeBee?.platform
  if (typeof shimPlatform === 'string' && shimPlatform) return shimPlatform === 'win32'
  const ua = w.window?.navigator?.userAgent?.toLowerCase() ?? ''
  return ua.includes('windows')
}

/**
 * Failure diagnostics for a plugin module import, logged once per
 * failed load. Three facts separate the possible causes:
 *
 * - `plugin-fetch` (a plain fetch of the very URL that failed to
 *   import): if this fails too, the request never got a usable
 *   response — the scheme handler/interception is the problem, not
 *   module loading.
 * - `file-fetch` (the same installed package.json over `bbebee-file`,
 *   the app's other custom protocol): if this succeeds while
 *   `plugin-fetch` fails, the plugin scheme specifically is not being
 *   served; if both fail, `.localhost` scheme serving is broken
 *   wholesale in this webview.
 * - If `plugin-fetch` returns 200, serving is fine and the failure
 *   lives in module semantics (CORS/MIME/import rules).
 * - `importmap` fetches every mapped target: a bare import in the
 *   plugin's graph resolves there, so a non-200 names the exact hop
 *   that broke (in dev, usually a stale or not-yet-built .vite/deps
 *   file after an optimizer re-run).
 */
async function diagnoseImportFailure(pluginId: string, url: string): Promise<void> {
  const w = globalThis as {
    window?: {
      location?: { origin?: string; href?: string }
      navigator?: { userAgent?: string }
      document?: {
        querySelector(selector: string): { textContent?: string | null } | null
      }
      BBeBee?: {
        paths?: { get(kind: string): Promise<string | undefined> }
        files?: { toServableUrl?(uri: string): string }
      }
    }
  }
  const lines: string[] = [`[dynamic-loader:diag] import failed for ${url}`]
  lines.push(
    `origin=${w.window?.location?.origin ?? '?'} ua=${w.window?.navigator?.userAgent ?? '?'}`,
  )
  const probedTargets = new Set<string>()
  const probe = async (label: string, target: string): Promise<string | null> => {
    if (probedTargets.has(target)) return null
    probedTargets.add(target)
    try {
      const res = await fetch(target)
      const text = await res.text().catch(() => '')
      const snippet = res.ok ? '' : ` body=${JSON.stringify(text.slice(0, 200))}`
      lines.push(
        `${label}: HTTP ${res.status} content-type=${res.headers.get('content-type') ?? '?'} bytes=${text.length}${snippet} -> ${target}`,
      )
      return text
    } catch (e) {
      const err = e as Error
      lines.push(`${label}: FETCH_ERROR ${err?.name}: ${err?.message} -> ${target}`)
      return null
    }
  }
  // One level of a module's relative imports, as the loader would
  // resolve them — the graph's remaining unprobed territory when the
  // entry itself and the import-map entries all answer 200.
  const probeRelativeImports = async (
    label: string,
    code: string | null,
    baseUrl: string,
  ): Promise<void> => {
    if (!code) return
    const specs = new Set<string>()
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.\/[^'"]+)['"]/g)) {
      if (m[1]) specs.add(m[1])
    }
    for (const spec of specs) {
      await probe(`${label}:${spec}`, new URL(spec, baseUrl).href)
    }
  }
  const entryCode = await probe('plugin-fetch', url)
  await probeRelativeImports('sibling', entryCode, url)
  // The plugin's bare imports resolve through the page import map; if
  // the graph still fails to fetch while the entry itself serves, the
  // broken hop is one of the mapped targets (in dev: a .vite/deps file
  // the optimizer has not produced or has already invalidated).
  try {
    const mapText = w.window?.document?.querySelector('script[type="importmap"]')?.textContent
    const map = mapText ? (JSON.parse(mapText) as { imports?: Record<string, string> }) : null
    const entries = Object.entries(map?.imports ?? {})
    if (entries.length === 0) {
      lines.push('importmap: NONE FOUND in the document')
    } else {
      const statuses: string[] = []
      const depTexts = new Map<string, string>()
      for (const [specifier, target] of entries) {
        const absolute = new URL(target, w.window?.location?.href ?? url).href
        try {
          const res = await fetch(absolute)
          statuses.push(`${specifier}->${res.status}`)
          if (res.ok) depTexts.set(absolute, await res.text().catch(() => ''))
        } catch {
          statuses.push(`${specifier}->FETCH_ERROR`)
        }
      }
      lines.push(`importmap: ${statuses.join(' ')}`)
      // Pre-bundled entries re-export from shared chunk files; a chunk
      // the optimizer did not emit (or already replaced) fails the
      // graph fetch while every entry still answers 200.
      for (const [absolute, text] of depTexts) {
        await probeRelativeImports('dep-chunk', text, absolute)
      }
    }
  } catch (e) {
    lines.push(`importmap: PROBE_ERROR ${String(e)}`)
  }
  try {
    const userData = await w.window?.BBeBee?.paths?.get?.('userData')
    if (userData) {
      const fsPath = `${userData.replace(/\\/g, '/').replace(/\/+$/, '')}/installed-plugins/${pluginId}/package.json`
      const fileUri = fsPath.startsWith('/') ? `bbebee-file://${fsPath}` : `bbebee-file:///${fsPath}`
      const servable = w.window?.BBeBee?.files?.toServableUrl?.(fileUri) ?? fileUri
      await probe('file-fetch', servable)
    } else {
      lines.push('file-fetch: SKIPPED (no userData path from the bridge)')
    }
  } catch (e) {
    lines.push(`file-fetch: PROBE_ERROR ${String(e)}`)
  }
  console.error(lines.join('\n'))
}

/** Build the `bbebee-plugin://` URL for a file inside an installed plugin's directory. */
export function pluginFileUrl(pluginId: string, relPath: string): string {
  const path = `app/${encodeURIComponent(pluginId)}/${relPath}`
  return isWindowsWebview() ? `http://bbebee-plugin.localhost/${path}` : `bbebee-plugin://${path}`
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

/** True for the pre-execution "the graph could not be fetched" failure class. */
function isModuleFetchFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch dynamically imported module/i.test(message)
}

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
  // A module-FETCH failure is pre-execution (nothing in the graph
  // ran) and, in dev, is the signature of the vite optimizer rotating
  // its dep chunks mid-load: every probe against the settled state
  // then reads 200 while the in-flight graph is already broken. One
  // delayed retry rides over that churn instead of rolling back a
  // sound install. Other failures (resolution, evaluation) are
  // deterministic and are not retried. The diagnostic runs on the
  // first failure either way, and again if the retry also fails.
  const importResilient = async (target: string): Promise<unknown> => {
    try {
      return await importer(target)
    } catch (error) {
      await diagnoseImportFailure(pluginId, target).catch(() => undefined)
      if (!isModuleFetchFailure(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 600))
      try {
        return await importer(target)
      } catch (retryError) {
        await diagnoseImportFailure(pluginId, target).catch(() => undefined)
        throw retryError
      }
    }
  }
  return {
    manifest,
    builtin: false,
    load: async () => {
      const headlessDef = unwrapModuleDefault(
        await importResilient(pluginFileUrl(pluginId, entryMain)),
      ) as Plugin
      if (!uiDesktop) return headlessDef
      let uiDef: Plugin
      try {
        uiDef = unwrapModuleDefault(
          await importResilient(pluginFileUrl(pluginId, uiDesktop)),
        ) as Plugin
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
 * Quarantine comes only from the recall channels in the lock
 * (registry ban, delisting). There is no integrity comparison here
 * anymore: the boot-time tamper chain was removed 2026-10-24.
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
      // A registry ban (audit W5) wins over delisting in messaging:
      // it is the most actionable fact for the user. Both quarantine.
      const refuseReason =
        lockRecord?.blocked !== undefined
          ? `blocked: this plugin has been banned by the registry （该插件已被注册表安全封禁）${lockRecord.blocked ? `: ${lockRecord.blocked}` : ''}`
          : lockRecord?.delisted
            ? 'delisted: this plugin has been removed from the registry （该插件已从注册表下架）'
            : undefined

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
 * `warn` findings are advisory (logged, install proceeds), mirroring
 * plugin-manager's npm path.
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

  // Pre-install security scan: reject if audit level is 'block', log if
  // 'warn'. Hosts declared via the manifest's `net:host/<glob>`
  // capabilities are passed as the scan allowlist, mirroring
  // plugin-manager's npm path.
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
      } else if (report.level === 'warn') {
        const issues = report.findings.map((f) => f.message).join('; ')
        console.warn(
          `[dynamic-loader] Plugin "${pluginId}" (${filename}) security scan warnings (install proceeds): ${issues}`,
        )
      }
    }
  }

  // 1. Write plugin files to user's installed-plugins directory via main process
  await pluginsApi.install(pluginId, files)

  // 2. Build the dynamic RegistryEntry (headless def + optional bundled UI)
  const entry: DynamicRegistryEntry = makeExternalEntry(pluginId, manifest)

  // 3. Register into running app registry
  app.registerPlugin(pluginId, entry)

  // 4. Unload any previous fiber for this id BEFORE loading: the kernel
  //    returns an already-active fiber as-is, so without this an update
  //    or reinstall would write new files and record the new version yet
  //    keep running the old code until the next restart. Unloading a
  //    never-loaded id is a no-op, so first installs are unaffected; a
  //    host without unloadPlugin simply skips this step.
  if (typeof app.unloadPlugin === 'function') {
    await app.unloadPlugin(pluginId)
  }

  // 5. Activate plugin in kernel
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
