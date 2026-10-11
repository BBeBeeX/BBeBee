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
  'music-source': '音乐源',
  'lyric-source': '歌词源',
  theme: '界面主题',
  plugin: '插件',
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

/** `a、b、c` — long lists truncate with a trailing count. */
function summarizeList(parts: readonly string[], max = 8): string {
  if (parts.length <= max) return parts.join('、')
  return `${parts.slice(0, max).join('、')} 等 ${parts.length} 项`
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
        title: `锁记录指向的内容已不在本机：${record.id}`,
        message: `registry.lock.json 中仍保留「${record.id}」（${kindLabel(record.kind)}，安装于 ${formatTime(record.installedAt)}）的锁定记录，但对应内容已不再安装，可能被手动移除。`,
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
        title: `已安装内容缺少锁记录：${entry.id}`,
        message: `${kindLabel(entry.kind)}「${entry.name}」（${entry.id}）已安装且与注册表条目匹配，但 registry.lock.json 中没有对应的完整性记录；它可能不是经注册表安装的，或锁记录已丢失。`,
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
      title: `索引条目 id 重复：${id}`,
      message: `最近一次索引清洗发现多条 id 为「${id}」的条目，已保留首条；重复发布通常意味着注册表仓库的元数据出了问题。`,
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
      parts.push(`manifest 申请但未在注册表声明: [${diff.unexpectedInManifest.join(', ')}]`)
    }
    if (diff.missingInManifest.length) {
      parts.push(`注册表声明但 manifest 未申请: [${diff.missingInManifest.join(', ')}]`)
    }
    items.push({
      id: `cap-mismatch:${mismatch.entryId}`,
      group: 'conflict',
      title: `能力声明不一致：${mismatch.entryId}`,
      message: `插件「${mismatch.entryId}」的 manifest 能力与注册表元数据不一致（检查于 ${formatTime(mismatch.checkedAt)}）：${parts.join('; ') || '内容完全一致'}。该插件的详情获取与安装会被拒绝。`,
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
        title: `插件依赖未满足：${plugin.id}`,
        message: `插件「${plugin.id}」声明依赖 ${summarizeList(unmet)}，但对应插件未安装，相关功能可能无法工作。`,
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
      title: `安全扫描风险：${entriesById.get(entryId)?.name ?? entryId}`,
      message: `共 ${blocks} 个 block、${warns} 个 warn，首条：${first?.message ?? ''}（检查于 ${formatTime(record.checkedAt)}）。`,
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
      ? `，并发现重复 id：${summarizeList(indexAnomalies.duplicateIds)}`
      : ''
    items.push({
      id: 'metadata-anomalies',
      group: 'warning',
      title: '索引元数据异常',
      message: `最近一次索引清洗丢弃了 ${indexAnomalies.dropped} 条畸形条目${duplicates}。`,
      detectedAt: now,
    })
  }

  if (input.indexFetchFailed) {
    items.push({
      id: 'index-fetch-failed',
      group: 'warning',
      title: '索引拉取失败',
      message: `索引最近一次拉取失败（${formatTime(input.lastIndexFailureAt ?? now)}），当前展示的是离线缓存。`,
      detectedAt: now,
    })
  }

  // The full-chain failure is only surfaced while nothing has succeeded after
  // it — a later good fetch proves connectivity recovered.
  if (input.lastChainFailure && input.lastChainFailure.at > (input.indexCacheFetchedAt ?? 0)) {
    items.push({
      id: 'github-chain-failure',
      group: 'warning',
      title: 'GitHub 下载线路不可用',
      message: `GitHub 加速线路全部不可用（${formatTime(input.lastChainFailure.at)}，最后错误：${input.lastChainFailure.error}，URL：${input.lastChainFailure.url}）。`,
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
      title: '索引缓存已过期',
      message: `索引缓存写入于 ${formatTime(input.indexCacheFetchedAt)}（超过 24 小时）且最近拉取失败，列表内容可能已过期。`,
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
    .join('、')
  items.push({
    id: 'lock-summary',
    group: 'info',
    title: '锁记录摘要',
    message:
      records.length === 0
        ? '尚无锁记录 —— 还没有通过注册表安装过内容。'
        : `锁记录共 ${records.length} 条（${distribution}），最近安装于 ${formatTime(latestInstalledAt)}。`,
    detectedAt: now,
  })

  // Installed versions, one info item per kind (a flat per-item list would
  // flood the page; the per-kind line keeps it scannable).
  const overviews: readonly { kind: RegistryEntryKind; labels: string[] }[] = [
    {
      kind: 'music-source',
      labels: installed.musicSources.map(
        (s) => `${s.name ?? s.sourceUrl ?? '未知来源'}@${s.docVersion ?? '0.0.0'}`,
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
      title: `${kindLabel(kind)}已安装一览`,
      message: `${kindLabel(kind)}共 ${labels.length} 项：${summarizeList(labels)}`,
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
