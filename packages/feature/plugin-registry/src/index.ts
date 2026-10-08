/**
 * `plugin-registry` — the in-app index of third-party content and its updates.
 *
 * Implements `ctx.contentRegistry`: it fetches the community registry's
 * `registry.json`, compares it against what the user already has, and installs
 * through the services that own each kind — `ctx.sources.import` for music
 * sources, `ctx.lyricSources.registerSource` for lyric sources,
 * `ctx.theme.registerTheme` for themes, and a desktop-only installer bridge
 * for plugins. It validates nothing a downstream service already validates,
 * and hides nothing a user must see before confirming (a download host is a
 * security red line — see `fetchEntryDetails`).
 *
 * Every collaborator beyond `http` is optional: a shell without, say, a theme
 * service simply sees the theme half of its update checks and installs
 * refuse with a clear error rather than break the rest.
 *
 * ⚠️ The service key is `contentRegistry`, not `registry`: on cordis 4 the
 * `registry` key belongs to the kernel itself (its plugin-registry service,
 * whose methods surface as `ctx.plugin`/`ctx.inject`).
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from '@BBeBee/kernel'
import type {
  AppSettings,
  HttpService,
  HttpResponse,
  LyricSourceDefinition,
  LyricSourcesService,
  PluginInstallBundle,
  PluginManagerService,
  PluginManifest,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
  RegistryService,
  RegistryUpdate,
  SettingsService,
  SourcesService,
  StoreService,
  ThemeDefinition,
  ThemeService,
} from '@BBeBee/protocol'
import { sha256Hex } from '@BBeBee/protocol'
import { themeContrastIssues } from '@BBeBee/ui-tokens'
import { compareVersions, normalizeVersion } from './semver.js'
import { REGISTRY_VIEWS } from './views.js'

/** Where the community registry publishes its index. Overridable via `registry.prefs`. */
const DEFAULT_ENDPOINT = 'https://raw.githubusercontent.com/BBeBeeX/bbebeex-registry/main/registry.json'

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
  /**
   * Test hook for the automatic check's schedule. Defaults to 45 s after
   * boot, then every 24 h. Exposed because a test that waits 45 seconds is
   * a test nobody runs.
   */
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

