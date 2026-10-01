# Vendored libmpv（各平台 libmpv 运行库）

本目录是**源码可控的 libmpv 分发**：构建脚本会把它拷贝到引擎二进制旁边（`bin/` 与
`resources/bin/`），使本地测试与打包都不依赖系统是否安装了 libmpv。

## 布局与来源

| 目录 | 文件 | 来源 | 说明 |
|---|---|---|---|
| `win64/` | `libmpv-2.dll` | [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) `2026-09-30-3186d369f9` 的 **mpv-dev-lgpl-x86_64**（LGPL 构建，全静态） | Windows 上零系统依赖，直接可用 |
| `linux/` | `libmpv.so.2` 等 9 个库 | Debian trixie `libmpv2 0.40.0-3+deb13u1` 的**增量集**（mpv2 官方依赖栈之外、系统默认没有的部分：libavdevice61、libcdio*、libmujs3、liblua5.2、libsixel1、libXpresent1） | 需要发行版提供 libavcodec61 等基础栈（`apt install libmpv2` 可补齐）；Linux 库与发行版 glibc/libav 版本绑定，不跨发行版通用 |
| `darwin/` | （空） | 无本地 macOS 构建环境；CI 的 macos job 通过 `brew install mpv` staged，或手动放入 `libmpv.dylib` | brew 产物引用绝对路径，直接提交不可移植 |

## 消费方式

- `build-audio-engine.js` 编译引擎后，自动把本目录中**当前平台**的库拷贝到 `bin/` 与
  `resources/bin/`——本地 `pnpm dev:desktop` 与 electron-builder 打包都从这里取。
- `scripts/fetch-libmpv.js` 是**回退路径**：仅当本目录没有对应平台的库时（系统搜索 → 预编译
  下载），才用于 CI 补齐。

## 许可说明

- `win64/` 为 LGPL 构建动态库：以动态链接方式嵌入应用时，按 LGPL 要求保留 mpv 的源码获取
  途径即可。
- `linux/` 的 Debian `libmpv2` 为 **GPL 构建**：随应用再分发时需遵守相应 GPL 义务；若需要更
  宽松的义务，可改用上游 LGPL 构建或自编译 `--enable-lgpl`。
