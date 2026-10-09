# BBeBee — Architecture Documentation

BBeBee is a cross-platform music player for desktop (Electron) and mobile (Expo / React Native),
built as a **plugin platform** rather than an application with an extension API bolted on. The
kernel is [Cordis](https://github.com/cordiverse/cordis) — a dependency-injection and
plugin-lifecycle framework — and *everything above the kernel is a plugin*, including file I/O,
networking, and persistence. Platform differences are absorbed by swapping which implementation
of a core service is loaded, not by branching inside feature code.

**Music sources are not plugins.** A source is a JSON document the user imports as text — the
[legado](https://github.com/gedoor/legado) book-source model applied to audio — interpreted by one
built-in runtime and sandboxed in its own JS realm. Adding a backend is a paste, not a release
([ADR-5](./architecture/overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime),
[sources/spec.md](./sources/spec.md)).

> **Status.** M0 and M1 are built, and M2 (sources as strings) is built except where
> [Roadmap & Risks](./roadmap/roadmap.md) names open items — notably `core-js-quickjs-expo` (mobile has
> no QuickJS sandbox yet) and the `@css:`/`@xpath:` rule engines. See the roadmap's
> "Where it stands" section for the precise list. Every version number and API fact was verified
> against `pnpm-lock.yaml` at the time of writing (see
> [workflow/build-pipelines.md](./workflow/build-pipelines.md) for the pinned matrix).

---

## Getting started

```bash
pnpm install     # pnpm 11+, Node 22.12+
pnpm check       # typecheck + lint + test — green on a clean checkout
pnpm dev:desktop # Electron, with HMR across main, preload and renderer
```

> **Build rules.** The desktop app carries a native audio-engine binary (libmpv-backed) that
> `dev` does *not* build, plus a libmpv runtime dependency with defined lookup and degradation
> rules — see the root [README.md](../README.md) for the full build rules and the degradation matrix.

`pnpm check` is the gate; if it passes, CI passes. The full command list, the plugin scaffolder,
what each gate catches, and a troubleshooting table are in
[workflow/testing.md](./workflow/testing.md#7-developer-workflow).

> Mobile needs a **custom dev build**, not Expo Go — several dependencies contain native code.
> See [workflow/testing.md](./workflow/testing.md#running-the-apps).

---

## Modular Documentation Map

The architecture documentation is organized into 9 topic directories:

| Topic | Document | Contents |
|---|---|---|
| **Architecture** | [architecture/overview.md](./architecture/overview.md) | Vision, scope, and the five Architecture Decision Records (ADRs) |
| | [architecture/layers.md](./architecture/layers.md) | The 6-layer model, runtime models (Electron/Hermes), and boot sequence |
| **Plugins** | [plugins/concepts.md](./plugins/concepts.md) | Plugin shape, metadata, Fiber lifecycle, and dependency injection (`inject`) |
| | [plugins/isolation.md](./plugins/isolation.md) | Service access, capturing for teardown, `ctx.isolate` and `ctx.intercept` |
| | [plugins/loading.md](./plugins/loading.md) | Dynamic loading (`load: () => import(...)`), registries, and manifests |
| | [plugins/capabilities.md](./plugins/capabilities.md) | Capability gate grammar, enforcement, fail-closed policy, and checklist |
| **Services** | [services/overview.md](./services/overview.md) | Core service design principles, opaque `Uri`, and `ctx.fs` virtual filesystem |
| | [services/contracts.md](./services/contracts.md) | Catalog of core service contracts (`http`, `ws`, `store`, `db`, `secrets`, etc.) |
| | [services/logging.md](./services/logging.md) | Layer 3 log transports (`ctx.logger`, ring buffer, console, file rotation) |
| **Audio** | [audio/engine.md](./audio/engine.md) | `ctx.audio` Web Audio engine, graph topology, and platform bridges |
| | [audio/playback.md](./audio/playback.md) | `ctx.player` transport state machine, resolution pipeline, queue, and OS integration |
| | [audio/dsp.md](./audio/dsp.md) | `ctx.dsp` effect chain assembly and built-in processors (EQ, compressor, reverb) |
| **Sources** | [sources/spec.md](./sources/spec.md) | Legado audio model, source JSON document schema, and derived capabilities |
| | [sources/rule-engines.md](./sources/rule-engines.md) | Six rule engines (`@json`, `@css`, `@xpath`, `@js`, regex, template) & combinators |
| | [sources/runtime.md](./sources/runtime.md) | Resolution lifecycle, cookie/session persistence, streams, and QuickJS sandbox |
| | [sources/authoring.md](./sources/authoring.md) | Dual-file authoring workflow, source compiler, diagnostics, and local media |
| | [sources/registry.md](./sources/registry.md) | The B_Be_Bee-registry content registry: index format, update checks, and install flows |
| **Data Model** | [data-model/urn.md](./data-model/urn.md) | Entity URN grammar (`BBeBee:<sourceId>:<kind>:<id>`) and multi-source linking |
| | [data-model/schema.md](./data-model/schema.md) | Entity-relationship model, SQLite conventions, and complete table catalog |
| | [data-model/events.md](./data-model/events.md) | Waterfall hooks and Cordis typed event map across all lifecycle domains |
| | [data-model/migrations.md](./data-model/migrations.md) | Forward-only, namespaced database schema migrations and transaction safety |
| **UI** | [ui/architecture.md](./ui/architecture.md) | Three-package structure, descriptor contributions, React service hooks, and shells |
| | [ui/design-system.md](./ui/design-system.md) | Dark streaming aesthetic, borderless elevation, design tokens, and WCAG AA contrast |
| **Workflow** | [workflow/structure.md](./workflow/structure.md) | Monorepo layout, layer boundaries, dependency rules, and ESLint architecture guards |
| | [workflow/build-pipelines.md](./workflow/build-pipelines.md) | Build pipelines (`tsc`, `vite`, `electron-builder`, `expo`) and version matrix |
| | [workflow/testing.md](./workflow/testing.md) | Testing strategy (unit, conformance, fiber leak tests) and developer commands |
| **Roadmap** | [roadmap/roadmap.md](./roadmap/roadmap.md) | Milestones (M0 – M5) with exit criteria, risk register, and architectural validity |
| | [roadmap/archive-m1.md](./roadmap/archive-m1.md) | Historical M1 execution plan and completion verification records |

---

## Legacy Section Mapping Table

For code comments and historical commits referencing `docs/01` through `docs/11`, use this mapping table:

| Historical Reference | Legacy Section | Modular Location |
|---|---|---|
| `docs/01-overview.md` (`docs/01`) | All | [`architecture/overview.md`](./architecture/overview.md) |
| `docs/02-architecture.md` (`docs/02`) | All | [`architecture/layers.md`](./architecture/layers.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §1 – §3 (Concepts, Lifecycle, Dependencies) | [`plugins/concepts.md`](./plugins/concepts.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §4 – §5 (Services, Isolation & Interception) | [`plugins/isolation.md`](./plugins/isolation.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §6 (Static & Dynamic Loading, Manifest, Config) | [`plugins/loading.md`](./plugins/loading.md) |
| `docs/03-plugin-system.md` (`docs/03`) | §7 – §9 (Capability Model, Gates, Checklist) | [`plugins/capabilities.md`](./plugins/capabilities.md) |
| `docs/04-core-services.md` (`docs/04`) | §0 – §1 (Philosophy, Types, `ctx.fs`) | [`services/overview.md`](./services/overview.md) |
| `docs/04-core-services.md` (`docs/04`) | §2 – §15, §17 – §20 (Service Catalog, Tests, `ctx.js`) | [`services/contracts.md`](./services/contracts.md) |
| `docs/04-core-services.md` (`docs/04`) | §16 (`ctx.logger` Transports, Ring Buffer, Files) | [`services/logging.md`](./services/logging.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §1 (`ctx.audio`, Web Audio Engine) | [`audio/engine.md`](./audio/engine.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §2, §4 – §8 (`ctx.player`, Queue, State Machine, OS Integration) | [`audio/playback.md`](./audio/playback.md) |
| `docs/05-audio-playback.md` (`docs/05`) | §3 (`ctx.dsp`, Effect Chain, Built-in DSP) | [`audio/dsp.md`](./audio/dsp.md) |
| `docs/06-music-sources.md` (`docs/06`) | §1 – §2 (Model, Top-level Fields, Rule Blocks) | [`sources/spec.md`](./sources/spec.md) |
| `docs/06-music-sources.md` (`docs/06`) | §3 (Rule Language, 6 Engines, Combinators) | [`sources/rule-engines.md`](./sources/rule-engines.md) |
| `docs/06-music-sources.md` (`docs/06`) | §4 – §6, §8 (Runtime Lifecycle, Cookies, Streams, Sandbox Trust) | [`sources/runtime.md`](./sources/runtime.md) |
| `docs/06-music-sources.md` (`docs/06`) | §7, §9 – §14 (Authoring Workflow, Errors, Sharing, Scanner) | [`sources/authoring.md`](./sources/authoring.md) |
| `docs/07-data-model.md` (`docs/07`) | §1 (URN Grammar & Linking) | [`data-model/urn.md`](./data-model/urn.md) |
| `docs/07-data-model.md` (`docs/07`) | §2 – §4, §7 (ER Model, SQLite Conventions, Tables, Runtime Types) | [`data-model/schema.md`](./data-model/schema.md) |
| `docs/07-data-model.md` (`docs/07`) | §5 (Waterfall Hooks & Typed Events) | [`data-model/events.md`](./data-model/events.md) |
| `docs/07-data-model.md` (`docs/07`) | §6, §8 (Forward Migrations, Schema Versioning) | [`data-model/migrations.md`](./data-model/migrations.md) |
| `docs/08-ui-architecture.md` (`docs/08`) | §1 – §5, §7 – §9 (3-Package Pattern, Descriptors, Shells, A11y) | [`ui/architecture.md`](./ui/architecture.md) |
| `docs/08-ui-architecture.md` (`docs/08`) | §6 (Visual Design Language, Dark Aesthetic, Tokens) | [`ui/design-system.md`](./ui/design-system.md) |
| `docs/09-project-structure.md` (`docs/09`) | §1 – §3 (Repository Layout, Layers, Dependency Matrix) | [`workflow/structure.md`](./workflow/structure.md) |
| `docs/09-project-structure.md` (`docs/09`) | §4 – §5 (Build Pipelines & Dependency Matrix) | [`workflow/build-pipelines.md`](./workflow/build-pipelines.md) |
| `docs/09-project-structure.md` (`docs/09`) | §6 – §8 (Testing Strategy, Developer Workflow, Commands) | [`workflow/testing.md`](./workflow/testing.md) |
| `docs/10-roadmap.md` (`docs/10`) | All (Milestones M0 – M5 & Risk Register) | [`roadmap/roadmap.md`](./roadmap/roadmap.md) |
| `docs/11-roadmap-M1.md` (`docs/11`) | All (Historical M1 Plan & Verification) | [`roadmap/archive-m1.md`](./roadmap/archive-m1.md) |

---

## The one-paragraph version

A Cordis `Context` is created inside the app's single JavaScript runtime — Hermes on mobile, the
Electron renderer on desktop. That context is **Layer 1**, the kernel. **Layer 2** is a small set
of **core plugins** that claim service keys (`ctx.fs`, `ctx.http`, `ctx.db`, `ctx.js`, …); they are
the *only* code in the repository allowed to import a platform SDK or to drive the kernel, and
there is one implementation per target behind each key. Above them sits **Layer 3**, three log
transports that subscribe to `ctx.logger` and decide where a line ends up; then **Layer 4** feature
plugins provide playback, DSP, downloads, the library and the sources, and **Layer 5** — the shells
and the view packages — turns those into pages. None of them may reach past Layer 2 to the
platform, or past Layer 3 to a console. All
contracts — service interfaces, entity types, and the typed event map — live in **Layer 0**, a
single runtime-free package, `@BBeBee/protocol`, which every other layer depends on and which is
the seam that makes implementations interchangeable. Features compose with each other through Cordis
**waterfall hooks**, so that, for example, the download plugin can transparently substitute a
local file for a stream URL without the player knowing downloads exist. **Music sources sit
outside all of this**: they are imported documents, held as rows, interpreted by
`plugin-source-runtime`, and presented to the rest of the app through the same provider interface
the local-files plugin implements — so nothing above `ctx.sources` can tell where a track came
from.

---

## Conventions used in these documents

- **Layer 0–5** — the six layers of [architecture/layers.md §1](./architecture/layers.md#1-the-layer-model): protocol,
  kernel, core plugins, log transports, feature plugins, UI & business function. Written as
  "Layer 2" throughout; a package's layer is what decides which imports it may write.
- **Service key** — a name claimed on the context, e.g. `ctx.player`. Written with the `ctx.`
  prefix throughout so it is never confused with a package name.
- **Package name** — always fully qualified, e.g. `@BBeBee/plugin-download`.
- **Source** — one music backend as the user configured it, identified by its `sourceUrl` and
  addressed by a derived **source id**. A *source string* is its importable text form.
- **URN** — a stable identifier for a catalog entity, e.g.
  `BBeBee:music-example-org-35be9fe2:track:8f1a2c`. Defined in [data-model/urn.md](./data-model/urn.md).
- TypeScript blocks are **contracts**, not illustrations. They are intended to compile.
- Tables named in `snake_case` are SQLite tables. Types in `PascalCase` are TypeScript.
- ⚠️ marks a place where the two platforms genuinely differ and the abstraction leaks. These are
  called out deliberately rather than hidden.
