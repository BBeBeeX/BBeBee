# @BBeBee/plugin-inspector

Layer 4 (feature) — `ctx.inspector`: the inspector that turns the plugin graph into readable data.

## Overview

M0's final exit criterion was "the plugin inspector can show the fiber tree with labeled effects". This is not a nice-to-have — the architecture's core claim is that **unloading a plugin must be total**, and the only way to tell whether it still holds anything is to look at its effect tree. The inspector is therefore the debugging tool for the invariant that carries every other invariant.

Deliberately headless: it produces serializable snapshots (`InspectorSnapshot`), which each shell (desktop/mobile) renders itself. See docs/03 §2.

## Source files

### `src/index.ts`

The package's only source file, containing the snapshot data structures, the `Inspector` service, and the plugin entry point.

**Data structures**:

- `EffectNode` — a labeled effect and its nested child effects.
- `FiberNode` — a node of the fiber tree: `name` / `uid` (`null` after destruction) / `state` / `inject` / `waitingFor` / `provides` / `effects` / `children`.
- `InspectorSnapshot` — `{ root, counts, stalled }`:
  - `counts`: the count of each fiber state (used by the header's stats row);
  - `stalled`: fibers that are loaded but not `ACTIVE`, with their reason (`waitingFor`).

**`Inspector extends Service`** (occupies the `ctx.inspector` service key):

| Member | Purpose |
|---|---|
| `snapshot(): InspectorSnapshot` | Walks the fiber tree. Cordis only exposes fibers through the registry and kinship is hidden inside `fiber.parent.fiber`, so the tree is rebuilt grouped by parent. **Depth guard of 32**: a `parent` cycle would hang the inspector, and a hung debugging tool is worse than none; the truncation is not silent — `warnOnce` says outright "this is a cycle in parentage". |
| `render(): string` | A plain-text tree (`├─`/`└─` plus effect `·` lines), for logs, bug reports, and the terminal; a state statistics summary is appended at the end. |
| `providedBy(fiber)` | Looks back through `ctx.reflect.store` and lists the service keys that fiber provides. |

**Load-bearing details**:

- `isAvailable()` reads `fiber.ctx[name]` inside try/catch: **when a required injection is missing, Cordis throws `cannot get required service … in inactive context`** rather than returning `undefined` — exactly the kind of broken state the inspector exists to display. A diagnostic tool must never throw on the very broken state it diagnoses.
- `warnOnce()`: the inspector is naturally read over and over (it is a live view of the fiber tree), so any log must be deduplicated at the source, otherwise every UI render turns a "one-time fact" into a log flood.
- An unknown fiber state renders as `UNKNOWN` with a single warning: `cordis` is pinned to an rc version precisely so it cannot move its state values underneath us; without this, drift would only ever surface as a badge nobody reads.

## Configuration and capabilities

- No config, no inject, `capabilities: []`.
- Contributes the service key: `inspector`.

## Exports

```ts
export class Inspector extends Service   // ctx.inspector
export interface EffectNode / FiberNode / InspectorSnapshot
export const name = 'plugin-inspector'
export async function apply(ctx: Context)  // deliberately awaits ctx.plugin(Inspector)
export default { name, apply }
```

> ⚠️ `apply` must be an `async function` (Cordis uses `!!func.prototype` to decide "is this a class"; a plain `function` gets `new`-ed and the returned disposer is lost), and it deliberately `await`s `ctx.plugin(...)` internally — an un-awaited child plugin does not propagate readiness. `conventions.test.ts` enforces both shapes.

## Related docs

- `docs/03-plugin-system.md` §2: lifecycle and the fiber tree
- `docs/09-project-structure.md`: layering and dependency rules
