# Developer Audio Engine Platform Resources

This directory contains platform-specific native binaries and dependency libraries used for local debugging, testing, and packaging:

- `resources/linux/`: Linux `audio-engine` executable (x64) and runtime libraries (`libmpv.so.2`, etc.)
- `resources/macos/`: macOS `audio-engine` executable (arm64) and dynamic libraries (`libmpv.2.dylib`, etc.)
- `resources/windows/`: Windows `audio-engine.exe` (x64) and dynamic libraries (`mpv-2.dll` / `libmpv-2.dll`, etc.)

Developers can build or place binaries directly here, or populate them automatically via:
```bash
node scripts/fetch-audio-engine.mjs --app desktop
```

> **Note**: These directories are gitignored to prevent checking compiled native binaries into version control.
