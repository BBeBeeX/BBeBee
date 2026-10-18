/**
 * Turning an OS drag into catalogue rows.
 *
 * The gesture lives at the app surface (not in a plugin view): a drop must
 * work over every screen, and plugins see neither `dataTransfer` nor
 * `window.BBeBee`.
 *
 * Routing:
 * - Dropped **directories** → `scanner.addSpecifiedDir` + background scan
 *   (watched and reconciled like any other folder).
 * - Dropped **files** → `scanner.importFiles` (one-shot, no scan dir).
 *
 * Never throws: every failure lands in `result.failed` so the shell can
 * report one honest sentence about the drop.
 */

import type { Context } from 'cordis'
import type { DbService, FsService, ScannerService } from '@BBeBee/protocol'

export interface DropImportResult {
  /** Files that became (or updated) tracks. */
  imported: number
  /** Folders added to the scan set. */
  folders: number
  /** Items that produced nothing — unreadable, or not audio. */
  failed: number
  /** Track URNs of imported tracks, if known. */
  importedUrns?: string[]
}

/** Pre-filter mirroring the scanner's list (the scanner re-checks anyway). */
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav',
  'aiff', 'aif', 'wma', 'alac', 'ape', 'wv', 'dsf', 'dff', 'm4b',
])

function extensionOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * OS path → `file://` URI, encoded per segment.
 *
 * The drive letter is the one segment that must not be percent-encoded.
 */
export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const drive = /^([a-zA-Z]):(?:\/(.*))?$/.exec(normalized)
  if (drive) {
    const rest = (drive[2] ?? '')
      .split('/')
      .map((s) => (s ? encodeURIComponent(s) : ''))
      .join('/')
    return `file:///${drive[1]!.toUpperCase()}:/${rest}`
  }
  const body = normalized
    .split('/')
    .map((s) => (s ? encodeURIComponent(s) : ''))
    .join('/')
  return 'file://' + (body.startsWith('/') ? '' : '/') + body
}

/** Read a service off the context without throwing on scoped contexts. */
export function serviceOf<T = unknown>(ctx: Context, key: string): T | undefined {
  const reflect = (ctx as unknown as {
    reflect?: { get(key: string, required: boolean): unknown }
  }).reflect
  return reflect?.get?.(key, false) as T | undefined
}

/** Resolve a service now, or wait for its arrival (with timeout). */
export function resolveService<T = unknown>(
  ctx: Context,
  key: string,
  timeoutMs = 8000,
): Promise<T | undefined> {
  const existing = serviceOf<T>(ctx, key)
  if (existing) return Promise.resolve(existing)

  return new Promise<T | undefined>((resolve) => {
    let done = false
    const finish = (svc: T | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(svc)
    }

    const timer = setTimeout(() => finish(undefined), timeoutMs)

    if (typeof ctx.inject !== 'function') {
      finish(undefined)
      return
    }
    ctx.inject([key], (scoped) => {
      const svc = serviceOf<T>(scoped, key) ??
        (scoped as unknown as Record<string, unknown>)[key] as T
      finish(svc)
    })
  })
}

/**
 * Look up track URNs for a set of media URIs.
 *
 * Used to navigate to the imported tracks after a drop. Failures are
 * logged and return an empty list — URNs are a convenience, not a
 * requirement.
 */
async function lookupTrackUrns(
  ctx: Context,
  uris: string[],
  byPrefix: boolean,
): Promise<string[]> {
  if (uris.length === 0) return []
  const db = await resolveService<DbService>(ctx, 'db', 300)
  if (!db) return []

  try {
    let rows: { track_urn: string }[]
    if (byPrefix) {
      const conditions = uris.map(() => 'uri LIKE ?').join(' OR ')
      const params = uris.map((u) => (u.endsWith('/') ? `${u}%` : `${u}/%`))
      rows = await db.query<{ track_urn: string }>(
        `SELECT track_urn FROM media_bindings WHERE ${conditions}`,
        params,
      )
    } else {
      const placeholders = uris.map(() => '?').join(', ')
      rows = await db.query<{ track_urn: string }>(
        `SELECT track_urn FROM media_bindings WHERE uri IN (${placeholders})`,
        uris,
      )
    }
    return [...new Set(rows.map((r) => r.track_urn).filter(Boolean))]
  } catch (err) {
    ctx.logger?.warn('[drop-import] track URN lookup failed: %s', String(err))
    return []
  }
}

