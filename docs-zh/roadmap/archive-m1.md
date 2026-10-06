# M1 执行计划（历史档案）

> **历史章节映射：** 原 `docs-zh/11-roadmap-M1.md`。

> **本篇回答什么。** M1 构建什么、按什么顺序构建、每个包的"完成"意味着什么，以及
> [roadmap.md §M1](./roadmap.md#m1--能播放音乐) 里的每一条完成标准究竟如何被验证。
> [roadmap.md](./roadmap.md) 说的是里程碑*是什么*；本篇说的是这一个里程碑*怎么建*。

> ⚠️ **历史记录（Historical record）。** 本文记录的是 M1 期间存在的包名与规划。
> 界面此后已拆分为独立的界面插件——`plugin-album`（专辑页）、`plugin-now-playing`（全屏播放器与底栏）、`plugin-queue`（播放队列）——并且由 `plugin-library` 负责播放列表、收藏夹与合辑。
> 有关当前仓库布局，请参阅 [workflow/structure.md §1](../workflow/structure.md#1-代码库布局)；有关各里程碑的当前状态，请参阅 [roadmap.md](./roadmap.md)。

M0 证明了内核：一张插件图、两个平台、彻底的卸载、达标的各核心服务。它没有证明任何关于应用本身的东西，因为 M0 里的任何东西都发不出声音。

M1 是四项主张停止停留在设计、变成要么能跑要么不能跑的代码的地方。

| 主张 | 陈述于 | M1 对它做了什么 |
|---|---|---|
| 一张 Web Audio 图能在 iOS、Android 与 Electron 上播放并处理音频 | [ADR-4](../architecture/overview.md#adr-4--react-native-audio-api-是所有目标平台上首要的播放与-dsp-引擎) | 三个目标上的缓冲播放与流式播放，带锁屏控制与后台存活 |
| 音源是运行时所解释的数据，不是我们随包发布的东西 | [sources/spec.md §1](../sources/spec.md#1-模型) | 表面两端的两个提供方：`plugin-source-local`，以及一份**单规则音源文档**经运行时的 M1 切片播放（MD-7） |
| 播放器不知道字节从哪里来 | [architecture/layers.md §5](../architecture/layers.md#5-组合功能之间如何触达彼此) | `player/before-resolve` 成为一条真实运行的瀑布，有两种可能的答案，一个本地一个远程 |
| 一个插件向两个不共享任何组件代码的外壳贡献 UI | [ADR-2](../architecture/overview.md#adr-2--ui-拆分移动端-react-native桌面端-react-dom) | 每个外壳五块屏幕，来自无 UI 包加按目标的视图包 |

[roadmap.md](./roadmap.md) 的排序原则在里程碑内部同样成立：**音频试石先于一切依赖它的东西**（§3.1）。M1 里其余一切都是可回退的工作；ADR-4 不是。

---

## 1. 范围

### 1.1 范围内

| 领域 | 包 | 交付 |
|---|---|---|
| 音频引擎 | `core-audio-webaudio` | `ctx.audio` —— 一份实现，覆盖两个目标 |
| 解码与标签 | `core-codec-node`、`core-codec-rn` | `ctx.codec` —— 元数据、内嵌封面、PCM、格式支持 |
| 操作系统表面 | `core-media-session-electron`、`core-media-session-rn`、`core-device-electron`、`core-device-expo`、`core-background-electron`、`core-background-expo` | 锁屏、通知、MPRIS/SMTC/Now Playing、媒体键、网络状态、wake lock、挂起钩子 |
| 网络（切片） | `core-http-node`、`core-http-rn` | `ctx.http` 限定为 GET/HEAD、请求头、`Range`、流式、进度 —— MD-1 |
| 音源与目录 | `plugin-sources`、`plugin-source-local`、`plugin-source-runtime` *（仅流式切片，MD-7）* | `ctx.sources` —— 注册、发现，承接这些答案的目录缓存，以及第一份音源文档 |
| 扫描 | `plugin-local-scanner` | `ctx.scanner` —— 根目录、增量遍历、标签与封面导入 |
| 播放 | `plugin-player` | `ctx.player` —— 传输、队列、解析、历史、持久化 |
| UI 基础设施 | `ui-tokens`、`ui-core`、`ui-kit-mobile`、`ui-kit-desktop` | 令牌、钩子，以及一致性组件集 |
| 视图 | `plugin-player-ui-*`、`plugin-sources-ui-*`、`plugin-local-scanner-ui-*` | 曲库、专辑、队列、正在播放、扫描根目录设置，以及一个极简的粘贴 URL 音源列表 |
| 外壳 | `apps/mobile`、`apps/desktop` | 后台音频配置、关闭到托盘、引导集、新的桥宿主 |
| 内核与契约 | `@BBeBee/kernel`、`@BBeBee/protocol` | `db:write:core`（MD-4）、`ctx.sources` 上的目录读取、`ctx.scanner` 契约、分数索引助手 |

### 1.2 范围外

刻意推迟，并注明各自落点。这里没有任何一项会被 M1 的决策卡住。

| 推迟项 | 落点 | 为什么可以等 |
|---|---|---|
| 规则语言、`@js:`、搜索/探索/专辑规则、导入 UI、tracer | M2 | MD-7。M1 需要的是一个可播放的 URL，那只是一条模板；[06](../sources/spec.md) 里的其他一切都需要一个可指向的后端和一个可运行的沙箱，而这两者都不在 M1 的关键路径上 |
| `ctx.js` —— **实现** | M2 | 契约随文档一起落在 `@BBeBee/protocol` 里，因为 M2 正是照着 [services/contracts.md §19](../services/contracts.md#19-ctxjs--沙箱化求值器) 构建的，而一份没人能读到的契约算不上计划。不存在 `core-js-quickjs-*` 包，没有任何东西注入 `js`，也没有任何 M1 代码路径会求值脚本 |
| 认证、`ctx.secrets`、持久化 cookie 罐 | M2 | M1 的音源没有需要凭据的。没有可登录的后端时造这个罐什么也测不到（[sources/runtime.md §5.1](../sources/runtime.md#51-会话持久化--cookie-在应用关闭后依然存活)） |
| 认真的跨音源扇出、`track_links`、身份关联 | M2 | `searchAll` 存在且被使用，但两个音源 —— 其中一个还不能搜索 —— 不构成扇出。过渡期由 `ctx.sources.searchLocal` 覆盖目录 |
| `plugin-library` / `ctx.library` —— 播放列表、收藏、合集 | M2 | MD-3。M1 的五块屏幕没有任何整理功能，而过去用来论证这个包的目录读取现在已落在 `ctx.sources` 上 |
| `plugin-download`、`origin: 'download'` 的绑定 | M3 | 它挂接的瀑布在 M1 已上线但没有监听者 —— 这恰好是其回归测试所对照的对照组 |
| `ctx.dsp` 与所有效果器 | M4 | 接入点在 M1 图中存在并保持为空（§4.2） |
| 能力提示、隔离区、任何运行时加载的代码 | M5（如果会建的话） | 每个插件都是 `builtin` 且静态打包（[修订后的 ADR-1](../architecture/overview.md#adr-1--插件在所有目标平台上都静态打包)） |
| 命令面板、右键菜单、拖拽排序、托盘迷你播放器、独立窗口 | M2+ | MD-2 |
| 播放列表、智能播放列表、评分、歌词、scrobble | M2+ | 浏览曲库并按下播放并不需要它们 |
| 打包（`electron-builder`、`eas build`） | 首个发布版本 | 已在 [workflow/testing.md §7](../workflow/testing.md#运行应用) 注明 |

### 1.3 里程碑决策

为 M1 做了七项决策，采用 ADR 的体例、出于同样的理由：让六个月后的读者能分清哪些是选择、哪些只是默认假设。

**MD-1 —— 一个最小可用的 `ctx.http` 随 M1 交付。**
GET 与 HEAD、任意请求头、`Range`、`stream()`、`onProgress`、超时与中止。没有 cookie 罐、没有 `download()`、没有认证拦截。
*理由。* 风险登记表对 ADR-4 的早期预警是"M1 要检验流式、无缝衔接与锁屏控制"。本地文件完全压不到流式路径 —— 缓冲、停顿与恢复、按 Range 跳转、一次不是暂停的欠载。等到 M2 才发现引擎处理流很差，就等于在 `plugin-player` 已经照着它写完之后才发现。
*代价。* M1 多两个包，以及一套 M2 只扩展而不重写的契约套件。这套件写成"被推迟的成员缺席，而不是打桩"的形态。

**MD-2 —— UI 是真的，但很窄。**
两套组件库都正经地建 —— 令牌、钩子、一致性组件集、虚拟化、无障碍 —— 然后花在五块屏幕上：曲库（曲目与专辑）、专辑详情、队列、正在播放，以及扫描根目录与 URL 音源的设置。没有命令面板、没有右键菜单、没有拖拽排序、没有托盘迷你播放器。
*理由。* ADR-2 里昂贵且难以事后补装的一半是基础设施：两条必须彼此一致的令牌管线、一层共享钩子、一项一致性测试。便宜的一半是更多屏幕。先写屏幕后补基础设施，等于把屏幕写两遍。
*代价。* 桌面端还没有桌面应用的质感，所以在 M2 补上桌面专属交互之前，ADR-2 的前提一直未获证明。

**MD-7 —— `plugin-source-runtime` 以仅流式切片的身份进入 M1。**
运行时随 M1 交付时只会做一件事：持有一份唯一规则块为 `ruleStream` 的音源文档，渲染它的 `url` 模板，并返回一个 `StreamHandle`。没有 `@js:`，没有 `ctx.js`，没有选择器引擎，没有导入审阅界面——在设置里输入一个 URL，就变成一份直接写入 `sources` 表的双字段文档。
*理由。* M1 必须实测流式路径——缓冲、停顿与恢复、按 Range 跳转——否则 ADR-4 的早期预警就无人检验（MD-1）。总得有什么东西拥有一条远程 URL。在旧设计下这是 `plugin-source-http-url`，一个包；在 [ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释) 之下同样的工作是一份文档，而写这个包意味着 M2 还要把它删掉。这样一来，M1 的流式提供方*就是*第一份音源文档，M2 是让运行时生长，而不是替换一个包。
*代价。* 把 M2 的一小片提前——记录形状、每音源一条 fiber 的生命周期，以及 `=` 模板求值器，它是这门语言最小的一块。一切昂贵的东西都留在 M2。
*后果。* M1 想要的那个回归测试——"一个没有任何可选面的提供方不得弄坏任何屏幕"——变得更锋利了：能力是派生的（[sources/rule-engines.md §1.3](../sources/rule-engines.md#13-能力是推导出来的不是声明出来的)），所以一份只有一个规则块的文档就真的只*有*一个能力，而一个假设更多的屏幕会立即失败，而不是似是而非地蒙混过去。

**MD-3 —— `ctx.sources` 拥有目录；`ctx.library` 是整理，挪到 M2。**
三个服务、三份职责、零重叠：

| 服务 | 包 | 拥有 |
|---|---|---|
| `ctx.sources` | `plugin-sources` | 有哪些后端、它们各持有什么：注册、按 URN 查找、搜索扇出、目录缓存、FTS5 索引 |
| `ctx.library` | `plugin-library` | 用户的整理：播放列表、收藏、合集。**M2** |
| `ctx.player` | `plugin-player` | 播放：传输、队列、解析、历史 |

视图包调用 `ctx.sources`，从不触碰 `ctx.db`。
*理由。* [sources/runtime.md §1.1](../sources/runtime.md#11-一个运行时多个源) 早已把目录缓存划给 `ctx.sources` —— "提供方……回答问题并返回纯数据；`ctx.sources` 把答案缓存进目录表" —— 因此读取应当与写入并肩，而不是落在一个还得与它保持一致的第二个服务里。且 [architecture/layers.md §6](../architecture/layers.md#6-状态归属) 要求目录访问经由*唯一*的属主服务：否则同一段 SQL 会在 `-ui-mobile` 与 `-ui-desktop` 里各写一遍，这正是 ADR-2 风险条目点名要防的失败方式。
*后果。* `plugin-library` 在 M1 里无事可做 —— MD-2 的五块屏幕没有一块做整理 —— 于是它随播放列表一起挪到 M2。M1 少带一个包。
*代价。* `plugin-sources` 在干两件事，本可以由第四个包（`ctx.catalog`）拆开：知道后端*是谁*，与缓存它们*说了什么*。如果这条接缝开始硌手，拆分是可控的 —— 读取与 FTS 索引一起搬走，没有任何消费者需要改形状。

**MD-4 —— 新增 `db:write:core`；`db:read:core` 收窄为只读。** *（已落地。）*
`assertDb` 增加了动词检查：`db:read:core` 只允许对核心表 `SELECT`，变更需要 `db:write:core`，`db:*:core` 额外允许 `CREATE`/`DROP`/`ALTER`。动词不相互蕴含，因此一个既读又写目录的插件要同时声明两者，安装时的授权提示才能准确说出它到底在请求什么。语句按其所作所为中要求最高的一档归类，所以 `DROP` 不可能躲在 `SELECT` 身后。`plugin-sources`、`plugin-source-local`、`plugin-local-scanner` 与 `plugin-player` 都声明 `db:read:core` + `db:write:core`。
*理由。* 过去的 `db:read:core` 会放行任何语句，`INSERT` 也包括在内。M1 是第一个有插件要写核心表的里程碑，所以这是纠正这个名字的最后廉价时机 —— 赶在 M5 的安装时提示一边说"只读"一边把写也放出去之前。
*落点。* `packages/kernel/src/capability-gate/capability.ts` 里的 `classifyDbAccess` 与授权解析器，以及 `packages/kernel/src/capability-gate/sql.ts` 里的共享 SQL 读取器；`db-scope` 契约套件中由 `core-db-node` 与桌面桥共同运行的用例；[plugins/capabilities.md §7](../plugins/capabilities.md#能力语法) 的语法表各行。
*顺带修复的问题* —— 其中每一个都足以单独让这些动词形同虚设：带 schema 前缀的 `main.plugin_other_secrets` 被归到名为 `main` 的表上，并被 `core` 回退放行；不含任何可见表名的语句（`DROP INDEX`、`VACUUM`、`PRAGMA foreign_keys = OFF`）完全绕过闸门，因为逐表循环*就是*闸门本身；桌面桥还维护着另一份早已漂移的禁用 SQL 列表，于是 `VACUUM INTO '/any/path'` 能绕过它的封存检查写出文件；`core-db-expo` 根本没有闸门，`db:own` 在桌面端是一个意思、在移动端什么都不是；而且两个驱动都只会静默执行多条语句字符串中的第一条，迁移可能因此记录下一个它只应用了一半的版本。

**MD-5 —— 无缝衔接、预取与淡入淡出全部在 M1。**
[audio/playback.md §2](../audio/playback.md#无缝gapless与交叉淡入淡出) 的完整行为：预取自 `max(15s, crossfadeMs + 5s)` 起，队列变化时经 `AbortSignal` 取消；缓冲源经 `AudioBufferQueueSourceNode` 实现无缝衔接；等功率淡入淡出作为互斥的替代选项；设置为三态 `gapless | crossfade | neither`。
*理由。* 无缝衔接是 M1 对 `react-native-audio-api` 最难的要求，而它就写在 ADR-4 的早期预警里。推迟到 M4 意味着到 M4 才知道答案，那时回退的代价是重写 `plugin-player`，而不是重划一个里程碑的范围。
*代价。* M1 中最精巧的代码，以及一项要靠耳朵听的真机冒烟测试。

**MD-6 —— 桌面端"关闭到托盘"入选；托盘迷你播放器不入。**
关闭窗口是隐藏它，保住渲染进程 —— 也就是内核与音频图 —— 存活，播放期间持有 `powerSaveBlocker`。托盘上只有显示与退出，没有别的 UI。
⚠️ 阻挡器这一半当初是作为服务建成的，此后却从未被任何东西请求：`ctx.background.acquireWakeLock` 存在、有测试、经桥触达 `powerSaveBlocker` —— 却**没有调用者**，于是隐藏的窗口一直播放到机器休眠为止。`plugin-player` 现在在传输处于播放类状态时持锁，并在暂停、队列清空与卸载时释放。`stalled` 算作播放中：每逢缓冲欠载就释放再重取的锁，在 OS 眼里是一把不停翻飞的锁；而就用户的感受而言，曲目仍然在播。
*理由。* [roadmap.md §M1](./roadmap.md#m1--能播放音乐) 要求播放能在窗口隐藏后存活，而 [ADR-3](../architecture/overview.md#adr-3--electron-内核位于渲染进程main-是一个薄的原生宿主) 使这成为进程生命周期问题而不是 UI 问题。迷你播放器是 UI，而 MD-2 推迟了 UI。

---

## 2. 包集合

`✅` M0 已有 · `+` M1 新增 · `~` 已有，扩展。

```
core-audio-webaudio         ✅  ctx.audio — shared implementation, all three targets
core-codec-node             ✅  ctx.codec — music-metadata over ctx.fs, bounded head read
core-codec-rn               ✅  ctx.codec — inherits the tag reader (it is pure JS over ctx.fs
                                and a second one would have to agree with it), adds the device's
                                decodeAudioData and its own supportedFormats
core-http-node              ✅  ctx.http (M1 slice) — fetch-shaped, transport is a seam
core-http-rn                ✅  ctx.http (M1 slice) — the same engine over expo/fetch, which is
                                the only RN fetch with a real ReadableStream
core-media-session-electron ✅  ctx.mediaSession — navigator.mediaSession + MPRIS/SMTC/Now Playing
core-media-session-rn       ✅  ctx.mediaSession — lock screen and media notification
core-device-electron        ✅  ctx.device — network, battery, media keys, hotkeys
core-device-expo            ✅  ctx.device — expo-network, expo-battery
core-background-electron    ✅  ctx.background — powerSaveBlocker, intervals, suspend hooks
core-background-expo        ✅  ctx.background — audio session, keep-awake, expo-background-task
core-desktop-bridge         ✅  hosts for fs, db, paths, system and http; preload surface;
                                the main→renderer event channel the OS services need
core-fs-node / -expo        ✅  toPlayableUri and canWatch get their first real consumer
core-db-node / -expo        ✅  the db:write:core verb check (MD-4)

plugin-sources              ✅  ctx.sources — registry, discovery, catalogue cache, FTS index
plugin-source-local         ✅  MediaProvider over the filesystem, source id 'local'
plugin-source-runtime       ✅  grown past the MD-7 slice into M2's full runtime
plugin-local-scanner        ✅  ctx.scanner — roots, incremental walk, tag and artwork import
plugin-player               ✅  ctx.player — transport, queue, resolution, history, persistence
plugin-ui                   ✅  gets its first non-trivial contributions
plugin-inspector            ✅  used to verify the M1 fiber tree unloads clean

ui-tokens                   ✅  design tokens as data, with the WCAG AA gate
ui-core                     ✅  useService / useServiceState over useSyncExternalStore
ui-parity                   ✅  the component contract, and the check both kits must pass
ui-kit-mobile               ✅  the parity component set, React Native
ui-kit-desktop              ✅  the parity component set, React DOM
plugin-player-ui-*          ✅  now playing, transport, queue
plugin-sources-ui-*         ✅  library, album detail
plugin-local-scanner-ui-*   ✅  settings: scan roots

protocol                    ✅  catalogue reads on ctx.sources, ctx.scanner, the fractional index,
                                the audio/codec/http conformance suites, the mock AudioService
kernel                      ✅  db:write:core, bootstrap sets for the new core services
tooling-fixtures            ✅  dev-only: the ≥5,000-file corpus generator, the instrumented
                                ctx.fs, and the byte-serving http fixture (§7)
```

依赖方向 —— 每条箭头都是一次 `inject`，加载顺序由它们推导而来，从不显式声明（[architecture/layers.md §3](../architecture/layers.md#3-启动顺序)）：

```mermaid
flowchart TD
    FS["ctx.fs · ctx.db · ctx.store ✅"] --> CODEC["ctx.codec"]
    FS --> SCAN["plugin-local-scanner<br/>ctx.scanner"]
    CODEC --> SCAN
    CODEC --> AUDIO["core-audio-webaudio<br/>ctx.audio"]
    SCAN --> SRCLOCAL["plugin-source-local"]
    HTTP["ctx.http — M1 slice"] --> SRCURL["plugin-source-runtime<br/>MD-7 slice"]
    SRCLOCAL --> SOURCES["plugin-sources<br/>ctx.sources<br/>registry · catalogue · FTS"]
    SRCURL --> SOURCES
    FS --> SOURCES
    SCAN -.->|library/changed| SOURCES
    AUDIO --> PLAYER["plugin-player<br/>ctx.player"]
    SOURCES --> PLAYER
    MS["ctx.mediaSession"] --> PLAYER
    DEV["ctx.device"] --> PLAYER
    BG["ctx.background"] --> PLAYER
    PLAYER --> VIEWS["plugin-*-ui-mobile · plugin-*-ui-desktop"]
    SOURCES --> VIEWS
    KIT["ui-kit-mobile · ui-kit-desktop"] --> VIEWS
    VIEWS --> UI["ctx.ui ✅"]
    UI --> SHELL["apps/mobile · apps/desktop"]
```

---

## 3. 排序

五个阶段。每个阶段都以一件可演示的东西收尾，因为一个无法演示的阶段也无法被证明做完了。

```mermaid
flowchart LR
    S0["Stage 0<br/>audio spike<br/><i>ADR-4 go/no-go</i>"] --> S1["Stage 1<br/>the platform floor<br/>codec · audio · device · background"]
    S1 --> S2["Stage 2<br/>the catalogue<br/>scanner · source-local · library"]
    S1 --> S5["Stage 5<br/>streaming<br/>http slice · source-runtime slice"]
    S2 --> S3["Stage 3<br/>transport<br/>player · media session"]
    S5 --> S3
    S3 --> S4["Stage 4<br/>the surface<br/>kits · views · shells"]
```

### 3.1 阶段 0 —— 音频试石

在 §2 中任何包落笔之前，先由一个用完即弃的分支回答 ADR-4 是否成立。它不是插件、没有测试、事后删除。它必须在**一台 iOS 真机、一台 Android 真机和 Electron 中**展示：

- 一个本地文件被解码并完整播放，`positionMs` 单调前进。
- 一个远程 URL 以流的方式播放，一次能落点的 seek，以及一次刻意制造的、能恢复而不是让源终止的停顿。
- 两个缓冲源经 `AudioBufferQueueSourceNode` 无缝交接，听不出间隙。
- 一个 `GainNode` 与一个 `BiquadFilterNode` 被构造并连接 —— 不是为了 M1，而是因为 M4 用的同一种货币。
- 应用切后台（移动端）与窗口隐藏（桌面端）时播放不中断。
- 锁屏或通知控件能驱动暂停与恢复。

**决策点。** 若前三项中任何一项在某个目标上失败且试石期内修不好，就以 `core-audio-rntp`（基于 `react-native-track-player`）作为移动端实现（[audio/playback.md §1](../audio/playback.md#逃生通道)）。其后果要在阶段 1 开工*之前*记录下来，而不是事后才发现：没有移动端 DSP，M4 变成桌面专属；`chainInput` 在移动端成为空操作；MD-5 收窄到回退引擎能提供什么。`ctx.player` 与每个视图包不受影响 —— 这正是抽象存在的意义 —— 但里程碑的范围变了，而这是一个要刻意做出的决策。

### 3.2 阶段 1 —— 平台地基

`core-codec-*`、`core-audio-webaudio`、`core-device-*`、`core-background-*`，以及它们需要的桥宿主。没有功能插件。

**演示。** 一项测试经 `ctx.codec` 与 `ctx.audio` 加载一个随包附带的文件并播放，在 Node（用假件）、iOS 模拟器、Android 模拟器与 Electron 上全绿。

### 3.3 阶段 2 —— 目录

`plugin-local-scanner`、`plugin-source-local`，以及 `plugin-sources` 的目录半边（注册表半边已建成），外加它们需要的协议变更（MD-3）。

**演示。** 把扫描器指向一个文件夹；`ctx.sources.listTracks()` 返回排序且分页的结果；`ctx.sources.searchLocal('bjork')` 找到 `Björk`；对未变化的文件夹做第二次扫描时一个字节的文件内容都不读。仍然听不到任何声音。

### 3.4 阶段 3 —— 传输

`plugin-player` 与 `core-media-session-*`。

**演示。** 从测试或调试控制台：`playNow`、暂停、seek、下一曲、上一曲、重排。锁屏显示曲目且按钮可用。杀掉进程再启动：队列与进度回来，且没有任何东西在播放。

### 3.5 阶段 4 —— 表面

`ui-tokens`、`ui-core`、两套组件库、各视图包、两个外壳。

**演示。** [roadmap.md §M1](./roadmap.md#m1--能播放音乐) 的完成标准，由一个人拿着手机、另一个人点着鼠标来执行。

### 3.6 阶段 5 —— 流式（与阶段 2 并行）

`core-http-node`、`core-http-rn`，以及 `plugin-source-runtime` 的 MD-7 切片。只依赖阶段 1，在阶段 3 汇合，因此从不在关键路径上。

**演示。** 在设置里粘贴一个 URL，就变成一份单规则音源文档；它能播放、能 seek、能挺过一次停顿，且在恢复期间上报 `stalled` 而不是 `paused`。

---

## 4. 工作包

每个包在其勾选项全部打勾、`pnpm check` 全绿、并通过以整个工作区为参数的泄漏测试（[workflow/testing.md §6](../workflow/testing.md#6-测试策略)）时即告完成。这三条在下文视为默认成立，不再重复。

### 4.1 `core-codec-node` · `core-codec-rn` —— `ctx.codec`

桌面端在 **`main` 中**用 `music-metadata` 读标签，经由 `core-desktop-bridge` 触达；PCM 解码用渲染进程的 `decodeAudioData`，完全不需要过桥。移动端用 `react-native-audio-api` 的 `AudioDecoder` 解 PCM，用一个原生标签读取器拿元数据。

`readMetadata` 不得读整个文件。一个 40 MB 的 FLAC 只值得读一次文件头加一次 seek 到标签块，而不是让 40 MB 走一遍 IPC 通道 —— 这就是 5,000 个文件的扫描要几分钟还是要一下午的区别。

- [x] 在 `packages/protocol/src/conformance/` 新增 `codecConformance` 套件，在 Node 与真机上运行：标签、内嵌封面、时长探测、PCM 解码、非空的 `supportedFormats()`。
      ⚠️ 在 Node 里对着 `core-codec-node` 全绿；真机那一半归冒烟矩阵。
      PCM 用例刻意是双面的，因为 `decode` 是两个平台答案不同的成员：移动端有一个真正的解码器（`AudioDecoder`），而桌面端上解码属于音频引擎——标签读取器里再放一个解码器，等于对"这个平台能播什么"给出第二个答案。因此一份实现可以解码，*或者*以一种说清解码住在哪里的方式拒绝——它不能做的是返回一个形状像音频、里面却没有音频的东西。调用方可以处理拒绝，却无法处理谎言，这与 MD-1 的"缺席，不是打桩"是同一条规则。
- [x] 一个契约用例断言 `readMetadata` 在大文件上不超过字节上限。
- [x] `supportedFormats()` 如实反映各平台；[services/contracts.md §13](../services/contracts.md#13-ctxcodec--解码与元数据) 的 ⚠️ 以*上报*无法解码的内容来兑现，绝不悄悄跳过。
- [x] 新的桥方法与所有其他宿主一样带能力标注并做路径封闭（[plugins/concepts.md §7](../plugins/concepts.md#门实际运行的位置)）。
      ⚠️ **codec 结果上根本没有新桥方法。** `music-metadata` 是纯 JavaScript，所以它像其他一切一样经 `ctx.fs` 读取，同一份实现既跑在 `main` 里也跑在渲染进程里——一条代码路径而不是两条，而有界头部读取是一次 `readBytes`，它本来就在允许清单上、本来就被路径封闭。上面那段描述的是被替换掉的设计。真正长大的宿主是 `http`，它自带自己的闸门（§4.5）与封存用例。

### 4.2 `core-audio-webaudio` —— `ctx.audio`

两个目标一个包：移动端用 `react-native-audio-api@0.13.3`，桌面端用同一个包的 web 构建或渲染进程的原生 Web Audio。这是阶段 0 专为降低风险而存在的那个包。

M1 的图是 [audio/playback.md §1](../audio/playback.md#图拓扑) 的拓扑，链为空：

```mermaid
flowchart LR
    S1["source A (current)"] --> CI["chainInput<br/>GainNode"]
    S2["source B (prefetched)"] -.->|connects at swap| CI
    CI --> GAP["effect chain<br/>spliced here at M4"]
    GAP --> MV["master volume"]
    MV --> DST["destination"]
```

`chainInput` 从第一天起就是真实节点，源连接到它，永远不直接连 `destination`。M4 在 `chainInput` 与主音量之间接入效果链，一行 `plugin-player` 代码都不用动。M1 **不**交付占位链，也没有 `ctx.dsp`：一个空的接入点是诚实的，一条直通的链是一个日后还得拆掉的谎言。

- [x] `load()` 同时支持两种策略 —— 本地文件与短的远程文件用 `buffer`，这正是 MD-5 无缝衔接得以成立的前提；其余用 `stream`。
- [x] `onInterruption` 与 `onRouteChange` 把各平台的事件映射到契约的形状。消费它们的*策略*住在 `plugin-player`（§4.9），不在这里。
- [x] 流式源经 `onStalled` 上报缓冲欠载及其恢复，这是唯一能让 `stalled` 在上一层与 `paused` 区分开的东西。元素的 `waiting`/`stalled` 变为 `true`、`playing`/`canplaythrough` 变为 `false`，且只发布*变化* —— 慢网络下的元素会反复发送 `waiting`，若播放器把每一次都当成一次新的停顿，就会把恢复超时一遍遍重置。解码出的缓冲不会欠载，也就什么都不注册。
- [x] `listOutputDevices` / `setOutputDevice` 在桌面端是真的；在移动端给出一条带泄漏说明的单项列表，绝不抛错。
- [x] 上报 `outputLatencyMs`，让 M4 有东西可补偿。
- [x] `audioConformance`：播放、进度前进、暂停保持位置、seek 落点、`onEnded` 恰好触发一次、`dispose()` 断开它创建的每一个节点。在 Node 里对着 `OfflineAudioContext` 与真机上全绿。

### 4.3 `core-device-*` · `core-background-*`

`ctx.device` 提供 `network()` 与 `onNetworkChange` —— `StreamPrefs.saveData` 的来源 —— 外加桌面端的电量、媒体键与快捷键。

`ctx.background` 提供 `canRunInBackground()`、`acquireWakeLock`、`schedule`（M1 中仅被移动端扫描轮询使用，因为那里的 `ctx.fs.canWatch` 为 false）以及 `onWillSuspend`，后者是播放器做检查点的地方。

- [x] 桌面端 `canRunInBackground()` 为 `true`；移动端仅在音频持有进程时为 `true`，且该值是推导出来的，不是写死的。
- [x] `acquireWakeLock` 在桌面端映射为 `powerSaveBlocker` 并及时释放；泄漏的锁会被泄漏测试抓住。⚠️ 而它如今有了*调用者* —— 见 MD-6。没有消费者的能力能通过它拥有的每一个测试，却什么也交付不了。
- [ ] `onWillSuspend` 在两个平台上都于真实挂起之前触发，并在真机上验证 —— 一个从不触发的钩子比没有钩子更糟，因为下游的一切都信任它。

### 4.4 `core-media-session-electron` · `core-media-session-rn`

桌面端经渲染进程的 Chromium `navigator.mediaSession` 发布，并经 `main` 支持 MPRIS（Linux）、SMTC（Windows）与 macOS 的"正在播放"中心。移动端用 `react-native-audio-api` 的锁屏与通知控件，在 Android 上这意味着前台服务及其媒体通知。

封面在移动端必须是本地 `Uri`，因此顺序是固定的：先立即发布不带封面的元数据，图像到位后再更新。绝不为等一张图而拖延整次更新。

⚠️ `setPlaybackState('stopped')` 是一种**传输状态**，不是 `clear()`。两个实现对这一点的分歧持续了恰好"没人来问"那么久：桌面端把会话设为 `none` 并保留曲目，移动端隐藏通知并丢掉它 —— 于是一条播放到底的队列，在一个平台丢了锁屏、在另一个平台保住了。移除表面有自己的成员，契约套件现在按它约束两边。

- [x] `setSupportedCommands` 真实改变 OS 表面显示哪些按钮。
- [x] `onCommand` 能往返：一次锁屏按压到达 `ctx.player`，结果在一次更新内反映回去。
- [x] `clear()` 移除 OS 表面，于是被禁用的 `plugin-player` 不留下幽灵锁屏。

### 4.5 `core-http-node` · `core-http-rn` —— M1 切片

按 MD-1：GET 与 HEAD、任意请求头、`Range`、`stream()`、`onProgress`、`timeoutMs`、`AbortSignal`、重定向处理。桌面端在 `main` 里走 Electron 的 `net` 并把流送回渲染进程，理由见 [architecture/layers.md §2](../architecture/layers.md#桌面端) 的 CORS 与请求头。

`cookies` 与 `download()` 是**缺席，不是打桩** —— 一个会抛错的成员是对契约的撒谎，这与让音源的能力是派生而非声明的是同一条原则（[sources/rule-engines.md §1.3](../sources/rule-engines.md#13-能力是推导出来的不是声明出来的)）。

⚠️ **绝不要在通往桥的路上经 `new Request()` 归一化请求。** `Request` 的头部清单携带着*请求守卫*，在浏览器里这个守卫会悄悄丢弃每一个被禁止的请求头 —— `Cookie` 就在其中。渲染进程侧的传输正是为了发送 `Cookie` 而存在的。经 `Request` 归一化，删掉的恰恰是这座桥为之而建的那一个头，而且删得悄无声息：登录看起来成功了，却永远留不下来。这也是一个本仓库里默认没有任何测试能看见的 bug，因为 Node 的 `fetch` 不实现这个守卫 —— 所以覆盖它的检查会先递上一个严格的 `Request`。`Headers` 自身携带的是"none"守卫，是安全的。
`http/request` 瀑布在没有监听者的情况下照常派发，于是 M2 的认证插件面对的是一个已经在工作的钩子。

- [x] `httpConformance` 只覆盖 M1 切片，写成 M2 加用例而不是重写的形态。
- [x] `net:host/<glob>` 在这里、瀑布之前与之后被强制执行 —— 这项授权曾是一条毫无意义的清单字符串，正如 `db:own` 曾经那样（[plugins/concepts.md §7](../plugins/concepts.md#执行)）。
- [x] RN 0.86 上的 `ReadableStream` —— 由 **`expo/fetch`** 解决，而不是靠 polyfill。React Native 自带的 `fetch` 以 XHR 为底、其 `Response.body` 为 `null`，垫在它上面的流就只是形状上的流：没有在文件到达之前就能播的 `Range` seek，没有 `onProgress`，也没有能与慢响应区分开的停顿。`expo/fetch` 符合 WinterCG 并返回一个真的（[services/contracts.md §17](../services/contracts.md#17-运行时兼容性清单)）。
      ⚠️ 经构造验证，未经真机验证。
- [x] Range 请求与进度对着一个真实的按字节服务的 fixture 检验，而不是 mock。

### 4.6 `plugin-sources` · `plugin-source-local`

`plugin-sources` 分两半到来。

**注册表 —— 已建成。** `register`、`providers`、`get`、`forUrn`，以及一个在 M1 里最多只有两个音源可问的 `searchAll`。它拒绝重复的 `sourceId` 而不是遮蔽既有者，因为同一音源 id 上有两个提供方会让该命名空间里每一条 URN 都有歧义 —— 这正是 URN 方案要防的头号问题。`sources` 表中 `sourceUrl` 的唯一性（[data-model/urn.md §4.1](../data-model/urn.md#41-音源账号与会话)）是同一保证的另一半，在下一层强制执行。`searchAll` 同时返回按提供方的结果*与*按提供方的错误，把慢后端上报为 `pending` 而不是取消它，跳过 `capabilities` 声明不支持搜索的提供方，并把裸 `throw` 映射到 [sources/authoring.md §7](../sources/authoring.md#7-错误) 的分类法上，让一个粗鲁的音源毁不掉整个扇出。注册即返回释放器，因此一个音源的 fiber 卸载时，它的注册也随之消失。

**目录缓存 —— 阶段 2。** 为它之上的一切提供读取（MD-3），并拥有 FTS5 索引。索引由 `library/changed` 驱动，因此**任何**提供方的行都会被索引，而扫描器或音源根本不需要知道索引存在。重建索引是对同一 rowid 做 `DELETE` + `INSERT`：`contentless_delete=1` 允许删除但拒绝部分 `UPDATE`（[data-model/schema.md §4.3](../data-model/schema.md#43-目录catalogue)）。

每个音源从第一天起就加载在自己的 `ctx.isolate('http')` 作用域里（[sources/runtime.md §4.1](../sources/runtime.md#41-一个源的生命周期)），即便 M1 还没有任何需要隔离的 cookie。

- [x] `listTracks` / `listAlbums` / `listArtists` 的分页与排序在 SQL 里做，绝不在 JS 里做 —— 10 万曲的曲库不能为了排序先整个物化出来。
- [x] `searchLocal` 折叠变音符号：`bjork` 能找到 `Björk`，以测试断言。
- [x] 钩子（`useTracks`、`useAlbum`、`useSearch`）住在这个无 UI 包里，由两个视图包共同导入（[ui/architecture.md §4](../ui/architecture.md#4-把服务绑定到-react)）。
- [x] 关联 URN 的展示折叠**不**实现，但返回的形状能承载它，于是 M2 加行为而不是改签名。⚠️ M2 的关联像它的运行时超过 MD-7 那样超过了这一条：`track_links`、`linkTracks` 与 `linksFor` 已建成并暴露在 `ctx.sources` 上。仍属 M2 的只剩*展示*折叠。
- [x] 缓存落地后声明 `db:read:core` + `db:write:core`；注册表半边两者都不需要，什么也不声明（MD-4）。

`plugin-source-local` 与任何提供方一样 —— 本地曲库没有特权。音源 id `local`、`auth.flow = { kind: 'none' }`，`signIn` 立即 resolve，`signOut` 清掉自己缓存的行。它是唯一一个不是文档、也永远不会是文档的提供方，因为没有可供描述的 HTTP（[sources/authoring.md §12](../sources/authoring.md#12-不是字符串的东西本地文件)）。

`resolveStream` 读取扫描器写入的 `media_bindings` 行（`origin: 'scan'`），返回 `{ kind: 'local', target: await ctx.fs.toPlayableUri(uri), seekable: true }`。它与远程提供方的全部差别就这一处 —— 这也是为什么 M3 的下载能无声地插进来：下载的曲目只是同一个形状换成了 `origin: 'download'`。

`browse` 在启用的扫描根下遍历 `ctx.fs.list`，经 `scan_entries` 把叶子解析为 URN，[sources/rule-engines.md §2.2](../sources/rule-engines.md#22-规则块) 的文件夹树就此免费获得——与文档的 `ruleExplore` 产出的 `childUrl`-或-叶子形状相同，由同一个组件渲染。

`search` 由 `ctx.sources` 维护的 FTS 索引作答，过滤到 `source_id = 'local'`。一个索引、两个入口 —— `ctx.sources.searchLocal` 面向统一目录，`provider.search` 面向扇出 —— 而不是两套会各自漂移的 tokeniser 配置。

- [x] `capabilities` 与已实现成员严格一致：`browse: true`、`search.fullText: true`、`library.read: true`、`streaming.seekable: true`、`urlExpiry: false`、`transcoding: false`。
- [x] `ping()` 保持廉价：根目录存在且可读，仅此而已。
- [x] 注册以释放器形式返回，卸载插件即移除提供方及其派生的一切。
- [x] 声明 `db:read:core` + `db:write:core`：它读扫描器写的行，且 `signOut()` 删除本音源的行，这是一次写（MD-4）。

### 4.7 `plugin-local-scanner` —— `ctx.scanner`

与 `plugin-source-local` 分开，因为扫描与服务是两回事（[sources/authoring.md §12](../sources/authoring.md#本地扫描器)）。

- **增量。** 以 `(size, mtime)` 对 `scan_entries` 决定一个文件是否需要碰。未变化的曲库只消耗 stat 调用，别无其他。这是完成标准，所以它是测试而不是意愿（§6）。
- **可中断。** 一个事务里一批文件，从 fiber 取 `AbortSignal`，每批之后做检查点，每批发一次 `scan/progress`。扫描中途一次挂起的代价是一批。
- **对失败诚实。** 无法解码的文件记为 `scan_entries.status = 'error'` 并附原因，以"无法导入"列表的形式浮出 —— 绝不无声缺席。
- **封面。** 只提取一次，哈希为 `artworks.id`，`blurhash` 与 `dominant_color` 在导入时用纯 JS 计算（[data-model/schema.md §4.2](../data-model/schema.md#42-封面图)）。在任何一项放到列表滚动期间做都会掉帧。
- **删除。** 消失的文件带走自己的 `media_bindings` 行，而一条失去绑定的本地曲目被移除 —— 对实例 `local` 而言，文件*就是*曲目。
- **监视。** `ctx.fs.canWatch` 为真时用 `ctx.fs.watch`；否则经 `ctx.background.schedule` 轮询，并把由此产生的延迟如实写进 UI，而不是假装不存在。⚠️ 若*两者*都不存在 —— 在 `core-background-electron` 落地之前的每个桌面构建上都是如此，因为桥的 `canWatch` 为 false —— 扫描器回退到自己的定时器。没有它，桌面端曾完全没有自动重扫：文件变了，曲库却无声地保持陈旧。

- [x] `addSpecifiedDir` 用 `ctx.fs.pickDirectory`，且 Android 的 SAF 授权在重启后仍然有效。
      ⚠️ 选择器调用放在*视图*包里，`addSpecifiedDir` 接收它返回的 `Uri`：挑选文件夹是一次 UI 动作，而一个会弹出对话框的服务没法从测试或恢复流程驱动。SAF 那一半是真机工作。
- [x] 写入 `tracks`、`albums`、`artists`、`track_artists`、`genres`、`track_genres`、`artworks`、`media_bindings`、`scan_specified_dirs`、`scan_entries`；声明 `db:write:core`（MD-4）。
- [x] 每批发出 `scan/started`、`scan/progress`、`scan/finished` 与 `library/changed`，UI 于是渐进填充，而不是等整棵树走完。
- [x] 扫描中途取消后数据库保持一致，下一次扫描以低成本续传。
- [x] 写入成批并走单一写入路径 —— [10](./roadmap.md#-sqlite-作为唯一存储) 的 SQLite 争用风险在这里被第一次实测（§7）。

### 4.8 谁写目录

两个写入者与一个"记录读取者"，值得写明，因为"目录"是多个 M1 包都要触碰的那一份状态。

| 行 | 由谁写 | 授权 |
|---|---|---|
| 音源 `local` 的 `tracks`、`albums`、`artists`、`artworks`、`media_bindings`、`scan_*` | `plugin-local-scanner`，来自磁盘文件 | `db:read:core` + `db:write:core` |
| 远程音源的同名表 | `plugin-sources`，缓存音源的回答（[sources/runtime.md §1.1](../sources/runtime.md#11-一个运行时多个源)） | `db:read:core` + `db:write:core` |
| `tracks_fts`、`tracks_fts_map` | 仅 `plugin-sources`，由 `library/changed` 驱动 | 同上 |
| `queue_items`、`playback_state`、`play_history`、`track_stats` | `plugin-player` | `db:read:core` + `db:write:core` |
| `playlists`、`playlist_items`、`library_items`、`collections` | M1 无人 —— M2 的 `plugin-library` | — |

一切*读取*都经 `ctx.sources`。提供方从不亲自写目录：它回答问题并返回纯数据，这正是提供方可以不依赖数据库而被测试的原因 —— 也是音源运行时可以对着录好的 HTTP fixture、完全不需要数据库地被测试的原因（[workflow/testing.md §6](../workflow/testing.md#6-测试策略)）。

### 4.9 `plugin-player` —— `ctx.player`

M1 里最大的包，也是用户最能感知其行为的包。

**传输。** [audio/playback.md §2](../audio/playback.md#播放控制状态机) 状态机的每一个转移，包括与 `paused` 区分的 `stalled`：UI 显示转圈，锁屏继续上报*正在播放*，于是一次缓冲欠载不会让锁屏闪烁。

**队列。** 持久化到 `queue_items`，用分数索引，因此在 5,000 曲的队列里移动一首曲目恰好写一行。LexoRank 风格的助手放进 `@BBeBee/protocol`、与 URN 助手为邻，因为 M2 的播放列表还要复用它。

**让播放器"手感对"的行为**，每条带一个测试：超过 3000 ms（可配置）时 `previous()` 重播当前曲目，否则回退一曲；随机是持久化的种子加一个排列，不是掷骰子，因此即将播放的队列可以被如实展示；单曲循环复用已加载的缓冲而不是重新解析。

**解析。** `player/before-resolve` 作为瀑布派发，末端调用 `ctx.sources.forUrn(urn).resolveStream(id, prefs)`，`prefs` 由 `ctx.device.network().metered` 与 `ctx.codec.supportedFormats()` 构成。M1 里没有任何东西挂接它 —— 这是刻意的：它是 M3 回归测试"有与没有 `plugin-download` 时播放行为一致"的对照组（[workflow/testing.md §6](../workflow/testing.md#6-测试策略)）。

**无缝衔接、预取与淡入淡出**，按 MD-5。

**中断。** [audio/playback.md §5](../audio/playback.md#5-打断焦点与路由) 的整张策略表，在这里、对着 `ctx.audio` 的事件、一次性实现。拔出耳机即暂停，这一条不可配置。

**持久化。** 播放中每 5 秒节流写一次 `playback_state`；暂停、换曲与 `ctx.background.onWillSuspend` 时立即写。启动时恢复队列与进度，且**绝不自动播放**。

**历史。** `player/track-completed` 并行派发；`play_history` 与 `track_stats` 在同一事务里写入。

- [x] 状态机的每一个转移都有对着 mock `AudioService` 的单元测试，包括加载途中被打断与预取途中队列变化。
- [x] `stalled` 是播放器真正会抵达的状态，而不只是类型允许的一个值。播放中曲目的一次欠载变成 `stalled`；恢复后回到 `playing`；锁屏全程继续上报*正在播放*，于是列车每次钻进隧道它都不会闪烁。暂停、seek、一次打断与一次路由变化都把 `stalled` 当作播放中 —— 它是被饿着的 `playing`，不是 `paused`，而仅仅因为没有音频恰好出来就拒绝用户的暂停，是把这对区分用错了半边。这个状态受 `stallTimeoutMs` 约束：[audio/playback.md §2](../audio/playback.md#播放控制状态机) 的 `stalled --> error: timeout exceeded`，没有它，一台服务器已消失的流会让转圈永远转下去。
- [x] 错误映射到 [sources/authoring.md §7](../sources/authoring.md#7-错误) 的分类法，且**任何失败路径都不清空队列**。
- [x] 播放时经 `ctx.background` 持有 wake lock，其余时刻放手（MD-6）。获取是异步的，因此一个在播放已停止之后才到手的锁会在抵达时即被释放，而不是被攥到别的什么东西改变状态为止 —— 这个失败没人会注意，直到一台笔记本在包里把自己耗干。`ctx.background` 保持可选：没有它的构建照旧播放，只是不持锁。
- [x] 每次曲目与状态变化都发布到 `ctx.mediaSession`，位置按 1 Hz 节流。
- [x] 能力：`audio`、`mediaSession`、`background`、`db:write:core`。
- [x] 播放中途禁用插件会停止音频、清掉锁屏、不留下任何仍连接的节点 —— 经 `ctx.inspector` 验证。

### 4.10 `plugin-source-runtime` —— MD-7 切片

按 MD-7，运行时进入 M1 时只做一件事：把一条音源行变成一个可播放的 URL。

**交付什么。** `sources` 表及其迁移（[data-model/urn.md §4.1](../data-model/urn.md#41-音源账号与会话)）；从 `sourceUrl` 派生音源 id（[sources/authoring.md §1.2](../sources/authoring.md#12-身份源-id)）；每个启用的音源一条 fiber，置于各自的 `ctx.isolate('http')` 作用域内；带 `{{source.*}}`、`{{track.*}}` 与 `{{prefs.*}}` 作用域的 `=` 模板求值器；以及 `ruleStream` → `StreamHandle`。`getTrack` 从行合成一个 `Track`；`ping()` 是一次 HEAD；文档没有说明时，`capabilities.streaming.seekable` 来自那次 HEAD 的 `Accept-Ranges`。

**不交付什么。** 选择器引擎、组合器、`@put`/`@get`、`@js:` 以及因此而来的 `ctx.js`、`searchUrl`、`exploreUrl`、除 `ruleStream` 外的每个规则块、登录、导入审阅界面、编辑器，以及 tracer。设置页提供"添加 URL"，写入一份双字段文档；粘贴完整文档是 M2 的事。

它的价值与它替代的那个包相比没有变化——它是地板，因此也是回归测试：如果任何屏幕在它被配置的情况下坏掉，说明某个消费者在读取一个它从未检查过的能力。派生能力让这一点更锋利，因为一份单块的文档就真的只有一个能力，而不是对能力的一份声明式宣称。

- [x] 与 `plugin-source-local` 同时配置，没有任何屏幕因缺失能力而坏掉 —— 以断言固定，而不是靠观察。
- [x] 播放它即走 `stream` 策略、`stalled` → `playing` 的恢复，以及按 `Range` 的 seek。⚠️ 在 `StreamerNode` 落地之前，`stream` 策略仅限桌面：React Native 没有 `HTMLMediaElement`，因此引擎宁可拒绝流式加载也不装样子（§9）。停顿路径本身与引擎无关，并已对着 mock 测过。
- [x] 禁用该音源会销毁它的 fiber 及其隔离的 http 作用域；泄漏测试像对待任何插件一样覆盖它（[sources/runtime.md §4.1](../sources/runtime.md#41-一个源的生命周期)）。
- [x] `doc_json` 可完整往返：设置写入什么，`export()` 就逐字节输出什么。这是对 M2 导出完成标准所依托论断的最便宜的早期检查。
- [x] `=` 求值器拒绝任何它不理解的东西，而不是把规则当作字面量悄悄输出 —— 这个失败模式会让之后每一个规则 bug 都更难找到。

### 4.11 `ui-tokens` · `ui-core` · `ui-kit-mobile` · `ui-kit-desktop`

令牌是纯数据（[ui/design-system.md §6](../ui/design-system.md#6-设计令牌)）；`ui-core` 是架在 `useSyncExternalStore` 上的共享钩子层；两套组件库以同名同 props 导出同一组组件 —— `Button`、`IconButton`、`TrackRow`、`Slider`、`Sheet`/`Dialog`、`List`、`EmptyState`、`Toast`。

- [x] 一致性测试**先于**第一块屏幕落地：它比对两套库导出的名字与 prop 类型，出现分歧即失败，并对两套配色都检查 WCAG AA 对比度。
- [x] 列表虚拟化 —— 移动端 `@shopify/flash-list`，桌面端 `@tanstack/react-virtual`。
      桌面端对行做窗口化并发布 `aria-setsize`/`aria-posinset`，因为窗口化对明眼用户不可见、对读屏器是灾难，除非把真实长度大声说出来。⚠️ `estimatedItemSize` 如今是仅桌面的提示：FlashList v2 自己量行高并删掉了这个 prop，所以移动端组件库刻意不转发它 —— 传了也只是被当成提示、什么也不做。它留在共享契约里，因为一个被一套组件库忽略的 prop，比两份契约便宜。
- [x] 无障碍名称经共享 props 传入，只写一次（[ui/architecture.md §8](../ui/architecture.md#8-无障碍)）；桌面端可键盘导航、焦点可见、`Escape` 关闭浮层；两端都尊重减弱动效。
      ⚠️ 移动端的 `Slider` 曾是一幅进度条的*画像*：没有手势，还有一个把已有值再提交一遍的 `onAccessibilityAction` —— 一个被宣读为可调节、实则什么都调不了的控件，而且移动端上没有任何人能 seek（标准 2）。它现在经 React Native 自己的响应者系统拖动 —— 不引入 `react-native-gesture-handler`，因为组件库里的原生模块正是 `configureNative` 存在要挡住的东西 —— 拖动期间上报 `onChange`、松手时报一次 `onCommit`，钳制在自己的范围内，OS 把拖拽抢走时把进度还回来，`increment`/`decrement` 按 5% 步进。
- [x] `useServiceState` 的选择器引用稳定，并有测试证明 1 Hz 的进度 tick 不会引发重渲染风暴。

### 4.12 视图包

`plugin-player-ui-{mobile,desktop}`、`plugin-sources-ui-{mobile,desktop}`、`plugin-local-scanner-ui-{mobile,desktop}`。按 MD-2 每外壳五块屏：曲库（曲目与专辑，带 `All`、`Local` 与 `Favorites` 的范围过滤）、专辑详情、队列、正在播放（移动端全屏、桌面端底栏），以及扫描根目录与 URL 音源的设置。最后一个是 M2 音源列表的种子（[ui/architecture.md §4](../ui/architecture.md#音源相关界面)）—— 一个只有添加与移除的列表，刻意没有导入审阅界面，因为目前还没有任何东西可审阅。

让 ADR-2 保持可负担的那条规则：**如果同一个 `if` 即将在两个包里各写一遍，它就该住进无 UI 的那个。** 这些包应当只做布局、手势与事件接线，别无其他。

- [x] 贡献是描述符；组件用 `registerView` 绑定，绝不直接交给外壳（[ui/architecture.md §2](../ui/architecture.md#2-贡献即描述符)）。
      ⚠️ **绑定到视图包自己的上下文，而不是外壳的。** 外壳用它从 `app.ready(['ui'])` 得到的上下文把视图渲染成 `h(Component, { ctx })` —— 注入了 `ui`、别的什么都没有。cordis 上下文对任何未被注入的属性都会*抛错*，于是每一块经自己的钩子读取 `ctx.sources`、`ctx.player` 或 `ctx.scanner` 的屏幕都在真机上抛了错。M0 演示的视图包一直注册的是包着自己上下文的闭包；M1 的视图包注册的却是裸组件。它们现在也这么做，并且各自声明自己的屏幕实际读取哪些服务。
- [x] `ui.missingViews()` 被用到：至少一个贡献在某个目标上刻意没有视图，外壳显示"此平台不可用"而不是一个窟窿。
      `plugin-inspector` 就是那个贡献 —— 两个外壳都运行它、只有桌面有它的视图 —— 且 `shells.test.ts` 断言这一安排仍然成立，于是哪天有人加了 `plugin-inspector-ui-mobile`，这项检查就会说这条路径不再被覆盖。
- [x] 封面先渲染 `blurhash`，再渲染图片。滚动时不出现灰色闪烁。
- [x] 位置在两次 1 Hz tick 之间用 `requestAnimationFrame` 插值，绝不轮询。
- [x] 没有 `useEffect` 干领域活，React 里没有领域状态。
- [x] 视图绝不经 `ctx.name` 读取服务。`ui-core` 的 `serviceOf` / `useService` 经 `reflect.get(name, false)` 询问，它回答 `undefined` 而不是抛错。
      ⚠️ `ctx.player?.playNow()` 看起来是一个安全的可选项，其实不是：属性读取在 `?.` 得以短路之前就抛错了。`useService` 自己的文档注释许诺过"未加载处为 `undefined`"，实际做的却恰恰相反 —— 在每个测试构造出的根上下文上为真，在每个视图真正拿到的 scoped 上下文上为假。

### 4.13 外壳

| | `apps/mobile` | `apps/desktop` |
|---|---|---|
| 引导 | 加入 `core-codec-rn`、`core-http-rn`、`core-media-session-rn`、`core-device-expo`、`core-background-expo`、`core-audio-webaudio` | 对应的 `-node` / `-electron` 版本，外加同一个共享音频包 |
| 后台音频 | `UIBackgroundModes: ['audio']`，audio session 类别 `playback`；Android 前台服务带媒体通知 | 关闭到托盘以保住渲染进程（MD-6）；播放期间 `powerSaveBlocker` |
| 原生 | 重建自定义 dev client —— M1 的每个核心服务都加了原生代码 | 在 `main` 为 codec、http、media session 与 device 新建桥宿主 |
| 路由 | 贡献的路由以动态 `expo-router` 路由接入；`placement` 决定进 tab 栏还是更多菜单 | 来自 `ctx.ui.routes` 的侧栏项，按 `order` 排序 |

- [x] 重跑 `pnpm gen:plugins` 并提交其产物（[workflow/build-pipelines.md §4](../workflow/build-pipelines.md#4-构建流水线)）。
- [x] 桌面 CSP 在其底线之上恰好多一个令牌：`'wasm-unsafe-eval'`，因为 `ctx.js` 在桌面引导清单里，而 Chromium 以 `script-src` 闸住 `WebAssembly.instantiate` —— 没有它 QuickJS 永远无法编译，`createApp` 随之中止。它**不是** `'unsafe-eval'`，因此 `eval` 与 `new Function` 仍被拒绝，"渲染进程里没有外来代码"这一点没有任何改变。`renderer/csp.test.ts` 对任何方向的漂移都会失败。
- [x] **每个目标都能打包。** Android 与 iOS 用 `expo export`，桌面用 `electron-vite build`。便宜，而且是唯一能抓住"类型检查通过却*载入不了*"的包的检查 —— 那是另一种失败，而事实证明，真正在场的正是这一种：`core-secrets-node` 用 `node:fs` 打开自己的文件，这在 `main` 里正确、在沙箱化的渲染进程里不可能，于是桌面渲染进程根本无法打包它。它现在经 `ctx.fs` 持久化，用的是它被**构造**时的那个上下文，这让存储自己的文件不占*调用方*的能力预算 —— 当初伸手去够平台 API 的理由正在于此（`core-secrets-node` 自己的测试钉死了这一点：一个持有 `secrets:own` 而没有 `fs` 授权的调用方，必须仍然能够保存）。
- [x] `main` 仍不含领域逻辑；每个新宿主都是机械转发（[architecture/layers.md §2](../architecture/layers.md#桌面端)）。

---

## 5. 新的契约表面

M1 向 `@BBeBee/protocol` 添加的一切。下面的服务接口是契约，不是草图 —— 它们应当能通过编译。

### 5.1 `ctx.sources` 上的目录读取

加到 `packages/protocol/src/services/sources.ts` 现有的 `SourcesService` 上（MD-3）。它已声明的注册表成员 —— `register`、`providers`、`get`、`forUrn`、`searchAll` —— 保持不变且已实现。

```ts
import type { Paged, PageRequest } from '../common.js'
import type { Album, AlbumDetail, Artist, ArtistDetail, Track } from '../entities/catalog.js'

export type TrackSort = 'title' | 'artist' | 'album' | 'addedAt' | 'year' | 'duration' | 'playCount'

export interface CatalogQuery {
  sort?: TrackSort
  desc?: boolean
  /** Restrict to given sources. Absent means every source. */
  sourceIds?: string[]
  /** Restrict to loved/favorited tracks. */
  onlyLoved?: boolean
  page?: PageRequest
}

export interface CatalogCounts { tracks: number; albums: number; artists: number }

export interface SourcesService {
  // … registry members as declared today …

  /* ── the catalogue cache (M1 Stage 2) ─────────────────────────────── */

  listTracks(q?: CatalogQuery): Promise<Paged<Track>>
  listAlbums(q?: CatalogQuery): Promise<Paged<Album>>
  listArtists(q?: CatalogQuery): Promise<Paged<Artist>>
  getAlbum(urn: string): Promise<AlbumDetail | undefined>
  getArtist(urn: string): Promise<ArtistDetail | undefined>

  /**
   * FTS5 over rows already stored, from any provider. Answers instantly and
   * works offline — the opposite of `searchAll`, which asks the backends and
   * can be slow, partial, or unreachable. Both exist; they answer different
   * questions and the UI shows both.
   */
  searchLocal(text: string, opts?: { limit?: number; sourceIds?: string[] }): Promise<SearchResult>

  counts(): Promise<CatalogCounts>

  /** Mark or unmark a track as loved / favorited. */
  setLoved(urn: string, loved: boolean): Promise<void>
}
```

⚠️ `searchLocal` 的过滤参数是 `sourceIds`，不是本节最初勾画的 `kinds: UrnKind[]`。两个理由，第二个才是真的：它与 `CatalogQuery.sourceIds` 相符，于是"限定到这些源"在整个目录表面上只被拼写一次；而 `kinds` 过滤器在 M1 里只会有一个合法取值，因为 FTS 索引里只有曲目（`SEARCHABLE_KINDS`）。一个唯一合法实参就是其默认值的参数不是过滤器，它是一份在错误地点许下的关于 M2 的承诺 —— `kinds` 等到专辑与艺人也被索引、真的有东西可选时再落地。

`ctx.library` —— 播放列表、收藏、合集 —— 随 M2 一起规范，那时才有真正做整理的东西。

### 5.2 `ctx.scanner`

```ts
// packages/protocol/src/services/scanner.ts
import type { Uri } from '../common.js'

export interface ScanSpecifiedDir {
  id: string
  uri: Uri
  recursive: boolean
  enabled: boolean
  lastScanAt?: number
  lastError?: string
}

export interface ScanSummary { added: number; updated: number; removed: number; errors: number }

export interface ScanProgress { specifiedDirId: string; done: number; total?: number }

export interface ScannerService {
  readonly specifiedDirs: readonly ScanSpecifiedDir[]
  addSpecifiedDir(uri: Uri, opts?: { recursive?: boolean }): Promise<ScanSpecifiedDir>
  /** `forgetTracks` also drops the catalogue rows this specified dir produced. */
  removeSpecifiedDir(id: string, opts?: { forgetTracks?: boolean }): Promise<void>
  setEnabled(id: string, on: boolean): Promise<void>

  /** `full` re-reads metadata even where (size, mtime) is unchanged. */
  scan(opts?: { specifiedDirId?: string; full?: boolean; signal?: AbortSignal }): Promise<ScanSummary>
  cancel(): void
  readonly progress: ScanProgress | undefined
}

declare module 'cordis' {
  interface Context {
    scanner: ScannerService
  }
}
```

> [plugins/concepts.md §2](../plugins/concepts.md#规则一切副作用都必须经过-fiber) 的片段写的是
> `ctx.library.scan({ signal })`。那是在演示取消，不是在指定归属：扫描属于 `ctx.scanner`，
> 依据 [sources/authoring.md §12](../sources/authoring.md#本地扫描器) 对扫描与服务分离的规定。它演示的取消
> 形状正是 `ScannerService.scan` 所接受的。

### 5.3 能力语法

向 [plugins/capabilities.md §7](../plugins/capabilities.md#能力语法) 增加两行，并收窄一行既有条目（MD-4，已落地）：

| 能力 | 授予 |
|---|---|
| `db:read:core` | 对核心目录表**仅限 `SELECT`**。过去放行任何语句 —— M1 中收窄 |
| `db:write:core` | 变更核心目录行。由 `plugin-sources`、`plugin-source-local`、`plugin-local-scanner` 与 `plugin-player` 持有，均为 `builtin` |
| `db:*:core` | 以上之外再加 `CREATE`/`DROP`/`ALTER`。M1 中无人申请；核心 schema 属于内核的迁移 |

### 5.4 上线的钩子

没有新事件。M1 是已声明的事件获得第一个发送者或监听者的地方 —— 这本身就是一件值得核对的事：

| 事件 | 第一个发送者 | 第一个监听者 |
|---|---|---|
| `scan/*`、`library/changed` | `plugin-local-scanner` | `plugin-sources`（FTS 索引）、各视图 |
| `source/registered`、`source/unregistered` | `plugin-sources` ✅ | 各视图 |
| `player/state-changed`、`player/track-changed`、`player/position`、`player/error` | `plugin-player` | 各视图、`ctx.mediaSession` 发布者 |
| `player/track-completed` | `plugin-player` | 历史与统计写入者 |
| `queue/changed` | `plugin-player` | 队列视图 |
| `player/before-resolve` | `plugin-player`（仅末端） | **无 —— 刻意的**（§4.9） |
| `http/request` | `ctx.http` | M2 之前无 |

M1 期间保持休眠：`download/*`、`dsp/*`、`source/auth-expired`、`source/signed-out`、`source/authenticated`、`source/rule-failed`、`source/checked`。

`source/imported`、`source/changed` 与 `source/removed` 在 MD-7 切片中获得第一个发送者 —— "添加 URL"就是对一份双字段文档的导入 —— 它们的监听者则是运行时重建该音源的 fiber，这正是 M2 之后完全依赖的机制。

---

## 6. 完成标准 → 各自如何验证

来自 [roadmap.md §M1](./roadmap.md#m1--能播放音乐) 的六条标准，外加 MD-5 补的一条。一条没有指明核查方式的标准只是意愿，不是标准。

| # | 标准 | 如何核查 | 自动化 |
|---|---|---|---|
| 1 | 扫描 ≥ 5,000 个文件；对未变化曲库的增量重扫只消耗 stat 调用 | 语料生成器（§7）造出 5,000 个带标签的文件；带插桩的 `ctx.fs` 统计调用数；第二遍必须发出 `n` 次 stat、零次 `readBytes`、零次 `readMetadata`。对着**真实的** `core-codec-node` 运行，位于 `plugin-local-scanner/src/corpus.test.ts`。在真机上对真实曲库重复 | ✅ Node · 每次发布跑一次真机 |
| 2 | 播放、暂停、seek、下一曲、上一曲、队列重排 —— 三个平台全部支持 | 对着 mock `AudioService` 的传输单元测试（[audio/playback.md §2](../audio/playback.md#播放控制状态机) 的每个转移）；真实 Context 加假核心服务的集成测试；两个拖动条都被驱动 —— 桌面端的 `input[type=range]`、移动端在 `ui-kit-mobile/src/slider.test.tsx` 里的响应者拖拽 —— 因为 UI 表达不出的 seek 就不是 seek；真机冒烟矩阵验证实物 | ✅ + 真机 |
| 3 | iOS 与 Android 的锁屏与通知控件；桌面的 MPRIS/SMTC/Now Playing | `mediaSessionConformance` 对每份实现往返 `update` / `setPlaybackState` / `onCommand`；OS 表面本身靠人工 | 部分 —— 表面靠人工 |
| 4 | 移动端切后台、桌面端隐藏窗口后播放不中断 | 桌面端：`apps/desktop/main/window-policy.test.ts` 对关闭决策的核查 —— 有托盘或在 macOS 上隐藏、没有退路之处销毁、绝不拦截退出 —— 外加 `plugin-player` 的 wake lock 套件，它钉死：播放中取锁、停顿期间持锁、暂停时释放、队列为空与卸载时释放，且播放于获取中途停止时不让锁滞留。移动端：真机冒烟，因为没有任何测试架能忠实地把应用切到后台 | 部分 |
| 5 | 拔出耳机即暂停 | 一项策略单元测试向播放器注入合成的 `onRouteChange` / `onInterruption` 事件，并断言 [audio/playback.md §5](../audio/playback.md#5-打断焦点与路由) 的整张表，包括"绝不继续用扬声器"。真实事件靠真机冒烟 | ✅ + 真机 |
| 6 | 队列与进度跨重启恢复，且不自动播放 | 集成测试对着一份已填充的 `playback_state` 启动 Context，然后断言队列已恢复、`positionMs` 相符、`status !== 'playing'` | ✅ |
| 7 | *（MD-5）* 无缝衔接的边界听不出；队列变化取消预取 | 单元：下一源在当前源结束前排入队列，且没有第二次 `AudioContext` 调度；队列变化时预取的 `AbortSignal` 触发。可听性是真机矩阵里的听感测试 | 部分 |

---

## 7. 夹具与测试架

在阶段 1 一次性建好，因为之后每个阶段都靠它们。

- **`tooling-fixtures`**（仅开发用，不发布、不打包）。生成 5,000 个文件的语料：带标签、内嵌封面、ReplayGain 值，以及贴近真实的专辑/艺人分布。它还产出真实曲库里必然会出现的病态用例 —— 完全没有标签、截断的文件头、零字节文件、文件名里的 unicode 与 emoji、扩展名谎报编码的文件，以及一首超长曲目 —— 于是扫描器的错误路径默认就会被压到，而不是靠运气。

  ⚠️ **这些文件是逐字节写出来的，而不是编码出来的。** 真实 MPEG-1 Layer III 帧上的合法 ID3v2.4 标签，以及一条真实的 FLAC 元数据链；`music-metadata` 读这两者，与读一张 CD 抓轨一模一样。派生给外部编码器是显而易见的替代方案，而在两个要紧的方面都更糟：五千次进程孵化要几分钟而不是几秒，而且它让扫描这条标准取决于碰巧装了什么 —— 在一台机器上绿、在另一台上悄无声息地缺席。放弃掉的是可解码的音频，扫描器里没有任何东西需要它；还有 `m4a`/`opus` 覆盖，那是 `codecConformance` 的职责、不是这份语料的。

  病态文件里有两个当即证明了自己：一个零字节的 `.mp3` 和一个顶着 `.mp3` 名字的 JPEG 曾被*导入* —— `core-codec-node` 把扩展名的 MIME 类型递给解析器，解析器信了它，报出 `{ codec: 'mp3' }`、背后却没有字节，于是扫描器写出了以文件命名的幽灵曲目。这比 §4.7 允许的两种诚实结果中的哪一种都更糟。它现在从内容嗅探容器，这顺带把另一个方向上"实为 FLAC 的 `.mp3`"的情形也修了。
- **带插桩的 `ctx.fs`** —— 按方法统计调用数，供标准 1 与扫描器自身的测试使用。它对服务**实例**就地打补丁，而不是用新对象包一层：一个实例被每条 fiber 共享，而每条 fiber 经由各自 scoped 的 `Context` 到达它，所以装在根上下文上的包装器会被每个插件绕过、报出一个令人安心的零。就地打补丁正是让计数既覆盖扫描器、也覆盖经它读标签的 codec 的原因 —— 标准真正关心的正是这一对。
- **mock `AudioService`** —— 时钟可控、`onEnded`、停顿与中断皆可控的确定性假件，因此 `plugin-player` 的测试从不触碰真实音频。从 `@BBeBee/protocol/conformance` 导出，供播放器的测试与未来的任何引擎使用。
- **按字节服务的 fixture**，供 §4.5 使用 —— 一个本地服务器，支持 `Range`、可加延迟、可按需在响应中途停顿。`httpConformance` 对着它而不是对着 mock 运行，而停顿路由当即抓到了一个真 bug：`core-http-node` 在一个*响应头*到达时就运行的 `finally` 里解除了调用方 `AbortSignal` 的挂接，于是中止一个已经开始流式传输的请求毫无作用 —— 而这正是唯一要紧的情形，因为 MD-5 的预取正是在队列变化时于下载中途被取消的。
- **不是假件的桩** —— `test/stubs/` 把 `expo-sqlite` 别名到 `node:sqlite`、把 `expo-file-system` 别名到 `node:fs`，并把 `react-native-audio-api` 别名到一个对任何真正原生之物都抛错的表面。前两个的存在，是为了让 `ctx.db` 与 `ctx.fs` 的*第二份*实现在 CI 里、与第一份跑同一套契约套件，而不是只在一台没人凑得着的真机上跑。⚠️ 它们复现的是平台的**拒绝**，而不只是它的成功：`File.move` 在这里抛"目标已存在"，与它在手机上抛的一模一样。一个会悄悄覆盖的桩能让适配器通过套件、却仍在真实世界里失败，那正是桩最容易引入的失败模式。

- **真机冒烟矩阵** —— 一台 iOS 设备、一台刻意选的低配 Android 设备，以及每个桌面 OS 一台机器。核查清单是 [audio/playback.md §7](../audio/playback.md#7-测试音频) 的那一份，外加 MD-5 的无缝衔接边界。随每次发布运行，坦率地靠人工；假装能自动化只会得不偿失。

有一项测量即使眼下还没有任何东西依赖它，也值得在 M1 期间做一次：**边播放边扫描一个 5,000 文件的曲库**，盯住单一 SQLite 数据库上的写入争用。这是对 [10](./roadmap.md#-sqlite-作为唯一存储) 那条风险最便宜的探针，而且只花一次运行的成本。

**已做** —— `plugin-local-scanner/src/corpus.test.ts`，对着一个以文件为后盾的数据库而不是 `:memory:`，因为 WAL、锁与 busy timeout 才是被测的东西，而内存数据库的并发故事与随包发布的那份不同。播放器做检查点时没有任何保存节流，这已经是它写得最狠的时候。

> `[contention] 5011 files: 18162ms quiet, 19416ms while playing (1.07×), 2795 checkpoints landed`
> `[contention] 5011 files: 24746ms quiet, 27880ms while playing (1.13×), 3806 checkpoints landed`

**争用在这个规模上不是问题。** 播放曲目时扫描要多花 7–13% —— 第二行是同一探针在完整 `pnpm test` 期间的结果，那才是更诚实的数字。成千次检查点落在扫描*进行之中*而不是排在它身后；没有一次写入被拒绝，播放器到最后仍在播放。测试断言的是那些结果 —— 一次抵达调用方的 `SQLITE_BUSY`、一个被饿死的检查点、一个被逼进 `error` 的播放器 —— 而不是时间，因为在共享 CI 硬件上设阈值就是制造 flake。比值打印出来是给人读的，探针的本分就在于此。

- **外壳接线检查** —— `packages/kernel/src/bootstrap/shells.test.ts`。读每个外壳的允许清单、其生成的注册表与各清单文件，并断言每个被配置的插件都被打包、每个被配置插件*需要*的服务由引导数组或另一个被配置插件提供，以及两个外壳运行同一套功能集。

  ⚠️ 它存在，是因为它的缺席让一个里程碑付了账。每个 M1 包都建成且全绿，而桌面外壳里 `plugin-player` 还被注释着 —— `ctx.audio` 不在任何引导数组里 —— 移动外壳仍在跑 M0 那一套：四个核心服务加演示插件。这两种状态从包内部不可见，从包外部也几乎不可见：一条在等一个永远不会来的服务的 fiber，看上去与一条只是慢的 fiber 一模一样。同一检查的运行时那一半是每个 `boot()` 里的 `await app.ready(BOOTSTRAP_SERVICES)`，它把缺失的服务变成一条点名道姓的启动错误。

---

## 8. M1 特有的风险

[10](./roadmap.md#风险登记册) 的登记表面向整个项目；这里面向本里程碑：每一条都有一个足够早、来得及应对的信号。

| 风险 | 早期信号 | 应对 |
|---|---|---|
| `react-native-audio-api` 在某个目标上无法流式、无法 seek、无法无缝交接 | 阶段 0，在任何包落笔之前 | 改用 `core-audio-rntp` 回退；M4 变成桌面专属；显式重划里程碑范围（§3.1） |
| Android SAF 的 `content://` URI 无法交给解码器 | 在 Android 上首次扫描用户挑选的文件夹 | `ctx.fs.toPlayableUri` 逐文件复制进缓存目录，代价是磁盘。泄漏已在 [services/overview.md §1](../services/overview.md#1-ctxfs--虚拟文件系统) 记录 —— M1 就是付账的地方 |
| 移动端没有 `ctx.fs.watch`，曲库会过期 | 现在已知 | 经 `ctx.background.schedule` 轮询，并在 UI 里如实说明，而不是暗示实时更新 |
| Hermes 在 RN 0.86 上缺 `ReadableStream` | 阶段 1，第一次流式读取 | 移动端入口引入 `web-streams-polyfill`（[services/contracts.md §17](../services/contracts.md#17-运行时兼容性清单)） |
| `expo-sqlite` 附带的 SQLite < 3.43，`contentless_delete=1` 不可用 | 核心迁移在真机首次启动时失败 | 在迁移里断言 SQLite 版本并大声失败；在 SDK 追上之前回退为带 ⚠️ 标注的 `LIKE` 搜索 |
| Android 14+ 的前台服务政策拒绝媒体服务 | 在较新设备上第一次后台播放 | 声明 `mediaPlayback` 服务类型及其权限；在阶段 1 的 dev 构建里验证，而不是拖到阶段 4 |
| 扫描与播放争用同一个 SQLite 写入者 | §7 的那项测量 | **已测量，且没有争用。** 5,000 文件、播放器检查点不节流时为 1.07×，没有一次写入被拒、没有一个检查点被饿。扫描写入成批，这也是主要原因。若它哪天真咬人，[10](./roadmap.md#-sqlite-作为唯一存储) 描述的易变表拆分仍然可用，且任何查询都不跨那条边界做 join |
| 两套组件库从第一块屏幕起就漂移 | 一致性测试，前提是它先于屏幕落地 | 在阶段 4 开工前冻结组件集；分歧是 CI 失败，不是评审意见 |

---

## 9. 完成的定义

当以下全部为真时，M1 才算完成 —— 而不是"应用能放音乐了"，那会稍早一些到来，而且不是同一回事。

- [ ] §6 的每一条完成标准都有绿色核查，或一次签收过的真机运行。
      **未完成项：只剩真机运行。** §6 里每一个自动化栏位都全绿；标准 3、4、5、7 各留着一半人工的活，没有任何测试架能诚实地替它顶上。
- [x] `fs`、`db`、`store`、`paths`、**`codec`**、**`audio`**、**`http`（M1 切片）** 与 **`mediaSession`** 的契约套件对每一份实现全绿，Expo 系的在真机上跑。⚠️ 三个 Expo 实现结果上并不需要真机就能被覆盖：`core-media-session-rn` 注入其原生表面来跑套件；`core-db-expo` 把 `expo-sqlite` 别名到 `node:sqlite`、背后是同一 API，跑 `db` *和* `db-scope`；`core-fs-expo` 把 `expo-file-system` 别名到 `node:fs`、背后是 SDK 54+ 的 `File`/`Directory`/`Paths` 表面，跑 `paths`、`fs` 与 `fs-scope`。真语句、真文件、真闸门。

      **这不是一次优化。** `fs` 套件早已存在、且只对一份实现运行，而 [10](./roadmap.md#-抽象泄漏的速度快过修补的速度) 恰好把这个缺口点名为一条风险、其首要防线就是这套件。它泄漏了：Expo 的 `File.move` 拒绝已存在的目标，而 `rename(2)` 是替换它，于是代码库里每一次"先写临时再移动"都从真机的*第二次*启动起开始失败 —— `ctx.store` 什么也没能持久化 —— 而 CI 却一直是绿的，因为那唯一的 `move` 用例只往一条崭新的路径上移动。两半都修了：适配器清掉目标，套件则添上"move 替换已存在的目标"及其 `copy` 孪生用例。

      留在真机上的，是真正属于设备的那些东西：SDK 的 SQLite *构建*（因此也有 `contentless_delete=1`）、SAF 的 `content://` 树、目录选择器、解码器，以及锁屏画不画得出来。
- [x] 每个新插件通过泄漏测试，且在播放中途禁用再启用 `plugin-player` 后，`ctx.inspector` 显示一棵干净的树。⚠️ 写*重新启用*那一半时，抓到了它本要抓的 bug：`ctx.mediaSession.clear()` 只从 `stop()` 里运行，而禁用并不经过 `stop()` —— 于是被禁用的播放器留下一块锁屏，显示着一首并未在播的曲目，按钮也再不管用了。teardown 现在把 OS 表面一并撤下。
- [x] `pnpm check` 全绿；`pnpm gen:plugins` 不产生任何差异。
- [x] `db-scope` 套件在两份 `ctx.db` 实现上都覆盖了 MD-4，且没有任何插件持有自己用不到的能力。⚠️ 后一半如今是一道检查而非一种习惯（`conventions.test.ts`）：每条声明的能力都经闸门自己的 `servicesForCapability` 映射，且该包必须真的够得着那个服务。它首次运行就抓到三个超额授权 —— `core-device-electron` 请求 `shell`、`core-http-rn` 请求一个它没有 `download()` 可用的 `fs:write:downloads`（MD-1）、M0 演示插件请求 `secrets:own` —— 三个现均已移除。这在 M5 里最要紧，那时安装时提示会逐字读出清单：一个请求自己从不触碰之物的插件，是在教用户无脑点同意。
- [x] `@BBeBee/protocol` 仍然零运行时依赖，且 `core-*` 之外没有任何包导入平台 SDK —— 两者都有机械检查（[workflow/structure.md §3](../workflow/structure.md#3-依赖规则)）。同一份配置如今还钉住另外两条层界：Layer 2 之上的任何东西不导入内核的引导表面、也不导入任何 `core-*` 包；内核则两者都不导入（[architecture/layers.md §1](../architecture/layers.md#不变量)）。
- [ ] 真机冒烟矩阵已运行并记录在案，包括无缝衔接的听感测试。
      **唯一真正未完成的条目。** 它诚实地靠人工（§7），它覆盖的一切要么是 OS 画出的一个表面、要么是一个人必须亲耳听到的声音。
- [x] 文档与代码同一个 PR 更新：[plugins/capabilities.md §7](../plugins/capabilities.md#能力语法) 的语法行，以及 [09](../workflow/structure.md) 的 ✅ 标记与版本矩阵。
- [ ] 阶段 0 对 ADR-4 的裁决 —— 无论结果如何 —— 写回 [10](./roadmap.md#-react-native-audio-api-尚未到-10)。
      **还不能写，而把这一点说出来正是要义**：试石需要一台 iOS 真机、一台 Android 真机与一台 Electron 机器，哪一台都还没跑过它，所以裁决仍是一个假设，[roadmap.md](./roadmap.md) 也把它记录为假设。照 Node 套件写出的裁决，等于在放决策的位置上记下一笔猜测。

### M1 明知而留破的地方

值得写明，免得有人把这些报成 bug：不能下载任何东西，且下载替换路径没有监听者；均衡器不存在，它要加入的链也不存在；没有播放列表、评分与歌词；桌面端没有键盘快捷键、右键菜单与命令面板；没有任何东西能在运行时安装；两个 app 都没有安装器。

过去在这份清单上的两条消失了，因为 M2 的运行时在 M1 的外壳接线完毕之前就超过了 MD-7 切片：音源字符串**可以**导入了，也**有**办法登录了。取而代之的是两条，而且都是关于移动端、而不是关于范围的：

- **长的远程曲目在移动端不能流式播放。** `load({ strategy: 'stream' })` 需要 `HTMLMediaElement`，而 React Native 没有它，所以引擎宁可拒绝也不装样子。本地文件与短的远程文件走缓冲、不受影响。出路是 `StreamerNode`，而那是真机工作。
- **脚本化的音源文档在移动端什么也不做。** `core-js-quickjs-expo` 不存在 —— Hermes 没有 WebAssembly，所以它需要一个原生模块与一次 dev client 重建。运行时把受影响的能力上报为缺席，而不是递上一个按了也没用的按钮，这正是设计好的降级（[roadmap.md §M2](./roadmap.md#m2--音源即字符串)）。

---

## 10. 下一步去哪里

[roadmap.md §M2](./roadmap.md#m2--音源即字符串) 是 [ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释) 从假设变成实物的地方：规则语言、沙箱、导入与导出、tracer，全部对着一个真正需要它们的后端。M1 推迟的一切凭据相关的东西 —— `ctx.secrets`、持久化 cookie 罐、`ctx.http` 的认证半边、`source/auth-expired` —— 都在同一个里程碑到来，因为一个真实的音源需要登录。
