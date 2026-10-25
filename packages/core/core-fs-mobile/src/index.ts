/**
 * `ctx.fs` for iOS and Android, over `expo-file-system`.
 *
 * The SDK 54+ `File` / `Directory` classes, not the legacy API. Most of their
 * surface is synchronous; the async contract is preserved because the Node
 * side genuinely needs it.
 *
 * See docs/04-core-services.md §1.
 */

import { Directory, File, Paths } from 'expo-file-system'
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

type Scope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

const trim = (uri: string): Uri => uri.replace(/\/$/, '')

export class FsExpo extends Service implements FsService {
  static inject = ['paths']

  /**
   * ⚠️ False. `expo-file-system` does expose a `watch()` on File/Directory,
   * but it is unavailable on Android SAF trees and unreliable in the
   * background — the two cases the library scanner actually cares about.
   * Reporting `false` sends the scanner down its polling path, which works
   * everywhere. Revisit if upstream coverage improves.
   */
  readonly canWatch = false

  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  /**
   * Classify a location so the capability gate can rule on it.
   *
   * Kept deliberately in lockstep with `core-fs-desktop`'s: segment-boundary
   * containment via `uriContains`, and `own` meaning *this plugin's* directory
   * rather than the whole of `appData` — otherwise `fs:read:own` reads every
   * other plugin's data and the settings store. See that file for the full
   * reasoning; the conformance suite asserts both behave identically.
   *
   * The one deliberate asymmetry is the *picked folder*. On desktop the
   * classification leans on `paths.music` containment, because there a
   * `file://` uri can be anything on the machine — /etc included — and
   * "outside the app roots" therefore must NOT be read as "the user's". On
   * mobile the sandbox makes the same inference safe, and `paths.music` is
   * undefined: there is no music root to contain against, and iOS hands a
   * picked folder back as a security-scoped `file://` uri. So here, a
   * `file://` uri that survived every app-managed root below is by
   * construction something the user reached for, and classifies as `media` —
   * the desktop's intent, without the desktop's risk.
   */
  private scopeOf(uri: Uri, gate: CapabilityConfig | undefined): Scope {
    const paths = this.ctx.paths

    // `temp` lives under `cache` here, but check it explicitly so the two
    // platforms classify it the same way rather than by accident of ordering.
    if (uriContains(paths.temp, uri)) return 'cache'
    if (uriContains(paths.cache, uri)) return 'cache'
    if (uriContains(paths.downloads, uri)) return 'downloads'
    // Before appData: logs live inside it but are a shared resource.
    if (uriContains(paths.logs, uri)) return 'logs'
    // A SAF tree the user picked is media by definition — it is the only way
    // to reach music on Android.
    if (uri.startsWith('content://')) return 'media'

    if (gate) {
      const own = paths.pluginData(gate.scopeId)
      if (uriContains(own, uri)) return 'own'
      if (uriContains(paths.appData, uri)) return 'all'
    }

    if (uriContains(paths.appData, uri)) return 'own'

    /*
     * ⚠️ Why a leftover `file://` uri is `media` here and not on desktop.
     *
     * Every `file://` location the app can *name* on mobile comes from
     * `core-paths-mobile`, which derives all of them from the two roots the OS
     * grants (`Paths.document` → appData, and `Paths.cache`; `temp` sits
     * under cache, `logs` / `downloads` / every plugin's data directory sit
     * under document). All of those matched a rule above and returned. What
     * is left is a uri the app did not make up — a folder the user handed
     * over through `pickDirectory()`, outside the sandbox. That is exactly
     * where user music lives, so it is `media`: the same answer the desktop
     * gives for a picked folder under `paths.music`.
     *
     * The app's own directories cannot drift into `media` through this line:
     * document (and logs / downloads / pluginData inside it) already returned
     * as `own` / `logs` / `downloads` / `all`, and cache (and temp inside it)
     * already returned as `cache`. The conformance suite pins each of those.
     */
    if (uri.startsWith('file://')) return 'media'

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
    if (kind === 'data' || kind === 'cache' || kind === 'temp' || kind === 'logs') {
      const directory = new Directory(uri)
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
    }
    return uri
  }

