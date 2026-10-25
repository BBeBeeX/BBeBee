# Core Services Overview & Principles

> **Legacy Reference:** Formerly `docs/04-core-services.md §0 – §1`.

> **What this answers.** **Layer 2** of [architecture/layers.md §1](../architecture/layers.md#1-the-layer-model): every
> service key a feature plugin may use to touch the outside world, its TypeScript contract, its
> implementation on each target, and the places where the two platforms genuinely differ.

These are the only doors out of the sandbox. Core plugins are the one layer permitted to call a
platform SDK or the kernel's bootstrap surface directly, and that privilege is the whole reason
they exist: they convert *this machine's* API into a contract that Layers 3, 4 and 5 can be written
against once.

> see the spec at [rules/services.md §1](../../rules/services.md#1-core-services-philosophy) (L2); this section covers only principles and usage: when a feature lacks a platform capability, the answer is a new core service, not importing a platform SDK ([architecture/layers.md §1](../architecture/layers.md#the-invariant)); core plugins hold no domain knowledge.

A core service that grows a concept
from Layer 4 has put the seam at the wrong altitude, and the symptom is always the same — the two
implementations stop being interchangeable.

> see the spec at [rules/services.md §2](../../rules/services.md#2-standard-service-keys) (L2); this section covers only principles and usage.

Implementations live in `packages/core/*` and are the sole holders of platform
dependencies.

> **Document structure.** This document introduces architectural principles, shared types (§0), and the virtual filesystem (§1).
> The comprehensive service catalog (§§2–15, §§17–26) lives in [Core Service Contracts Catalog](./contracts.md).
> Logging architecture (§16) lives in [Logging Architecture (Layer 3)](./logging.md).

---

## 0. Shared types

```ts
/** An abstract URI. Never a raw filesystem path — see §1. */
export type Uri = string

export interface Disposable { (): void }

export type WellKnownDir =
  | 'data'      // app-private, backed up, survives updates
  | 'cache'     // app-private, OS may delete under pressure
  | 'temp'      // scratch, deleted aggressively
  | 'music'     // user's music library (may be unavailable)
  | 'downloads' // where downloaded media lands
  | 'logs'

export class CapabilityError extends Error {
  constructor(public capability: string, message?: string) { super(message ?? capability) }
}
```

---

## 1. `ctx.fs` — virtual filesystem

**Purpose.** Read, write, enumerate, and stream bytes, without any plugin knowing what a path
looks like on the host.

The central idea is that plugins never handle absolute paths (see the spec at
[rules/services.md §3](../../rules/services.md#3-opaque-uris-and-paths) (L2); this section covers only principles and usage). They ask for a well-known directory
and resolve relative to it, producing opaque `Uri` values. This is what makes the same code work
against `file:///Users/x/Library/…`, `content://com.android.externalstorage/…`, and Expo's
sandboxed document directory.

```ts
export interface FileStat {
  uri: Uri
  name: string
  isDirectory: boolean
  size: number
  mtime: number          // epoch ms
  mimeType?: string
}

export interface ReadOptions { encoding?: 'utf8' | 'base64'; signal?: AbortSignal }
export interface WriteOptions { encoding?: 'utf8' | 'base64'; append?: boolean; signal?: AbortSignal }

export interface FsService {
  /** Resolve a well-known directory. Returns undefined if unavailable (e.g. music on iOS). */
  dir(kind: WellKnownDir): Promise<Uri | undefined>
  /** Join path segments onto a Uri. The only correct way to build a child Uri. */
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

  /** Streaming, for files too large to hold in memory (audio, artwork batches). */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array>
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array>

  /** Free space at a location, for download quota decisions. */
  freeSpace(uri: Uri): Promise<number>

  /** Watch a directory. Resolution and reliability vary sharply — see below. */
  watch(uri: Uri, cb: (ev: { type: 'add' | 'change' | 'unlink'; uri: Uri }) => void): Promise<Disposable>
  readonly canWatch: boolean

  /** Ask the user to pick a folder, returning a Uri with durable permission. */
  pickDirectory(): Promise<Uri | undefined>

  /**
   * Ask the user to pick files through the platform picker. User-driven, so
   * no capability token gates it; `[]` means the user cancelled. Optional:
   * absent (or refused in words) where the host has no picker — never an
   * empty array, which a caller cannot tell from a cancel.
   */
  pickFiles?(opts?: { multiple?: boolean }): Promise<Array<{ uri: Uri; name?: string; size?: number }>>

  /** Convert a Uri into one a native audio decoder can open (SAF tree resolution on Android). */
  toPlayableUri(uri: Uri, opts?: { signal?: AbortSignal }): Promise<Uri>
}
```

| | Desktop (`core-fs-desktop`) | Expo (`core-fs-mobile`) |
|---|---|---|
| Backing | Node.js sidecar `node:fs/promises`, streamed over JSON-RPC IPC | `expo-file-system` `File` / `Directory` classes |
| `dir('music')` | Tauri OS paths / sidecar `os.homedir()` | ⚠️ No equivalent — returns `null` and callers must fall back to `pickDirectory()` |
| `watch` | Node.js sidecar `fs.watch`, reliable | ⚠️ Not supported. Resolves to a no-op disposer; the scanner falls back to polling `mtime` |
| `pickDirectory` | `@tauri-apps/plugin-dialog` `open()` | Storage Access Framework (Android) / document picker (iOS) |
| `pickFiles` | Host dialog over the renderer bridge (`window.BBeBee.dialog.pickFiles`); single-pick when `multiple: false`. A bare-Node host (the sidecar) has nobody to ask and refuses in words — never `[]`, which a caller cannot tell from a cancel | `expo-document-picker`, `copyToCacheDirectory` folding SAF picks into readable `file://` uris; `[]` on cancel |
| Reads (`readFile`/`readBytes`) | `node:fs` honours the signal in-process (`AbortError`/`ABORT_ERR`); the renderer bridge checks it at its await points, since a live signal cannot cross IPC | same abort error shape, checked at the read's await points |

> ⚠️ **The biggest leak in the whole abstraction.** On Android, a user-picked folder is a
> `content://` SAF tree URI, not a path: it cannot be handed to a native audio decoder, and its
> permission must be persisted across restarts. `core-fs-mobile` persists the grant and exposes
> `fs.toPlayableUri(uri)` used by `ctx.audio`; on iOS and desktop that is the identity function.
> The optional `signal` aborts that copy at the await points (`readBytes`-style `AbortError`);
> it is advisory, since a copy already in flight natively cannot be interrupted mid-write.
> The scanner ([06](../sources/spec.md)) is written against `list`/`stat` precisely so it does
> not care.

### 1.1 Directory enumeration and Windows junction points

On Windows, backwards-compatibility NTFS junction points (such as `Documents\My Music`, `Documents\My Pictures`, `AppData\Local\Application Data`) have ACLs configured with `Deny Read` (`FILE_LIST_DIRECTORY`). While `fsp.stat` succeeds by following the link, attempting to list the directory via `readdir` throws `EPERM`.

To prevent recursive walkers (e.g. `plugin-local-scanner`) from attempting to traverse restricted system junctions or cyclic directory links:
- `FsNode.list()` probes directory symlinks (`entry.isSymbolicLink() && s.isDirectory()`) using `fsp.opendir()`. If opening fails, the entry is skipped rather than reported as a traversable directory.
- Desktop JSON-RPC IPC envelopes all sidecar calls (`BridgeEnvelope`). If an operation fails, the error is serialized across the bridge and deserialized in the renderer rather than crashing the sidecar or dumping unhandled stack traces.

---


