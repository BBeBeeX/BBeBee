# Vendored Native Libraries (`apps/desktop2/src-tauri/lib`)

This directory houses the vendored native shared libraries and dependencies required by BBeBee Desktop's native audio engine (`audio-engine` + `libmpv`) and native windowing across platforms.

---

## 1. Directory Structure

```
apps/desktop2/src-tauri/lib/
├── windows/ (alias: win64/)
│   ├── libmpv-2.dll, mpv-2.dll
│   ├── avcodec-63.dll, avformat-63.dll, avutil-61.dll, swresample-7.dll, swscale-10.dll, avfilter-12.dll
│   └── 110 supporting codec, crypto, and font libraries
├── macos/ (alias: darwin/)
│   ├── libmpv.2.dylib
│   └── libmpv.dylib -> libmpv.2.dylib
├── linux/
│   ├── libmpv.so.2 (and libmpv.so, libmpv.so.2.5.0)
│   ├── libavcodec.so.60, libavformat.so.60, libavutil.so.58, libswresample.so.4, libavfilter.so.9
│   ├── libasound.so.2, libpulse.so.0, libpipewire-0.3.so.0, libsndio.so.7
│   └── 180 audio codec, container, compression, and math libraries
└── lib*.so (root-level build-time symlinks for Linux cargo linking)
```

---

## 2. Dependency Audit & Pruning

To keep the application lean, prevent version collisions with the host operating system, and avoid shipping irrelevant drivers, all dependencies were audited and pruned:

### A. Windows (`windows/` / `win64/`)
- **Staged**: 116 libraries.
- **Pruned (9 Windows System32 DLLs)**:
  - `DWrite.dll` (DirectWrite system typography engine)
  - `gdiplus.dll` (Windows GDI+ system graphics)
  - `AVICAP32.dll` (Windows Video Capture API)
  - `MSVFW32.dll` (Microsoft Video for Windows system library)
  - `MSIMG32.dll` (Windows GDI surface routines)
  - `USP10.dll` (Windows Uniscribe script engine)
  - `ncrypt.dll` (Windows CNG cryptographic services)
  - `bcryptprimitives.dll` (Windows BCrypt primitives)
  - `msvcp_win.dll` (Windows C++ runtime system component)
  *Rationale*: These libraries are integral components of the Windows operating system located in `C:\Windows\System32`. Bundling them causes DLL hijacking risks and crashes across different Windows release versions.

### B. macOS (`macos/` / `darwin/`)
- **Staged**: `libmpv.2.dylib` and `libmpv.dylib` (symlink).
- *Rationale*: macOS uses system CoreAudio and Apple frameworks natively; `libmpv.dylib` is dynamically loaded via `dlopen` without third-party host collisions.

### C. Linux (`linux/`)
- **Staged**: 193 libraries.
- **Pruned (21 Host Driver & Conflicting System Libraries)**:
  - `libGL.so.1`, `libGLX.so.0`, `libGLdispatch.so.0` (Host OpenGL graphics drivers - bundling breaks with proprietary NVIDIA or Mesa host drivers)
  - `libvulkan.so.1` (Host Vulkan driver loader)
  - `libsystemd.so.0`, `libudev.so.1` (Host init and device daemon libraries)
  - `libapparmor.so.1`, `libselinux.so.1` (Host security modules)
  - `libmount.so.1`, `libblkid.so.1` (Host kernel mount and block device utilities)
  - `libraw1394.so.11`, `librom1394.so.0`, `libavc1394.so.0` (Legacy FireWire camcorder drivers)
  - `librabbitmq.so.4` (AMQP message broker client - irrelevant for audio player)
  - `libpocketsphinx.so.3`, `libsphinxbase.so.3` (CMU Sphinx speech-to-text recognition)
  - `libOpenCL.so.1` (OpenCL GPU compute)
  - `libcaca.so.0`, `libslang.so.2` (ASCII art console video rendering)
  - `libnorm.so.1` (NRL NORM multicast transport)
  - `libnuma.so.1` (NUMA multi-socket server memory architecture)
  *Rationale*: Bundling hardware drivers, display servers, or system daemons causes severe crashes across different Linux distributions. Only audio decoders, demuxers, audio output stacks, and essential codecs are retained.

---

## 3. Build & Packaging Integration

- **Audio Engine Build**: `apps/desktop2/scripts/build-audio-engine.js` automatically copies the current platform's libraries from `resources/libmpv/<platform>` (which links to `src-tauri/lib/<platform>`) into `bin/` and `resources/bin/`.
- **Tauri Bundle**: `apps/desktop2/src-tauri/tauri.conf.json` packages `bin/*` and `resources/bin/*` into production distribution bundles (`.deb`, `.appimage`, `.nsis`, `.dmg`).
