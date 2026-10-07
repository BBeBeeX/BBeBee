# 核心能力服务总览与设计原则

> **历史章节映射：** 原 `docs-zh/04-core-services.md §0 – §1`。

> **本篇回答什么。** [architecture/layers.md §1](../architecture/layers.md#1-分层模型) 的 **第 2 层**：功能插件可用来触达
> 外部世界的每一个服务键、它的 TypeScript 契约、它在各目标平台上的实现，以及两个平台真正存在
> 差异的地方。

这些是通向沙箱之外的唯一出口。核心插件是唯一被允许直接调用平台 SDK 或内核引导面（bootstrap surface）的一层，而这份特权正是它们存在的全部理由：它们把*这台机器的* API 转换成一份契约，让第 3、4、5 层只需对着它写一次。如果某个功能需要这里未列出的东西，正确答案是新增一个核心服务 —— 而绝不是直接导入平台 SDK
（[architecture/layers.md §1](../architecture/layers.md#不变量)）。

这份特权的代价是：核心插件**不持有任何领域知识**。`ctx.fs` 搬运字节，`ctx.db` 跑 SQL；两者都不知道"曲目"是什么。一项长出了功能插件层概念的核心服务，就是把接缝放错了高度，而症状永远相同 —— 两份实现不再可以互换。

所有接口都位于 `packages/protocol/src/services/`，并通过模块扩充（module augmentation）应用到 Context 上。实现位于
`packages/core-*`，它们是唯一持有平台依赖的代码。

> **文档结构说明：** 本文档阐述核心架构设计原则、共享类型（§0）以及虚拟文件系统（§1）。
> 详尽的核心服务契约目录（§§2–15, §§17–26）参见 [核心能力服务契约目录](./contracts.md)。
> 日志架构（§16）参见 [日志系统架构 (第 3 层)](./logging.md)。

---

## 0. 共享类型

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

## 1. `ctx.fs` —— 虚拟文件系统

**用途。** 读取、写入、枚举与流式传输字节，而任何插件都不必知道宿主机上的路径长什么样。

核心思想是：插件从不处理绝对路径。它们请求一个众所周知的目录（well-known directory），并相对于它进行解析，得到不透明的
`Uri` 值。正是这一点，让同一份代码可以同时工作于 `file:///Users/x/Library/…`、
`content://com.android.externalstorage/…` 以及 Expo 的沙箱化文档目录。

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

  /** Convert a Uri into one a native audio decoder can open (SAF tree resolution on Android). */
  toPlayableUri(uri: Uri): Promise<Uri>
}
```

| | Electron (`core-fs-node`) | Expo (`core-fs-expo`) |
|---|---|---|
| 底层实现 | `node:fs/promises` 运行在 `main`，经 IPC 流式传输 | `expo-file-system` 的 `File` / `Directory` 类 |
| `dir('music')` | `app.getPath('music')` | ⚠️ 无对应物 —— 返回 `undefined`，调用方必须回退到 `pickDirectory()` |
| `watch` | `fs.watch`，可靠 | ⚠️ 不支持。解析为一个空操作 disposer；扫描器回退为轮询 `mtime` |
| `pickDirectory` | `dialog.showOpenDialog` | Storage Access Framework（Android）/ document picker（iOS） |

> ⚠️ **整个抽象中最大的泄漏点。** 在 Android 上，用户选择的文件夹是一个
> `content://` SAF 树 URI，而不是路径：它无法交给原生音频解码器，且其权限必须在重启之后仍然保留。
> `core-fs-expo` 会持久化该授权，并暴露 `fs.toPlayableUri(uri)` 供 `ctx.audio` 使用；在 iOS 与桌面端，它就是恒等函数。
> 扫描器（[06](../sources/spec.md)）正是针对 `list`/`stat` 编写的，因此对此毫不在意。

### 1.1 目录枚举与 Windows 连接点 (Junction Points)

在 Windows 平台上，为了向后兼容而保留的 NTFS 连接点（例如 `Documents\My Music`、`Documents\My Pictures`、`AppData\Local\Application Data`）设置了 `Deny Read`（`FILE_LIST_DIRECTORY`）ACL 权限。虽然 `fsp.stat` 能够跟随连接点正常执行，但尝试通过 `readdir` 列举目录内容时会抛出 `EPERM` 错误。

为防止递归扫描器（如 `plugin-local-scanner`）遍历受限系统连接点或陷入循环软链接：
- `FsNode.list()` 使用 `fsp.opendir()` 预先探测目录软链接（`entry.isSymbolicLink() && s.isDirectory()`）。如果打开失败，则跳过该条目，避免将其作为可遍历目录返回。
- `core-desktop-bridge` 在 `CH.call` 上对所有 IPC 调用进行信封封装（`BridgeEnvelope`）。若操作失败，错误将在跨 Bridge 传输并在渲染进程中反序列化，而不是直接 reject `ipcMain.handle`，从而避免 Electron 内部处理程序将未捕获的堆栈错误直接倾倒至主进程控制台。

---

