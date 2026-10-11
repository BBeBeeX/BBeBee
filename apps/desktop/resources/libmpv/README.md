# Vendored libmpv (per-platform libmpv runtime libraries)

This directory is a **source-controllable libmpv distribution**: the build scripts copy it next to the engine binary (`bin/` and `resources/bin/`), so neither local testing nor packaging depends on whether libmpv is installed on the system.

## Layout and provenance

| Directory | Files | Source | Notes |
|---|---|---|---|
| `win64/` | `libmpv-2.dll` | **mpv-dev-lgpl-x86_64** from [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) `2026-09-30-3186d369f9` (LGPL build, fully static) | Zero system dependencies on Windows; works as-is |
| `linux/` | `libmpv.so.2` and 8 more libraries | The **incremental set** from Debian trixie `libmpv2 0.40.0-3+deb13u1` (the parts beyond mpv2's official dependency stack that the system does not ship by default: libavdevice61, libcdio*, libmujs3, liblua5.2, libsixel1, libXpresent1) | Needs the base stack (libavcodec61 etc.) provided by the distro (`apt install libmpv2` fills it in); Linux libraries are tied to the distro's glibc/libav versions and do not port across distros |
| `darwin/` | (empty) | No local macOS build environment; CI's macos job stages it via `brew install mpv`, or drop a `libmpv.dylib` in manually | brew artifacts reference absolute paths, so committing them as-is is not portable |

## How it is consumed

- After compiling the engine, `build-audio-engine.js` automatically copies the **current platform's** libraries from this directory into `bin/` and `resources/bin/` — local `pnpm dev:desktop` and electron-builder packaging both take them from there.
- `scripts/fetch-libmpv.js` is the **fallback path**: it is only used on CI to fill the gap when this directory has no libraries for the platform (system search → prebuilt download).

## Licensing notes

- `win64/` is an LGPL-built dynamic library: when embedded into the app via dynamic linking, it is enough to preserve mpv's source-availability channel as LGPL requires.
- The Debian `libmpv2` under `linux/` is a **GPL build**: redistributing it with the app means honoring the corresponding GPL obligations; for lighter obligations, switch to the upstream LGPL build or self-compile with `--enable-lgpl`.
