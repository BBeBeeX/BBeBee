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
  /** Minimum app version this entry needs. Informational; not enforced yet. */
  readonly minAppVersion?: string
  /** music-source only: the document's backend URL (installed-source matching key). */
  readonly sourceUrl?: string
  /** theme/plugin only: preview image URL. */
  readonly previewUrl?: string
  /** plugin only */
  readonly repoUrl?: string
  readonly sha256?: string
  readonly capabilities?: readonly string[]
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
}

/** Desktop-only plugin distribution: a JSON bundle `{ manifest, files }` fetched from downloadUrl. */
export interface PluginInstallBundle {
  readonly manifest: PluginManifest
  readonly files: Record<string, string>
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
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
  /** Composition root sets this so plugin-kind installs can reach the desktop dynamic host. */
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
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
