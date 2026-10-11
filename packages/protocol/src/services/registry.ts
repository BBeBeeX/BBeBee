/**
 * `ctx.contentRegistry` — the in-app index of third-party content and its updates.
 *
 * A community registry (a separate repository) publishes a `registry.json`
 * indexing four kinds of installable content: music sources, lyric sources,
 * themes and desktop plugins. This service fetches that index, compares it
 * against what the user already has, and installs through the services that
 * own each kind — `ctx.sources.import`, `ctx.lyricSources.registerSource`,
 * `ctx.theme.registerTheme`, and the desktop dynamic loader.
 *
 * The service is deliberately a thin coordinator: it validates nothing a
 * downstream service already validates (a music document goes through the
 * import pipeline, a theme through the contrast checker) and hides nothing a
 * user must see before confirming (a download host is a security red line,
 * so `fetchEntryDetails` exists so the confirm dialog can name it).
 *
 * ⚠️ The service key is `contentRegistry`, not `registry`: on cordis 4 the
 * `registry` key belongs to the kernel itself (its plugin-registry service,
 * whose methods surface as `ctx.plugin`/`ctx.inject`).
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PluginManifest } from '../manifest.js'
import type { SecurityAuditReport } from './security-audit.js'

export type RegistryEntryKind = 'music-source' | 'lyric-source' | 'theme' | 'plugin'

export interface RegistryEntry {
  readonly id: string
  readonly kind: RegistryEntryKind
  readonly name: string
  /** Latest published semantic version. Absent means "not versioned"; update checks skip such entries. */
  readonly version?: string
  readonly author?: string
  readonly description?: string
  /** Entry's last-commit date in the registry repo (ISO 8601). */
  readonly updatedAt?: string
  readonly downloadUrl?: string
  /** Minimum app version this entry needs (semver). Optional; enforced in UI via minAppVersionBlock. */
  readonly minAppVersion?: string
  /** music-source only: the document's backend URL (installed-source matching key). */
  readonly sourceUrl?: string
  /** theme/plugin only: preview image URL. */
  readonly previewUrl?: string
  /** Author repository URL or shorthand (e.g. https://github.com/owner/repo or owner/repo). */
  readonly repo?: string
  /** plugin/source: The author's code repository URL. */
  readonly repoUrl?: string
  readonly sha256?: string
  readonly capabilities?: readonly string[]
  /** plugin entries only: free-form category slug from the registry repo (e.g. `ui-enhancement`). */
  readonly category?: string
}

export interface RegistryIndex {
  readonly generatedAt?: string
  readonly repository?: string
  readonly entries: readonly RegistryEntry[]
}

export interface RegistryUpdate {
  readonly kind: RegistryEntryKind
  readonly id: string
  readonly name: string
  readonly installedVersion: string
  readonly availableVersion: string
  readonly downloadUrl?: string
  /** True when the installed copy is a built-in (today: the builtin- lrclib lyric source). */
  readonly builtin?: boolean
}

/** Record in registry.lock.json pinned to exact commit and content digest. */
export interface RegistryLockRecord {
  readonly id: string
  readonly kind: RegistryEntryKind
  readonly repo: string
  readonly commit: string
  readonly sha256: string
  readonly installedAt: number
}

/** Complete structure of registry.lock.json in the user data directory. */
export interface RegistryLockFile {
  readonly version: 1
  readonly records: Record<string, RegistryLockRecord>
}

/**
 * What the install flow needs to show the user BEFORE they confirm.
 *
 * `allowedHosts` is a security red line: a music document's egress list is a
 * sentence a user can judge, and it must be on screen before the document is
 * imported, not discovered afterwards.
 */
export interface RegistryEntryDetails {
  readonly entry: RegistryEntry
  readonly allowedHosts?: readonly string[]
  readonly isBuiltinInstall?: boolean
  /** True when a music source already exists locally and was edited since import. */
  readonly isLocallyModified?: boolean
  /** Static security analysis result for source code or plugin bundle. */
  readonly securityAudit?: SecurityAuditReport
  /** The resolved author repository URL. */
  readonly repoUrl?: string
  /** Exact git commit sha resolving the installation artifact. */
  readonly commit?: string
  /** Commit difference between currently installed and incoming update. */
  readonly commitDiff?: {
    readonly previousCommit?: string
    readonly currentCommit: string
  }
}

