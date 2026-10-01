# @BBeBee/plugin-local-scanner

Layer 4（feature）— `ctx.scanner`：本机文件系统的扫描器。

## 概述

遍历用户指定的音乐目录、读取标签元数据、把文件写入目录表（catalogue）。与 `plugin-source-local` 的分工（docs/06 §8）：**本包负责"填充"**（从磁盘把文件变成目录条目），`plugin-source-local` 负责"应答"（回答目录里有什么、如何播放）。

设计目标三条，每条都有测试背书：

| 性质 | 含义 |
|---|---|
| **增量** | 用 `(size, mtime)` 对照 `scan_entries` 决定是否打开文件——重扫未变化的库只花 stat 调用的成本 |
| **可中断** | 每批一个事务、`AbortSignal` 取消、每批一个检查点——挂起最多损失一个批次 |
| **诚实** | 解不开的文件带着原因记为 error 条目，绝不静默跳过 |

## 服务声明

- `class Scanner extends Service implements ScannerService`，`super(ctx, 'scanner')` → `ctx.scanner`。
- 必需注入：`['fs', 'db', 'codec']`；可选注入（嵌套）：`['ui']`（设置页描述符）、`['background']`（轮询回退）。
- 能力声明：`fs:read:media`、`fs:read:all`、`db:read:core`、`db:write:core`、`background`。

## 源文件

### `src/index.ts` — ScannerService 与扫描流程

**配置（`ScannerConfig`）**：`batchSize=200`（每事务文件数）、`extensions`（默认 16 种：mp3/flac/m4a/aac/ogg/oga/opus/wav/aiff/aif/wma/alac/ape/wv/dsf/dff/m4b）、`sourceId='local'`、`pollIntervalMinutes=1440`（1 天）、`watchDebounceMs=2000`。

**公开 API**：

| 成员 | 作用 |
|---|---|
| `roots` / `progress` | 扫描根列表（内存缓存）/ `{ rootId, done, total? }` |
| `addRoot(uri, opts?)` | 默认 `recursive: true`；重复添加 = 重新启用（upsert） |
| `removeRoot(id, opts?)` | `forgetTracks: true` 时逐 entry `forgetFile` 并 emit `library/changed` |
| `setEnabled(id, on)` | 启停某根并重建 watcher |
| `scan(opts?)` | 主入口。返回 `ScanSummary` |
| `cancel()` | abort 内部控制器 |

**扫描流程**：`scan` 用 `inFlight` promise 串行化（watch 事件、轮询、手动扫描可能同时到达，两个并发遍历会互相覆盖 abort 控制器）→ 信号桥接到内部 `AbortController` → 每根：`scan/started` → BFS `walk` → 一次性读入该根的 `scan_entries` → 分批 `importBatch`（每批一个事务、更新 progress、emit `scan/progress` 与 `library/changed`）→ 收尾 emit `scan/finished`。

**BFS 护栏**：`MAX_SCAN_DEPTH=24`、`MAX_SCAN_DIRS=20_000`、`visited` 去重。`ctx.fs.list` 会跟随目录符号链接，`ln -s . loop` 会让队列永不排空；深度上限单独不够（两个互链的目录指数级产生新路径），目录预算让爆炸在两个维度上都有限。读不了的目录不算失败但计入 `unreadable` 并置 `truncated`。

**对账（最重要的不变量）**：**只有完整视图才允许删除**。`complete = !aborted && !truncated`；"消失的文件"只在 complete 时删除。被截断的 walk 与"从磁盘消失"不可区分，基于部分视图对账会静默删掉仍在磁盘上的文件——比它所替代的挂起更糟（挂起至少可见）。`summary.incomplete` 跨根粘滞。不完整时**宁可过时不可错误**。

**watch/轮询三层回退**：`ctx.fs.watch`（桌面理想路径，防抖 `watchDebounceMs`）→ `ctx.background.schedule('scanner:poll', …)`（移动端，OS 调度器）→ 自有链式 `setTimeout` 轮询（链式而非 interval——超时的扫描不能让下一次排在它后面；桌面在 `core-background-electron` 落地前的必需回退）。

**与 `ctx.sources` 的关系**：catalogue 外键指向 `sources` 行，扫描器作为写入者必须先保证源行存在——`ensureSourceRow()` 写入最小行（id 默认 `'local'`，`source_url = 'bbebee://local/<id>'`，`doc_json` 是一份真实文档：`{ sourceName: 'This device', sourceComment: 'Files on this device. Managed by the scanner, not imported.' }`）。

### `src/import.ts` — 文件如何变成目录条目

遍历决定看哪些文件，这里决定它们意味着什么。所有写入走调用方持有的同一事务——"挂起最多损失一批，绝不损失半个 track"。

