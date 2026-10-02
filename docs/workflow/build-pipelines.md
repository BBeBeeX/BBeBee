# Build Pipelines, Tooling & Dependency Matrix

> **Legacy Reference:** Formerly `docs/09-project-structure.md §4 – §5`.

## 4. Build pipelines

| Target | Bundler | Entry | Notes |
|---|---|---|---|
| Mobile | **Metro** | `apps/mobile/index.js` | Needs `unstable_enablePackageExports` for Cordis's ESM `exports` map, and `@babel/plugin-proposal-decorators` at `version: '2023-11'` |
| Desktop renderer | **Vite** | `apps/desktop/renderer/index.html` | Native ESM in dev; strict CSP whose single concession is `'wasm-unsafe-eval'`, without which QuickJS cannot compile and the boot fails — it is not `'unsafe-eval'`, so no foreign *JavaScript* loads (02 §2). `img-src`/`media-src` carry plain `http:` for sources that serve artwork and streams from such hosts. Pinned by `renderer/csp.test.ts` |
| Desktop main + preload | **electron-vite** | `apps/desktop/main/index.ts` | CJS output; externalises native deps |
| Packages | **tsup** (or `tsc` for `protocol`) | per-package `src/index.ts` | ESM only; `protocol` emits types only |
| QuickJS WASM | embedded in the bundle | `core-js-quickjs-node` | One **single-file** variant (`@jitl/quickjs-singlefile-browser-release-sync`) through `quickjs-emscripten-core`, so the engine is bytes in a JS chunk and is never fetched — a sandbox that downloads its own engine is not one (04 §19). `getQuickJS()` is what this is instead of: it picks a separate-`.wasm` variant that fetches at startup — served `index.html` by Vite in dev, refused outright by a `file://` renderer once packaged — and drags all four variants (~4 MB) into the build |

```jsonc
// metro.config.js — the parts that are not boilerplate
{
  "resolver": {
    "unstable_enablePackageExports": true,
    "unstable_conditionNames": ["react-native", "import", "require", "default"]
  },
  "watchFolders": ["<repo>/packages"]
}
```

Codegen (`packages/tooling/tooling-gen-plugins`, run as `pnpm gen:plugins`) writes
`apps/{mobile,desktop}/generated/plugins.ts`. Its output is **committed**, so a clean checkout
builds without a pre-step and CI verifies the file is current rather than regenerating it — run it
whenever a plugin package is added or removed.

### 4.1 The native audio-engine binary

The MPV Hi-Fi engine (`core-audio-mpv`) runs in a standalone C++ executable, not in the
Electron bundle. It is built by `apps/desktop/scripts/build-audio-engine.js` (compiler
detected: `g++` / `clang++` / MSVC `cl`, C++17) into `apps/desktop/bin/audio-engine[.exe]`,
synced to `apps/desktop/resources/bin/` for packaging, and **gitignored** — both are build
artifacts. `pnpm dev:desktop` does *not* build it; without a prior
`pnpm build:audio-engine` the engine is simply absent.

**Engine-binary lookup** (`AudioEngineSupervisor.resolveExecutablePath`): the
`AUDIO_ENGINE_PATH` env var → the packaged `resources/bin/` → dev candidate paths. An
explicitly injected path that is missing fails strictly (no fallthrough).

**libmpv lookup** (the engine `dlopen`s it at startup): first the engine's own directory —
`build-audio-engine.js` stages the **vendored platform libmpv** from
`apps/desktop/resources/libmpv/<platform>/` there (a committed, source-controlled set:
`win64/` is the mpv-winbuild LGPL static build, `linux/` is the Debian trixie `libmpv2` delta
set, `darwin/` is staged from brew by CI; provenance and licensing in that directory's
README) — and the supervisor points the child's
`LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`/`PATH` at it. Then the system library paths: `mpv-2.dll`
on Windows, `libmpv.so.2` on Linux, `libmpv.dylib` on macOS. The vendored Linux set covers the
delta over the distro's own libmpv2 dependency stack; the ffmpeg-family versions must match
the host (a sid-built 0.41 needs `libavcodec.so.63`, while trixie's 0.40 matches the system's
`.61`).

**Degradation matrix**:

| State | Behaviour |
|---|---|
| Engine binary missing | the supervisor fails the load fast; the renderer degrades to the media element (Chromium decode — audio via Web Audio, flat spectrum, no gapless) |
| Engine present, libmpv missing | the engine runs but every load fails; the same renderer fallback |
| Both present | mpv decodes and feeds the OS audio output directly; native DSP/EQ; append-based gapless; astats-driven spectrum |

