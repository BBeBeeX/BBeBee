# Testing, Gotchas & Status

Test conventions, common gotchas, and milestone status for BBeBee.

---

## 1. Testing Strategy

| Layer | What It Covers |
|---|---|
| **Unit** | Pure logic: URN parsing, fractional indexing, transport state machine with mock audio |
| **Conformance** | Shared test suite in `packages/protocol/src/conformance/` run against all `core-*` implementations |
| **Integration** | Real Cordis context, real feature plugins, fake core services |
| **Source Corpus** | Replay fixtures in `fixtures/sources/` through `plugin-source-runtime` |
| **Leak Test** | Parameterized snapshot comparison before load and after dispose across every plugin |

### What Each Gate Catches
- `no-restricted-imports`: Reaching for platform SDKs instead of `ctx.*`
- Conformance suites: Divergence between Node and Expo implementations of core services
- Leak test: Plugins that leave event listeners, timers, or fibers behind after unload
- `conventions.test.ts`: Un-awaited `ctx.plugin()` calls or non-async `apply` functions
- `layers.test.ts`: Kernel plugin surface allowlist drift, unauthorized `createApp` calls

---

## 2. Common Gotchas

| Symptom | Cause & Solution |
|---|---|
| Metro: cannot resolve `cordis` | Missing `unstable_enablePackageExports` in `metro.config.js` |
| `@Inject` fails at runtime, compiles | Legacy decorator flags in tsconfig. Babel needs `{ version: '2023-11' }` |
| A plugin sits in `PENDING` forever | An injected service never arrived. Check `ctx.inspector` or missing service key |
| `app.start()` resolves but service not ready | Un-awaited `ctx.plugin()` in an apply function |
| `TypeError: app.inject is not a function` | `createApp()` returns `App` (`{ ctx, start, ... }`). Use `app.ctx.inject(...)` |
| `ReferenceError: process is not defined` | Vite/Electron renderer sandbox lacks Node globals. Guard with `typeof process !== 'undefined'` or use `window.BBeBee` / `ctx.device` |
| `Type '() => boolean' not assignable to Destructor` | React 19 `useEffect` cleanup requires `void`. Wrap Cordis disposers: `return () => { off() }` |
| `cannot get property "x" without inject` | Direct access to undeclared service on scoped context throws. Use `serviceOf<T>(ctx, key)` in UI components |
| Window close leaves app running in background | Secondary windows (e.g. `lyricWindow`) keep loop active when `closeToTray: false`. Call `app.quit()` explicitly on main close |
| Plugin still active after unload | Disposer returned through proxy was not wrapped in local closure |
| `CapabilityError: … may not …` | Capability missing in manifest or unauthorized namespace. Widen manifest, never the gate |
| `CapabilityError: host … not allowed` | Source rule accessed undeclared host. Add host to `allowedHosts` |
| Test fails with `Element is not defined` | Missing `// @vitest-environment jsdom` comment at the top of test file |
| `Error occurred in handler for 'BBeBee:call': EPERM ...` | Windows legacy junction points (`Documents\My Music`) have Deny Read ACLs. `FsNode.list` probes directory symlinks with `opendir` to skip unreadable ones; IPC bridge wraps calls in `BridgeEnvelope` to prevent Electron from logging unhandled rejections. |
| UI test fails asserting icon text (e.g. `textContent === '♥'`) | Desktop icons render Tabler SVG elements with `data-icon="{name}"`. Query with `container.querySelector('[data-icon="heart"]')` or `data-testid` instead of asserting against text node content. |
| `refusing to fetch bbebee-file://` or `Fetch API cannot load file://` | Electron Chromium web security restricts renderer `fetch()` on `file://` URLs. Desktop main registers privileged `bbebee-file://` scheme to stream and buffer local files. |
| `Unable to decode audio data` (24-bit FLAC / ID3v2 tags) | Chromium's Web Audio `decodeAudioData` rejects 24-bit Hi-Res FLAC or ID3v2 chunks. `core-audio-webaudio` intercepts this and falls back to `loadStreamed` via Chromium's internal FFmpeg `<audio>` element. |
| Clicking a track in Shuffle mode plays the wrong song | Shuffled order is a seeded permutation (`permute(ids, seed)`). Tapping a specific track must call `model.rotateShuffle(firstId)` to circularly rotate the permutation with the clicked track at index 0, rather than indexing into `order()[index]`. |
| Play button or surface has transparent background with CSS variable | `backgroundColor: 'var(--button-primary-bg)'` is invalid in CSS engines when the variable resolves to a `linear-gradient(...)`. CSS silently discards gradients on `backgroundColor`. Always use `background: var(...)` shorthand whenever tokens can be gradients. |
| Custom theme import crashes UI with undefined property errors | User-imported theme JSON may supply partial token trees. Always deep-merge imported tokens over `midnightPurpleTheme.tokens` before registration so all token branches (`bg`, `surface`, `brand`, `gradient`, `text`, `border`, `semantic`, `music`, `glow`) are guaranteed defined. |
| Cannot remove theme or active theme orphaned | `removeTheme(id)` must strictly protect built-in themes (`midnight-purple`, `spotify`). If the deleted theme was active, immediately fallback to default (`midnight-purple`) and emit `theme/registry-changed`. |
| Unfavouriting a track leaves the row showing a heart instead of a plus | A favourite lives in two stores — `track_stats.loved` (draws the heart) and `library_items` (drives the shelf). Every writer must write **both** (`sources.setLoved` first, then `library.setSaved`); a writer touching only one — e.g. the popover's liked toggle — leaves them disagreeing. Rows must also derive `inLibrary` from live data (`useTrackLibraryInfo`: real-time saved set + loved re-read on `library/changed`), never a hardcoded `true` or a mount-time `track.loved` snapshot, and optimistic heart state must reset when the authoritative prop changes. |
| Collapsing detail-page sticky bar scrolls away mid-scroll; virtualised rows offset by the header height | `position: sticky` only sticks within its parent's box — the bar must be the scroll container's **direct child** (the `List`'s `sticky` slot, not nested in `header`). The virtualiser also needs the header's measured height as `scrollMargin` (the kit measures it; passing rows a raw `translateY(row.start)` without subtracting it miswindows every row). |
| Context menu / popover opens but is invisible or appears at the wrong place | An ancestor with a `transform` (slide-in footers) re-anchors `position: fixed` descendants to itself, and `overflow: hidden` on it clips them — the fullscreen play page's hover bottom bar is exactly this. Render the menu through a portal: `ContextMenu`/`SaveToPlaylistPopover` take `portal: true` (the shell's fullscreen bar passes it as `portalMenus`), which mounts the overlay on `document.body`. |
| Page state (scroll, local state, subscriptions) resets after visiting the fullscreen play page | The play page must be an **overlay on the always-mounted shell** (fixed, opaque, late child of the shell root), never an early-return branch swap — a swap unmounts every cached page and remounts it on return. If page state evaporates, check that `isFullscreenNowPlaying` toggles an overlay and not which tree the shell `return`s ([ui/architecture.md §7.1](../docs/ui/architecture.md#71-the-shell-is-a-viewport-not-a-router)). |
| Mobile test: clicking any button inside a `Sheet` makes the whole sheet vanish (queries then fail with an empty container) | `Sheet`'s backdrop `Pressable` carries `onPress: onClose`, and the inner panel blocks it only through RN's responder semantics (a press belongs to the deepest Pressable, ancestors never see it). A DOM host stub wires `onPress` to `onClick`, and DOM clicks **bubble** — so a button press also presses the backdrop behind it. In the test's `Pressable` stub call `e.stopPropagation()` before `onPress` (`plugin-share-ui-mobile/src/index.test.tsx` does this); don't "fix" it in the kit — on a real device the behaviour is correct. |
| Renderer IPC call throws on early boot before bridge finishes | Creating `BrowserWindow` before `createHost` finishes async setup allows the renderer to invoke IPC early. `createHost` arms an `isReady` promise gate inside `ipc.handle('BBeBee:call')` to transparently queue calls until the bridge host is fully initialized. |
| CSP `script-src 'self'` blocks inline scripts in index.html | Inline `<script>` tags violate strict CSP unless hashed or allowlisted. Window initialization code (theme/transparency) is extracted to external `<script type="module" src="./window-init.ts">`. |
| `ffmpeg decode failed ... No such file or directory` on a local track | `bbebee-file://` URIs percent-encode the on-disk name. Every consumer must decode before opening (`toNativePath` in `apps/desktop/main/fs-path.ts`): ffmpeg fed the encoded bytes verbatim fails on names with spaces/NBSP/non-ASCII while the protocol handler plays the same file. |
| `ffmpeg decode failed ... 403 Forbidden` on remote sources | Streaming CDNs (bilibili's among them) require the source's `Referer`/`User-Agent`. `decodePcm`/`probe` forward `opts.headers` and ffmpeg gets them via `-user_agent`/`-headers` for `http(s)` inputs; a call that drops the headers dies on the CDN and falls back to full-file `decodeAudioData`. |
| Cold boot disk I/O contention during plugin initialization | Running unthrottled cache sweeps during plugin `init()` blocks startup I/O. `plugin-cache` defers its initial sweep to a 5-second background timer. Similarly, `StoreConfig.initialData` seeds pre-read configuration to eliminate duplicate disk reads. |
| Layer 5 UI view imports `App` type from `@BBeBee/kernel` triggering `KERNEL_GUARD` | Only composition root files (`apps/*/src/{boot,plugins}.ts` and `apps/desktop/renderer/main.tsx`) may touch kernel application primitives. Deferred plugin loading via `app.loadPlugin()` belongs in `apps/desktop/renderer/main.tsx` (`requestIdleCallback`) rather than inside Layer 5 UI views. |
| Audio plays at 100% volume on launch despite bottom bar showing lower level | When `plugin-dsp` rebuilds effect graph at boot, `dipVolume(20)` must not capture a stale gain (1.0) and restore over volume set by `plugin-player`. Core audio services maintain `targetVolume`, cancel scheduled automations on `setVolume`, and `plugin-player` re-synchronizes audio volume both in `restore()` and before `source.play()` in `attach()`. |
| `serviceOf(ctx, key)` in React hook dependencies triggers infinite loop / OOM | `serviceOf(ctx, key)` creates a new Cordis proxy instance on scoped contexts. Placing it in `useEffect` or `useCallback` dependency arrays creates a new reference on every render, triggering an infinite loop and Node out-of-memory crash. Resolve `serviceOf` inside the effect body, or depend only on stable primitives (`ctx`, `urn`). |
| Virtualized List `onEndReached` triggers infinite loadMore loop | When list rows fit entirely within the scroll viewport, naive scroll listeners trigger `onEndReached` on initial mount. Pass `pageSize` to `List` so it calculates `thresholdIndex` at the halfway mark of the last page, checks `scrollTop + clientHeight >= halfwayOffset`, and tracks `firedFor.current = count` to prevent duplicate triggers. |
| libavfilter filter parameter errors (`crossfeed` / `aecho`) | In native DSP effect chains (`buildLavfi`), FFmpeg's `crossfeed` filter expects `range` normalized in `[0, 1]` (not raw Hz > 1); `aecho` requires both `delays` and `decays` parameters with attenuated `out_gain` (< 1.0) to prevent clipping warnings and initialization failure. |
| WASAPI Exclusive Mode blocks concurrent system audio | When `audioExclusive: true` is enabled in MPV Hi-Fi mode on Windows, the output audio device is seized exclusively by the native engine process for bit-perfect output. Other OS applications cannot output audio concurrently until playback pauses/stops or exclusive mode is toggled off. |
| Every pane's scrollbar is visible all the time (or `:hover`-styled scrollbars never hide) | Chromium evaluates `::-webkit-scrollbar-*` part styles **without the owner element's `:hover` state**, so `*:hover::-webkit-scrollbar-thumb` paints the "hover" variant on every pane at once; a document-wide `html.is-scrolling` flag does the same during any scroll. Scrollbar visibility must be driven by plain classes on the scroll container: `is-scrollbar-hover` (deepest scrollable ancestor under the pointer, set from `mouseover` in `apps/desktop/renderer/main.tsx`) and `is-scrolling` (self-cleared 1.2s after that pane's last scroll event). |
| Playback suddenly jumps to 0:00 with no sound on a network source | A source that dies **mid-track** (CDN cut, expired URL, dead cache file) must surface as `onStalled(true)` — the player's stall watchdog turns it into a retryable network error at the frozen position. Reporting it as `onEnded` made the player skip ahead as if the track completed, and the next track, facing the same broken network, sat silent at 0:00. Both engines honour this: the webaudio `StreamedHandle` classifies element errors by whether the track ever sounded, and the mpv `MpvSourceHandle` reads the engine's `status: 'error'` playback state (which the native engine now pushes on `MPV_END_FILE_REASON_ERROR` — without that push the poll saw a frozen `playing` forever). The mpv path additionally drops nothing: load/append commands carry the source's headers (`main.cpp` `applyNetworkOptions` — without them some CDNs 403 only under mpv), and a re-bound gapless handle ignores the caller's default `play(0)` so the auto-advanced file is not seeked back to zero. |
| libmpv audio visualizer sync & PCM capture | Standard libmpv has no public PCM callback without breaking AO (`ao=pcm` breaks physical sound card output). The native engine dynamically probes `mpv_set_pcm_callback` (supported in patched builds) and writes frames into an SPSC lock-free `PcmRingBuffer` (64-byte aligned, zero malloc/locks in audio thread). The visualizer loop drains backlog exceeding 60 ms to avoid latency drift against speakers. On standard unpatched libmpv, the engine safely falls back to quiet/zero-padded frames without artificial sine/cosine generation or audio thread blocking. Two liveness rules keep the tap → ring buffer → FFT gate alive, both learned from a shipped wedge (a working tap, 65536 frames written, 0 read, all-zero spectrum): (1) `PcmRingBuffer.clear()` is a deferred flag consumed only inside `read()`/`discardExcessFrames()` — `availableFrames()` must never short-circuit to 0 on a pending clear, or any clear raised outside the consumer (`play` with a position, `seek`) wedges the visualizer at zero forever; the visualizer loop also flushes stale PCM only on its playing → idle edge, not every 30 ms tick of silence. (2) The ring buffer is configured from `audio-out-params/*` (the AO/device format the tap actually delivers), never `audio-params/*` (the decoder's): mpv resamples and mixes between the two, so a 44.1 kHz file on a 48 kHz device or a mono → stereo upmix reported as `audio-params` makes the write-side format-mismatch guard silently drop every tapped frame. |
| Hardcoding `#FFFFFF` or `#000000` text in Layer 5 UI views breaks Light Mode contrast | Hardcoded `#FFFFFF` text becomes invisible against light backgrounds (`#F7F7F8` / `#FAFAFA`). Always use semantic tokens (`var(--bb-text-primary, #FFFFFF)`, `var(--bb-text-secondary, #8E8E93)`, etc.). Exception: Fixed dark containers (Dynamic Island `#000000`, translucent HUD floating window, danger badge) must preserve contrast via `var(--bb-accent-on, #FFFFFF)` or white foregrounds — do not change text inside fixed black containers to `var(--bb-text-primary)` which would turn dark-on-black in light mode. |

---

## 3. Current Project Status & Known Reality

- **M0, M1, M2, M3, M4 built**:
  - Core services across desktop (Electron/Node) and mobile (Expo/RN)
  - Audio playback with Web Audio DSP chain (EQ, normalize, compressor, reverb)
  - Music sources runtime, QuickJS sandbox, rules, sources UI
  - Curation: library, playlists, downloads, cache, lyrics, desktop lyrics
  - Dynamic plugin loading with code-splitting
- **Known gaps**:
  - `core-js-quickjs-expo` not built (mobile currently has no QuickJS sandbox)
  - `@css:` and `@xpath:` rule engines are stubbed
  - Download policies do not have per-policy scopes yet
- **Differences from early docs**:
  - No Turborepo / `turbo.json`: Monorepo uses `pnpm -r`.
  - Layers 0 and 1 are single packages: `packages/protocol/` and `packages/kernel/`.
  - Versions: Node 22.12+, pnpm 11+, TypeScript 5.9.3, cordis 4.0.0-rc.9 pinned.
