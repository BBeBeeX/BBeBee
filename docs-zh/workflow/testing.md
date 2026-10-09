# 测试策略、一致性规范与日常开发工作流

> **历史章节映射：** 原 `docs-zh/09-project-structure.md §6 – §8`。

## 6. 测试策略

四层测试，各自能捕获其他层无法捕获的问题。

| 层 | 工具 | 覆盖内容 |
|---|---|---|
| **单元** | Vitest | 纯逻辑：URN 解析、分数索引（fractional indexing）、智能播放列表编译、针对 mock `AudioService` 的播放控制状态机 |
| **契约** | Vitest（Node）+ Detox（真机） | 以 `@BBeBee/protocol/conformance` 中的共享套件测试每一个 `core-*` 实现（[services/contracts.md §18](../services/contracts.md)）。**最重要的一层** |
| **集成** | Vitest（内存中的 Context） | 真实的 Cordis Context、真实的功能插件、伪造的核心服务。覆盖插件加载顺序、瀑布（waterfall）钩子组合与卸载完整性 |
| **音源语料库** | Vitest，响应内联录制在测试里 | `fixtures/sources/` 中的每一份示例文档都被端到端回放 —— 搜索、浏览、专辑、流 —— 因此任何破坏真实文档的规则引擎改动都会让 CI 失败。`pnpm source:record`（用于把这些响应移入 fixture 文件）是计划中的，尚未建成 |
| **真机冒烟** | 人工，随每次发布 | 锁屏、蓝牙、拔出耳机、来电、无缝播放边界、后台存活（[audio/engine.md](../audio/engine.md)） |

有两项测试值得几乎先于一切编写，因为它们把架构的核心主张固化成了代码：

```ts
// Claim: unload is total. ([plugins/concepts.md §2](../plugins/concepts.md))
it('leaves nothing behind when disabled', async () => {
  const before = snapshotContext(ctx)         // listeners, timers, services, effects
  const fiber = await ctx.plugin(SomePlugin, config)
  await fiber.dispose()
  expect(diffSnapshots(before, snapshotContext(ctx))).toBeUndefined()
})

// Claim: the player does not know downloads exist. ([architecture/layers.md](../architecture/layers.md), [audio/playback.md](../audio/playback.md))
it('plays the same track with and without plugin-download', async () => {
  const withoutDl = await resolveVia(ctxWithout, urn)
  const withDl    = await resolveVia(ctxWith, urn)
  expect(withoutDl.kind).toBe('remote')
  expect(withDl.kind).toBe('local')
  expect(playerBehaviour(withoutDl)).toEqual(playerBehaviour(withDl))
})
```

第一项以参数化方式对工作区中的**每一个**插件运行。任何有泄漏的插件都会让 CI 直接失败。

一旦音源存在，第三个测试就该与它们并列，因为它是整个字符串模型所立足的主张：

```ts
// Claim: a source is data, and the runtime is the only interpreter. ([sources/spec.md](../sources/spec.md))
it('plays from a document nobody compiled', async () => {
  await ctx.sources.import(await readFixture('subsonic.json'))
  const hit = await ctx.sources.searchAll({ text: 'radiohead' })
  const handle = await ctx.sources.forUrn(firstUrn(hit))!.resolveStream(id, prefs)
  expect(handle.target).toMatch(/^https:\/\/music\.example\.org\/rest\/stream/)
})
```

语料库套件是最容易在无人照料时腐坏的一个：录制的 fixture 会渐渐偏离活的后端，而"语料库全绿、真实音源却坏了"正是要盯住的那种失败模式。作为制衡，`check` 命令（[sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源)）要针对活的服务器、由人工、随每次发布运行 —— 与真机冒烟矩阵同一形态，并且出于同样的理由，诚实地保持人工。

---

## 7. 开发工作流

