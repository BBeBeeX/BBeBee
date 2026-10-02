/**
 * Turning an OS drag into catalogue rows.
 *
 * The gesture lives here, at the app surface, rather than inside a plugin
 * view: a drop has to work over every screen, and plugins see neither the
 * `dataTransfer` nor `window.BBeBee`. It is wiring, not business logic — the
 * importer only routes: a dropped *directory* takes the existing folder path
 * (`addSpecifiedDir` + scan, so it is watched and reconciled like any other),
 * files take `ctx.scanner.importFiles`, which imports them once without
 * turning their folder into a scan dir.
 */

import type { Context } from 'cordis'
import type { FsService, ScannerService } from '@BBeBee/protocol'

export interface DropImportResult {
  /** Dropped files that became (or updated) tracks. */
  imported: number
  /** Dropped folders added to the scan set. */
  folders: number
  /** Dropped items that produced nothing — unreadable, or not audio. */
  failed: number
}

/**
 * The pre-filter for a drop, mirroring the scanner's own list. Keeping it
 * here means the toast can say "not audio" about a PDF instead of reporting
 * a decode failure; the scanner still re-checks everything it is handed.
 */
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
 * A filesystem path → a `file://` uri, encoded per segment.
 *
 * `webUtils.getPathForFile` returns a real OS path — unicode, spaces, all of
 * it — and everything downstream (`fs.stat`, the scanner, the bridge's
 * containment check) speaks uris. The drive letter is the one segment that
 * must not be percent-encoded, which is why it is handled before the rest.
 */
export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const drive = /^([a-zA-Z]):(?:\/(.*))?$/.exec(normalized)
  if (drive) {
    const rest = (drive[2] ?? '').split('/').map((s) => (s ? encodeURIComponent(s) : '')).join('/')
    return `file:///${drive[1]!.toUpperCase()}:/${rest}`
  }
  const body = normalized.split('/').map((s) => (s ? encodeURIComponent(s) : '')).join('/')
  return 'file://' + (body.startsWith('/') ? '' : '/') + body
}

/**
 * Read a service off the context safely without throwing proxy violations on scoped contexts.
 */
export function serviceOf<T = unknown>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { reflect?: { get(key: string, required: boolean): unknown } }).reflect?.get?.(
    key,
    false,
  ) as T | undefined
}

/**
 * Resolve a service immediately if available, or wait for its arrival via inject.
 */
export function resolveService<T = unknown>(
  ctx: Context,
  key: string,
  timeoutMs = 8000,
): Promise<T | undefined> {
  const existing = serviceOf<T>(ctx, key)
  if (existing) return Promise.resolve(existing)

  return new Promise<T | undefined>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false

    const finish = (svc: T | undefined) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(svc)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => finish(undefined), timeoutMs)
    }

    if (typeof ctx.inject !== 'function') {
      finish(undefined)
      return
    }

    ctx.inject([key], (scoped) => {
      finish(serviceOf<T>(scoped, key) ?? ((scoped as unknown as Record<string, unknown>)[key] as T))
    })
  })
}

/**
 * Import whatever the user dropped onto the window.
 *
 * Never throws: every failure mode lands in `failed` so the shell can say
 * one honest sentence about the drop instead of the gesture silently dying.
 */
export async function importDroppedFiles(ctx: Context, fileList: FileList): Promise<DropImportResult> {
  const files = Array.from(fileList)
  const result: DropImportResult = { imported: 0, folders: 0, failed: 0 }

  // A `File` without a path is not on disk (an in-page drag, a browser
  // extension artefact) — nothing this app can do with it.
  const paths = files.map((file) => window.BBeBee?.files?.getPath(file) ?? '')
  result.failed += paths.filter((p) => p.length === 0).length

  const validPaths = paths.filter((p) => p.length > 0)
  if (validPaths.length === 0) return result

  const [fs, scanner] = await Promise.all([
    resolveService<FsService>(ctx, 'fs', 3000),
    resolveService<ScannerService>(ctx, 'scanner', 8000),
  ])

  if (!scanner) {
    ctx.logger?.warn('drop-import: scanner service is not available')
    result.failed += validPaths.length
    return result
  }

  const folderUris: string[] = []
  const audioUris: string[] = []
  for (const path of validPaths) {
    const uri = pathToFileUri(path)
    if (fs) {
      try {
        const stat = await fs.stat(uri)
        if (stat.isDirectory) {
          folderUris.push(uri)
          continue
        }
      } catch {
        // Unstatable: fall through and let the extension check — then the
        // importer — decide, so the user gets a reason rather than a silence.
      }
    }
    if (AUDIO_EXTENSIONS.has(extensionOf(path))) audioUris.push(uri)
    else result.failed++
  }

  for (const uri of folderUris) {
    try {
      await scanner.addSpecifiedDir(uri)
      result.folders++
      // Incremental, so it costs one stat per unchanged file. Not awaited:
      // a large folder scans for minutes, and the drop must not appear to
      // hang for it.
      void scanner.scan().catch((error: unknown) => {
        ctx.logger?.warn(`drop-import: scan after folder drop failed: ${String(error)}`)
      })
    } catch (error) {
      ctx.logger?.warn(`drop-import: could not add dropped folder ${uri}: ${String(error)}`)
      result.failed++
    }
  }

  if (audioUris.length > 0) {
    try {
      const summary = await scanner.importFiles(audioUris)
      result.imported = summary.added + summary.updated
      result.failed += summary.errors
    } catch (error) {
      ctx.logger?.warn(`drop-import: importing dropped files failed: ${String(error)}`)
      result.failed += audioUris.length
    }
  }

  return result
}
