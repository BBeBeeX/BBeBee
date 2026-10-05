# Audio Engine & Web Audio Core

> **Legacy Reference:** Formerly `docs/05-audio-playback.md §1`.

> **What this answers.** How sound actually gets made: the audio engine contract, the transport
> and queue state machine, how DSP effects compose into a chain, and how playback survives
> interruptions, route changes, and being backgrounded.

Three services, layered:

```mermaid
flowchart LR
    P["ctx.player<br/>queue · transport · history"] --> D["ctx.dsp<br/>effect chain"]
    D --> A["ctx.audio<br/>Web Audio graph"]
    A --> O(("output"))
    P -.->|resolves via| S["ctx.sources"]
    P -.->|publishes to| M["ctx.mediaSession"]
```

`ctx.player` decides *what* plays. `ctx.dsp` decides *how it sounds*. `ctx.audio` owns the graph
and is the only thing that touches the platform.

---

## 1. `ctx.audio` — the engine

Per [ADR-4](../architecture/overview.md#adr-4--react-native-audio-api-is-the-primary-playback-and-dsp-engine-on-every-target),
the contract **is** the Web Audio API. `react-native-audio-api` implements it on iOS and Android
and ships a web build for the Electron renderer, so one graph description runs everywhere.

```ts
import type { Uri, Disposable } from '@BBeBee/protocol'

export interface AudioSourceHandle {
  readonly node: AudioNode
  readonly durationMs: number
  play(atMs?: number): void
  pause(): void
  stop(): void
  readonly positionMs: number
  /** Fires when the source reaches its natural end. */
  onEnded(cb: () => void): Disposable
  dispose(): void
}

export interface LoadOptions {
  /** Streaming keeps memory flat; buffered enables sample-accurate gapless. */
  strategy: 'stream' | 'buffer'
  headers?: Record<string, string>
  signal?: AbortSignal
  onBuffered?: (seconds: number) => void
}

export interface AudioService {
  readonly context: BaseAudioContext
  readonly destination: AudioNode
  readonly sampleRate: number
  readonly outputLatencyMs: number

  /** Load a remote URL or a local Uri into a playable source node. */
  load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle>

  /** Where ctx.dsp inserts its chain. Sources connect here, not to destination. */
  readonly chainInput: AudioNode
  /** Where ctx.dsp connects back to the master output. */
  readonly chainOutput?: AudioNode
  /** Dip master volume smoothly over durationMs (default 20ms) to prevent clicks during rewiring. */
  dipVolume?(durationMs?: number): Promise<Disposable>

  setVolume(v: number): void         // 0..1, applied post-chain
  setMuted(m: boolean): void

  listOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]>
  setOutputDevice(id: string): Promise<void>
  /** Configure exclusive mode for native audio backend (e.g. MPV WASAPI exclusive). */
  setAudioExclusive?(exclusive: boolean): Promise<void>
  /** Native-engine health (process alive, libmpv loaded). Absent = always-native engine. */
  getEngineStatus?(): Promise<{ running: boolean; mpvAvailable: boolean }>

  /** Interruptions, route changes, focus loss. See §5. */
  onInterruption(cb: (e: { type: 'began' | 'ended'; shouldResume: boolean }) => void): Disposable
  onRouteChange(cb: (e: { reason: 'device-removed' | 'device-added' | 'override' }) => void): Disposable
}
```

### Graph topology

```mermaid
flowchart LR
    S1["source A<br/>(current)"] --> CI["chainInput<br/>GainNode"]
    S2["source B<br/>(prefetched)"] -.->|connects at swap| CI
    CI --> E1["effect: preamp"]
    E1 --> E2["effect: EQ (10 × Biquad)"]
    E2 --> E3["effect: normalize"]
    E3 --> E4["effect: compressor"]
    E4 --> MV["master volume"]
    MV --> AN["AnalyserNode<br/>(visualiser tap)"]
    AN --> DST["destination"]
```

`chainInput` exists so that sources come and go without ever touching the effect chain, and
effects are rebuilt without ever touching a playing source. The two lifetimes are decoupled.

### Load strategies & resilient fallback

`ctx.audio.load(src, { strategy })` implements two distinct loading pathways:
- **`strategy: 'buffer'`**: Fetches binary bytes into an `ArrayBuffer` and decodes with `context.decodeAudioData()`. Creates an `AudioBufferSourceNode` connected to `chainInput`. Provides sample-accurate scheduling for prefetching and gapless track transitions.
- **`strategy: 'stream'`**: Binds to a media element (`HTMLMediaElement`) via `context.createMediaElementSource()`. Keeps memory footprint constant regardless of track length and supports progressive buffering.
- **Decode Fallback**: when `decodeAudioData()` fails on a format it cannot decode (ALAC in `.m4a`, Hi-Res FLAC, ID3v2-prefixed headers — `Unable to decode audio data`), `core-audio-webaudio` degrades to the media element, whose decoder coverage differs from `decodeAudioData`'s — ALAC and 24-bit FLAC included. Request headers reach the element through the per-host registration the player performs via `stream.setHeaders`.
- **Desktop Native Hi-Fi Engine (`@BBeBee/core-audio-mpv`)**:
  One of the two desktop engines. Powered by official libmpv running in an independent standalone native `audio-engine` executable binary for crash isolation.
  - **Standalone Native Binary & Crash Isolation**: The native libmpv instance, audio decoding, and the platform audio output driver run inside a dedicated compiled native binary (`apps/desktop/bin/audio-engine` or `.exe`), communicating via stdio JSON-IPC and monitored by an Electron Main supervisor (`AudioEngineSupervisor`). Any audio driver crash, device disconnect, or native signal failure is trapped in the child process without crashing the UI or Main process, with automated recovery.
  - **Zero-IPC for PCM & Direct OS Audio Output**: Decoded audio PCM directly feeds mpv's own audio output — `ao=wasapi` on Windows, `coreaudio` on macOS, `pulse,alsa,pipewire` on Linux. Raw high-bitrate PCM samples NEVER cross IPC boundaries to the renderer. An in-engine lock-free SPSC (Single-Producer Single-Consumer) `PcmRingBuffer` captures real-time audio samples directly at the audio output boundary (`ao_play`, post-DSP, pre-hardware) to feed the in-process visualizer, eliminating memory copies, IPC serialization overhead, and GC stutter.
  - **Full Effect Chain via libavfilter Adapters**: every built-in effect (10-band EQ, preamp, compressor, limiter, normalize, crossfeed, widener, reverb, tempo-pitch) declares an optional `buildLavfi(params)` adapter on its `EffectDefinition` — a libavfilter fragment per effect (`equalizer`/`lowshelf`/`highshelf`, `volume`, `acompressor`, `alimiter`, `crossfeed`, `extrastereo`, `aecho`, `rubberband`). The engine walks the ENABLED chain in ordinal order, joins the fragments into one `af` string (plus the `astats` tap), and pushes it at mount, on `dsp/chain-changed` (debounced 200 ms — every `af` write makes mpv rebuild the chain), and effects without an adapter are skipped with a log line. `FILE_LOADED` reads mpv's actual pause flag rather than assuming, so a play that races the loader (the gapless re-bind) keeps the status bookkeeping honest. Verified end-to-end against synthesized tones: a +6 dB band boost measures +6.00 dB at the engine's own `astats` tap, and a −40 dB chain attenuates the measured level accordingly.
  - **Gapless Handoff (append + re-bind)**: `ctx.audio.preloadNext` (optional contract member) appends the next track to the engine's internal playlist (`loadfile append`) while the current one still plays; at the playlist boundary mpv advances inside itself — no decoder restart. The player's ended→load round-trip then *re-binds* to the already-sounding file: the engine compares the requested uri against its current `path` (scheme-insensitively — mpv strips `file://`), and unless the file sits at EOF (a repeat-one replay must start over) it replies `loaded` with `resumed: true` instead of replacing anything. `play()` without a position argument never seeks, so the re-bound track keeps sounding. The player reads the member's *presence* as ownership: when `preloadNext` exists it hands over the src and loads **no** second source — on a single-core engine a second `load` of the next file is a `loadfile replace`, which stops the track still sounding and leaves the engine paused on a file nothing will ever start. The desktop shell forwards the member (and `lastPreloadStatus`) off the active engine, so the presence check sees through the wrapper.
  - **Native Device Query**: output device enumeration prefers mpv's own `audio-device-list` (native device names as ids, `auto` as the machine default), falling back to Chromium enumeration + native label resolution when the engine cannot answer. Ids from the mpv namespace are forwarded straight to the engine; stale ids from the other engine's namespace keep working through the shared label-matching path.
  - **Build & Distribution**: the binary is compiled per platform by CI (`scripts/build-audio-engine.js`, compiling `main.cpp` and `pcm_ring_buffer.cpp`, three-platform matrix, `--version` smoke) and packaged with per-platform libmpv staged by `scripts/fetch-libmpv.js` (system search, `LIBMPV_PATH` override, SHA256-verified Windows prebuilt download) via electron-builder `extraResources`. CMake support is provided via `native/audio-engine/CMakeLists.txt`. On Linux the build also stages the full transitive dependency closure of libmpv (`scripts/bundle-mpv-deps.js`) — the engine loads libmpv with `RTLD_NOW`, so one missing soname silently kills every native feature. On a machine without libmpv the engine reports the load failure and the renderer degrades to the media element (Chromium decode). The full binary/libmpv lookup order and the degradation matrix are specified in [workflow/build-pipelines.md §4.1](../workflow/build-pipelines.md#41-the-native-audio-engine-binary).
  - **Degradation Visibility & Real-Time PCM Decoupling**: the engine's `ready` message carries `mpvAvailable`, surfaced through `ctx.audio.getEngineStatus()` (bridge method `mpvEngineStatus`) — the settings page shows an explicit degradation row instead of silently pretending the native engine runs. When the custom mpv build with `mpv_set_pcm_callback` is loaded, real PCM flows seamlessly into `PcmRingBuffer`. If standard unpatched libmpv is used or a track degrades to the media element, `MpvDynLib` gracefully falls back to quiet/zero-padded frames without artificial sine/cosine generation, ensuring zero audio dropouts or driver blocking.
  - **Unified AudioAnalyser & Real-PCM Visualizer Pipeline**: Real-time spectrum analysis is computed in-process within the standalone native audio-engine using real PCM:
    - **Dual Independent Paths**: The libavfilter `astats` metadata tap (`@bbebee_astats:lavfi=[astats=metadata=1:reset=1]`) is retained strictly for RMS / Peak level telemetry, while spectrum and waveform generation are completely decoupled into the real PCM pipeline.
    - **SPSC PcmRingBuffer & Low-Lock Decoupling**: libmpv's audio thread copies frames non-blockingly into a 64-byte-aligned lock-free ring buffer (zero malloc, zero mutex, zero I/O). The separate visualizer worker thread reads up to $N$ frames every ~30 ms, draining backlog exceeding 60 ms to eliminate latency drift against physical speakers. The buffer is (re)configured from mpv's `audio-out-params/*` — the format the AO actually receives and the tap delivers — never `audio-params/*` (the decoder's): mpv resamples and channel-mixes between the two, so a 44.1 kHz file on a 48 kHz device reported as `audio-params` would trip the write-side format guard and silently drop every tapped frame. `clear()` is a deferred flag consumed only inside `read()`/`discardExcessFrames()`; `availableFrames()` therefore never short-circuits on a pending clear, and the visualizer loop flushes stale PCM only on its playing → idle edge — otherwise any clear raised mid-playback (`play` with a position, `seek`) wedges the gate `availableFrames() → read()` at zero forever (a working tap with 0 frames ever read).
    - **FftProcessor Buffer Reuse**: Multi-channel interleaved float32 PCM is downmixed to mono via frame averaging. Buffers (`fftBuffer`, `monoBuffer`, `window`, `previousSpectrum`) are reused without dynamic allocations during steady state. Sub-window data is zero-padded without frame residue, transformed via Radix-2 Cooley-Tukey FFT, safely clamped to dB range, temporally smoothed, and dispatched as uint8 arrays (`frequencyData` [0..255] and real `timeDomainData` [0..255]) over stdio JSON-IPC (`fft-frame`).
    - `plugin-visualizer` wraps this into a unified `AudioAnalyser` abstraction (`NativeMpvImpl` / `WebAudioImpl`), feeding a Canvas 2D rendering pipeline (gradient spectrum bars with peak caps, waveform, radial and particle styles — one persistent 2d context, no WebGL) seamlessly without leaking backend details to UI components.
- **Mobile Audio Engine Architecture (`MobileAudioService` in `apps/mobile`)**:
  - **Delivered Production Engine (Route A: `@BBeBee/core-audio-webaudio` via `react-native-audio-api`)**: Native audio graph running directly on mobile OS audio subsystems (Apple CoreAudio on iOS, Google Oboe/AAudio on Android). Provides low-latency audio buffering, system background audio, and audio focus interruption handling.
  - **Roadmap Route B (`@BBeBee/core-audio-mpv` via in-process libmpv JNI/JSI)**: Architectural target for mobile audiophile playback. Because mobile sandboxes disallow child process spawning, Route B is designed as an in-process native shared library (`libmpv.so` on Android, `mpv.framework` on iOS). When compiled, it interfaces via TurboModule JSI to provide hardware decoding and stream buffering. In builds where the native library is not yet bundled, `MobileAudioService` automatically operates on Route A (WebAudio) to ensure reliable audio output.
  - **State Continuity & Audio Interruption Management**: Audio settings and system interruptions (phone calls, alarms) via `AudioManager.observeAudioInterruptions` are handled uniformly at the composition root.
- **Audio Output Engine, Exclusive Mode & Device Selection in Settings (`audioOutputEngine`, `audioExclusive`, `audioOutputDeviceId`)**:
  Settings provide output driver and hardware device configuration under the *Audio Output Engine & Devices* section:
  - **Engine Choice (Default: MPV Hi-Fi on Windows, WebAudio elsewhere)**: MPV Hi-Fi provides native crash isolation and direct WASAPI output; WebAudio provides the standard Web Audio graph.
  - **Exclusive Mode (`audioExclusive`, default: `false`)**: When the MPV Hi-Fi engine is active, a dedicated toggle switch appears beneath the audio backend selector. When enabled, libmpv configures direct exclusive hardware access (`--audio-exclusive=yes`), delivering bit-perfect output with WASAPI exclusive mode on Windows (bypassing the OS shared audio mixer, sample rate conversions, and system sound mixing). The setting is reactive and hot-swappable at runtime without playback interruption through `ctx.audio.setAudioExclusive(exclusive)` / bridge IPC `mpvSetAudioExclusive`, updating libmpv's `audio-exclusive` property dynamically.
  - **Selectable Audio Output Devices**:
    - **Full System Hardware Probing**: Electron main process unmasks Chromium device labels by handling `'speaker-selection'` and `'media'` permissions, while querying native OS subsystems (Windows Registry & CIM MMDevices, macOS System Profiler, Linux pactl/aplay) to resolve exact hardware friendly names (speakers, headphones, external USB DACs).
    - **Driver Destination Routing**: Selecting a device persists `settings.audioOutputDeviceId`. On boot and upon change, the active engine redirects output to the chosen endpoint — `AudioContext.setSinkId` receives the Chromium id, while the same id is label-matched against the bridge's native device list and the resolved OS device is forwarded to main's `audio.setOutputDevice`. The mpv engine additionally prefers its own `audio-device-list` for enumeration (see above). Both engines run the shared routing through shared code, so they cannot drift.
- **Audiophile Lossless Formats & Local Scanner Integration**:
  The local scanner reads tags and durations through the pure-JavaScript `music-metadata` stack — no external decoder is involved anywhere in the product:
  - **ALAC & `.m4a`**: Previously, ALAC tracks inside `.m4a` containers were rejected during scanning (`unsupported codec: ALAC is not supported on this platform`). With `alac` in `supportedFormats()` and header parsing, ALAC files are fully imported.
  - **Lossless Formats**: `.ape` (Monkey's Audio), `.wv` (WavPack), `.dsf`/`.dff` (DSD Audio), and `.m4b` (Audiobooks) are included in local scanning (`DEFAULT_EXTENSIONS`) and tag sniffing (`core-codec-node`). Playback coverage for the exotic containers is the MPV engine's (libmpv); the WebAudio engine plays what Chromium decodes.
- **Desktop Scheme Rewriting**: Under Electron web security, renderer `fetch()` calls to `file://` URIs are rejected. The desktop core service automatically transforms `file://` URLs into the registered privileged protocol `bbebee-file://` before fetching or binding to media elements.

### Escape hatch

If `react-native-audio-api` proves unworkable on a platform, `core-audio-rntp` can implement
`AudioService` over `react-native-track-player`, with `chainInput` becoming a no-op and effects
degrading to whatever native EQ exists. `ctx.player` and every effect plugin are unaffected. The
abstraction is the insurance policy, and it is cheap precisely because the contract is a standard
one.

---