/** Merge URNs into the result, deduplicating. */
function mergeUrns(result: DropImportResult, urns: string[]): void {
  if (urns.length === 0) return
  result.importedUrns = [...new Set([...(result.importedUrns ?? []), ...urns])]
}

/**
 * Import files from a `FileList` (HTML5 drop).
 *
 * Under Tauri, webview `File` objects carry no path; the real paths arrive
 * via the `tauri://drag-drop` event and go through `importDroppedPaths`.
 */
export async function importDroppedFiles(
  ctx: Context,
  fileList: FileList,
): Promise<DropImportResult> {
  const paths = Array.from(fileList).map(
    (file) => window.BBeBee?.files?.getPath(file) ?? '',
  )
  return importDroppedPaths(ctx, paths)
}

/**
 * Import from OS paths (the `tauri://drag-drop` payload).
 */
export async function importDroppedPaths(
  ctx: Context,
  paths: string[],
): Promise<DropImportResult> {
  const result: DropImportResult = { imported: 0, folders: 0, failed: 0 }

  const validPaths = paths.filter((p) => p.length > 0)
  result.failed += paths.length - validPaths.length
  if (validPaths.length === 0) return result

  const [fs, scanner] = await Promise.all([
    resolveService<FsService>(ctx, 'fs', 3000),
    resolveService<ScannerService>(ctx, 'scanner', 8000),
  ])

  if (!scanner) {
    ctx.logger?.warn('[drop-import] scanner unavailable, failing %d paths', validPaths.length)
    result.failed += validPaths.length
    return result
  }

  // Classify into folders vs audio files
  const { folderUris, audioUris } = await classifyPaths(ctx, fs, validPaths, result)

  // Folders: add + background scan
  for (const uri of folderUris) {
    try {
      const dir = await scanner.addSpecifiedDir(uri)
      result.folders++
      // Fire-and-forget: the UI navigates immediately; LocalMusicScreen
      // reloads on scan/finished and library/changed as tracks appear.
      void scanner.scan({ specifiedDirId: dir.id }).catch((err: unknown) => {
        ctx.logger?.warn('[drop-import] background scan failed: %s', String(err))
      })
    } catch (err) {
      ctx.logger?.warn('[drop-import] addSpecifiedDir failed for %s: %s', uri, String(err))
      result.failed++
    }
  }
  mergeUrns(result, await lookupTrackUrns(ctx, folderUris, true))

  // Files: one-shot import
  if (audioUris.length > 0) {
    try {
      const summary = await scanner.importFiles(audioUris)
      result.imported = summary.added + summary.updated
      result.failed += summary.errors
    } catch (err) {
      ctx.logger?.warn('[drop-import] importFiles failed: %s', String(err))
      result.failed += audioUris.length
    }
    mergeUrns(result, await lookupTrackUrns(ctx, audioUris, false))
  }

  ctx.logger?.info(
    '[drop-import] done: %d imported, %d folders, %d failed',
    result.imported, result.folders, result.failed,
  )
  return result
}

/** Split paths into folder URIs and audio-file URIs. */
async function classifyPaths(
  ctx: Context,
  fs: FsService | undefined,
  paths: string[],
  result: DropImportResult,
): Promise<{ folderUris: string[]; audioUris: string[] }> {
  const folderUris: string[] = []
  const audioUris: string[] = []

  for (const path of paths) {
    const ext = extensionOf(path)
    const uri = pathToFileUri(path)

    if (AUDIO_EXTENSIONS.has(ext)) {
      audioUris.push(uri)
      continue
    }

    // Not audio by extension — check if it's a directory
    let isDir = false
    if (fs) {
      try {
        isDir = (await fs.stat(uri)).isDirectory
      } catch {
        // Outside containment or unreadable; an extensionless path is
        // likely a folder drop — let addSpecifiedDir decide.
        isDir = !ext
      }
    } else {
      isDir = !ext
    }

    if (isDir) {
      folderUris.push(uri)
    } else {
      result.failed++
    }
  }

  return { folderUris, audioUris }
}
