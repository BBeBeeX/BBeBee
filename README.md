# BBeBee

基于插件平台的跨平台音乐播放器：桌面端 Electron，移动端 Expo / React Native。内核为
[Cordis](https://github.com/cordiverse/cordis)（依赖注入 + 插件生命周期），**内核之上的一切都是插件**。
架构文档见 [docs/](docs/README.md)（英文）与 [docs-zh/](docs-zh/README.md)（中文）；面向 AI 助手的工作约定见 [AGENTS.md](AGENTS.md)。

## 环境要求

| 依赖 | 用途 | 必需性 |
|---|---|---|
| Node ≥ 22.12、pnpm ≥ 11 | 全部工作区脚本 | 必需 |
| C++17 编译器（`g++` / `clang++` / MSVC `cl`） | 编译 native 音频引擎二进制 | MPV 引擎必需 |
| libmpv（`mpv-2.dll` / `libmpv.so.2` / `libmpv.dylib`） | 引擎运行时 `dlopen` | MPV 引擎必需（缺失时自动降级，见下） |

## 命令速查

```bash
pnpm install                                  # 安装依赖（首次 / 依赖变更后）
pnpm gen:plugins                              # 增删插件后重新生成插件注册表（必须）
pnpm dev:desktop                              # 桌面端开发（electron-vite dev，HMR）
pnpm dev:mobile                               # 移动端开发（自定义 dev build，不是 Expo Go）
pnpm check                                    # typecheck + lint + test —— 提交前的唯一闸门
pnpm check:changed                            # 只检查当前 diff 涉及的包
pnpm build:audio-engine                      # 编译 native 音频引擎二进制（写入 bin/ 并 staged libmpv）
pnpm build:desktop                            # 生产构建（引擎二进制 + electron-vite build）
pnpm dist:desktop                             # electron-builder 打包安装包（产出 apps/desktop/dist/）
```

## 构建规则

### R1 · `dev:desktop` 不构建 native 引擎二进制

`pnpm dev:desktop` 只运行 `electron-vite dev`。MPV Hi-Fi 引擎的二进制必须** beforehand 手动编译**：

```bash
pnpm build:audio-engine
```

产物写入 `apps/desktop/bin/audio-engine[.exe]`（已 gitignore，不入库），并同步一份到 `apps/desktop/resources/bin/` 供打包使用。没有这个二进制，`pnpm dev:desktop` 仍能启动：MPV 引擎挂载时快速失败，加载降级到媒体元素（Chromium 解码，有声，但频谱平线、无 gapless）。

### R2 · 引擎二进制与 libmpv 的查找顺序

**引擎二进制**（`AudioEngineSupervisor.resolveExecutablePath`）按序查找：

1. `AUDIO_ENGINE_PATH` 环境变量（存在才采用；缺失则继续向下找）
2. 打包环境：`<resourcesPath>/bin/`（CI 由 electron-builder `extraResources` 放入）
3. 开发环境：`apps/desktop/bin/`、`apps/desktop/resources/bin/` 等候选路径

**libmpv**（引擎启动时 `dlopen`/`LoadLibrary`）按序查找：

1. 引擎二进制所在目录——`build:audio-engine` 会把 **vendored 库**（`apps/desktop/resources/libmpv/<平台>/`，见下）与打包 staged 的库都拷到这里，因此本地测试零配置
2. 系统库路径：Windows `PATH`/`mpv-2.dll`，Linux `libmpv.so.2`（`LD_LIBRARY_PATH` 或发行版包），macOS `libmpv.dylib`
3. 全部落空 → 引擎进入无 mpv 模式：所有加载快速失败并降级到媒体元素（Chromium 解码，有声、频谱平线、无 gapless）

**vendored 库**（`apps/desktop/resources/libmpv/`，提交入库）：`win64/` 为 mpv-winbuild 的 LGPL 全静态构建（零系统依赖），`linux/` 为 Debian trixie `libmpv2` 的增量集（需发行版提供 libavcodec61 等基础栈），`darwin/` 由 CI macos job 从 brew staged。来源、版本与许可说明见 [apps/desktop/resources/libmpv/README.md](apps/desktop/resources/libmpv/README.md)。

开发机免 root 方式：把 libmpv 及其依赖放到引擎旁（supervisor 会为子进程设置
`LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`/`PATH` 指向该目录），或直接 `LD_LIBRARY_PATH=<libmpv目录> pnpm dev:desktop`。

### R3 · 增删插件后必须 `pnpm gen:plugins`

`apps/mobile/generated/plugins.ts` 与 `packages/ui/plugin-inspector-ui-desktop/src/pcb-manifests.generated.ts` 是生成物。新增或删除插件包或修改清单后运行 `pnpm gen:plugins`，保持移动端注册表与拓扑检视器清单一致（桌面端全面使用动态加载机制，无需预生成静态注册表）。

### R4 · 提交前必须 `pnpm check`

typecheck + lint + test 一道闸全过才算完成；`pnpm check:changed` 用于只跑 diff 触及的包。

### R5 · 工作区包被打包、npm 依赖被外置

`apps/desktop` 的 electron-vite 配置将 `@BBeBee/*` 工作区包**打入 bundle**（它们的 `exports` 指向 TS 源码，Electron 的 Node 加载器无法直接加载 TS），真实 npm 依赖照常外置。新增工作区依赖不需要改配置，新增 npm 依赖则自动外置。

### R6 · 打包流水线（CI）

三平台矩阵 job 编译引擎二进制并上传产物 → `package-desktop` job 下载产物、安装/staged libmpv
（`scripts/fetch-libmpv.js`：系统搜索、`LIBMPV_PATH` 覆盖、带 SHA256 校验的 Windows 预编译下载，`--strict` 下缺失即失败）→
`pnpm build:desktop` → electron-builder 按平台打包（Windows NSIS / Linux AppImage / macOS DMG，
per-platform `extraResources` 携带引擎与 libmpv）→ 上传安装包产物。本地等价命令为
`pnpm build:desktop && pnpm dist:desktop`。

### R7 · 构建产物不入库

`apps/desktop/bin/` 与 `apps/desktop/resources/bin/` 均已 gitignore——引擎二进制与 staged 的 libmpv
是构建产物，由构建脚本与 CI 产出。

### R8 · libmpv 版本匹配

引擎按平台选择音频输出（Windows `ao=wasapi`、macOS `coreaudio`、Linux `pulse,alsa,pipewire`）。
Linux 下 libmpv 的 ffmpeg 依赖版本必须与系统栈匹配（例如 Debian trixie 的 libmpv2 0.40 对应
libavcodec.so.61；从 sid 取 0.41 会因 libavcodec.so.63 缺失而 dlopen 失败）。

## 无 libmpv 时的行为（降级矩阵）

| 场景 | 行为 |
|---|---|
| 引擎二进制缺失 | supervisor 快速失败，加载降级到媒体元素（Chromium 解码，有声，走 Web Audio 输出） |
| libmpv 缺失 | 引擎存活但所有加载失败，同样回退；频谱平线 |
| 正常（引擎 + libmpv） | mpv 解码并直连系统音频输出，原生 DSP/EQ，append 式 gapless，电平频谱 |
