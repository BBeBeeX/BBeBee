# Overview & Core Architectural Decisions

> **Legacy Reference:** Formerly `docs/01-overview.md`.

> **What this answers.** What BBeBee is, what it deliberately is not, which platforms it targets,
> and the five architectural decisions that everything downstream depends on. If you read one
> document before writing code, read this one and [02](./layers.md).

---

## 1. What we are building

A music player that runs on desktop and mobile from one codebase, where the player itself is
thin, nearly all behaviour arrives as plugins, and **the music sources arrive as text the user
pastes in**.

The user-visible product is ordinary: a library, a queue, playback with an equalizer, offline
downloads, playlists, lyrics, and the ability to pull music from more than one place — a folder
of files on disk, a self-hosted server, whatever a source string describes. Two things are unusual
underneath. There is no privileged "core" that owns the features: the library is a plugin, the
downloader is a plugin, and so is the filesystem access the downloader uses. And a music source is
not a package at all — it is a JSON document the user imports, interpreted by one built-in runtime
([ADR-5](#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime)). Visually, the
application follows an immersive dark-first streaming media aesthetic — pure black chrome, deep
charcoal canvases, vibrant green playback accents, geometric grotesque typography, and pill-shaped
interactive controls — detailed in [UI Architecture](../ui/design-system.md#6-multi-theme-color-system--visual-identity).

### Why build it this way

Three reasons, in order of importance:

1. **Cross-platform without conditionals.** The alternative to a service abstraction is
   `Platform.OS === 'ios' ? … : …` scattered across the codebase, which decays quickly. Here,
   platform difference is expressed once, as *which plugin got loaded*, and never again.
2. **Music sources are inherently plural and unstable.** Every backend has a different API,
   different auth, different pagination, and a different lifespan — and it changes without
   warning. A source therefore cannot be something we compile, review, and release: it has to be
   something a user adds, edits and repairs in the app, in minutes. That is what makes a source a
   *string* rather than a package ([06](../sources/spec.md)), and it is the decision the rest
   of the source design falls out of.
3. **Lifecycle correctness is hard, and Cordis already solved it.** Plugins that register event
   listeners, open sockets, hold audio nodes, and start timers must tear all of that down when
   disabled. Cordis's fiber/effect model makes unload total by construction, which is the part
   most plugin systems get wrong.

### Goals

- One plugin graph that runs unmodified on iOS, Android, and desktop.
- A plugin can be disabled at runtime and leave no trace — no listeners, no timers, no sockets.
- Adding a music source requires importing a string — no build, no release, no install.
- The audio path supports a real DSP chain (parametric EQ, dynamics, convolution) on *all*
  targets, not just desktop.
- Offline-first: the library and queue are usable, and the app is navigable, with no network.

### Non-goals

Stated explicitly, because each of these would change the architecture if reintroduced.

- **Not a DRM client.** No Widevine/FairPlay integration. Sources that require DRM are out of
  scope; the `StreamHandle` type reserves a `drm` field so the door is not nailed shut, but
  nothing implements it.
- **Not a server.** No sync backend is built. Cross-device sync is designed as an SPI with a
  file/WebDAV reference implementation, deferred past M5.
- **We ship no sources for third-party services.** The runtime is content-neutral and can express
  a great deal, but this repository ships only the interpreter, the local-files provider, and a
  small corpus of source documents for open self-hosted protocols — Subsonic/Navidrome, Jellyfin,
  plain HTTP URLs, podcast feeds — used as worked examples and as tests. What a user imports is
  their choice; the import screen states what a source will do and whom it will talk to, and the
  app does not editorialise beyond that ([06 §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).
- **Not a general-purpose extension host.** Plugins are first-party packages, statically bundled
  on both targets. Imported *sources* are the extension story, and they are contained by a real
  interpreter boundary rather than by the plugin capability model, which is documented honestly as
  *defense in depth, not a sandbox* ([03 §7](../plugins/capabilities.md#7-capability-model)).
- **No web build in scope.** React Native Web would technically work, but decision **ADR-2**
  below chooses a separate DOM UI for desktop, and a browser target would be a third shell with
  no offline story. Revisitable later; not planned.

---

## 2. Target platforms

| Target | Host | JS runtime | Kernel lives in | UI |
|---|---|---|---|---|
| iOS | Expo / React Native | Hermes | The app's single JS context | React Native |
| Android | Expo / React Native | Hermes | The app's single JS context | React Native |
| Desktop (macOS / Windows / Linux) | Electron | V8, renderer process | The **renderer** | React DOM |

Mobile requires a **custom development build** (`expo-dev-client`), not Expo Go, because
`react-native-audio-api` and several core-service modules contain native code. This is stated up
front because it affects the onboarding instructions for every contributor.

---

## 3. Architecture decisions (ADRs)

The first four were settled before the design was written; **ADR-5 was taken later and rewrote
ADR-1's justification**, which is recorded here rather than quietly patched. Each records what was
chosen, what was rejected, and what it costs.

### ADR-1 — Plugins are statically bundled on every target

> **Amended by [ADR-5](#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime).**
> This decision originally read *"statically bundled on mobile, runtime-loadable on desktop"*, and
> its entire justification was that a desktop user should not need a project release to get a new
> music source. Sources are no longer packages, so that justification is gone and the option ADR-1
> once rejected is now the decision.

**Decision.** One plugin manifest format, one loader. A codegen step emits static `import`
statements for every plugin in the workspace on both targets; configuration only enables,
disables, and configures them. Extensibility for users lives in imported **source strings**
([06](../sources/spec.md)), not in loadable plugin code.

**Rejected — keep the desktop dynamic loader.** It works, and the design for it stands
([loading.md §6.2](../plugins/loading.md#62-desktop-dynamic-loading--plugin-loader-dynamic) details the desktop implementation).
Rejected as *original* scope because what it was for — sources — now arrives as data on
both platforms, and what remains for it (third-party effects, scrobblers, lyric providers) does
not yet justify an install/update/quarantine flow, a capability-grant UI, and a per-plugin gate
that [capabilities.md §7](../plugins/capabilities.md#where-the-gate-actually-runs) admits does not hold on desktop.

**Rejected — runtime marketplace on both.** Same reasoning, plus: on iOS, downloading and
executing new JavaScript requires an interpreter sandbox. That sandbox now exists for a different
reason (ADR-5), so if this is ever revisited it starts from a much better position.

**Costs.** A third-party plugin author must vendor their package into a build, so in practice
non-source extensions are first-party until the sandbox generalises
([10 §M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox)). Mobile and desktop no
longer drift in which plugins exist, which removes a whole class of "contributed view is missing"
handling — though the handling stays, because ADR-2 produces the same state for its own reasons.

### ADR-2 — The UI is split: React Native on mobile, React DOM on desktop

**Decision.** Two shells, two component libraries, one headless core. Plugins contribute
renderer-agnostic **descriptors** (a route, a slot filling, a command, a settings page) and ship
view implementations per target in separate packages.

**Rejected — universal React Native Web.** One UI codebase, and Electron would render the same
bundle. Cheaper by roughly half. Rejected because a desktop music player's expected interactions —
a resizable multi-column library, right-click context menus, drag-to-reorder queues, keyboard
navigation, native window chrome, a tray mini-player — are exactly the things react-native-web
makes awkward. Paying twice for the view layer buys a desktop app that feels like one.

**Costs.** Every UI-bearing plugin becomes up to three packages. Two design-token pipelines that
must be kept in sync. Two navigation systems. A discipline problem: it is now *possible* to put
logic in a view, and the architecture must actively prevent it
([08 §4](../ui/architecture.md#4-binding-services-to-react)).

### ADR-3 — The Electron kernel lives in the renderer; `main` is a thin native host

**Decision.** The Cordis context is created in the renderer process. The `main` process owns Node
and the OS, exposes a narrow capability-scoped surface through a `contextBridge` preload, and
contains **no business logic**. Core service plugins on desktop are thin clients over that IPC
surface.

**Rejected — split kernel (services in main, UI kernel in renderer).** Would let downloads and
playback survive the window closing. Rejected because it introduces a serialization boundary and
a remote-service proxy layer that has no counterpart on mobile, meaning the plugin graph would
differ per platform — the exact thing this architecture exists to avoid.

**Rejected — kernel in main only.** Maximum divergence from mobile; UI plugins could not share
the kernel at all.

**Consequence.** Desktop and mobile both have exactly one JS runtime hosting exactly one context.
A feature plugin cannot tell which platform it is on. The price is that desktop background work
is tied to the renderer's lifetime — mitigated by close-to-tray rather than by architecture.
See [02 §4](./layers.md#4-what-background-means).

### ADR-4 — `react-native-audio-api` is the primary playback and DSP engine on every target

**Decision.** The `ctx.audio` service contract is the **Web Audio API**. On iOS and Android it is
satisfied by `react-native-audio-api`; in the Electron renderer, by the same package's web
implementation (or the browser's native Web Audio — they are the same interface).

This is the decision that makes the DSP requirement tractable. Without it, "audio effects on
mobile" means writing native DSP twice. With it, a ten-band equalizer is one `BiquadFilterNode`
cascade that runs identically on all three platforms.

**Rejected — `react-native-track-player` on mobile.** More battle-tested for background queues,
lock-screen controls, and Bluetooth/car integration. Rejected because it exposes no audio graph,
which would make EQ and effects desktop-only — abandoning a stated goal.

**Rejected — `expo-audio`.** Simplest and stays in the managed workflow, but provides neither a
queue engine nor a DSP graph.

**Costs and mitigation.** `react-native-audio-api` is at `0.13.x` — pre-1.0, with a moving API.
The mitigation is structural: `ctx.audio` is a service like any other, so an alternative engine
can be swapped behind it without touching `ctx.player` or any effect plugin. The abstraction *is*
the insurance policy. Tracked as the highest-priority item in the risk register
([10 §3](../roadmap/roadmap.md#risk-register)).

### ADR-5 — Music sources are imported strings, interpreted by one runtime

**Decision.** A music source is a **JSON document the user imports as text** — pasted, fetched
from a URL, opened from a file, or scanned from a QR code — stored as a row and interpreted by a
single built-in runtime, `plugin-source-runtime`. The document declares its endpoints and a set of
**rules** in a small selector/template language; the runtime does every fetch, selection and
coercion. This is the [legado](https://github.com/gedoor/legado) book-source model applied to
audio, and it is specified in [06](../sources/spec.md).

**Rejected — one plugin package per backend** (the previous design). Every source was a
`plugin-source-*` package implementing a provider SPI. It is the more powerful option: arbitrary
code can handle any backend, with types and tests. Rejected because it puts the project in the
path of every fix. A backend renames a JSON field; the user cannot do anything about it. Someone
must write TypeScript, open a PR, get it reviewed, cut a release, and — on mobile, where runtime
loading is not permitted — ship through an app store. For a class of backend that changes on
someone else's schedule, a release cycle per breakage is not a maintenance plan.

**Rejected — sources as declarative config with no code at all.** Safer and much easier to reason
about, and it fails on contact with reality: real backends need a computed signature, a token
lifted out of one response and used in the next, a timestamp, an MD5. A source language with no
escape hatch produces sources that *almost* work, and the workaround is worse than the hatch.

**Consequences, all of which are load-bearing elsewhere:**

- **Capabilities are derived, not declared.** What a source can do follows from which rule blocks
  it contains, so the old under-declare/over-declare failure mode is gone
  ([06 §1.3](../sources/rule-engines.md#13-capabilities-are-derived-not-declared)).
- **A real sandbox is now mandatory, not deferred.** Source rules are code from strangers, so
  `ctx.js` — a separate QuickJS realm with an enumerable host API and a per-source host allowlist
  — is a core service that ships with the feature
  ([04 §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator),
  [06 §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)). The plugin
  system's own containment gap ([capabilities.md §7](../plugins/capabilities.md#what-this-is-not)) gets its answer
  as a side effect.
- **ADR-1 loses its reason for existing** and is amended above.
- **Diagnosis becomes a shipped feature.** When sources are user-owned, "why did this stop
  working" is a user's question, so the per-feature test screen with its streaming trace in
  [06 §10](../sources/authoring.md#10-diagnosing-a-broken-source) is not a developer tool that
  happens to be in the build — it is the maintenance story for the whole model.

**Costs.** A rule language, an interpreter, a sandbox, an import/export flow, an editor and a
debugger — all before the second source works. Type safety stops at the document boundary: a bad
rule is a runtime error with a good message, not a compile error. Sources rot silently when
backends change, so `RuleError`, the stale badge, and the health check
([06 §7](../sources/authoring.md#7-errors)) exist to make rot visible. And the app now runs code it
did not write, which is a security posture to maintain rather than a box to tick.

---

## 4. Glossary

Terms used with a precise meaning throughout these documents.

| Term | Meaning |
|---|---|
| **Layer 0–5** | The six layers of [02 §1](./layers.md#1-the-layer-model): **0** protocol, **1** kernel, **2** core plugins, **3** log transports, **4** feature plugins, **5** UI & business function. A package's layer decides what it may import; Layer 2 is the only one allowed to touch a platform SDK or drive the kernel, and Layer 3 the only one allowed to write to the console. |
| **Kernel** | `@BBeBee/kernel` — Cordis plus BBeBee's bootstrap, config loading, plugin resolution, and capability gate. Layer 1. Not a Cordis concept. |
| **Context** (`ctx`) | A Cordis `Context`. Simultaneously a DI container, an event bus, and a lifecycle scope. Every plugin receives its own derived context. |
| **Service** | A capability claimed on a stable context key (`ctx.fs`). Declared in `@BBeBee/protocol`, provided by exactly one plugin at a time within a given isolation scope. |
| **Fiber** | Cordis's unit of plugin lifetime. Tracks state (`PENDING` → `LOADING` → `ACTIVE` → …), holds the plugin's disposables, and reloads the plugin when its dependencies change. |
| **Effect** | A reversible side effect registered via `ctx.effect()`. The returned disposer runs automatically on unload. |
| **Core plugin** | A plugin implementing a platform service. Lives in `packages/core/*`. Layer 2 — the only code permitted to import a platform SDK, and the only code permitted to call the kernel's bootstrap surface. |
| **Feature plugin** | Everything headless that is not a core plugin or a log transport. Layer 4. Reaches the platform only through service keys, and logs only through `ctx.logger`. |
| **Log transport** | A plugin that subscribes to `ctx.logger` and puts the lines somewhere: a ring buffer, the console, a rotating file. Layer 3. Loaded from the shell's bootstrap array, so it is running before the first feature plugin starts. |
| **Source** | One music backend, as configured by the user. Identified by `sourceUrl`, addressed by a derived **source id**. Two Navidrome servers are two sources. |
| **Source string** | The importable text form of a source: one JSON document, or an array of them (a *source set*). The unit users share. |
| **Rule** | One field of a source document, written in the selector/template language of [06 §3](../sources/rule-engines.md#3-the-rule-language). |
| **Source runtime** | `plugin-source-runtime` — the one interpreter of source documents. Presents each enabled source to `ctx.sources` as a `MediaProvider`. |
| **Provider** | The internal interface `ctx.sources` consumes. Exactly two implementations: the source runtime's per-source adapter, and `plugin-source-local`. Not an extension point. |
| **URN** | `BBeBee:<sourceId>:<kind>:<id>`. The stable identity of a catalog entity. |
| **Binding** | A `media_bindings` row tying a track URN to a concrete local file. What "this track is downloaded" actually means. |
| **Chain** | An ordered list of DSP effects between the player's source node and the output. |
| **Descriptor** | A renderer-agnostic UI contribution — a route, slot filling, command, or settings page — resolved to real components by whichever shell is running. |
| **Shell** | The host application that mounts the UI: `apps/mobile` or `apps/desktop/renderer`. Layer 5, except for its **composition root** — the `boot.ts`/`plugins.ts` pair that wires Layer 2 implementations into the kernel. |

---

## 5. Where to go next

[02 — Architecture](./layers.md) turns these decisions into a six-layer dependency
model with its design principles, a per-platform runtime model, and a boot sequence.
