/**
 * Diagnostics data assembly for `contentRegistry.getDiagnostics()` (§1.5).
 *
 * Every number and finding here is derived from state the registry already
 * owns — the lock file, the persisted audit findings, the capability-mismatch
 * records, the sanitized index cache, the installed-content services and the
 * download layer's failure status. Nothing is invented: a group with no data
 * source behind it is simply empty.
 *
 * This module is pure: it turns a snapshot of that state into a
 * `RegistryDiagnosticsReport` so the whole report can be tested without a
 * context or a store.
 */

import type {
  Finding,
  RegistryDiagnosticItem,
  RegistryDiagnosticsReport,
  RegistryEntry,
  RegistryEntryKind,
  RegistryLockRecord,
} from '@BBeBee/protocol'

/* ── persisted diagnostics state ─────────────────────────────────────────── */

/** Store key: the last security-audit report per entry id (block/warn only). */
export const AUDIT_FINDINGS_KEY = 'registry.audit-findings'
/** Store key: the last capabilities mismatch per entry id. */
export const CAPABILITY_MISMATCHES_KEY = 'registry.capability-mismatches'

/**
 * One entry's last security-audit outcome. Only entries whose scan produced
 * block/warn findings keep a record; a passing scan deletes the record.
 */
export interface RegistryAuditFindingsRecord {
  level: 'block' | 'warn'
  findings: readonly Finding[]
  checkedAt: number
}

export type RegistryAuditFindingsMap = Record<string, RegistryAuditFindingsRecord>

/**
 * One entry's last capabilities mismatch: what the registry metadata declared
 * (`expected`) versus what the author's manifest actually declared (`actual`).
 */
export interface RegistryCapabilityMismatchRecord {
  entryId: string
  expected: readonly string[]
  actual: readonly string[]
  checkedAt: number
}

export type RegistryCapabilityMismatchMap = Record<string, RegistryCapabilityMismatchRecord>

/** Sanitize anomalies recorded alongside the index cache. */
export interface RegistryIndexAnomalies {
  /** Malformed entries dropped by the sanitizer. */
  dropped: number
  /** Ids that appeared more than once (first occurrence kept). */
  duplicateIds: readonly string[]
}

/** One full-candidate-chain failure, recorded by the download layer. */
export interface RegistryChainFailure {
  at: number
  url: string
  error: string
}

/* ── the input snapshot ──────────────────────────────────────────────────── */

/**
 * What "installed" looks like to the report, read structurally from the
 * services that own each kind. Music sources are matched by `sourceUrl` (the
 * service's own identity key) with the version read from the stored document.
 */
export interface DiagnosticsInstalledSnapshot {
  readonly musicSources: readonly {
    readonly sourceUrl?: string
    readonly docVersion?: string
    readonly name?: string
  }[]
  readonly lyricSources: readonly { readonly id: string; readonly version?: string }[]
  readonly themes: readonly { readonly id: string; readonly version?: string }[]
  readonly plugins: readonly {
    readonly id: string
    readonly version?: string
    readonly dependencies?: readonly string[]
  }[]
}

export interface DiagnosticsInput {
  readonly now: number
  readonly auditFindings: RegistryAuditFindingsMap
  readonly capabilityMismatches: RegistryCapabilityMismatchMap
  readonly lockRecords: Record<string, RegistryLockRecord>
  /** The entries of the last good index (the offline cache), possibly empty. */
  readonly indexEntries: readonly RegistryEntry[]
  /** Anomalies recorded alongside the index cache, when the cache has any. */
  readonly indexAnomalies?: RegistryIndexAnomalies
  /** Whether the most recent `getIndex()` had to fall back to the cache. */
  readonly indexFetchFailed: boolean
  /** When that most recent failure happened, if it did. */
  readonly lastIndexFailureAt?: number
  /** The download layer's last full-chain failure, if any. */
  readonly lastChainFailure?: RegistryChainFailure
  /** When the index cache was written (the last successful fetch). */
  readonly indexCacheFetchedAt?: number
  readonly installed: DiagnosticsInstalledSnapshot
}

/** An index-cache copy older than this, combined with a failed fetch, is stale. */
const INDEX_CACHE_STALE_MS = 24 * 60 * 60 * 1000

const KIND_LABELS: Readonly<Record<RegistryEntryKind, string>> = {
  'music-source': 'Music source',
  'lyric-source': 'Lyric source',
  theme: 'Theme',
  plugin: 'Plugin',
}

function kindLabel(kind: RegistryEntryKind): string {
  return KIND_LABELS[kind] ?? kind
}

