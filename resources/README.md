# Developer Audio Engine Platform Resources (全量音频引擎资源区)

This directory contains platform-specific **full native binaries and runtime dependency closures** used for local development, debugging, testing, and Tauri desktop packaging.

此目录用于存放各个桌面平台的**全量（Full Package）音频引擎可执行程序及配套的动态依赖库闭包**。

---

## Directory Layout / 目录规范

All platform directories under `resources/` must contain the **full self-contained package** (executable + complete dynamic library closure), rather than slim packages (`-slim`):

根目录 `resources/` 下的各平台目录**均存放全量包（解压后的全部文件）**，不放单体轻量包（`-slim`）：

- **`resources/windows/`**: Windows x64 Full Package
  - Extracted from `audio-engine-windows-x64.zip`
  - Contains `audio-engine.exe` + `mpv-2.dll` / `libmpv-2.dll` + all transitive dependency DLLs (FFmpeg, OpenSSL, etc.).
  - 存放全量 Windows 产物：`audio-engine.exe`、`mpv-2.dll` 及全部依赖 DLL。
- **`resources/macos/`**: macOS arm64 Full Package
  - Extracted from `audio-engine-macos-arm64.tar.gz`
  - Contains `audio-engine` executable + complete `@rpath` dynamic library closure (`libmpv.2.dylib`, FFmpeg, libplacebo, libass, freetype, etc. - 38 dylibs).
  - 存放全量 macOS 产物：`audio-engine` 可执行程序及完整的 `@rpath` 动态库闭包（libmpv、FFmpeg、libass 等 38 个动态库），完全脱离 Homebrew 独立自包含运行。
- **`resources/linux/`**: Linux x64 Full Package
  - Extracted from `audio-engine-linux-x64.tar.gz`
  - Contains `audio-engine` executable + `libmpv.so.2` + the complete transitive `.so` dependency closure (~260+ shared libraries).
  - 存放全量 Linux 产物：`audio-engine` 可执行程序、`libmpv.so.2` 以及完整的传递依赖 `.so` 共享库闭包。

---

## Why Full Packages? / 为什么必须使用全量包？

1. **Zero Missing Dependency Failures (开箱即用，零依赖缺失)**:
   The native audio engine uses dynamic linking (`dlopen`) to load `libmpv`, which in turn depends on FFmpeg, libass, audio device drivers, etc. Staging the full dependency closure guarantees that native playback, DSP chains, FFT spectrum visualizers, and gapless playback work reliably out-of-the-box on clean target machines without requiring users or developers to manually install system-level `libmpv` or multimedia packages.
   `audio-engine` 启动时通过动态加载 `libmpv` 进行解码，而 `libmpv` 依赖底层大量的音视频编解码与系统库。放置全量闭包可保证在任何干净的操作系统上都能直接启动原生高保真引擎，杜绝因缺少动态库而导致的静默降级或加载失败。

2. **Packaging Parity (保证打包自包含)**:
   The Tauri build pipeline (`apps/desktop/scripts/package-desktop.js`) directly stages all binaries and dynamic libraries from `resources/<platform>/` into the final installers (`.deb`, `.appimage`, `.nsis`, `.dmg`). Using full packages guarantees that distributed desktop application bundles are completely self-contained.
   Tauri 桌面端打包脚本会直接将 `resources/<platform>/` 下的所有文件打入最终安装包，全量包能够保证打包发布的独立自包含性。

---

## Important Rules / 存放注意事项

1. **Do NOT place compressed archives directly (禁止直接放置压缩包)**:
   Files must be **extracted** into the directory. Do not place `.tar.gz` or `.zip` files directly inside `resources/<platform>/`. The OS loader and Tauri packager require plain executable and library files on the filesystem.
   必须将压缩包解压，平铺放置里面的可执行文件与动态库，操作系统无法直接在压缩包内寻址并加载动态库。
2. **Gitignored (已配置忽略)**:
   Native binaries and `.so` / `.dll` / `.dylib` files are gitignored (`.gitignore`) to avoid bloating version control.
   各平台目录已被 `.gitignore` 忽略，避免将数十兆的二进制库提交至 Git 仓库。

---

## How to Populate / 获取与部署方式

### Option A: Automated Fetch (推荐：自动拉取全量包)

Run the fetch script from the repository root:

```bash
# Automatically downloads full packages, verifies SHA256, and extracts into resources/<platform>/ and apps/desktop/bin
pnpm fetch:audio-engine --app desktop --full-only
```

Or via Node directly:
```bash
node scripts/fetch-audio-engine.mjs --app desktop --full-only
```

### Option B: Manual Placement (手动下载解压)

1. Download the full release package for your platform from GitHub Releases:
   [`BBeBeeX/B_Be_Bee-audio-engine`](https://github.com/BBeBeeX/B_Be_Bee-audio-engine/releases)
   - Linux: `audio-engine-linux-x64.tar.gz` (Full, ~98 MB)
   - Windows: `audio-engine-windows-x64.zip` (Full, ~68 MB)
   - macOS: `audio-engine-macos-arm64.tar.gz` (Full, ~23 MB)
2. Extract all contents directly into `resources/<platform>/` (e.g. `resources/linux/`, `resources/windows/`, `resources/macos/`).
