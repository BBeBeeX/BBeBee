/**
 * `plugin-manager` — headless plugin manager service.
 *
 * Implements `ctx['plugin-manager']` for runtime state tracking,
 * manifest aggregation, dependency graph analysis, and lifecycle toggling.
 */

import { Service, type Context } from '@BBeBee/kernel'
import { CapabilityGrantLedger } from './grants.js'
import type {
  ConfigStatus,
  DbService,
  HttpService,
  InstalledNpmPluginRecord,
  InstallPlan,
  LocalPluginPreview,
  PluginInfo,
  PluginLifecycleBridge,
  PluginManagerService,
  PluginManifest,
  PluginRuntimeState,
  PluginUpdateInfo,
  ServiceProviderInfo,
  AppSettings,
  RegistryBlockedEntry,
  RegistryPluginEntry,
  SecretsService,
  SecurityAuditContext,
  SettingsContribution,
  StoreService,
} from '@BBeBee/protocol'
import {
  base64ToBytes,
  DEFAULT_APP_SETTINGS,
  DEFAULT_DESKTOP_LYRICS_SETTINGS,
  DEFAULT_VISUALIZER_SETTINGS,
  isCriticalServiceKey,
} from '@BBeBee/protocol'
import {
  compareVersions,
  computeReverseDependents,
  flattenFiberNodes,
  manifestEntryFiles,
  satisfiesRange,
  scanCode,
  shouldScanFile,
} from '@BBeBee/toolkit'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import {
  NPM_AUTH_TOKEN_KEY,
  NPM_REGISTRY_OFFICIAL,
  NpmClient,
  NpmPluginError,
  TARBALL_SIZE_LIMIT_BYTES,
  gitHubRepoIdentity,
  type ExtractedPackage,
  type NpmKvCache,
  type RegistryIndexDocument,
  type ResolvedEntry,
} from './npm.js'

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

/**
 * Outcome of staging one node's rollback material: `ready` carries the
 * verified old package; `unavailable` means no material exists (the old
 * version vanished from npm or the fetch failed — best-effort, as
 * before); `rejected` means bytes WERE downloaded but failed the
 * install checklist — unverified material must never be reinstalled as
 * a "safe" fallback, so callers abort on it.
 */
type RollbackStage =
  | { kind: 'ready'; extracted: ExtractedPackage }
  | { kind: 'unavailable' }
  | { kind: 'rejected'; error: NpmPluginError }

/**
 * preparePackage failure codes that mean "the downloaded bytes failed
 * verification" (as opposed to "the bytes could not be fetched"). As
 * rollback material these abort the operation; as fetch failures they
 * merely leave a node without material.
 */
const ROLLBACK_VERIFICATION_CODES: ReadonlySet<string> = new Set([
  'INTEGRITY_MISMATCH',
  'SPOOF_DETECTED',
  'VERSION_MISMATCH',
  'SECURITY_BLOCKED',
  'TARBALL_INVALID',
  'BINARY_ASSET',
  'PLATFORM_MISMATCH',
  'APP_VERSION_MISMATCH',
])

/** Structural shape of the settings service this plugin reads (the real type is owned by plugin-settings). */
type SettingsHandle = {
  getSync?(): AppSettings
  get?(): Promise<AppSettings>
}

/** Structural shape of the device service this plugin reads. */
type DeviceHandle = { appVersion?: string }

/** Structural shape of the security-audit service this plugin reads. */
type SecurityAuditorHandle = {
  scan(
    content: string,
    context?: SecurityAuditContext,
  ): { level: string; findings: Array<{ message: string }> }
}

/**
 * The collaborator handles the plugin-manager captured under its own
 * scope at init. Kept in a plain object on the service (see the `own`
 * field): a plain object carries no Cordis tracker and passes through
 * every traceable proxy untouched, so the handles inside keep the
 * context binding they were captured with.
 */
interface OwnHandles {
  http?: HttpService
  settings?: SettingsHandle
  secrets?: SecretsService
  device?: DeviceHandle
  auditor?: SecurityAuditorHandle
  store?: StoreService
}

/**
 * Reads one of the plugin's own collaborator handles: the init-time
 * capture if it has landed, otherwise a read off the plugin's OWN
 * context (which, for hosts without a Cordis lifecycle, is simply the
 * host context those hosts intend; a real shell's captures land
 * first, and a miss here is contained as "unavailable").
 *
 * A module-level function — NOT a service method — on purpose: any
 * tracker-carrying value RETURNED from a method invoked through
 * Cordis's traceable proxy is re-wrapped against the caller's context
 * (`getTraceable` on the way out), including internal `this.m()`
 * calls, so a handle that travels out of a method arrives re-bound to
 * whoever invoked it. A plain function's return crosses no proxy
 * boundary, and its arguments are never re-traced either — the handle
 * reaches the call site with its capture-time binding intact.
 */
function ownService<T>(
  own: OwnHandles,
  ownCtx: Context,
  key: string,
  holderKey: keyof OwnHandles = key as keyof OwnHandles,
): T | undefined {
  const captured = own[holderKey] as T | undefined
  if (captured) return captured
  try {
    return (ownCtx as unknown as Record<string, unknown>)[key] as T | undefined
  } catch {
    return undefined
  }
}

export interface PluginManagerConfig {
  manifests?: Record<string, PluginManifest>
  /**
   * Which app target this instance runs on, for registry `platforms`
   * filtering. Set by the composition root
   * (`'@bbebee/plugin-manager': { config: { platform: 'desktop' } }`).
   * Absent means "unknown" — `browseRegistry()` then returns unfiltered.
   */
  platform?: 'desktop' | 'mobile'
}

/** First automatic update check after boot; the interval is daily. */
const UPDATE_CHECK_DELAY_MS = 60_000
const UPDATE_CHECK_INTERVAL_MS = 24 * 3600 * 1000

const KNOWN_CONFIGURABLE_PLUGINS = new Set([
  '@bbebee/plugin-settings',
  '@bbebee/plugin-player',
  '@bbebee/plugin-theme',
  '@bbebee/plugin-now-playing',
  '@bbebee/plugin-desktop-lyrics',
  '@bbebee/plugin-visualizer',
  '@bbebee/plugin-dsp',
])

export class PluginManagerPlugin extends Service implements PluginManagerService {
  static override readonly name = 'plugin-manager'
  static readonly inject = ['store', 'inspector']

  private readonly manifests = new Map<string, PluginManifest>()
  private overrides: Record<string, boolean> = {}
  private readonly failedErrors = new Map<string, string>()
  private bridge?: PluginLifecycleBridge
  private readonly platform?: 'desktop' | 'mobile'
  private npmClientInstance?: NpmClient
  private grantLedgerInstance?: CapabilityGrantLedger

  /**
   * This plugin's own context, stashed in the constructor. Service
   * methods invoked through Cordis's traceable proxy see `this.ctx`
   * as the CALLER's context (the proxy's `ctx` property is the
   * accessing context by design), so the constructor's `ctx` — this
   * plugin's own fiber context — is kept under a different name.
   * A context value carries no service tracker, so reading this field
   * through any proxy yields the context itself, never a re-bound
   * wrapper.
   */
  private readonly ownCtx: Context

  /**
   * This service's OWN handles to the npm surface's collaborators,
   * captured at init under this plugin's inject scope (see
   * `captureOwnService`) — held in a PLAIN object, deliberately.
   *
   * A service handle is a traceable proxy bound to the context it was
   * obtained through, and Cordis re-traces any tracker-carrying value
   * that crosses a traceable boundary — read as a field through
   * another service's proxy, or returned from a method invoked
   * through one — against the ACCESSING context. The capability gate
   * resolves its config from exactly that context
   * (`Service.resolveConfig`), so a handle stored as a direct field
   * of this service was silently re-bound to whoever invoked the
   * method: the market UI's empty grants judged the manager's
   * registry-index fetch (`… may not reach raw.githubusercontent.com`,
   * field logs 2026-10-20), and a caller's store namespace received
   * this service's records. A plain object has no tracker and passes
   * through every proxy untouched, so handles inside it keep the
   * binding they were captured with: the operation is judged as the
   * plugin that owns it, whoever invoked the method. (The grant
   * ledger and the NpmClient were never affected — plain objects
   * too.)
   */
  private readonly own: OwnHandles = {}
  /**
   * Ids confirmed delisted by the liveness check (audit W3): the
   * registry index was fetched successfully and did not contain them.
   * Mirrors the persisted `delisted` flag on the install records.
   */
  private delistedIds = new Set<string>()

  /**
   * Ids the registry has actively banned (audit W5): id → the
   * registry's reason. Mirrors the persisted `blocked` field on the
   * install records; populated from the index's blocked channel by the
   * liveness refresh and seeded from the records at init.
   */
  private blockedIds = new Map<string, string>()

  /**
   * Ids whose installed version's npm provenance attestation names
   * the registry entry's repo as its source (audit W6). Mirrors the
   * persisted `provenanceVerified` flag on the install records;
   * seeded from the records at init and maintained by every install /
   * update that flows through activatePrepared.
   */
  private provenanceVerifiedIds = new Set<string>()

  /**
   * The user's provider choices for replaceable service keys
   * (audit W5): key → active provider manifest id. Persisted in this
   * service's store under `service-providers`; the desktop boot reads
   * the same snapshot key to filter its enablement map.
   */
  private providerSelection = new Map<string, string>()

  /** Ids present in the npm install records (vs built-in manifests). */
  private installedNpmIds = new Set<string>()

  /**
   * The capability-grant ledger, bound to this service's OWN `db` handle.
   *
   * The handle is captured at init (see `[Service.init]`), under this
   * service's own capability scope (`db:read:core`/`db:write:core` from
   * its manifest) — never read off `this.ctx` at call time, where the
   * context belongs to whoever invoked the method and the write would be
   * judged against *their* grants (the plugin-sources lesson). The lazy
   * fallback below only fires in hosts that drive the service without a
   * Cordis lifecycle (unit tests, the pilot harness): there `this.ctx`
   * is the host's own context, which is exactly the handle those hosts
   * intend. In a real shell the init capture always lands first — `db`
   * is a bootstrap service and installs happen after boot.
   */
  private grantLedger(): CapabilityGrantLedger | undefined {
    if (this.grantLedgerInstance) return this.grantLedgerInstance
    let db: DbService | undefined
    try {
      db = (this.ownCtx as unknown as Record<string, unknown>)['db'] as DbService | undefined
    } catch {
      db = undefined
    }
    if (db) {
      this.grantLedgerInstance = new CapabilityGrantLedger(db)
    }
    return this.grantLedgerInstance
  }