### 首次运行

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — should be green on a clean checkout
```

`pnpm check` 是整道闸门。它通过，CI 就通过。推送之前先跑它；本节其余内容在出问题之前都并非必读。

### 日常命令

| 命令 | 作用 |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`。提 PR 前的那一条命令 |
| `pnpm check:changed` | 对当前改动影响的包执行 `typecheck` + `lint` + `test` |
| `pnpm test` | Vitest 对所有包跑一遍 |
| `pnpm test:watch` | Vitest 监视模式 —— 干活时让它一直开着 |
| `pnpm typecheck` | 每个包**及两个 app** 都跑 `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint，含 [structure.md §3](./structure.md#3-依赖规则) 的架构规则 |
| `pnpm build` | 为每个包产出 `dist/` |
| `pnpm clean` | 移除 `dist/`、`out/` 与构建信息 |

按路径跑单个包的测试 —— `pnpm test packages/core/core-fs-node` —— 或单个文件。

### 为什么闸门很快（以及各级缓存是什么）

闸门是只读工作 —— `check` 运行的任何任务都不消耗其他任务的产物 —— 因此其各个组成部分被设计为独立、并行并带缓存，而非单条串行链路：

- **`pnpm typecheck` 无序并发运行，宽度为 8 个 worker。** `tsc --noEmit` 从*源码*解析导入（exports 按设计直接指向 `src/index.ts` —— [build-pipelines.md §4](./build-pipelines.md#4-构建流水线)）且除了自身的 `.tsbuildinfo` 外不产出任何内容，因此没有包需要等待另一个包：`.npmrc` 设置了 `workspace-concurrency=8`，根脚本传递了 `--no-sort`。`pnpm build` 则保留拓扑排序，因为输出实际需要它。
- **tsconfig.base.json 中的 `incremental: true`。** 每个包的类型检查与构建都保留独立的 `.tsbuildinfo`（以生成它的 tsconfig 命名，因此两者从不共用一份），git 忽略并通过 `pnpm clean` 清理。这对单包开发尤为关键：类型检查 `plugin-player` 会重读 86 个工作区文件 —— 其中 55 个来自 protocol —— 因为导入解析到源码，若无此缓存，单包改动在下一次运行时仍需重新承担整个上游依赖图的开销。
- **`pnpm lint` 按内容缓存**，存放在 `node_modules/.cache/eslint/`。采用内容哈希策略而非修改时间 mtime，因此全新克隆或 CI 检出在恢复缓存后仍能享受热运行。
- **CI 将闸门拆分为并行作业**（[.github/workflows/ci.yml](../../.github/workflows/ci.yml)）：lint、typecheck、codegen 时效性检查，以及通过 `--shard` 拆分为四个切片的测试套件，每个切片各自为一道独立的 pass/fail 闸门。工作流会恢复上述缓存（以 ESLint 配置和分支最近保存的 `.tsbuildinfo` 文件为键）——tsc 会重新哈希每个输入，并在哈希不符时回退到全量检查，因此过期的缓存恢复最多只会损耗时间，绝不会放过损坏的文件。

### 运行应用

| 命令 | 作用 | 需要什么 |
|---|---|---|
| `pnpm dev:desktop` | `electron-vite dev` —— main、preload 与 renderer 三处 HMR | Electron 二进制（由 `pnpm install` 抓取；首次安装需要网络） |
| `pnpm build:desktop` | 产出生产包到 `apps/desktop/out/` | — |
| `pnpm dev:mobile` | `expo start --dev-client` | 设备或模拟器上的**自定义 dev 构建** —— 见下 |

> ⚠️ **移动端需要自定义 dev 构建，不能用 Expo Go。** `react-native-audio-api`、`expo-sqlite` 与 `expo-file-system` 都含原生代码，Expo Go 无法承载本应用。每变更一次原生依赖就构建一次 dev client（`pnpm --filter @BBeBee/mobile exec expo run:android`），之后 `pnpm dev:mobile` 会附着到它。

> 💡 **桌面端应用打包：** `pnpm package:desktop` 打包出免安装应用程序文件夹，而 `pnpm dist:desktop` 则使用 `electron-builder`（`apps/desktop/electron-builder.yml`）生成平台安装包（dmg / nsis / AppImage）。移动端独立打包采用 EAS build。

### 新增插件

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install                 # link the new workspace package
pnpm gen:plugins             # add it to both shells' static registries
pnpm check                   # already green — the template ships passing tests
```

