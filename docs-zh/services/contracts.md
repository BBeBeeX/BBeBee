# 核心能力服务契约目录

> **历史章节映射：** 原 `docs-zh/04-core-services.md §2 – §15，§17 – §20`。

## 2. `ctx.http` —— 出站 HTTP

**用途。** 一个形如 `fetch` 的客户端，但*不受*浏览器规则约束。

```ts
export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
  /** Named cookie jar. Each music source gets its own via ctx.isolate('http'). */
  jar?: string
  onProgress?: (loaded: number, total?: number) => void
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  url: string                       // after redirects
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  bytes(): Promise<Uint8Array>
  stream(): ReadableStream<Uint8Array>
}

export interface HttpService {
  (req: HttpRequest): Promise<HttpResponse>
  get<T>(url: string, init?: Omit<HttpRequest, 'url' | 'method'>): Promise<T>
  post<T>(url: string, body: unknown, init?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<T>
  /** Download to a Uri with resume support. Used by plugin-download. */
  download(req: HttpRequest & { to: Uri; resumeFrom?: number }): Promise<{ bytes: number; etag?: string }>
  /**
   * 替换默认 `User-Agent`，下一个请求即生效，无需重启。
   * 空字符串恢复内置默认值；可选 —— 无法在构造后重配置的传输可以不实现。
   * 源文档自带 `header` 规则时仍以文档为准。
   */
  setUserAgent?(userAgent: string): void
  /** Persistent per-instance cookie jars. See §2.1. */
  readonly cookies: CookieJarService
  /** 内存中的请求日志（本构建有记录时才存在）。见 §2.2。 */
  readonly requestLog?: HttpRequestLog
}
```

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| 底层实现 | Electron `net` 模块运行在 `main`，流式传给渲染进程 | React Native `fetch` / `XMLHttpRequest` |
| CORS | 完全绕过 —— 这正是它要经过 `main` 的原因 | 原生端不适用 |
| 任意请求头 | ✅ `Origin`、`Referer`、`User-Agent`、`Cookie` 均可设置 | ✅ |
| Cookie jar | 每个 `persist:` 分区对应一个 Chromium `Session` | JS 实现的 RFC 6265 jar，静态加密 |
| 代理 | ✅ 系统代理或配置的代理 | ⚠️ 仅系统代理 |
| 请求日志（§2.2） | ✅ 内存环形记录，详情捕获可开关 | ❌ 尚未实现 |

