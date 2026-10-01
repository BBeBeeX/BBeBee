# macOS（darwin）

本目录暂无入库的 `libmpv.dylib`：macOS 的 brew 构建以绝对路径（`/opt/homebrew/opt/...`）引用
自身依赖，未经 `install_name_tool` 改写直接提交不可移植，且本仓库的 Linux 开发环境无法产出
经过签名/链接修整的 macOS 库。

获取方式（按优先级）：

1. **CI macos job**：`brew install mpv` 后由 `scripts/fetch-libmpv.js` staged 到本目录，随
   electron-builder 打包（其依赖闭包需一并处理——brew 产物的传递依赖同样引用 brew 路径，
   必要时用 `install_name_tool`/`otool -L` 清单补齐到同目录）。
2. 本地开发：`brew install mpv` 后引擎可直接从系统库路径找到 `libmpv.dylib`，无需本目录。

放好 `libmpv.dylib`（及依赖）后，`build-audio-engine.js` 会把它一并 staged 到 `bin/` 与
`resources/bin/`。