/** Desktop-only plugin distribution: a JSON bundle `{ manifest, files }` fetched from downloadUrl. */
export interface PluginInstallBundle {
  readonly manifest: PluginManifest
  readonly files: Record<string, string>
}

/** One tracked operation in the registry task center. Lifecycle: pending → running → success | failed. */
export interface RegistryTask {
  readonly id: string
  readonly entryId: string
  readonly entryName: string
  readonly kind: RegistryEntryKind
  readonly operation: 'install' | 'update'
  /** Current stage while running; kept on the record for context after completion. */
  readonly stage: 'download' | 'verify' | 'install'
  readonly status: 'pending' | 'running' | 'success' | 'failed'
  /** Optional measurable progress (e.g. artifact counts) when the code naturally knows it. */
  readonly progress?: { readonly done: number; readonly total: number }
  readonly error?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface RegistryService {
  /** Fetches the registry index (endpoint configurable via store), caching the last good copy for offline use. */
  getIndex(force?: boolean): Promise<RegistryIndex>
  /** Compares installed content against the index; fires 'registry/updates-available' with the result. */
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  /** The previous checkUpdates() result (for badges without re-fetching). */
  updates(): readonly RegistryUpdate[]
  /** Fetches the distribution document for an entry and returns what the confirm dialog must show. */
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  /** Installs/updates one entry. The caller must already have shown the user the details (hosts / plugin risk). */
  install(entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }): Promise<void>
  /** Composition root sets this so plugin-kind installs can reach the desktop dynamic host. */
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
  /** Read the registry lock file records. */
  getLockFile?(): Promise<RegistryLockFile>
  /** Retrieve a single lock record by ID. */
  getLockRecord?(id: string): Promise<RegistryLockRecord | undefined>
  /**
   * Builds a diagnostics report from real service state — lock/integrity
   * conflicts, persisted security-audit findings, index anomalies and install
   * summaries. Optional: implementations that cannot observe enough state may
   * omit it, and callers must use `?.` accordingly.
   */
  getDiagnostics?(): Promise<RegistryDiagnosticsReport>
  /**
   * Re-runs `fetchEntryDetails` (including the static security scan) for one
   * entry and refreshes the stored audit-findings / capability-mismatch
   * records. Detection only — it never installs anything, so the
   * install-stage `confirmed` gate does not apply. Optional, same caveat as
   * `getDiagnostics`.
   */
  rescanEntry?(entryId: string): Promise<void>
  /**
   * The current task-center records — active (pending/running) operations plus
   * the most recently finished ones, newest first. Optional: implementations
   * without task tracking may omit it, and callers must use `?.` accordingly.
   */
  getTasks?(): readonly RegistryTask[]
  /** Removes every finished (success/failed) task record. Pending/running ones are kept. Optional. */
  clearFinishedTasks?(): void
}

/** The four buckets a diagnostic can land in, in descending severity. */
export type RegistryDiagnosticGroup = 'conflict' | 'risk' | 'warning' | 'info'

/** One finding on the diagnostics page. */
export interface RegistryDiagnosticItem {
  /** Stable key, e.g. `lock-orphan:subsonic`, `duplicate-id:xxx`, `audit:{entryId}`. */
  readonly id: string
  /** Which severity bucket the item belongs to. */
  readonly group: RegistryDiagnosticGroup
  /** Short headline shown on the card row. */
  readonly title: string
  /** One-to-two-sentence explanation, including the concrete evidence. */
  readonly message: string
  /** Related registry entry the user can jump to, when there is one. */
  readonly entryId?: string
  /** The entry's kind, when known — lets the UI route to the right tab. */
  readonly kind?: RegistryEntryKind
  /** When the item was detected (the report generation time). */
  readonly detectedAt: number
}

/** The full diagnostics report: four fixed groups plus a generation timestamp. */
export interface RegistryDiagnosticsReport {
  readonly conflicts: readonly RegistryDiagnosticItem[]
  readonly risks: readonly RegistryDiagnosticItem[]
  readonly warnings: readonly RegistryDiagnosticItem[]
  readonly info: readonly RegistryDiagnosticItem[]
  readonly generatedAt: number
}


declare module 'cordis' {
  interface Context {
    /**
     * ⚠️ Not `registry` — that key is cordis's own plugin-registry service
     * (`ctx.plugin`/`ctx.inject` are its methods). The content index claims
     * `contentRegistry` instead.
     */
    contentRegistry: RegistryService
  }
}