/** Keep the entries a shape check can vouch for; drop the rest, with a count for the log. */
function sanitizeEntry(raw: unknown): RegistryEntry | undefined {
  if (!isRecord(raw)) return undefined
  const { id, kind, name } = raw
  if (typeof id !== 'string' || !id) return undefined
  if (typeof kind !== 'string' || !ENTRY_KINDS.includes(kind as RegistryEntryKind)) return undefined
  if (typeof name !== 'string' || !name) return undefined

  return {
    id,
    kind: kind as RegistryEntryKind,
    name,
    version: optionalString(raw.version),
    author: optionalString(raw.author),
    description: optionalString(raw.description),
    updatedAt: optionalString(raw.updatedAt),
    downloadUrl: optionalString(raw.downloadUrl),
    minAppVersion: optionalString(raw.minAppVersion),
    sourceUrl: optionalString(raw.sourceUrl),
    previewUrl: optionalString(raw.previewUrl),
    repoUrl: optionalString(raw.repoUrl),
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

/**
 * The version a stored music-source document declares. `docJson` is the
 * imported string verbatim, and older documents have no `version` field at
 * all — both mean '0.0.0'.
 */
function documentVersion(docJson: string): string {
  try {
    const doc: unknown = JSON.parse(docJson)
    if (isRecord(doc) && typeof doc.version === 'string') return doc.version
  } catch {
    // A stored document that does not parse is unversioned, not an error.
  }
  return '0.0.0'
}

export class RegistryPlugin extends Service implements RegistryService {
  /**
   * ⚠️ Not `registry` — on cordis 4 that key is the kernel's own
   * plugin-registry service (`ctx.plugin`/`ctx.inject` are its methods).
   */
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

  /** The desktop-only bridge that installs a `{ manifest, files }` bundle. */
  private pluginInstaller?: (bundle: PluginInstallBundle) => Promise<void>

  /** The previous checkUpdates() result, for badges without re-fetching. */
  private lastUpdates: readonly RegistryUpdate[] = []

  /** When the last completed check ran, for the settings card. Hydrated from the store on init. */
  private lastCheckAt?: number

  /**
   * Whether the most recent `getIndex()` had to fall back to the cached copy.
   * `getIndex` resolves even when the network is down — a view cannot derive
   * the fallback from its own return value, so it is reported here instead.
   */
  private indexFetchFailed = false

  /** Cancels the current auto-check timers; also registered as a fiber effect. */
  private autoCheckCancel?: () => void

  constructor(ctx: Context, config: RegistryConfig = {}) {
    super(ctx, 'contentRegistry')
    this.ownCtx = ctx
    this.config = config
    // A required dependency (`static inject`), so it is present at construction.
    this.http = ctx.http
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-registry: initialized')

    this.ownCtx.inject(['store'], (scoped) => {
      this.storeService = scoped.store
      void scoped.store
        .get<RegistryPrefs>(PREFS_KEY)
        .then((prefs) => {
          if (typeof prefs?.lastCheckAt === 'number') this.lastCheckAt = prefs.lastCheckAt
        })
        .catch(() => {})
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

    // 2.6 Contribute this plugin's views — the registry screen and the
    // settings card. The settings screen aggregates whatever is contributed
    // and owns none of it, and the shell renders whatever routes are placed
    // in its sidebar (docs/08 §3).
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

  /* ── the index ─────────────────────────────────────────────────────────── */

  async getIndex(_force = false): Promise<RegistryIndex> {
    const endpoint = await this.resolveEndpoint()
    try {
      const raw = await this.http.get<unknown>(endpoint)
      const { index, dropped } = sanitizeIndex(raw)
      if (dropped > 0) {
        this.ownCtx.logger.warn(`registry: dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} from the index`)
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

  /**
   * Whether the most recent `getIndex()` call fell back to the cached copy —
   * read-only view state, so a screen can say "离线缓存" instead of passing
   * stale data off as live. The write path stays inside `getIndex()`.
   */
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

    // `emit` does not isolate the emitter from a throwing listener (see
    // protocol/src/events.ts) — a badge render must not fail the check.
    this.safeEmit(() => this.ownCtx.emit('registry/updates-available', updates))
    return updates
  }

  updates(): readonly RegistryUpdate[] {
    return this.lastUpdates
  }

  /**
   * When the last completed check ran (wall-clock ms), or `undefined` before
   * the first one. Read-only view state for the settings card — the write
   * path stays inside `checkUpdates()`.
   */
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

  /* ── the confirm dialog's inputs ───────────────────────────────────────── */

  async fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails> {
    // No extra fetch: the capabilities a user must see before installing
    // code are on the index entry itself.
    if (entry.kind === 'plugin') return { entry }

    const url = this.requireDownloadUrl(entry)
    const doc = await (await this.fetchDocument(url)).json<unknown>()

    if (entry.kind === 'theme') return { entry }

    // music-source | lyric-source: the egress allowlist is the sentence the
    // user judges before confirming.
    const allowedHosts = optionalStringArray(isRecord(doc) ? doc.allowedHosts : undefined)
    return {
      entry,
      ...(allowedHosts ? { allowedHosts } : {}),
      isBuiltinInstall: entry.kind === 'lyric-source' ? entry.id.startsWith('builtin-') : false,
    }
  }

  /* ── installs ──────────────────────────────────────────────────────────── */

  async install(entry: RegistryEntry, _opts?: { confirmed?: boolean }): Promise<void> {
    switch (entry.kind) {
      case 'music-source':
        return this.installMusicSource(entry)
      case 'lyric-source':
        return this.installLyricSource(entry)
      case 'theme':
        return this.installTheme(entry)
      case 'plugin':
        return this.installPlugin(entry)
    }
  }

  /**
   * Re-import updates the existing row — `SourceRecord` identity is
   * `sourceUrl`, so installing a newer registry version of a document the
   * user already has IS the update flow. The import pipeline validates the
   * document itself.
   */
  private async installMusicSource(entry: RegistryEntry): Promise<void> {
    const url = this.requireDownloadUrl(entry)
    const text = await (await this.fetchDocument(url)).text()
    const report = await this.requireSources().import(text, { originUri: url })

    // The entry's `sourceUrl` is the identity to look for; when the index
    // omits it, any accepted document counts. Rejected and locally-modified
    // rows do not.
    const matched = entry.sourceUrl
      ? report.added.some((r) => r.sourceUrl === entry.sourceUrl) ||
        report.updated.some((u) => u.record.sourceUrl === entry.sourceUrl) ||
        report.unchanged.some((r) => r.sourceUrl === entry.sourceUrl)
      : report.added.length + report.updated.length + report.unchanged.length > 0

    if (matched) return

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

  private async installLyricSource(entry: RegistryEntry): Promise<void> {
    const url = this.requireDownloadUrl(entry)
    const doc = await (await this.fetchDocument(url)).json<unknown>()
    if (
      !isRecord(doc) ||
      typeof doc.id !== 'string' || !doc.id.trim() ||
      typeof doc.name !== 'string' || !doc.name.trim() ||
      typeof doc.script !== 'string' || !doc.script.trim()
    ) {
      throw new Error(`registry: the lyric source document for "${entry.id}" is missing non-empty id/name/script fields`)
    }
    await this.requireLyricSources().registerSource(doc as unknown as LyricSourceDefinition)
  }

  private async installTheme(entry: RegistryEntry): Promise<void> {
    const url = this.requireDownloadUrl(entry)
    const doc = await (await this.fetchDocument(url)).json<unknown>()
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

    // Same gate a user-drafted theme goes through: a theme nobody can read
    // is not a theme the registry should hand out.
    const issues = [...themeContrastIssues(theme, 'dark'), ...themeContrastIssues(theme, 'light')]
    if (issues.length) {
      const detail = issues
        .map((i) => `${i.pair} (${i.scheme}): ${i.ratio.toFixed(2)} < ${i.required}`)
        .join('; ')
      throw new Error(`registry: the theme "${entry.id}" failed the contrast check — ${detail}`)
    }

    this.requireTheme().registerTheme(theme)
  }

  private async installPlugin(entry: RegistryEntry): Promise<void> {
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

    const installer = this.pluginInstaller
    if (!installer) {
      throw new Error('registry: plugin install is only supported on desktop')
    }
    await installer({ manifest, files })
  }

  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void {
    this.pluginInstaller = installer
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  /** One round trip, status-checked: a 4xx/5xx is a failure, not a document. */
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
      // Failing to persist must not fail the fetch that just succeeded.
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
    // The fiber clears the timers even if this plugin is unloaded before
    // either one fires.
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
