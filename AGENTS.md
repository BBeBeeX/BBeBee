# AGENTS.md — working on BBeBee

A distilled guide for AI programming assistants. It is an index and authority summary of `docs/`: when this file and `docs/` disagree, `docs/` wins and this file is the bug.

---

## 1. What this project is

BBeBee is a cross-platform music player — Electron on desktop, Expo/React Native on mobile — built as a **plugin platform**, not an app with an extension API bolted on. The kernel is [Cordis](https://github.com/cordiverse/cordis) (DI + plugin lifecycle), and *everything above the kernel is a plugin*, including file I/O, networking, and persistence. Platform differences are absorbed by **swapping which implementation of a core service is loaded**, never by branching inside feature code.

**Music sources are not plugins.** A source is a JSON document the user imports as text (the legado book-source model applied to audio), interpreted by one built-in runtime (`plugin-source-runtime`) and sandboxed in its own QuickJS realm.

### The Two Invariants

Two invariants carry the whole design:

> **1. No package outside `packages/core/*` may import a platform SDK.**
> Not `expo-*`, not `react-native` native modules, not `electron`, not `node:*`.
>
> **2. No package above Layer 2 may drive the kernel.**
> Feature and UI packages may be *typed* by `@BBeBee/kernel` (the pinned Cordis re-exports);
> they may not import `createApp`, the config loader, the plugin loader, the capability gate,
> the SQL guards, or the migration runner.

Both are enforced by `eslint.config.js` and by tests in `packages/kernel/src/`. A failure in either usually means an architectural mistake, not a typo.

---

## 2. Commands

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — the whole gate before PR
pnpm check:changed           # typecheck + lint + test on diff only
```

| Command | Does |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`. The one command before finishing work |
| `pnpm check:changed` | Fast diff-only check for packages affected by current diff |
| `pnpm test` | Vitest once over every package |
| `pnpm test packages/kernel` | Run single package tests |
| `pnpm typecheck` | `tsc --noEmit` across all workspace projects |
| `pnpm lint` / `pnpm lint:fix`| ESLint, including the architectural layer rules |
| `pnpm gen:plugins` | Regenerate `apps/mobile/generated/plugins.ts` and inspector manifests |
| `pnpm new:plugin` | Scaffold a new plugin |
| `pnpm dev:desktop` | Electron dev with HMR |
| `pnpm dev:mobile` | Expo dev client (**custom dev build**, not Expo Go) |

---

## 3. The Layer Model

The filesystem **is** the layer model. Packages live at `packages/<layer>/<package>`:

```
packages/protocol/    Layer 0 — contracts, zero runtime, zero dependencies
packages/kernel/      Layer 1 — Cordis Context, DI, fibers, config, dynamic loader, gate, migrations
packages/core/        Layer 2 — core capability services; ONLY layer touching platform SDKs
packages/logs/        Layer 3 — log transports; ONLY layer that may write to console
packages/feature/     Layer 4 — headless business features
packages/ui/          Layer 5 — views and UI infrastructure (apps/* are Layer 5 too)
packages/sdk/         outside model — public SDK for plugin developers
packages/tooling/     outside model — build scripts & codegen
```

### Import Matrix

| | L0 `protocol/` | L1 `kernel/` | L2 `core/` | L3 `logs/` | L4 `feature/` | L5 `ui/`, `apps/*` | Platform SDK |
|---|---|---|---|---|---|---|---|
| **L0** may import | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L1** may import | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L2** may import | ✅ | ✅ all of it | own package | ❌ | ❌ | ❌ | ✅ **only here** |
| **L3** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | a sibling | ❌ | ❌ | ❌ |
| **L4** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | ❌ *(`ctx.logger`)* | types only | ❌ | ❌ |
| **L5** may import | ✅ | ⚠️ plugin surface only | ❌ *(service keys)* | ❌ *(`ctx.logger`)* | ⚠️ public subpaths | ✅ | ⚠️ view lib in `ui/*` |
| **Composition root** | ✅ | ✅ | ✅ | ✅ | ✅ (as data) | ✅ | ✅ |

The kernel's **plugin surface** (the only kernel exports Layers 3, 4, 5 may import):
`Context`, `Service`, `Inject`, `Plugin`, `Fiber`, `Effect`, `EffectMeta`, `InjectSpec`, `FiberState`, `FiberStateName`, `FiberStateValue`, `fiberStateName`, `isActive`, `isSettled`.

Composition root is exactly 4 files: `apps/mobile/src/{boot,plugins}.ts` and `apps/desktop/renderer/{boot,plugins}.ts`.

---

## 4. Writing a Plugin

1. Entry points must be `async function`, arrow function, or method shorthand (plain functions discard disposer).
2. Side effects must go through the fiber: wrap disposers in local closures `return () => off()`.
3. Dependencies are declared via `inject: [...]`. Optional dependencies use `ctx.inject([...], ...)`.
4. Log through `ctx.logger`, never `console.log`.
5. Reusable pure helpers belong in `@BBeBee/toolkit`, not duplicated in feature packages. Shared React service bindings (hooks that read a service via `ctx`) live in the `@BBeBee/toolkit/hooks` subpath; a view package imports another feature's bindings from there, never from that feature's package.
6. Decompose large UI packages into single-responsibility submodules (`src/{components,screens,hooks,utils,index.tsx}`); avoid monolithic single-file packages.
7. Every plugin package must include a standardized `BBeBee.plugin.json` declaring 15 fields: `id`, `name`, `displayName`, `description`, `version`, `author`, `engines`, `enabled`, `dependencies`, `systemId` (`'layer-2'`-`'layer-5'`), `moduleId` (domain), `entry`, `capabilities`, `contributes`, `effect` (with optional `platforms`). Run `pnpm gen:plugins` after changes.

```ts
import type { Context } from '@BBeBee/protocol'

export const name = 'plugin-example'
export const inject = ['player']

export async function apply(ctx: Context) {
  const off = ctx.on('player/track-changed', (t) => {
    ctx.logger.info(`Track changed: ${t?.title}`)
  })
  return () => off()
}
```

---

## 5. Specialized Rule Modules

For deep requirements and domain rules, consult the dedicated rule files in `rules/`:

- [rules/plugins.md](./rules/plugins.md) `L2` — load when writing or modifying any plugin: entry shape, fiber side effects, DI, capability grammar, the 15-field manifest.
- [rules/services.md](./rules/services.md) `L2` — load when touching core services, platform SDK boundaries, or logging: service keys, opaque URIs, Layer 3 discipline.
- [rules/data-model.md](./rules/data-model.md) `L2` — load when touching URNs, SQLite, migrations, or events: storage conventions, waterfall semantics, state ownership.
- [rules/ui.md](./rules/ui.md) `L2` — load when touching any UI package: three-package convention, hooks, hard constraints (design details live in [docs/ui/design-system.md](./docs/ui/design-system.md) `L3`).
- [rules/sources.md](./rules/sources.md) `L2` — load when authoring music sources or touching the sandbox/registry: source documents, rule engines, install red lines.
- [rules/testing-and-gotchas.md](./rules/testing-and-gotchas.md) `L2` — load when writing tests or debugging: the five test gates, the gotchas table, project status & version pins.

---

## 6. Full Documentation Map

The comprehensive technical specifications live in `docs/`:

Tags: `L2` = load for the matching task; `L3` = read on demand (large, detailed — jump to the section you need).

| Topic | Primary Docs | Load when |
|---|---|---|
| Architecture & ADRs | [docs/README.md](./docs/README.md) `L2`, [docs/architecture/overview.md](./docs/architecture/overview.md) `L2`, [docs/architecture/layers.md](./docs/architecture/layers.md) `L3` | orientation & doc map, ADR history, boot sequence & layer boundaries |
| Plugin System & DI | [docs/plugins/concepts.md](./docs/plugins/concepts.md) `L3`, [docs/plugins/loading.md](./docs/plugins/loading.md) `L3`, [docs/plugins/capabilities.md](./docs/plugins/capabilities.md) `L3`, [docs/plugins/isolation.md](./docs/plugins/isolation.md) `L3` | why the plugin model, loader, gate, and isolation behave as they do |
| Core Services | [docs/services/overview.md](./docs/services/overview.md) `L3`, [docs/services/contracts.md](./docs/services/contracts.md) `L3` (in-file TOC), [docs/services/logging.md](./docs/services/logging.md) `L3` | per-service contracts & rationale; contracts.md carries an anchor TOC |
| Audio & DSP Chain | [docs/audio/engine.md](./docs/audio/engine.md) `L3`, [docs/audio/playback.md](./docs/audio/playback.md) `L3`, [docs/audio/dsp.md](./docs/audio/dsp.md) `L3` | audio engines, transport state machine, DSP chain specifics |
| Music Sources | [docs/sources/spec.md](./docs/sources/spec.md) `L3`, [docs/sources/rule-engines.md](./docs/sources/rule-engines.md) `L3`, [docs/sources/runtime.md](./docs/sources/runtime.md) `L3`, [docs/sources/registry.md](./docs/sources/registry.md) `L3`, [docs/sources/authoring.md](./docs/sources/authoring.md) `L3`, [docs/sources/parameters.md](./docs/sources/parameters.md) `L3` | source model, rule language, sandbox limits, registry & install flows, authoring workflow |
| Data & Storage | [docs/data-model/urn.md](./docs/data-model/urn.md) `L3`, [docs/data-model/schema.md](./docs/data-model/schema.md) `L3`, [docs/data-model/events.md](./docs/data-model/events.md) `L3`, [docs/data-model/migrations.md](./docs/data-model/migrations.md) `L3` | table-level detail, the event canon, migration mechanics |
| UI & Design Tokens | [docs/ui/architecture.md](./docs/ui/architecture.md) `L3`, [docs/ui/design-system.md](./docs/ui/design-system.md) `L3` | shell/rendering internals; design specs & visual values (migrated from rules/ui.md) |
| Workflow & Testing | [docs/workflow/structure.md](./docs/workflow/structure.md) `L3`, [docs/workflow/testing.md](./docs/workflow/testing.md) `L3`, [docs/workflow/build-pipelines.md](./docs/workflow/build-pipelines.md) `L3` | repo layout, test workflow & PR checklist, build & version matrix |
| Roadmap | [docs/roadmap/roadmap.md](./docs/roadmap/roadmap.md) `L3`, [docs/roadmap/archive-m1.md](./docs/roadmap/archive-m1.md) `L3` (archived, unmaintained) | milestone detail; the archive is a historical record only |

---

## 7. Checklist Before Finishing a Change

- [ ] `pnpm check` passes cleanly (or `pnpm test packages/<pkg>` for single package).
- [ ] `pnpm gen:plugins` produces no diff.
- [ ] No platform SDK imported outside `packages/core/*`.
- [ ] No bootstrap surface imported from `@BBeBee/kernel` above Layer 2.
- [ ] Every listener, timer, or socket registered via `ctx.effect()` or returned as disposer.
- [ ] Logs through `ctx.logger`, never `console.log`.
- [ ] `docs/` and `rules/` updated when behaviour or contracts changed.
