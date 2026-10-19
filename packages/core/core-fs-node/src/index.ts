/**
 * `ctx.fs` for Node and desktop host, over `node:fs/promises`.
 *
 * Runs in the desktop **sidecar** process (or directly, in a Node host or test).
 * Per ADR-3 the renderer reaches it through a preload IPC bridge; that proxy
 * is a separate thin package implementing the same `FsService`, so this file
 * stays the single home of the actual behaviour.
 *
 * See docs/04-core-services.md §1.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { statfs } from 'node:fs/promises'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import { assertFs, capabilityConfigOf } from '@BBeBee/kernel'
import type { CapabilityConfig } from '@BBeBee/kernel'
import { uriContains } from '@BBeBee/protocol'
import type {
  Disposable,
  FileStat,
  FsService,
  ReadOptions,
  Uri,
  WatchEvent,
  WellKnownDir,
  WriteOptions,
} from '@BBeBee/protocol'

/** Which capability scope a location falls under, for the gate. */
type Scope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

export class FsNode extends Service implements FsService {
  static inject = ['paths']

  readonly canWatch = true

  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  /* ── Uri <-> path ───────────────────────────────────────────────────── */

  private toPath(uri: Uri): string {
    const fileUri = uri.startsWith('bbebee-file:') ? (uri.replace(/^bbebee-file:\/*/, 'file:///') as Uri) : uri
    if (fileUri.startsWith('file://')) {
      const p = fileURLToPath(fileUri)
      // When running on non-Windows/WSL or if fileURLToPath produced a path with
      // a leading slash before a Windows drive letter (e.g. /C:/...), strip the leading slash.
      if (/^\/[a-zA-Z]:[\\/]/.test(p)) {
        return decodeURIComponent(p.slice(1))
      }
      return p
    }
    // Handle URL pathname with leading slash before Windows drive letter: /C:/... or /C:\...
    const winMatch = uri.match(/^\/([a-zA-Z]:[\\/].*)/)
    if (winMatch && winMatch[1]) {
      return decodeURIComponent(winMatch[1])
    }
    // Tolerate a bare Windows path (C:\... or C:/...)
    if (/^[a-zA-Z]:[\\/]/.test(uri)) {
      return uri.includes('%') ? decodeURIComponent(uri) : uri
    }
    // Tolerate a bare Unix path
    if (uri.startsWith('/')) {
      return uri.includes('%') ? decodeURIComponent(uri) : uri
    }
    throw new TypeError(`not a file uri: ${uri}`)
  }

  private toUri(path: string): Uri {
    if (process.platform === 'win32') {
      const clean = path.replace(/^\/([a-zA-Z]:)/, '$1')
      const decoded = clean.includes('%') ? decodeURI(clean) : clean
      return pathToFileURL(decoded).href.replace(/\/$/, '')
    }
    // Cross-platform support for Windows paths on non-Windows hosts:
    if (/^\/?[a-zA-Z]:[\\/]/.test(path)) {
      const clean = path.replace(/\\/g, '/').replace(/^\//, '')
      const decoded = clean.includes('%') ? decodeURI(clean) : clean
      const drive = decoded[0]!.toUpperCase() + decoded.slice(1)
      return ('file:///' + encodeURI(drive)).replace(/\/$/, '')
    }
    return pathToFileURL(path).href.replace(/\/$/, '')
  }

  /**
   * Classify a location so the capability gate can rule on it.
   *
   * Two things this must get right, both of which were wrong before:
   *
   *  1. **Segment boundaries.** `uriContains`, never `startsWith` — otherwise
   *     `…/BBeBee-backup` counts as inside `…/BBeBee` and a plugin granted
   *     `fs:read:own` reads a sibling directory it has no business seeing.
   *  2. **`own` means *this plugin's* own.** Every plugin's data directory
   *     lives under `appData`, so classifying the whole of `appData` as `own`
   *     let any plugin with `fs:read:own` read every other plugin's files —
   *     and `store.json`, which holds every plugin's settings.
   *
   * Anything unrecognised is `all`, which no plugin is granted by default:
   * an unclassifiable path fails closed.
   */
  private scopeOf(uri: Uri, gate: CapabilityConfig | undefined): Scope {
    const paths = this.ctx.paths
    const checkUri = uri.startsWith('bbebee-file:') ? (uri.replace(/^bbebee-file:\/*/, 'file:///') as Uri) : uri

    // `temp` before `appData`: scratch space is semantically a cache (the OS
    // may reclaim it at any time), and the download flow writes there before
    // moving into place. Without this it lands in `all` on a real desktop and
    // forces `plugin-download` to ask for `fs:write:all`.
    if (uriContains(paths.temp, checkUri)) return 'cache'
    if (uriContains(paths.cache, checkUri)) return 'cache'
    if (uriContains(paths.downloads, checkUri)) return 'downloads'
    // Before appData: logs live inside it but are a shared resource.
    if (uriContains(paths.logs, checkUri)) return 'logs'
    if (paths.music && uriContains(paths.music, checkUri)) return 'media'

    if (gate) {
      const own = paths.pluginData(gate.scopeId)
      if (uriContains(own, checkUri)) return 'own'
      // Inside appData but NOT this plugin's directory: another plugin's data,
      // the settings store, or the secrets file. Not ours — deny.
      if (uriContains(paths.appData, checkUri)) return 'all'
    }

    // Ungated callers (the kernel, core services, tests) own all of appData.
    if (uriContains(paths.appData, checkUri)) return 'own'
    return 'all'
  }

  private check(uri: Uri, mode: 'read' | 'write'): void {
    const config = this[Service.resolveConfig]()
    assertFs(config, mode, this.scopeOf(uri, capabilityConfigOf(config)))
  }

  /* ── Well-known locations ───────────────────────────────────────────── */

  async dir(kind: WellKnownDir): Promise<Uri | undefined> {
    const uri = this.ctx.paths.get(kind)
    if (!uri) return undefined
    // Create app-private roots on demand; never auto-create user folders.
    if (kind === 'data' || kind === 'cache' || kind === 'temp' || kind === 'logs') {
      await fsp.mkdir(this.toPath(uri), { recursive: true })
    }
    return uri
  }

  join(base: Uri, ...segments: string[]): Uri {
    return this.toUri(join(this.toPath(base), ...segments))
  }

  basename(uri: Uri): string {
    return basename(this.toPath(uri))
  }

  extname(uri: Uri): string {
    return extname(this.toPath(uri))
  }

  /* ── Metadata ───────────────────────────────────────────────────────── */

  async exists(uri: Uri): Promise<boolean> {
    this.check(uri, 'read')
    try {
      await fsp.access(this.toPath(uri))
      return true
    } catch (error) {
      // Only "not there" is `false`. Swallowing EACCES too would collapse
      // "does not exist" and "exists but you cannot see it" into one answer,
      // which misleads binding verification and download-quota checks.
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw error
    }
  }

  async stat(uri: Uri): Promise<FileStat> {
    this.check(uri, 'read')
    const path = this.toPath(uri)
    const s = await fsp.stat(path)
    return {
      uri: this.toUri(path),
      name: basename(path),
      isDirectory: s.isDirectory(),
      size: s.size,
      mtime: Math.floor(s.mtimeMs),
    }
  }

  async list(uri: Uri): Promise<FileStat[]> {
    this.check(uri, 'read')
    const path = this.toPath(uri)
    const entries = await fsp.readdir(path, { withFileTypes: true })
    const out: FileStat[] = []
    for (const entry of entries) {
      const child = join(path, entry.name)
      try {
        const s = await fsp.stat(child)
        if (entry.isSymbolicLink() && s.isDirectory()) {
          // On Windows, legacy NTFS junction points (e.g. "Documents\My Music", "Documents\My Pictures",
          // "AppData\Local\Application Data") have ACLs configured with Deny Read permissions. `stat`
          // succeeds by following the junction to its target, but attempting to list/traverse the junction
          // itself fails with EPERM. Similarly, cyclic or unreadable directory symlinks should not be
          // reported as traversable directories.
          try {
            const dirHandle = await fsp.opendir(child)
            await dirHandle.close()
          } catch {
            continue
          }
        }
        out.push({
          uri: this.toUri(child),
          name: entry.name,
          isDirectory: s.isDirectory(),
          size: s.size,
          mtime: Math.floor(s.mtimeMs),
        })
      } catch {
        // A dangling symlink or a file removed mid-listing. Skipping is right:
        // a scan of 100k files should not abort because one vanished.
      }
    }
    return out
  }

  async freeSpace(uri: Uri): Promise<number> {
    this.check(uri, 'read')
    const s = await statfs(this.toPath(uri))
    return Number(s.bavail) * Number(s.bsize)
  }

  /* ── Mutation ───────────────────────────────────────────────────────── */

  async mkdir(uri: Uri, opts?: { recursive?: boolean }): Promise<void> {
    this.check(uri, 'write')
    await fsp.mkdir(this.toPath(uri), { recursive: opts?.recursive ?? false })
  }

  async remove(uri: Uri, opts?: { recursive?: boolean }): Promise<void> {
    this.check(uri, 'write')
    const path = this.toPath(uri)
    if (opts?.recursive) {
      await fsp.rm(path, { recursive: true, force: true })
      return
    }
    // Deliberately NOT `rm -r`: deleting a tree the caller did not ask to
    // delete is far worse than an error. `rmdir` rejects a non-empty
    // directory with ENOTEMPTY, which is exactly the contract.
    const s = await fsp.stat(path)
    if (s.isDirectory()) await fsp.rmdir(path)
    else await fsp.unlink(path)
  }

  async move(from: Uri, to: Uri): Promise<void> {
    this.check(from, 'write')
    this.check(to, 'write')
    const fromPath = this.toPath(from)
    const toPath = this.toPath(to)
    try {
      await fsp.rename(fromPath, toPath)
    } catch (error) {
      // rename() cannot cross devices; fall back to copy + delete so a move
      // from a temp dir on another filesystem still works.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await fsp.cp(fromPath, toPath, { recursive: true })
      await fsp.rm(fromPath, { recursive: true, force: true })
    }
  }

  async copy(from: Uri, to: Uri): Promise<void> {
    this.check(from, 'read')
    this.check(to, 'write')
    await fsp.cp(this.toPath(from), this.toPath(to), { recursive: true })
  }

  /* ── Contents ───────────────────────────────────────────────────────── */

  async readFile(uri: Uri, opts?: ReadOptions): Promise<string> {
    this.check(uri, 'read')
    const buf = await fsp.readFile(this.toPath(uri), { signal: opts?.signal })
    return buf.toString(opts?.encoding === 'base64' ? 'base64' : 'utf8')
  }

  async readBytes(uri: Uri, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
    this.check(uri, 'read')
    const buf = await fsp.readFile(this.toPath(uri), { signal: opts?.signal })
    return new Uint8Array(buf)
  }

  async readRange(uri: Uri, start: number, end: number): Promise<Uint8Array> {
    this.check(uri, 'read')
    const length = Math.max(0, Math.floor(end) - Math.floor(start))
    if (length === 0) return new Uint8Array(0)
    const fh = await fsp.open(this.toPath(uri), 'r')
    try {
      const buf = Buffer.allocUnsafe(length)
      const { bytesRead } = await fh.read(buf, 0, length, Math.floor(start))
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
    } finally {
      await fh.close()
    }
  }

  async writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions): Promise<void> {
    this.check(uri, 'write')
    const path = this.toPath(uri)
    const payload =
      typeof data === 'string' && opts?.encoding === 'base64'
        ? Buffer.from(data, 'base64')
        : typeof data === 'string'
          ? Buffer.from(data, 'utf8')
          : Buffer.from(data)
    await fsp.writeFile(path, payload, {
      flag: opts?.append ? 'a' : 'w',
      signal: opts?.signal,
    })
  }

  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array> {
    this.check(uri, 'read')
    // `end` is inclusive, matching both node:fs and HTTP Range semantics.
    const node = createReadStream(this.toPath(uri), range)
    return Readable.toWeb(node) as ReadableStream<Uint8Array>
  }

  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array> {
    this.check(uri, 'write')
    const node = createWriteStream(this.toPath(uri), { flags: opts?.append ? 'a' : 'w' })
    return Writable.toWeb(node) as WritableStream<Uint8Array>
  }

  /* ── Watching & picking ─────────────────────────────────────────────── */

  async watch(uri: Uri, cb: (ev: WatchEvent) => void): Promise<Disposable> {
    this.check(uri, 'read')
    const path = this.toPath(uri)
    const controller = new AbortController()

    void (async () => {
      try {
        const watcher = fsp.watch(path, { signal: controller.signal, recursive: false })
        for await (const event of watcher) {
          if (!event.filename) continue
          const child = join(path, event.filename.toString())
          // node's 'rename' covers both creation and deletion, so ask.
          let type: WatchEvent['type'] = 'change'
          if (event.eventType === 'rename') {
            type = await fsp
              .access(child)
              .then(() => 'add' as const)
              .catch(() => 'unlink' as const)
          }
          cb({ type, uri: this.toUri(child) })
        }
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          this.ctx.logger.warn(`fs.watch failed for ${uri}: ${String(error)}`)
        }
      }
    })()

    return () => controller.abort()
  }

  async pickDirectory(): Promise<Uri | undefined> {
    // Belongs to the shell, not to `fs`: the desktop host implementation overrides
    // this via native file dialogs. In a bare Node host there is nobody
    // to ask.
    return undefined
  }

  /** Identity on this platform — a `file://` uri is already playable. */
  async toPlayableUri(uri: Uri): Promise<Uri> {
    return uri
  }
}

export default FsNode
