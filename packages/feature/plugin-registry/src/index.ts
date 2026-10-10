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
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
  RegistryLockFile,
  RegistryLockRecord,
  RegistryService,
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
import { compareVersions, normalizeVersion } from './semver.js'
import { REGISTRY_VIEWS } from './views.js'

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
  }
}

function sanitizeIndex(raw: unknown): { index: RegistryIndex; dropped: number } {
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
  const index: RegistryIndex = {
    entries,
    generatedAt: optionalString(raw.generatedAt),
    repository: optionalString(raw.repository),
  }
  return { index, dropped }
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

export class RegistryPlugin extends Service implements RegistryService {
  static override readonly name = 'contentRegistry'
  static readonly inject = ['http']

  private readonly ownCtx: Context
  private readonly http: HttpService
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

  /** The desktop-only bridge that installs a `{ manifest, files }` bundle. */
  private pluginInstaller?: (bundle: PluginInstallBundle) => Promise<void>

  /** The previous checkUpdates() result, for badges without re-fetching. */
  private lastUpdates: readonly RegistryUpdate[] = []

  /** When the last completed check ran, for the settings card. Hydrated from the store on init. */
  private lastCheckAt?: number

  /** Whether the most recent `getIndex()` had to fall back to the cached copy. */
  private indexFetchFailed = false

  /** Cancels the current auto-check timers; also registered as a fiber effect. */
  private autoCheckCancel?: () => void

  constructor(ctx: Context, config: RegistryConfig = {}) {
    super(ctx, 'contentRegistry')
    this.ownCtx = ctx
    this.config = config
    this.http = ctx.http
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
    const endpoint = await this.resolveEndpoint()
    try {
      // 1. Direct index check: if endpoint directly returns an index with entries (e.g. test mock or mirror)
      let directRaw: unknown
      try {
        directRaw = await this.http.get<unknown>(endpoint)
      } catch {
        // endpoint may be a base contents directory url that only responds to subpaths
      }

      if (hasIndexShape(directRaw)) {
        const { index, dropped } = sanitizeIndex(directRaw)
        if (dropped > 0) {
          this.ownCtx.logger.warn(`registry: dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} from the index`)
        }
        await this.writeIndexCache(index)
        this.indexFetchFailed = false
        return index
      }

      // If pointing directly to a .json file that wasn't an index shape, sanitizeIndex will error
      if (endpoint.endsWith('.json') && directRaw !== undefined) {
        const { index, dropped } = sanitizeIndex(directRaw)
        if (dropped > 0) {
          this.ownCtx.logger.warn(`registry: dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} from direct index`)
        }
        await this.writeIndexCache(index)
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
          const items = await this.http.get<unknown>(dirUrl)
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
                rawEntry = await this.http.get<unknown>(fileUrl)
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
                  rawEntry = await this.http.get<unknown>(metaUrl)
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
            const legacyRaw = await this.http.get<unknown>(DEFAULT_RAW_BASE + '/registry.json')
            if (hasIndexShape(legacyRaw)) {
              const { index, dropped } = sanitizeIndex(legacyRaw)
              if (dropped > 0) {
                this.ownCtx.logger.warn(`registry: dropped ${dropped} malformed entries from fallback registry.json`)
              }
              await this.writeIndexCache(index)
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

      const index: RegistryIndex = {
        repository: DEFAULT_REGISTRY_REPO,
        generatedAt: new Date().toISOString(),
        entries,
      }

      await this.writeIndexCache(index)
      this.indexFetchFailed = false
      return index
    } catch (err) {
      this.indexFetchFailed = true
      this.ownCtx.logger.warn(
        `registry: failed to fetch the index from ${endpoint}, falling back to the last good copy: ${String(err)}`,
      )
      return (await this.readIndexCache()) ?? { entries: [] }
    }
  }

  lastIndexFetchFailed(): boolean {
    return this.indexFetchFailed
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
      const commitData = await this.http.get<{ sha?: string }>(
        `https://api.github.com/repos/${owner}/${repo}/commits/HEAD`,
      )
      if (commitData && typeof commitData.sha === 'string' && commitData.sha) {
        return { commit: commitData.sha, defaultBranch: 'main' }
      }
    } catch {
      // Fall back to querying repo default branch
    }

    try {
      const repoData = await this.http.get<{ default_branch?: string }>(
        `https://api.github.com/repos/${owner}/${repo}`,
      )
      const branch = repoData.default_branch || 'main'
      const branchCommit = await this.http.get<{ sha?: string }>(
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

  async fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails> {
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
          docText = await (await this.fetchDocument(rawUrl)).text()
        } catch (err) {
          throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
        }
      } else {
        const url = this.requireDownloadUrl(entry)
        docText = await (await this.fetchDocument(url)).text()
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
      const securityAudit = this.scanCode(docText, { allowedHosts })

      let commitDiff: { previousCommit?: string; currentCommit: string } | undefined
      if (prevLock && commit && prevLock.commit !== commit) {
        commitDiff = { previousCommit: prevLock.commit, currentCommit: commit }
      }

      const existing =
        entry.kind === 'music-source' && entry.sourceUrl
          ? this.sourcesService?.sources.find((r) => r.sourceUrl === entry.sourceUrl)
          : undefined

      return {
        entry,
        ...(allowedHosts ? { allowedHosts } : {}),
        isBuiltinInstall: entry.kind === 'lyric-source' ? entry.id.startsWith('builtin-') : false,
        ...(existing?.locallyModified ? { isLocallyModified: true } : {}),
        securityAudit,
        ...(repoUrl ? { repoUrl } : {}),
        ...(commit ? { commit } : {}),
        ...(commitDiff ? { commitDiff } : {}),
      }
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
          manifest = await (await this.fetchDocument(manifestUrl)).json<PluginManifest>()
        } catch (err) {
          throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root manifest.json (${String(err)})`, { cause: err })
        }

        try {
          indexJsCode = await (await this.fetchDocument(indexUrl)).text()
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
          throw new Error(
            `registry: plugin "${entry.id}" capabilities mismatch between manifest and registry metadata: ${diffs.join('; ')}`,
          )
        }

        const securityAudit = this.scanCode(indexJsCode)

        let commitDiff: { previousCommit?: string; currentCommit: string } | undefined
        if (prevLock && commit && prevLock.commit !== commit) {
          commitDiff = { previousCommit: prevLock.commit, currentCommit: commit }
        }

        return {
          entry,
          securityAudit,
          repoUrl,
          commit,
          ...(commitDiff ? { commitDiff } : {}),
        }
      }

      // Legacy bundle details
      let securityAudit: SecurityAuditReport | undefined
      if (entry.downloadUrl) {
        try {
          const url = this.requireDownloadUrl(entry)
          const bytes = await (await this.fetchDocument(url)).bytes()
          const bundle: unknown = JSON.parse(new TextDecoder().decode(bytes))
          if (isRecord(bundle) && isRecord(bundle.files) && typeof bundle.files['index.js'] === 'string') {
            securityAudit = this.scanCode(bundle.files['index.js'] as string)
          }
        } catch {
          // ignore details fetch failure for legacy bundle
        }
      }

      return {
        entry,
        ...(securityAudit ? { securityAudit } : {}),
      }
    }

    // Theme
    return { entry }
  }

  /* ── installs ──────────────────────────────────────────────────────────── */

  async install(entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }): Promise<void> {
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
        text = await (await this.fetchDocument(originUri)).text()
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
      }
    } else {
      originUri = this.requireDownloadUrl(entry)
      repoUrl = originUri
      commit = entry.version ?? '0.0.0'
      text = await (await this.fetchDocument(originUri)).text()
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
    const audit = this.scanCode(text, { allowedHosts })
    if (audit.level === 'block' && !opts?.confirmed) {
      throw new Error(`registry: security audit blocked installation of "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`)
    }

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
        rawText = await (await this.fetchDocument(rawUrl)).text()
        doc = JSON.parse(rawText)
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root index.json (${String(err)})`, { cause: err })
      }
    } else {
      const url = this.requireDownloadUrl(entry)
      repoUrl = url
      commit = entry.version ?? '0.0.0'
      rawText = await (await this.fetchDocument(url)).text()
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
    const audit = this.scanCode(doc.script as string, { allowedHosts: optionalStringArray(doc.allowedHosts) })
    if (audit.level === 'block' && !opts?.confirmed) {
      throw new Error(`registry: security audit blocked installation of lyric source "${entry.id}": ${audit.findings.map((f) => f.message).join('; ')}`)
    }

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
      rawText = await (await this.fetchDocument(rawUrl)).text()
      doc = JSON.parse(rawText)
    } else {
      const url = this.requireDownloadUrl(entry)
      repoUrl = url
      commit = entry.version ?? '0.0.0'
      rawText = await (await this.fetchDocument(url)).text()
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

    const issues = [...themeContrastIssues(theme, 'dark'), ...themeContrastIssues(theme, 'light')]
    if (issues.length) {
      const detail = issues
        .map((i) => `${i.pair} (${i.scheme}): ${i.ratio.toFixed(2)} < ${i.required}`)
        .join('; ')
      throw new Error(`registry: the theme "${entry.id}" failed the contrast check — ${detail}`)
    }

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
        manifest = await (await this.fetchDocument(manifestUrl)).json<PluginManifest>()
      } catch (err) {
        throw new Error(`registry: author repository "${repoInfo.owner}/${repoInfo.repo}" is missing root manifest.json (${String(err)})`, { cause: err })
      }

      try {
        indexJsCode = await (await this.fetchDocument(indexUrl)).text()
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
        throw new Error(
          `registry: plugin "${entry.id}" capabilities mismatch between manifest and registry metadata: ${diffs.join('; ')}`,
        )
      }

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
    const bytes = await (await this.fetchDocument(url)).bytes()

    if (!entry.sha256) {
      throw new Error(`registry: the plugin entry "${entry.id}" publishes no sha256 digest; refusing to install unverified code`)
    }
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

  private async fetchDocument(url: string): Promise<HttpResponse> {
    const response = await this.http({ url, method: 'GET' })
    if (response.status >= 400) {
      throw new Error(`registry: download failed with status ${response.status} for ${url}`)
    }
    return response
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

  private async resolveEndpoint(): Promise<string> {
    try {
      const prefs = await this.storeService?.get<RegistryPrefs>(PREFS_KEY)
      const endpoint = prefs?.endpoint
      if (typeof endpoint === 'string' && endpoint.trim()) return endpoint
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to read the endpoint preference: ${String(err)}`)
    }
    return DEFAULT_ENDPOINT
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

  private async writeIndexCache(index: RegistryIndex): Promise<void> {
    try {
      await this.storeService?.set<IndexCache>(INDEX_CACHE_KEY, { fetchedAt: Date.now(), index })
    } catch (err) {
      this.ownCtx.logger.warn(`registry: failed to persist the index cache: ${String(err)}`)
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