**Packaging**: CI builds the binary per platform (a three-OS matrix with a `--version` smoke)
and uploads it as an artifact; the packaging job downloads it, stages libmpv
(the vendored set from the build script is primary; `scripts/fetch-libmpv.js` is the fallback —
system search, `LIBMPV_PATH` override, dynamic latest-release resolution with `LIBMPV_DOWNLOAD_URL`),
and runs electron-builder, whose per-platform `extraResources` carry the
engine and libmpv in the installers. Locally: `pnpm build:desktop && pnpm dist:desktop`. The
condensed developer version of these rules lives in the root [README.md](../../README.md).

There is no Turborepo and no `turbo.json`: the root scripts orchestrate with `pnpm -r` — `build`
runs before `test` for packages with conformance suites, and `typecheck` and `lint` are plain
recursive runs over the workspace.

---

## 5. Version matrix

Verified against `package.json` / `pnpm-lock.yaml` on **2026-09-12** — the lockfile is the
authority; this matrix is a map. Several of these move weekly.

| Package | Version | Note |
|---|---|---|
| `cordis` | **4.0.0-rc.9** | ⚠️ Release candidate — see §5.1 |
| `cosmokit` | ^1.8.1 | Cordis dependency |
| `@standard-schema/spec` | — | Planned for plugin `Config` validation; **not yet a dependency** |
| `expo` | 57.0.18 | SDK 57 |
| `react-native` | **0.86.3** | Pinned by Expo SDK 57; do not float to 0.87 |
| `react` | **19.2.3** | Pinned by Expo SDK 57. The desktop renderer must match |
| `expo-router` | ~57.0.17 | |
| `expo-audio` | ~57.0.4 | `expo-av` is discontinued and must not be used |
| `expo-file-system` | ~57.0.6 | `File`/`Directory` API; legacy at `expo-file-system/legacy` |
| `expo-sqlite` | ~57.0.2 | |
| `expo-secure-store` | ~57.0.2 | |
| `expo-background-task` | ~57.0.16 | Replaces `expo-background-fetch`. With `expo-task-manager` ~57.0.16 |
| `expo-network` | ~57.0.1 | `ctx.device.network()` |
| `expo-battery` | ~57.0.2 | `ctx.device.battery()` |
| `expo-application` | ~57.0.2 | The app version `ctx.device` reports |
| `expo-keep-awake` | ~57.0.1 | `ctx.background.acquireWakeLock` |
| `expo-crypto` | ~57.0.2 | |
| `expo-dev-client` | ~57.0.16 | Required — Expo Go cannot host the native modules |
| `react-native-audio-api` | **0.13.3** | ⚠️ Pre-1.0 — see §5.2. Peer: `react-native-worklets >= 0.6.0` |
| `react-native-gesture-handler` | ~2.32.0 | ⚠️ Not used by us. `react-native-audio-api`'s barrel pulls in its `AudioControls` widget, which imports this and Reanimated **without declaring either** — so Metro cannot resolve the package root without them. See §5.2 |
| `react-native-reanimated` | ~4.5.1 | ⚠️ Same reason. `babel-preset-expo` adds the worklets plugin on its own once these resolve, so `babel.config.js` needs no change |
| `react-native-worklets` | ~0.10.1 | Reanimated 4's runtime, and `react-native-audio-api`'s optional peer |
| `electron` | **44.0.0** | Requires Node ≥ 22.12, so `node:sqlite` is available |
| `electron-vite` | 5.0.0 | |
| `vite` | ^7.3.6 | Pinned by `electron-vite` 5 — the matrix previously said 8.2.2; read `pnpm-lock.yaml` as the authority |
| `typescript` | **5.9.3** | ⚠️ If any tool in this matrix lags TS 7, stay on the latest 5.x — which is where we are |
| `vitest` | ^4.1.11 | |
| `zod` | — | Planned for plugin `Config` validation (Standard Schema compliant); **not yet a dependency** |
| `pnpm` | 11.x | Workspace manager — read `packageManager` / the lockfile for the exact version |
| `turbo` | — | **Not adopted.** The root scripts orchestrate with `pnpm -r`; there is no `turbo.json` |
| `@shopify/flash-list` | 2.3.2 | Mobile list virtualisation |
| `@tanstack/react-virtual` | 3.14.10 | Desktop list virtualisation |
| `music-metadata` | 11.15.0 | Tag reading on **both** targets — it is pure JS over `ctx.fs`, so `core-codec-rn` inherits it rather than adding a native reader that would have to agree with it |
| `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` | **0.32.0** | ⚠️ `ctx.js` on desktop. Pin both exactly and keep them equal — a variant and a core of different versions share an FFI ABI that is not versioned. The single-file variant is what makes the engine bundled rather than fetched (04 §19); the `browser` build is the environment-agnostic one, so Vitest, `main` and the sandboxed renderer all run the same realm |
| `react-native-quickjs` | **0.4.x** | ⚠️ `ctx.js` on mobile — a native module, so it forces a dev-client rebuild. See §5.3 |

