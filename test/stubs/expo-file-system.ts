/**
 * A stand-in for `expo-file-system` under Vitest.
 *
 * ⚠️ **Not a fake filesystem.** It is `node:fs` behind the SDK 54+
 * `File`/`Directory`/`Paths` surface, so the statements really run and a check
 * that passes here passed against a real filesystem rather than against a
 * mock's opinion of one. That is the whole point: `ctx.fs` has two
 * implementations, docs/10 names their drift as a live risk, and the
 * conformance suite was the stated defence — but it only ever ran against the
 * Node one, because the Expo one could not be loaded outside a device.
 *
 * It cost exactly what the risk predicted. Expo's `File.move` refuses an
 * existing destination while `rename(2)` replaces it, so `ctx.store`'s
 * write-temp-then-move stopped persisting anything on device from the second
 * launch onward, and nothing in CI could see it.
 *
 * What this deliberately does **not** reproduce is anything genuinely of the
 * device: SAF `content://` trees, `pickDirectoryAsync`, and the platform's own
 * permission model. Those stay device work.
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Every uri in this package is a `file://` one; the driver works in paths. */
const toPath = (uri: string): string =>
  uri.startsWith('file:') ? fileURLToPath(uri) : uri
const toUri = (path: string): string => pathToFileURL(path).href

export interface PathInfo {
  exists: boolean
  isDirectory?: boolean
}

class FileHandle {
  offset = 0
  private readonly fd: number
  constructor(private readonly path: string) {
    if (!existsSync(path)) writeFileSync(path, '')
    this.fd = openSync(path, 'r+')
  }
  readBytes(length: number): Uint8Array {
    const buffer = Buffer.alloc(length)
    const read = readSync(this.fd, buffer, 0, length, this.offset)
    this.offset += read
    return new Uint8Array(buffer.subarray(0, read))
  }
  writeBytes(bytes: Uint8Array): void {
    const written = writeSync(this.fd, bytes, 0, bytes.length, this.offset)
    this.offset += written
  }
  close(): void {
    closeSync(this.fd)
  }
}

export class File {
  readonly uri: string
  private readonly path: string

  constructor(...parts: (string | File | Directory)[]) {
    const resolved = parts.map((p) => (typeof p === 'string' ? p : p.uri))
    const head = toPath(resolved[0] ?? '')
    this.path = resolved.length > 1 ? join(head, ...resolved.slice(1).map(String)) : head
    this.uri = toUri(this.path)
  }

  get exists(): boolean {
    return existsSync(this.path) && statSync(this.path).isFile()
  }
  get size(): number {
    return this.exists ? statSync(this.path).size : 0
  }
  get lastModified(): number {
    return this.exists ? statSync(this.path).mtimeMs : 0
  }

  create(opts: { intermediates?: boolean } = {}): void {
    if (opts.intermediates) mkdirSync(dirname(this.path), { recursive: true })
    if (!existsSync(this.path)) writeFileSync(this.path, '')
  }
  write(data: string | Uint8Array): void {
    writeFileSync(this.path, data)
  }
  text(): string {
    return readFileSync(this.path, 'utf8')
  }
  textSync(): string {
    return this.text()
  }
  base64(): string {
    return readFileSync(this.path).toString('base64')
  }
  bytes(): Uint8Array {
    return new Uint8Array(readFileSync(this.path))
  }
  delete(): void {
    rmSync(this.path, { force: true })
  }
  open(): FileHandle {
    return new FileHandle(this.path)
  }

  /**
   * ⚠️ Refuses an existing destination, exactly as the device does.
   *
   * Reproducing the *refusal* is the only reason this method is interesting.
   * A stub that quietly overwrote would make `core-fs-mobile` pass the suite
   * while still failing on a phone — which is the state this file exists to
   * end.
   */
  move(destination: File | Directory): void {
    const target = destination instanceof Directory
      ? join(toPath(destination.uri), basename(this.path))
      : toPath(destination.uri)
    if (existsSync(target)) throw new Error('Destination already exists')
    renameSync(this.path, target)
  }
  moveSync(destination: File | Directory): void {
    this.move(destination)
  }
  copy(destination: File | Directory): void {
    const target = destination instanceof Directory
      ? join(toPath(destination.uri), basename(this.path))
      : toPath(destination.uri)
    if (existsSync(target)) throw new Error('Destination already exists')
    copyFileSync(this.path, target)
  }
  copySync(destination: File | Directory): void {
    this.copy(destination)
  }
}

export class Directory {
  readonly uri: string
  private readonly path: string

  constructor(...parts: (string | Directory)[]) {
    const resolved = parts.map((p) => (typeof p === 'string' ? p : p.uri))
    const head = toPath(resolved[0] ?? '')
    this.path = resolved.length > 1 ? join(head, ...resolved.slice(1).map(String)) : head
    this.uri = toUri(this.path)
  }

  get exists(): boolean {
    return existsSync(this.path) && statSync(this.path).isDirectory()
  }
  get size(): number {
    return 0
  }

  create(opts: { intermediates?: boolean; idempotent?: boolean } = {}): void {
    mkdirSync(this.path, { recursive: opts.intermediates ?? opts.idempotent ?? false })
  }
  list(): (File | Directory)[] {
    return readdirSync(this.path).map((name) => {
      const full = join(this.path, name)
      return statSync(full).isDirectory() ? new Directory(toUri(full)) : new File(toUri(full))
    })
  }
  delete(): void {
    rmSync(this.path, { recursive: true, force: true })
  }
  move(destination: Directory): void {
    const target = toPath(destination.uri)
    if (existsSync(target)) throw new Error('Destination already exists')
    renameSync(this.path, target)
  }
  copy(destination: Directory): void {
    const target = toPath(destination.uri)
    if (existsSync(target)) throw new Error('Destination already exists')
    copyFileSync(this.path, target)
  }
  static async pickDirectoryAsync(): Promise<Directory | undefined> {
    throw new Error('expo-file-system: pickDirectoryAsync needs a device')
  }
}

/**
 * Where `Paths.document` and `Paths.cache` point.
 *
 * On a device these are the app sandbox and are fixed. A test needs them under
 * a scratch directory it can delete, which is what `PathsNode`'s `root` option
 * does for the Node side — so the stub gets the same lever.
 *
 * ⚠️ An environment variable rather than an exported setter, deliberately.
 * `tsc` resolves `expo-file-system` to the *real* package — only Vitest sees
 * the alias — so a stub-only export would typecheck as a missing member. The
 * env var needs no import and cannot drift from the SDK's surface.
 */
const sandboxRoot = (): string =>
  process.env['BBEBEE_EXPO_FS_ROOT'] ?? join(process.cwd(), '.expo-fs-stub')

function sandboxDir(kind: 'document' | 'cache'): string {
  const path = join(sandboxRoot(), kind)
  mkdirSync(path, { recursive: true })
  return path
}

export const Paths = {
  get document(): Directory {
    return new Directory(toUri(sandboxDir('document')))
  },
  get cache(): Directory {
    return new Directory(toUri(sandboxDir('cache')))
  },
  basename(uri: string): string {
    return basename(toPath(uri))
  },
  extname(uri: string): string {
    return extname(toPath(uri))
  },
  join(base: string, ...segments: string[]): string {
    return toUri(join(toPath(base), ...segments))
  },
  info(uri: string): PathInfo {
    const path = toPath(uri)
    if (!existsSync(path)) return { exists: false }
    return { exists: true, isDirectory: statSync(path).isDirectory() }
  },
  get availableDiskSpace(): number {
    return Number.MAX_SAFE_INTEGER
  },
}
