# BBeBee —— 架构文档

BBeBee 是一款跨平台音乐播放器，面向桌面端（Electron）与移动端（Expo / React Native），它被构建为一个**插件平台**，而不是一个"外挂了扩展 API 的应用"。其内核是 [Cordis](https://github.com/cordiverse/cordis) —— 一个依赖注入与插件生命周期框架 —— 而*内核之上的一切都是插件*，包括文件 I/O、网络与持久化。平台差异通过"换装哪一份核心服务实现"来吸收，而不是在功能代码内部写条件分支。

**音源不是插件。** 源（source）是一份由用户以文本形式导入的 JSON 文档 —— 即把 [legado](https://github.com/gedoor/legado) 的书源模式套用到音频上 —— 由唯一一个内置运行时解释，并被沙箱化在它自己的 JS realm 之中。添加一个后端是一次粘贴，而不是一次发版（[ADR-5](./architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释)、[sources/spec.md](./sources/spec.md)）。

> **状态说明。** 这些文档描述的是一个设计，而非已交付的系统。目前 M0（内核在两个平台上运行）与 M1（能播放音乐）已经构建完成；M2（音源即字符串）也已构建，仅剩 `core-js-quickjs-expo`（移动端沙箱需要原生 QuickJS 模块）与 `@css:`/`@xpath:` 两个规则引擎尚未落地——细节与完成标准见 [路线图与风险](./roadmap/roadmap.md)。文中每一个版本号与 API 事实都在写作时对照已发布的包逐一核实过（版本锁定矩阵见 [workflow/build-pipelines.md](./workflow/build-pipelines.md)）。

---

## 快速上手

```bash
pnpm install     # pnpm 11+, Node 22.12+
pnpm check       # typecheck + lint + test — green on a clean checkout
pnpm dev:desktop # Electron, with HMR across main, preload and renderer
```

> **构建规则。** 桌面端携带一个 native 音频引擎二进制（libmpv 后端），`dev` 不会自动构建它；
> libmpv 运行时依赖有明确的查找顺序与降级矩阵——完整构建规则见根目录 [README.md](../README.md)。

`pnpm check` 是那道闸门；它通过，CI 就通过。完整的命令清单、插件脚手架、每道门各自能抓住什么，以及排障表，见 [workflow/testing.md §7 —— 开发工作流](./workflow/testing.md#7-开发工作流)。

> 移动端需要**自定义 dev 构建**，不能用 Expo Go —— 若干依赖含原生代码。
> 见 [workflow/testing.md §7](./workflow/testing.md#运行应用)。

---

## 模块化文档主题地图

全套架构文档按专业领域划分为 9 大主题目录：

| 主题分类 | 文档路径 | 核心内容 |
|---|---|---|
| **核心架构** | [architecture/overview.md](./architecture/overview.md) | 项目愿景、边界界定与五大 ADR 关键技术决策 |
| | [architecture/layers.md](./architecture/layers.md) | 六层架构模型、跨端运行时模型（Electron/Hermes）与启动时序 |
| **插件系统** | [plugins/concepts.md](./plugins/concepts.md) | 插件定义形态、元数据字段、Fiber 生命周期与依赖注入 |
| | [plugins/isolation.md](./plugins/isolation.md) | 核心服务访问、析构清理捕获、`ctx.isolate` 隔离与 `ctx.intercept` 拦截 |
| | [plugins/loading.md](./plugins/loading.md) | 动态按需加载机制 (`load: () => import(...)`)、清单格式与注册表 |
| | [plugins/capabilities.md](./plugins/capabilities.md) | 能力门控语法、授权执行机制、默认拒绝策略与插件开发自查清单 |
| **核心能力服务** | [services/overview.md](./services/overview.md) | 核心服务设计理念、平台抽象规范、不透明 `Uri` 与虚拟文件系统 |
| | [services/contracts.md](./services/contracts.md) | 核心服务契约总表 (`http`, `ws`, `store`, `db`, `secrets`, `device` 等) |
| | [services/logging.md](./services/logging.md) | Layer 3 日志传输架构 (`ctx.logger`、环形缓冲池、控制台输出、文件滚动) |
| **音频与播放** | [audio/engine.md](./audio/engine.md) | `ctx.audio` Web Audio 音频引擎、音频图拓扑结构与跨端原生桥接 |
| | [audio/playback.md](./audio/playback.md) | `ctx.player` 播放控制状态机、流解析流水线、无缝切换与系统集成 |
| | [audio/dsp.md](./audio/dsp.md) | `ctx.dsp` 效果链组装机制与内置音频处理器（EQ、压缩器、混响） |
| **音源系统** | [sources/spec.md](./sources/spec.md) | Legado 音频化模型、音源 JSON 文档字段规范与隐式能力推导 |
| | [sources/rule-engines.md](./sources/rule-engines.md) | 六大规则引擎语法（`@json`, `@css`, `@xpath`, `@js`, 正则, 模板）与组合器 |
| | [sources/runtime.md](./sources/runtime.md) | 解析运行时生命周期、Cookie 与会话持久化、流解析与 QuickJS 沙箱隔离 |
| | [sources/authoring.md](./sources/authoring.md) | 双文件开发工作流、编译器工具链、故障诊断与本地媒体文件扫描器 |
| | [sources/registry.md](./sources/registry.md) | B_Be_Bee-registry 内容注册表：索引格式、更新检查与安装流程 |
| **数据模型** | [data-model/urn.md](./data-model/urn.md) | 实体统一资源定位符 URN 语法规范 (`BBeBee:<sourceId>:<kind>:<id>`) 与跨源关联 |
| | [data-model/schema.md](./data-model/schema.md) | 实体关系图、SQLite 配置约定、完整数据表字典与运行时类型 |
| | [data-model/events.md](./data-model/events.md) | Waterfall 瀑布流钩子与 Cordis 全生命周期强类型事件映射表 |
| | [data-model/migrations.md](./data-model/migrations.md) | 前向命名空间化数据库迁移策略、事务安全与数据保留规范 |
| **UI 架构** | [ui/architecture.md](./ui/architecture.md) | 三包代码结构规范、Descriptor 描述符系统、React 服务绑定与多端外壳 |
| | [ui/design-system.md](./ui/design-system.md) | 深色流媒体视觉语言、无边框高度层级、设计 Token 字典与 WCAG AA 对比度 |
| **工程规范** | [workflow/structure.md](./workflow/structure.md) | Monorepo 目录布局、分层治理规则、Import 导入矩阵与 ESLint 架构守卫 |
| | [workflow/build-pipelines.md](./workflow/build-pipelines.md) | 构建流水线（`tsc`, `vite`, `electron-builder`, `expo`）与依赖版本矩阵 |
| | [workflow/testing.md](./workflow/testing.md) | 测试策略（单元、契约、Fiber 泄漏测试）与日常开发工作流命令 |
| **路线图** | [roadmap/roadmap.md](./roadmap/roadmap.md) | 里程碑阶段规划（M0 至 M5）验收准则、风险登记册与架构假设检验 |
| | [roadmap/archive-m1.md](./roadmap/archive-m1.md) | M1 阶段执行计划历史档案与验收验证记录 |

---

## 历史章节映射表 (Legacy Section Mapping Table)

代码注释或历史提交中引用了 `docs/01` 至 `docs/11` 时，请通过下表直接查阅重构后的模块化文档：

| 历史引用编号 | 原章节 | 重构后模块化文档路径 |
|---|---|---|
| `docs/01-overview.md` (`docs/01`) | 全部 | [`architecture/overview.md`](./architecture/overview.md) |
| `docs/02-architecture.md` (`docs/02`) | 全部 | [`architecture/layers.md`](./architecture/layers.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §1 – §3（插件概念、生命周期、依赖注入） | [`plugins/concepts.md`](./plugins/concepts.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §4 – §5（服务使用、隔离与拦截） | [`plugins/isolation.md`](./plugins/isolation.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §6（静态与动态加载机制、清单、配置） | [`plugins/loading.md`](./plugins/loading.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §7 – §9（能力门控、安全模型、自查清单） | [`plugins/capabilities.md`](./plugins/capabilities.md) |
| `docs/04-core-services.md` (`docs/04`) | §0 – §1（服务设计理念、共享类型、`ctx.fs`） | [`services/overview.md`](./services/overview.md) |
| `docs/04-core-services.md` (`docs/04`) | §2 – §15, §17 – §20（核心服务契约、兼容性、`ctx.js`） | [`services/contracts.md`](./services/contracts.md) |
| `docs/04-core-services.md` (`docs/04`) | §16（`ctx.logger` 日志传输、环形缓冲区、滚动日志） | [`services/logging.md`](./services/logging.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §1（`ctx.audio` Web Audio 音频引擎） | [`audio/engine.md`](./audio/engine.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §2, §4 – §8（`ctx.player` 传输控制、队列、系统集成） | [`audio/playback.md`](./audio/playback.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §3（`ctx.dsp` 效果链与内置 DSP 处理器） | [`audio/dsp.md`](./audio/dsp.md) |
| `docs/06-music-sources.md` (`docs/06`) | §1 – §2（音源模型、顶层字段、规则块规范） | [`sources/spec.md`](./sources/spec.md) |
| `docs/06-music-sources.md` (`docs/06`) | §3（规则语言语法、6 大引擎、组合器） | [`sources/rule-engines.md`](./sources/rule-engines.md) |
| `docs/06-music-sources.md` (`docs/06`) | §4 – §6, §8（生命周期、会话、流解析、QuickJS 沙箱） | [`sources/runtime.md`](./sources/runtime.md) |
| `docs/06-music-sources.md` (`docs/06`) | §7, §9 – §14（双文件开发流、错误诊断、本地扫描器） | [`sources/authoring.md`](./sources/authoring.md) |
| `docs/07-data-model.md` (`docs/07`) | §1（URN 标识符语法与身份关联） | [`data-model/urn.md`](./data-model/urn.md) |
| `docs/07-data-model.md` (`docs/07`) | §2 – §4, §7（实体关系、SQLite 规范、表字典、运行时类型） | [`data-model/schema.md`](./data-model/schema.md) |
| `docs/07-data-model.md` (`docs/07`) | §5（Waterfall 瀑布流钩子与强类型事件体系） | [`data-model/events.md`](./data-model/events.md) |
| `docs/07-data-model.md` (`docs/07`) | §6, §8（前向数据库迁移与版本演进策略） | [`data-model/migrations.md`](./data-model/migrations.md) |
| `docs/08-ui-architecture.md` (`docs/08`) | §1 – §5, §7 – §9（三包架构、描述符注册、双端外壳、无障碍） | [`ui/architecture.md`](./ui/architecture.md) |
| `docs/08-ui-architecture.md` (`docs/08`) | §6（暗色流媒体设计系统、设计 Token 与色彩排版规范） | [`ui/design-system.md`](./ui/design-system.md) |
| `docs/09-project-structure.md` (`docs/09`) | §1 – §3（Monorepo 目录分层、架构守卫规则） | [`workflow/structure.md`](./workflow/structure.md) |
| `docs/09-project-structure.md` (`docs/09`) | §4 – §5（构建流水线与依赖版本矩阵） | [`workflow/build-pipelines.md`](./workflow/build-pipelines.md) |
| `docs/09-project-structure.md` (`docs/09`) | §6 – §8（测试策略、Leak Test 与日常开发命令） | [`workflow/testing.md`](./workflow/testing.md) |
| `docs/10-roadmap.md` (`docs/10`) | 全部（里程碑规划与风险登记册） | [`roadmap/roadmap.md`](./roadmap/roadmap.md) |
| `docs/11-roadmap-M1.md` (`docs/11`) | 全部（M1 阶段执行计划与历史验收记录归档） | [`roadmap/archive-m1.md`](./roadmap/archive-m1.md) |

---

## 一段话版本

一个 Cordis `Context` 被创建在应用的唯一 JavaScript 运行时之中 —— 移动端是 Hermes，桌面端是 Electron 渲染进程。这个上下文就是 **Layer 1**，即内核。**Layer 2** 是一小撮认领服务键（`ctx.fs`、`ctx.http`、`ctx.db`、`ctx.js`……）的**核心插件**；它们是仓库中*唯一*允许导入平台 SDK 或驱动内核的代码，每个键在每个目标平台上各有一份实现。在它们之上是 **Layer 3**，三个订阅 `ctx.logger` 并决定一行日志最终落在哪里的日志传输（log transport）；再往上，**Layer 4** 的功能插件提供播放、DSP、下载、媒体库与音源，而 **Layer 5** —— 各外壳与视图包 —— 把这些变成页面。它们之中没有任何一方可以越过 Layer 2 直接触达平台，也没有任何一方可以越过 Layer 3 直写控制台。所有契约 —— 服务接口、实体类型与类型化事件表 —— 都位于 **Layer 0**，即那个不含运行时的单一包 `@BBeBee/protocol`，其余每一层都依赖它，它也正是让实现可以互换的那道接缝。功能之间通过 Cordis 的**瀑布（waterfall）钩子**组合，例如下载插件可以透明地把流 URL 替换成本地文件，而播放器根本不知道下载的存在。**音源位于这一切之外**：它们是被导入的文档，以行的形式存放，由 `plugin-source-runtime` 解释，并通过本地文件插件所实现的同一个提供方接口呈现给应用的其余部分 —— 因此 `ctx.sources` 之上的任何东西都分辨不出一首曲目来自哪里。

---

## 这些文档使用的约定

- **Layer 0–5** —— [architecture/layers.md §1](./architecture/layers.md#1-分层模型) 的六个层：协议、内核、核心插件、日志传输、功能插件、UI 与业务功能。全文以"Layer 2"这样的写法指称各层；决定一个包可以写哪些导入的，正是它所在的层。
- **服务键（service key）** —— 在上下文上认领的一个名字，例如 `ctx.player`。全文始终带 `ctx.` 前缀书写，以免与包名混淆。
- **包名** —— 始终使用全限定名，例如 `@BBeBee/plugin-download`。
- **源（source）** —— 用户所配置的一个音乐后端，由其 `sourceUrl` 标识，并通过一个派生的 **source id** 寻址。*源字符串（source string）*是它可导入的文本形式。
- **URN** —— 曲库实体的稳定标识符，例如 `BBeBee:music-example-org-35be9fe2:track:8f1a2c`。定义见 [data-model/urn.md](./data-model/urn.md)。
- TypeScript 代码块是**契约**，不是示意。它们应当能够通过编译。
- 以 `snake_case` 命名的表是 SQLite 表。以 `PascalCase` 命名的类型是 TypeScript 类型。
- ⚠️ 标记两个平台确实存在差异、抽象在此泄漏之处。这些点被有意指出，而不是藏起来。