### 5.1 The Cordis RC problem

`cordis@4.0.0-rc.9`'s own README says: *"Cordis is under active development. The API is not yet
stable and may change without notice."* The entire architecture rests on it. Mitigation, in order:

1. **Pin exactly.** `"cordis": "4.0.0-rc.9"` — no caret, no tilde. Renovate/Dependabot excluded for
   this package; upgrades are deliberate, manual, and their own PR.
2. **Keep the surface narrow.** The project uses `Context`, `Service`, `plugin`, `inject`,
   `effect`, the event methods, `isolate`, and `intercept` — a dozen entry points. Everything else
   Cordis offers is unused, so the blast radius of a change is bounded and auditable.
3. **Own the re-export.** `@BBeBee/kernel` re-exports what plugins need
   (`export { Service, Inject } from 'cordis'`) and **plugins import from the kernel, not from
   `cordis`**. If a signature changes, one adapter module absorbs it instead of 40 packages.
   This is the kernel's *plugin surface*, and it is the only part of Layer 1 that Layers 3 and 4
   may import — the bootstrap surface beside it is Layer 2 and the composition root only
   ([02 §1](../architecture/layers.md#the-invariant), enforced in [§3](#3-dependency-rules)).
4. **Pin the tests.** `@BBeBee/protocol`'s conformance suite includes a small set of tests asserting
   Cordis semantics the design depends on — that a lost dependency unloads a plugin, that effects
   run in reverse order, that isolation is per-key. An upgrade that breaks an assumption fails CI
   with a pointed message rather than at runtime six weeks later.

### 5.2 The audio engine risk

`react-native-audio-api` at `0.13.x` is the other unpinned bet. Mitigated by ADR-4's structure:
`ctx.audio` is a service, its contract is the *standard* Web Audio API rather than the library's
own shape, and `core-audio-rntp` is a documented fallback
([05 §1](../audio/playback.md#escape-hatch)). Same pinning discipline as Cordis.

⚠️ **Its barrel drags in a UI widget.** `react-native-audio-api/src/api.ts` imports
`Audio/controls/AudioControls`, which imports `react-native-gesture-handler` and
`react-native-reanimated` — neither of which the package declares. Importing the package root
therefore fails to bundle until both are installed, and the widget's four icon PNGs end up in the
bundle even though nothing renders it. Three ways out, in the order they were considered:

1. **Install both** — what we do. They are ordinary Expo SDK packages, no Babel change is needed,
   and M2's drag-to-reorder wants gesture-handler anyway. Cost: two native modules and ~2 KB of
   icons for something unused.
2. **Shim them in Metro's `resolveRequest`.** Cheaper, and safe *today* because nothing renders
   `AudioControls` — but the first person to add a swipe gesture gets a baffling failure from a
   resolver that lies.
3. **Deep-import past the barrel** (`react-native-audio-api/lib/module/core/AudioContext` and
   friends). Avoids both native modules; the package publishes no `exports` map so it works. Also
   version-fragile, and it would spread across three of our packages.

If the two native modules ever become a problem, 3 is the escape hatch and it is contained.

---

### 5.3 The evaluator risk

`ctx.js` is a third pre-1.0 bet, and it arrived with
[ADR-5](../architecture/overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime)
rather than being chosen at leisure. Two QuickJS bindings, two build systems, one of them a native
module on a platform where native modules are expensive to change.

The mitigation is the same shape as the other two, and it is why `ctx.js` is a *service* rather
than an import inside `plugin-source-runtime`: the contract is "evaluate this string in a realm
with these limits and this host surface", which is satisfiable by QuickJS, by
`isolated-vm`-shaped embeddings, and — with a worse story on limits — by a `Worker`. The
conformance suite tests the contract, including that a `while (true)` is interrupted and that a
host object cannot be retained across the boundary, so a swap is a package change rather than a
redesign.

⚠️ The one thing that would genuinely hurt is a target where **no** interpreter can be embedded.
That is not the case on either target today, and it is the trigger to reconsider the whole rule
language if it ever becomes one.

---