`ctx.http` 是标准的瀑布（waterfall）拦截点。鉴权注入、重试、限速与响应缓存，全都是挂接
`http/request` 钩子的插件，而不是内建在客户端里的特性
（[architecture/layers.md §5](../architecture/layers.md#5-组合功能之间如何触达彼此)）。

### 2.1 Cookie 罐

一个已登录的音源必须在应用重启后保持登录状态
（[sources/runtime.md §5.1](../sources/runtime.md#51-会话持久化--cookie-在应用关闭后依然存活)）。因此
cookie 持久化是平台契约的一部分，而不是每份音源文档要在规则里自行表达的东西。

**一个罐只属于一个源。** `ctx.http` 从运行时为每个源设置的拦截配置中读取 scope id
（[sources/runtime.md §4.1](../sources/runtime.md#41-一个源的生命周期)），因此两台 Navidrome 服务器得到两个罐，
其中一个设置的 cookie 绝不会被发给另一个。不经门控的调用方 —— 内核、一项核心服务、一个测试 ——
没有作用域，因此也没有罐，而这正是正确的：本就不存在要维持的会话。

**它经过信封加密，而且平台强制这一点。** `expo-secure-store` 对单个值的上限是 2048 字节，而一个
jar 动辄更大，因此一个随机密钥放 `ctx.secrets`，jar 本身则存为在该密钥之下加密的一个文件。密钥
一旦丢失，文件的字节也就随之失效 —— 这正是 `signOut()` 所依赖的机制。只要存在 `ctx.secrets`，
`ctx.http` 就会自行采用它；一个需要手工接线的壳，就是一个可能忘记接线的壳，而忘记的结果，是一
个登录看似成功、却永远存不住的应用。没有凭据存储时，各罐留在内存里，并诚实地说出自己会遗忘。

```ts
export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms. Absent means a session cookie — dropped when the jar is cleared. */
  expiresAt?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

export interface CookieJar {
  readonly name: string
  /** Resolves once the persisted jar has been loaded. Await before the first request. */
  readonly ready: Promise<void>
  get(url: string): Promise<Cookie[]>
  set(cookies: Cookie[]): Promise<void>
  /** All cookies, for export or inspection. Never logged. */
  all(): Promise<Cookie[]>
  remove(name: string, domain?: string): Promise<void>
  /** Empties the jar AND deletes its persisted copy. Called by signOut(). */
  clear(): Promise<void>
  /** 确保所有排队的落盘写入已完成。 */
  flush(): Promise<void>
}

export interface CookieJarService {
  /** Returns the named jar, creating and rehydrating it on first access. */
  jar(name: string): CookieJar
  /** Forget a jar entirely, including its stored bytes. */
  destroy(name: string): Promise<void>
  list(): Promise<string[]>
}
```

两份实现都必须满足的语义 —— 共享一致性测试套件（§18）会逐条测试：

- cookie 罐是**自动生效**的。经 `ctx.isolate('http')` 作用域发出的请求会带上该作用域的
  cookie，并存储响应中的 `Set-Cookie`，调用方无需做任何事。
- `ready` 在回灌（rehydrate）完成后 resolve。在它之前发出的请求会被排队，绝不会裸发。
- **过期 cookie 在加载时被丢弃**，而不是照单重放。
- `clear()` 删除的是持久化副本，而不仅仅是内存中的那份。
- 各罐相互隔离：一个罐中的写入对另一个罐不可见。

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| 存储 | `session.fromPartition('persist:BBeBee-<name>')` —— Chromium 自带的 cookie 存储，直接落盘，过期/`Secure`/`SameSite` 处理白拿 | JS 实现的 RFC 6265 jar，序列化为 JSON |
| 静态保护 | 存在系统钥匙串时，Chromium 用它加密存储 | **信封加密（envelope encryption）**：随机 AES 密钥放 `ctx.secrets`，密文放 `cookie_jars` 表（[data-model/schema.md §4.1](../data-model/schema.md#41-音源账号与会话)） |
| 清除 | `session.clearStorageData({ storages: ['cookies'] })` + 移除分区 | 删除该行，并从 `ctx.secrets` 删除密钥 |

> ⚠️ **为什么移动端不直接把 jar 放进 `ctx.secrets`。** `expo-secure-store` 对单个值的上限是
> **2048 字节**，而一个真实的会话 jar —— 若干条带长签名值的 cookie —— 动辄超出。跨 key 分块
> 在部分写入下非常脆弱。信封加密让秘密保持很小（一个密钥）而载荷不受限，同时保住了
> "数据库里绝不出现可读凭据"这一不变式。

> ⚠️ React Native 的 `fetch` 在两个平台上都用**应用全局共享**的原生 cookie 存储。这与按实例
> 隔离的需求恰好相反，因此 `core-http-rn` 禁用了它，自行管理 `Cookie` / `Set-Cookie` 请求头。
> 每次 RN 升级都要复核这一点：这里的默认行为一变，cookie 就会在音源之间静默串漏，
> 一致性测试套件中的隔离测试正是为此而设。

### 2.2 请求日志（request journal）

`ctx.http.requestLog`（可选 —— 没什么可记录的传输不必假装有）是本服务已发生交互的内存日志，
供调试区里的 HTTP 日志查看器使用。每次交互一条 `HttpLogEntry`：

```ts
export interface HttpLogEntry {
  sn: number                        // 单次应用运行内单调递增
  time: number                      // 请求发起时的 epoch 毫秒
  method: string
  url: string
  status?: number                   // 请求本身抛错时缺席
  durationMs?: number
  requestHeaders: Record<string, string>
  requestBody?: string
  responseHeaders: Record<string, string>
  responseBody?: string
  error?: string                    // 传输抛错时的失败信息
  detailed: boolean                 // 这次交互是否记录了头与体
}

export interface HttpRequestLog {
  all(): readonly HttpLogEntry[]
  clear(): void
  /** 之后的条目是否记录头与体。默认开。 */
  setCapture(enabled: boolean): void
  captureEnabled(): boolean
}
```

三条承重性质：

- **凭据绝不出现。** `cookie` 的值被缩减为名字（`buvid3=<redacted>`），`authorization`、
  `proxy-authorization` 与 `set-cookie` 一律 `<redacted>`。一份用户能展开的日志，就是一份会被
  截图贴到帖子里的日志 —— 管束 trace 与导出的规则同样管束它。
- **响应体通过 tee 捕获**，绝不读调用方的那一份 —— 调用方看到的请求行为与从前完全一致，日志
  在后台排干自己的分支。只取文本形态的体（JSON、HTML、纯文本、XML）；音频、视频、图片、
  `octet-stream` 与带 `Range` 的请求是传输而非文档，只记摘要行。体有上限（200 KB，带截断标记）。
- **捕获开关是时序性的。** `setCapture(false)` 意味着*之后*的条目只是摘要行（`detailed: false`，
  无头无体），其行也不渲染展开箭头；已记录的条目保留已捕获的内容。没有任何持久化 —— 日志有
  上限（400 条）并随进程消亡。

---

## 3. `ctx.ws` —— WebSocket

```ts
export interface WsConnection {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  readonly readyState: 0 | 1 | 2 | 3
}

export interface WsService {
  connect(url: string, opts?: {
    protocols?: string[]
    headers?: Record<string, string>
    onMessage?: (data: string | Uint8Array) => void
    onClose?: (code: number, reason: string) => void
    onError?: (err: Error) => void
  }): WsConnection
}
```

Electron 在 `main` 中使用 `ws`（与渲染进程的 `WebSocket` 不同，它可以设置请求头 —— 若干音源后端有此要求）。React
Native 使用内建的 `WebSocket`，它同样支持请求头。带退避的重连是*使用方*的职责，并未内建。

---

## 4. `ctx.store` —— 带命名空间的键值存储

用于小体积、频繁读取的设置。不适合任何需要查询的东西。

```ts
export interface StoreService {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  /** A view confined to a prefix. Plugins receive a pre-namespaced store. */
  namespace(ns: string): StoreService
}
```

**一份实现同时服务两个平台** —— `core-store-fs`：经 `ctx.fs` 写入的一个 JSON 文档，采用
"先写临时文件再改名"（temp-then-rename），写一半崩溃时留下的是完好的旧存储，而不是截断的。

这修订了最初的计划（桌面用 JSON 文件、移动端用应用数据库里的 `kv` 表），理由是构建时发现的
两点：

- **启动顺序。** `ctx.store` 比 `ctx.db` *先*就绪 —— 内核在数据库存在之前就要经 `fs` 和
  `store` 读取配置（[architecture/layers.md §3](../architecture/layers.md#3-启动顺序)）。让移动端的 store 依赖
  `db` 会把这条顺序倒过来。
- **平台特有的东西已经不剩什么了。** 一旦走 `ctx.fs`，两份实现就是同一份代码抄两遍，
  只会平白增加漂移面。

当初排除 `AsyncStorage` 的大小上限问题对普通文件并不成立。`flushDelayMs` 为 0 时，
`await store.set()` 只在写入真正落盘后才 resolve；设了批量窗口则立即返回，未落盘的批次
由插件的 disposer 冲刷。

损坏的 store 会被隔离（改名挪到一旁），应用以空 store 启动：设置是可以重建的，无法启动的
应用不行。

为了消除启动时的重复磁盘 I/O，`StoreConfig` 支持可选的 `initialData: Record<string, unknown>`。当宿主组合根在启动初预先读取了 `store.json`（例如在注册服务前预检持久化的音频输出引擎偏好设置）时，将该数据传入即可直接填充内存文档并标记已加载，彻底跳过二次读盘。

---

## 5. `ctx.db` —— SQL

主力服务。[07](../data-model/schema.md) 中的所有内容都存放在这里。

```ts
export type SqlValue = string | number | null | Uint8Array

export interface DbService {
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T>

  /**
   * Register a plugin-owned schema. Tables are prefixed with the namespace,
   * migrations are versioned per namespace, and everything is dropped if the
   * plugin is uninstalled with "remove data" selected. 参见 [data-model/migrations.md §6](../data-model/migrations.md#6-插件表结构生命周期)。
   */
  defineSchema(namespace: string, migrations: Migration[]): Promise<void>
}

export interface Migration {
  version: number
  up: string | string[]
  /** Optional; the project is forward-only, so this exists only for dev. */
  down?: string | string[]
}
```

| | Electron (`core-db-node`) | Expo (`core-db-expo`) |
|---|---|---|
| 底层实现 | **`node:sqlite`** —— 随 Node 22+ 一起提供，Electron 44 内置该版本。无需原生重编译，每次升级也不必跑 `@electron/rebuild` | `expo-sqlite` |
| WAL | ✅ 已启用 | ✅ 已启用 |
| 并发 | 经由 `main` 宿主串行化 | 在原生模块中串行化 |
| FTS5 | ✅ 可用 | ✅ 可用 |
| 能力门 | ✅ | ✅ |

> ⚠️ **每次调用一条语句。** `query`、`get` 与 `exec` 只接受单条语句，并拒绝包含多条的字符串。
> 这是契约，不是某个驱动的局限：`prepare()` 会编译*第一条*语句并**静默**丢弃其余的，因此
> `exec('CREATE TABLE a; CREATE TABLE b')` 曾经创建了 `a`、成功 resolve、不留任何 `b` 从未
> 发生的痕迹 —— 而一份如此编写的迁移把它的版本记为已应用，schema 从此永久漂移，也没有任何
> 错误可查。请分开传语句，或在迁移中使用 `up: string[]`。字符串字面量内部的分号不是边界。
>
> 这道门在**两份**实现上都有。`core-db-expo` 曾有一段时间完全没有 —— `db:own` 在桌面端被
> 强制、在移动端不设防 —— 这恰恰是 §18 的一致性测试套件要抓的漂移，也是 `db-scope` 套件必须
> 在真机、而不仅是在 Node 里跑的原因。

选择 `node:sqlite` 消除了 Electron 项目中最恼人的一项维护负担 ——
每次版本升级都要针对 Electron 头文件重编译 `better-sqlite3`。两个平台都支持 FTS5，因此本地曲库搜索只需一份实现
（[data-model/schema.md §4.3](../data-model/schema.md#43-目录catalogue)）。

---

## 6. `ctx.secrets` —— 凭据存储

```ts
export interface SecretsService {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** 清除该命名空间下的所有密钥。供 signOut() 使用。 */
  clear(): Promise<void>
  namespace(ns: string): SecretsService
  /** False when no OS keychain is available; callers may warn the user. */
  readonly isHardwareBacked: boolean
  /** 后端支持的最大值字节数。 */
  readonly maxValueBytes: number
}
```

Electron：`safeStorage.encryptString`（Keychain / DPAPI / libsecret），密文存放在 `userData`
下的文件中。Expo：`expo-secure-store`（Keychain / EncryptedSharedPreferences）。

> ⚠️ 在没有运行密钥服务的 Linux 上，`safeStorage` 会退化为明文。
> `isHardwareBacked` 会报告 `false`，UI 也会如实说明，而不是虚张声势。

**令牌只存放在这里，别无他处。** 绝不进 `ctx.db`，绝不进配置文件，也绝不进任何一行日志。每个音源拿到的是
`ctx.secrets.namespace(sourceId)`，且能力语法中不存在 `secrets:all`
（[plugins/capabilities.md §7](../plugins/capabilities.md#7-能力模型)）。

---

## 7. `ctx.mediaSession` —— 正在播放与播放控制

```ts
export interface NowPlaying {
  title: string
  artist?: string
  album?: string
  artworkUri?: Uri
  artworkUrl?: string
  durationMs?: number
  positionMs?: number
  playbackRate?: number
}

export type TransportCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'stop' }
  | { type: 'next' } | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'seek-relative'; deltaMs: number }
  | { type: 'rate'; loved: boolean }

export interface MediaSessionService {
  update(np: NowPlaying): void
  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void
  onCommand(cb: (cmd: TransportCommand) => void): Disposable
  /** Which commands the OS surface will actually display. */
  setSupportedCommands(types: TransportCommand['type'][]): void
  clear(): void
}
```

| | Electron (`core-media-session-electron`) | Expo (`core-media-session-rn`) |
|---|---|---|
| 底层实现 | Chromium 的 `navigator.mediaSession`，外加 MPRIS（Linux）、SMTC（Windows）以及 macOS "正在播放"中心，均经 `main` | `react-native-audio-api` 的通知/锁屏控制 |
| 锁屏封面 | `artworkUrl` 优先 | `artworkUri` 优先 —— 必须是本地 `Uri`；远程封面需先缓存 |

---

## 8. `ctx.notify` —— 用户通知

```ts
export interface NotifyService {
  show(n: { id?: string; title: string; body?: string; iconUri?: Uri; silent?: boolean }): Promise<string>
  dismiss(id: string): Promise<void>
  onActivated(cb: (id: string) => void): Disposable
  requestPermission(): Promise<'granted' | 'denied'>
}
```

Electron 的 `Notification`（无需权限请求）对上 `expo-notifications`（两个平台都需要权限；调用方必须能优雅处理
`denied`，不能因此崩溃）。

---

## 9. `ctx.background` —— 长时任务与唤醒锁

让 [architecture/layers.md §4](../architecture/layers.md#4-后台意味着什么) 落地的服务。

```ts
export interface BackgroundService {
  /** True when work may continue with the app not in the foreground. */
  canRunInBackground(): boolean
  /** Keep the process alive for foreground-ish work. Release promptly. */
  acquireWakeLock(reason: string): Promise<Disposable>
  /**
   * Register deferrable periodic work. On mobile this is the OS scheduler:
   * `intervalMinutes` is a *hint*, and a run may be hours late or skipped.
   */
  schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable>
  /** Fires before the host suspends. Checkpoint here. */
  onWillSuspend(cb: () => void | Promise<void>): Disposable
}
```

Electron：`powerSaveBlocker` 加上普通的定时器；`canRunInBackground()` 恒为 `true`。
Expo：`expo-background-task` 加上音频会话；只有在音频持有进程时 `canRunInBackground()` 才为 `true`。

---

## 10. `ctx.paths` —— 众所周知的位置

```ts
export interface PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  /** Undefined where the platform has no shared music folder (iOS). */
  readonly music?: Uri
  pluginData(pluginId: string): Uri
  get(kind: WellKnownDir): Uri | undefined
}
```

看似简单，但正是把它做成一项服务，`ctx.fs` 才能做到与路径无关。

---

## 11. `ctx.device` —— 环境与输入

```ts
export interface DeviceService {
  readonly platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux'
  readonly formFactor: 'phone' | 'tablet' | 'desktop'
  readonly appVersion: string
  readonly locale: string

  network(): Promise<{ online: boolean; type: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'; metered: boolean }>
  onNetworkChange(cb: (s: { online: boolean; type: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'; metered: boolean }) => void): Disposable

  battery(): Promise<{ level: number; charging: boolean } | undefined>

  /** Desktop only; resolves to a no-op disposer on mobile. */
  onMediaKey(cb: (key: 'play-pause' | 'next' | 'previous' | 'stop') => void): Disposable
  registerHotkey(accelerator: string, cb: () => void): Disposable
}
```

`network().metered` 承载着关键逻辑：下载策略引擎
（[data-model/schema.md §4.8](../data-model/schema.md#48-下载)）依靠它来拦停蜂窝网络下的传输。

---

## 12. `ctx.crypto`

```ts
export interface CryptoService {
  randomBytes(n: number): Uint8Array
  randomUUID(): string
  digest(algo: 'sha1' | 'sha256' | 'md5', data: Uint8Array | string): Promise<Uint8Array>
  hmac(algo: 'sha1' | 'sha256', key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array>
  /** Streaming digest for verifying large downloads without buffering. */
  digestStream(algo: 'sha256', stream: ReadableStream<Uint8Array>): Promise<Uint8Array>
  /** AES-GCM，用于移动端信封加密的 cookie 存储。 */
  encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
  decrypt(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>
}
```

`node:crypto` 对上 `expo-crypto`。`md5` 之所以存在，只是因为 Subsonic API
的认证方案需要它；它不用于任何涉及安全性的用途。

---

## 13. `ctx.codec` —— 解码与元数据

连接磁盘上的字节与音频引擎可用形式之间的桥梁。

```ts
export interface AudioMetadata {
  title?: string; artist?: string; albumArtist?: string; album?: string
  trackNo?: number; discNo?: number; year?: number; genre?: string[]
  durationMs?: number; bitrateKbps?: number; sampleRate?: number
  channels?: number; bitDepth?: number; codec?: string
  replayGainTrack?: number; replayGainAlbum?: number
  isrc?: string; musicbrainzTrackId?: string
  lyrics?: string
  hasArtwork: boolean
  tagTypes?: string[]
}

export interface CodecService {
  /** Read tags without decoding audio. Must not read the whole file. */
  readMetadata(uri: Uri): Promise<AudioMetadata>
  readArtwork(uri: Uri): Promise<Uint8Array | undefined>
  /** Decode to PCM for waveform rendering, gain analysis, or short samples. */
  decode(data: Uint8Array | Uri): Promise<{ sampleRate: number; channels: number; pcm: Float32Array[] }>
  probeDuration(uri: Uri): Promise<number>
  supportedFormats(): string[]
}
```

Electron：`main` 中用 `music-metadata` 读标签；用 Web Audio 的 `decodeAudioData` 解码 PCM，并通过主进程 FFmpeg 解码桥（`audio.decodePcm`）完整支持 ALAC、24/32-bit Hi-Res 以及发烧级无损格式（APE、WavPack、DSF、DFF）。
Expo：用 `react-native-audio-api` 的 `AudioDecoder` 解码 PCM，外加一个原生标签读取器。

> ⚠️ `supportedFormats()` 随平台与操作系统版本而异。桌面端现已通过集成 FFmpeg 覆盖了 ALAC、APE、WavPack、DSF、DFF、WMA 等无损格式及常规格式。扫描器会记录下它无法解码的内容，而不是悄悄跳过，让用户能看明白某个文件为何没有导入。

---

## 14. `ctx.shell` —— 跳出应用

```ts
export interface ShellService {
  openExternal(url: string): Promise<void>
  revealInFileManager(uri: Uri): Promise<void>   // no-op on mobile
  share(content: { uri?: Uri; text?: string; title?: string }): Promise<void>
  /** OAuth: opens a browser and resolves on redirect to the registered scheme. */
  openAuthSession(url: string, redirectUri: string): Promise<{ url: string } | { cancelled: true }>
}
```

`openAuthSession` 让 [sources/runtime.md §5](../sources/runtime.md#5-认证与会话) 的
`webview` 登录流程行为完全一致：移动端用 `expo-web-browser` 的 auth session，桌面端用一个带导航监听器的 `BrowserWindow`。
它收集的 cookie 落进该音源的 jar（§2.1），这正是全部意义所在。

---

## 15. `ctx.i18n`

```ts
export interface I18nService {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>): string
  /** Plugins ship their own catalogues; disposed with the plugin. */
  register(namespace: string, catalogues: Record<string, Record<string, string>>): Disposable
  onLocaleChange(cb: (locale: string) => void): Disposable
}
```

只有一份实现，双方共用。区域检测来自 `ctx.device.locale`。

---


---

## 17. 运行时兼容性清单

要让 Cordis 与这些服务跑在 Hermes 和沙箱化渲染进程上，必须逐一落实的具体事项。每一项都真实咬伤过项目。

| 关注点 | 要求 |
|---|---|
| **ESM + `exports` 映射** | `cordis` 是 `"type": "module"` 且带 `exports` 映射。Metro 需要在 `metro.config.js` 中设置 `unstable_enablePackageExports: true`。Vite 原生支持 |
| **`Proxy` 与 `Symbol.for`** | Cordis 的 DI 建立在它们之上。Hermes 两者都支持；不要启用任何剥离 Proxy 的转换 |
| **标准装饰器** | `@Inject` 是 **2023-11 标准装饰器**，不是旧式形式。TS：`"target": "ES2022"`，且不启用 `experimentalDecorators`。Babel：`@babel/plugin-proposal-decorators` 配 `{ version: '2023-11' }` |
| **`AggregateError`** | `ctx.parallel()` 在监听器拒绝时抛出。当前 Hermes 已有；若 RN 版本向下调整，需在移动端入口保留 polyfill |
| **`Symbol.asyncIterator`** | 异步 effect 清理会用到。确保 Babel preset 不会把它降级掉 |
| **Node 内建模块** | `cordis` 一个都不导入。如果某个*核心*插件的依赖导入了，那它应属于 `main` 而非渲染进程，且绝不进移动端 bundle |
| **`ReadableStream` / `WritableStream`** | `ctx.fs` 与 `ctx.http` 会用到。渲染进程中可用；RN 0.86 上请验证是否存在，缺失时在移动端入口用 `web-streams-polyfill` 补齐 |
| **`structuredClone`** | 桌面端 IPC 桥接会用到。Electron 中可用；移动端不需要 |
| **第二个 JS 引擎** | `ctx.js`（§19）内嵌 QuickJS：渲染进程中是 WASM 构建，移动端是原生模块。它是原生依赖，因此它落地时移动端需要一次 dev-client 重建；且 WASM 资产必须打进包内而不是在线拉取 —— CSP 禁止拉取它 |

---

## 18. 契约测试

每个核心服务都附带一个**共享一致性测试套件**，位于
`packages/protocol/src/conformance/`，以函数形式导出，入参是一个服务工厂。每份实现都要跑它 ——
`core-fs-node` 在 Node 下用 Vitest 跑，`core-fs-expo` 在真实模拟器上以 Detox/设备测试的方式跑。

```ts
// packages/core/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

抽象就是这样保持诚实的。没有它，`ctx.fs` 的两份实现不出一个月就会漂移，而每一次漂移都会变成某个功能插件里无缘无故的平台专属
bug。这套套件就是本文档的可执行形式。

---

## 19. `ctx.js` —— 沙箱化求值器

**用途。** 求值一段不受信任的 JavaScript 并拿回一个值，所在的 realm 与应用不共享任何东西。

如今它恰好只有一个调用方：`plugin-source-runtime`，其规则出自陌生人之手
（[sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。它是
核心服务而不是那个插件的一部分，因为内嵌一个解释器意味着交付原生代码，而只有 `core-*` 可以
这么做（[architecture/layers.md §1](../architecture/layers.md#不变量)）。

**由 `core-js-quickjs-node` 实现**（桌面端与 Node），构建于编译成 WebAssembly 的 QuickJS 之上。不是 `node:vm`，而两者的差别正是全部要点：`vm` 与宿主共享一张对象图，脚本一旦够到 `this.constructor.constructor` 就出局了，而已发表的每一种缓解手段，终究是一份早晚有人绕开的黑名单。QuickJS 是一个独立的解释器 —— 里面没有宿主对象图可供够取，因为其中根本不存在宿主对象。

⚠️ **`js` 是一项可选注入。** 没有沙箱的构建依然会运行每一份无需脚本的文档，并就其余文档把受影响的能力推导为*缺席*，而不是提供一个无法工作的按钮。Cordis 把插件自身 `inject` 里的每一个键都当作必需，因此这里表达为一个嵌套的 `ctx.inject(['js'], …)` —— 把它列在顶层，意味着一个缺失的核心服务会把整个源运行时一起拖垮。

```ts
export interface JsRealm {
  /**
   * Evaluate `code` with `scope` bound as globals. Resolves with the completion
   * value, structured-cloned out of the realm — never a live reference into it.
   */
  eval<T = unknown>(code: string, scope?: Record<string, unknown>): Promise<T>
  /** Install a host function callable from inside. Arguments arrive cloned. */
  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable
  /** Evaluate once at realm creation — the source document's `jsLib`. */
  preload(code: string): Promise<void>
  dispose(): void
}

export interface JsLimits {
  /**
   * Wall clock for one uninterrupted stretch of engine execution.
   *
   * ⚠️ Not the whole call. A script that awaits hands control back, and each
   * continuation is a fresh stretch — so this bounds *loops*, which is what it
   * is for. An implementation that armed it only around the initial evaluation
   * leaves every continuation unbounded, which is a freeze rather than a
   * timeout.
   */
  timeoutMs: number
  /** Wall clock for one eval including everything it awaits — [sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么) 的 "带网络 10 秒". */
  budgetMs: number
  /** Heap ceiling. Exceeding it throws JsMemoryError. */
  memoryBytes: number
  /** Cap on the size of a returned value, before cloning. */
  maxResultBytes: number
}

export interface JsService {
  /** 拥有 ECMAScript 内建对象的全新 realm。 */
  createRealm(limits?: Partial<JsLimits>): Promise<JsRealm>
  readonly engine: { name: string; version: string }
}

export class JsTimeoutError extends Error {}
export class JsMemoryError extends Error {}
```

| | Electron (`core-js-quickjs-node`) | Expo (宿主内置 QuickJS JSI) |
|---|---|---|
| 底层实现 | 渲染进程中的 `quickjs-emscripten`（WASM） | 一个 QuickJS JSI 模块（`react-native-quick-js`） |
| 隔离 | 每个 realm 一个独立的 WASM 实例 | 每个 realm 一个独立的 `JSRuntime` |
| 中断 | QuickJS 中断处理器，在向后跳转时检查 | 相同 |
| 异步 | 宿主函数可以返回 promise；realm 的作业队列由宿主驱动 | 相同 |

这份契约围绕以下规则建立，每一条都是天真的内嵌方式会搞错的：

- **没有环境全局。** realm 启动时只有 ECMAScript 内建对象，别的什么都没有 —— 没有 `fetch`、
  没有定时器、没有 `console`、没有模块加载器。调用方想让里面可用的每一样东西都必须按名
  `expose`，这正是让
  [sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么) 的宿主面
  成为一份穷尽清单而非摘要的原因。
- **惰性 WASM 编译。** 在 `core-js-quickjs-node` 中，`[Service.init]()` 立即返回；QuickJS WASM 模块会在首次调用 `createRealm()` 时按需编译并缓存，防止 WebAssembly 编译在应用冷启动阶段增加 100~300ms 耗时。
- **值靠克隆跨越，绝不靠引用。** realm 里的任何东西都无法保留来自宿主的活对象，因此它无法
  遍历对象图去够到某个服务 —— 这正是让同 realm "沙箱"一文不值的那个失败点。
- **限制由引擎强制执行，而不是靠约定。** `while (true)` 会被中断，而不是被等待。这正是要
  第二个引擎而不是 `Worker` 的原因：worker 无法设置内存上限，只能被杀掉，诊断信息也随之
  丢失。
- **realm 是可释放且廉价的。** 每个音源一个，随该音源的 fiber 一起释放。泄漏一个 realm 就是
  泄漏一个原生句柄，所以它和其他东西一样通过 `ctx.effect()` 注册。
- **`engine` 会被上报**，规则可以据此分支，追踪也可以记录它。两个 QuickJS 构建并不相同，
  一个在桌面端能跑、在移动端跑不了的音源，必须可调试而不是玄学。

> ⚠️ **沙箱约束的是触达能力，不是意图。** realm 中的代码仍然看得见宿主传入的一切，并且可以
> 把它送到宿主暴露的函数允许的任何地方 —— 这正是音源运行时把它与 `ctx.http` 上按音源的
> **主机白名单**搭配使用的原因
> （[plugins/capabilities.md §7](../plugins/capabilities.md#7-能力模型)）。一个没有出口限制的求值器，就是一个
> 中间开了洞的遏制故事。

---

## 20. `ctx.theme` —— 颜色管理与主题服务

**用途。** 管理应用视觉主题、运行时主题动态注册、设计令牌至 CSS 变量的注入，以及自定义主题持久化。

```ts
export interface ColorTokens {
  bg: { app: string; primary: string; secondary: string; tertiary: string }
  surface: { s1: string; s2: string; s3: string; hover: string; active: string; selected: string }
  brand: { primary: string; primaryActive: string; primaryHover: string; accent: string; accentHover: string }
  gradient: { brand: string; progress: string; blueViolet?: string; ice?: string; spectrum?: string }
  text: { primary: string; secondary: string; tertiary: string; muted: string; disabled: string; placeholder: string }
  border: { subtle: string; default: string; hover: string; active: string; focus: string }
  semantic: { success: string; warning: string; error: string; info: string }
  music: { playing: string; lyrics: string; lyricsActive?: string; lyricsHighlight?: string; waveform: string; waveformActive: string }
  glow: { xs: string; sm: string; md: string; lg: string; [k: string]: string | undefined }
}

export interface ThemeDefinition {
  id: string
  name: string
  description?: string
  isDark: boolean
  tokens: ColorTokens
  lightTokens?: ColorTokens
  cssVariables?: Record<string, string>
  lightCssVariables?: Record<string, string>
}

export interface ThemeService {
  /** 返回所有可用主题（包括内置与运行时注册的主题）。 */
  getThemes(): readonly ThemeDefinition[]
  /** 返回当前激活主题的快照。 */
  getCurrentTheme(): ThemeDefinition
  /** 返回当前生效的颜色方案（'dark' 或 'light'）。 */
  getEffectiveScheme(): 'dark' | 'light'
  /** 根据 ID 切换激活的主题并持久化设置。 */
  setTheme(themeId: string): Promise<void>
  /** 在运行时注册新主题。返回用于注销的 disposer。 */
  registerTheme(theme: ThemeDefinition): Disposable
  /** 移除自定义主题。内置主题无法被移除。 */
  removeTheme(themeId: string): boolean
  /** 订阅主题变更事件。 */
  onThemeChange(listener: (theme: ThemeDefinition, scheme?: 'dark' | 'light') => void): Disposable
}
```

| | Electron (Desktop DOM) | Expo (Mobile / Native) |
|---|---|---|
| 底层实现 | `@BBeBee/plugin-theme` 通过 `applyThemeToDom` 向 `document.documentElement` 注入 CSS 自定义属性 | `@BBeBee/plugin-theme` 发出响应式主题快照供 `StyleSheet` 使用 |
| 持久化 | `ctx.store` 的 key `theme_active_id`，自定义主题存储于 `theme_custom_themes` | `ctx.store` |
| 内置主题 | `midnight-purple` (`Bee Music · Cyber Neon`)、`spotify` (`Spotify Classic`) | 相同 |
| 自定义主题 | 动态 JSON 导入（文件或文本），带有缺省令牌回退保护；可删除，且受回退机制保护 | 相同 |

- **DOM 同步**：`plugin-theme` 计算 `themeToCssVariables(theme)` 并注入至根 HTML 元素，同时附加 `data-theme="{id}"`。
- **内置主题保护**：`removeTheme(themeId)` 拒绝删除内置主题。若删除正在生效的自定义主题，会自动回退至默认主题（`midnight-purple`）。
- **事件总线集成**：在激活主题变更时发出 `'theme/changed'`，在添加或移除主题时发出 `'theme/registry-changed'`。

---

## 21. `ctx.nowPlaying` —— 正在播放呈现与沙箱化样式

**用途。** 协调全屏正在播放视图与可插拔播放器样式的展示。允许第三方主题与样式插件通过安全的单向消息传递自定义沉浸式全屏播放界面。

```ts
export type NowPlayingStyleId =
  | 'default'
  | 'vinyl'
  | 'cassette'
  | 'cd'
  | 'minimal'
  | 'lyrics-focused'
  | (string & {})

export interface NowPlayingStyleMeta {
  id: NowPlayingStyleId
  name: string
  description?: string
  author?: string
  previewImage?: string
  sandboxHtmlUrl?: string
  component?: unknown
}

export interface SandboxPlayerSnapshot {
  cover: string | null
  coverThemeColor: string | null
  title: string
  artist: string
  album?: string
  lyrics: {
    lines: SandboxPlayerLyricLine[]
    activeIndex: number
  }
  positionMs: number
  durationMs: number
  isPlaying: boolean
  isLoved: boolean
}

export type SandboxPlayerAction =
  | { type: 'action:play' }
  | { type: 'action:pause' }
  | { type: 'action:togglePlay' }
  | { type: 'action:previous' }
  | { type: 'action:next' }
  | { type: 'action:seek'; positionMs: number }
  | { type: 'action:toggleFavorite' }

export interface NowPlayingService {
  getStyle(): NowPlayingStyleId
  setStyle(id: NowPlayingStyleId): void
  getStyles(): readonly NowPlayingStyleMeta[]
  registerStyle(meta: NowPlayingStyleMeta): Disposable
  removeStyle(id: string): boolean
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| 无头服务 | `@BBeBee/plugin-now-playing` | `@BBeBee/plugin-now-playing` |
| UI 渲染层 | `@BBeBee/plugin-now-playing-ui-desktop` | `@BBeBee/plugin-now-playing-ui-mobile` |
| 持久化 | `ctx.store` 的 key `now_playing_style` | `ctx.store` 的 key `now_playing_style` |
| 沙箱隔离 | 隔离的 iframe，具有限制性 `sandbox="allow-scripts"`，仅通过 `postMessage` 交换数据 | 隔离的 WebView，仅通过 `postMessage` 交换数据 |

- **安全沙箱协议**：沙箱化全屏样式在隔离 iframe/WebView 中运行。宿主通过 `bbebee:player-state` 广播 `SandboxPlayerSnapshot`；沙箱仅被允许派发白名单内的控制动作（`SandboxPlayerAction`）。
- **零特权执行**：第三方播放器外观绝无 DOM 遍历权限、无直接音频硬件访问权，也无法接触底层凭据。

---

## 22. `ctx.share` —— 实体分享与隐写术服务

**用途。** 跨平台音乐元数据分享服务。支持生成结构化分享包、Base64 封装，以及利用最低有效位（LSB）图像隐写术将歌曲/歌单元数据直接嵌入到封面图像像素中。

```ts
export type ShareType = 'track' | 'playlist' | 'lyrics' | 'album'

export interface PixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray | Uint8Array
}

export interface ShareMetadataEnvelope<T = unknown> {
  version: 1
  app: 'BBeBee'
  type: ShareType
  createdAt: number
  data: T
}

export interface ShareService {
  encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData>(
    type: ShareType,
    data: T,
  ): string
  decodeMetadata(base64: string): ShareMetadataEnvelope | null
  encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer
  decodeSteganography(buffer: PixelBuffer): string | null
  shareTrack(track: ShareableTrack): void
  sharePlaylist(
    playlist: { urn: string; name: string; description?: string; artwork?: string },
    tracks?: readonly ShareableTrack[],
  ): void
  shareAlbum(
    album: { urn: string; title: string; artist?: string; artwork?: string; year?: number; trackCount?: number },
    tracks?: readonly ShareableTrack[],
  ): void
  shareLyrics(track: ShareableTrack, lines: string[]): void
  openImport(): void
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| 无头服务 | `@BBeBee/plugin-share` | `@BBeBee/plugin-share` |
| UI 模态框 | `@BBeBee/plugin-share-ui-desktop` (`share.modal`) | 规划中 (`@BBeBee/plugin-share-ui-mobile`) |
| 隐写编码 | 纯 TypeScript 实现（`packages/feature/plugin-share/src/steganography.ts`），无平台原生依赖 | 相同 |
| 外部分享动作 | 系统剪贴板复制 / 图像文件导出 | 系统原生分享面板（`ctx.shell.share`） |

- **LSB 图像隐写术**：将序列化的元数据信封编码进封面 RGBA 像素的最低有效位中，带有 32 位魔法头（`0x42424545`，即 ASCII "BBEE"）与长度校验前缀。
- **视觉无损**：每个色彩通道仅微调 1 位色深，在人眼视觉上完全无法察觉。导出的图片既是一张漂亮的音乐分享卡片，又是可供另一台客户端一键导入的实体档案。

---

## 23. `ctx.settings` —— 设置中心与动态贡献

**用途。** 集中化管理应用设置、持久化选项，并为各功能插件提供声明式设置入口注册中心。

```ts
export interface SettingsContribution {
  kind?: 'settings'
  id: string
  section: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'about' | (string & {})
  title: string
  description?: string
  order?: number
  icon?: string
  actionText?: string
  display?: 'card' | 'link' | 'auto'
  action?: () => void | Promise<void>
  schema?: ParamSchema
}

export interface SettingsService {
  get(): Promise<AppSettings>
  getSync(): AppSettings
  update(partial: Partial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
  onSettingsChange(listener: (settings: AppSettings) => void): Disposable
  contribute(contribution: SettingsContribution): Disposable
  getContributions(): readonly SettingsContribution[]
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| 无头服务 | `@BBeBee/plugin-settings` | `@BBeBee/plugin-settings` |
| UI 实现 | `@BBeBee/plugin-settings-ui-desktop` | `@BBeBee/plugin-settings-ui-mobile` |
| 持久化 | `ctx.store` 命名空间 `settings`，带模式版本迁移 | 相同 |
| 响应式事件 | `'settings/changed'`、`'settings/contributions-changed'` | 相同 |

- **解耦的贡献模型**：各功能插件（`plugin-dsp`、`plugin-sources`、`plugin-download`、`plugin-history`、`plugin-visualizer`）通过 `ctx.ui.contribute({ kind: 'settings', ... })` 或 `ctx.settings.contribute(...)` 声明式挂载设置卡片或导航条目。
- **动态分类聚合**：设置界面根据 `section` 分组展示条目，按 `order` 排序。卸载插件时，Cordis disposer 会自动清理其注册的全部设置项。

---

## 24. `ctx['plugin-manager']` —— 插件检查、依赖图与生命周期管理

**用途。** 负责插件的发现、依赖关系计算与生命周期管理。从 `ctx.inspector` 聚合运行时 fiber 状态与清单数据，动态计算双向依赖图（声明的依赖与注入依赖），评估配置状态，并通过 `ctx.store` 将启用/禁用状态持久化，桥接到组装根（composition root）执行动态装载。

```ts
export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description?: string
  version: string
  author?: string
  systemId: 'layer-2' | 'layer-3' | 'layer-4' | 'layer-5' | string
  moduleId?: string
  enabled: boolean
  state: PluginRuntimeState
  error?: string
  waitingFor: string[]
  dependencies: string[]
  dependents: string[]
  configStatus?: ConfigStatus
}

export type PluginRuntimeState =
  | 'PENDING'
  | 'LOADING'
  | 'ACTIVE'
  | 'FAILED'
  | 'DISPOSED'
  | 'UNLOADING'
  | 'UNLOADED'
  | 'UNKNOWN'

export type ConfigStatus = 'none' | 'customized' | 'default'

export interface PluginLifecycleBridge {
  loadPlugin: (id: string) => Promise<unknown>
  unloadPlugin: (id: string) => Promise<void>
}

export interface PluginManagerService {
  list(): readonly PluginInfo[]
  setEnabled(id: string, enabled: boolean): Promise<void>
  registerManifests(manifests: Record<string, PluginManifest>): void
  setLifecycleBridge(bridge: PluginLifecycleBridge): void
  refresh(): readonly PluginInfo[]
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| 无头服务 | `@BBeBee/plugin-manager` | `@BBeBee/plugin-manager` |
| UI 实现 | `@BBeBee/plugin-settings-ui-desktop` | 规划中 (`plugin-settings-ui-mobile`) |
| 持久化 | `ctx.store` 命名空间 `plugin-manager` (`Record<string, boolean>`) | 相同 |
| 响应式事件 | `'plugin-manager/enabled-changed'`、`'plugin-manager/changed'` | 相同 |

- **分层不变量与桥接器**：Layer 4 的无头业务插件严禁导入内核引导面（如 `createApp`、`app.loadPlugin`）。动态加载与卸载在组装根（`apps/desktop/renderer/boot.ts`）通过 `registerBridge` 与 `'plugin-manager/enabled-changed'` 事件进行桥接。
- **清单与 UI 解耦**：构建期生成的清单记录在启动时经由配置或 `registerManifests` 注入到 `plugin-manager`，确保 Layer 4 不引入 UI 或代码生成包。
- **反向依赖解析**：跨所有已知清单与活跃 fiber 实时动态计算反向依赖者（dependents）。在设置界面禁用具有活跃依赖者的插件时，会触发确认防误触保护。

---

## 25. `ctx.contentRegistry` —— 第三方内容注册表

**用途。** 第三方内容及其更新的应用内索引。社区注册表（[bbebeex-registry](https://github.com/BBeBeeX/bbebeex-registry)，以钉定版本的 `registry/` submodule 接入 —— [sources/registry.md](../sources/registry.md)）发布一份 `registry.json`，索引四类可安装内容：音源、歌词源、主题与桌面插件。本服务拉取该索引，将其与用户已安装内容比对，并经由各类型自己的服务完成安装 —— `ctx.sources.import`、`ctx.lyricSources.registerSource`、`ctx.theme.registerTheme`，以及桌面动态加载器。它刻意做成一个薄协调者：下游服务已校验的东西它不再校验，用户确认前必须看到的东西它也绝不隐藏。

> ⚠️ **服务键是 `contentRegistry`，不是 `registry`。** 在 cordis 4 中，`registry` 这个键属于内核本身 —— 它的插件注册表服务，其方法以 `ctx.plugin` / `ctx.inject` 的形式暴露。

```ts
export type RegistryEntryKind = 'music-source' | 'lyric-source' | 'theme' | 'plugin'

export interface RegistryEntry {
  readonly id: string
  readonly kind: RegistryEntryKind
  readonly name: string
  /** 最新发布的 semver。缺失 = "未版本化"；更新检查跳过此类条目。 */
  readonly version?: string
  readonly author?: string
  readonly description?: string
  readonly updatedAt?: string
  readonly downloadUrl?: string
  /** 仅供参考；暂不强制。 */
  readonly minAppVersion?: string
  /** 仅 music-source：文档的后端 URL（与已安装源的匹配键）。 */
  readonly sourceUrl?: string
  /** 仅 theme/plugin */
  readonly previewUrl?: string
  /** 仅 plugin */
  readonly repoUrl?: string
  readonly sha256?: string
  readonly capabilities?: readonly string[]
}

export interface RegistryUpdate {
  readonly kind: RegistryEntryKind
  readonly id: string
  readonly name: string
  readonly installedVersion: string
  readonly availableVersion: string
  readonly downloadUrl?: string
  /** 已安装副本为内置内容时为 true（今天：内置 lrclib 歌词源）。 */
  readonly builtin?: boolean
}

export interface RegistryService {
  /** 拉取注册表索引（endpoint 可经 store 覆盖），缓存最近一次成功副本供离线使用。 */
  getIndex(force?: boolean): Promise<RegistryIndex>
  /** 将已安装内容与索引比对；以结果触发 'registry/updates-available'。 */
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  /** 上一次 checkUpdates() 的结果（供角标读取而无需重新拉取）。 */
  updates(): readonly RegistryUpdate[]
  /** 拉取条目的分发文档，返回确认对话框必须展示的信息。 */
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  /** 安装/更新一个条目。调用方必须已经向用户展示详情（hosts / 插件风险）。 */
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
  /** 组合根注入，使 plugin 类安装能到达桌面动态加载宿主。 */
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
}
```

| | Electron（桌面） | Expo（移动） |
|---|---|---|
| 无头服务 | `@BBeBee/plugin-registry` | `@BBeBee/plugin-registry` |
| 持久化 | `ctx.store` 键 `registry.index-cache`（最近一次成功索引，离线用）与 `registry.prefs`（endpoint 覆盖、`lastCheckAt`） | 同左 |
| 响应式事件 | `'registry/updates-available'` —— **每次**完成的检查（自动或手动）之后触发，携带完整更新列表，**包括空列表**（用于清除角标） | 同左 |
| plugin 类安装 | 桌面动态加载宿主，由组合根经 `setPluginInstaller` 接入 | 不支持（桌面专属分发） |

- **匹配语义**：音源按 `sourceUrl`（`SourceRecord` 的身份）匹配已安装记录；歌词源 / 主题 / 插件按各自 `id` 匹配。已安装副本版本低于条目 `version` 时产生一条 `RegistryUpdate`。
- **各类型安装流程**：音源 → `ctx.sources.import`（完整导入管线，`originUri` = `downloadUrl`）；歌词源 → 形状校验后 `ctx.lyricSources.registerSource`；主题 → 与用户自建主题相同的暗/亮对比度门禁，然后 `ctx.theme.registerTheme`；插件 → 条目未发布 `sha256` 时拒绝安装，将下载包与摘要比对，再交给动态加载宿主。
- **安全红线**：`fetchEntryDetails()` 的存在就是为了让确认对话框在导入**之前**说出音源文档的 `allowedHosts`；插件安装校验 `sha256` 并要求明确的风险确认；应用只消费 `dist/` 编译产物 —— 注册表仓里的条目源码仅供审核。
- **自动检查**：`AppSettings.registryAutoCheck`（默认 `true`）—— 启动约 45 秒后首次检查，此后每 24 小时一次；手动检查不受影响。

---

## 26. 下一步阅读

[05 —— 音频与播放](../audio/playback.md) 在这些服务之上构建播放引擎与 DSP 效果链。
