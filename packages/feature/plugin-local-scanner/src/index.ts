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
import { artworkId, stableId } from '@BBeBee/toolkit'
import { forgetFile, importTrack } from './import.js'
import { SCANNER_VIEWS } from './views.js'

export interface ScannerConfig {
  /** Files per transaction. A checkpoint costs one batch on interruption. */
  batchSize?: number
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
  artwork?: Uint8Array
  artworkUri?: Uri
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

export class Scanner extends Service implements ScannerService {
  static inject = ['fs', 'db', 'codec', 'paths']

  private readonly config: Required<ScannerConfig>

  private readonly ownCtx: Context
  private specifiedDirList: ScanSpecifiedDir[] = []
  private current?: ScanProgress
  private abort?: AbortController
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
      extensions: (config.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
      sourceId: config.sourceId ?? 'local',
      pollIntervalMinutes: config.pollIntervalMinutes ?? 24 * 60, // 1 day (1440 minutes)
      watchDebounceMs: config.watchDebounceMs ?? 2000,
    }
  }

  async [Service.init]() {
    // A descriptor, not a component: the settings page is listed even on a
    // target whose view package was not loaded, which is what lets a shell
    // show "not available on this platform" rather than a hole (docs/08 §3).
    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.ui.contribute({
        kind: 'settings',
        id: SCANNER_VIEWS.settings,
        section: 'sources',
        title: '本地音乐文件夹 (Music Folders)',
        description: '添加包含本地音频文件的文件夹，即时执行扫描并建立索引',
        actionText: '管理文件夹',
        order: 30,
      }),
    )

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
    // `scan_entries` cascades from the specified dir row.
    await this.ownCtx.db.exec('DELETE FROM scan_specified_dirs WHERE id = ?', [id])
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
    const before = await this.allVisibility()
    await this.ownCtx.db.exec(
      `UPDATE tracks SET available = ${AVAILABILITY_CASE}
       WHERE urn IN (SELECT track_urn FROM scan_entries WHERE track_urn IS NOT NULL)`,
    )
    const after = await this.allVisibility()
    const flips = [...before]
      .filter(([urn, available]) => after.get(urn) !== available)
      .map(([urn]) => urn)
    if (flips.length > 0) this.ownCtx.emit('library/changed', 'track', flips)
  }

  private async allVisibility(): Promise<Map<string, number>> {
    const rows = await this.ownCtx.db.query<{ urn: string; available: number }>(
      `SELECT se.track_urn AS urn, t.available AS available
         FROM scan_entries se JOIN tracks t ON t.urn = se.track_urn
        WHERE se.track_urn IS NOT NULL`,
    )
    return new Map(rows.map((r) => [r.urn, r.available]))
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
        const artwork = metadata.hasArtwork
          ? await this.ownCtx.codec.readArtwork(uri).catch(() => undefined)
          : undefined
        let artworkUri: Uri | undefined
        if (artwork && artwork.length > 0) {
          artworkUri = await this.saveArtwork(artwork)
        }
        prepared.push({
          file,
          metadata,
          ...(artwork ? { artwork } : {}),
          ...(artworkUri ? { artworkUri } : {}),
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
            ...(item.artwork ? { artwork: item.artwork } : {}),
            ...(item.artworkUri ? { artworkUri: item.artworkUri } : {}),
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
      const walked = await this.walk(dir.uri, dir.recursive, opts.signal)
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
      const changed = await this.importBatch(
        dir,
        batch,
        known,
        knownAnywhere,
        seen,
        summary,
        opts.full,
        folderCovers,
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
  ): Promise<string[]> {
    const changed: string[] = []
    const now = Date.now()

    // Reading tags is I/O and must not hold the write lock, so it happens
    // before the transaction opens rather than inside it.
    const prepared: PreparedFile[] = []

    for (const file of batch) {
      seen.add(file.uri)
      const previous = knownAnywhere.get(file.uri)
      // The incremental key. An unchanged file costs one `stat` — which the
      // walk already did — and nothing else.
      if (!full && previous && previous.size === file.size && previous.mtime === file.mtime) {
        prepared.push({ file, unchanged: true, previous })
        continue
      }
      try {
        const metadata = await this.ownCtx.codec.readMetadata(file.uri)
        const supported = new Set(this.ownCtx.codec.supportedFormats().map((f) => f.toLowerCase()))
        const codec = metadata.codec?.toLowerCase()
        if (codec === 'alac' && !supported.has('alac')) {
          throw new Error('unsupported codec: ALAC is not supported on this platform')
        }
        if (codec === 'wma' && !supported.has('wma')) {
          throw new Error('unsupported codec: WMA is not supported on this platform')
        }
        let artwork = metadata.hasArtwork
          ? await this.ownCtx.codec.readArtwork(file.uri).catch(() => undefined)
          : undefined
        if (!artwork && folderCovers) {
          const parentDir = parentDirectoryOf(file.uri)
          const folderCover = folderCovers.get(parentDir)
          if (folderCover) {
            artwork = await this.ownCtx.fs.readBytes(folderCover.uri).catch(() => undefined)
          }
        }
        let artworkUri: Uri | undefined
        if (artwork && artwork.length > 0) {
          artworkUri = await this.saveArtwork(artwork)
        }
        prepared.push({
          file,
          metadata,
          ...(artwork ? { artwork } : {}),
          ...(artworkUri ? { artworkUri } : {}),
        })
      } catch (error) {
        this.ownCtx.logger.warn('scanner: could not read metadata for %s: %s', file.uri, String(error))
        prepared.push({ file, error: error instanceof Error ? error.message : String(error) })
      }
    }

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
            ...(item.artwork ? { artwork: item.artwork } : {}),
            ...(item.artworkUri ? { artworkUri: item.artworkUri } : {}),
            format: extensionOf(item.file.uri),
          },
        )
        if (known.has(item.file.uri)) summary.updated++
        else summary.added++
        changed.push(trackUrn)
        await this.writeEntry(tx, dir.id, item.file, 'ok', trackUrn, null)
      }
    })

    return changed
  }

  private async saveArtwork(bytes: Uint8Array): Promise<Uri> {
    const id = artworkId(bytes)
    const ext = extensionForImage(bytes)
    const cacheDir = this.ownCtx.fs.join(this.ownCtx.paths.cache, 'artworks')
    await this.ownCtx.fs.mkdir(cacheDir, { recursive: true }).catch(() => undefined)
    const targetUri = this.ownCtx.fs.join(cacheDir, `${id}.${ext}`)
    if (!(await this.ownCtx.fs.exists(targetUri).catch(() => false))) {
      await this.ownCtx.fs.writeFile(targetUri, bytes).catch(() => undefined)
    }
    return targetUri
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
    // until `core-background-electron` lands — the scanner falls back to its
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
    const doc = JSON.stringify({
      sourceUrl: `bbebee://local/${id}`,
      sourceName: 'This device',
      sourceComment: 'Files on this device. Managed by the scanner, not imported.',
    })
    await this.ownCtx.db.exec(
      `INSERT INTO sources (id, source_url, name, source_type, doc_json, doc_hash,
                            enabled, imported_at, updated_at)
       VALUES (?, ?, 'This device', 'music', ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [id, `bbebee://local/${id}`, doc, `local-${id}`, Date.now(), Date.now()],
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

function extensionForImage(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return 'jpg'
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