function formatTime(ts: number): string {
  return new Date(ts).toISOString()
}

/** The builtin- prefix is the one built-in exemption (the lrclib lyric source). */
function isBuiltinLyricEntry(entryId: string): boolean {
  return entryId.startsWith('builtin-')
}

/** Same comparison `checkCapabilitiesMatch` performs, kept local to avoid an import cycle. */
function capabilityDiff(
  manifestCaps: readonly string[],
  registryCaps: readonly string[],
): { unexpectedInManifest: string[]; missingInManifest: string[] } {
  const setM = new Set(manifestCaps)
  const setR = new Set(registryCaps)
  return {
    unexpectedInManifest: [...setM].filter((c) => !setR.has(c)),
    missingInManifest: [...setR].filter((c) => !setM.has(c)),
  }
}

/** `a, b, c` — long lists truncate with a trailing count. */
function summarizeList(parts: readonly string[], max = 8): string {
  if (parts.length <= max) return parts.join(', ')
  return `${parts.slice(0, max).join(', ')} … (${parts.length} in total)`
}

/**
 * Index sanitization helper: keep the first entry per id, report the ids that
 * appeared more than once (once each, in first-seen order).
 */
export function dedupeEntriesById(
  entries: readonly RegistryEntry[],
): { unique: RegistryEntry[]; duplicateIds: string[] } {
  const seen = new Set<string>()
  const unique: RegistryEntry[] = []
  const duplicateIds: string[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      if (!duplicateIds.includes(entry.id)) duplicateIds.push(entry.id)
      continue
    }
    seen.add(entry.id)
    unique.push(entry)
  }
  return { unique, duplicateIds }
}

/* ── the report builder ──────────────────────────────────────────────────── */

