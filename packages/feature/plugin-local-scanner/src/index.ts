/**
 * `ctx.scanner` — the local filesystem walk.
 *
 * Separate from `plugin-source-local` because scanning is a different concern
 * from serving: this fills the catalogue from files on disk, that answers
 * questions about what is in it (docs/06 §8).
 *
 * Three properties are the whole design, and each is a test:
 *
 *  - **Incremental.** `(size, mtime)` against `scan_entries` decides whether a
 *    file is opened at all, so a rescan of an unchanged library costs stat
 *    calls and nothing else. That is an M1 exit criterion.
 *  - **Interruptible.** Batches inside one transaction, an `AbortSignal` from
 *    the fiber, a checkpoint per batch. A suspend mid-scan costs one batch.
 *  - **Honest.** A file that will not decode is recorded with its reason, not
 *    silently skipped, so "could not import" is a list the user can see.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  AudioMetadata,
  Disposable,
  FileStat,
  ScanProgress,
  ScanSpecifiedDir,
  ScanSummary,
  ScannerService,
  Uri,
} from '@BBeBee/protocol'
import { stableId } from '@BBeBee/toolkit'
import { forgetFile, importTrack } from './import.js'

/**
 * Map `items` through `fn` with at most `limit` in flight; results keep input
 * order. Used for the I/O-bound per-file tag reads during a scan batch.
 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export interface ScannerConfig {
  /** Files per transaction. A checkpoint costs one batch on interruption. */
  batchSize?: number
  /**
   * Concurrent tag reads within a batch. Measured 2026-10-18: 6 → ~550
   * files/sec, 16 → ~900 files/sec, 32 → no further gain on this machine.
   * The bottleneck is fs-operation latency, not music-metadata CPU (a single
   * thread already scales to 32-way), so worker threads would buy complexity
   * without throughput. Defaults to 16.
   */
  tagReadConcurrency?: number
  /** Extensions considered audio, lower-case and without the dot. */
  extensions?: string[]
  /** The source these tracks belong to. */
  sourceId?: string
  /** How often to poll where `ctx.fs.watch` is unavailable, in minutes. Defaults to 1 day (1440 minutes). */
  pollIntervalMinutes?: number
  /** Debounce for filesystem events, so a copy of 200 files is one rescan. */
  watchDebounceMs?: number
}

const DEFAULT_EXTENSIONS = [
  'mp3',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aiff',
  'aif',
  'wma',
  'alac',
  'ape',
  'wv',
  'dsf',
  'dff',
  'm4b',
]

/** One file, read but not yet written. */
interface PreparedFile {
  file: FileStat
  metadata?: AudioMetadata
  /** Lazy artwork ref id (`lazy:` + uri hash), when the file has embedded art. */
  lazyArtworkId?: string
  /** Folder cover FileStat, when the directory has one (already an image). */
  folderCoverUri?: Uri
  error?: string
  unchanged?: boolean
  /** The row this file already had, when it is unchanged. */
  previous?: EntryRow
}

interface EntryRow {
  uri: string
  size: number
  mtime: number
  status: string
  track_urn: string | null
  specified_dir_id: string
  error: string | null
}

/**
 * Visibility for locally-scanned tracks, as SQL: a track is available when
 * some **enabled** dir's last successful scan produced it.
 *
 * Ownership lives in `scan_entries` — one row per file, pointing at the dir
 * that last saw it — so disabling a dir hides exactly the tracks its entries
 * produced, and re-enabling restores them without a rescan. Rows are never
 * touched: queue restores and playlists read by URN and keep working.
 */
const AVAILABILITY_CASE = `CASE WHEN EXISTS (
  SELECT 1 FROM scan_entries se
    JOIN scan_specified_dirs sd ON sd.id = se.specified_dir_id
   WHERE se.track_urn = tracks.urn AND se.status = 'ok' AND sd.enabled = 1
) THEN 1 ELSE 0 END`

/**
 * How deep a scan will go.
 *
 * No real music library is 24 directories deep; a symlink loop is unbounded.
 */
const MAX_SCAN_DEPTH = 24

/**
 * How many directories one scan will list, whatever their depth.
 *
 * The depth cap alone is not enough: two directories that link to each other
 * produce 2^depth distinct paths, so a 24-deep walk still costs ~16 million
 * listings and mints a ghost track row per path. This is the budget that makes
 * the blow-up finite in *both* dimensions.
 *
 * 20,000 directories is far beyond any real music library and far below the
 * point where a cycle hurts.
 */
const MAX_SCAN_DIRS = 20_000

/** The summary of an import that did nothing. */
const EMPTY_SUMMARY: ScanSummary = { added: 0, updated: 0, removed: 0, errors: 0 }

/**
 * Debug timing for slow scans (`BBEBEE_SCAN_TIMING=1`, see `Scanner.timing`).
 * Checked lazily at scan time, not at module load: this plugin also runs in
 * renderers (e.g. the desktop webview) where `process` does not exist, so a
 * module-load `process.env` read is permanently false there. In a renderer
 * the flag can be flipped at runtime instead:
 * `localStorage.setItem('BBEBEE_SCAN_TIMING', '1')`.
 */
function scanTimingEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env.BBEBEE_SCAN_TIMING === '1') return true
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('BBEBEE_SCAN_TIMING') === '1') return true
  } catch {
    // Storage unavailable (private mode, non-DOM runtime) — flag stays off.
  }
  return false
}

export class Scanner extends Service implements ScannerService {
  static inject = ['fs', 'db', 'codec', 'paths']

  private readonly config: Required<ScannerConfig>

  private readonly ownCtx: Context
  private specifiedDirList: ScanSpecifiedDir[] = []
  /**
   * Per-batch timing breakdown. Populated only when `BBEBEE_SCAN_TIMING=1`
   * (debug aid for "why is the scan slow" — zero cost otherwise). Logged
   * once per batch: tag-read vs artwork-save vs DB-transaction milliseconds.
   */
  private timing: { readMs: number; artMs: number; dbMs: number; files: number } | null = null
  private current?: ScanProgress
  private abort?: AbortController
  /** Throttle for the per-file progress reports (see `reportScanProgress`). */
  private lastProgressAt = 0
  private watchers: Disposable[] = []
  private watchTimer?: ReturnType<typeof setTimeout>
  private pollTimer?: ReturnType<typeof setTimeout>
  /** Resolves the in-flight scan, so concurrent callers queue rather than race. */
  private inFlight?: Promise<ScanSummary>
  /** Serialises dropped-file imports; they share no state with `scan`'s walk. */
  private importChain: Promise<ScanSummary> = Promise.resolve(EMPTY_SUMMARY)
  private disposed = false

