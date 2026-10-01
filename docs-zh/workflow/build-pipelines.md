# 构建流水线、工具链与依赖版本矩阵

> **历史章节映射：** 原 `docs-zh/09-project-structure.md §4 – §5`。

## 4. 构建流水线

| 目标 | 打包器 | 入口 | 说明 |
|---|---|---|---|
| 移动端 | **Metro** | `apps/mobile/index.js` | 需要 `unstable_enablePackageExports` 以解析 Cordis 的 ESM `exports` 映射，并需要 `version: '2023-11'` 档位的 `@babel/plugin-proposal-decorators` |
| 桌面渲染进程 | **Vite** | `apps/desktop/renderer/index.html` | 开发时使用原生 ESM；严格 CSP，唯一的让步是 `'wasm-unsafe-eval'`，没有它 QuickJS 无法编译、启动直接失败 —— 它**不是** `'unsafe-eval'`，因此没有任何外来的*JavaScript* 被加载 (02 §2)。由 `renderer/csp.test.ts` 钉死 |
| 桌面主进程 + preload | **electron-vite** | `apps/desktop/main/index.ts` | CJS 输出；原生依赖外部化 |
| 各包 | **tsup**（`protocol` 用 `tsc`） | 各包的 `src/index.ts` | 仅 ESM；`protocol` 只产出类型 |
| QuickJS WASM | 内嵌进 bundle | `core-js-quickjs-node` | 经 `quickjs-emscripten-core` 使用**单文件**变体（`@jitl/quickjs-singlefile-browser-release-sync`），于是引擎就是某个 JS chunk 里的字节，绝不被获取 —— 一个要自己下载引擎的沙箱算不上沙箱 (04 §19)。`getQuickJS()` 的存在就是为了否定这个东西：它选的是启动时才去获取的独立 `.wasm` 变体 —— 开发时由 Vite 提供 `index.html`，打包后则被 `file://` 渲染进程直接拒绝 —— 还会把全部四个变体（约 4 MB）拖进构建 |

```jsonc
// metro.config.js — the parts that are not boilerplate
{
  "resolver": {
    "unstable_enablePackageExports": true,
    "unstable_conditionNames": ["react-native", "import", "require", "default"]
  },
  "watchFolders": ["<repo>/packages"]
}
```

代码生成（`packages/tooling/tooling-gen-plugins`，以 `pnpm gen:plugins` 运行）写出 `apps/{mobile,desktop}/generated/plugins.ts`。其产物**提交进仓库**，因此全新检出无需任何前置步骤即可构建，CI 也只需校验该文件是否为最新，而不必重新生成 —— 每当新增或移除插件包时都要跑一次。

### 4.1 原生音频引擎二进制

MPV Hi-Fi 引擎（`core-audio-mpv`）运行在一个独立的 C++ 可执行文件中，而非 Electron bundle 内。它由
`apps/desktop/scripts/build-audio-engine.js` 编译（自动探测 `g++` / `clang++` / MSVC `cl`，C++17），
产物写入 `apps/desktop/bin/audio-engine[.exe]`，并同步到 `apps/desktop/resources/bin/` 供打包；
两者均已 gitignore——它们是构建产物。`pnpm dev:desktop` **不会**构建它；没有预先执行
`pnpm --filter @BBeBee/desktop build:audio-engine`，引擎就只是不存在。

**引擎二进制查找**（`AudioEngineSupervisor.resolveExecutablePath`）：`AUDIO_ENGINE_PATH` 环境变量
→ 打包态 `resources/bin/` → 开发候选路径。显式注入的路径缺失时严格失败（不回退）。

**libmpv 查找**（引擎启动时 `dlopen`）：先引擎自身所在目录——`build-audio-engine.js` 会把
**vendored 平台 libmpv**（`apps/desktop/resources/libmpv/<平台>/`，提交入库的源码受控集合：
`win64/` 为 mpv-winbuild 的 LGPL 全静态构建，`linux/` 为 Debian trixie `libmpv2` 的增量集，
`darwin/` 由 CI 从 brew staged；来源与许可见该目录 README）staged 到这里，且 supervisor 会把
子进程的 `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`/`PATH` 指向该目录。再系统库路径——Windows
`mpv-2.dll`、Linux `libmpv.so.2`、macOS `libmpv.dylib`。vendored 的 Linux 集合覆盖发行版
libmpv2 依赖栈之外的增量；ffmpeg 族版本必须与宿主匹配（sid 的 0.41 需要 `libavcodec.so.63`，
trixie 的 0.40 匹配系统的 `.61`）。

**降级矩阵**：

| 状态 | 行为 |
|---|---|
| 引擎二进制缺失 | supervisor 快速失败；渲染端回退 FFmpeg 桥解码路径（有声、走 Web Audio 输出、频谱平线、无 gapless） |
| 引擎在、libmpv 缺失 | 引擎存活但所有加载失败；同样的渲染端回退 |
| 两者齐备 | mpv 解码并直连系统音频输出；原生 DSP/EQ；append 式 gapless；astats 驱动频谱 |

