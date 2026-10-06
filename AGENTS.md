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
`Context`, `Service`, `Inject`, `Plugin`, `Fiber`, `Effect`, `EffectMeta`, `InjectSpec`, `FiberState`, `fiberStateName`, `isActive`, `isSettled`.

Composition root is exactly 4 files: `apps/mobile/src/{boot,plugins}.ts` and `apps/desktop/renderer/{boot,plugins}.ts`.

---

## 4. Writing a Plugin

1. Entry points must be `async function`, arrow function, or method shorthand (plain functions discard disposer).
2. Side effects must go through the fiber: wrap disposers in local closures `return () => off()`.
3. Dependencies are declared via `inject: [...]`. Optional dependencies use `ctx.inject([...], ...)`.
4. Log through `ctx.logger`, never `console.log`.
5. Reusable pure helpers belong in `@BBeBee/toolkit`, not duplicated in feature packages. Shared React service bindings (hooks that read a service via `ctx`) live in the `@BBeBee/toolkit/hooks` subpath; a view package imports another feature's bindings from there, never from that feature's package.
6. Decompose large UI packages into single-responsibility submodules (`src/{components,screens,hooks,utils,index.tsx}`); avoid monolithic single-file packages.
7. Every plugin package must include a standardized `BBeBee.plugin.json` declaring 14 fields: `id`, `name`, `displayName`, `description`, `version`, `author`, `engines`, `enabled`, `dependencies`, `systemId` (`'layer-2'`-`'layer-5'`), `moduleId` (domain), `entry`, `capabilities`, `contributes`, `effect`. Run `pnpm gen:plugins` after changes.

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

- [rules/plugins.md](./rules/plugins.md): Plugin authoring details, service classes, dynamic loading, capabilities.
- [rules/services.md](./rules/services.md): Core services catalog, platform SDK boundary, Layer 3 logging.
- [rules/data-model.md](./rules/data-model.md): URN grammar, SQLite WAL & transactions, Waterfall event hooks.
- [rules/ui.md](./rules/ui.md): Three-package UI convention, descriptors, hooks, and dark streaming design system.
- [rules/sources.md](./rules/sources.md): Music sources JSON, 6 rule engines, QuickJS sandbox, authoring CLI.
- [rules/testing-and-gotchas.md](./rules/testing-and-gotchas.md): Test gates, gotchas table, known project gaps.

---

## 6. Full Documentation Map

The comprehensive technical specifications live in `docs/`:

| Topic | Primary Docs |
|---|---|
| Architecture & ADRs | [docs/architecture/overview.md](./docs/architecture/overview.md), [docs/architecture/layers.md](./docs/architecture/layers.md) |
| Plugin System & DI | [docs/plugins/concepts.md](./docs/plugins/concepts.md), [docs/plugins/loading.md](./docs/plugins/loading.md), [docs/plugins/capabilities.md](./docs/plugins/capabilities.md) |
| Core Services | [docs/services/overview.md](./docs/services/overview.md), [docs/services/contracts.md](./docs/services/contracts.md), [docs/services/logging.md](./docs/services/logging.md) |
| Audio & DSP Chain | [docs/audio/engine.md](./docs/audio/engine.md), [docs/audio/playback.md](./docs/audio/playback.md), [docs/audio/dsp.md](./docs/audio/dsp.md) |
| Music Sources | [docs/sources/spec.md](./docs/sources/spec.md), [docs/sources/rule-engines.md](./docs/sources/rule-engines.md), [docs/sources/runtime.md](./docs/sources/runtime.md) |
| Data & Storage | [docs/data-model/urn.md](./docs/data-model/urn.md), [docs/data-model/schema.md](./docs/data-model/schema.md), [docs/data-model/events.md](./docs/data-model/events.md) |
| UI & Design Tokens | [docs/ui/architecture.md](./docs/ui/architecture.md), [docs/ui/design-system.md](./docs/ui/design-system.md) |
| Workflow & Testing | [docs/workflow/structure.md](./docs/workflow/structure.md), [docs/workflow/testing.md](./docs/workflow/testing.md) |
| Roadmap | [docs/roadmap/roadmap.md](./docs/roadmap/roadmap.md), [docs/roadmap/archive-m1.md](./docs/roadmap/archive-m1.md) |

---

## 7. Checklist Before Finishing a Change

- [ ] `pnpm check` passes cleanly (or `pnpm test packages/<pkg>` for single package).
- [ ] `pnpm gen:plugins` produces no diff.
- [ ] No platform SDK imported outside `packages/core/*`.
- [ ] No bootstrap surface imported from `@BBeBee/kernel` above Layer 2.
- [ ] Every listener, timer, or socket registered via `ctx.effect()` or returned as disposer.
- [ ] Logs through `ctx.logger`, never `console.log`.
- [ ] `docs/` and `rules/` updated when behaviour or contracts changed.
