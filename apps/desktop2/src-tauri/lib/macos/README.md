# macOS (darwin)

This directory currently holds no committed `libmpv.dylib`: macOS brew builds reference their own dependencies by absolute path (`/opt/homebrew/opt/...`), so committing them without rewriting via `install_name_tool` is not portable, and this repo's Linux development environment cannot produce signed/link-tidied macOS libraries.

How to obtain it (by priority):

1. **CI macos job**: after `brew install mpv`, `scripts/fetch-libmpv.js` stages the library into this directory and it ships with electron-builder packaging (its dependency closure needs handling too — the transitive dependencies of brew artifacts also reference brew paths; if needed, complete the set into the same directory using an `install_name_tool`/`otool -L` inventory).
2. Local development: after `brew install mpv`, the engine finds `libmpv.dylib` directly on the system library path; this directory is not needed.

Once `libmpv.dylib` (and its dependencies) are in place, `build-audio-engine.js` stages them into `bin/` and `resources/bin/` as well.