**打包**：CI 按平台编译引擎（三平台矩阵 + `--version` 冒烟）并上传产物；打包 job 下载产物、staged libmpv
（构建脚本写入的 vendored 集合优先；`scripts/fetch-libmpv.js` 为回退——系统搜索、`LIBMPV_PATH`
覆盖、动态解析最新预编译下载）、运行 electron-builder，其分平台 `extraResources` 把引擎与 libmpv 装进安装包。本地等价：
`pnpm build:desktop && pnpm dist:desktop`。面向开发者的精简版规则见根目录 [README.md](../../README.md)。

编排不使用 Turborepo —— 没有 `turbo.json`；根脚本以 `pnpm -r` 运行 `build`、`typecheck`、`lint` 与 `test`。

---

## 5. 版本矩阵

已于 **2026-09-12** 对照 `package.json` / `pnpm-lock.yaml` 核实 —— lockfile 才是权威；这张矩阵只是一张地图。其中若干依赖每周都会变动。

| 包 | 版本 | 说明 |
|---|---|---|
| `cordis` | **4.0.0-rc.9** | ⚠️ 候选发布版本 —— 见 §5.1 |
| `cosmokit` | ^1.8.1 | Cordis 依赖 |
| `@standard-schema/spec` | — | 计划用于插件 `Config` 校验；**尚未成为依赖** |
| `expo` | 57.0.18 | SDK 57 |
| `react-native` | **0.86.3** | 由 Expo SDK 57 锁定；勿漂移到 0.87 |
| `react` | **19.2.3** | 由 Expo SDK 57 锁定。桌面渲染进程必须与之匹配 |
| `expo-router` | ~57.0.17 | |
| `expo-audio` | ~57.0.4 | `expo-av` 已停止维护，不得使用 |
| `expo-file-system` | ~57.0.6 | `File`/`Directory` API；旧版位于 `expo-file-system/legacy` |
| `expo-sqlite` | ~57.0.2 | |
| `expo-secure-store` | ~57.0.2 | |
| `expo-background-task` | ~57.0.16 | 取代 `expo-background-fetch`。与 `expo-task-manager` ~57.0.16 搭配 |
| `expo-network` | ~57.0.1 | `ctx.device.network()` |
| `expo-battery` | ~57.0.2 | `ctx.device.battery()` |
| `expo-application` | ~57.0.2 | `ctx.device` 所报告的应用版本 |
| `expo-keep-awake` | ~57.0.1 | `ctx.background.acquireWakeLock` |
| `expo-crypto` | ~57.0.2 | |
| `expo-dev-client` | ~57.0.16 | 必需 —— Expo Go 无法承载这些原生模块 |
| `react-native-audio-api` | **0.13.3** | ⚠️ 尚未到 1.0 —— 见 §5.2。Peer 依赖：`react-native-worklets >= 0.6.0` |
| `react-native-gesture-handler` | ~2.32.0 | ⚠️ 我们自己并未使用。`react-native-audio-api` 的桶文件拖进了它的 `AudioControls` 小部件，而该小部件**在未声明二者**的情况下导入了本包与 Reanimated —— 因此不安装它们，Metro 就无法解析包根。见 §5.2 |
| `react-native-reanimated` | ~4.5.1 | ⚠️ 同样的原因。一旦这两个包可被解析，`babel-preset-expo` 会自行添加 worklets 插件，因此 `babel.config.js` 无需改动 |
| `react-native-worklets` | ~0.10.1 | Reanimated 4 的运行时，也是 `react-native-audio-api` 的可选 peer |
| `electron` | **44.0.0** | 要求 Node ≥ 22.12，因此 `node:sqlite` 可用 |
| `electron-vite` | 5.0.0 | |
| `vite` | ^7.3.6 | 由 `electron-vite` 5 锁定 —— 矩阵过去写的是 8.2.2；请以 `pnpm-lock.yaml` 为权威 |
| `typescript` | **5.9.3** | ⚠️ 若矩阵中有工具还跟不上 TS 7，就改锁最新的 5.x —— 我们现在正是这么做的 |
| `vitest` | ^4.1.11 | |
| `zod` | — | 计划用于插件 `Config` 校验（符合 Standard Schema）；**尚未成为依赖** |
| `pnpm` | 11.x | 工作区管理器 —— 精确版本请读 `packageManager` / lockfile |
| `turbo` | — | **未采用。** 根脚本以 `pnpm -r` 编排；没有 `turbo.json` |
| `@shopify/flash-list` | 2.3.2 | 移动端列表虚拟化 |
| `@tanstack/react-virtual` | 3.14.10 | 桌面端列表虚拟化 |
| `music-metadata` | 11.15.0 | 两个目标平台的标签读取**都用它** —— 它是构建在 `ctx.fs` 之上的纯 JS，因此 `core-codec-rn` 直接继承它，而不是另加一个必须与它保持一致的原生读取器 |
| `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` | **0.32.0** | ⚠️ 桌面端的 `ctx.js`。两者都精确锁定且保持相等 —— 不同版本的变体与核心共享一份未加版本的 FFI ABI。单文件变体是引擎随包捆绑而非被获取的原因 (04 §19)；`browser` 构建是不挑环境的那个，因此 Vitest、`main` 与被沙箱化的渲染进程运行的是同一个 realm |
| `react-native-quickjs` | **0.4.x** | ⚠️ 移动端的 `ctx.js` —— 原生模块，因此会强制重建 dev client。见 §5.3 |

