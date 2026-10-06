/**
 * `plugin-manager` — headless plugin manager service.
 *
 * Implements `ctx['plugin-manager']` for runtime state tracking,
 * manifest aggregation, dependency graph analysis, and lifecycle toggling.
 */

import { Service, type Context } from '@BBeBee/kernel'
import type {
  ConfigStatus,
  PluginInfo,
  PluginLifecycleBridge,
  PluginManagerService,
  PluginManifest,
  PluginRuntimeState,
  AppSettings,
  SettingsContribution,
} from '@BBeBee/protocol'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_DESKTOP_LYRICS_SETTINGS,
  DEFAULT_VISUALIZER_SETTINGS,
} from '@BBeBee/protocol'
import { computeReverseDependents, flattenFiberNodes } from '@BBeBee/toolkit'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/**
 * Structural subset of the inspector's fiber node — only the fields
 * {@link PluginManagerPlugin.list} reads. Declared locally so this package
 * does not depend on plugin-inspector (feature packages may not import each
 * other's exports); the real snapshot satisfies this shape structurally, and
 * the toolkit's `TreeFiberNode` constraint is met via `name`/`children`.
 */
interface InspectorFiberNode {
  name: string
  children?: readonly InspectorFiberNode[]
  inject?: readonly string[]
  waitingFor: readonly string[]
  provides?: readonly string[]
  state: string
}

/**
 * Structural subset of the inspector snapshot — only `root` is read here;
 * `counts`/`stalled` belong to the inspector's own view package.
 */
interface InspectorSnapshotData {
  root?: InspectorFiberNode
}

export interface PluginManagerConfig {
  manifests?: Record<string, PluginManifest>
}

const KNOWN_CONFIGURABLE_PLUGINS = new Set([
  '@BBeBee/plugin-settings',
  '@BBeBee/plugin-player',
  '@BBeBee/plugin-theme',
  '@BBeBee/plugin-now-playing',
  '@BBeBee/plugin-desktop-lyrics',
  '@BBeBee/plugin-visualizer',
  '@BBeBee/plugin-dsp',
])

export class PluginManagerPlugin extends Service implements PluginManagerService {
  static override readonly name = 'plugin-manager'
  static readonly inject = ['store', 'inspector']

  private readonly manifests = new Map<string, PluginManifest>()
  private overrides: Record<string, boolean> = {}
  private readonly failedErrors = new Map<string, string>()
  private bridge?: PluginLifecycleBridge

  constructor(ctx: Context, config?: PluginManagerConfig) {
    super(ctx, 'plugin-manager')
    if (config?.manifests) {
      for (const [id, m] of Object.entries(config.manifests)) {
        this.manifests.set(id, m)
      }
    }
  }

  async [Service.init]() {
    this.ctx.logger.info('plugin-manager: initialized')

    try {
      this.overrides = await this.loadOverrides()
    } catch (err) {
      this.ctx.logger.warn(`plugin-manager: failed to load persisted overrides: ${String(err)}`)
    }

    const off1 = this.ctx.on('plugin/loaded', (id: string) => {
      this.failedErrors.delete(id)
      this.ctx.emit('plugin-manager/changed')
    })
    const off2 = this.ctx.on('plugin/unloaded', () => {
      this.ctx.emit('plugin-manager/changed')
    })
    const off3 = this.ctx.on('plugin/failed', (id: string, error: Error) => {
      this.failedErrors.set(id, error?.message ?? String(error))
      this.ctx.emit('plugin-manager/changed')
    })

    return () => {
      off1()
      off2()
      off3()
    }
  }

  registerManifests(manifests: Record<string, PluginManifest>): void {
    for (const [id, m] of Object.entries(manifests)) {
      this.manifests.set(id, m)
      if (m.name && !this.manifests.has(m.name)) {
        this.manifests.set(m.name, m)
      }
    }
    this.ctx.emit('plugin-manager/changed')
  }

  setLifecycleBridge(bridge: PluginLifecycleBridge): void {
    this.bridge = bridge
  }

  private async loadOverrides(): Promise<Record<string, boolean>> {
    try {
      const result = await this.ctx.store.get<Record<string, boolean>>('enabled')
      return result ?? {}
    } catch {
      return {}
    }
  }

  private async saveOverrides(overrides: Record<string, boolean>): Promise<void> {
    await this.ctx.store.set('enabled', overrides)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.overrides[id] = enabled
    const m = this.manifests.get(id)
    if (m?.name) {
      this.overrides[m.name] = enabled
    }

    await this.saveOverrides(this.overrides)
    this.ctx.emit('plugin-manager/enabled-changed', { id, enabled })
    this.ctx.emit('plugin-manager/changed')

    if (this.bridge) {
      if (enabled) {
        await this.bridge.loadPlugin(id)
      } else {
        await this.bridge.unloadPlugin(id)
      }
    }
  }