function buildConflicts(input: DiagnosticsInput, entriesById: ReadonlyMap<string, RegistryEntry>): RegistryDiagnosticItem[] {
  const items: RegistryDiagnosticItem[] = []
  const { now, lockRecords, indexEntries, installed } = input

  const sourceUrlsInstalled = new Set(
    installed.musicSources.map((s) => s.sourceUrl).filter((url): url is string => typeof url === 'string' && url.length > 0),
  )
  const lyricIdsInstalled = new Set(installed.lyricSources.map((s) => s.id))
  const themeIdsInstalled = new Set(installed.themes.map((t) => t.id))
  const pluginIdsInstalled = new Set(installed.plugins.map((p) => p.id))
  const installedIdsFor = (kind: RegistryEntryKind): ReadonlySet<string> => {
    switch (kind) {
      case 'lyric-source':
        return lyricIdsInstalled
      case 'theme':
        return themeIdsInstalled
      case 'plugin':
        return pluginIdsInstalled
      default:
        return new Set()
    }
  }

  // 1. lock-orphan: a lock record whose content is no longer installed.
  for (const record of Object.values(lockRecords)) {
    let orphaned: boolean
    if (record.kind === 'music-source') {
      // A music-source lock record carries no sourceUrl, so installedness is
      // matched through the index entry's identity key. When the entry is not
      // in the cached index there is nothing to match against — skipped rather
      // than guessed.
      const entry = entriesById.get(record.id)
      const sourceUrl = entry?.sourceUrl
      orphaned = typeof sourceUrl === 'string' && !sourceUrlsInstalled.has(sourceUrl)
    } else {
      orphaned = !installedIdsFor(record.kind).has(record.id)
    }
    if (orphaned) {
      items.push({
        id: `lock-orphan:${record.id}`,
        group: 'conflict',
        title: `Lock record points to content no longer installed: ${record.id}`,
        message: `registry.lock.json still carries a lock record for "${record.id}" (${kindLabel(record.kind)}, installed at ${formatTime(record.installedAt)}), but the content is no longer installed; it may have been removed manually.`,
        entryId: record.id,
        kind: record.kind,
        detectedAt: now,
      })
    }
  }

  // 2. lock-missing: installed content that matches a registry index entry but
  //    has no lock record. Gated on index provenance — content absent from the
  //    index may be a manual import the registry never managed — with the
  //    builtin lyric source exempt (it ships with the app, no lock expected).
  for (const entry of indexEntries) {
    const installedWithoutLock = ((): boolean => {
      switch (entry.kind) {
        case 'music-source':
          return Boolean(entry.sourceUrl) && sourceUrlsInstalled.has(entry.sourceUrl as string) && !lockRecords[entry.id]
        case 'lyric-source':
          return lyricIdsInstalled.has(entry.id) && !isBuiltinLyricEntry(entry.id) && !lockRecords[entry.id]
        case 'theme':
          return themeIdsInstalled.has(entry.id) && !lockRecords[entry.id]
        case 'plugin':
          return pluginIdsInstalled.has(entry.id) && !lockRecords[entry.id]
      }
    })()
    if (installedWithoutLock) {
      items.push({
        id: `lock-missing:${entry.id}`,
        group: 'conflict',
        title: `Installed content is missing a lock record: ${entry.id}`,
        message: `${kindLabel(entry.kind)} "${entry.name}" (${entry.id}) is installed and matches a registry index entry, but registry.lock.json has no integrity record for it; it may not have been installed through the registry, or the lock record was lost.`,
        entryId: entry.id,
        kind: entry.kind,
        detectedAt: now,
      })
    }
  }

  // 3. duplicate index ids (first occurrence kept by the sanitizer).
  for (const id of input.indexAnomalies?.duplicateIds ?? []) {
    items.push({
      id: `duplicate-id:${id}`,
      group: 'conflict',
      title: `Duplicate index entry id: ${id}`,
      message: `The last index sanitization found multiple entries with id "${id}" and kept the first one; duplicate publishing usually means the registry repository's metadata is broken.`,
      entryId: id,
      kind: entriesById.get(id)?.kind,
      detectedAt: now,
    })
  }

  // 4. capabilities declared in the author manifest diverge from the registry metadata.
  for (const mismatch of Object.values(input.capabilityMismatches)) {
    const diff = capabilityDiff(mismatch.actual, mismatch.expected)
    const parts: string[] = []
    if (diff.unexpectedInManifest.length) {
      parts.push(`declared in the manifest but missing from the registry: [${diff.unexpectedInManifest.join(', ')}]`)
    }
    if (diff.missingInManifest.length) {
      parts.push(`declared in the registry but missing from the manifest: [${diff.missingInManifest.join(', ')}]`)
    }
    items.push({
      id: `cap-mismatch:${mismatch.entryId}`,
      group: 'conflict',
      title: `Capability declaration mismatch: ${mismatch.entryId}`,
      message: `Plugin "${mismatch.entryId}" has manifest capabilities that diverge from the registry metadata (checked at ${formatTime(mismatch.checkedAt)}): ${parts.join('; ') || 'they match exactly'}. Fetching details and installing this plugin will be rejected.`,
      entryId: mismatch.entryId,
      kind: entriesById.get(mismatch.entryId)?.kind ?? 'plugin',
      detectedAt: now,
    })
  }

  // 5. installed plugins whose declared dependencies are not installed.
  for (const plugin of installed.plugins) {
    const unmet = (plugin.dependencies ?? []).filter((dep) => !pluginIdsInstalled.has(dep))
    if (unmet.length) {
      items.push({
        id: `deps-unmet:${plugin.id}`,
        group: 'conflict',
        title: `Plugin dependencies unmet: ${plugin.id}`,
        message: `Plugin "${plugin.id}" declares dependencies on ${summarizeList(unmet)}, but those plugins are not installed; related features may not work.`,
        entryId: plugin.id,
        kind: 'plugin',
        detectedAt: now,
      })
    }
  }

  return items
}

function buildRisks(input: DiagnosticsInput, entriesById: ReadonlyMap<string, RegistryEntry>): RegistryDiagnosticItem[] {
  const items: RegistryDiagnosticItem[] = []
  for (const [entryId, record] of Object.entries(input.auditFindings)) {
    if (!record.findings.length) continue
    const blocks = record.findings.filter((f) => f.level === 'block').length
    const warns = record.findings.length - blocks
    const first = record.findings[0]
    items.push({
      id: `audit:${entryId}`,
      group: 'risk',
      title: `Security scan risk: ${entriesById.get(entryId)?.name ?? entryId}`,
      message: `${blocks} block and ${warns} warn finding(s) in total; first: ${first?.message ?? ''} (checked at ${formatTime(record.checkedAt)}).`,
      entryId,
      kind: entriesById.get(entryId)?.kind ?? input.lockRecords[entryId]?.kind,
      detectedAt: input.now,
    })
  }
  return items
}

