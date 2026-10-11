/**
 * `plugin-registry` — the in-app index of third-party content and its updates.
 *
 * Implements `ctx.contentRegistry`: discovers content via GitHub Contents API
 * across music-sources, lyric-sources, themes, and plugins; validates integrity
 * via registry.lock.json and static security scanning; installs through owning
 * domain services.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type {
  AppSettings,
  FsService,
  HttpService,
  HttpResponse,
  LyricSourceDefinition,
  LyricSourcesService,
  PathsService,
  PluginInstallBundle,
  PluginManagerService,
  PluginManifest,
  RegistryDiagnosticsReport,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
  RegistryLockFile,
  RegistryLockRecord,
  RegistryService,
  RegistryTask,
  RegistryUpdate,
  SecurityAuditContext,
  SecurityAuditReport,
  SecurityAuditService,
  SettingsService,
  SourcesService,
  StoreService,
  ThemeDefinition,
  ThemeService,
} from '@BBeBee/protocol'
import { sha256Hex } from '@BBeBee/protocol'
import { scanCode } from '@BBeBee/toolkit'
import { themeContrastIssues } from '@BBeBee/ui-tokens'
import { RegistryLockManager } from './lock.js'
import { createGitHubFetch } from './github-fetch.js'
import type { GitHubFetchLayer } from './github-fetch.js'
import { compareVersions, normalizeVersion } from './semver.js'
import {
  activeTaskFor,
  beginTask,
  clearFinished,
  completeTask,
  createTaskRegistry,
  failTask,
  holdTaskForConfirmation,
  setTaskProgress,
  setTaskStage,
  snapshotTasks,
} from './tasks.js'
import type { TaskRegistryState } from './tasks.js'
import { REGISTRY_VIEWS } from './views.js'
import {
  AUDIT_FINDINGS_KEY,
  CAPABILITY_MISMATCHES_KEY,
  buildDiagnosticsReport,
  dedupeEntriesById,
} from './diagnostics.js'
import type {
  RegistryAuditFindingsMap,
  RegistryCapabilityMismatchMap,
  RegistryIndexAnomalies,
} from './diagnostics.js'

/** GitHub Contents API base endpoint for community registry. Overridable via `registry.prefs`. */
const DEFAULT_CONTENTS_API = 'https://api.github.com/repos/BBeBeeX/B_Be_Bee-registry/contents'
const DEFAULT_REGISTRY_REPO = 'BBeBeeX/B_Be_Bee-registry'
const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main'

export const DEFAULT_ENDPOINT = DEFAULT_CONTENTS_API

const REGISTRY_DIRS: readonly { readonly dir: string; readonly kind: RegistryEntryKind }[] = [
  { dir: 'music-sources', kind: 'music-source' },
  { dir: 'lyric-sources', kind: 'lyric-source' },
  { dir: 'plugins', kind: 'plugin' },
  { dir: 'themes', kind: 'theme' },
]

/** Store key: the last good index, for offline use. */
const INDEX_CACHE_KEY = 'registry.index-cache'
/** Store key: user preferences — the endpoint override and the last check time. */
const PREFS_KEY = 'registry.prefs'

/** How long after boot the first automatic check runs. */
const AUTO_CHECK_DELAY_MS = 45_000
/** How often the automatic check repeats afterwards. */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

interface IndexCache {
  fetchedAt: number
  index: RegistryIndex
  /** Sanitizer anomalies from the fetch that produced this cache (optional for older caches). */
  anomalies?: RegistryIndexAnomalies
}

interface RegistryPrefs {
  endpoint?: string
  lastCheckAt?: number
}

export interface RegistryConfig {
  autoCheckDelayMs?: number
  autoCheckIntervalMs?: number
}

const ENTRY_KINDS: readonly RegistryEntryKind[] = ['music-source', 'lyric-source', 'theme', 'plugin']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return items.length ? items : undefined
}

export function parseGitHubRepo(repoUrlOrShorthand?: string): { owner: string; repo: string } | undefined {
  if (!repoUrlOrShorthand || typeof repoUrlOrShorthand !== 'string') return undefined
  const cleaned = repoUrlOrShorthand.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const match =
    cleaned.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)$/) ??
    cleaned.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/)
  if (match && match[1] && match[2]) {
    return { owner: match[1], repo: match[2] }
  }
  return undefined
}

export function checkCapabilitiesMatch(
  manifestCaps: readonly string[] = [],
  registryCaps: readonly string[] = [],
): { matches: boolean; missingInManifest: string[]; unexpectedInManifest: string[] } {
  const setM = new Set(manifestCaps)
  const setR = new Set(registryCaps)
  const missingInManifest = [...setR].filter((c) => !setM.has(c))
  const unexpectedInManifest = [...setM].filter((c) => !setR.has(c))
  return {
    matches: missingInManifest.length === 0 && unexpectedInManifest.length === 0,
    missingInManifest,
    unexpectedInManifest,
  }
}

/** Keep the entries a shape check can vouch for; drop the rest, with a count for the log. */
function sanitizeEntry(raw: unknown, defaultKind?: RegistryEntryKind): RegistryEntry | undefined {
  if (!isRecord(raw)) return undefined
  const { id, name } = raw
  const kind =
    typeof raw.kind === 'string' && ENTRY_KINDS.includes(raw.kind as RegistryEntryKind)
      ? (raw.kind as RegistryEntryKind)
      : defaultKind
  if (typeof id !== 'string' || !id) return undefined
  if (!kind) return undefined
  if (typeof name !== 'string' || !name) return undefined

  return {
    id,
    kind,
    name,
    version: optionalString(raw.version),
    author: optionalString(raw.author),
    description: optionalString(raw.description),
    updatedAt: optionalString(raw.updatedAt),
    downloadUrl: optionalString(raw.downloadUrl),
    minAppVersion: optionalString(raw.minAppVersion),
    sourceUrl: optionalString(raw.sourceUrl),
    previewUrl: optionalString(raw.previewUrl),
    repo: optionalString(raw.repo) ?? optionalString(raw.repoUrl),
    repoUrl: optionalString(raw.repoUrl) ?? optionalString(raw.repo),
    sha256: optionalString(raw.sha256),
    capabilities: optionalStringArray(raw.capabilities),
    category: optionalString(raw.category),
  }
}

function sanitizeIndex(raw: unknown): { index: RegistryIndex; dropped: number; duplicateIds: string[] } {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('registry: the index document is malformed (expected an object with an `entries` array)')
  }
  const entries: RegistryEntry[] = []
  let dropped = 0
  for (const item of raw.entries) {
    const entry = sanitizeEntry(item)
    if (entry) {
      entries.push(entry)
    } else {
      dropped++
    }
  }
  // Duplicate ids used to slip through; keep the first occurrence and record
  // the rest — the caller logs them and diagnostics surfaces them as conflicts.
  const { unique, duplicateIds } = dedupeEntriesById(entries)
  const index: RegistryIndex = {
    entries: unique,
    generatedAt: optionalString(raw.generatedAt),
    repository: optionalString(raw.repository),
  }
  return { index, dropped, duplicateIds }
}

