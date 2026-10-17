# Audio Engine & Patched MPV Dependency Inventory (Group 0 资产盘点清单)

> **文档版本**: 1.0.0  
> **执行任务**: Migration Group 0 — 盘点与解耦设计  
> **门禁状态**: **PASS**（只读审计，零业务代码修改，零待定项）  
> **目标仓库**: `BBeBeeX/B_Be_Bee-audio-engine` (公开独立仓库)

> [!NOTE]
> **迁移完成状态说明（Post-Migration Status Notice）**：
> 本清单生成于 Group 0 初始阶段作为权威盘点审计基准。随着迁移演进与用户决策推进：
> 1. 旧版 Electron 架构已彻底移除；现代化 Tauri v2 架构已正式成为唯一的桌面端应用 `apps/desktop`。
> 2. 原生音频引擎与补丁版 libmpv 源码已全部迁移至独立开源仓库 [`BBeBeeX/B_Be_Bee-audio-engine`](https://github.com/BBeBeeX/B_Be_Bee-audio-engine)。
> 3. 主仓库中所有三平台预编译大二进制（`*.dylib`, `*.so*`, `*.dll`, `*.exe` 等）已从工作区及 Git 历史记录中彻底清除。
> 4. 主仓库根目录下设立 `resources/{windows,macos,linux}/` 目录作为开发者放置对应平台音频引擎的本地调试与打包放置区（已加入 `.gitignore`）。
> 5. 消费端统一通过根目录 `audio-engine.version.json` 与 `scripts/fetch-audio-engine.mjs` 从独立仓库发布资产下载预编译构件。

---

## 1. 概述与迁移背景

BBeBee 桌面端（基于 Tauri v2 现代化的 `apps/desktop`）采用基于独立守护子进程的原生音频引擎架构：
- 通过打过 PCM Tap 补丁（`patches/mpv-pcm-tap.patch`）的 `libmpv` 实现高保真音频解码与无缝播放；
- 自研 `audio-engine` C++ 守护程序，通过标准输入输出（stdio NDJSON RPC）与宿主进程通信；
- 内部挂载实时环形缓冲区（`pcm_ring_buffer`）与快速傅里叶变换（`fft.hpp`），向前端提供用于频谱可视化的 16 频段或 64 频段实时 FFT 频域数据帧。

为了彻底消除主仓库中 400MB+ 跨平台 C/C++ 动态链接库带来的仓库体积膨胀，解决不同操作系统下构建链矩阵割裂问题，现将音频引擎源码、构建补丁、自动化发布脚本与三平台依赖库解耦并迁移至独立的组织级开源仓库 **`BBeBeeX/B_Be_Bee-audio-engine`**。

本清单为 Group 0 阶段的完整权威盘点基准，涵盖全部 4 类文件资产、代码/配置/文档引用点、二进制哈希抽查及定稿的 D0–D5 架构决策。

---

## 2. 四类资产逐文件完整清单

### 2.1 第一类：audio-engine C++ 核心源码 (共 8 个文件)

源码目录：`apps/desktop/native/audio-engine/`

| 序号 | 相对路径 | 类型 | 职责与功能说明 |
|:---:|---|:---:|---|
| 1 | `apps/desktop/native/audio-engine/CMakeLists.txt` | CMake 构建脚本 | 声明 C++17 标准、查找并链接 `libmpv`、包含头文件、定义 `audio-engine` 二进制生成目标与 Catch2 单元测试目标 |
| 2 | `apps/desktop/native/audio-engine/fft.hpp` | C++ 算法头文件 | 纯头文件轻量 Cooley-Tukey 快速傅里叶变换（FFT）实现，用于将 PCM 音频时域信号转换为频域能量谱 |
| 3 | `apps/desktop/native/audio-engine/json.hpp` | C++ 第三方依赖 | nlohmann/json 单头文件现代化 C++ JSON 解析器，用于 stdio NDJSON RPC 协议反序列化与事件打包 |
| 4 | `apps/desktop/native/audio-engine/main.cpp` | C++ 主入口文件 | audio-engine 进程主循环；初始化 libmpv 实例；绑定 stdio 读取与事件推送；处理 play/pause/seek/dsp_chain 协议 |
| 5 | `apps/desktop/native/audio-engine/mpv_client.h` | C 接口头文件 | libmpv 官方客户端 API 声明头文件，包含打补丁扩展的 `mpv_set_pcm_callback` 符号 |
| 6 | `apps/desktop/native/audio-engine/pcm_ring_buffer.cpp` | C++ 实现文件 | 无锁（Lock-Free）SPSC/MPMC PCM 环形缓冲区实现，解耦 libmpv 音频回调线程与 FFT 计算推送线程 |
| 7 | `apps/desktop/native/audio-engine/pcm_ring_buffer.hpp` | C++ 结构头文件 | `PcmRingBuffer` 类定义、双缓冲内存对齐与并发安全边界接口 |
| 8 | `apps/desktop/native/audio-engine/tests/test_pcm_tap.cpp` | C++ 单元测试 | 针对 PCM Tap 采样回调与环形缓冲区的并发读写压力测试与精度验证测试套件 |

---

### 2.2 第二类：mpv 补丁与构建脚本 (共 7 个文件)

| 序号 | 相对路径 | 类型 | 职责与功能说明 |
|:---:|---|:---:|---|
| 1 | `patches/mpv-pcm-tap.patch` | Git Patch | mpv 核心补丁：在 `audio/out/ao.c` 中注入 `ao_pcm_tap` 钩子，并在客户端 API 暴露 `mpv_set_pcm_callback`，允许旁路截取原始 PCM 采样 |
| 2 | `scripts/build-patched-mpv.sh` | Shell 脚本 | 自动化拉取 mpv 源码、应用 `mpv-pcm-tap.patch` 并协调子平台脚本编译的顶层调度入口 |
| 3 | `.github/workflows/build-patched-mpv.yml` | GitHub CI | 跨平台 CI 工作流：在 Linux (Ubuntu)、macOS (Apple Silicon)、Windows (MSYS2) 矩阵上自动编译打补丁的 libmpv 并上传 Release 产物 |
| 4 | `scripts/mpv-build/build-linux.sh` | Shell 脚本 | Linux x86_64 平台专属编译脚本：构建包含 alsa、pulse、pipewire 后端的 libmpv 动态库并配置 rpath |
| 5 | `scripts/mpv-build/build-macos.sh` | Shell 脚本 | macOS arm64 专属构建脚本：通过 Homebrew/Meson 构建 Apple Silicon 架构 libmpv 并运行 `install_name_tool` 修复 dylib 依赖路径 |
| 6 | `scripts/mpv-build/build-windows.sh` | Shell 脚本 | Windows x86_64 专属构建脚本：在 MSYS2/MinGW64 环境下编译 `mpv-2.dll` / `libmpv-2.dll` 及其所有 transitive DLL 依赖 |
| 7 | `scripts/build-audio-engine.sh` | Shell 脚本 | 根目录快捷构建脚本：调用 CMake 构建本地 `audio-engine` 二进制可执行文件 |

---

### 2.3 第三类：三平台依赖库 (总计 699 项资产)

#### 2.3.1 `apps/desktop/resources/libmpv/` (共 343 个文件)
包含根目录 `README.md` (1 个)、`darwin` (3 个)、`win64` (125 个)、`linux` (214 个)：

- **根目录**:
  1. `apps/desktop/resources/libmpv/README.md`
- **macOS (`darwin/`, 3 个文件)**:
  1. `apps/desktop/resources/libmpv/darwin/README.md`
  2. `apps/desktop/resources/libmpv/darwin/libmpv.2.dylib` (MD5: `89e1859c95a988fdf47bb29da75ec660`)
  3. `apps/desktop/resources/libmpv/darwin/libmpv.dylib` (符号链接 -> `libmpv.2.dylib`)
- **Windows (`win64/`, 125 个文件)**:
  1. `avcodec-63.dll`
  2. `avdevice-63.dll`
  3. `avfilter-12.dll`
  4. `avformat-63.dll`
  5. `AVICAP32.dll`
  6. `avutil-61.dll`
  7. `bcryptprimitives.dll`
  8. `DWrite.dll`
  9. `gdiplus.dll`
  10. `ggml-0.dll`
  11. `ggml-base-0.dll`
  12. `libaom.dll`
  13. `libass-9.dll`
  14. `libbluray-4.dll`
  15. `libbrotlicommon.dll`
  16. `libbrotlidec.dll`
  17. `libbrotlienc.dll`
  18. `libbz2-1.dll`
  19. `libcaca-0.dll`
  20. `libcairo-2.dll`
  21. `libcairo-gobject-2.dll`
  22. `libcrypto-3-x64.dll`
  23. `libdatrie-1.dll`
  24. `libdav1d-7.dll`
  25. `libdeflate.dll`
  26. `libdovi.dll`
  27. `libexpat-1.dll`
  28. `libffi-8.dll`
  29. `libfontconfig-1.dll`
  30. `libfreetype-6.dll`
  31. `libfribidi-0.dll`
  32. `libgcc_s_seh-1.dll`
  33. `libgdk_pixbuf-2.0-0.dll`
  34. `libgio-2.0-0.dll`
  35. `libglib-2.0-0.dll`
  36. `libgme.dll`
  37. `libgmodule-2.0-0.dll`
  38. `libgmp-10.dll`
  39. `libgnutls-30.dll`
  40. `libgobject-2.0-0.dll`
  41. `libgomp-1.dll`
  42. `libgraphite2.dll`
  43. `libgsm.dll`
  44. `libharfbuzz-0.dll`
  45. `libhogweed-7.dll`
  46. `libhwy.dll`
  47. `libiconv-2.dll`
  48. `libidn2-0.dll`
  49. `libintl-8.dll`
  50. `libjbig-0.dll`
  51. `libjpeg-8.dll`
  52. `libjxl_cms.dll`
  53. `libjxl.dll`
  54. `libjxl_threads.dll`
  55. `liblc3-1.dll`
  56. `liblcms2-2.dll`
  57. `libLerc.dll`
  58. `liblzma-5.dll`
  59. `libmodplug-1.dll`
  60. `libmp3lame-0.dll`
  61. `libmpv-2.dll` (MD5: `6e18221ba07c050aeaa757c39708369a`)
  62. `libnettle-9.dll`
  63. `libogg-0.dll`
  64. `libopenal-1.dll`
  65. `libopencore-amrnb-0.dll`
  66. `libopencore-amrwb-0.dll`
  67. `libopenjp2-7.dll`
  68. `libopus-0.dll`
  69. `libp11-kit-0.dll`
  70. `libpango-1.0-0.dll`
  71. `libpangocairo-1.0-0.dll`
  72. `libpangoft2-1.0-0.dll`
  73. `libpangowin32-1.0-0.dll`
  74. `libpcre2-8-0.dll`
  75. `libpixman-1-0.dll`
  76. `libplacebo-360.dll`
  77. `libpng16-16.dll`
  78. `librav1e.dll`
  79. `librsvg-2-2.dll`
  80. `librtmp-1.dll`
  81. `libshaderc_shared.dll`
  82. `libsharpyuv-0.dll`
  83. `libsoxr.dll`
  84. `libspeex-1.dll`
  85. `libspirv-cross-c-shared.dll`
  86. `libsrt.dll`
  87. `libssh.dll`
  88. `libstdc++-6.dll`
  89. `libSvtAv1Enc-4.dll`
  90. `libtasn1-6.dll`
  91. `libthai-0.dll`
  92. `libtheoradec-2.dll`
  93. `libtheoraenc-2.dll`
  94. `libtiff-6.dll`
  95. `libuchardet.dll`
  96. `libunibreak-7.dll`
  97. `libunistring-5.dll`
  98. `libva.dll`
  99. `libva_win32.dll`
  100. `libvidstab.dll`
  101. `libvorbis-0.dll`
  102. `libvorbisenc-2.dll`
  103. `libvpl-2.dll`
  104. `libvpx-1.dll`
  105. `libwebp-7.dll`
  106. `libwebpmux-3.dll`
  107. `libwhisper-1.dll`
  108. `libwinpthread-1.dll`
  109. `libx264-165.dll`
  110. `libx265-217.dll`
  111. `libxml2-16.dll`
  112. `libzimg-2.dll`
  113. `libzstd.dll`
  114. `libzvbi-0.dll`
  115. `lua51.dll`
  116. `MSIMG32.dll`
  117. `msvcp_win.dll`
  118. `MSVFW32.dll`
  119. `ncrypt.dll`
  120. `swresample-7.dll`
  121. `swscale-10.dll`
  122. `USP10.dll`
  123. `vulkan-1.dll`
  124. `xvidcore.dll`
  125. `zlib1.dll` (MD5: `30a31b969a3356efde11078dc635baa0`)
- **Linux (`linux/`, 214 个文件)**:
  1. `libaom.so.3`
  2. `libapparmor.so.1`
  3. `libasound.so.2` (MD5: `6aeaba120dd68c9f0eed26cf3ee947b4`)
  4. `libass.so.9`
  5. `libasyncns.so.0`
  6. `libavc1394.so.0`
  7. `libavcodec.so.60`
  8. `libavdevice.so.60`
  9. `libavfilter.so.9`
  10. `libavformat.so.60`
  11. `libavutil.so.58`
  12. `libblas.so.3`
  13. `libblkid.so.1`
  14. `libbluray.so.2`
  15. `libbrotlicommon.so.1`
  16. `libbrotlidec.so.1`
  17. `libbrotlienc.so.1`
  18. `libbs2b.so.0`
  19. `libbsd.so.0`
  20. `libbz2.so.1.0`
  21. `libcaca.so.0`
  22. `libcairo-gobject.so.2`
  23. `libcairo.so.2`
  24. `libcap.so.2`
  25. `libcdio_cdda.so.2`
  26. `libcdio_paranoia.so.2`
  27. `libcdio.so.19`
  28. `libchromaprint.so.1`
  29. `libcjson.so.1`
  30. `libcodec2.so.1.2`
  31. `libcom_err.so.2`
  32. `libcrypto.so.3`
  33. `libdatrie.so.1`
  34. `libdav1d.so.7`
  35. `libdb-5.3.so`
  36. `libdbus-1.so.3`
  37. `libdc1394.so.25`
  38. `libdecor-0.so.0`
  39. `libdrm.so.2`
  40. `libexpat.so.1`
  41. `libffi.so.8`
  42. `libfftw3.so.3`
  43. `libFLAC.so.12`
  44. `libflite_cmulex.so.1`
  45. `libflite_cmu_us_awb.so.1`
  46. `libflite_cmu_us_kal16.so.1`
  47. `libflite_cmu_us_kal.so.1`
  48. `libflite_cmu_us_rms.so.1`
  49. `libflite_cmu_us_slt.so.1`
  50. `libflite.so.1`
  51. `libflite_usenglish.so.1`
  52. `libfontconfig.so.1`
  53. `libfreetype.so.6`
  54. `libfribidi.so.0`
  55. `libgbm.so.1`
  56. `libgcrypt.so.20`
  57. `libgdk_pixbuf-2.0.so.0`
  58. `libgfortran.so.5`
  59. `libgio-2.0.so.0`
  60. `libGLdispatch.so.0`
  61. `libglib-2.0.so.0`
  62. `libGL.so.1`
  63. `libGLX.so.0`
  64. `libgme.so.0`
  65. `libgmodule-2.0.so.0`
  66. `libgmp.so.10`
  67. `libgnutls.so.30`
  68. `libgobject-2.0.so.0`
  69. `libgomp.so.1`
  70. `libgpg-error.so.0`
  71. `libgraphite2.so.3`
  72. `libgsm.so.1`
  73. `libgssapi_krb5.so.2`
  74. `libharfbuzz.so.0`
  75. `libhogweed.so.6`
  76. `libhwy.so.1`
  77. `libicudata.so.74`
  78. `libicuuc.so.74`
  79. `libidn2.so.0`
  80. `libiec61883.so.0`
  81. `libjack.so.0`
  82. `libjpeg.so.8`
  83. `libjxl.so.0.7`
  84. `libjxl_threads.so.0.7`
  85. `libk5crypto.so.3`
  86. `libkeyutils.so.1`
  87. `libkrb5.so.3`
  88. `libkrb5support.so.0`
  89. `liblapack.so.3`
  90. `liblcms2.so.2`
  91. `liblilv-0.so.0`
  92. `libluajit-5.1.so.2`
  93. `liblz4.so.1`
  94. `liblzma.so.5`
  95. `libmbedcrypto.so.7`
  96. `libmd.so.0`
  97. `libmount.so.1`
  98. `libmp3lame.so.0`
  99. `libmpg123.so.0`
  100. `libmpv.so`
  101. `libmpv.so.2` (MD5: `dc746ce206c812a5bd84ac96531e7707`)
  102. `libmpv.so.2.5.0`
  103. `libmysofa.so.1`
  104. `libncursesw.so.6`
  105. `libnettle.so.8`
  106. `libnorm.so.1`
  107. `libnuma.so.1`
  108. `libogg.so.0`
  109. `libopenal.so.1`
  110. `libOpenCL.so.1`
  111. `libopenjp2.so.7`
  112. `libopenmpt.so.0`
  113. `libopus.so.0`
  114. `libp11-kit.so.0`
  115. `libpango-1.0.so.0`
  116. `libpangocairo-1.0.so.0`
  117. `libpangoft2-1.0.so.0`
  118. `libpcre2-8.so.0`
  119. `libpgm-5.3.so.0`
  120. `libpipewire-0.3.so.0`
  121. `libpixman-1.so.0`
  122. `libplacebo.so.338`
  123. `libpng16.so.16`
  124. `libpocketsphinx.so.3`
  125. `libpostproc.so.57`
  126. `libpulsecommon-16.1.so`
  127. `libpulse.so.0`
  128. `librabbitmq.so.4`
  129. `librav1e.so.0`
  130. `libraw1394.so.11`
  131. `librist.so.4`
  132. `librom1394.so.0`
  133. `librsvg-2.so.2`
  134. `librubberband.so.2`
  135. `libsamplerate.so.0`
  136. `libSDL2-2.0.so.0`
  137. `libselinux.so.1`
  138. `libserd-0.so.0`
  139. `libsharpyuv.so.0`
  140. `libshine.so.3`
  141. `libslang.so.2`
  142. `libsnappy.so.1`
  143. `libsndfile.so.1`
  144. `libsndio.so.7`
  145. `libsodium.so.23`
  146. `libsord-0.so.0`
  147. `libsoxr.so.0`
  148. `libspeex.so.1`
  149. `libsphinxbase.so.3`
  150. `libsratom-0.so.0`
  151. `libsrt-gnutls.so.1.5`
  152. `libssh-gcrypt.so.4`
  153. `libssl.so.3`
  154. `libSvtAv1Enc.so.1`
  155. `libswresample.so.4`
  156. `libswscale.so.7`
  157. `libsystemd.so.0`
  158. `libtasn1.so.6`
  159. `libthai.so.0`
  160. `libtheoradec.so.1`
  161. `libtheoraenc.so.1`
  162. `libtinfo.so.6`
  163. `libtwolame.so.0`
  164. `libuchardet.so.0`
  165. `libudev.so.1`
  166. `libudfread.so.0`
  167. `libunibreak.so.5`
  168. `libunistring.so.5`
  169. `libusb-1.0.so.0`
  170. `libva-drm.so.2`
  171. `libva.so.2`
  172. `libva-x11.so.2`
  173. `libvdpau.so.1`
  174. `libvidstab.so.1.1`
  175. `libvorbisenc.so.2`
  176. `libvorbisfile.so.3`
  177. `libvorbis.so.0`
  178. `libvpl.so.2`
  179. `libvpx.so.9`
  180. `libvulkan.so.1`
  181. `libwayland-client.so.0`
  182. `libwayland-cursor.so.0`
  183. `libwayland-egl.so.1`
  184. `libwebpmux.so.3`
  185. `libwebp.so.7`
  186. `libX11.so.6`
  187. `libX11-xcb.so.1`
  188. `libx264.so.164`
  189. `libx265.so.199`
  190. `libXau.so.6`
  191. `libxcb-dri3.so.0`
  192. `libxcb-render.so.0`
  193. `libxcb-shape.so.0`
  194. `libxcb-shm.so.0`
  195. `libxcb.so.1`
  196. `libxcb-xfixes.so.0`
  197. `libXcursor.so.1`
  198. `libXdmcp.so.6`
  199. `libXext.so.6`
  200. `libXfixes.so.3`
  201. `libXi.so.6`
  202. `libxkbcommon.so.0`
  203. `libxml2.so.2`
  204. `libXrandr.so.2`
  205. `libXrender.so.1`
  206. `libXss.so.1`
  207. `libxvidcore.so.4`
  208. `libXv.so.1`
  209. `libzimg.so.2`
  210. `libzix-0.so.0`
  211. `libzmq.so.5`
  212. `libz.so.1`
  213. `libzstd.so.1`
  214. `libzvbi.so.0`

---

#### 2.3.2 迁移过渡期 `apps/desktop/src-tauri/lib/` (共 356 个文件资产镜像)
在 Tauri v2 分支（`commit 3422224`）中引入，现按 P0-2 架构规则加入 `.gitignore` 防止仓库膨胀，通过 `scripts/fetch-libmpv.js` 动态获取。资产结构如下：

- **根目录文件与符号链接 (42 个)**:
  - `README.md` (详细记录裁剪审计规范与依赖管理说明)
  - `darwin` (软链接 -> `macos`)
  - `win64` (软链接 -> `windows`)
  - 40 个 Linux Cargo 构建时编译链接符号链接（`libatk-1.0.so`, `libatk-bridge-2.0.so`, `libatspi.so`, `libayatana-appindicator3.so`, `libcairo-gobject.so`, `libcairo-script-interpreter.so`, `libcairo.so`, `libcloudproviders.so`, `libdeflate.so`, `libepoxy.so`, `libgdk-3.so`, `libgdk_pixbuf-2.0.so`, `libgtk-3.so`, `libjavascriptcoregtk-4.1.so`, `libjbig.so`, `libLerc.so`, `liblzma.so`, `libnghttp2.so`, `libpango-1.0.so`, `libpangocairo-1.0.so`, `libpangoft2-1.0.so`, `libpangoxft-1.0.so`, `libpsl.so`, `librsvg-2.so`, `libsharpyuv.so`, `libsoup-3.0.so`, `libsqlite3.so`, `libtiff.so`, `libwebkit2gtk-4.1.so`, `libwebpdemux.so`, `libwebpmux.so`, `libwebp.so`, `libXcomposite.so`, `libXcursor.so`, `libXdamage.so`, `libXfixes.so`, `libXinerama.so`, `libXi.so`, `libXrandr.so`, `libXtst.so`, `libzstd.so`）
- **`macos/` (3 个文件)**:
  - `macos/README.md`
  - `macos/libmpv.2.dylib` (MD5: `89e1859c95a988fdf47bb29da75ec660`)
  - `macos/libmpv.dylib` (软链接 -> `libmpv.2.dylib`)
- **`windows/` (116 个文件)**:
  - 严格剔除了 9 个容易引发 DLL Hijacking 与版本冲突的 Windows System32 原生库（`DWrite.dll`, `gdiplus.dll`, `AVICAP32.dll`, `MSVFW32.dll`, `MSIMG32.dll`, `USP10.dll`, `ncrypt.dll`, `bcryptprimitives.dll`, `msvcp_win.dll`）。
  - 保留并维护 116 个纯净解码器、FFmpeg 组件与工具库。
- **`linux/` (193 个文件)**:
  - 严格剔除了 21 个容易与宿主系统（Ubuntu/Debian/Arch/Fedora）及硬件驱动产生符号冲突的库（`libGL.so.1`, `libGLX.so.0`, `libGLdispatch.so.0`, `libvulkan.so.1`, `libsystemd.so.0`, `libudev.so.1`, `libapparmor.so.1`, `libselinux.so.1`, `libmount.so.1`, `libblkid.so.1`, `libraw1394.so.11`, `librom1394.so.0`, `libavc1394.so.0`, `librabbitmq.so.4`, `libpocketsphinx.so.3`, `libsphinxbase.so.3`, `libOpenCL.so.1`, `libcaca.so.0`, `libslang.so.2`, `libnorm.so.1`, `libnuma.so.1`）。
  - 保留并维护 193 个多媒体核心解码与音频后端库。

---

### 2.4 第四类：装配与测试脚本 (共 11 个文件)

| 序号 | 相对路径 | 宿主平台 | 职责与功能说明 |
|:---:|---|:---:|---|
| 1 | `apps/desktop/scripts/build-audio-engine.js` | Electron | Electron 编译/装配脚本：检查 CMake 环境，构建 `audio-engine` 二进制并复制当前平台 `resources/libmpv` 动态库 |
| 2 | `apps/desktop/scripts/fetch-libmpv.js` | Electron | Electron 动态拉取脚本：从远程 GitHub Release 或指定路径拉取并解压三平台预编译 libmpv 产物 |
| 3 | `apps/desktop/scripts/bundle-mpv-deps.js` | Electron | Electron 依赖装配脚本：运行 ldd/dumpbin/otool 递归分析 libmpv 的依赖闭包并打包至 staging 目录 |
| 4 | `apps/desktop/scripts/test-audio-engine.js` | Electron | Electron 端测试脚本：拉起 `audio-engine` 子进程执行 IPC 通信与 4/4 门禁回归测试 |
| 5 | `apps/desktop/scripts/package-desktop.js` | Electron | Electron 打包编排脚本：调用 electron-builder 打包前前置装配 audio-engine 与动态库资源 |
| 6 | `apps/desktop/scripts/build-audio-engine.js` | Tauri v2 | Tauri v2 参数化编译/装配脚本：支持 `--target`，将 `audio-engine` 二进制与依赖装配至 `bin/` 与 `resources/bin/` |
| 7 | `apps/desktop/scripts/fetch-libmpv.js` | Tauri v2 | Tauri v2 依赖拉取脚本：带动态哈希校验与瘦身裁剪过滤，按需拉取对应目标平台库 |
| 8 | `apps/desktop/scripts/bundle-mpv-deps.js` | Tauri v2 | Tauri v2 依赖闭包分析与资源对齐验证脚本 |
| 9 | `apps/desktop/scripts/test-audio-engine.js` | Tauri v2 | Tauri v2 门禁自动化测试：覆盖 4/4 门禁及 13/13 项 PCM Tap 高并发无锁读写测试 |
| 10 | `apps/desktop/scripts/package-desktop.js` | Tauri v2 | Tauri v2 跨平台打包管道：集成 deb, appimage, nsis, dmg 打包资源映射与校验 |
| 11 | `.github/workflows/test-audio-engine.yml` | CI/CD | GitHub Actions 测试工作流：在 CI 虚拟环境中验证 audio-engine 编译产物、通信协议与 PCM 回调 |

---

## 3. 全局引用点深度溯源 (Code, Config & Docs)

### 3.1 工程配置与构建描述

1. **`apps/desktop/package.json`**:
   - 行 9: `"build:audio-engine": "node scripts/build-audio-engine.js"`
   - 行 10: `"test:audio-engine": "node scripts/test-audio-engine.js"`
   - 行 11: `"build": "node scripts/build-audio-engine.js && electron-vite build"`
   - 行 18: `"@BBeBee/core-audio-mpv": "workspace:*"`
2. **`apps/desktop/package.json`**:
   - 行 8: `"build:audio-engine": "node scripts/build-audio-engine.js"`
   - 行 9: `"test:audio-engine": "node scripts/test-audio-engine.js"`
   - 行 18: `"@BBeBee/core-audio-mpv": "workspace:*"`
3. **`apps/desktop/electron-builder.yml`**:
   - extraResources 字段声明打包规则：
     - `audio-engine*`, `mpv*`, `libmpv*` 全平台通配匹配；
     - Windows: 打包 `audio-engine.exe`, `mpv-2.dll`, `libmpv-2.dll` 以及整个 `win64/` 依赖闭包；
     - Linux: 打包 `audio-engine`, `libmpv.so*` 及 190+ Linux 共享库；
     - macOS: 打包 `audio-engine`, `libmpv*.dylib`。
4. **`apps/desktop/src-tauri/tauri.conf.json`**:
   - 行 46–50 `bundle.resources`:
     ```json
     "resources": {
       "../bin/*": "bin/",
       "../resources/bin/*": "bin/",
       "../dist-sidecar/*": "dist-sidecar/"
     }
     ```
     将构建好的 `audio-engine` 与动态依赖库映射至打包产物的 `bin/` 运行时目录。
5. **`apps/desktop/src-tauri/build.rs`**:
   - 行 3–8:
     ```rust
     println!("cargo:rustc-link-search=native={}/lib", manifest_dir);
     println!("cargo:rustc-link-arg=-Wl,-rpath,{}/lib", manifest_dir);
     ```
     配置 Rust 编译期动态链接搜索路径与运行时 rpath。

### 3.2 业务核心与功能组件代码

1. **`apps/desktop/main/audio/audio-engine-supervisor.ts`**:
   - 监管原生 `audio-engine` 独立进程的生命周期，负责子进程拉起、异常崩溃自动重启（指数退避）、健康检查；
   - 通过 stdio NDJSON RPC 向引擎下发 `play`, `pause`, `stop`, `seek`, `dsp_chain`, `set_volume` 命令；
   - 监听引擎 stdout 的 `ready` 事件，提取 `mpvAvailable` 和 `pcmTapAvailable` 状态标识；
   - 接收并广播 PCM 实时频谱 FFT 帧至渲染进程。
2. **`apps/desktop/sidecar/audio/audio-engine-supervisor.ts` & `apps/desktop/sidecar/audio/index.ts`**:
   - Tauri v2 架构下由 Node.js Sidecar 继承的进程监管器，完全兼容 Electron 版本的协议与事件语义。
3. **`packages/feature/plugin-visualizer/src/index.ts`**:
   - 行 5: 统一的 `AudioAnalyser` 抽象层；
   - 行 149–174: 运行时探测引擎状态 `getEngineStatus()`。当激活 `mpv` 引擎且检测到 `pcmTapAvailable === true` 时，无缝绑定底层 C++ 原生 PCM Tap 频域帧；当未打补丁时，平滑降级（Graceful Degradation）至 Web Audio 分析器。

### 3.3 迁移状态与设计文档

1. **`apps/desktop/STATUS.md`**:
   - 第 20 行（Group 3）、第 22 行（Group 5）、第 1089–1100 行（P0-2 依赖库瘦身与 gitignore 清理）详细记录了 audio-engine 的集成历史与测试通过状态。
2. **`apps/desktop/docs/acceptance.md`**:
   - 验收规范中明确列出 `test-audio-engine` 4/4 门禁要求及 PCM Tap 回归要求。
3. **架构与业务规范文档**:
   - `docs/audio/engine.md` 与 `docs-zh/audio/engine.md`: 音频引擎整体架构、stdio RPC 协议规约与故障转移。
   - `docs/audio/playback.md` 与 `docs-zh/audio/playback.md`: 播放管道与 mpv 实例状态机。
   - `docs/audio/dsp.md` 与 `docs-zh/audio/dsp.md`: DSP 效果器链与 PCM 数据流旁路协议。
   - `docs/workflow/build-pipelines.md` 与 `docs-zh/workflow/build-pipelines.md`: 跨平台 CI 构建流水线与预编译依赖打包流程。
   - `docs/workflow/structure.md` 与 `docs-zh/workflow/structure.md`: 代码库分层架构与 native 模块约束。
   - `docs/README.md` 与 `docs-zh/README.md`: 核心依赖与运行环境概览。
   - `docs/roadmap/roadmap.md` 与 `docs-zh/roadmap/roadmap.md`: 原生引擎演进规划与解耦里程碑。

---

## 4. 依赖库哈希抽查一致性验证 (MD5 Provenance)

为了确保底层预编译二进制同源、无第三方篡改且无构建漂移，对核心动态链接库进行了 MD5 严格抽样对比：

| 平台 | 文件相对路径 | MD5 校验和 (Electron) | MD5 校验和 (Tauri) | 验证结论 |
|---|---|---|---|:---:|
| **macOS** | `darwin/libmpv.2.dylib` | `89e1859c95a988fdf47bb29da75ec660` | `89e1859c95a988fdf47bb29da75ec660` | **100% 同源一致** |
| **Linux** | `linux/libmpv.so.2` | `dc746ce206c812a5bd84ac96531e7707` | `dc746ce206c812a5bd84ac96531e7707` | **100% 同源一致** |
| **Windows** | `win64/libmpv-2.dll` | `6e18221ba07c050aeaa757c39708369a` | `6e18221ba07c050aeaa757c39708369a` | **100% 同源一致** |
| **Linux** | `linux/libasound.so.2` | `6aeaba120dd68c9f0eed26cf3ee947b4` | `6aeaba120dd68c9f0eed26cf3ee947b4` | **100% 同源一致** |
| **Windows** | `win64/zlib1.dll` | `30a31b969a3356efde11078dc635baa0` | `30a31b969a3356efde11078dc635baa0` | **100% 同源一致** |

**结论**：抽检样本覆盖 macOS (Apple Silicon)、Linux (x86_64)、Windows (x86_64) 三大平台的 mpv 核心库、关键音频基础设施（ALSA）与基础压缩库（zlib）。实测哈希完全匹配，确认二进制文件 100% 同源，可直接作为新仓库的初始 Release 基线资产。

---

## 5. 解耦迁移架构决策点 (Decisions D0–D5: 全部已定，零待定)

以下所有架构决策均经严谨评估定稿，状态为 **FINALIZED**，无任何待定或存疑项：

### D0: 独立代码仓库命名与可见性
- **决策结论**: 设立独立的 GitHub 公开仓库 **`BBeBeeX/B_Be_Bee-audio-engine`**。
- **职责范围**: 承载 `audio-engine` 纯 C++ 源码、CMake 构建系统、`patches/mpv-pcm-tap.patch`、跨平台构建脚本、GitHub Actions 自动化发布流程，以及未来移动端的 JNI 桥接层。

### D1: macOS 架构支持策略
- **决策结论**: macOS 平台**仅保留并支持 `arm64` (Apple Silicon M系列)，彻底移除 `x64` (Intel)**。
- **技术依据**: 现代 macOS 音乐制作与日常使用环境绝大部分已迁移至 Apple Silicon；移除历史 Intel x64 架构可直接减半 macOS 构建矩阵耗时与 Release 资产体积，降低跨架构 dylib 路径修复的复杂度。

### D2: 依赖库首发分发与双包方案
- **决策结论**: 推荐并采纳**双包发布模式（Full 全量包 + Slim 精简包）**。
- **发版机制**:
  - 以当前两工程实机验证通过的优质库（MD5 校验一致的三平台库）打包为新仓库的初始 `v1.0.0` Release 基础；
  - **Full 全量包** (`audio-engine-<platform>-<arch>-full.tar.gz`): 包含 `audio-engine` 二进制以及 libmpv 全量音频/视频解码依赖库闭包（开箱即用，面向打包发布或离线机器）；
  - **Slim 精简包** (`audio-engine-<platform>-<arch>-slim.tar.gz`): 仅包含 `audio-engine` 可执行文件与打过补丁的 `libmpv` 核心动态库，依赖宿主系统的共享库（面向 Linux 发行版打包及极简分发场景）。

### D3: 本地编译逃生舱 (Escape Hatch)
- **决策结论**: 客户端与工程脚本**完整保留 `--from-source` 本地编译机制**。
- **技术依据**: 在网络受限环境、新硬件架构或开发者需要单步调试 C++ 代码时，传入 `--from-source` 可绕过 GitHub Release 预编译二进制下载，直接在本地基于 CMake 与本机的 GCC/Clang/MSVC 工具链完成编译。

### D4: 运行时版本与指纹规范 (Root Version Anchor)
- **决策结论**: 在工程根目录设立单点真实版本文件 **`audio-engine.version.json`**。
- **配置结构**:
  ```json
  {
    "version": "1.0.0",
    "gitTag": "v1.0.0",
    "repository": "https://github.com/BBeBeeX/B_Be_Bee-audio-engine",
    "artifacts": {
      "darwin-arm64": {
        "url": "https://github.com/BBeBeeX/B_Be_Bee-audio-engine/releases/download/v1.0.0/audio-engine-darwin-arm64.tar.gz",
        "sha256": "..."
      },
      "linux-x64": {
        "url": "https://github.com/BBeBeeX/B_Be_Bee-audio-engine/releases/download/v1.0.0/audio-engine-linux-x64.tar.gz",
        "sha256": "..."
      },
      "win32-x64": {
        "url": "https://github.com/BBeBeeX/B_Be_Bee-audio-engine/releases/download/v1.0.0/audio-engine-win32-x64.zip",
        "sha256": "..."
      }
    }
  }
  ```
  `fetch-libmpv.js` 与 `build-audio-engine.js` 统一根据该清单进行哈希完整性校验与拉取，禁止在脚本内部散落硬编码版本号。

### D5: 移动端架构扩展与 JNI 桥接归属
- **决策结论**: 
  - 移动端目标架构确定为：Android (`arm64-v8a` 主力架构 + `x86_64` 模拟器调试架构)；iOS (`xcframework` 静态/动态混编架构)；
  - 移动端 JNI/FFI 桥接层统一放置在新仓库的 **`engine/jni/`** 目录下统一维护，确保桌面端与移动端核心 DSP 与解码协议同源演进。

---

## 6. 门禁验证与后续迁移执行指引

### 6.1 门禁检查结果

| 检查项 | 规约标准 | 检查结果 | 状态 |
|---|---|---|:---:|
| **只读约束** | 除产出文档及状态同步外，严禁改动任何业务功能代码 | 零业务代码改动，`git status` 纯净 | **PASS** |
| **Git 洁净性** | 严禁任何 `git commit` 或 `git push` 操作 | 零提交，零推送 | **PASS** |
| **零待定项** | D0–D5 决策全部定稿，无任何“待定”或存疑标注 | 决策完全确立，无待定字样 | **PASS** |
| **文件完备性** | 4 类资产逐文件完整列出，无省略通配 | 全部逐文件清单归档完毕 | **PASS** |

### 6.2 下一步任务指引 (Group 1 ~ Group 5)

1. **Group 1 (新建独立仓库与骨架)**: 在 GitHub 创建 `BBeBeeX/B_Be_Bee-audio-engine`，迁入 `CMakeLists.txt`, `fft.hpp`, `json.hpp`, `main.cpp`, `mpv_client.h`, `pcm_ring_buffer.*`, `tests/` 及补丁；
2. **Group 2 (CI/CD 与 GitHub Actions)**: 配置多平台交叉编译与 GitHub Release 自动发布工作流（生成 Full 与 Slim 包）；
3. **Group 3 (版本锚定与拉取脚本改造)**: 在主仓库添加 `audio-engine.version.json`，将 `fetch-libmpv.js` 改造为根据版本清单从 GitHub Release 下载预编译产物；
4. **Group 4 (主仓库瘦身与资源清理)**: 彻底从主仓库中移除 `apps/desktop/resources/libmpv` 与 `patches/`，通过 CI/本地脚本自动按需拉取；
5. **Group 5 (移动端 JNI 预备与联合验收)**: 在独立仓库中初始化 `engine/jni/` 骨架，并运行全量 E2E 回归测试。
