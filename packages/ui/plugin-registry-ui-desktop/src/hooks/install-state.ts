/**
 * Install-state derivation for registry entries.
 *
 * The headless `plugin-registry` service owns update *checks*; the screen
 * still needs a per-entry answer at render time — "is this installed, is a
 * newer registry version available, or is this a fresh install?" — computed
 * from the services that own each kind of installed content. That derivation
 * is pure and lives here, so it can be tested without rendering anything.
 *
 * Everything about the installed-content services is read structurally
 * (`serviceOf`) with types from `@BBeBee/protocol` only: a view package never
 * imports another feature package's runtime.
 */

import type { Context } from 'cordis'
import type {
  LyricSourceDefinition,
  PluginInfo,
  RegistryEntry,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { compareVersions, normalizeVersion } from '@BBeBee/toolkit'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/** What the user can act on, for one registry entry. */
export type RegistryActionState =
  | { readonly state: 'install' }
  | { readonly state: 'update'; readonly installedVersion: string }
  | { readonly state: 'installed'; readonly installedVersion: string }

/** True when the installed copy is a built-in (today: the builtin- lrclib lyric source and default themes). */
export function isBuiltinEntry(entry: RegistryEntry): boolean {
  return (
    (entry.kind === 'lyric-source' && (entry.id.startsWith('builtin-') || entry.id === 'bbebeex-lrclib')) ||
    (entry.kind === 'theme' && (entry.id.startsWith('builtin-') || entry.id === 'default-dark' || entry.id === 'default-light'))
  )
}

/**
 * A snapshot of everything installed that a registry entry can match against.
 * All four fields degrade to empty lists — a shell without, say, a theme
 * service simply reports every theme entry as installable.
 */
export interface InstalledContentSnapshot {
  readonly musicSources: readonly SourceRecord[]
  readonly lyricSources: readonly LyricSourceDefinition[]
  readonly themes: readonly ThemeDefinition[]
  readonly plugins: readonly PluginInfo[]
}

interface SourcesServiceLike {
  readonly sources: readonly SourceRecord[]
}
interface LyricSourcesServiceLike {
  getSources(): readonly LyricSourceDefinition[]
}
interface ThemeServiceLike {
  getThemes(): readonly ThemeDefinition[]
}
interface PluginManagerServiceLike {
  list(): readonly PluginInfo[]
}

/** Read the four installed-content services off the context, tolerating absence. */
export function readInstalledContentSnapshot(ctx: Context): InstalledContentSnapshot {
  const sources = serviceOf<SourcesServiceLike>(ctx, 'sources')
  const lyricSources = serviceOf<LyricSourcesServiceLike>(ctx, 'lyricSources')
  const theme = serviceOf<ThemeServiceLike>(ctx, 'theme')
  const pluginManager = serviceOf<PluginManagerServiceLike>(ctx, 'plugin-manager')
  return {
    musicSources: sources?.sources ?? [],
    lyricSources: lyricSources?.getSources?.() ?? [],
    themes: theme?.getThemes?.() ?? [],
    plugins: pluginManager?.list?.() ?? [],
  }
}

/**
 * The version a stored music-source document declares. `docJson` is the
 * imported string verbatim, and older documents have no `version` field at
 * all — both mean '0.0.0' (same semantics as the registry service).
 */
function documentVersion(docJson: string): string {
  try {
    const doc: unknown = JSON.parse(docJson)
    if (
      typeof doc === 'object' && doc !== null && !Array.isArray(doc) &&
      typeof (doc as Record<string, unknown>)['version'] === 'string'
    ) {
      return (doc as Record<string, unknown>)['version'] as string
    }
  } catch {
    // A stored document that does not parse is unversioned, not an error.
  }
  return '0.0.0'
}

function compareWithInstalled(entry: RegistryEntry, installedVersion: string | undefined): RegistryActionState {
  // Not installed at all — or unmatchable (a music entry without the
  // `sourceUrl` identity key cannot be matched, so it reads as a fresh
  // install, mirroring the service's own matching).
  if (installedVersion === undefined) return { state: 'install' }
  if (entry.version && compareVersions(entry.version, installedVersion) > 0) {
    return { state: 'update', installedVersion: normalizeVersion(installedVersion) }
  }
  return { state: 'installed', installedVersion: normalizeVersion(installedVersion) }
}

/** Whether an entry allows custom-configured sourceUrl. */
export function isCustomizableSourceUrl(entry: RegistryEntry): boolean {
  return Boolean(
    entry.params?.some((p) => p.toLowerCase() === 'sourceurl' || p.toLowerCase() === 'source_url'),
  )
}

/**
 * Find the installed music source matching a registry entry.
 * Checks exact sourceUrl first, then falls back to repo / entry id / name matching
 * for customizable sources where sourceUrl might have been modified or omitted.
 */
export function findInstalledMusicSource(
  entry: RegistryEntry,
  musicSources: readonly SourceRecord[],
): SourceRecord | undefined {
  if (entry.sourceUrl) {
    const exact = musicSources.find((r) => r.sourceUrl === entry.sourceUrl)
    if (exact) return exact
  }

  const repoStr = (entry.repoUrl ?? entry.repo)?.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const repoMatch = repoStr?.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)$/)
  const repoOwnerRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}`.toLowerCase() : undefined

  return musicSources.find((r) => {
    if (r.originUri) {
      const lowerOrigin = r.originUri.toLowerCase()
      if (repoOwnerRepo && lowerOrigin.includes(repoOwnerRepo)) return true
      if (lowerOrigin.includes(entry.id.toLowerCase())) return true
    }
    if (r.name && r.name.toLowerCase() === entry.name.toLowerCase()) return true
    if (r.doc?.sourceName && r.doc.sourceName.toLowerCase() === entry.name.toLowerCase()) return true
    if (r.id === entry.id) return true
    return false
  })
}

/**
 * Derive the action state of one entry against a snapshot.
 *
 * Matching rules are the service's own: music sources by `sourceUrl`
 * (version read defensively from the stored document), lyric sources /
 * themes / plugins by id.
 */
export function deriveRegistryActionState(
  entry: RegistryEntry,
  installed: InstalledContentSnapshot | undefined,
): RegistryActionState {
  if (!installed) return { state: 'install' }
  switch (entry.kind) {
    case 'music-source': {
      const record = findInstalledMusicSource(entry, installed.musicSources)
      return compareWithInstalled(entry, record ? documentVersion(record.docJson) : undefined)
    }
    case 'lyric-source': {
      const source = installed.lyricSources.find(
        (s) => s.id === entry.id || (entry.id === 'bbebeex-lrclib' && s.id === 'builtin-lrclib'),
      )
      if (!source) return { state: 'install' }
      const installedVer = typeof source.version === 'string' ? source.version : (entry.version ?? '0.0.0')
      return compareWithInstalled(entry, installedVer)
    }
    case 'theme': {
      const theme = installed.themes.find((t) => t.id === entry.id)
      if (!theme) return { state: 'install' }
      const installedVer = typeof theme.version === 'string' ? theme.version : (entry.version ?? '0.0.0')
      return compareWithInstalled(entry, installedVer)
    }
    case 'plugin': {
      const info = installed.plugins.find(
        (p) =>
          p.id === entry.id ||
          p.name === entry.id ||
          p.id.replace(/^@[^/]+\//, '') === entry.id.replace(/^@[^/]+\//, '') ||
          (p.name && p.name.replace(/^@[^/]+\//, '') === entry.id.replace(/^@[^/]+\//, '')),
      )
      if (!info) return { state: 'install' }
      const installedVer = typeof info.version === 'string' ? info.version : (entry.version ?? '0.0.0')
      return compareWithInstalled(entry, installedVer)
    }
  }
}

/**
 * Derive states for a whole page of entries, keyed by entry id.
 */
export function deriveRegistryActionStates(
  entries: readonly RegistryEntry[],
  installed: InstalledContentSnapshot | undefined,
): ReadonlyMap<string, RegistryActionState> {
  const states = new Map<string, RegistryActionState>()
  for (const entry of entries) {
    states.set(entry.id, deriveRegistryActionState(entry, installed))
  }
  return states
}

/**
 * Why an entry's install button must stay disabled, or `undefined` when the
 * app version satisfies (or cannot be known to violate) `minAppVersion`.
 *
 * An unknown app version never blocks: a test harness or a shell without the
 * bridge must not turn every gated entry into a wall of disabled buttons.
 */
export function minAppVersionBlock(entry: RegistryEntry, appVersion: string | undefined): string | undefined {
  if (!entry.minAppVersion) return undefined
  if (appVersion === undefined) return undefined
  if (compareVersions(entry.minAppVersion, appVersion) > 0) {
    return `Requires BBeBee ${normalizeVersion(entry.minAppVersion)} or later (current ${normalizeVersion(appVersion)})`
  }
  return undefined
}

/**
 * The content events that change installed state and therefore the derivation.
 * `source/removed` is here beside `source/imported` so an uninstall (which the
 * sources service signals with its own event, not `source/imported`) also
 * re-derives the action states.
 */
export const INSTALLED_CONTENT_EVENTS = [
  'source/imported',
  'source/removed',
  'lyric-sources/changed',
  'theme/registry-changed',
  'plugin-manager/changed',
] as const