function buildWarnings(input: DiagnosticsInput): RegistryDiagnosticItem[] {
  const items: RegistryDiagnosticItem[] = []
  const { now, indexAnomalies } = input

  if (indexAnomalies && (indexAnomalies.dropped > 0 || indexAnomalies.duplicateIds.length > 0)) {
    const duplicates = indexAnomalies.duplicateIds.length
      ? `, and duplicate ids were found: ${summarizeList(indexAnomalies.duplicateIds)}`
      : ''
    items.push({
      id: 'metadata-anomalies',
      group: 'warning',
      title: 'Index metadata anomalies',
      message: `The last index sanitization dropped ${indexAnomalies.dropped} malformed entries${duplicates}.`,
      detectedAt: now,
    })
  }

  if (input.indexFetchFailed) {
    items.push({
      id: 'index-fetch-failed',
      group: 'warning',
      title: 'Index fetch failed',
      message: `The most recent index fetch failed (${formatTime(input.lastIndexFailureAt ?? now)}); what is shown now is the offline cache.`,
      detectedAt: now,
    })
  }

  // The full-chain failure is only surfaced while nothing has succeeded after
  // it — a later good fetch proves connectivity recovered.
  if (input.lastChainFailure && input.lastChainFailure.at > (input.indexCacheFetchedAt ?? 0)) {
    items.push({
      id: 'github-chain-failure',
      group: 'warning',
      title: 'GitHub download endpoints unavailable',
      message: `All GitHub acceleration endpoints are unavailable (${formatTime(input.lastChainFailure.at)}; last error: ${input.lastChainFailure.error}; URL: ${input.lastChainFailure.url}).`,
      detectedAt: now,
    })
  }

  if (
    input.indexFetchFailed &&
    input.indexCacheFetchedAt !== undefined &&
    now - input.indexCacheFetchedAt > INDEX_CACHE_STALE_MS
  ) {
    items.push({
      id: 'index-cache-stale',
      group: 'warning',
      title: 'Index cache is stale',
      message: `The index cache was written at ${formatTime(input.indexCacheFetchedAt)} (more than 24 hours ago) and the latest fetch failed; the list content may be outdated.`,
      detectedAt: now,
    })
  }

  return items
}

function buildInfo(input: DiagnosticsInput): RegistryDiagnosticItem[] {
  const items: RegistryDiagnosticItem[] = []
  const { now, lockRecords, installed } = input

  // Lock summary: always present, so the page can answer "what has the
  // registry installed here" even when everything else is clean.
  const records = Object.values(lockRecords)
  const byKind = { 'music-source': 0, 'lyric-source': 0, theme: 0, plugin: 0 } as Record<RegistryEntryKind, number>
  let latestInstalledAt = 0
  for (const record of records) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1
    if (record.installedAt > latestInstalledAt) latestInstalledAt = record.installedAt
  }
  const distribution = (Object.entries(byKind) as readonly [RegistryEntryKind, number][])
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kindLabel(kind)} ${count}`)
    .join(', ')
  items.push({
    id: 'lock-summary',
    group: 'info',
    title: 'Lock record summary',
    message:
      records.length === 0
        ? 'No lock records yet — nothing has been installed through the registry.'
        : `Total ${records.length} lock record(s) (${distribution}), most recently installed at ${formatTime(latestInstalledAt)}.`,
    detectedAt: now,
  })

  // Installed versions, one info item per kind (a flat per-item list would
  // flood the page; the per-kind line keeps it scannable).
  const overviews: readonly { kind: RegistryEntryKind; labels: string[] }[] = [
    {
      kind: 'music-source',
      labels: installed.musicSources.map(
        (s) => `${s.name ?? s.sourceUrl ?? 'Unknown source'}@${s.docVersion ?? '0.0.0'}`,
      ),
    },
    {
      kind: 'lyric-source',
      labels: installed.lyricSources.map((s) => `${s.id}@${s.version ?? '0.0.0'}`),
    },
    {
      kind: 'theme',
      labels: installed.themes.map((t) => `${t.id}@${t.version ?? '0.0.0'}`),
    },
    {
      kind: 'plugin',
      labels: installed.plugins.map((p) => `${p.id}@${p.version ?? '0.0.0'}`),
    },
  ]
  for (const { kind, labels } of overviews) {
    if (!labels.length) continue
    items.push({
      id: `installed-overview:${kind}`,
      group: 'info',
      title: `Installed ${kindLabel(kind)} overview`,
      message: `${kindLabel(kind)} — ${labels.length} installed: ${summarizeList(labels)}`,
      detectedAt: now,
    })
  }

  return items
}

/** Build the full report from a state snapshot. Pure and synchronous. */
export function buildDiagnosticsReport(input: DiagnosticsInput): RegistryDiagnosticsReport {
  const entriesById = new Map(input.indexEntries.map((entry) => [entry.id, entry]))
  return {
    conflicts: buildConflicts(input, entriesById),
    risks: buildRisks(input, entriesById),
    warnings: buildWarnings(input),
    info: buildInfo(input),
    generatedAt: input.now,
  }
}