| 标志 | 取值 | 效果 |
|---|---|---|
| `--name` | 小写、连字符分隔 | `scrobble` → `@BBeBee/plugin-scrobble` |
| `--kind` | `feature`（默认）、`effect` | 决定包前缀。没有 `source` 这个种类：一个音乐后端是文档，不是包 |
| `--ui` | `none`（默认）、`desktop`、`mobile`、`both` | 生成 [ui/architecture.md §1](../ui/architecture.md#1-三包约定) 所述的按目标视图包 |
| `--capabilities` | 逗号分隔 | 写入 `BBeBee.plugin.json`（[plugins/capabilities.md §7](../plugins/capabilities.md#7-能力模型)） |

无 UI 包落在 `packages/feature/`，其视图落在 `packages/ui/`（[structure.md §1](./structure.md#1-仓库布局)）。这个落位是脚手架最举足轻重的产物：lint 规则认层目录，所以写错目录的包会被错误的规则悄无声息地治理。`tooling-create-plugin` 自己的测试断言了这个拆分。

脚手架并非可有可无的点缀。三包约定、清单格式、能力列表、泄漏测试都要接对，手工搭一个插件意味着总会在其中一环出错 —— 而且往往是*无声*失败的那一环。模板自带正确的 `await ctx.plugin(...)` 形态与泄漏测试，这两样若靠踩坑领悟，各要付出一整个调试会话的代价。

### 添加与开发音源

- **面向最终用户**：在应用内 **设置 → 音源 → 导入**，粘贴字符串，查看它声明自己会做什么，确认（[sources/authoring.md §9](../sources/authoring.md#9-导入更新与分享)）。无需安装、无需重新构建、无需重启。
- **面向音源作者与开发者**：
  为避免在一个巨大单行 JSON 字符串中调试复杂 JavaScript 代码，音源以双文件架构（`source.json` + `source.js`）开发于注册表仓库（[B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry)），本仓库以钉定版本的 `registry/` submodule 消费它（[sources/registry.md](../sources/registry.md)）：音源在 `registry/music-sources/<id>/`，歌词源在 `registry/lyric-sources/<id>/`。

| 命令 | 作用 |
|---|---|
| `pnpm build:sources` | 校验并将 submodule 的 `registry/music-sources/` 与 `registry/lyric-sources/` 编译输出为 `fixtures/sources/<id>.json` 与 `fixtures/lyric-sources/<id>.json` 单文件文档 |
| `pnpm watch:sources` | 监听两个注册表目录中的文件变动，自动即时热重编 |
| `pnpm build:sources --sources <dir>` | 旧用法：编译单个混合目录，按文档形态分流 |
| `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]` | 将现有的单文件 JSON 反向解包为 `source.json` + `source.js` 双文件开发结构 |

有两个命令是**计划中的**（M2 收尾；用于在线测试后端），用于维护本仓库随附在 `fixtures/sources/` 中的*文档*：

| 命令（计划中） | 将来的作用 |
|---|---|
| `pnpm source:check <file>` | 针对 live 后端运行 [sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源) 的健康检查并打印追踪。需要网络；对需要认证的音源，还需要环境里备好凭据 |
| `pnpm source:record <file>` | 回放同样的步骤，并写出语料库套件（[§6](#6-测试策略)）离线回放所用的 HTTP fixture |

**新增或移除插件之后，运行 `pnpm gen:plugins`。** Metro 无法解析运行期路径，因此两个外壳读取的都是一份生成的静态导入注册表（[build-pipelines.md §4](./build-pipelines.md#4-构建流水线)）。产物随仓库提交；CI 校验其是否为最新，而不是重新生成。

### 各道门各自能抓住什么

值得了解，因为这里的失败通常意味着架构层面的错误，而不是拼写错误：

| 门 | 能抓住的问题 |
|---|---|
| `no-restricted-imports` | 插件伸手去够平台 SDK，而不是 `ctx.*` 服务（[architecture/layers.md §1](../architecture/layers.md#不变量)） |
| 契约测试套件 | 同一服务的两份实现渐行渐远 —— 这正是套件存在的理由 |
| `*-scope` 套件 | 能力门在某一平台成立、在另一平台失效 |
| 泄漏测试（`diffSnapshots`） | 卸载不干净的插件（[§6](#6-测试策略)） |
| `conventions.test.ts` | 未等待的 `ctx.plugin()`，会无声地使就绪状态无法传播 |

### 出问题时

| 症状 | 原因 |
|---|---|
| Metro：*无法解析 `cordis`* | `metro.config.js` 缺少 `unstable_enablePackageExports` —— Cordis 是纯 ESM，带 `exports` 映射（[services/contracts.md §17](../services/contracts.md#17-运行时兼容性清单)） |
| `@Inject` 运行时失败、编译却通过 | 用了旧式装饰器。Babel 需要 `{ version: '2023-11' }`；`tsconfig` 不得设置 `experimentalDecorators` |
| 插件永远停在 `pending` | 某个被注入的服务始终没有 ACTIVE。`ctx.inspector.render()` 会打印纤维树并注明每个 fiber 在等什么 |
| `app.start()` 已 resolve 但某个服务尚未就绪 | 某处有未等待的 `ctx.plugin()`。`pnpm test packages/kernel` 会点名文件 |
| `CapabilityError: … may not …` | manifest 缺少某项能力，或路径/表确实越界。要放宽的是 manifest，永远不要放宽门 |
| 来自音源的 `CapabilityError: host … not allowed` | 文档的规则触达了它未声明的主机。把它加进 `allowedHosts` 并重新导入，让用户看得见 ([sources/spec.md §8](../sources/spec.md#8-quickjs-沙箱环境)) |
| 音源不返回任何结果，也没有报错 | 某条规则在字段本可为空的地方什么都没匹配到。测试界面会展示后端实际返回了什么 ([sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源))；`check` 会赶在用户之前找到它 |
| 音源中出现 `JsTimeoutError` | 某个 `@js:` 块在死循环，或在等待一个永不 resolve 的请求。限制按每次求值计，不能按音源配置 ([services/contracts.md §19](../services/contracts.md)) |
| 渲染进程：*preload bridge 缺失* | 渲染进程加载时没有拿到 `preload/index.cjs` —— 重新构建，preload 必须是 CJS |
| Electron 在无头机器上无法启动 | 预期行为。它需要 `libgtk-3`、`libnss3` 与显示器；产物本身仍可构建 |

### 提 PR 前的本地检查清单

- [ ] `pnpm check` 全部通过。
- [ ] `pnpm gen:plugins` 不产生任何差异。
- [ ] 新插件通过 [§6](#6-测试策略) 的泄漏测试。
- [ ] 新的核心服务实现通过其契约测试套件 —— **以及它的 `*-scope` 套件，在该服务的每一份实现上**，而不只是你改动的那一份。
- [ ] 没有必须放宽 [structure.md §3](./structure.md#3-依赖规则) 规则才能允许的新导入。
- [ ] 若有依赖变动，版本矩阵已同步更新。
- [ ] 若规则引擎有改动，音源语料库（[§6](#6-测试策略)）全绿 —— 并且如果某个 fixture 不得不重新录制，在 PR 里说明原因，因为被悄悄重录的 fixture 会掩盖一次真实的行为变化。

---

## 8. 下一步

[路线图与里程碑](../roadmap/roadmap.md) 规定了构建的先后次序。