  join(base: Uri, ...segments: string[]): Uri {
    return trim(Paths.join(base, ...segments))
  }

  basename(uri: Uri): string {
    return Paths.basename(uri)
  }

  extname(uri: Uri): string {
    return Paths.extname(uri)
  }

  /* ── Metadata ───────────────────────────────────────────────────────── */

  async exists(uri: Uri): Promise<boolean> {
    this.check(uri, 'read')
    return Paths.info(uri).exists
  }

  async stat(uri: Uri): Promise<FileStat> {
    this.check(uri, 'read')
    const info = Paths.info(uri)
    if (!info.exists) {
      // The contract requires a rejection, and the conformance suite matches
      // on the message — callers branch on this, not on a sentinel.
      throw new Error(`ENOENT: no such file or directory: ${uri}`)
    }
    if (info.isDirectory) {
      const directory = new Directory(uri)
      return {
        uri: trim(directory.uri),
        name: Paths.basename(uri),
        isDirectory: true,
        // ⚠️ Expo exposes neither a directory mtime nor a reliable size.
        // Reporting 0 rather than Date.now() is deliberate: a fabricated "now"
        // makes the scanner's (size, mtime) comparison see every directory as
        // changed on every pass, turning an incremental rescan into a full one.
        // 0 reads as "unknown", which is the truth.
        size: 0,
        mtime: 0,
      }
    }
    const file = new File(uri)
    return {
      uri: trim(file.uri),
      name: Paths.basename(uri),
      isDirectory: false,
      size: file.size,
      mtime: file.lastModified ?? 0,
    }
  }

  async list(uri: Uri): Promise<FileStat[]> {
    this.check(uri, 'read')
    const entries = new Directory(uri).list()
    return entries.map((entry) => {
      const isDirectory = entry instanceof Directory
      return {
        uri: trim(entry.uri),
        name: Paths.basename(entry.uri),
        isDirectory,
        size: (isDirectory ? (entry as Directory).size : (entry as File).size) ?? 0,
        mtime: isDirectory ? 0 : ((entry as File).lastModified ?? 0),
      }
    })
  }

  async freeSpace(_uri: Uri): Promise<number> {
    // Device-wide, not per-volume: the sandbox has no separate quota.
    return Paths.availableDiskSpace
  }

  /* ── Mutation ───────────────────────────────────────────────────────── */

  async mkdir(uri: Uri, opts?: { recursive?: boolean }): Promise<void> {
    this.check(uri, 'write')
    new Directory(uri).create({ intermediates: opts?.recursive ?? false, idempotent: true })
  }

  async remove(uri: Uri, opts?: { recursive?: boolean }): Promise<void> {
    this.check(uri, 'write')
    const info = Paths.info(uri)
    if (!info.exists) throw new Error(`ENOENT: no such file or directory: ${uri}`)

    if (!info.isDirectory) {
      new File(uri).delete()
      return
    }

    const directory = new Directory(uri)
    if (!opts?.recursive && directory.list().length > 0) {
      // Expo's delete() is always recursive, so the guard is ours. Silently
      // deleting a tree the caller did not ask to delete is worse than an error.
      throw new Error(`ENOTEMPTY: directory not empty: ${uri}`)
    }
    directory.delete()
  }

  /**
   * ⚠️ **Expo's `move` refuses an existing destination; `rename(2)` replaces
   * it.** Left alone, that difference is not a nuance — it is the atomic-write
   * pattern (write a temp file, rename it over the target) failing on the
   * *second* run and every run after, which is how `ctx.store` stopped
   * persisting anything on device while every test stayed green. The
   * conformance suite only ever moved onto a fresh path, so nothing saw it.
   *
   * So the destination is cleared first, and the two implementations agree
   * again. The cost is that the replace is no longer atomic here: a crash
   * between the delete and the move leaves neither file. Callers that care
   * keep their source until the move returns — `core-store-fs` does, and
   * recovers from its temp file on the next boot for exactly this window.
   */
  async move(from: Uri, to: Uri): Promise<void> {
    this.check(from, 'write')
    this.check(to, 'write')
    const info = Paths.info(from)
    const source = info.isDirectory ? new Directory(from) : new File(from)
    this.clearDestination(to)
    await source.move(info.isDirectory ? new Directory(to) : new File(to))
  }