  refresh(): readonly PluginInfo[] {
    return this.list()
  }

  list(): readonly PluginInfo[] {
    let snapshot: InspectorSnapshotData | null = null
    try {
      // Read structurally, like `ctx.settings` below: the `inspector` service
      // is declared by plugin-inspector, which this package must not import.
      const inspector = (
        this.ctx as unknown as { inspector?: { snapshot?: () => InspectorSnapshotData } }
      ).inspector
      if (inspector?.snapshot) {
        snapshot = inspector.snapshot()
      }
    } catch {
      snapshot = null
    }

    const fibersMap = new Map<string, InspectorFiberNode>()
    if (snapshot?.root) {
      flattenFiberNodes(snapshot.root, fibersMap)
    }

    // Build service to provider plugin mapping
    const serviceProviders = new Map<string, string>()
    for (const [id, m] of this.manifests.entries()) {
      for (const s of m.contributes?.services ?? []) {
        serviceProviders.set(s, id)
      }
    }
    for (const [fiberName, fiber] of fibersMap.entries()) {
      for (const prov of fiber.provides ?? []) {
        if (!serviceProviders.has(prov)) {
          serviceProviders.set(prov, fiberName)
        }
      }
    }

    // Get current settings snapshot to determine configStatus
    let currentSettings: AppSettings | undefined
    try {
      const settingsSvc = serviceOf<{ getSync?(): AppSettings }>(this.ctx, 'settings')
      if (settingsSvc?.getSync) {
        currentSettings = settingsSvc.getSync()
      }
    } catch {
      currentSettings = undefined
    }

    const settingsContribs: readonly SettingsContribution[] = (() => {
      try {
        const settingsSvc = serviceOf<{
          getContributions?(): readonly SettingsContribution[]
        }>(this.ctx, 'settings')
        return settingsSvc?.getContributions?.() ?? []
      } catch {
        return []
      }
    })()

    // Deduplicate manifests by id
    const uniqueManifests = new Map<string, PluginManifest>()
    for (const m of this.manifests.values()) {
      uniqueManifests.set(m.id, m)
    }

    const rawList: Array<{
      info: PluginInfo
      rawDependencies: Set<string>
    }> = []

    for (const manifest of uniqueManifests.values()) {
      const mName = manifest.name
      const fiber =
        fibersMap.get(manifest.id) ??
        (mName ? fibersMap.get(mName) : undefined) ??
        fibersMap.get(manifest.id.replace(/^@BBeBee\//, ''))

      let runtimeState: PluginRuntimeState = 'UNLOADED'
      if (fiber) {
        runtimeState = (fiber.state as PluginRuntimeState) || 'UNKNOWN'
      } else if (this.failedErrors.has(manifest.id) || (mName ? this.failedErrors.has(mName) : false)) {
        runtimeState = 'FAILED'
      }

      const isEnabled =
        this.overrides[manifest.id] ??
        (mName ? this.overrides[mName] : undefined) ??
        (manifest.enabled ?? true)

      const waitingFor = fiber ? [...fiber.waitingFor] : []
      const errorMsg = this.failedErrors.get(manifest.id) ?? (mName ? this.failedErrors.get(mName) : undefined)

      // Direct dependencies: manifest.dependencies ∪ runtime fiber inject
      const depsSet = new Set<string>()
      for (const d of manifest.dependencies ?? []) {
        depsSet.add(d)
      }

      if (fiber?.inject) {
        for (const inj of fiber.inject) {
          const providerId = serviceProviders.get(inj)
          if (providerId && providerId !== manifest.id && (!mName || providerId !== mName)) {
            depsSet.add(providerId)
          }
        }
      }

      // Configuration status
      const configStatus = this.determineConfigStatus(manifest, currentSettings, settingsContribs)

      rawList.push({
        info: {
          id: manifest.id,
          name: manifest.name || manifest.id,
          displayName: manifest.displayName || manifest.name || manifest.id,
          description: manifest.description,
          version: manifest.version || '0.0.0',
          author: manifest.author,
          systemId: manifest.systemId || 'layer-4',
          moduleId: manifest.moduleId,
          enabled: isEnabled,
          state: runtimeState,
          error: errorMsg,
          waitingFor,
          dependencies: Array.from(depsSet),
          dependents: [], // populated in reverse scan
          configStatus,
        },
        rawDependencies: depsSet,
      })
    }

    // Real-time reverse scan to compute dependents
    const dependentsMap = computeReverseDependents(rawList.map((r) => r.info))
    for (const item of rawList) {
      item.info.dependents = dependentsMap.get(item.info.id) ?? []
    }

    return rawList.map((r) => r.info)
  }

  private determineConfigStatus(
    manifest: PluginManifest,
    settings?: AppSettings,
    contributions: readonly SettingsContribution[] = [],
  ): ConfigStatus {
    const mName = manifest.name
    const mClean = manifest.id.replace(/^@BBeBee\//, '')
    const relatedContribs = contributions.filter(
      (c) =>
        c.id === manifest.id ||
        (mName ? c.id === mName || c.id.startsWith(mName) : false) ||
        c.id.startsWith(mClean) ||
        (manifest.moduleId && c.id.includes(manifest.moduleId)),
    )

    const isKnown =
      KNOWN_CONFIGURABLE_PLUGINS.has(manifest.id) ||
      (mName ? KNOWN_CONFIGURABLE_PLUGINS.has(mName) : false)

    if (!isKnown && relatedContribs.length === 0) {
      return 'none'
    }

    if (!settings) {
      return 'default'
    }

    // Generic schema derivation: if any contribution has a schema, check against schema defaults
    for (const c of relatedContribs) {
      const maybeSchema = c.schema as unknown as { properties?: Record<string, { default?: unknown }> } | undefined
      if (maybeSchema?.properties) {
        let hasCustom = false
        const bag = (settings as unknown as Record<string, unknown>)[c.id] as Record<string, unknown> | undefined
        for (const [propKey, propSchema] of Object.entries(maybeSchema.properties)) {
          if (propSchema && typeof propSchema === 'object' && propSchema.default !== undefined && bag) {
            const currentVal = bag[propKey]
            if (currentVal !== undefined && JSON.stringify(currentVal) !== JSON.stringify(propSchema.default)) {
              hasCustom = true
              break
            }
          }
        }
        if (hasCustom) return 'customized'
      }
    }

    // Compare with default app settings
    if (manifest.id === '@BBeBee/plugin-theme' || manifest.name === '@BBeBee/plugin-theme') {
      return settings.themeId !== DEFAULT_APP_SETTINGS.themeId ? 'customized' : 'default'
    }

    if (manifest.id === '@BBeBee/plugin-now-playing' || manifest.name === '@BBeBee/plugin-now-playing') {
      return settings.nowPlayingStyle !== DEFAULT_APP_SETTINGS.nowPlayingStyle ? 'customized' : 'default'
    }

    if (manifest.id === '@BBeBee/plugin-desktop-lyrics' || manifest.name === '@BBeBee/plugin-desktop-lyrics') {
      const cur = settings.desktopLyrics
      const def = DEFAULT_DESKTOP_LYRICS_SETTINGS
      const isCustom =
        cur.fontSize !== def.fontSize ||
        cur.textColor !== def.textColor ||
        cur.lineMode !== def.lineMode ||
        cur.align !== def.align ||
        cur.opacity !== def.opacity
      return isCustom ? 'customized' : 'default'
    }

    if (manifest.id === '@BBeBee/plugin-visualizer' || manifest.name === '@BBeBee/plugin-visualizer') {
      const cur = settings.visualizer
      const def = DEFAULT_VISUALIZER_SETTINGS
      const isCustom =
        cur.style !== def.style ||
        cur.colorTheme !== def.colorTheme ||
        cur.fftSize !== def.fftSize ||
        cur.sensitivity !== def.sensitivity
      return isCustom ? 'customized' : 'default'
    }

    if (manifest.id === '@BBeBee/plugin-player' || manifest.name === '@BBeBee/plugin-player') {
      const isCustom =
        settings.crossfadeEnabled !== DEFAULT_APP_SETTINGS.crossfadeEnabled ||
        settings.crossfadeDurationSeconds !== DEFAULT_APP_SETTINGS.crossfadeDurationSeconds ||
        settings.gaplessPlayback !== DEFAULT_APP_SETTINGS.gaplessPlayback ||
        settings.loudnessNormalizationEnabled !== DEFAULT_APP_SETTINGS.loudnessNormalizationEnabled
      return isCustom ? 'customized' : 'default'
    }

    if (manifest.id === '@BBeBee/plugin-settings' || manifest.name === '@BBeBee/plugin-settings') {
      const isCustom =
        settings.language !== DEFAULT_APP_SETTINGS.language ||
        settings.closeToTray !== DEFAULT_APP_SETTINGS.closeToTray ||
        Boolean(settings.downloadDir) ||
        Boolean(settings.cacheDir)
      return isCustom ? 'customized' : 'default'
    }

    return 'default'
  }
}

export const name = 'plugin-manager'
export const inject = ['store', 'inspector']

export async function apply(ctx: Context, config?: PluginManagerConfig) {
  ctx.logger.info('plugin-manager: applied')
  const fiber = await ctx.plugin(PluginManagerPlugin, config)
  return () => void fiber.dispose()
}

export default { name, inject, apply }