### 5.1 Cordis RC 问题

`cordis@4.0.0-rc.9` 自己的 README 写道：*"Cordis is under active development. The API is not yet stable and may change without notice."*（Cordis 仍在活跃开发中，API 尚未稳定，且可能不经通知即变更。）整个架构都建立在它之上。缓解措施，按序如下：

1. **精确锁定。** `"cordis": "4.0.0-rc.9"` —— 不带插入号（^），不带波浪号（~）。该包排除在 Renovate/Dependabot 之外；升级必须有意为之、手动执行，并单独开一个 PR。
2. **收敛使用面。** 项目只使用 `Context`、`Service`、`plugin`、`inject`、`effect`、事件方法、`isolate` 和 `intercept` —— 十来个入口。Cordis 提供的其余能力一概不用，因此某处变更的波及范围有界且可审计。
3. **掌握再导出。** `@BBeBee/kernel` 再导出插件所需的内容（`export { Service, Inject } from 'cordis'`），并且**插件从 kernel 导入，而不是直接从 `cordis` 导入**。一旦签名变化，由一个适配模块吸收，而不是波及 40 个包。这就是内核的*插件表面*，也是 Layer 1 中 Layer 3 与 Layer 4 唯一获准导入的部分 —— 旁边的引导表面只有 Layer 2 与组合根可用（[02 §1](../architecture/layers.md#不变量)，在 [§3](#3-依赖规则) 中强制执行）。
4. **锁定测试。** `@BBeBee/protocol` 的契约测试套件包含一小组测试，断言设计所依赖的 Cordis 语义 —— 依赖丢失会卸载插件、effect 按逆序执行、隔离按服务键逐一生效。破坏假设的升级会让 CI 直接失败并给出明确信息，而不是六周后才在运行时暴露。

### 5.2 音频引擎风险

`react-native-audio-api` 处于 `0.13.x`，是另一个未锁定的赌注。ADR-4 的结构已缓解此风险：`ctx.audio` 是一个服务，其契约是*标准的* Web Audio API 而非该库自身的形状，且 `core-audio-rntp` 是有据可查的备选方案（[05 §1](../audio/playback.md#逃生通道)）。锁定纪律与 Cordis 相同。

⚠️ **它的桶文件拖进来一个 UI 小部件。** `react-native-audio-api/src/api.ts` 导入了 `Audio/controls/AudioControls`，后者又导入 `react-native-gesture-handler` 与 `react-native-reanimated` —— 而该包对二者都未声明。因此，在两者都安装之前，导入该包的根入口就无法完成打包，而且即便没有任何东西渲染这个小部件，它的四枚图标 PNG 也会混进 bundle。出路有三条，按当时考虑的顺序：

1. **两个都装** —— 我们的实际做法。它们是普通的 Expo SDK 包，无需改动 Babel，而且 M2 的拖拽排序本来就需要 gesture-handler。代价：两个原生模块，外加约 2 KB 用不上的图标。
2. **在 Metro 的 `resolveRequest` 里垫片（shim）掉它们。** 更省事，而且*眼下*安全，因为没有任何东西渲染 `AudioControls` —— 但第一个添加滑动手势的人，会从一个说谎的解析器那里收到一头雾水的失败。
3. **绕过桶文件做深导入**（`react-native-audio-api/lib/module/core/AudioContext` 等）。避开两个原生模块；该包没有发布 `exports` 映射，所以行得通。但对版本脆弱，而且会蔓延到我们的三个包。

如果这两个原生模块哪天成了问题，方案 3 就是逃生通道，而且它是可控的。

---

### 5.3 求值器风险

`ctx.js` 是第三个 pre-1.0 赌注，而且它是随 [ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释) 一道到来的，并非从容选定。两套 QuickJS 绑定、两套构建系统，其中一套还是原生模块，而它所在的平台恰恰是改动原生模块代价高昂的平台。

缓解手段与另外两个同构，这也正是 `ctx.js` 被做成一个*服务*、而不是 `plugin-source-runtime` 内部一个导入的原因：契约是"在带这些限制、这份宿主暴露面的 realm 里求值这个字符串"，QuickJS 能满足它，`isolated-vm` 形态的嵌入能满足它，`Worker` 也能 —— 只是在限制方面故事更差。契约测试套件测的正是这份契约，包括 `while (true)` 会被中断、宿主对象无法跨边界保留，因此更换实现只是换一个包，而不是一次重新设计。

⚠️ 真正会造成重创的，是出现一个**任何**解释器都无法嵌入的目标平台。今天两个目标平台都不是这种情形；如果哪天变成了这样，那就是重新考虑整套规则语言的触发条件。

---