  async copy(from: Uri, to: Uri): Promise<void> {
    this.check(from, 'read')
    this.check(to, 'write')
    const info = Paths.info(from)
    const source = info.isDirectory ? new Directory(from) : new File(from)
    this.clearDestination(to)
    await source.copy(info.isDirectory ? new Directory(to) : new File(to))
  }

  /** Remove whatever is at `to`, so a move or copy replaces rather than fails. */
  private clearDestination(to: Uri): void {
    const existing = Paths.info(to)
    if (!existing.exists) return
    if (existing.isDirectory) new Directory(to).delete()
    else new File(to).delete()
  }

  /* ── Contents ───────────────────────────────────────────────────────── */

  async readFile(uri: Uri, opts?: ReadOptions): Promise<string> {
    this.check(uri, 'read')
    const file = new File(uri)
    return opts?.encoding === 'base64' ? file.base64() : file.text()
  }

  async readBytes(uri: Uri): Promise<Uint8Array> {
    this.check(uri, 'read')
    return new File(uri).bytes()
  }

  async readRange(uri: Uri, start: number, end: number): Promise<Uint8Array> {
    this.check(uri, 'read')
    const length = Math.max(0, Math.floor(end) - Math.floor(start))
    if (length === 0) return new Uint8Array(0)
    const file = new File(uri)
    const handle = file.open()
    try {
      handle.offset = Math.floor(start)
      return handle.readBytes(length)
    } finally {
      handle.close()
    }
  }