function hasIndexShape(value: unknown): value is RegistryIndex {
  return isRecord(value) && Array.isArray(value.entries)
}

function documentVersion(docJson: string): string {
  try {
    const doc: unknown = JSON.parse(docJson)
    if (isRecord(doc) && typeof doc.version === 'string') return doc.version
  } catch {
    // Unversioned
  }
  return '0.0.0'
}

/** The text a task record keeps for a failure — the message, not the stack. */
function taskErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class RegistryPlugin extends Service implements RegistryService {
  static override readonly name = 'contentRegistry'
  static readonly inject = ['http']

  private readonly ownCtx: Context
  private readonly http: HttpService
  private readonly githubFetch: GitHubFetchLayer
  private readonly config: RegistryConfig

  /* ── optional collaborators, captured in init ── */
  private storeService?: StoreService
  private settingsService?: SettingsService
  private sourcesService?: SourcesService
  private lyricSourcesService?: LyricSourcesService
  private themeService?: ThemeService
  private pluginManagerService?: PluginManagerService
  private securityAuditService?: SecurityAuditService
  private fsService?: FsService
  private pathsService?: PathsService

  private lockManager: RegistryLockManager

  /**
   * The task center: in-memory records of install/update operations as they
   * move through download → verify → install. Deliberately not persisted — a
   * task is short-lived activity reporting, and a store would resurrect stale
   * "running" rows after a crash. Finished records are capped by the tasks
   * module; active ones are never trimmed.
   */
  private readonly tasks: TaskRegistryState = createTaskRegistry()

  /** The desktop-only bridge that installs a `{ manifest, files }` bundle. */
  private pluginInstaller?: (bundle: PluginInstallBundle) => Promise<void>

  /** The previous checkUpdates() result, for badges without re-fetching. */
  private lastUpdates: readonly RegistryUpdate[] = []

  /** When the last completed check ran, for the settings card. Hydrated from the store on init. */
  private lastCheckAt?: number

  /** Whether the most recent `getIndex()` had to fall back to the cached copy. */
  private indexFetchFailed = false

  /** When that most recent failure happened, for the diagnostics report. */
  private lastIndexFailureAt?: number

  /** Cancels the current auto-check timers; also registered as a fiber effect. */
  private autoCheckCancel?: () => void

  constructor(ctx: Context, config: RegistryConfig = {}) {
    super(ctx, 'contentRegistry')
    this.ownCtx = ctx
    this.config = config
    this.http = ctx.http
    this.githubFetch = createGitHubFetch({
      http: ctx.http,
      logger: ctx.logger,
      // Read on every request: the settings service is captured by the
      // init-time inject below, and region/prefix changes must apply live.
      getSettings: () => this.settingsService?.getSync(),
    })
    this.lockManager = new RegistryLockManager()
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-registry: initialized')

    this.ownCtx.inject(['store'], (scoped) => {
      this.storeService = scoped.store
      this.updateLockManager()
      void scoped.store
        .get<RegistryPrefs>(PREFS_KEY)
        .then((prefs) => {
          if (typeof prefs?.lastCheckAt === 'number') this.lastCheckAt = prefs.lastCheckAt
        })
        .catch(() => {})
    })

    this.ownCtx.inject(['fs', 'paths'], (scoped) => {
      this.fsService = scoped.fs
      this.pathsService = scoped.paths
      this.updateLockManager()
    })

    this.ownCtx.inject(['securityAudit'], (scoped) => {
      this.securityAuditService = scoped.securityAudit
    })

    this.ownCtx.inject(['settings'], (scoped) => {
      this.settingsService = scoped.settings
      this.setupAutoCheck(scoped)
    })

    this.ownCtx.inject(['sources'], (scoped) => {
      this.sourcesService = scoped.sources
    })

    this.ownCtx.inject(['lyricSources'], (scoped) => {
      this.lyricSourcesService = scoped.lyricSources
    })

    this.ownCtx.inject(['theme'], (scoped) => {
      this.themeService = scoped.theme
    })

    this.ownCtx.inject(['plugin-manager'], (scoped) => {
      this.pluginManagerService = scoped['plugin-manager']
    })

    this.ownCtx.inject(['ui'], (scoped) => {
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'route',
          id: REGISTRY_VIEWS.screen,
          path: '/registry',
          title: '发现',
          icon: 'compass',
          placement: ['tray'],
          order: 3,
        })
        yield scoped.ui.contribute({
          kind: 'settings',
          id: REGISTRY_VIEWS.settingsCard,
          section: 'sources',
          title: '注册表与更新',
          description: '浏览社区音乐源/歌词源/主题/插件，检查更新',
          display: 'card',
          order: 15,
        })
      }, 'registry-ui-contributions')
    })
  }

  private updateLockManager(): void {
    this.lockManager = new RegistryLockManager({
      fs: this.fsService,
      paths: this.pathsService,
      store: this.storeService,
    })
  }

  async getLockFile(): Promise<RegistryLockFile> {
    return this.lockManager.read()
  }

  async getLockRecord(id: string): Promise<RegistryLockRecord | undefined> {
    return this.lockManager.getRecord(id)
  }

  /* ── the index ─────────────────────────────────────────────────────────── */

  async getIndex(_force = false): Promise<RegistryIndex> {
    const { endpoint, overridden } = await this.resolveEndpoint()
    // A user-configured endpoint override *is* the official route: it is used
    // verbatim and never accelerated. The default GitHub endpoints walk the
    // full candidate chain (official → jsDelivr → custom prefixes).
    const endpointOpts = overridden ? { onlyOfficial: true } : undefined
    try {
      // 1. Direct index check: if endpoint directly returns an index with entries (e.g. test mock or mirror)
      let directRaw: unknown
      try {
        directRaw = await this.http.get<unknown>(endpoint)
      } catch {
        // endpoint may be a base contents directory url that only responds to subpaths
      }

      if (hasIndexShape(directRaw)) {
        const { index, dropped, duplicateIds } = sanitizeIndex(directRaw)
        this.warnIndexAnomalies(dropped, duplicateIds, 'the index')
        await this.writeIndexCache(index, { dropped, duplicateIds })
        this.indexFetchFailed = false
        return index
      }

      // If pointing directly to a .json file that wasn't an index shape, sanitizeIndex will error
      if (endpoint.endsWith('.json') && directRaw !== undefined) {
        const { index, dropped, duplicateIds } = sanitizeIndex(directRaw)
        this.warnIndexAnomalies(dropped, duplicateIds, 'direct index')
        await this.writeIndexCache(index, { dropped, duplicateIds })
        this.indexFetchFailed = false
        return index
      }

      // 2. Otherwise, discover entries via GitHub Contents API across four directories
      const entries: RegistryEntry[] = []
      let totalDropped = 0

      const contentsBase = endpoint.endsWith('/contents')
        ? endpoint
        : endpoint.includes('api.github.com')
          ? endpoint
          : DEFAULT_CONTENTS_API

      for (const { dir, kind } of REGISTRY_DIRS) {
        try {
          const dirUrl = `${contentsBase}/${dir}`
          const items = await this.githubFetch.getJson<unknown>(dirUrl, endpointOpts)
          if (!Array.isArray(items)) continue

          for (const item of items) {
            if (!isRecord(item)) continue
            const itemName = typeof item.name === 'string' ? item.name : ''
            const itemType = typeof item.type === 'string' ? item.type : ''
            const downloadUrl = typeof item.download_url === 'string' ? item.download_url : undefined

            let rawEntry: unknown = undefined
            if ((itemType === 'file' || !itemType) && itemName.endsWith('.json')) {
              const fileUrl = downloadUrl ?? `${DEFAULT_RAW_BASE}/${dir}/${itemName}`
              try {
                rawEntry = await this.githubFetch.getJson<unknown>(fileUrl)
              } catch {
                totalDropped++
                continue
              }
            } else if (itemType === 'dir') {
              let metaUrl: string | undefined
              if (dir === 'themes') {
                metaUrl = `${DEFAULT_RAW_BASE}/themes/${itemName}/theme.json`
              } else if (dir === 'music-sources') {
                metaUrl = `${DEFAULT_RAW_BASE}/dist/music-sources/${itemName}.json`
              } else if (dir === 'lyric-sources') {
                metaUrl = `${DEFAULT_RAW_BASE}/dist/lyric-sources/${itemName}.json`
              } else if (dir === 'plugins') {
                metaUrl = `${DEFAULT_RAW_BASE}/plugins/${itemName}.json`
              }
              if (metaUrl) {
                try {
                  rawEntry = await this.githubFetch.getJson<unknown>(metaUrl)
                } catch {
                  // directory without compiled meta
                }
              }
            }

            if (rawEntry) {
              const entry = sanitizeEntry(rawEntry, kind)
              if (entry) {
                entries.push(entry)
              } else {
                totalDropped++
              }
            }
          }
        } catch (dirErr) {
          // Fallback to single registry.json if available before failing to local cache
          try {
            const legacyRaw = await this.githubFetch.getJson<unknown>(
              DEFAULT_RAW_BASE + '/registry.json',
            )
            if (hasIndexShape(legacyRaw)) {
              const { index, dropped, duplicateIds } = sanitizeIndex(legacyRaw)
              this.warnIndexAnomalies(dropped, duplicateIds, 'fallback registry.json')
              await this.writeIndexCache(index, { dropped, duplicateIds })
              this.indexFetchFailed = false
              return index
            }
          } catch {
            // ignore
          }
          this.ownCtx.logger.warn(`registry: failed to read contents of "${dir}": ${String(dirErr)}`)
          throw dirErr
        }
      }

      if (totalDropped > 0) {
        this.ownCtx.logger.warn(`registry: dropped ${totalDropped} malformed entries during discovery`)
      }

      // Discovery can also produce duplicate ids (two directories publishing
      // the same id); run the same keep-first dedupe the direct paths use.
      const { unique, duplicateIds } = dedupeEntriesById(entries)
      if (duplicateIds.length > 0) {
        this.ownCtx.logger.warn(`registry: dropped ${duplicateIds.length} duplicate index id${duplicateIds.length === 1 ? '' : 's'}: ${duplicateIds.join(', ')}`)
      }

      const index: RegistryIndex = {
        repository: DEFAULT_REGISTRY_REPO,
        generatedAt: new Date().toISOString(),
        entries: unique,
      }

      await this.writeIndexCache(index, { dropped: totalDropped, duplicateIds })
      this.indexFetchFailed = false
      return index
    } catch (err) {
      this.indexFetchFailed = true
      this.lastIndexFailureAt = Date.now()
      this.ownCtx.logger.warn(
        `registry: failed to fetch the index from ${endpoint}, falling back to the last good copy: ${String(err)}`,
      )
      return (await this.readIndexCache()) ?? { entries: [] }
    }
  }

  lastIndexFetchFailed(): boolean {
    return this.indexFetchFailed
  }

  /* ── diagnostics (§1.5) ──────────────────────────────────────────────────── */

  /**
   * Builds a diagnostics report from real service state only: the lock file,
   * the persisted audit findings and capability mismatches, the index cache
   * (entries, anomalies, age), the download layer's failure status and the
   * installed-content services. Never invents a datum; a group with no source
   * behind it stays empty.
   */
  async getDiagnostics(): Promise<RegistryDiagnosticsReport> {
    const [lock, auditFindings, capabilityMismatches, cacheRecord] = await Promise.all([
      this.lockManager.read(),
      this.readStoreMap<RegistryAuditFindingsMap>(AUDIT_FINDINGS_KEY),
      this.readStoreMap<RegistryCapabilityMismatchMap>(CAPABILITY_MISMATCHES_KEY),
      this.readIndexCacheRecord(),
    ])

    const installedMusicSources = (this.sourcesService?.sources ?? []).map((record) => ({
      sourceUrl: record.sourceUrl,
      docVersion: documentVersion(record.docJson),
      name: record.name,
    }))
    const installedLyricSources = (this.lyricSourcesService?.getSources() ?? []).map((source) => ({
      id: source.id,
      version: typeof source.version === 'string' ? source.version : undefined,
    }))
    const installedThemes = (this.themeService?.getThemes() ?? []).map((theme) => ({
      id: theme.id,
      version: typeof theme.version === 'string' ? theme.version : undefined,
    }))
    const installedPlugins = (this.pluginManagerService?.list() ?? []).map((info) => ({
      id: info.id,
      version: typeof info.version === 'string' ? info.version : undefined,
      dependencies: info.dependencies,
    }))

    return buildDiagnosticsReport({
      now: Date.now(),
      auditFindings,
      capabilityMismatches,
      lockRecords: lock.records,
      indexEntries: cacheRecord?.index.entries ?? [],
      indexAnomalies: cacheRecord?.anomalies,
      indexFetchFailed: this.indexFetchFailed,
      lastIndexFailureAt: this.lastIndexFailureAt,
      lastChainFailure: this.githubFetch.lastChainFailure?.(),
      indexCacheFetchedAt: cacheRecord?.fetchedAt,
      installed: {
        musicSources: installedMusicSources,
        lyricSources: installedLyricSources,
        themes: installedThemes,
        plugins: installedPlugins,
      },
    })
  }

  /**
   * Re-runs `fetchEntryDetails` (static security scan included) for one entry
   * and refreshes its stored audit findings / capability-mismatch records.
   * Detection only — nothing is installed, so the install-stage `confirmed`
   * gate never applies here. The entry is looked up in the cached index; a
   * rescan against the live index is the user's "刷新" away.
   */
  async rescanEntry(entryId: string): Promise<void> {
    const entry = (await this.readIndexCache())?.entries.find((candidate) => candidate.id === entryId)
    if (!entry) {
      throw new Error(
        `registry: cannot rescan "${entryId}" — the entry is not in the cached index; refresh the index first`,
      )
    }
    // Both record writes happen inside fetchEntryDetails (findings on success,
    // capability mismatch before its throw), so a rethrown network error still
    // leaves whatever was actually observed persisted.
    await this.fetchEntryDetails(entry, { trackTask: false })
  }

  /* ── task center (§4.1) ─────────────────────────────────────────────────── */

  /** The full task snapshot — active records plus the capped finished history, newest first. */
  getTasks(): readonly RegistryTask[] {
    return snapshotTasks(this.tasks)
  }

  /** Drops every finished (success/failed) record; pending/running ones stay. */
  clearFinishedTasks(): void {
    const removed = clearFinished(this.tasks)
    if (removed > 0) {
      this.ownCtx.logger.info(`[registry-tasks] cleared ${removed} finished task${removed === 1 ? '' : 's'}`)
      this.emitTasksChanged()
    }
  }

  private emitTasksChanged(): void {
    this.safeEmit(() => this.ownCtx.emit('registry/tasks-changed', snapshotTasks(this.tasks)))
  }

  /** Begins (or resumes) the task record for one entry — `running`, stage `download`. */
  private trackBegin(entry: RegistryEntry): void {
    beginTask(this.tasks, { entryId: entry.id, entryName: entry.name, kind: entry.kind, now: Date.now() })
    this.ownCtx.logger.info(`[registry-tasks] tracking "${entry.id}" (${entry.kind}) from the download stage`)
    this.emitTasksChanged()
  }

  /** Stage reporting at the natural checkpoints; a no-op without a tracked running task. */
  private trackStage(entryId: string, stage: RegistryTask['stage']): void {
    if (!activeTaskFor(this.tasks, entryId)) return
    setTaskStage(this.tasks, entryId, stage)
    this.emitTasksChanged()
  }

  /** Attach naturally-known progress (artifact counts); never a synthesized percentage. */
  private trackProgress(entryId: string, progress: { done: number; total: number }): void {
    if (!activeTaskFor(this.tasks, entryId)) return
    setTaskProgress(this.tasks, entryId, progress)
    this.emitTasksChanged()
  }

  /** Fetch succeeded, install not started — the "等待确认" state before the dialog is confirmed. */
  private trackHoldForConfirmation(entryId: string): void {
    if (!activeTaskFor(this.tasks, entryId)) return
    holdTaskForConfirmation(this.tasks, entryId)
    this.emitTasksChanged()
  }

  private trackComplete(entryId: string): void {
    if (!activeTaskFor(this.tasks, entryId)) return
    completeTask(this.tasks, entryId, Date.now())
    this.ownCtx.logger.info(`[registry-tasks] task for "${entryId}" completed`)
    this.emitTasksChanged()
  }

  private trackFail(entryId: string, err: unknown): void {
    if (!activeTaskFor(this.tasks, entryId)) return
    failTask(this.tasks, entryId, taskErrorMessage(err), Date.now())
    this.ownCtx.logger.warn(`[registry-tasks] task for "${entryId}" failed: ${String(err)}`)
    this.emitTasksChanged()
  }

  /** Read a persisted diagnostics map, tolerating a missing store or garbage. */
  private async readStoreMap<T extends Record<string, unknown>>(key: string): Promise<T> {
    try {
      const value = await this.storeService?.get<T>(key)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch (err) {
      this.ownCtx.logger.warn(`[registry-diagnostics] failed to read "${key}" from the store: ${String(err)}`)
    }
    return {} as T
  }

  /**
   * Persist the outcome of one security scan. Only block/warn reports are
   * kept — a passing scan deletes the entry's record, so a fixed document
   * stops showing up as a risk after a rescan.
   */
  private async recordAuditFindings(entryId: string, audit: SecurityAuditReport | undefined): Promise<void> {
    if (!this.storeService || !audit) return
    try {
      const map = await this.readStoreMap<RegistryAuditFindingsMap>(AUDIT_FINDINGS_KEY)
      if (audit.level === 'pass' || audit.findings.length === 0) {
        delete map[entryId]
      } else {
        map[entryId] = { level: audit.level === 'block' ? 'block' : 'warn', findings: [...audit.findings], checkedAt: Date.now() }
      }
      await this.storeService.set<RegistryAuditFindingsMap>(AUDIT_FINDINGS_KEY, map)
    } catch (err) {
      this.ownCtx.logger.warn(`[registry-diagnostics] failed to persist audit findings for "${entryId}": ${String(err)}`)
    }
  }

  /** Persist one manifest-vs-registry capabilities mismatch, keyed by entry id. */
  private async recordCapabilityMismatch(entry: RegistryEntry, manifestCaps: readonly string[]): Promise<void> {
    if (!this.storeService) return
    try {
      const map = await this.readStoreMap<RegistryCapabilityMismatchMap>(CAPABILITY_MISMATCHES_KEY)
      map[entry.id] = {
        entryId: entry.id,
        expected: [...(entry.capabilities ?? [])],
        actual: [...manifestCaps],
        checkedAt: Date.now(),
      }
      await this.storeService.set<RegistryCapabilityMismatchMap>(CAPABILITY_MISMATCHES_KEY, map)
    } catch (err) {
      this.ownCtx.logger.warn(`[registry-diagnostics] failed to record capability mismatch for "${entry.id}": ${String(err)}`)
    }
  }

  /* ── update checks ─────────────────────────────────────────────────────── */

  async checkUpdates(): Promise<readonly RegistryUpdate[]> {
    const index = await this.getIndex(true)
    const updates: RegistryUpdate[] = []

    if (this.sourcesService) {
      const bySourceUrl = new Map(this.sourcesService.sources.map((record) => [record.sourceUrl, record]))
      for (const entry of index.entries) {
        if (entry.kind !== 'music-source' || !entry.version || !entry.sourceUrl) continue
        const record = bySourceUrl.get(entry.sourceUrl)
        if (!record) continue
        const installed = documentVersion(record.docJson)
        if (compareVersions(entry.version, installed) > 0) {
          updates.push(this.updateFor(entry, installed))
        }
      }
    }

    if (this.lyricSourcesService) {
      const byId = new Map(this.lyricSourcesService.getSources().map((source) => [source.id, source]))
      for (const entry of index.entries) {
        if (entry.kind !== 'lyric-source' || !entry.version) continue
        const source = byId.get(entry.id)
        if (!source) continue
        const installed = typeof source.version === 'string' ? source.version : '0.0.0'
        if (compareVersions(entry.version, installed) > 0) {
          updates.push(this.updateFor(entry, installed, entry.id.startsWith('builtin-')))
        }
      }
    }

    if (this.themeService) {
      const byId = new Map(this.themeService.getThemes().map((theme) => [theme.id, theme]))
      for (const entry of index.entries) {
        if (entry.kind !== 'theme' || !entry.version) continue
        const theme = byId.get(entry.id)
        if (!theme) continue
        const installed = typeof theme.version === 'string' ? theme.version : '0.0.0'
        if (compareVersions(entry.version, installed) > 0) {
          updates.push(this.updateFor(entry, installed))
        }
      }
    }

    if (this.pluginManagerService) {
      const byId = new Map(this.pluginManagerService.list().map((info) => [info.id, info]))
      for (const entry of index.entries) {
        if (entry.kind !== 'plugin' || !entry.version) continue
        const info = byId.get(entry.id)
        if (!info) continue
        const installed = typeof info.version === 'string' ? info.version : '0.0.0'
        if (compareVersions(entry.version, installed) > 0) {
          updates.push(this.updateFor(entry, installed))
        }
      }
    }

    this.lastUpdates = updates
    await this.touchLastCheckAt()

    this.safeEmit(() => this.ownCtx.emit('registry/updates-available', updates))
    return updates
  }

  updates(): readonly RegistryUpdate[] {
    return this.lastUpdates
  }

  lastCheckedAt(): number | undefined {
    return this.lastCheckAt
  }

  private updateFor(entry: RegistryEntry, installedVersion: string, builtin?: boolean): RegistryUpdate {
    return {
      kind: entry.kind,
      id: entry.id,
      name: entry.name,
      installedVersion: normalizeVersion(installedVersion),
      availableVersion: normalizeVersion(entry.version),
      ...(entry.downloadUrl ? { downloadUrl: entry.downloadUrl } : {}),
      ...(builtin ? { builtin: true } : {}),
    }
  }

  /* ── security scan & author repo resolution ────────────────────────────── */

  private scanCode(code: string, context?: SecurityAuditContext): SecurityAuditReport {
    if (this.securityAuditService) {
      return this.securityAuditService.scan(code, context)
    }
    return scanCode(code, context)
  }

  private async resolveAuthorRepoCommit(
    owner: string,
    repo: string,
  ): Promise<{ commit: string; defaultBranch: string }> {
    try {
      const commitData = await this.githubFetch.getJson<{ sha?: string }>(
        `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`,
      )
      if (commitData && typeof commitData.sha === 'string' && commitData.sha) {
        return { commit: commitData.sha, defaultBranch: 'main' }
      }
    } catch {
      // Fall back to querying repo default branch
    }

    try {
      const repoData = await this.githubFetch.getJson<{ default_branch?: string }>(
        `https://api.github.com/repos/${owner}/${repo}`,
      )
      const branch = repoData.default_branch || 'main'
      const branchCommit = await this.githubFetch.getJson<{ sha?: string }>(
        `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
      )
      if (branchCommit?.sha) {
        return { commit: branchCommit.sha, defaultBranch: branch }
      }
    } catch (err) {
      throw new Error(`registry: failed to resolve author repository "https://github.com/${owner}/${repo}": ${String(err)}`, { cause: err })
    }

    throw new Error(`registry: author repository "https://github.com/${owner}/${repo}" is unreachable or has no commits`)
  }

  /* ── the confirm dialog's inputs ───────────────────────────────────────── */

  /**
   * Fetches the distribution document for an entry and returns what the
   * confirm dialog must show.
   *
   * Every user-facing fetch is also a task-center event: a task begins at the
   * `download` stage and, on success, parks at `pending` ("等待确认") until
   * the install actually starts. `rescanEntry` runs the same fetch with
   * `trackTask: false` — a diagnostics rescan is not a user install flow and
   * must not plant task rows.
   */
  async fetchEntryDetails(
    entry: RegistryEntry,
    opts?: { trackTask?: boolean },
  ): Promise<RegistryEntryDetails> {
    const track = opts?.trackTask ?? true
    if (track) this.trackBegin(entry)
    try {
      const details = await this.fetchEntryDetailsForEntry(entry)
      if (track) this.trackHoldForConfirmation(entry.id)
      return details
    } catch (err) {
      if (track) this.trackFail(entry.id, err)
      throw err
    }
  }

  private async fetchEntryDetailsForEntry(entry: RegistryEntry): Promise<RegistryEntryDetails> {
    const repoInfo = parseGitHubRepo(entry.repoUrl ?? entry.repo)
    const prevLock = await this.lockManager.getRecord(entry.id)

    if (entry.kind === 'music-source' || entry.kind === 'lyric-source') {
      let docText: string
      let commit: string | undefined
      let repoUrl: string | undefined

      if (repoInfo) {
        repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
        const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
        commit = resolved.commit
        const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/index.json`
        try {
          docText = await (await this.fetchDocument(rawUrl, entry.id)).text()
        } catch (err) {
          throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
        }
      } else {
        const url = this.requireDownloadUrl(entry)
        docText = await (await this.fetchDocument(url, entry.id)).text()
      }

      let doc: unknown
      try {
        doc = JSON.parse(docText)
      } catch {
        // ignore malformed preview
      }

      const hosts: string[] = []
      if (entry.sourceUrl) {
        try {
          hosts.push(new URL(entry.sourceUrl).hostname)
        } catch {
          // ignore
        }
      }
      if (isRecord(doc)) {
        if (typeof doc.sourceUrl === 'string' && doc.sourceUrl) {
          try {
            hosts.push(new URL(doc.sourceUrl).hostname)
          } catch {
            // ignore
          }
        }
        const declared = optionalStringArray(doc.allowedHosts)
        if (declared) hosts.push(...declared)
      }
      const allowedHosts = hosts.length ? [...new Set(hosts)] : undefined
      this.trackStage(entry.id, 'verify')
      const securityAudit = this.scanCode(docText, { allowedHosts })

      let commitDiff: { previousCommit?: string; currentCommit: string } | undefined
      if (prevLock && commit && prevLock.commit !== commit) {
        commitDiff = { previousCommit: prevLock.commit, currentCommit: commit }
      }

      const existing =
        entry.kind === 'music-source' && entry.sourceUrl
          ? this.sourcesService?.sources.find((r) => r.sourceUrl === entry.sourceUrl)
          : undefined

      const details: RegistryEntryDetails = {
        entry,
        ...(allowedHosts ? { allowedHosts } : {}),
        isBuiltinInstall: entry.kind === 'lyric-source' ? entry.id.startsWith('builtin-') : false,
        ...(existing?.locallyModified ? { isLocallyModified: true } : {}),
        securityAudit,
        ...(repoUrl ? { repoUrl } : {}),
        ...(commit ? { commit } : {}),
        ...(commitDiff ? { commitDiff } : {}),
      }
      // The scan result is otherwise discarded between the confirm dialog and
      // the install call; persist it so the diagnostics page can report risks
      // without refetching.
      await this.recordAuditFindings(entry.id, securityAudit)
      return details
    }

    if (entry.kind === 'plugin') {
      if (repoInfo) {
        const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
        const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
        const commit = resolved.commit

        const manifestUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/manifest.json`
        const indexUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/index.js`

        let manifest: PluginManifest
        let indexJsCode: string
        try {
          manifest = await (await this.fetchDocument(manifestUrl, entry.id)).json<PluginManifest>()
        } catch (err) {
          throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root manifest.json (${String(err)})`, { cause: err })
        }

        try {
          indexJsCode = await (await this.fetchDocument(indexUrl, entry.id)).text()
        } catch (err) {
          throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.js (${String(err)})`, { cause: err })
        }

        const capCheck = checkCapabilitiesMatch(manifest.capabilities ?? [], entry.capabilities ?? [])
        if (!capCheck.matches) {
          const diffs: string[] = []
          if (capCheck.unexpectedInManifest.length) {
            diffs.push(`manifest 申请但未在注册表声明: [${capCheck.unexpectedInManifest.join(', ')}]`)
          }
          if (capCheck.missingInManifest.length) {
            diffs.push(`注册表声明但 manifest 未申请: [${capCheck.missingInManifest.join(', ')}]`)
          }
          // Recorded before the throw so the diagnostics page can name the
          // mismatch even though no details were produced.
          await this.recordCapabilityMismatch(entry, manifest.capabilities ?? [])
          throw new Error(
            `registry: plugin "${entry.id}" capabilities mismatch between manifest and registry metadata: ${diffs.join('; ')}`,
          )
        }

        this.trackStage(entry.id, 'verify')
        const securityAudit = this.scanCode(indexJsCode)

        let commitDiff: { previousCommit?: string; currentCommit: string } | undefined
        if (prevLock && commit && prevLock.commit !== commit) {
          commitDiff = { previousCommit: prevLock.commit, currentCommit: commit }
        }

        const details: RegistryEntryDetails = {
          entry,
          securityAudit,
          repoUrl,
          commit,
          ...(commitDiff ? { commitDiff } : {}),
        }
        await this.recordAuditFindings(entry.id, securityAudit)
        return details
      }

      // Legacy bundle details
      let securityAudit: SecurityAuditReport | undefined
      if (entry.downloadUrl) {
        try {
          const url = this.requireDownloadUrl(entry)
          const bytes = await (await this.fetchDocument(url, entry.id)).bytes()
          const bundle: unknown = JSON.parse(new TextDecoder().decode(bytes))
          if (isRecord(bundle) && isRecord(bundle.files) && typeof bundle.files['index.js'] === 'string') {
            this.trackStage(entry.id, 'verify')
            securityAudit = this.scanCode(bundle.files['index.js'] as string)
          }
        } catch {
          // ignore details fetch failure for legacy bundle
        }
      }

      const details: RegistryEntryDetails = {
        entry,
        ...(securityAudit ? { securityAudit } : {}),
      }
      await this.recordAuditFindings(entry.id, securityAudit)
      return details
    }

    // Theme
    return { entry }
  }

  /* ── installs ──────────────────────────────────────────────────────────── */

  /**
   * Installs/updates one entry. The caller must already have shown the user
   * the details (hosts / plugin risk).
   *
   * The install is one task-center operation: it resumes the entry's pending
   * ("等待确认") record — or starts one when the service is called directly
   * without a fetch — runs it back through `download`, and finalizes it as
   * `success` or `failed` with the extracted error text.
   */
  async install(entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }): Promise<void> {
    this.trackBegin(entry)
    try {
      await this.installEntry(entry, opts)
      this.trackComplete(entry.id)
    } catch (err) {
      this.trackFail(entry.id, err)
      throw err
    }
  }

  private async installEntry(
    entry: RegistryEntry,
    opts?: { confirmed?: boolean; overwrite?: boolean },
  ): Promise<void> {
    switch (entry.kind) {
      case 'music-source':
        return this.installMusicSource(entry, opts)
      case 'lyric-source':
        return this.installLyricSource(entry, opts)
      case 'theme':
        return this.installTheme(entry)
      case 'plugin':
        return this.installPlugin(entry, opts)
    }
  }

  private async installMusicSource(
    entry: RegistryEntry,
    opts?: { confirmed?: boolean; overwrite?: boolean },
  ): Promise<void> {
    const repoInfo = parseGitHubRepo(entry.repoUrl ?? entry.repo)
    let text: string
    let originUri: string
    let repoUrl: string
    let commit: string

    if (repoInfo) {
      repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
      const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
      commit = resolved.commit
      originUri = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/index.json`
      try {
        text = await (await this.fetchDocument(originUri, entry.id)).text()
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
      }
    } else {
      originUri = this.requireDownloadUrl(entry)
      repoUrl = originUri
      commit = entry.version ?? '0.0.0'
      text = await (await this.fetchDocument(originUri, entry.id)).text()
    }

    const sha256 = sha256Hex(text)

    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      // ignore, ctx.sources.import will report format errors
    }
    const hosts: string[] = []
    if (entry.sourceUrl) {
      try {
        hosts.push(new URL(entry.sourceUrl).hostname)
      } catch {
        // ignore
      }
    }
    if (isRecord(doc)) {
      if (typeof doc.sourceUrl === 'string' && doc.sourceUrl) {
        try {
          hosts.push(new URL(doc.sourceUrl).hostname)
        } catch {
          // ignore
        }
      }
      const declared = optionalStringArray(doc.allowedHosts)
      if (declared) hosts.push(...declared)
    }
    const allowedHosts = hosts.length ? [...new Set(hosts)] : undefined
    this.trackStage(entry.id, 'verify')
    const audit = this.scanCode(text, { allowedHosts })
    if (audit.level === 'block' && !opts?.confirmed) {
      throw new Error(`registry: security audit blocked installation of "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`)
    }

    this.trackStage(entry.id, 'install')
    const report = await this.requireSources().import(text, {
      originUri,
      overwrite: opts?.overwrite,
    })

    const matched = entry.sourceUrl
      ? report.added.some((r) => r.sourceUrl === entry.sourceUrl) ||
        report.updated.some((u) => u.record.sourceUrl === entry.sourceUrl) ||
        report.unchanged.some((r) => r.sourceUrl === entry.sourceUrl)
      : report.added.length + report.updated.length + report.unchanged.length > 0

    if (matched) {
      await this.lockManager.setRecord({
        id: entry.id,
        kind: 'music-source',
        repo: repoUrl,
        commit,
        sha256,
        installedAt: Date.now(),
      })
      return
    }

    const reasons = [
      ...report.rejected.map((r) => `${r.sourceName ?? `#${r.index}`}: ${r.error.message}`),
      ...report.conflicts.map(
        (c) => `${c.record.name}: edited locally (needs overwrite: ${c.changedFields.join(', ')})`,
      ),
    ]
    throw new Error(
      `registry: the document for "${entry.id}" was not imported — ${reasons.join('; ') || 'the report listed no accepted document'}`,
    )
  }

  private async installLyricSource(
    entry: RegistryEntry,
    opts?: { confirmed?: boolean },
  ): Promise<void> {
    const repoInfo = parseGitHubRepo(entry.repoUrl ?? entry.repo)
    let doc: unknown
    let repoUrl: string
    let commit: string
    let rawText: string

    if (repoInfo) {
      repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
      const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
      commit = resolved.commit
      const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/index.json`
      try {
        rawText = await (await this.fetchDocument(rawUrl, entry.id)).text()
        doc = JSON.parse(rawText)
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
      }
    } else {
      const url = this.requireDownloadUrl(entry)
      repoUrl = url
      commit = entry.version ?? '0.0.0'
      rawText = await (await this.fetchDocument(url, entry.id)).text()
      doc = JSON.parse(rawText)
    }

    if (
      !isRecord(doc) ||
      typeof doc.id !== 'string' || !doc.id.trim() ||
      typeof doc.name !== 'string' || !doc.name.trim() ||
      typeof doc.script !== 'string' || !doc.script.trim()
    ) {
      throw new Error(`registry: the lyric source document for "${entry.id}" is missing non-empty id/name/script fields`)
    }

    const sha256 = sha256Hex(rawText)
    this.trackStage(entry.id, 'verify')
    const audit = this.scanCode(doc.script as string, { allowedHosts: optionalStringArray(doc.allowedHosts) })
    if (audit.level === 'block' && !opts?.confirmed) {
      throw new Error(`registry: security audit blocked installation of lyric source "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`)
    }

    this.trackStage(entry.id, 'install')
    await this.requireLyricSources().registerSource(doc as unknown as LyricSourceDefinition)
    await this.lockManager.setRecord({
      id: entry.id,
      kind: 'lyric-source',
      repo: repoUrl,
      commit,
      sha256,
      installedAt: Date.now(),
    })
  }

  private async installTheme(entry: RegistryEntry): Promise<void> {
    let doc: unknown
    let rawText: string
    let repoUrl: string
    let commit: string

    const repoInfo = parseGitHubRepo(entry.repoUrl ?? entry.repo)
    if (repoInfo) {
      repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
      const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
      commit = resolved.commit
      const rawUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/theme.json`
      rawText = await (await this.fetchDocument(rawUrl, entry.id)).text()
      doc = JSON.parse(rawText)
    } else {
      const url = this.requireDownloadUrl(entry)
      repoUrl = url
      commit = entry.version ?? '0.0.0'
      rawText = await (await this.fetchDocument(url, entry.id)).text()
      doc = JSON.parse(rawText)
    }

    if (
      !isRecord(doc) ||
      typeof doc.id !== 'string' || !doc.id ||
      typeof doc.name !== 'string' || !doc.name ||
      typeof doc.isDark !== 'boolean' ||
      !isRecord(doc.tokens)
    ) {
      throw new Error(`registry: the theme document for "${entry.id}" is missing id/name/isDark/tokens`)
    }
    const theme = doc as unknown as ThemeDefinition

    // The contrast gate is the theme path's verification stage — it is what
    // can still reject the artifact before the domain lands it.
    this.trackStage(entry.id, 'verify')
    const issues = [...themeContrastIssues(theme, 'dark'), ...themeContrastIssues(theme, 'light')]
    if (issues.length) {
      const detail = issues
        .map((i) => `${i.pair} (${i.scheme}): ${i.ratio.toFixed(2)} < ${i.required}`)
        .join('; ')
      throw new Error(`registry: the theme "${entry.id}" failed the contrast check — ${detail}`)
    }

    this.trackStage(entry.id, 'install')
    this.requireTheme().registerTheme(theme)
    await this.lockManager.setRecord({
      id: entry.id,
      kind: 'theme',
      repo: repoUrl,
      commit,
      sha256: sha256Hex(rawText),
      installedAt: Date.now(),
    })
  }

  private async installPlugin(
    entry: RegistryEntry,
    opts?: { confirmed?: boolean },
  ): Promise<void> {
    const repoInfo = parseGitHubRepo(entry.repoUrl ?? entry.repo)

    if (repoInfo) {
      const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`
      const resolved = await this.resolveAuthorRepoCommit(repoInfo.owner, repoInfo.repo)
      const commit = resolved.commit

      const manifestUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/manifest.json`
      const indexUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${commit}/index.js`

      let manifest: PluginManifest
      let indexJsCode: string
      try {
        manifest = await (await this.fetchDocument(manifestUrl, entry.id)).json<PluginManifest>()
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root manifest.json (${String(err)})`, { cause: err })
      }

      try {
        indexJsCode = await (await this.fetchDocument(indexUrl, entry.id)).text()
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.js (${String(err)})`, { cause: err })
      }

      const capCheck = checkCapabilitiesMatch(manifest.capabilities ?? [], entry.capabilities ?? [])
      if (!capCheck.matches) {
        const diffs: string[] = []
        if (capCheck.unexpectedInManifest.length) {
          diffs.push(`manifest 申请但未在注册表声明: [${capCheck.unexpectedInManifest.join(', ')}]`)
        }
        if (capCheck.missingInManifest.length) {
          diffs.push(`注册表声明但 manifest 未申请: [${capCheck.missingInManifest.join(', ')}]`)
        }
        await this.recordCapabilityMismatch(entry, manifest.capabilities ?? [])
        throw new Error(
          `registry: plugin "${entry.id}" capabilities mismatch between manifest and registry metadata: ${diffs.join('; ')}`,
        )
      }

      this.trackStage(entry.id, 'verify')
      const audit = this.scanCode(indexJsCode)
      if (audit.level === 'block' && !opts?.confirmed) {
        throw new Error(
          `registry: security audit blocked installation of plugin "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`,
        )
      }

      const installer = this.pluginInstaller
      if (!installer) {
        throw new Error('registry: plugin install is only supported on desktop')
      }

      const bundle: PluginInstallBundle = {
        manifest,
        files: { 'index.js': indexJsCode },
      }
      this.trackStage(entry.id, 'install')
      await installer(bundle)

      await this.lockManager.setRecord({
        id: entry.id,
        kind: 'plugin',
        repo: repoUrl,
        commit,
        sha256: sha256Hex(indexJsCode),
        installedAt: Date.now(),
      })
      return
    }

    // Legacy bundle downloadUrl
    const url = this.requireDownloadUrl(entry)
    const bytes = await (await this.fetchDocument(url, entry.id)).bytes()

    if (!entry.sha256) {
      throw new Error(`registry: the plugin entry "${entry.id}" publishes no sha256 digest; refusing to install unverified code`)
    }
    this.trackStage(entry.id, 'verify')
    const digest = sha256Hex(bytes)
    const expected = entry.sha256.trim().toLowerCase()
    if (digest !== expected) {
      throw new Error(`registry: the plugin bundle for "${entry.id}" failed the integrity check (expected ${expected}, got ${digest})`)
    }

    const bundle: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isRecord(bundle) || !isRecord(bundle.manifest) || !isRecord(bundle.files)) {
      throw new Error(`registry: the plugin bundle for "${entry.id}" must be a JSON object with manifest and files`)
    }
    const files: Record<string, string> = {}
    for (const [name, value] of Object.entries(bundle.files)) {
      if (typeof value !== 'string') {
        throw new Error(`registry: the plugin bundle for "${entry.id}" has a non-string file entry "${name}"`)
      }
      files[name] = value
    }
    const manifest = bundle.manifest as unknown as PluginManifest
    const main = manifest.entry?.main
    if (
      typeof manifest.id !== 'string' || !manifest.id ||
      typeof manifest.version !== 'string' || !manifest.version ||
      typeof main !== 'string' || !main
    ) {
      throw new Error(`registry: the manifest in the bundle for "${entry.id}" is missing id/version/entry.main`)
    }

    if (files['index.js']) {
      const audit = this.scanCode(files['index.js'])
      if (audit.level === 'block' && !opts?.confirmed) {
        throw new Error(`registry: security audit blocked installation of plugin "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`)
      }
    }

    const installer = this.pluginInstaller
    if (!installer) {
      throw new Error('registry: plugin install is only supported on desktop')
    }
    // The one place the code naturally knows a count: the bundle's file
    // inventory. No synthetic percentage is fabricated on top of it.
    this.trackProgress(entry.id, { done: 0, total: Object.keys(files).length })
    this.trackStage(entry.id, 'install')
    await installer({ manifest, files })

    await this.lockManager.setRecord({
      id: entry.id,
      kind: 'plugin',
      repo: url,
      commit: entry.version ?? '0.0.0',
      sha256: digest,
      installedAt: Date.now(),
    })
  }

  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void {
    this.pluginInstaller = installer
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  /**
   * The unified download choke point: every artifact fetch walks the
   * github-fetch acceleration chain here. When the caller passes the entry it
   * is fetching for, the download stage is reported to the task center —
   * `fetchDocument` itself knows nothing about tasks.
   */
  private async fetchDocument(url: string, entryId?: string): Promise<HttpResponse> {
    if (entryId) this.trackStage(entryId, 'download')
    // Routed through the github-fetch layer: GitHub hosts walk the
    // acceleration candidate chain, any other host keeps a single official
    // candidate and is never rewritten.
    return this.githubFetch.fetchDocument(url)
  }

  private requireDownloadUrl(entry: RegistryEntry): string {
    const url = entry.downloadUrl
    if (!url) throw new Error(`registry: the entry "${entry.id}" has no downloadUrl`)
    return url
  }

  private requireSources(): SourcesService {
    if (!this.sourcesService) throw new Error('registry: the sources service is not available; music-source installs are unsupported')
    return this.sourcesService
  }

  private requireLyricSources(): LyricSourcesService {
    if (!this.lyricSourcesService) throw new Error('registry: the lyric-sources service is not available; lyric-source installs are unsupported')
    return this.lyricSourcesService
  }

  private requireTheme(): ThemeService {
    if (!this.themeService) throw new Error('registry: the theme service is not available; theme installs are unsupported')
    return this.themeService
  }

  private safeEmit(emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.ownCtx.logger.warn(`registry: an event listener threw: ${String(error)}`)
    }
  }

  /* ── persistence ───────────────────────────────────────────────────────── */

  private async resolveEndpoint(): Promise<{ endpoint: string; overridden: boolean }> {
    try {
      const prefs = await this.storeService?.get<RegistryPrefs>(PREFS_KEY)
      const endpoint = prefs?.endpoint
      if (typeof endpoint === 'string' && endpoint.trim()) {
        return { endpoint, overridden: true }
      }
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to read the endpoint preference: ${String(err)}`)
    }
    return { endpoint: DEFAULT_ENDPOINT, overridden: false }
  }

  private async readIndexCache(): Promise<RegistryIndex | undefined> {
    try {
      const cached = await this.storeService?.get<IndexCache>(INDEX_CACHE_KEY)
      if (cached && typeof cached.fetchedAt === 'number' && hasIndexShape(cached.index)) {
        return cached.index
      }
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to read the index cache: ${String(err)}`)
    }
    return undefined
  }

  /** The full cache record — fetchedAt and sanitizer anomalies included. */
  private async readIndexCacheRecord(): Promise<IndexCache | undefined> {
    try {
      const cached = await this.storeService?.get<IndexCache>(INDEX_CACHE_KEY)
      if (cached && typeof cached.fetchedAt === 'number' && hasIndexShape(cached.index)) {
        return cached
      }
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to read the index cache: ${String(err)}`)
    }
    return undefined
  }

  private async writeIndexCache(index: RegistryIndex, anomalies?: RegistryIndexAnomalies): Promise<void> {
    try {
      await this.storeService?.set<IndexCache>(INDEX_CACHE_KEY, {
        fetchedAt: Date.now(),
        index,
        ...(anomalies && (anomalies.dropped > 0 || anomalies.duplicateIds.length > 0) ? { anomalies } : {}),
      })
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to persist the index cache: ${String(err)}`)
    }
  }

  private warnIndexAnomalies(dropped: number, duplicateIds: readonly string[], source: string): void {
    if (dropped > 0) {
      this.ownCtx.logger.warn(`registry: dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} from ${source}`)
    }
    if (duplicateIds.length > 0) {
      this.ownCtx.logger.warn(`registry: dropped ${duplicateIds.length} duplicate index id${duplicateIds.length === 1 ? '' : 's'} from ${source}: ${duplicateIds.join(', ')}`)
    }
  }

  private async touchLastCheckAt(): Promise<void> {
    this.lastCheckAt = Date.now()
    if (!this.storeService) return
    try {
      const prefs = (await this.storeService.get<RegistryPrefs>(PREFS_KEY)) ?? {}
      await this.storeService.set<RegistryPrefs>(PREFS_KEY, { ...prefs, lastCheckAt: this.lastCheckAt })
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to record the last check time: ${String(err)}`)
    }
  }

  /* ── the daily automatic check ─────────────────────────────────────────── */

  private setupAutoCheck(scoped: Context): void {
    const wantsAutoCheck = (s: AppSettings | undefined): boolean => s?.registryAutoCheck ?? true
    if (wantsAutoCheck(this.settingsService?.getSync?.())) {
      this.startAutoCheckTimers()
    }

    scoped.on('settings/changed', (s) => {
      if (wantsAutoCheck(s)) {
        this.startAutoCheckTimers()
      } else {
        this.stopAutoCheckTimers()
      }
    })
  }

  private startAutoCheckTimers(): void {
    if (this.autoCheckCancel) return
    const tick = () => {
      void this.runAutoCheck()
    }
    const delay = setTimeout(tick, this.config.autoCheckDelayMs ?? AUTO_CHECK_DELAY_MS)
    const interval = setInterval(tick, this.config.autoCheckIntervalMs ?? AUTO_CHECK_INTERVAL_MS)
    const cancel = () => {
      clearTimeout(delay)
      clearInterval(interval)
    }
    this.autoCheckCancel = cancel
    this.ownCtx.effect(() => cancel, 'registry-auto-check')
  }

  private stopAutoCheckTimers(): void {
    const cancel = this.autoCheckCancel
    this.autoCheckCancel = undefined
    cancel?.()
  }

  private async runAutoCheck(): Promise<void> {
    try {
      await this.getIndex(true)
      await this.checkUpdates()
    } catch (err) {
      this.ownCtx.logger.warn(`registry: automatic update check failed: ${String(err)}`)
    }
  }
}

export const name = 'plugin-registry'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-registry: loaded')
  const fiber = await ctx.plugin(RegistryPlugin)
  return () => void fiber.dispose()
}

export default { name, apply }
