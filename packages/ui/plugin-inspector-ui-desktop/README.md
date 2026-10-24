# @bbebee/plugin-inspector-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-inspector`: the renderer for the plugin graph (fiber tree + labeled effects).

## Overview

The UI half of M0's final exit criterion: the headless `ctx.inspector` produces serializable snapshots, and this package renders them. **Pure structure** — all data comes from `ctx.inspector`.

## Source files

### `src/index.tsx`

**Registered views and routes** (generator effect `'inspector-ui'`):

- `ctx.ui.registerView('inspector.panel', bound(ctx, InspectorPanel))`;
- `ctx.ui.contribute({ kind: 'route', id: 'inspector.panel', path: '/inspector', title: 'Inspector', icon: 'bug', placement: ['sidebar'], order: 900 })` — the developer route at the end of the sidebar.

**Components**:

- **`InspectorPanel({ ctx })`** — the top-level panel (monospace, 13px). `useState` initialized from `ctx.inspector.snapshot()`; **polls once per second** — the fiber tree has no change events (plugin load/unload tells nobody), polling is cheap, and this is a dev tool. Header: the "Plugin graph" title + a status count summary (`n pending · n active · …`, same format as `render()`'s summary).
- **`Fiber({ node })`** — renders one fiber recursively: name (bold) + status badge (`STATE_COLOR` map: ACTIVE green / PENDING·LOADING orange / FAILED red / UNLOADING·DISPOSED·UNKNOWN gray) + `provides …` (purple) / `waiting …` (orange) lines — **the "waiting" line is the answer to "why is this plugin PENDING"** (the graphical version of `ctx.inspector.render()` in the docs/12 gotcha table). Child fibers use a nested `<ul>` with a left border; effects (the `Effects` component) are listed as `· label` under their fiber, with nested effects expanded recursively.
- **`INSPECTOR_VIEW = 'inspector.panel'`** — the view id constant.

**`bound(ctx, Screen)`** — this package's comment is the most dramatic record of the pattern in the whole repo: **"This is what made the inspector page a black window"** — the shell renders views with its own context (`app.ready(['ui'])`), and `InspectorPanel` reading `ctx.inspector` throws `cannot get property "inspector" without inject` **at render time**; with no error boundary above React the whole tree unmounted and the page was left with only the body's background color. This package used to be the last view package without the closure. `h(Screen, …)` rather than a function call (independent hook chain).

## Declaration and exports

```ts
export const name = 'plugin-inspector-ui-desktop'
export const inject = ['ui', 'inspector']
export const INSPECTOR_VIEW = 'inspector.panel'
export function InspectorPanel
export async function apply(ctx)
export default { name, inject, apply }
```

Desktop only — there is no developer panel on mobile (the manifest's `entry.ui` declares desktop only).

## Tests

`src/index.test.tsx`: markup assertions on the panel rendering and the tree structure.

## Related docs

- `packages/feature/plugin-inspector/README.md`: the headless side (snapshot structure, guardrails)
- `docs/03-plugin-system.md` §2: the fiber tree
- `docs/12` (the gotcha table in AGENTS.md §12): the textual version of `ctx.inspector.render()`
