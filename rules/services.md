# Core Services & Platform Rules

Rules governing Layer 2 core services and platform integration in BBeBee.

---

## 1. Core Services Philosophy

- **No package outside `packages/core/*` may import a platform SDK.**
  Not `expo-*`, not `react-native` native modules, not `electron`, not `node:*`.
- **A core plugin holds no domain knowledge.**
  `ctx.fs` moves bytes, `ctx.db` runs SQL, neither knows what a track is.
- If a feature needs a platform capability not covered, the answer is to add a core service, never to import a platform SDK into feature code.

---

## 2. Standard Service Keys

Declared in `packages/protocol/src/services/` and augmented onto `Context`:

| Service Key | Meaning | Platform Implementations |
|---|---|---|
| `ctx.fs` | File I/O over opaque `Uri` strings | `core-fs-node` (desktop), `core-fs-expo` (mobile) |
| `ctx.paths` | Well-known directories (`data`, `cache`, `temp`, `music`, `downloads`, `logs`) | `core-paths-node`, `core-paths-expo` |
| `ctx.store` | Key-value config persistence | `core-store-fs` (shared) |
| `ctx.db` | SQLite database with WAL and transactions | `core-db-node` (desktop), `core-db-expo` (mobile) |
| `ctx.secrets` | Keychain and hardware-backed credential storage | `core-secrets-node`, `core-secrets-expo` |
| `ctx.http` | Outbound HTTP with cookie jar and isolation | `core-http-node`, `core-http-rn` |
| `ctx.ws` | WebSocket client with capability host checks | `core-http-node` / native |
| `ctx.audio` | Web Audio API graph (`AudioContext`, DSP nodes) | `core-audio-webaudio` (shared), `core-audio-mpv` (desktop libmpv native engine in a crash-isolated subprocess, direct OS audio output, append-based gapless, audio-level spectrum) |
| `ctx.codec` | Audio metadata, tag reading, PCM decoding | `core-codec-node` (desktop FFmpeg bridge + music-metadata), `core-codec-rn` |
| `ctx.device` | Network status, battery, media keys, platform info | `core-device-electron`, `core-device-expo` |
| `ctx.mediaSession`| OS lock-screen now playing surface and controls | `core-media-session-electron`, `core-media-session-rn` |
| `ctx.background` | Background audio tasks, wake locks, suspend hooks | `core-background-electron`, `core-background-expo` |
| `ctx.js` | Sandboxed QuickJS evaluator for untrusted scripts | `core-js-quickjs-node` (desktop) |
| `ctx.shell` | Open external URL, directory pickers | Desktop bridge, mobile intent |
| `ctx.settings` | User app settings (theme, audio engine, shortcuts) | `plugin-settings` (feature service with store persistence) |
| `ctx.theme` | Theme registry, token injection, dynamic theme management | `plugin-theme` (feature service with DOM/store sync) |
| `ctx.share` | Metadata serialization, image steganography, track/playlist/album/lyrics sharing | `plugin-share` (headless service), `plugin-share-ui-desktop` (views) |
| `ctx.logger` | Scoped diagnostic logging via Cordis | Core service / Cordis native |

---

## 3. Opaque URIs and Paths

- Plugins never handle raw filesystem absolute paths.
- Plugins ask `ctx.paths` for a well-known directory (`data | cache | temp | music | downloads | logs`) and resolve relative to it:
  ```ts
  const uri = ctx.paths.resolve('cache', 'covers/album-123.jpg')
  await ctx.fs.writeFile(uri, bytes)
  ```

---

## 4. Layer 3: Log Transports

- **Only Layer 3 plugins may write to console.**
  `plugin-log-console` writes to `console`.
  `plugin-log-buffer` maintains a ring buffer for crash reports and in-app log viewer.
  `plugin-log-file` writes rotating log files via `ctx.fs`.
- Feature and UI plugins MUST log through `ctx.logger.info(...)`, `ctx.logger.warn(...)`, `ctx.logger.error(...)`.
- `console.log` in Layer 4 and 5 is an ESLint build error.

---

## 5. Startup & Initialization Performance

- **Preloaded Store data:** If the composition root pre-reads `store.json` at boot (e.g. to inspect audio output engine preferences before service instantiation), pass `StoreConfig.initialData` to seed the in-memory document, eliminating duplicate disk reads.
- **Lazy WASM compilation in `core-js-quickjs-node`:** `[Service.init]()` returns immediately; WASM is compiled on first `createRealm()` invocation.
- **Non-blocking background tasks:** Heavy I/O initialization such as initial cache sweep in `plugin-cache` must be deferred to background timers (e.g. 5s post-boot) rather than blocking `init()`.

---

## 6. Live Audio Stream & Metadata Introspection

- **`ctx.codec.readMetadata(uri)` returns `tagTypes`:** Tag readers populate `AudioMetadata.tagTypes` (e.g. `['ID3v2.3']`, `['Vorbis']`, `['APEv2']`), allowing the UI to present authentic tag formats to the user without redundant parsing.
- **`ctx.player.currentStream`:** The player service exposes the active stream handle (`StreamHandle`) for the currently attached source (carrying format, codec, sample rate, channels, bitrate, and byte length). This allows UI components like `TrackInfoModal` to display technical specifications for third-party network streams that lack local filesystem bindings.