  constructor(ctx: Context, config: ScannerConfig = {}) {
    super(ctx, 'scanner')
    this.ownCtx = ctx
    this.config = {
      batchSize: config.batchSize ?? 200,
      tagReadConcurrency: config.tagReadConcurrency ?? 16,
      extensions: (config.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
      sourceId: config.sourceId ?? 'local',
      pollIntervalMinutes: config.pollIntervalMinutes ?? 24 * 60, // 1 day (1440 minutes)
      watchDebounceMs: config.watchDebounceMs ?? 2000,
    }
  }

  async [Service.init]() {
    await this.ensureSourceRow()
    await this.cleanUnlovedLibraryItems()
    this.specifiedDirList = await this.loadSpecifiedDirs()
    this.ownCtx.logger.info('scanner: initialised with %d specified dir(s)', this.specifiedDirList.length)
    await this.startWatching()

    return () => {
      this.disposed = true
      this.cancel()
      if (this.watchTimer) clearTimeout(this.watchTimer)
      if (this.pollTimer) clearTimeout(this.pollTimer)
      for (const off of this.watchers) off()
      this.watchers = []
    }
  }

  get specifiedDirs(): readonly ScanSpecifiedDir[] {
    return this.specifiedDirList
  }

  get progress(): ScanProgress | undefined {
    return this.current
  }

  /**
   * Throttled in-batch progress: the file a tag read just started on, and
   * how many of the batch's files are done.
   *
   * Tag reads run multi-way concurrent, so both change dozens of times a second;
   * emitting per file would spam the event bus and re-render the progress UI
   * just as often. One report per 400 ms is plenty for a dialog whose job is
   * to show that work is moving — and, when a file hangs in its 30 s
   * metadata timeout, to show *which* file is stuck.
   *
   * The reporter is threaded through `importBatch` → `prepareFile` as a
   * callback rather than kept as instance state, so a drop-import running
   * alongside a scan never reports against the scan's progress. The per-batch
   * checkpoint emit after `importBatch` still sets the exact `done`; these
   * reports are the smooth motion in between.
   */
  private reportScanProgress(dirId: string, done: number, total: number, currentFile?: string): void {
    const now = Date.now()
    if (now - this.lastProgressAt < 400) return
    this.lastProgressAt = now
    this.current = {
      specifiedDirId: dirId,
      done,
      total,
      ...(currentFile === undefined ? {} : { currentFile }),
    }
    this.ownCtx.emit('scan/progress', dirId, done, total, undefined, currentFile)
  }

  /* ── specified dirs ────────────────────────────────────────────────── */

  async addSpecifiedDir(uri: Uri, opts: { recursive?: boolean } = {}): Promise<ScanSpecifiedDir> {
    const existing = this.specifiedDirList.find((r) => r.uri === uri)
    if (existing) {
      if (!existing.enabled) {
        await this.setEnabled(existing.id, true)
        return this.specifiedDirList.find((r) => r.id === existing.id) ?? { ...existing, enabled: true }
      }
      return existing
    }

    const dir: ScanSpecifiedDir = {
      id: stableId('specified_dir', uri),
      uri,
      recursive: opts.recursive ?? true,
      enabled: true,
    }
    await this.ownCtx.db.exec(
      `INSERT INTO scan_specified_dirs (id, uri, recursive, enabled) VALUES (?, ?, ?, 1)
       ON CONFLICT(uri) DO UPDATE SET enabled = 1`,
      [dir.id, dir.uri, dir.recursive ? 1 : 0],
    )
    this.specifiedDirList = await this.loadSpecifiedDirs()
    this.ownCtx.logger.info('scanner: added specified dir %s (%s)', dir.id, dir.uri)
    await this.startWatching()
    this.ownCtx.emit('scan/specified-dirs-changed', this.specifiedDirList)
    return dir
  }

  async removeSpecifiedDir(id: string, opts: { forgetTracks?: boolean } = {}): Promise<void> {
    if (opts.forgetTracks) {
      const entries = await this.ownCtx.db.query<{ uri: string }>(
        'SELECT uri FROM scan_entries WHERE specified_dir_id = ?',
        [id],
      )
      const removed: string[] = []
      await this.ownCtx.db.transaction(async (tx) => {
        for (const entry of entries) {
          const { removedTrackUrn } = await forgetFile(
            { tx, sourceId: this.config.sourceId, now: Date.now() },
            entry.uri,
          )
          if (removedTrackUrn) removed.push(removedTrackUrn)
        }
      })
      if (removed.length > 0) this.ownCtx.emit('library/changed', 'track', removed)
    }
    // Collect affected track URNs before the cascade deletes scan_entries.
    const affected = await this.ownCtx.db.query<{ urn: string }>(
      'SELECT DISTINCT track_urn AS urn FROM scan_entries WHERE specified_dir_id = ? AND track_urn IS NOT NULL',
      [id],
    )
    // `scan_entries` cascades from the specified dir row.
    await this.ownCtx.db.exec('DELETE FROM scan_specified_dirs WHERE id = ?', [id])
    // Mark tracks unavailable (hidden from local music) without deleting them:
    // playlists, favorites, and queue restore read by URN and keep working.
    // AVAILABILITY_CASE re-evaluates against remaining dirs.
    if (!opts.forgetTracks && affected.length > 0) {
      const urns = affected.map((r) => r.urn)
      const placeholders = urns.map(() => '?').join(',')
      await this.ownCtx.db.exec(
        `UPDATE tracks SET available = ${AVAILABILITY_CASE} WHERE urn IN (${placeholders})`,
        urns,
      )
      this.ownCtx.emit('library/changed', 'track', urns)
    }
    this.specifiedDirList = await this.loadSpecifiedDirs()
    this.ownCtx.logger.info('scanner: removed specified dir %s (forgetTracks=%s)', id, opts.forgetTracks ?? false)
    await this.startWatching()
    this.ownCtx.emit('scan/specified-dirs-changed', this.specifiedDirList)
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    const before = await this.visibilityOf(id)
    await this.ownCtx.db.transaction(async (tx) => {
      await tx.exec('UPDATE scan_specified_dirs SET enabled = ? WHERE id = ?', [on ? 1 : 0, id])
      await tx.exec(
        `UPDATE tracks SET available = ${AVAILABILITY_CASE}
         WHERE urn IN (
           SELECT track_urn FROM scan_entries
            WHERE specified_dir_id = ? AND track_urn IS NOT NULL
         )`,
        [id],
      )
    })
    const after = await this.visibilityOf(id)
    const changed = [...before]
      .filter(([urn, available]) => after.get(urn) !== available)
      .map(([urn]) => urn)
    this.specifiedDirList = await this.loadSpecifiedDirs()
    this.ownCtx.logger.info(
      'scanner: set specified dir %s enabled=%s (%d track(s) changed visibility)',
      id,
      on,
      changed.length,
    )
    await this.startWatching()
    // Only the flips, so a no-op toggle does not send the library re-rendering.
    if (changed.length > 0) this.ownCtx.emit('library/changed', 'track', changed)
    this.ownCtx.emit('scan/specified-dirs-changed', this.specifiedDirList)
  }

  /** The tracks a specified dir's scans produced, with their current availability. */
  private async visibilityOf(id: string): Promise<Map<string, number>> {
    const rows = await this.ownCtx.db.query<{ urn: string; available: number }>(
      `SELECT DISTINCT se.track_urn AS urn, t.available AS available
         FROM scan_entries se JOIN tracks t ON t.urn = se.track_urn
        WHERE se.specified_dir_id = ? AND se.track_urn IS NOT NULL`,
      [id],
    )
    return new Map(rows.map((r) => [r.urn, r.available]))
  }

  /**
   * Availability is recomputed after every walk.
   *
   * A walk can move a file's entry to a different dir — overlapping specified
   * dirs share files, and an entry follows the dir that last saw it — and
   * ownership is what visibility follows, so the flip lands here rather than
   * waiting for the next toggle to reveal it.
   */
  private async reconcileAvailability(): Promise<void> {
    // Single pass: find the tracks whose availability will flip, flip them,
    // and report exactly those — instead of snapshotting the whole visibility
    // map twice around the UPDATE.
    const flips = await this.ownCtx.db.transaction(async (tx) => {
      const rows = await tx.query<{ urn: string }>(
        `SELECT tracks.urn AS urn
           FROM tracks
          WHERE tracks.urn IN (SELECT track_urn FROM scan_entries WHERE track_urn IS NOT NULL)
            AND tracks.available != ${AVAILABILITY_CASE}`,
      )
      const urns = rows.map((r) => r.urn)
      if (urns.length > 0) {
        await tx.exec(
          `UPDATE tracks SET available = ${AVAILABILITY_CASE}
            WHERE urn IN (SELECT track_urn FROM scan_entries WHERE track_urn IS NOT NULL)`,
        )
      }
      return urns
    })
    if (flips.length > 0) this.ownCtx.emit('library/changed', 'track', flips)
  }

  /* ── the walk ──────────────────────────────────────────────────────── */

  cancel(): void {
    this.ownCtx.logger.info('scanner: scan cancelled')
    this.abort?.abort()
  }

  /**
   * Walk the specified dirs.
   *
   * Serialised: a watch event, a poll and a manual scan can all arrive at
   * once, and two concurrent walks would fight over `this.abort` — the second
   * overwriting it, orphaning the first, which then keeps writing rows nobody
   * can cancel. Callers that arrive during a scan get the one already running.
   */
  async scan(opts: { specifiedDirId?: string; full?: boolean; signal?: AbortSignal } = {}): Promise<ScanSummary> {
    if (this.inFlight) return this.inFlight
    const run = this.runScan(opts)
    this.inFlight = run
    try {
      return await run
    } finally {
      this.inFlight = undefined
    }
  }

  private async runScan(
    opts: { specifiedDirId?: string; full?: boolean; signal?: AbortSignal } = {},
  ): Promise<ScanSummary> {
    const summary: ScanSummary = { added: 0, updated: 0, removed: 0, errors: 0 }
    const dirs = this.specifiedDirList.filter(
      (r) => r.enabled && (opts.specifiedDirId === undefined || r.id === opts.specifiedDirId),
    )
    this.ownCtx.logger.info(
      'scanner: starting scan on %d specified dir(s) (full=%s)',
      dirs.length,
      opts.full ?? false,
    )

    const abort = new AbortController()
    this.abort = abort
    const signal = opts.signal
    const onExternalAbort = () => abort.abort()
    signal?.addEventListener('abort', onExternalAbort)

    try {
      for (const dir of dirs) {
        if (abort.signal.aborted) break
        await this.scanSpecifiedDir(dir, summary, { full: opts.full ?? false, signal: abort.signal })
      }
      if (!abort.signal.aborted) {
        await this.reconcileAvailability()
      }
    } finally {
      signal?.removeEventListener('abort', onExternalAbort)
      this.abort = undefined
      this.current = undefined
    }

    if (abort.signal.aborted) summary.cancelled = true
    this.ownCtx.logger.info(
      'scanner: scan completed (added=%d, updated=%d, removed=%d, errors=%d, cancelled=%s)',
      summary.added,
      summary.updated,
      summary.removed,
      summary.errors,
      !!summary.cancelled,
    )
    return summary
  }

  /**
   * Import files dropped onto the window, ahead of — and without touching —
   * the walk.
   *
   * Serialised on its own chain rather than `scan`'s `inFlight`: a drop that
   * arrives during a scan must still run (the two share no state), while a
   * double-drop of the same files must not race itself into counting one file
   * twice. The walk's incremental key does not apply either: a re-dropped
   * file is re-read and its rows updated in place, which is the honest
   * answer for "the user asked for this file again".
   */
  async importFiles(uris: Uri[], opts: { signal?: AbortSignal } = {}): Promise<ScanSummary> {
    const run = this.importChain.then(() => this.runImportFiles(uris, opts))
    this.importChain = run.then(() => EMPTY_SUMMARY, () => EMPTY_SUMMARY)
    return run
  }

  private async runImportFiles(uris: Uri[], opts: { signal?: AbortSignal }): Promise<ScanSummary> {
    const summary: ScanSummary = { added: 0, updated: 0, removed: 0, errors: 0 }
    const candidates = [...new Set(uris)]
    // A non-audio uri is an error like any other — reported, never silent —
    // but the drop surface filters before calling, so this is defence.
    summary.errors += candidates.filter((uri) => !this.isAudio(uri)).length
    const files = candidates.filter((uri) => this.isAudio(uri))
    if (files.length === 0) return summary

    this.ownCtx.logger.info('scanner: importing %d dropped file(s)', files.length)

    /*
     * Persist *before* reading anything. On the desktop the rows are what put
     * the uris inside the bridge's read whitelist — main watches this table
     * the way it watches `scan_specified_dirs` — and the `stat` below is the
     * first read. Importing first and recording after would refuse the very
     * first file on a fresh install. Everywhere else the insert is simply
     * bookkeeping.
     */
    const now = Date.now()
    for (const uri of files) {
      await this.ownCtx.db.exec('INSERT OR IGNORE INTO scan_dropped_files (uri, added_at) VALUES (?, ?)', [
        uri,
        now,
      ])
    }

    // Reading tags is I/O and must not hold the write lock — the batch shape
    // from `importBatch`, minus folder covers: a drop carries no directory to
    // look in.
    const prepared: PreparedFile[] = []
    for (const uri of files) {
      if (opts.signal?.aborted) break
      try {
        const file = await this.ownCtx.fs.stat(uri)
        if (file.isDirectory) throw new Error('is a directory, not a file')
        const metadata = await this.ownCtx.codec.readMetadata(uri)
        const supported = new Set(this.ownCtx.codec.supportedFormats().map((f) => f.toLowerCase()))
        const codec = metadata.codec?.toLowerCase()
        if (codec === 'alac' && !supported.has('alac')) {
          throw new Error('unsupported codec: ALAC is not supported on this platform')
        }
        if (codec === 'wma' && !supported.has('wma')) {
          throw new Error('unsupported codec: WMA is not supported on this platform')
        }
        const artwork = metadata.hasArtwork ? `lazy:${stableId(uri)}` : undefined
        prepared.push({
          file,
          metadata,
          ...(artwork ? { lazyArtworkId: artwork, lazyArtworkSource: uri } : {}),
        })
      } catch (error) {
        this.ownCtx.logger.warn('scanner: could not import dropped file %s: %s', uri, String(error))
        summary.errors++
      }
    }

    /*
     * Deliberately no `scan_entries` row: entries belong to a specified dir
     * (the column is a foreign key), and a drop must not turn its folder into
     * one. A track with no entry keeps the `available = 1` that `importTrack`
     * wrote, and — crucially — the walk's reconciliation never sees it, so a
     * later scan of an unrelated folder cannot decide it "went missing".
     */
    const changed: string[] = []
    await this.ownCtx.db.transaction(async (tx) => {
      for (const item of prepared) {
        if (item.error || !item.metadata) continue
        const prior = await tx.get<{ track_urn: string }>(
          'SELECT track_urn FROM media_bindings WHERE uri = ?',
          [item.file.uri],
        )
        const { trackUrn } = await importTrack(
          { tx, sourceId: this.config.sourceId, now },
          {
            uri: item.file.uri,
            size: item.file.size,
            mtime: item.file.mtime,
            metadata: item.metadata,
            ...(item.lazyArtworkId
              ? { lazyArtworkId: item.lazyArtworkId, lazyArtworkSource: item.file.uri }
              : {}),
            ...(item.folderCoverUri ? { folderCoverUri: item.folderCoverUri } : {}),
            format: extensionOf(item.file.uri),
          },
        )
        if (prior) summary.updated++
        else summary.added++
        changed.push(trackUrn)
      }
    })

    if (changed.length > 0) this.ownCtx.emit('library/changed', 'track', changed)
    this.ownCtx.logger.info(
      'scanner: dropped-file import finished (added=%d, updated=%d, errors=%d)',
      summary.added,
      summary.updated,
      summary.errors,
    )
    return summary
  }

  private async scanSpecifiedDir(
    dir: ScanSpecifiedDir,
    summary: ScanSummary,
    opts: { full: boolean; signal: AbortSignal },
  ): Promise<void> {
    this.ownCtx.logger.info('scanner: scanning specified dir %s (%s)', dir.id, dir.uri)
    this.ownCtx.emit('scan/started', dir.id)
    this.current = { specifiedDirId: dir.id, done: 0 }

    let files: FileStat[]
    let folderCovers: Map<string, FileStat>
    let truncated: boolean
    try {
      const walked = await this.walk(dir.uri, dir.recursive, opts.signal, (dirsListed, filesFound) => {
        // During the walk phase, report dirs enumerated and audio files found
        // so far. The UI shows "Scanning... (N dirs, M files found)" instead
        // of a stuck "0 files".
        this.current = { specifiedDirId: dir.id, done: filesFound, total: undefined }
        this.ownCtx.emit('scan/progress', dir.id, filesFound, undefined, dirsListed)
      })
      files = walked.files
      folderCovers = walked.folderCovers
      truncated = walked.truncated
    } catch (error) {
      this.ownCtx.logger.error(
        'scanner: failed to walk specified dir %s (%s): %s',
        dir.id,
        dir.uri,
        String(error),
      )
      await this.ownCtx.db.exec('UPDATE scan_specified_dirs SET last_error = ? WHERE id = ?', [
        String(error),
        dir.id,
      ])
      summary.errors++
      summary.incomplete = true
      // A specified dir that could not be walked at all is maximally incomplete, and
      // nothing was reconciled — say so rather than reporting a clean scan
      // that happened to change nothing.
      this.ownCtx.emit('scan/finished', dir.id, {
        added: summary.added,
        updated: summary.updated,
        removed: summary.removed,
        errors: summary.errors,
        incomplete: true,
      })
      return
    }

    this.current = { specifiedDirId: dir.id, done: 0, total: files.length }

    const known = new Map<string, EntryRow>()
    for (const row of await this.ownCtx.db.query<EntryRow>(
      'SELECT uri, size, mtime, status, track_urn, specified_dir_id, error FROM scan_entries WHERE specified_dir_id = ?',
      [dir.id],
    )) {
      known.set(row.uri, row)
    }
    // The incremental key is per *file*, not per dir: two specified dirs that
    // cover the same tree must agree a file is unchanged, and its entry must
    // be able to move between them without re-reading its tags. Reconciliation
    // below stays scoped to `known` — this dir's own view of what is gone.
    const knownAnywhere = new Map<string, EntryRow>()
    for (const row of await this.ownCtx.db.query<EntryRow>(
      'SELECT uri, size, mtime, status, track_urn, specified_dir_id, error FROM scan_entries',
    )) {
      knownAnywhere.set(row.uri, row)
    }

    const seen = new Set<string>()
    for (let i = 0; i < files.length; i += this.config.batchSize) {
      if (opts.signal.aborted) break
      const batch = files.slice(i, i + this.config.batchSize)
      // In-batch progress, throttled (see `reportScanProgress`): the count
      // moves file by file instead of jumping 200 at a time.
      const onProgress = (doneInBatch: number, currentFile?: string) =>
        this.reportScanProgress(dir.id, i + doneInBatch, files.length, currentFile)
      const changed = await this.importBatch(
        dir,
        batch,
        known,
        knownAnywhere,
        seen,
        summary,
        opts.full,
        folderCovers,
        onProgress,
      )

      this.current = { specifiedDirId: dir.id, done: Math.min(i + batch.length, files.length), total: files.length }
      this.ownCtx.emit('scan/progress', dir.id, this.current.done, files.length)
      // Emitted per batch, so the library fills progressively rather than
      // after the whole walk — and so the FTS index keeps up.
      if (changed.length > 0) this.ownCtx.emit('library/changed', 'track', changed)
    }

    /*
     * ⚠️ Reconciliation only runs on a *complete* view of the specified dir.
     *
     * "Not in `seen`" means "gone from disk" only if the walk actually
     * reached everywhere. A walk stopped by the depth cap or the directory
     * budget looks identical — and deleting on that basis removes the rows of
     * files that are still sitting on disk, silently, with `removed` counting
     * up as though it were correct. That is worse than the hang the budget
     * replaced: a hang is visible.
     *
     * So a truncated or cancelled walk imports what it saw and removes
     * nothing. The library goes stale rather than wrong, and the warning
     * above says why.
     */
    const complete = !opts.signal.aborted && !truncated
    // Sticky across specified dirs: one specified dir that could not be fully walked makes the
    // whole scan's reconciliation partial, and a caller must not read the
    // aggregate as authoritative.
    if (!complete) summary.incomplete = true
    if (complete) {
      const gone = [...known.keys()].filter((uri) => !seen.has(uri))
      if (gone.length > 0) await this.forgetGone(gone, summary)
    }

    await this.ownCtx.db.exec(
      'UPDATE scan_specified_dirs SET last_scan_at = ?, last_error = NULL WHERE id = ?',
      [Date.now(), dir.id],
    )
    this.specifiedDirList = await this.loadSpecifiedDirs()
    this.ownCtx.emit('scan/finished', dir.id, {
      added: summary.added,
      updated: summary.updated,
      // Reported rather than inferred: a caller cannot tell a complete scan
      // that removed nothing from an incomplete one that was not allowed to.
      removed: summary.removed,
      errors: summary.errors,
      ...(complete ? {} : { incomplete: true }),
      ...(opts.signal.aborted ? { cancelled: true } : {}),
    })
  }

  /**
   * Read one file's tags + artwork and stage its cache write. Runs inside the
   * `mapPool` workers in `importBatch`, so it must not touch shared mutable
   * state (it returns its `PreparedFile`; the caller assembles the batch) —
   * the one exception is the `onFileStart` progress callback, a throttled
   * side-channel that never affects the batch's outcome.
   */
  private async prepareFile(
    file: FileStat,
    folderCovers?: Map<string, FileStat>,
    onFileStart?: (uri: Uri) => void,
  ): Promise<PreparedFile> {
    onFileStart?.(file.uri)
    // Debug timing (BBEBEE_SCAN_TIMING=1): split the per-file cost into the
    // codec read vs the DB write, so a slow scan can be blamed on the right
    // stage instead of guessed at.
    const time = scanTimingEnabled() ? performance.now() : 0
    try {
      // Tags only — artwork is lazy (see below). The parse runs in the
      // sidecar over direct fs (CodecBridge), so this is one bridge
      // round-trip, not 2+N.
      const metadata = await this.ownCtx.codec.readMetadata(file.uri)
      const tRead = time ? performance.now() : 0
      const supported = new Set(this.ownCtx.codec.supportedFormats().map((f) => f.toLowerCase()))
      const codec = metadata.codec?.toLowerCase()
      if (codec === 'alac' && !supported.has('alac')) {
        throw new Error('unsupported codec: ALAC is not supported on this platform')
      }
      if (codec === 'wma' && !supported.has('wma')) {
        throw new Error('unsupported codec: WMA is not supported on this platform')
      }
      /*
       * Lazy artwork: don't extract during scan. If the file has embedded
       * art, record a lazy ref id; `plugin-cache` extracts it on demand via
       * `ctx.codec.readArtwork` (which runs in the sidecar). Folder covers
       * are already images — the ref points at the file directly.
       */
      let lazyArtworkId: string | undefined
      if (metadata.hasArtwork) {
        lazyArtworkId = `lazy:${stableId(file.uri)}`
      }
      let folderCoverUri: Uri | undefined
      if (folderCovers) {
        const parentDir = parentDirectoryOf(file.uri)
        const folderCover = folderCovers.get(parentDir)
        if (folderCover) {
          folderCoverUri = folderCover.uri
        }
      }
      if (time) {
        const tEnd = performance.now()
        if (!this.timing) this.timing = { readMs: 0, artMs: 0, dbMs: 0, files: 0 }
        this.timing.readMs += tRead - time
        this.timing.artMs += tEnd - tRead
        this.timing.files++
      }
      return {
        file,
        metadata,
        ...(lazyArtworkId ? { lazyArtworkId } : {}),
        ...(folderCoverUri ? { folderCoverUri } : {}),
      }
    } catch (error) {
      this.ownCtx.logger.warn('scanner: could not read metadata for %s: %s', file.uri, String(error))
      return { file, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** One transaction per batch: a checkpoint, not an all-or-nothing scan. */
  private async importBatch(
    dir: ScanSpecifiedDir,
    batch: FileStat[],
    known: Map<string, EntryRow>,
    knownAnywhere: Map<string, EntryRow>,
    seen: Set<string>,
    summary: ScanSummary,
    full: boolean,
    folderCovers?: Map<string, FileStat>,
    onProgress?: (doneInBatch: number, currentFile?: string) => void,
  ): Promise<string[]> {
    const changed: string[] = []
    const now = Date.now()

    // Debug timing (BBEBEE_SCAN_TIMING=1): per-batch breakdown, logged once
    // per batch so a slow scan points at tag reads vs artwork writes vs the
    // DB transaction instead of all three being suspects.
    const timeBatch = scanTimingEnabled()
    if (timeBatch) this.timing = { readMs: 0, artMs: 0, dbMs: 0, files: 0 }

    // Reading tags is I/O and must not hold the write lock, so it happens
    // before the transaction opens rather than inside it.
    //
    // Tag reads are I/O-bound: run them with bounded concurrency instead of
    // strictly sequential. `seen` is still marked synchronously so the
    // walk's reconciliation view never depends on worker timing.
    const prepared: PreparedFile[] = []
    const unchangedUris = new Set<string>()
    for (const file of batch) {
      seen.add(file.uri)
      const previous = knownAnywhere.get(file.uri)
      // The incremental key. An unchanged file costs one `stat` — which the
      // walk already did — and nothing else.
      if (!full && previous && previous.size === file.size && previous.mtime === file.mtime) {
        prepared.push({ file, unchanged: true, previous })
        unchangedUris.add(file.uri)
      }
    }
    const toPrepare = batch.filter((file) => !unchangedUris.has(file.uri))
    // Files already known-unchanged cost nothing; they count as done up front
    // so the progress count moves from the batch's first file, not its first
    // tag read.
    const baseDone = batch.length - toPrepare.length
    let doneFresh = 0
    const preparedFresh = await mapPool(toPrepare, this.config.tagReadConcurrency, async (file) => {
      const onFileStart = onProgress
        ? (uri: Uri) => onProgress(baseDone + doneFresh, this.ownCtx.fs.basename(uri))
        : undefined
      try {
        return await this.prepareFile(file, folderCovers, onFileStart)
      } finally {
        doneFresh++
        onProgress?.(baseDone + doneFresh)
      }
    })
    prepared.push(...preparedFresh)

    const tDb0 = timeBatch ? performance.now() : 0
    await this.ownCtx.db.transaction(async (tx) => {
      for (const item of prepared) {
        if (item.unchanged) {
          // An unchanged file costs a stat — and, when two specified dirs
          // cover the same tree, an ownership move: the entry follows the dir
          // that last saw the file, which is what visibility follows. Without
          // this, a file owned by a disabled dir would stay hidden even while
          // an enabled dir still covers it.
          if (item.previous && item.previous.specified_dir_id !== dir.id) {
            await this.writeEntry(
              tx,
              dir.id,
              item.file,
              item.previous.status,
              item.previous.track_urn,
              item.previous.error,
            )
          }
          continue
        }

        if (item.error || !item.metadata) {
          summary.errors++
          const { removedTrackUrn } = await forgetFile(
            { tx, sourceId: this.config.sourceId, now },
            item.file.uri,
          )
          if (removedTrackUrn) changed.push(removedTrackUrn)
          await this.writeEntry(tx, dir.id, item.file, 'error', null, item.error ?? 'unreadable')
          continue
        }

        const { trackUrn } = await importTrack(
          { tx, sourceId: this.config.sourceId, now },
          {
            uri: item.file.uri,
            size: item.file.size,
            mtime: item.file.mtime,
            metadata: item.metadata,
            ...(item.lazyArtworkId
              ? { lazyArtworkId: item.lazyArtworkId, lazyArtworkSource: item.file.uri }
              : {}),
            ...(item.folderCoverUri ? { folderCoverUri: item.folderCoverUri } : {}),
            format: extensionOf(item.file.uri),
          },
        )
        if (known.has(item.file.uri)) summary.updated++
        else summary.added++
        changed.push(trackUrn)
        await this.writeEntry(tx, dir.id, item.file, 'ok', trackUrn, null)
      }
    })

    if (timeBatch && this.timing) {
      const t = this.timing
      t.dbMs += performance.now() - tDb0
      // readMs/artMs are wall-clock sums across concurrent workers, so they
      // can exceed the batch's elapsed time — the ratio is what matters.
      this.ownCtx.logger.info(
        'scanner: batch timing files=%d tagRead=%dms artworkSave=%dms dbTxn=%dms',
        t.files,
        Math.round(t.readMs),
        Math.round(t.artMs),
        Math.round(t.dbMs),
      )
      this.timing = null
    }

    return changed
  }

  private async writeEntry(
    tx: { exec(sql: string, params?: (string | number | null)[]): Promise<unknown> },
    specifiedDirId: string,
    file: FileStat,
    status: string,
    trackUrn: string | null,
    error: string | null,
  ): Promise<void> {
    await tx.exec(
      `INSERT INTO scan_entries (uri, specified_dir_id, size, mtime, track_urn, status, error, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         specified_dir_id = excluded.specified_dir_id,
         size             = excluded.size,
         mtime            = excluded.mtime,
         track_urn        = excluded.track_urn,
         status           = excluded.status,
         error            = excluded.error,
         scanned_at       = excluded.scanned_at`,
      [file.uri, specifiedDirId, file.size, file.mtime, trackUrn, status, error, Date.now()],
    )
  }

  /** Files that are gone take their binding, and any orphaned track, with them. */
  private async forgetGone(uris: string[], summary: ScanSummary): Promise<void> {
    const removed: string[] = []
    await this.ownCtx.db.transaction(async (tx) => {
      for (const uri of uris) {
        const { removedTrackUrn } = await forgetFile(
          { tx, sourceId: this.config.sourceId, now: Date.now() },
          uri,
        )
        if (removedTrackUrn) removed.push(removedTrackUrn)
        await tx.exec('DELETE FROM scan_entries WHERE uri = ?', [uri])
        summary.removed++
      }
    })
    if (removed.length > 0) this.ownCtx.emit('library/changed', 'track', removed)
  }

  /**
   * Cleans up unloved local tracks that were mistakenly inserted into `library_items`
   * by earlier scanner versions. `library_items` represents the user's curated favorites,
   * so local tracks should only appear if explicitly favorited (track_stats.loved = 1).
   */
  private async cleanUnlovedLibraryItems(): Promise<void> {
    try {
      await this.ownCtx.db.exec(
        `DELETE FROM library_items
          WHERE kind = 'track'
            AND (source_id = ? OR urn LIKE 'BBeBee:local:%')
            AND urn NOT IN (SELECT urn FROM track_stats WHERE loved = 1)`,
        [this.config.sourceId],
      )
    } catch (e) {
      this.ownCtx.logger.warn(`scanner: failed to clean unloved library_items: ${String(e)}`)
    }
  }

  /**
   * Breadth-first walk of a scan specified dir.
   *
   * ⚠️ **Bounded on purpose.** `ctx.fs.list` follows directory symlinks, so a
   * library containing `ln -s . loop` — or two directories linking to each
   * other, which real collections do have — produced a queue that never
   * emptied. The scan did not fail; it ran until the process died, which is
   * the worst shape a bug can take.
   *
   * `visited` catches a path repeating exactly. The depth cap and the total
   * directory budget together catch the general case, where every hop through
   * the link yields a *new* path (`sub/loop/sub/loop/…`) that no URI-keyed set
   * can recognise — and where two mutually-linked directories multiply paths
   * exponentially rather than merely deepening them.
   *
   * Residual, stated rather than hidden: files under a symlinked duplicate
   * directory are still imported once per reachable path, as separate tracks.
   * Collapsing those needs canonical-path identity — `realpath`, or a device
   * and inode — which `ctx.fs` does not expose and Expo's filesystem cannot
   * generally provide. The cap keeps the damage finite and visible.
   */
  private async walk(
    uri: Uri,
    recursive: boolean,
    signal: AbortSignal,
    onProgress?: (dirsListed: number, filesFound: number) => void,
  ): Promise<{ files: FileStat[]; folderCovers: Map<string, FileStat>; truncated: boolean }> {
    const found = new Map<Uri, FileStat>()
    const folderCovers = new Map<string, { stat: FileStat; score: number }>()
    const visited = new Set<Uri>([uri])
    let queue: Uri[] = [uri]
    let depth = 0

    let listed = 0
    let unreadable = 0
    while (queue.length > 0 && depth <= MAX_SCAN_DEPTH && listed < MAX_SCAN_DIRS) {
      const next: Uri[] = []
      for (const dir of queue) {
        if (signal.aborted) {
          const covers = new Map<string, FileStat>()
          for (const [k, v] of folderCovers) covers.set(k, v.stat)
          return { files: [...found.values()], folderCovers: covers, truncated: true }
        }
        if (++listed > MAX_SCAN_DIRS) break
        // Report walk progress so the UI doesn't sit at "0 files" while
        // enumerating a large tree. Throttle to every 10 dirs to avoid
        // flooding the event bus.
        if (onProgress && listed % 10 === 0) {
          onProgress(listed, found.size)
        }
        let listing: FileStat[]
        try {
          listing = await this.ownCtx.fs.list(dir)
        } catch {
          /*
           * An unreadable directory is not a scan *failure* — a permissions
           * quirk somewhere in a music folder must not abort the walk. But it
           * *is* a hole in the view, and reconciliation cannot tell a file it
           * could not see from one that is gone: without this, `chmod 000` on
           * a subdirectory deleted its tracks on the next scan, silently.
           */
          unreadable++
          continue
        }
        for (const entry of listing) {
          if (entry.isDirectory) {
            if (!recursive || visited.has(entry.uri)) continue
            visited.add(entry.uri)
            next.push(entry.uri)
            continue
          }
          if (this.isAudio(entry.uri)) {
            found.set(entry.uri, entry)
          } else {
            const score = folderCoverScore(entry.uri)
            if (score >= 0) {
              const existing = folderCovers.get(dir)
              if (!existing || score < existing.score) {
                folderCovers.set(dir, { stat: entry, score })
              }
            }
          }
        }
      }
      queue = next
      depth++
    }

    const covers = new Map<string, FileStat>()
    for (const [k, v] of folderCovers) covers.set(k, v.stat)

    const truncated = queue.length > 0 || listed >= MAX_SCAN_DIRS || unreadable > 0
    if (unreadable > 0) {
      const ctx = this.ownCtx
      ctx.logger.warn(
        `scanner: ${unreadable} director${unreadable === 1 ? 'y' : 'ies'} under ${uri} could ` +
          'not be read. This scan will not remove anything, because it did not see everything.',
      )
    }
    if (queue.length > 0 || listed >= MAX_SCAN_DIRS) {
      // Say so rather than silently truncating: a library legitimately this
      // large is a bug report worth getting, and a symlink loop is a problem
      // the user can fix once they know it is there.
      const limit =
        listed >= MAX_SCAN_DIRS ? `${MAX_SCAN_DIRS} directories` : `depth ${MAX_SCAN_DEPTH}`
      const ctx = this.ownCtx
      ctx.logger.warn(
        `scanner: stopped at ${limit} under ${uri} — a directory symlink loop, ` +
          'or a tree larger than any real library. This scan will not remove ' +
          'anything, because it did not see everything.',
      )
    }
    return { files: [...found.values()], folderCovers: covers, truncated }
  }

  private isAudio(uri: Uri): boolean {
    const ext = extensionOf(uri)
    return ext !== undefined && this.config.extensions.includes(ext)
  }

  /* ── keeping up with the filesystem ────────────────────────────────── */

  private async startWatching(): Promise<void> {
    for (const off of this.watchers) off()
    this.watchers = []
    if (this.disposed) return

    const enabled = this.specifiedDirList.filter((r) => r.enabled)
    if (enabled.length === 0) return

    if (this.ownCtx.fs.canWatch) {
      for (const dir of enabled) {
        try {
          const off = await this.ownCtx.fs.watch(dir.uri, () => this.scheduleRescan(dir.id))
          this.watchers.push(off)
        } catch {
          // A specified dir that cannot be watched still gets scanned on demand.
        }
      }
      return
    }

    // ⚠️ React Native has no `fs.watch`, and neither does the desktop bridge,
    // so the library goes stale between polls and the UI says so rather than
    // implying live updates (docs/04 §1).
    //
    // `ctx.background` is preferred where it exists, because on mobile only
    // the OS scheduler can run work while the app is away. But it is an
    // *optional* service: when it is absent — which is every desktop build
    // until `core-background-tauri` lands — the scanner falls back to its
    // own timer. Without that fallback there was no automatic rescan on
    // desktop at all: files changed and the library silently stayed stale.
    let scheduled = false
    this.ownCtx.inject(['background'], (scoped) => {
      scheduled = true
      let cancelled = false
      void scoped.background
        .schedule('scanner:poll', this.config.pollIntervalMinutes, async () => {
          if (!cancelled) await this.scan()
        })
        .then((off) => this.watchers.push(off))
      return () => {
        cancelled = true
        scheduled = false
      }
    })

    if (!scheduled) this.startSelfPoll()
  }

  /**
   * The fallback timer.
   *
   * Deliberately a chained `setTimeout` rather than an interval: a scan that
   * takes longer than the period must not have another queued behind it.
   */
  private startSelfPoll(): void {
    // Floored in milliseconds rather than minutes: a misconfigured 0 must not
    // become a busy loop, but a test may legitimately ask for a fast poll.
    const period = Math.max(50, this.config.pollIntervalMinutes * 60_000)
    const tick = () => {
      this.pollTimer = setTimeout(() => {
        void this.scan()
          .catch(() => undefined)
          .finally(() => {
            if (!this.disposed) tick()
          })
      }, period)
    }
    tick()
    this.watchers.push(() => {
      if (this.pollTimer) clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    })
  }

  private scheduleRescan(specifiedDirId: string): void {
    // Debounced: copying 200 files in should be one rescan, not 200.
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      void this.scan({ specifiedDirId }).catch(() => undefined)
    }, this.config.watchDebounceMs)
  }

  /* ── bookkeeping ───────────────────────────────────────────────────── */

  private async loadSpecifiedDirs(): Promise<ScanSpecifiedDir[]> {
    const rows = await this.ownCtx.db.query<{
      id: string
      uri: string
      recursive: number
      enabled: number
      last_scan_at: number | null
      last_error: string | null
    }>('SELECT id, uri, recursive, enabled, last_scan_at, last_error FROM scan_specified_dirs')

    return rows.map((row) => ({
      id: row.id,
      uri: row.uri,
      recursive: row.recursive === 1,
      enabled: row.enabled === 1,
      ...(row.last_scan_at ? { lastScanAt: row.last_scan_at } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}),
    }))
  }

  /**
   * The catalogue's foreign keys point at a `sources` row, so the source the
   * scanner writes under has to exist before any track does. The scanner
   * creates it because the scanner is the writer; `plugin-source-local` reads
   * the same rows and needs no say in it.
   *
   * Local files are the one source that is **not** an imported document
   * (docs/06 §12) — there is no HTTP to describe — so this writes the minimal
   * row the FKs need. `doc_json` is a real document all the same: it round
   * trips through export like any other, and says plainly what it is.
   */
  private async ensureSourceRow(): Promise<void> {
    const id = this.config.sourceId
    const sourceUrl = id === 'local' ? 'bbebee://local' : `bbebee://local/${id}`
    const doc = JSON.stringify({
      sourceUrl,
      sourceName: 'This device',
      sourceComment: 'Files on this device. Managed by the scanner, not imported.',
    })
    await this.ownCtx.db.exec(
      `INSERT INTO sources (id, source_url, name, source_type, doc_json, doc_hash,
                            enabled, imported_at, updated_at)
       VALUES (?, ?, 'This device', 'music', ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [id, sourceUrl, doc, `local-${id}`, Date.now(), Date.now()],
    )
  }
}

function extensionOf(uri: string): string | undefined {
  const normalized = uri.replace(/\\/g, '/')
  const name = normalized.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined
}

const COVER_BASE_NAMES = ['cover', 'folder', 'front', 'album']
const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

function folderCoverScore(uri: Uri): number {
  const ext = extensionOf(uri)
  if (!ext || !COVER_EXTENSIONS.includes(ext)) return -1
  const normalized = uri.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop() ?? ''
  const dot = fileName.lastIndexOf('.')
  const baseName = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase()
  const idx = COVER_BASE_NAMES.indexOf(baseName)
  return idx === -1 ? -1 : idx
}

function parentDirectoryOf(uri: string): string {
  const normalized = uri.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx > 0 ? normalized.slice(0, idx) : normalized
}

export const name = 'plugin-local-scanner'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.scanner` is usable.
 */
export async function apply(ctx: Context, config: ScannerConfig = {}) {
  ctx.logger.info('plugin-local-scanner: loaded')
  const fiber = await ctx.plugin(Scanner, config)
  return () => void fiber.dispose()
}

export default { name, apply }
export { importTrack, forgetFile, sortKey } from './import.js'
export { splitArtists, trackId, albumId, artistId, artworkId } from '@BBeBee/toolkit'