  async writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions): Promise<void> {
    this.check(uri, 'write')
    const file = new File(uri)
    // `FileCreateOptions` has no `idempotent` (that is Directory's); the
    // existence guard is what makes this safe to call repeatedly, and it
    // must not overwrite or the append path below would truncate.
    if (!file.exists) file.create({ intermediates: true })

    if (!opts?.append) {
      file.write(data)
      return
    }

    // Append via a FileHandle positioned at the end. The obvious alternative —
    // read the whole file, concatenate, write it back — is O(size) per append
    // and, with two writers, silently loses the earlier one's bytes.
    const handle = file.open()
    try {
      handle.offset = file.size
      handle.writeBytes(typeof data === 'string' ? new TextEncoder().encode(data) : data)
    } finally {
      handle.close()
    }
  }

  /**
   * Read a file as a stream.
   *
   * Uses `FileHandle` (`File.open()` + `readBytes`) so memory stays bounded at
   * one chunk. The obvious implementation — `await file.bytes()` then slice —
   * pulls the whole file into the Hermes heap, which for a 100 MB FLAC is an
   * out-of-memory crash rather than a stream.
   *
   * Chunks are pulled on demand, so a slow consumer applies real backpressure.
   */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array> {
    this.check(uri, 'read')
    const file = new File(uri)
    const CHUNK = 64 * 1024

    let handle: ReturnType<File['open']> | undefined
    let position = range?.start ?? 0
    // `end` is inclusive, matching node:fs and HTTP Range.
    let remaining = range?.end === undefined ? Infinity : range.end - position + 1

    return new ReadableStream<Uint8Array>({
      start() {
        handle = file.open()
        if (position > 0) handle.offset = position
      },
      pull(controller) {
        try {
          if (remaining <= 0) {
            handle?.close()
            controller.close()
            return
          }
          const want = Math.min(CHUNK, remaining)
          const bytes = handle!.readBytes(want)
          if (bytes.length === 0) {
            handle?.close()
            controller.close()
            return
          }
          position += bytes.length
          remaining -= bytes.length
          controller.enqueue(bytes)
        } catch (error) {
          handle?.close()
          controller.error(error)
        }
      },
      cancel() {
        handle?.close()
      },
    })
  }

  /**
   * Write a file as a stream.
   *
   * Also `FileHandle`-based, so a large download does not have to be buffered
   * in memory before it lands.
   */
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array> {
    this.check(uri, 'write')
    const file = new File(uri)
    let handle: ReturnType<File['open']> | undefined

    return new WritableStream<Uint8Array>({
      start() {
        if (!file.exists) file.create({ intermediates: true })
        handle = file.open()
        if (opts?.append) handle.offset = file.size
      },
      write(chunk) {
        handle!.writeBytes(chunk)
      },
      close() {
        handle?.close()
      },
      abort() {
        handle?.close()
      },
    })
  }

  /* ── Watching & picking ─────────────────────────────────────────────── */

  async watch(_uri: Uri, _cb: (ev: WatchEvent) => void): Promise<Disposable> {
    // `canWatch` is false, so the contract only requires this to be callable
    // and to return a disposer. The scanner polls instead.
    return () => {}
  }

  async pickDirectory(): Promise<Uri | undefined> {
    const directory = await Directory.pickDirectoryAsync()
    return directory ? trim(directory.uri) : undefined
  }

  /**
   * ⚠️ The sharpest leak in the abstraction.
   *
   * On Android a user-picked folder is a SAF `content://` tree uri, which a
   * native audio decoder cannot open. There is no general conversion, so the
   * honest answer is to copy the file into app storage and hand back that
   * path. Callers that only enumerate (the scanner) never come here.
   *
   * The cache filename is a **hash**, not the encoded uri: a perfectly ordinary
   * SAF uri percent-encodes to ~280 characters, over the 255-byte filename
   * limit on ext4 and APFS, so the naive version failed with ENAMETOOLONG for
   * essentially every real Android music folder — i.e. exactly where this
   * function has to work.
   *
   * A sidecar records the source uri, size and mtime, so a hash collision
   * cannot silently play the wrong file and an edited source is re-copied
   * rather than served stale.
   */
  async toPlayableUri(uri: Uri): Promise<Uri> {
    if (!uri.startsWith('content://')) return uri
    // Copying is a read of the source; the gate must rule on it.
    this.check(uri, 'read')

    const source = new File(uri)
    const stamp = `${uri}\x00${source.size}\x00${source.lastModified ?? 0}`

    const dir = this.join(this.ctx.paths.cache, 'saf')
    const base = `${hashUri(uri)}${Paths.extname(uri) || '.bin'}`
    const cached = this.join(dir, base)
    const sidecar = `${cached}.src`

    if (Paths.info(cached).exists && Paths.info(sidecar).exists) {
      try {
        if (new File(sidecar).textSync() === stamp) return cached
      } catch {
        // Unreadable sidecar: fall through and re-copy.
      }
    }

    await this.mkdir(dir, { recursive: true })
    // Copy via a temp name and move into place, so a concurrent caller either
    // sees the old complete file or the new one — never a half-written copy.
    const tmp = `${cached}.${Date.now()}.part`
    source.copySync(new File(tmp))
    const target = new File(cached)
    if (target.exists) target.delete()
    new File(tmp).moveSync(target)
    new File(sidecar).write(stamp)
    return cached
  }
}

/**
 * A stable, short filename key for a uri.
 *
 * FNV-1a over 128 bits (four interleaved lanes), rendered as 32 hex chars.
 * Not cryptographic — it only has to avoid collisions within one device's
 * cache, and the sidecar check above catches one if it ever happens.
 * Implemented locally rather than through `ctx.crypto` so that resolving a
 * playable uri does not drag in another service dependency.
 */
function hashUri(value: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0x811c9dc5 ^ 0x5bf03635, 0x01000193 ^ 0x27d4eb2f]
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    for (let lane = 0; lane < 4; lane++) {
      lanes[lane] = (lanes[lane]! ^ (code + lane)) >>> 0
      lanes[lane] = Math.imul(lanes[lane]!, 0x01000193) >>> 0
    }
  }
  return lanes.map((n) => n.toString(16).padStart(8, '0')).join('')
}

export { File, Directory, Paths } from 'expo-file-system'
export default FsExpo