  constructor(ctx: Context, config?: PluginManagerConfig) {
    super(ctx, 'plugin-manager')
    this.ownCtx = ctx
    this.platform = config?.platform
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
    try {
      const saved = await this.ctx.store.get<Record<string, string>>('service-providers')
      if (saved) this.providerSelection = new Map(Object.entries(saved))
    } catch {
      // Selection is an optimisation over the default rule; losing it
      // only means the built-in providers win again.
    }

    // Seed the in-memory delisted set from the persisted flags so list()
    // and the update paths honour a previous session's liveness verdict
    // from the start. The boot-time refresh below revalidates it.
    try {
      const records = await this.loadInstalledRecords()
      for (const rec of Object.values(records)) {
        if (rec.delisted) this.delistedIds.add(rec.id)
        if (rec.blocked !== undefined) this.blockedIds.set(rec.id, rec.blocked)
        if (rec.provenanceVerified) this.provenanceVerifiedIds.add(rec.id)
      }
    } catch {
      // Store unavailable — flags reload with the first liveness refresh.
    }
    // Revalidate liveness shortly after boot (the index fetch reuses the
    // 24h index cache). Fire-and-forget and fully guarded inside: an
    // unreachable index changes nothing.
    void this.refreshDelistedFromIndex().catch(() => {})

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

    // Capture this service's own db handle for the capability-grant
    // ledger as soon as the db service is available. The inject callback
    // runs under this service's own scope, so the ledger's statements are
    // judged against plugin-manager's grants — see `grantLedger()`.
    const offDb = this.ctx.inject(['db'], (scoped) => {
      const db = (scoped as unknown as { db?: DbService }).db
      this.grantLedgerInstance = db ? new CapabilityGrantLedger(db) : undefined
      return () => {
        this.grantLedgerInstance = undefined
      }
    })

    // Capture the npm surface's collaborators under this service's own
    // scope too, for the same reason as the ledger's db handle: every
    // read of them happens at call time, under the *caller's* scope —
    // the settings page's fiber, or no fiber at all for the bare
    // update-check timer — where a raw `this.ctx.<key>` read throws
    // `cannot get property "http" without inject`. See captureOwnService.
    const offHttp = this.captureOwnService<HttpService>('http', (v) => {
      this.own.http = v
    })
    const offSettings = this.captureOwnService<SettingsHandle>('settings', (v) => {
      this.own.settings = v
    })
    const offSecrets = this.captureOwnService<SecretsService>('secrets', (v) => {
      this.own.secrets = v
    })
    const offDevice = this.captureOwnService<DeviceHandle>('device', (v) => {
      this.own.device = v
    })
    const offAuditor = this.captureOwnService<SecurityAuditorHandle>('securityAudit', (v) => {
      this.own.auditor = v
    })
    // The store is mediated too — not gated, but namespaced by the
    // caller's scope (`storageNamespace(resolveConfig())` in the store
    // implementations). Call-time `this.ctx.store` reads from a foreign
    // scope would land this service's npm cache / install records in
    // the CALLER's namespace, so it is captured into the same holder
    // and read through the module-level `ownService()` like every
    // other collaborator.
    const offStore = this.captureOwnService<StoreService>('store', (v) => {
      this.own.store = v
    })

    // Automatic npm update check (D9): once shortly after boot when the last
    // check is older than 24h, then every 24h. Quiet by design — failures
    // only log. Timers are unref'd (no-op in browsers) so tests and
    // short-lived contexts are never held open, and cleared on dispose.
    const timers: Array<ReturnType<typeof setTimeout>> = []
    const detach = (t: ReturnType<typeof setTimeout>): void => {
      ;(t as unknown as { unref?: () => void }).unref?.()
      timers.push(t)
    }
    const runCheck = (): void => {
      this.checkUpdates().catch((err) => {
        this.ctx.logger.warn(
          `plugin-manager: automatic update check failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }
    try {
      const lastCheck = (await this.ctx.store.get<number>('npm:last-update-check')) ?? 0
      if (Date.now() - lastCheck > UPDATE_CHECK_INTERVAL_MS) {
        detach(
          setTimeout(() => {
            runCheck()
            detach(setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS))
          }, UPDATE_CHECK_DELAY_MS),
        )
      } else {
        detach(setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS))
      }
    } catch {
      // Store unavailable — skip the automatic check; manual still works.
    }

    return () => {
      off1()
      off2()
      off3()
      void (offDb as unknown as { dispose?: () => Promise<void> }).dispose?.()
      for (const off of [offHttp, offSettings, offSecrets, offDevice, offAuditor, offStore]) {
        void (off as unknown as { dispose?: () => Promise<void> }).dispose?.()
      }
      for (const t of timers) {
        clearTimeout(t)
        clearInterval(t as unknown as ReturnType<typeof setInterval>)
      }
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

  /**
   * Host-shared module versions, reported by the composition root
   * (`setHostVersions` in `wirePluginManager`): npm package name → the
   * version the shell actually loaded, e.g. `{ react: '19.2.3',
   * 'react-dom': '19.2.3' }` read off the loaded React itself. The single
   * source of truth stays with the host (`host-modules.manifest.ts` on
   * desktop); this service only consumes the fact for the install-plan
   * peer check below. Empty until wired — platforms without host-module
   * sharing (mobile) simply never report, and the peer check stays off.
   */
  private hostVersions: Record<string, string> = {}

  setHostVersions(versions: Record<string, string>): void {
    this.hostVersions = { ...versions }
  }

  private async loadOverrides(): Promise<Record<string, boolean>> {
    try {
      const result = await ownService<StoreService>(this.own, this.ownCtx, 'store')?.get<Record<string, boolean>>('enabled')
      return result ?? {}
    } catch {
      return {}
    }
  }

  private async saveOverrides(overrides: Record<string, boolean>): Promise<void> {
    await ownService<StoreService>(this.own, this.ownCtx, 'store')?.set('enabled', overrides)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const m = this.manifests.get(id)
    // Critical-provider lock (audit W5): a plug-in whose manifest
    // declares a critical service key can never be switched off — a
    // substitute provider for those keys would compromise the system,
    // and the settings UI mirrors this by disabling the toggle. The
    // check runs on the manifest itself (the runtime ground truth),
    // so no caller can route around the settings page to unlock it.
    if (!enabled && m) {
      const critical = (m.contributes?.services ?? []).filter((s) => isCriticalServiceKey(s))
      if (critical.length > 0) {
        throw new NpmPluginError(
          'CRITICAL_PROVIDER',
          `插件 "${id}" 提供关键服务（${critical.join('、')}），不可关闭`,
        )
      }
    }
    this.overrides[id] = enabled
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

  // -------------------------------------------------------------------------
  // Provider arbitration for replaceable service keys (audit W5)
  // -------------------------------------------------------------------------

  /** Service key → provider manifest ids, from the registered manifests. */
  private providersByKey(): Map<string, string[]> {
    const byKey = new Map<string, string[]>()
    for (const m of this.manifests.values()) {
      if (!m.entry.main) continue
      for (const key of m.contributes?.services ?? []) {
        const arr = byKey.get(key) ?? []
        arr.push(m.id)
        byKey.set(key, arr)
      }
    }
    return byKey
  }

  /**
   * The provider in effect for `key`: the persisted choice when it
   * names an enabled provider, else an enabled built-in provider,
   * else the first enabled provider — the same rule the desktop boot
   * applies to its enablement map (resolveActiveProviders).
   */
  private isEnabledId(id: string): boolean {
    const m = this.manifests.get(id)
    return m ? this.isEnabled(m) : false
  }

  private activeProviderFor(key: string, providers: readonly string[]): string | undefined {
    const enabled = providers.filter((id) => this.isEnabledId(id))
    if (enabled.length === 0) return undefined
    const chosen = this.providerSelection.get(key)
    if (chosen && enabled.includes(chosen)) return chosen
    return enabled.find((id) => !this.installedNpmIds.has(id)) ?? enabled[0]
  }

  listServiceProviders(): ServiceProviderInfo[] {
    const out: ServiceProviderInfo[] = []
    for (const [key, providers] of this.providersByKey()) {
      if (providers.length < 2) continue
      const sorted = [...providers].sort()
      out.push({
        key,
        critical: isCriticalServiceKey(key),
        providers: sorted,
        activeProvider: this.activeProviderFor(key, sorted),
      })
    }
    return out.sort((a, b) => a.key.localeCompare(b.key))
  }

  private async saveProviderSelection(): Promise<void> {
    await ownService<StoreService>(this.own, this.ownCtx, 'store')?.set('service-providers', Object.fromEntries(this.providerSelection))
  }

  async setServiceProvider(key: string, providerId: string): Promise<void> {
    if (isCriticalServiceKey(key)) {
      throw new NpmPluginError(
        'CRITICAL_PROVIDER',
        `服务 "${key}" 是关键服务，其提供者不可替换`,
      )
    }
    const providers = this.providersByKey().get(key) ?? []
    if (!providers.includes(providerId)) {
      throw new NpmPluginError(
        'NOT_A_PROVIDER',
        `插件 "${providerId}" 不是服务 "${key}" 的提供者（候选：${providers.join('、') || '无'}）`,
      )
    }
    this.providerSelection.set(key, providerId)
    await this.saveProviderSelection()
    // Runtime coordination is best-effort: disable the other enabled
    // providers of this key and make sure the chosen one is on. The
    // persisted selection + boot filter are the authoritative path —
    // a provider that refuses to unload here is still held off at the
    // next start, and the one that stays loaded keeps serving alone.
    for (const other of providers) {
      if (other !== providerId && this.isEnabledId(other)) {
        try {
          await this.setEnabled(other, false)
        } catch (err) {
          this.ctx.logger.warn(
            `plugin-manager: provider switch for "${key}": failed to disable "${other}": ${String(err)}`,
          )
        }
      }
    }
    if (!this.isEnabledId(providerId)) {
      await this.setEnabled(providerId, true)
    }
    this.ctx.emit('plugin-manager/changed')
  }

  /**
   * Install/update preemption (audit W5): a package about to activate
   * takes over every replaceable key it provides. Providers currently
   * holding such a key are unloaded (their records and enabled
   * overrides stay untouched — the persisted selection, applied at
   * boot, is what keeps them from colliding next start) and the
   * selection is rewritten to the newcomer. Critical keys never reach
   * here as takeovers: claiming one with an incumbent provider is
   * refused in preparePackage.
   */
  private async preemptConflictingProviders(newManifests: readonly PluginManifest[]): Promise<void> {
    let changed = false
    for (const m of newManifests) {
      for (const key of m.contributes?.services ?? []) {
        if (isCriticalServiceKey(key)) continue
        for (const other of this.manifests.values()) {
          if (other.id === m.id || !other.entry.main) continue
          if (!(other.contributes?.services ?? []).includes(key)) continue
          if (!this.isEnabled(other)) continue
          this.providerSelection.set(key, m.id)
          changed = true
          this.ctx.logger.warn(
            `plugin-manager: "${m.id}" takes over service "${key}" from "${other.id}" (provider selection)`,
          )
          try {
            await this.bridge?.unloadPlugin(other.id)
          } catch {
            // Best-effort for this session; the selection + boot
            // filter keep the two from colliding at the next start.
          }
        }
      }
    }
    if (changed) {
      await this.saveProviderSelection()
      this.ctx.emit('plugin-manager/changed')
    }
  }

  refresh(): readonly PluginInfo[] {
    return this.list()
  }

  async uninstall(id: string): Promise<void> {
    const dependents = this.list().find((p) => p.id === id)?.dependents ?? []
    if (dependents.length > 0) {
      throw new NpmPluginError(
        'HAS_DEPENDENTS',
        `无法卸载 "${id}"：以下已安装插件依赖它：${dependents.join('、')}。请先卸载它们。`,
      )
    }

    if (this.bridge?.uninstallPlugin) {
      await this.bridge.uninstallPlugin(id)
    } else if (this.bridge?.unloadPlugin) {
      await this.bridge.unloadPlugin(id)
    }

    const m = this.manifests.get(id)
    this.manifests.delete(id)
    if (m?.name) {
      this.manifests.delete(m.name)
      delete this.overrides[m.name]
    }
    delete this.overrides[id]
    this.failedErrors.delete(id)
    if (m?.name) {
      this.failedErrors.delete(m.name)
    }

    await this.saveOverrides(this.overrides)

    // The grant dies with the install: a plugin that is installed again
    // later must be approved again through that install, not silently
    // resurrect the capabilities a previous install was granted.
    const ledger = this.grantLedger()
    if (ledger) {
      try {
        await ledger.revoke(id)
      } catch {
        // Best-effort like the lock cleanup below; the files are gone,
        // and a stale grant for a plugin that is not installed loads
        // nothing — the loader only consults it for configured plugins.
      }
    }

    try {
      const records = await this.loadInstalledRecords()
      if (records[id]) {
        delete records[id]
        await this.saveInstalledRecords(records)
      }
    } catch {
      // Lock record cleanup is best-effort; the files are already gone.
    }
    this.provenanceVerifiedIds.delete(id)

    this.ctx.emit('plugin-manager/changed')
  }

  // ---------------------------------------------------------------------------
  // npm-based plugin management (registry browse → npm download → install)
  // ---------------------------------------------------------------------------

  /**
   * Reads a service straight off the context. Cordis exposes provided
   * services as context properties; this avoids `reflect` so the lookup
   * also works with structurally-assigned test doubles (same pattern as the
   * `inspector` read in `list()`).
   *
   * ⚠️ On a scoped context this read is judged against the *executing
   * fiber's* inject declarations and THROWS (`cannot get property "…"
   * without inject`) when the service is not reachable from the
   * caller's scope — it is only safe from this plugin's own scope, or
   * from a root context. Call-time reads of collaborators therefore go
   * through the captured handles below, never through this directly.
   */
  private ctxService<T>(key: string): T | undefined {
    return (this.ctx as unknown as Record<string, unknown>)[key] as T | undefined
  }

  /**
   * Captures one collaborator under this service's OWN inject scope at
   * init — the same move the capability-grant ledger makes for `db`.
   *
   * The npm surface's methods are invoked from foreign scopes: the
   * settings page's fiber (which injects `plugin-manager`, not `http`)
   * and the bare `setTimeout`/`setInterval` of the automatic update
   * check (no fiber at all). A raw `this.ctx.<key>` read in those
   * scopes is judged against the caller's inject declarations and
   * throws `cannot get property "http" without inject`, even though
   * the service is right there — unit tests never saw it because they
   * drive the service from the root context, where the read always
   * resolves. Registering `ctx.inject([key])` at init pins the handle
   * under this plugin's own scope; the handle is stored in the plain
   * `own` holder and read back through the module-level `ownService()`
   * — never through a method return, which Cordis would re-bind to
   * the invoking caller (see `ownService()`). Returns the inject
   * fiber for disposal.
   */
  private captureOwnService<T>(key: string, set: (value: T | undefined) => void): unknown {
    return this.ownCtx.inject([key], (scoped) => {
      set((scoped as unknown as Record<string, T | undefined>)[key])
      return () => set(undefined)
    })
  }



  private async readAppSettings(): Promise<AppSettings | undefined> {
    try {
      const svc = ownService<SettingsHandle>(this.own, this.ownCtx, 'settings')
      return svc?.getSync?.() ?? (await svc?.get?.().catch(() => undefined))
    } catch {
      return undefined
    }
  }

  private getAppVersion(): string | undefined {
    try {
      return ownService<DeviceHandle>(this.own, this.ownCtx, 'device')?.appVersion ?? undefined
    } catch {
      return undefined
    }
  }

  private getNpmClient(): NpmClient {
    if (!this.npmClientInstance) {
      const http = ownService<HttpService>(this.own, this.ownCtx, 'http')
      if (!http) {
        throw new NpmPluginError('SERVICE_UNAVAILABLE', 'plugin-manager 需要 "http" 服务，但它不可用')
      }
      const cache: NpmKvCache = {
        get: async <T>(key: string): Promise<{ value: T; fetchedAt: number } | undefined> =>
          ((await ownService<StoreService>(this.own, this.ownCtx, 'store')?.get<{ value: unknown; fetchedAt: number }>(`npm:${key}`)) as
            | { value: T; fetchedAt: number }
            | undefined) ?? undefined,
        set: async (key, value) => {
          await ownService<StoreService>(this.own, this.ownCtx, 'store')?.set(`npm:${key}`, { value, fetchedAt: Date.now() })
        },
      }
      this.npmClientInstance = new NpmClient({
        http,
        readSettings: () => this.readAppSettings(),
        readSecret: async (key) => {
          try {
            return (await ownService<SecretsService>(this.own, this.ownCtx, 'secrets')?.get(key)) ?? undefined
          } catch {
            return undefined
          }
        },
        cache,
        log: this.ctx.logger,
      })
    }
    return this.npmClientInstance
  }

  private async loadInstalledRecords(): Promise<Record<string, InstalledNpmPluginRecord>> {
    try {
      const records =
        (await ownService<StoreService>(this.own, this.ownCtx, 'store')?.get<Record<string, InstalledNpmPluginRecord>>('npm:installed')) ?? {}
      this.installedNpmIds = new Set(Object.keys(records))
      return records
    } catch {
      return {}
    }
  }

  private async saveInstalledRecords(records: Record<string, InstalledNpmPluginRecord>): Promise<void> {
    await ownService<StoreService>(this.own, this.ownCtx, 'store')?.set('npm:installed', records)
  }

  /**
   * Whether a manifest's plugin currently counts as enabled: the user's
   * persisted override wins, then the manifest's own default. Mirrors the
   * `enabled` computation in `list()` so the install gate and the plugin
   * list never disagree about who is on.
   */
  private isEnabled(manifest: PluginManifest): boolean {
    return (
      this.overrides[manifest.id] ??
      (manifest.name ? this.overrides[manifest.name] : undefined) ??
      (manifest.enabled ?? true)
    )
  }

  /**
   * Service keys with at least one *enabled* provider among the known
   * manifests (core + builtin + shell declaration + installed). A service
   * whose providers are all disabled is NOT available: the provider will
   * not be running when the new plugin activates, so counting it would
   * wave an install through that then fails against a missing service.
   * Multi-provider keys stay available while any one provider is enabled.
   */
  private availableServiceKeys(): Set<string> {
    const keys = new Set<string>()
    const seen = new Set<string>()
    for (const m of this.manifests.values()) {
      // registerManifests also keys a manifest by name; count each once.
      if (seen.has(m.id)) continue
      seen.add(m.id)
      if (!this.isEnabled(m)) continue
      for (const s of m.contributes?.services ?? []) keys.add(s)
    }
    return keys
  }

  async browseRegistry(force = false): Promise<RegistryPluginEntry[]> {
    const entries = await this.getNpmClient().fetchIndex(force ? { force: true } : undefined)
    return this.platform ? entries.filter((e) => e.platforms.includes(this.platform!)) : entries
  }

  /**
   * Shared resolve used by `resolveInstallPlan` and `installPlugin`:
   * version pinning + dependency closure (entries retained for checks).
   */
  private async planInstall(
    id: string,
    range?: string,
  ): Promise<{ plan: InstallPlan; nodes: ResolvedEntry[]; index: RegistryPluginEntry[] }> {
    const client = this.getNpmClient()
    let doc = await client.fetchIndexDocument()
    let index = doc.entries
    let entry = index.find((e) => e.id === id)
    if (!entry) {
      // The index is cached for 24h and its CDN sources lag the registry
      // repo besides, so a just-published entry can be missing from the
      // cached copy — the real machine reported the freshly onboarded
      // catppuccin theme as "no such entry" minutes after the registry
      // push (2026-10-22). One forced refetch before concluding the id
      // does not exist; a genuine miss still errors, just against the
      // live index.
      doc = await client.fetchIndexDocument({ force: true })
      index = doc.entries
      entry = index.find((e) => e.id === id)
    }
    if (!entry) {
      throw new NpmPluginError('ENTRY_NOT_FOUND', `registry 中没有 id 为 "${id}" 的插件条目`)
    }
    if (this.platform && !entry.platforms.includes(this.platform)) {
      throw new NpmPluginError(
        'PLATFORM_MISMATCH',
        `插件 "${id}" 不支持当前平台（${this.platform}），其 platforms 为 [${entry.platforms.join(', ')}]`,
      )
    }
    const { target, closure } = await client.resolveTree(entry, range, index)
    const nodes = [...closure, target]

    const warnings: string[] = []
    const appVersion = this.getAppVersion()
    if (appVersion) {
      if (entry.minAppVersion && compareVersions(appVersion, entry.minAppVersion) < 0) {
        throw new NpmPluginError(
          'APP_VERSION_MISMATCH',
          `插件 "${id}" 要求应用版本 >= ${entry.minAppVersion}，当前为 ${appVersion}`,
        )
      }
    } else {
      warnings.push('无法获取应用版本，已跳过 minAppVersion/engines 兼容性检查')
    }
    for (const n of nodes) {
      if (!n.pkg.integrity) warnings.push(`包 ${n.pkg.npm}@${n.pkg.version} 缺少 integrity，将跳过完整性校验`)
    }
    // Reviewed-pin transparency (audit W5): say plainly when the plan
    // installs something the registry has not reviewed, and when a
    // range landed BELOW the reviewed version (its bytes are then only
    // vouched for by the packument, not by the registry pin).
    for (const n of nodes) {
      if (n.pkg.unreviewed) {
        warnings.push(
          `包 ${n.pkg.npm}@${n.pkg.version} 未经注册表审核（已审版本为 ${n.entry.reviewedVersion}）：这是显式指定的版本，安装前请再次确认`,
        )
      } else if (n.entry.reviewedVersion && n.pkg.version !== n.entry.reviewedVersion) {
        warnings.push(
          `包 ${n.pkg.npm} 的注册表已审版本为 ${n.entry.reviewedVersion}，本次按版本约束选中 ${n.pkg.version}，其完整性以 npm 元数据为准`,
        )
      }
    }
    // P2 version contract: a package's declared `peerDependencies` that
    // intersect the host-shared modules (react / react-dom on desktop) are
    // checked against the versions the shell actually provides. A mismatch
    // only warns — it never blocks the install: peer ranges are an
    // authoring contract, not a security gate, and a UI that still fails
    // against the shared React is isolated by the loader (headless keeps
    // running). Peer entries the host does not share are the author's own
    // business and are ignored, as are ranges too malformed to judge.
    for (const n of nodes) {
      for (const [peerName, peerRange] of Object.entries(n.peerDependencies ?? {})) {
        const hostVersion = this.hostVersions[peerName]
        if (!hostVersion) continue
        if (!/[\d*xX]/.test(peerRange)) continue
        if (!satisfiesRange(hostVersion, peerRange)) {
          warnings.push(
            `包 ${n.pkg.npm}@${n.pkg.version} 声明 peer ${peerName} "${peerRange}"，但宿主提供的是 ${hostVersion}：插件 UI 可能无法正常渲染（不影响安装）`,
          )
        }
      }
    }

    // D8-1 (pre-download estimate): required services vs currently known manifests.
    const available = this.availableServiceKeys()
    // The closure's own declared `provides` count toward the estimate:
    // a service supplied by a package this install is about to bring in
    // is available once the install completes. This stays an estimate
    // from registry declarations — installPlugin re-verifies against
    // the downloaded packages' real manifests before activating.
    for (const n of nodes) {
      for (const s of n.entry.provides ?? []) available.add(s)
    }
    // A banned id anywhere in the closure refuses the plan outright
    // (audit W5) — before any service estimation or download. The ban
    // check reads THIS fetch's blocked channel (a not-yet-installed id
    // has no record to seed the in-memory map from), plus the map for
    // bans learned earlier this session.
    this.assertNotBlocked(
      nodes.map((n) => n.pkg),
      new Map(doc.blocked.map((b) => [b.id, b.reason] as const)),
    )
    const needed = new Set<string>()
    for (const n of nodes) for (const s of n.entry.services) needed.add(s)
    const missingServices = [...needed].filter((s) => !available.has(s))

    return {
      plan: {
        target: target.pkg,
        closure: closure.map((n) => n.pkg),
        missingServices,
        warnings,
      },
      nodes,
      index,
    }
  }

  async resolveInstallPlan(id: string, range?: string): Promise<InstallPlan> {
    return (await this.planInstall(id, range)).plan
  }

  /**
   * Plan/execute binding: an {@link InstallPlan} the user confirmed is a
   * pinned closure list (per node: id + npm + version + integrity).
   * Execution re-resolves exactly once and compares the fresh resolution
   * against that list node by node; any drift (a new version published
   * between the confirm screen and the click, a swapped integrity) aborts
   * with PLAN_CHANGED instead of silently installing something else than
   * what was confirmed. The tarball URL is deliberately NOT compared —
   * it legitimately varies by mirror; the integrity pins the content.
   */
  private assertPlanUnchanged(expected: InstallPlan, actual: InstallPlan): void {
    const pin = (p: InstallPlan): Map<string, string> =>
      new Map(
        [p.target, ...p.closure].map(
          (n) =>
            [
              n.id,
              `${n.npm}@${n.version}#${n.integrity ?? ''}${n.unreviewed ? '#unreviewed' : ''}`,
            ] as const,
        ),
      )
    const expectedPins = pin(expected)
    const actualPins = pin(actual)
    const drift: string[] = []
    for (const [id, pinStr] of expectedPins) {
      const now = actualPins.get(id)
      if (now === undefined) {
        drift.push(`"${id}" 不再被解析到`)
      } else if (now !== pinStr) {
        drift.push(`"${id}" 由 ${pinStr} 变为 ${now}`)
      }
    }
    for (const id of actualPins.keys()) {
      if (!expectedPins.has(id)) drift.push(`新增了未确认的依赖 "${id}"`)
    }
    if (drift.length > 0) {
      throw new NpmPluginError(
        'PLAN_CHANGED',
        `安装计划已变化，与确认时不一致，已中止安装：${drift.join('；')}。请重新打开确认页核对后再安装。`,
      )
    }
  }

  /**
   * Downloads, verifies (D5/D7/D8) and security-scans one resolved package.
   * Throws a named `NpmPluginError` on any checklist failure.
   */
  private async preparePackage(
    client: NpmClient,
    node: ResolvedEntry,
    installedRecords: Record<string, InstalledNpmPluginRecord>,
  ): Promise<ExtractedPackage> {
    const { entry, pkg } = node
    const label = `${pkg.npm}@${pkg.version}`
    let bytes: Uint8Array
    try {
      bytes = await client.downloadPackage(pkg)
      client.verifyIntegrity(bytes, pkg.integrity, label)
      // Audit W5: when the resolved version is the registry's reviewed
      // version, the bytes must ALSO match the registry-pinned hash —
      // an anchor the npm mirror cannot rewrite along with its packument.
      if (entry.reviewedIntegrity && entry.reviewedVersion && pkg.version === entry.reviewedVersion) {
        client.verifyReviewedIntegrity(bytes, entry, label)
      }
    } catch (err) {
      // Mirror-aware download proved ineffective: retry through the
      // entry's npmUrl (canonical official address). Anything the
      // fallback cannot recover rethrows with both attempts reported.
      bytes = await this.downloadViaNpmUrlFallback(client, node, label, err)
    }
    // Provenance (audit W6): when npm carries a provenance attestation
    // for this exact version, the source repository it names must be
    // the repo the registry entry points at — an attestation naming a
    // different repo proves the bytes were built somewhere the entry
    // does not disclose, which is spoofing with paperwork, and is
    // refused like every other identity mismatch. NO attestation is
    // not a refusal in the pilot: official packages are being
    // re-published with provenance, so an official entry without one
    // earns a warning, not a block; an unreachable attestations
    // endpoint degrades like any other registry read (warn, proceed).
    const provenance = await client.checkProvenance(pkg, entry.repo)
    if (provenance.status === 'mismatch') {
      throw new NpmPluginError(
        'SPOOF_DETECTED',
        `包 ${label} 的 npm 出处证明（provenance）来源仓库为 "${provenance.sourceRepo}"，与 registry 条目 repo "${entry.repo}" 不符，拒绝安装（防冒充）`,
      )
    }
    if (provenance.status === 'none' && gitHubRepoIdentity(entry.repo)?.startsWith('bbebeex/')) {
      this.ctx.logger.warn(
        `plugin-manager: 官方包 ${label} 暂无 npm 出处证明（provenance），试点期仅警告不拦截；官方包带 provenance 重发后此项将收紧为拒绝`,
      )
    } else if (provenance.status === 'unknown') {
      this.ctx.logger.warn(`plugin-manager: 无法获取 ${label} 的 npm 出处证明（网络不可达），按降级口径放行`)
    }
    const extracted = client.extractPackage(pkg, bytes)
    if (provenance.status === 'verified') extracted.provenanceVerified = true
    return this.verifyExtractedPackage(node, extracted, installedRecords)
  }

  /**
   * Fallback leg for a mirror-aware download that proved ineffective.
   * Re-resolves the plan's exact version through the entry's npmUrl
   * (canonical official packument address) and downloads the official
   * tarball, verifying it against the OFFICIAL packument integrity
   * (plus the reviewed pin when applicable) — so a mirror that is
   * down, slow, or serving bytes that fail verification cannot block
   * an install the official registry can still serve.
   *
   * Attempted only when all three hold: the primary failure is a
   * download or integrity failure (a size-limit refusal or a later
   * checklist failure is not a mirror problem), the entry carries an
   * npmUrl, and the primary tarball did not already come from the
   * official registry (retrying the same source cannot help; an
   * unparseable primary pointer counts as non-official — that is
   * exactly the poisoned-packument-pointer recovery). One fallback
   * attempt only: its failure reports both attempts, its success is
   * logged as a warning so the mirror problem stays visible.
   */
  private async downloadViaNpmUrlFallback(
    client: NpmClient,
    node: ResolvedEntry,
    label: string,
    primaryErr: unknown,
  ): Promise<Uint8Array> {
    const { entry, pkg } = node
    const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
    const fallbackable =
      primaryErr instanceof NpmPluginError &&
      (primaryErr.code === 'DOWNLOAD_FAILED' || primaryErr.code === 'INTEGRITY_MISMATCH')
    if (!fallbackable || !entry.npmUrl) throw primaryErr
    let primaryIsOfficial = false
    try {
      primaryIsOfficial = new URL(pkg.tarball).host === new URL(NPM_REGISTRY_OFFICIAL).host
    } catch {
      // Unparseable primary pointer counts as non-official: the official
      // leg is exactly the recovery for a poisoned packument pointer.
    }
    if (primaryIsOfficial) throw primaryErr
    let official: { tarball: string; integrity?: string }
    try {
      official = await client.resolveOfficialTarball(entry, pkg.version)
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      throw new NpmPluginError(
        'DOWNLOAD_FAILED',
        `下载 ${label} 失败：镜像源失败（${primaryMsg}），改用条目 npmUrl 官方地址解析也失败（${fallbackMsg}）`,
      )
    }
    let bytes: Uint8Array
    try {
      bytes = await client.downloadPackage({
        ...pkg,
        tarball: official.tarball,
        integrity: official.integrity,
      })
      client.verifyIntegrity(bytes, official.integrity, label)
      if (entry.reviewedIntegrity && entry.reviewedVersion && pkg.version === entry.reviewedVersion) {
        client.verifyReviewedIntegrity(bytes, entry, label)
      }
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      throw new NpmPluginError(
        'DOWNLOAD_FAILED',
        `下载 ${label} 失败：镜像源失败（${primaryMsg}），改用条目 npmUrl 官方地址下载/校验也失败（${fallbackMsg}）`,
      )
    }
    this.ctx.logger.warn(
      `plugin-manager: ${label} 镜像下载无效（${primaryMsg}），已改用条目 npmUrl 官方地址下载`,
    )
    return bytes
  }

  /**
   * The post-extraction checklist shared by every install channel:
   * version agreement (D5), identity anti-spoofing (D8-6, built-in id
   * conflict, critical-service impersonation), platform/engine
   * compatibility (D8-4/D8-3) and the full security scan (D8-5). The npm
   * channel anchors identity to its registry entry; the local channel
   * builds the same-shaped entry from the package's own documents, so
   * the identity comparisons become self-consistency checks and the
   * remaining checks (conflicts, platform, engine, scan) bite exactly
   * as they do for a downloaded package.
   */
  private verifyExtractedPackage(
    node: ResolvedEntry,
    extracted: ExtractedPackage,
    installedRecords: Record<string, InstalledNpmPluginRecord>,
  ): ExtractedPackage {
    const { entry, pkg } = node
    const label = `${pkg.npm}@${pkg.version}`

    // D5: the selected version, package.json and BBeBee.plugin.json must agree.
    const vPkg = extracted.packageJson.version
    const vManifest = extracted.manifest.version
    if (vPkg !== pkg.version || vManifest !== pkg.version) {
      throw new NpmPluginError(
        'VERSION_MISMATCH',
        `包 ${label} 版本不一致：选定 ${pkg.version}，package.json 为 ${vPkg ?? '缺失'}，BBeBee.plugin.json 为 ${vManifest ?? '缺失'}，拒绝安装`,
      )
    }
    // D8-6: anti-spoofing — the tarball must be what the registry entry claims.
    if (extracted.packageJson.name !== entry.npm) {
      throw new NpmPluginError(
        'SPOOF_DETECTED',
        `包名不符：tarball 的 package.json name 为 "${extracted.packageJson.name ?? '缺失'}"，registry 条目要求 "${entry.npm}"，拒绝安装`,
      )
    }
    if (extracted.manifest.id !== entry.id) {
      throw new NpmPluginError(
        'SPOOF_DETECTED',
        `插件 id 不符：BBeBee.plugin.json 的 id 为 "${extracted.manifest.id ?? '缺失'}"，registry 条目要求 "${entry.id}"，拒绝安装`,
      )
    }
    if (this.manifests.has(entry.id) && !installedRecords[entry.id]) {
      throw new NpmPluginError('SPOOF_DETECTED', `插件 id "${entry.id}" 与内置插件冲突，拒绝安装`)
    }
    // Critical-key impersonation (audit W5): the packaged manifest may
    // not claim a critical service key that another registered
    // (built-in or previously installed) plug-in already provides —
    // the client-side mirror of the registry's provides gate, for
    // content whose real manifest only becomes visible after download.
    // Updating the incumbent itself is unaffected (its own id is
    // excluded). A critical key with NO incumbent provider is not
    // impersonation and stays installable.
    for (const key of (extracted.manifest.contributes?.services ?? []).filter((s) =>
      isCriticalServiceKey(s),
    )) {
      const incumbent = [...this.manifests.values()].find(
        (o) => o.id !== extracted.manifest.id && (o.contributes?.services ?? []).includes(key),
      )
      if (incumbent) {
        throw new NpmPluginError(
          'SPOOF_DETECTED',
          `插件 "${entry.id}" 的 manifest 声明提供关键服务 "${key}"，该服务已由 "${incumbent.id}" 提供，拒绝安装（防冒充）`,
        )
      }
    }
    // D8-4: the packaged manifest's own platforms must agree with the entry.
    const manifestPlatforms = extracted.manifest.platforms
    if (this.platform && manifestPlatforms && manifestPlatforms.length > 0 && !manifestPlatforms.includes(this.platform)) {
      throw new NpmPluginError(
        'PLATFORM_MISMATCH',
        `插件 "${entry.id}" 的包内 manifest 声明 platforms 为 [${manifestPlatforms.join(', ')}]，与当前平台（${this.platform}）不符，拒绝安装`,
      )
    }
    // D8-3: engine compatibility from the packaged manifest.
    const appVersion = this.getAppVersion()
    const engineRange = extracted.manifest.engines?.BBeBee
    if (appVersion && engineRange) {
      if (!satisfiesRange(appVersion, engineRange)) {
        throw new NpmPluginError(
          'APP_VERSION_MISMATCH',
          `插件 "${entry.id}@${pkg.version}" 要求 BBeBee ${engineRange}，当前应用版本 ${appVersion}，拒绝安装`,
        )
      }
    }
    // D8-5: static security scan — only a `block` finding refuses the
    // install (opaque payload imports, leaked credentials). `warn`
    // findings are advisory: they are logged, not hidden, and the
    // install proceeds. The scan context carries the hosts the packaged manifest declares
    // via `net:host/<glob>` capabilities, so declared egress is not
    // flagged as undeclared (the registry flow passes the same kind of
    // context from its documents' declarations).
    const allowedHosts = (extracted.manifest.capabilities ?? [])
      .filter((c) => c.startsWith('net:host/'))
      .map((c) => c.slice('net:host/'.length).trim())
      .filter(Boolean)
    const scanContext = allowedHosts.length > 0 ? { allowedHosts } : undefined
    const auditor = ownService<SecurityAuditorHandle>(this.own, this.ownCtx, 'securityAudit', 'auditor')
    // Selection is the toolkit's: every executable-text extension, plus
    // the manifest's entry files whatever their extension — the loader
    // executes those, so an entry named `.mjs` (or anything odder) must
    // not be the one file nobody scanned.
    const entryFiles = manifestEntryFiles(extracted.manifest.entry)
    for (const [path, content] of Object.entries(extracted.files)) {
      if (!shouldScanFile(path, entryFiles)) continue
      const report = auditor ? auditor.scan(content, scanContext) : scanCode(content, scanContext)
      if (report.level === 'block') {
        const issues = report.findings.map((f) => f.message).join('；')
        throw new NpmPluginError('SECURITY_BLOCKED', `插件 "${entry.id}" 的 ${path} 未通过安全扫描，拒绝安装：${issues}`)
      } else if (report.level === 'warn') {
        const issues = report.findings.map((f) => f.message).join('；')
        this.ctx.logger.warn(`plugin-manager: "${entry.id}" 的 ${path} 安全扫描警告（仍继续安装）：${issues}`)
      }
    }
    return extracted
  }

  /**
   * Records the user's capability grant, writes files + activates via
   * the bridge, records the lock, keeps disabled state.
   *
   * The grant comes first: installing is the user's approval, so each
   * node's packaged-manifest `capabilities` are persisted to
   * `capability_grants` (via the ledger) before activation — the
   * loader's gate consults exactly that table, and it re-reads it on
   * every load, so the activation below already sees the grant. A
   * capability-bearing node with no ledger available is refused
   * outright rather than waved into an activation that must fail.
   *
   * The install record is persisted after EVERY node: if a later node
   * of the closure fails, the store already matches what is on disk
   * instead of claiming nothing was installed. `onInstalled` fires after
   * each node's record is durable (updatePlugin uses it to know exactly
   * which nodes a rollback must cover) — and before the activation
   * state check, so a node whose files landed but whose activation
   * failed is still inside the rollback set.
   *
   * The bridge's activation result is checked per node: a terminal
   * state other than `active`/`pending` (`ungranted`, `failed`,
   * `quarantined`, `missing`) aborts the install with the plugin id and
   * state named — install never reports success for a plugin that did
   * not load. `pending` is a loaded state (waiting on a service), not a
   * failure; it is logged with what it waits for. Hosts whose bridge
   * returns no state object keep the previous behaviour.
   */
  private async activatePrepared(
    prepared: Array<{ node: ResolvedEntry; extracted: ExtractedPackage }>,
    records: Record<string, InstalledNpmPluginRecord>,
    onInstalled?: (id: string) => void,
    source: 'npm' | 'local' = 'npm',
  ): Promise<void> {
    const bridge = this.bridge
    if (!bridge?.installPlugin) {
      throw new NpmPluginError(
        'BRIDGE_UNAVAILABLE',
        'npm 插件安装需要 composition root 接线 PluginLifecycleBridge.installPlugin（mobile 等平台不支持动态安装）',
      )
    }
    const completed: string[] = []
    for (const { node, extracted } of prepared) {
      const capabilities = extracted.manifest.capabilities ?? []
      const ledger = this.grantLedger()
      if (ledger) {
        await ledger.record(node.entry.id, capabilities, {
          version: node.pkg.version,
          source,
        })
      } else if (capabilities.length > 0) {
        throw new NpmPluginError(
          'GRANT_UNAVAILABLE',
          `插件 "${node.entry.id}" 声明了 capabilities [${capabilities.join(', ')}]，但授权账本不可用（db 服务缺失），无法记录用户授权，拒绝安装`,
        )
      }
      const result = await bridge.installPlugin(node.entry.id, extracted.files, extracted.manifest)
      this.registerManifests({ [node.entry.id]: extracted.manifest })
      // No boot-time tamper chain: the install record pins only the
      // downloaded tarball (sha256). The per-file map (audit W3) was
      // removed 2026-10-24 — a writer able to rewrite the installed
      // directory already holds the user's own account, so comparing it
      // at boot bought a full-directory read per boot without containing
      // a determined local attacker. Recall still runs: blocked/delisted
      // flags on the record quarantine the plugin before it loads.
      // Old records carrying fileHashes/entrySha256 still parse (the
      // protocol fields are @deprecated) and are simply ignored.
      records[node.entry.id] = {
        id: node.entry.id,
        npm: node.pkg.npm,
        version: node.pkg.version,
        // npm records keep their historical shape (no `source` field —
        // absence means 'npm'); only local installs stamp the channel.
        ...(source === 'local' ? { source } : {}),
        sha256: extracted.tarballSha256,
        ...(extracted.provenanceVerified ? { provenanceVerified: true } : {}),
        installedAt: new Date().toISOString(),
      }
      // Keep the in-memory mirror exact: a re-install/update landing
      // without a verified attestation clears a previous version's flag.
      if (extracted.provenanceVerified) this.provenanceVerifiedIds.add(node.entry.id)
      else this.provenanceVerifiedIds.delete(node.entry.id)
      await this.saveInstalledRecords(records)
      onInstalled?.(node.entry.id)

      const activation = result as
        | { state?: unknown; error?: { message?: string }; waitingFor?: string[] }
        | null
        | undefined
      const state = activation?.state
      if (typeof state === 'string' && state !== 'active' && state !== 'pending') {
        const detail = activation?.error?.message ? `：${activation.error.message}` : ''
        throw new NpmPluginError(
          'ACTIVATION_FAILED',
          `插件 "${node.entry.id}" 的文件已安装、授权已记录，但激活状态为 "${state}"${detail}。` +
            `本次共 ${prepared.length} 个节点，失败于第 ${completed.length + 1} 个（"${node.entry.id}"），` +
            `此前已完成：${completed.length > 0 ? completed.join('、') : '无'}。`,
        )
      }
      if (state === 'pending') {
        const waitingFor = activation?.waitingFor ?? []
        this.ctx.logger.warn(
          `plugin-manager: "${node.entry.id}" 已安装但尚未激活（pending）` +
            (waitingFor.length > 0 ? `，等待服务：${waitingFor.join(', ')}` : ''),
        )
      }
      completed.push(node.entry.id)
    }
    // An explicitly disabled plugin stays unloaded after its files are replaced.
    for (const { node } of prepared) {
      if (this.overrides[node.entry.id] === false) {
        await bridge.unloadPlugin(node.entry.id)
      }
    }
    this.ctx.emit('plugin-manager/changed')
  }

  /**
   * Stages one installed node's rollback material: its current tarball,
   * re-fetched from npm and put through the SAME checklist as a first
   * install (preparePackage: integrity, anti-spoofing, security scan,
   * manifest re-checks). The anti-spoof anchor is the install record
   * itself (id + npm were verified when that version was installed);
   * the registry entry, when still listed, carries the same values.
   */
  private async stageRollbackMaterial(
    client: NpmClient,
    old: InstalledNpmPluginRecord,
    records: Record<string, InstalledNpmPluginRecord>,
    index: RegistryPluginEntry[],
  ): Promise<RollbackStage> {
    let oldDist: { tarball?: string; integrity?: string } | undefined
    try {
      const pack = await client.fetchPackument(old.npm)
      oldDist = pack.versions?.[old.version]?.dist
    } catch (err) {
      this.ctx.logger.warn(
        `plugin-manager: could not stage rollback for "${old.id}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return { kind: 'unavailable' }
    }
    if (!oldDist?.tarball) return { kind: 'unavailable' }
    const entry = index.find((e) => e.id === old.id) ?? {
      id: old.id,
      name: old.id,
      repo: '',
      npm: old.npm,
      author: '',
      description: '',
      services: [],
      platforms: [],
      category: '',
      dependencies: [],
      compositors: [],
    }
    const node: ResolvedEntry = {
      entry,
      pkg: { id: old.id, npm: old.npm, version: old.version, tarball: oldDist.tarball, integrity: oldDist.integrity },
    }
    try {
      return { kind: 'ready', extracted: await this.preparePackage(client, node, records) }
    } catch (err) {
      if (err instanceof NpmPluginError && ROLLBACK_VERIFICATION_CODES.has(err.code)) {
        return { kind: 'rejected', error: err }
      }
      this.ctx.logger.warn(
        `plugin-manager: could not stage rollback for "${old.id}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return { kind: 'unavailable' }
    }
  }

  /**
   * The rollback skeleton shared by installPlugin and updatePlugin:
   * walk the nodes an activation attempt completed, in reverse install
   * order (dependents before their dependencies), and put each back.
   *
   * - A node with a previous record is restored from its staged (and
   *   verified) material — files, record and grants all return to the
   *   previous version's. Without material it stays at the new version
   *   (files and record agree; the skip is logged loudly).
   * - A node with NO previous record was pulled in by this attempt.
   *   `newNodePolicy` decides its fate: an update leaves it (it is
   *   consistent, if unrequested), a failed FIRST install removes it
   *   again — files uninstalled, directory deleted via the bridge,
   *   record dropped, grants revoked — so a failed install leaves the
   *   machine exactly as it found it.
   */
  private async rollbackReplacedNodes(args: {
    replacedIds: string[]
    previousRecords: Record<string, InstalledNpmPluginRecord>
    records: Record<string, InstalledNpmPluginRecord>
    materialById: ReadonlyMap<string, ExtractedPackage>
    newVersionById: ReadonlyMap<string, string>
    newNodePolicy: 'keep' | 'remove'
    actionPhrase: string
  }): Promise<void> {
    const { replacedIds, previousRecords, records, materialById, newVersionById, newNodePolicy, actionPhrase } = args
    const bridge = this.bridge
    for (const replacedId of [...replacedIds].reverse()) {
      const previous = previousRecords[replacedId]
      if (!previous) {
        if (newNodePolicy === 'keep') {
          // Newly pulled in by this attempt: its files and record agree,
          // so the state is consistent — but say so; the user did not ask
          // for it.
          this.ctx.logger.warn(
            `plugin-manager: "${replacedId}" was newly installed by ${actionPhrase} and has no previous version to restore; leaving it installed`,
          )
          continue
        }
        try {
          if (bridge?.uninstallPlugin) {
            await bridge.uninstallPlugin(replacedId)
          } else if (bridge?.unloadPlugin) {
            await bridge.unloadPlugin(replacedId)
          }
        } catch (rbErr) {
          this.ctx.logger.error(
            `plugin-manager: rollback removal of "${replacedId}" failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
          )
        }
        const m = this.manifests.get(replacedId)
        this.manifests.delete(replacedId)
        if (m?.name) {
          this.manifests.delete(m.name)
          delete this.overrides[m.name]
        }
        delete this.overrides[replacedId]
        this.failedErrors.delete(replacedId)
        if (m?.name) {
          this.failedErrors.delete(m.name)
        }
        delete records[replacedId]
        this.provenanceVerifiedIds.delete(replacedId)
        // The grant dies with the rolled-back install, exactly as on
        // uninstall: a later reinstall must be approved again.
        const ledger = this.grantLedger()
        if (ledger) {
          try {
            await ledger.revoke(replacedId)
          } catch {
            // Best-effort; the files are gone, and a stale grant for a
            // plugin that is not installed loads nothing.
          }
        }
        this.ctx.logger.warn(
          `plugin-manager: removed "${replacedId}" again after ${actionPhrase} (rolled back)`,
        )
        continue
      }
      if (previous.version === newVersionById.get(replacedId)) continue // rewritten with identical content
      const staged = materialById.get(replacedId)
      if (!staged) {
        this.ctx.logger.warn(
          `plugin-manager: cannot roll back "${replacedId}": no rollback material (old tarball unavailable); it stays at the new version`,
        )
        continue
      }
      if (!bridge?.installPlugin) {
        this.ctx.logger.error(
          `plugin-manager: cannot roll back "${replacedId}": lifecycle bridge unavailable`,
        )
        continue
      }
      try {
        await bridge.installPlugin(replacedId, staged.files, staged.manifest)
        this.registerManifests({ [replacedId]: staged.manifest })
        records[replacedId] = previous
        // The restored record's provenance verdict rules again.
        if (previous.provenanceVerified) this.provenanceVerifiedIds.add(replacedId)
        else this.provenanceVerifiedIds.delete(replacedId)
        // The restored version runs under the grants its own manifest
        // declares — the failed attempt replaced them with the new
        // version's set, so put the old set back too.
        const ledger = this.grantLedger()
        if (ledger) {
          try {
            await ledger.record(replacedId, staged.manifest.capabilities ?? [], {
              version: previous.version,
              source: 'npm',
            })
          } catch (grantErr) {
            this.ctx.logger.warn(
              `plugin-manager: could not restore capability grants for "${replacedId}": ${grantErr instanceof Error ? grantErr.message : String(grantErr)}`,
            )
          }
        }
        this.ctx.logger.warn(
          `plugin-manager: rolled back "${replacedId}" to ${previous.version} after ${actionPhrase}`,
        )
      } catch (rbErr) {
        this.ctx.logger.error(
          `plugin-manager: rollback of "${replacedId}" failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
        )
      }
    }
    if (replacedIds.length > 0) {
      await this.saveInstalledRecords(records)
    }
    this.ctx.emit('plugin-manager/changed')
  }

  async installPlugin(id: string, range?: string, expectedPlan?: InstallPlan): Promise<void> {
    const { plan, nodes, index } = await this.planInstall(id, range)
    if (expectedPlan) {
      this.assertPlanUnchanged(expectedPlan, plan)
    }
    if (plan.missingServices.length > 0) {
      throw new NpmPluginError(
        'SERVICE_UNAVAILABLE',
        `插件 "${id}" 需要以下服务，但当前安装不可用：${plan.missingServices.join('、')}，拒绝安装`,
      )
    }
    const client = this.getNpmClient()
    const records = await this.loadInstalledRecords()
    const prepared: Array<{ node: ResolvedEntry; extracted: ExtractedPackage }> = []
    for (const node of nodes) {
      prepared.push({ node, extracted: await this.preparePackage(client, node, records) })
    }
    // D8-1 (refined, with the real packaged manifests of the closure).
    const available = this.availableServiceKeys()
    for (const p of prepared) {
      for (const s of p.extracted.manifest.contributes?.services ?? []) available.add(s)
    }
    const needed = new Set<string>()
    for (const p of prepared) for (const s of p.node.entry.services) needed.add(s)
    const missing = [...needed].filter((s) => !available.has(s))
    if (missing.length > 0) {
      throw new NpmPluginError(
        'SERVICE_UNAVAILABLE',
        `插件 "${id}" 需要以下服务，但当前安装不可用：${missing.join('、')}，拒绝安装`,
      )
    }

    // First-install rollback, sharing updatePlugin's skeleton: snapshot
    // the pre-install records and stage verified rollback material for
    // any node this install would overwrite. If activation then fails
    // partway, completed nodes are put back — brand-new ones are
    // uninstalled again (files, record, grants) — instead of leaving a
    // half-activated closure behind an "install failed" message.
    const previousRecords: Record<string, InstalledNpmPluginRecord> = { ...records }
    const materialById = new Map<string, ExtractedPackage>()
    const rejectedMaterial: Array<{ old: InstalledNpmPluginRecord; error: NpmPluginError }> = []
    for (const p of prepared) {
      const old = previousRecords[p.node.entry.id]
      if (!old || old.version === p.node.pkg.version) continue
      const staged = await this.stageRollbackMaterial(client, old, records, index)
      if (staged.kind === 'ready') {
        materialById.set(p.node.entry.id, staged.extracted)
      } else if (staged.kind === 'rejected') {
        rejectedMaterial.push({ old, error: staged.error })
      }
    }
    if (rejectedMaterial.length > 0) {
      const first = rejectedMaterial[0]!
      throw new NpmPluginError(
        first.error.code,
        `插件 "${first.old.id}" 现有版本的回滚材料（${first.old.npm}@${first.old.version}）未通过安装校验，中止安装，未写入任何文件：${first.error.message}`,
      )
    }
    // Provider preemption (audit W5): the incoming real manifests take
    // over the replaceable keys they provide BEFORE activation, so the
    // incumbent is already out when the newcomer registers its keys
    // (Cordis would refuse the duplicate registration otherwise).
    await this.preemptConflictingProviders(prepared.map((p) => p.extracted.manifest))

    const newVersionById = new Map(prepared.map((p) => [p.node.entry.id, p.node.pkg.version]))
    const installedNow: string[] = []
    try {
      await this.activatePrepared(prepared, records, (installedId) => installedNow.push(installedId))
    } catch (err) {
      await this.rollbackReplacedNodes({
        replacedIds: installedNow,
        previousRecords,
        records,
        materialById,
        newVersionById,
        newNodePolicy: 'remove',
        actionPhrase: `failed install of "${id}"`,
      })
      throw err
    }
    this.ctx.logger.info(`plugin-manager: installed "${id}" via npm`)
  }

  /**
   * Extracts and fully verifies one local package file, building the
   * install node from the package's OWN documents (there is no registry
   * entry and no download: identity is self-asserted, which is exactly
   * what the confirm screen must say). Everything the npm channel checks
   * after extraction runs here too — bounded extraction and the full
   * security scan inside `extractPackage`/`verifyExtractedPackage`,
   * built-in id conflicts, critical-service impersonation, platform and
   * engine compatibility — and the registry ban channel still refuses
   * a banned id. Only the registry/npm anchors (packument integrity,
   * reviewed pin, provenance) have no local counterpart.
   */
  private async prepareLocalPackage(packageBase64: string): Promise<{
    node: ResolvedEntry
    extracted: ExtractedPackage
    records: Record<string, InstalledNpmPluginRecord>
    warnings: string[]
  }> {
    if (typeof packageBase64 !== 'string' || packageBase64.trim() === '') {
      throw new NpmPluginError('TARBALL_INVALID', '本地插件包为空：没有收到任何数据')
    }
    const bytes = base64ToBytes(packageBase64)
    if (bytes.length === 0) {
      throw new NpmPluginError('TARBALL_INVALID', '本地插件包为空：base64 解码后没有任何字节')
    }
    if (bytes.length > TARBALL_SIZE_LIMIT_BYTES) {
      throw new NpmPluginError(
        'SIZE_LIMIT',
        `本地插件包大小 ${bytes.length} 字节超过上限 ${TARBALL_SIZE_LIMIT_BYTES} 字节，拒绝导入`,
      )
    }
    const client = this.getNpmClient()
    const extracted = client.extractPackage(
      { id: 'local', npm: '本地插件包', version: '?', tarball: '' },
      bytes,
    )
    const manifest = extracted.manifest
    const npmName = extracted.packageJson.name
    if (!manifest?.id) {
      throw new NpmPluginError('TARBALL_INVALID', '本地插件包的 BBeBee.plugin.json 缺少 id，拒绝导入')
    }
    if (!npmName) {
      throw new NpmPluginError('TARBALL_INVALID', '本地插件包的 package.json 缺少 name，拒绝导入')
    }
    if (!extracted.packageJson.version || !manifest.version) {
      throw new NpmPluginError(
        'VERSION_MISMATCH',
        `本地插件包 "${manifest.id}" 版本缺失：package.json 为 ${extracted.packageJson.version ?? '缺失'}，BBeBee.plugin.json 为 ${manifest.version ?? '缺失'}，拒绝导入`,
      )
    }
    const entry: RegistryPluginEntry = {
      id: manifest.id,
      name: manifest.displayName ?? manifest.name ?? manifest.id,
      repo: '',
      npm: npmName,
      author: manifest.author ?? '',
      description: manifest.description ?? '',
      services: [],
      platforms: [...(manifest.platforms ?? [])],
      category: '',
      dependencies: [],
      compositors: [],
    }
    const node: ResolvedEntry = {
      entry,
      pkg: { id: manifest.id, npm: npmName, version: extracted.packageJson.version, tarball: '' },
    }
    // A registry ban is a security verdict about the id itself, not
    // about the download channel — it binds sideloads exactly as it
    // binds npm installs.
    this.assertNotBlocked([node.pkg])
    const records = await this.loadInstalledRecords()
    this.verifyExtractedPackage(node, extracted, records)

    const warnings: string[] = [
      '本地导入：该插件未经 registry 审核，也没有 npm 出处证明（provenance）校验，身份以包内文档自证。请只导入来源可信的插件包。',
    ]
    // Manifest plugin dependencies cannot be resolved from a single
    // file (no closure download); ones the host does not already know
    // are a warning — activation reports `pending`/failure if a needed
    // plugin truly never arrives.
    for (const dep of manifest.dependencies ?? []) {
      if (!this.manifests.has(dep) && !records[dep]) {
        warnings.push(`manifest 依赖 "${dep}" 不在已注册或已安装的插件中，导入后插件可能等待该依赖或激活失败`)
      }
    }
    // Same host-shared peer contract as the npm plan (warn, never block).
    const peers = extracted.packageJson.peerDependencies as Record<string, string> | undefined
    for (const [peerName, peerRange] of Object.entries(peers ?? {})) {
      const hostVersion = this.hostVersions[peerName]
      if (!hostVersion) continue
      if (!/[\d*xX]/.test(peerRange)) continue
      if (!satisfiesRange(hostVersion, peerRange)) {
        warnings.push(
          `包 ${npmName}@${node.pkg.version} 声明 peer ${peerName} "${peerRange}"，但宿主提供的是 ${hostVersion}：插件 UI 可能无法正常渲染（不影响安装）`,
        )
      }
    }
    return { node, extracted, records, warnings }
  }

  private localPreview(prepared: {
    node: ResolvedEntry
    extracted: ExtractedPackage
    records: Record<string, InstalledNpmPluginRecord>
    warnings: string[]
  }): LocalPluginPreview {
    const { node, extracted, records, warnings } = prepared
    const manifest = extracted.manifest
    return {
      id: node.entry.id,
      npm: node.pkg.npm,
      displayName: manifest.displayName ?? manifest.name,
      description: manifest.description,
      version: node.pkg.version,
      author: manifest.author,
      capabilities: [...(manifest.capabilities ?? [])],
      fileCount: Object.keys(extracted.files).length,
      sha256: extracted.tarballSha256,
      installedVersion: records[node.entry.id]?.version,
      warnings,
    }
  }

  async previewLocalPlugin(packageBase64: string): Promise<LocalPluginPreview> {
    return this.localPreview(await this.prepareLocalPackage(packageBase64))
  }

  async installLocalPlugin(
    packageBase64: string,
    opts?: { confirmed?: boolean },
  ): Promise<LocalPluginPreview> {
    if (!opts?.confirmed) {
      throw new NpmPluginError(
        'CONFIRM_REQUIRED',
        '本地插件安装必须先向用户展示包身份、capabilities 与未经审核提示并得到确认（previewLocalPlugin → 确认 → installLocalPlugin(confirmed: true)）',
      )
    }
    const preparedLocal = await this.prepareLocalPackage(packageBase64)
    const { node, extracted, records } = preparedLocal
    const preview = this.localPreview(preparedLocal)
    const previousRecords: Record<string, InstalledNpmPluginRecord> = { ...records }
    // Same provider preemption as the npm channel: an incoming manifest
    // that provides a replaceable key takes it over before activation.
    await this.preemptConflictingProviders([extracted.manifest])
    const installedNow: string[] = []
    try {
      await this.activatePrepared([{ node, extracted }], records, (id) => installedNow.push(id), 'local')
    } catch (err) {
      // No rollback material exists for a local package (the previous
      // version's bytes are the user's file, not something the manager
      // can re-fetch), so the shared skeleton runs with an empty
      // material map: a brand-new node is removed again; a replaced
      // node stays at the new version with the warning logged there.
      await this.rollbackReplacedNodes({
        replacedIds: installedNow,
        previousRecords,
        records,
        materialById: new Map(),
        newVersionById: new Map([[node.entry.id, node.pkg.version]]),
        newNodePolicy: 'remove',
        actionPhrase: `failed local install of "${node.entry.id}"`,
      })
      throw err
    }
    this.ctx.logger.info(`plugin-manager: installed "${node.entry.id}" from a local package file`)
    return preview
  }

  /**
   * Liveness (recall) check, client side (audit W3): fetch the registry
   * index through the usual cached path and compare it against the
   * installed records. ONLY a successfully fetched index can change
   * anything: an installed id confirmed absent from it is flagged
   * `delisted` (persisted), unloaded best-effort, and surfaced via
   * list()/the boot lock so the loader quarantines it with a visible
   * "removed from the registry" reason. A failed fetch — offline, DNS,
   * a dead mirror — leaves every flag untouched: network fails open,
   * confirmed absence fails closed. An id that reappears in the index
   * has its flag cleared again.
   */
  async refreshDelistedFromIndex(options?: { force?: boolean }): Promise<void> {
    if (!ownService<HttpService>(this.own, this.ownCtx, 'http')) return
    let doc: RegistryIndexDocument
    try {
      doc = await this.getNpmClient().fetchIndexDocument(options?.force ? { force: true } : undefined)
    } catch {
      return
    }
    await this.applyLivenessToRecords(doc.entries, doc.blocked)
  }

  private async applyLivenessToRecords(
    index: RegistryPluginEntry[],
    blocked: RegistryBlockedEntry[] = [],
  ): Promise<void> {
    const listed = new Set(index.map((e) => e.id))
    const blockedById = new Map(blocked.map((b) => [b.id, b.reason] as const))
    const records = await this.loadInstalledRecords()
    let changed = false
    const newlyDelisted: string[] = []
    const newlyBlocked: string[] = []
    for (const rec of Object.values(records)) {
      // Local (sideloaded) records are exempt from the delisting half:
      // absence from the index is their normal state, not a recall.
      // The blocked half below is NOT exempt — a ban names the id.
      if (rec.source !== 'local') {
        const absent = !listed.has(rec.id)
        if (absent && !rec.delisted) {
          rec.delisted = true
          changed = true
          newlyDelisted.push(rec.id)
        } else if (!absent && rec.delisted) {
          delete rec.delisted
          changed = true
        }
      }
      // The blocked channel (audit W5) is a separate, stronger state:
      // the id is banned outright, with the registry's reason kept on
      // the record. It flips independently of delisting — an entry can
      // be blocked while still listed, and unblocking must not clear a
      // delisting (or vice versa).
      const ban = blockedById.get(rec.id)
      if (ban !== undefined && rec.blocked !== ban) {
        const wasQuarantined = Boolean(rec.blocked) || Boolean(rec.delisted)
        rec.blocked = ban
        changed = true
        if (!wasQuarantined) newlyBlocked.push(rec.id)
      } else if (ban === undefined && rec.blocked !== undefined) {
        delete rec.blocked
        changed = true
      }
    }
    this.delistedIds = new Set(
      Object.values(records)
        .filter((r) => r.delisted)
        .map((r) => r.id),
    )
    this.blockedIds = new Map(
      Object.values(records)
        .filter((r) => r.blocked !== undefined)
        .map((r) => [r.id, r.blocked as string] as const),
    )
    if (!changed) return
    await this.saveInstalledRecords(records)
    for (const id of newlyDelisted) {
      this.ctx.logger.warn(
        `plugin-manager: "${id}" is no longer in the registry index (delisted); quarantining the installed copy`,
      )
      try {
        await this.bridge?.unloadPlugin(id)
      } catch {
        // Best-effort for this session; the persisted flag makes the
        // next boot quarantine it before any of its code runs.
      }
    }
    for (const id of newlyBlocked) {
      this.ctx.logger.warn(
        `plugin-manager: "${id}" is BANNED by the registry (blocked: ${blockedById.get(id) ?? ''}); quarantining the installed copy`,
      )
      try {
        await this.bridge?.unloadPlugin(id)
      } catch {
        // Best-effort, same as delisting above.
      }
    }
    this.ctx.emit('plugin-manager/changed')
  }

  /**
   * Refuses installs whose target or closure contains a banned id
   * (audit W5). Checked from the in-memory ban map (seeded from the
   * persisted records at init and refreshed by every liveness pass),
   * so a ban learned this session applies immediately.
   */
  private assertNotBlocked(
    nodes: readonly { id: string }[],
    freshBans?: ReadonlyMap<string, string>,
  ): void {
    for (const n of nodes) {
      const reason = freshBans?.get(n.id) ?? this.blockedIds.get(n.id)
      if (reason !== undefined) {
        throw new NpmPluginError(
          'BLOCKED',
          `插件 "${n.id}" 已被注册表安全封禁${reason ? `（${reason}）` : ''}，拒绝安装`,
        )
      }
    }
  }

  async checkUpdates(force = false): Promise<PluginUpdateInfo[]> {
    // Liveness first, so a delisted plugin stops being reported as
    // "update available" (its update attempt would fail anyway) — and so
    // checkUpdates and updatePlugin agree on delisted entries.
    await this.refreshDelistedFromIndex({ force })
    const client = this.getNpmClient()
    // The reviewed pins live in the registry index; fetchIndex reuses
    // the cache the liveness refresh just warmed. A failed fetch just
    // means "no pin information" — updates are then reported unpinned,
    // exactly as before.
    const entryById = new Map<string, RegistryPluginEntry>()
    try {
      for (const e of await client.fetchIndex(force ? { force: true } : undefined)) entryById.set(e.id, e)
    } catch {
      // No pin information available; proceed without it.
    }
    const records = await this.loadInstalledRecords()
    const updates: PluginUpdateInfo[] = []
    for (const rec of Object.values(records)) {
      // Local installs update by re-importing a newer package file,
      // never by silently switching to the npm channel.
      if (rec.source === 'local') continue
      if (rec.delisted || rec.blocked !== undefined) continue
      try {
        const pack = await client.fetchPackument(rec.npm, force ? { force: true } : undefined)
        const latest = pack['dist-tags']?.latest
        if (latest && compareVersions(latest, rec.version) > 0) {
          const info: PluginUpdateInfo = { id: rec.id, installed: rec.version, latest, npm: rec.npm }
          // Distinguish the reviewed update (installable by default)
          // from a newer build the registry has not reviewed yet.
          const reviewedVersion = entryById.get(rec.id)?.reviewedVersion
          if (reviewedVersion) {
            info.reviewedVersion = reviewedVersion
            if (compareVersions(reviewedVersion, rec.version) > 0 && compareVersions(reviewedVersion, latest) <= 0) {
              info.reviewedUpdate = reviewedVersion
            }
            if (compareVersions(latest, reviewedVersion) > 0) {
              info.unreviewed = true
            }
          }
          updates.push(info)
        }
      } catch (err) {
        this.ctx.logger.warn(
          `plugin-manager: update check failed for "${rec.id}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    try {
      await ownService<StoreService>(this.own, this.ownCtx, 'store')?.set('npm:last-update-check', Date.now())
    } catch {
      // Best-effort; the next boot simply checks again.
    }
    return updates
  }

  /**
   * The npm `dist-tags.latest` version of one package, for Discover-page
   * display (a plugin card's title version and its latest-version badge).
   * Packuments come from the npm client's cache, so repeated calls for the
   * visible cards are cheap. Never throws: a failed lookup degrades to
   * `undefined` and the caller renders without a version.
   */
  async getNpmLatest(npmName: string): Promise<string | undefined> {
    try {
      const client = this.getNpmClient()
      const pack = await client.fetchPackument(npmName)
      const latest = pack['dist-tags']?.latest
      return typeof latest === 'string' && latest ? latest : undefined
    } catch (err) {
      this.ctx.logger.warn(
        `plugin-manager: latest-version lookup failed for "${npmName}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return undefined
    }
  }

  async updatePlugin(id: string, range?: string): Promise<void> {
    const records = await this.loadInstalledRecords()
    const rec = records[id]
    if (!rec) {
      throw new NpmPluginError('NOT_INSTALLED', `插件 "${id}" 不是经 npm 安装的，无法更新`)
    }
    if (rec.source === 'local') {
      throw new NpmPluginError(
        'NOT_INSTALLED',
        `插件 "${id}" 是本地导入的，无法经 npm 更新；请在探索页用新版插件包重新导入`,
      )
    }
    // Same liveness verdict as checkUpdates: a plugin confirmed absent
    // from the registry index is delisted — say so plainly instead of
    // the old confusing ENTRY_NOT_FOUND from deep inside the planner.
    // The refresh is best-effort (offline changes nothing); a flag set
    // by any earlier successful check is honoured as-is.
    await this.refreshDelistedFromIndex()
    if (this.delistedIds.has(id)) {
      throw new NpmPluginError(
        'DELISTED',
        `插件 "${id}" 已从注册表下架，无法更新；已安装的副本已被隔离。可以卸载它，或等待其重新上架后再试。`,
      )
    }
    // A banned plugin is not updatable either (audit W5) — stronger
    // than delisting: the ban reason is the registry's, surfaced as-is.
    const banReason = this.blockedIds.get(id)
    if (banReason !== undefined) {
      throw new NpmPluginError(
        'BLOCKED',
        `插件 "${id}" 已被注册表安全封禁${banReason ? `（${banReason}）` : ''}，无法更新；已安装的副本已被隔离。可以卸载它。`,
      )
    }
    // A major bump is never applied silently: without an explicit range the
    // caller (UI) must confirm first and retry with a version/range.
    // The comparison target is the version a default update would
    // actually install — the reviewed pin when one applies (audit W5),
    // not npm's latest: an unreviewed major sitting beyond the pin must
    // not block the reviewed patch update underneath it.
    const majorOf = (v: string): number => {
      const m = /^v?(\d+)/.exec(v)
      return m ? Number(m[1]) : 0
    }
    if (!range) {
      const client = this.getNpmClient()
      const latest = (await client.fetchPackument(rec.npm))['dist-tags']?.latest
      let defaultTarget = latest
      try {
        const reviewed = (await client.fetchIndex()).find((e) => e.id === id)?.reviewedVersion
        if (
          reviewed &&
          latest &&
          compareVersions(reviewed, rec.version) > 0 &&
          compareVersions(reviewed, latest) <= 0
        ) {
          defaultTarget = reviewed
        }
      } catch {
        // No pin information; judge by latest as before.
      }
      if (defaultTarget && majorOf(defaultTarget) > majorOf(rec.version)) {
        throw new NpmPluginError(
          'MAJOR_UPDATE_NEEDS_CONFIRM',
          `插件 "${id}" 有大版本更新（${rec.version} → ${defaultTarget}），需要显式确认：请用版本号或 range 再试一次，例如 updatePlugin("${id}", "${defaultTarget}")`,
        )
      }
    }
    const wanted = range ?? `^${rec.version}`
    const { plan, nodes, index } = await this.planInstall(id, wanted)
    if (plan.missingServices.length > 0) {
      throw new NpmPluginError(
        'SERVICE_UNAVAILABLE',
        `插件 "${id}" 需要以下服务，但当前安装不可用：${plan.missingServices.join('、')}，拒绝更新`,
      )
    }
    const newVersion = plan.target.version
    if (compareVersions(newVersion, rec.version) <= 0) {
      this.ctx.logger.info(`plugin-manager: "${id}" is already up to date (${rec.version})`)
      return
    }

    const bridge = this.bridge
    if (!bridge?.installPlugin) {
      throw new NpmPluginError(
        'BRIDGE_UNAVAILABLE',
        'npm 插件更新需要 composition root 接线 PluginLifecycleBridge.installPlugin（mobile 等平台不支持动态安装）',
      )
    }
    const client = this.getNpmClient()
    const prepared: Array<{ node: ResolvedEntry; extracted: ExtractedPackage }> = []
    for (const node of nodes) {
      prepared.push({ node, extracted: await this.preparePackage(client, node, records) })
    }

    // Snapshot of the pre-update records — rollback restores exactly these.
    const previousRecords: Record<string, InstalledNpmPluginRecord> = { ...records }
    const newVersionById = new Map(prepared.map((p) => [p.node.entry.id, p.node.pkg.version]))

    // Rollback material for EVERY replaced node of the closure (target and
    // dependencies alike), staged and verified by stageRollbackMaterial.
    // Availability stays best-effort — an old version that vanished from
    // npm simply has no material, as before. But material that downloads
    // and then FAILS verification is a different animal: reinstalling
    // unverified bytes as the "safe" fallback would defeat the checklist,
    // so a single rejected node aborts the whole update before anything
    // is written, with the verification error named.
    const rollbackById = new Map<string, ExtractedPackage>()
    const rejectedRollback: Array<{ old: InstalledNpmPluginRecord; error: NpmPluginError }> = []
    for (const node of nodes) {
      const old = previousRecords[node.entry.id]
      if (!old || old.version === node.pkg.version) continue
      const staged = await this.stageRollbackMaterial(client, old, records, index)
      if (staged.kind === 'ready') {
        rollbackById.set(node.entry.id, staged.extracted)
      } else if (staged.kind === 'rejected') {
        rejectedRollback.push({ old, error: staged.error })
      }
    }
    if (rejectedRollback.length > 0) {
      const first = rejectedRollback[0]!
      throw new NpmPluginError(
        first.error.code,
        `插件 "${first.old.id}" 的回滚材料（${first.old.npm}@${first.old.version}）未通过安装校验，中止更新，未写入任何文件：${first.error.message}`,
      )
    }

    const replaced: string[] = []
    try {
      await this.activatePrepared(prepared, records, (installedId) => replaced.push(installedId))
      this.ctx.logger.info(`plugin-manager: updated "${id}" ${rec.version} → ${newVersion}`)
    } catch (err) {
      // Roll back every node this attempt actually replaced, in reverse
      // install order (dependents before their dependencies). Nodes the
      // update newly pulled in are kept ('keep'): their files and record
      // agree, so the state stays consistent.
      await this.rollbackReplacedNodes({
        replacedIds: replaced,
        previousRecords,
        records,
        materialById: rollbackById,
        newVersionById,
        newNodePolicy: 'keep',
        actionPhrase: `failed update of "${id}"`,
      })
      throw err
    }
  }

  async setNpmAuthToken(token: string): Promise<void> {
    const secrets = ownService<SecretsService>(this.own, this.ownCtx, 'secrets')
    if (!secrets) {
      throw new NpmPluginError('SERVICE_UNAVAILABLE', 'secrets 服务不可用，无法保存 npm 认证 token')
    }
    // The token lives in the plugin's own secrets namespace — never in the
    // store, never in logs.
    await secrets.set(NPM_AUTH_TOKEN_KEY, token)
  }

  async clearNpmAuthToken(): Promise<void> {
    const secrets = ownService<SecretsService>(this.own, this.ownCtx, 'secrets')
    if (!secrets) {
      throw new NpmPluginError('SERVICE_UNAVAILABLE', 'secrets 服务不可用，无法清除 npm 认证 token')
    }
    await secrets.delete(NPM_AUTH_TOKEN_KEY)
  }

  async hasNpmAuthToken(): Promise<boolean> {
    const secrets = ownService<SecretsService>(this.own, this.ownCtx, 'secrets')
    if (!secrets) return false
    try {
      return (await secrets.get(NPM_AUTH_TOKEN_KEY)) !== undefined
    } catch {
      return false
    }
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

    // Deduplicate manifests by id. Declaration-only manifests — an empty
    // `entry.main`, e.g. a shell's service-provision record — feed the
    // availability composition above, but they are not plugins: there is
    // nothing to load, toggle or list, so they never appear here.
    const uniqueManifests = new Map<string, PluginManifest>()
    for (const m of this.manifests.values()) {
      if (!m.entry?.main) continue
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
        fibersMap.get(manifest.id.replace(/^@bbebee\//i, ''))

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
          ...(manifest.capabilities ? { capabilities: [...manifest.capabilities] } : {}),
          ...(this.delistedIds.has(manifest.id) ? { delisted: true } : {}),
          ...(this.blockedIds.has(manifest.id) ? { blocked: this.blockedIds.get(manifest.id) } : {}),
          ...(this.provenanceVerifiedIds.has(manifest.id) ? { provenanceVerified: true } : {}),
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
    const mClean = manifest.id.replace(/^@bbebee\//i, '')
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
    if (manifest.id === '@bbebee/plugin-theme' || manifest.name === '@bbebee/plugin-theme') {
      return settings.themeId !== DEFAULT_APP_SETTINGS.themeId ? 'customized' : 'default'
    }

    if (manifest.id === '@bbebee/plugin-now-playing' || manifest.name === '@bbebee/plugin-now-playing') {
      return settings.nowPlayingStyle !== DEFAULT_APP_SETTINGS.nowPlayingStyle ? 'customized' : 'default'
    }

    if (manifest.id === '@bbebee/plugin-desktop-lyrics' || manifest.name === '@bbebee/plugin-desktop-lyrics') {
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

    if (manifest.id === '@bbebee/plugin-visualizer' || manifest.name === '@bbebee/plugin-visualizer') {
      const cur = settings.visualizer
      const def = DEFAULT_VISUALIZER_SETTINGS
      const isCustom =
        cur.style !== def.style ||
        cur.colorTheme !== def.colorTheme ||
        cur.fftSize !== def.fftSize ||
        cur.sensitivity !== def.sensitivity
      return isCustom ? 'customized' : 'default'
    }

    if (manifest.id === '@bbebee/plugin-player' || manifest.name === '@bbebee/plugin-player') {
      const isCustom =
        settings.crossfadeEnabled !== DEFAULT_APP_SETTINGS.crossfadeEnabled ||
        settings.crossfadeDurationSeconds !== DEFAULT_APP_SETTINGS.crossfadeDurationSeconds ||
        settings.gaplessPlayback !== DEFAULT_APP_SETTINGS.gaplessPlayback ||
        settings.loudnessNormalizationEnabled !== DEFAULT_APP_SETTINGS.loudnessNormalizationEnabled
      return isCustom ? 'customized' : 'default'
    }

    if (manifest.id === '@bbebee/plugin-settings' || manifest.name === '@bbebee/plugin-settings') {
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