- **`importTrack(ctx, input)`**：标题回退到文件名 → `artworks`（内容寻址 id 去重封面；⚠️ `blurhash`/`dominant_color` 留 NULL——`ctx.codec` 解音频不解图像，是已声明的降级）→ `albums`（`COALESCE(excluded.x, albums.x)`：新数据缺失不覆盖旧值）→ `tracks` upsert → `track_artists` 先删后插（role `'main'`，连接表而非自由文本——"Artist feat. Other" 作自由文本会让 featuring 不可浏览）→ `genres`/`track_genres`（归一化小写）→ `external_ids`（isrc/mbid："M2 的身份链接要 join 的东西，现在记录便宜"）→ **`media_bindings`**（`origin: 'scan'`——这个绑定本身就是"这个 track 是磁盘上的一个文件"的全部含义；M3 下载插件写同形 `origin: 'download'` 的行，播放器因此不需要知道"下载"这个概念）。
- **`forgetFile(ctx, uri)`**：删绑定；track 已无剩余绑定则连 track 行一起删（对本地源，文件就是 track）。
- **`splitArtists(value)`**：拆分标签里内联的多艺术家。`/` 只在两侧有空白时才算分隔符（AC/DC 是一支乐队）；`feat./ft./with` 需要两侧空白。
- **`sortKey` 是再导出而非自定义**：目录排序规则属于 `@BBeBee/protocol`，不属于先到的写入者——来源缓存曾长出自己的副本，导致 "The Beatles" 在列表里出现两次。

### `src/ids.ts` — 稳定 id 的派生

派生而非随机：同一文件必须每次扫描产生相同 URN，否则一次重扫就孤儿化所有指向它的播放列表条目、队列行和播放记录。

- **`stableId(...parts)`**：parts 用 NUL（`\x00`）join，64 位 = **两轮不同盐的 FNV-1a**（零依赖、跨平台稳定；明说不是安全哈希也不当它用）。
- **`trackId(uri)`** / **`albumId(title, artist)`** / **`artistId(name)`**：`normalise`（trim + 小写 + 空白折叠）后派生。
- **`artworkId(bytes)`**：内容寻址（两轮不同盐 + 字节数）——两张文件共享同一封面则共享一行 artwork；单轮 32 位在库规模下会碰撞，而碰撞意味着一张专辑静默拿到别人的封面。

> 注意：本文件含字面控制字符（`\x00`/`\x01` 作 join 分隔符），某些工具会把它判为二进制。

### `src/hooks.ts` — React hooks（双壳共享）

核心是进度：扫描按批发事件，只看结果的设置屏在大库上会静止几分钟，看起来像坏了。

- **`useScanRoots(ctx)`** — 订阅 `scan/started|finished` 与 `library/changed`，返回 `ctx.scanner.roots`。
- **`useScanState(ctx): ScanState`** — `{ progress?, running, lastSummary? }`；`scan/finished` 时**清空 progress**——扫描结束后冻结在 90% 的进度条比没有进度条更糟。
- **`summarise(summary?)`** — 摘要成一句话。⚠️ **`incomplete` 压过一切计数，不是它们的脚注**：截断的扫描渲染成 "nothing changed" 会告诉用户库已对账而事实相反。

### `src/views.ts` — 视图 id 常量

```ts
export const SCANNER_VIEWS = { settings: 'scanner.settings' } as const
```

只有 id；实际组件由各平台 UI 包经 `ctx.ui.registerView` 绑定。init 注册的是 settings 描述符（section `'sources'`，标题 "Music folders"）——描述符不是组件，视图包未加载的平台上设置页仍能列出并显示"此平台不可用"。

## 写库表

`sources`（确保行）、`scan_roots`、`scan_entries`（`status ∈ { ok, error }`，error 带原因）、`tracks`、`albums`、`artists`、`track_artists`、`album_artists`、`genres`、`track_genres`、`artworks`、`external_ids`、`media_bindings`——全部 upsert 语义，天然幂等。

## 导出

```ts
export const name = 'plugin-local-scanner'
export interface ScannerConfig
export async function apply(ctx, config?)   // 刻意 await ctx.plugin(Scanner, config)
export { importTrack, forgetFile, splitArtists, sortKey } from './import.js'
export { trackId, albumId, artistId, artworkId } from './ids.js'
// './hooks'：useScanRoots / useScanState / summarise
// './views'：SCANNER_VIEWS
```

## 相关文档

- `docs/06-music-sources.md` §8/§12：本地源与扫描器分工
- `docs/11-roadmap-M1.md`：增量扫描退出标准
- `packages/feature/plugin-source-local/README.md`：应答端
