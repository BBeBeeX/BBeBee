/** `ctx.fs` — virtual filesystem. See docs/04-core-services.md §1. */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable, Uri, WellKnownDir } from '../common.js'

export interface FileStat {
  uri: Uri
  name: string
  isDirectory: boolean
  size: number
  /** Epoch ms. */
  mtime: number
  mimeType?: string
}

export interface ReadOptions {
  encoding?: 'utf8' | 'base64'
  signal?: AbortSignal
}

export interface WriteOptions {
  encoding?: 'utf8' | 'base64'
  append?: boolean
  signal?: AbortSignal
}

export type WatchEventType = 'add' | 'change' | 'unlink'

export interface WatchEvent {
  type: WatchEventType
  uri: Uri
}

export interface FsService {
  /**
   * Resolve a well-known directory.
   *
   * Returns `undefined` where the platform has no such location — notably
   * `music` on iOS, where callers must fall back to `pickDirectory()`.
   */
  dir(kind: WellKnownDir): Promise<Uri | undefined>

  /** The only correct way to build a child Uri. Never concatenate strings. */
  join(base: Uri, ...segments: string[]): Uri
  basename(uri: Uri): string
  extname(uri: Uri): string

  exists(uri: Uri): Promise<boolean>
  stat(uri: Uri): Promise<FileStat>
  list(uri: Uri): Promise<FileStat[]>
  mkdir(uri: Uri, opts?: { recursive?: boolean }): Promise<void>
  remove(uri: Uri, opts?: { recursive?: boolean }): Promise<void>
  move(from: Uri, to: Uri): Promise<void>
  copy(from: Uri, to: Uri): Promise<void>

  readFile(uri: Uri, opts?: ReadOptions): Promise<string>
  readBytes(uri: Uri, opts?: { signal?: AbortSignal }): Promise<Uint8Array>
  writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions): Promise<void>

  /**
   * Read a byte range in a single round-trip. `end` is exclusive; reading
   * past EOF returns the bytes up to EOF (never throws for a short read).
   *
   * Prefer this over `createReadStream` for bounded random access: over a
   * bridge each stream costs open+pull×N+close round-trips, while this is
   * one. The tag-read tokenizer pages through files this way — on a
   * high-latency bridge the stream handshake dominates.
   */
  readRange(uri: Uri, start: number, end: number): Promise<Uint8Array>

  /** For files too large to hold in memory. */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array>
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array>

  /** Bytes available at a location, for download quota decisions. */
  freeSpace(uri: Uri): Promise<number>

  /**
   * Watch a directory.
   *
   * Not supported on React Native, where this resolves to a no-op disposer
   * and the scanner falls back to polling `mtime`. Check `canWatch` first.
   */
  watch(uri: Uri, cb: (ev: WatchEvent) => void): Promise<Disposable>
  readonly canWatch: boolean

  /** Ask the user for a folder, returning a Uri with durable permission. */
  pickDirectory(): Promise<Uri | undefined>

  /**
   * Convert a Uri into one a native audio decoder can open.
   *
   * The identity function everywhere except Android, where a user-picked
   * folder is a SAF `content://` tree URI that decoders cannot read directly.
   */
  toPlayableUri(uri: Uri): Promise<Uri>
}

declare module 'cordis' {
  interface Context {
    fs: FsService
  }
}
