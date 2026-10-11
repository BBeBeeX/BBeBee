# @BBeBee/plugin-ui

Layer 4 (feature) — `ctx.ui`: the contribution registry.

## Overview

Plugins register **renderer-agnostic descriptors** — `route`, `slot`, `command`, `settings`, `menu` — and each shell (desktop's React DOM / mobile's React Native) resolves those names onto its own component set. This is the entire mechanism behind "one headless plugin serves two shells" (ADR-2).

The registry itself is deliberately "dumb": it only **stores, sorts, and hands back**. Every decision about what a contribution *looks like* belongs to the shell. See docs/08 §2.

## Source files

### `src/index.ts`

The package's only source file, containing the `Ui` service, the event declarations, and the plugin entry point.

**`Ui extends Service implements UiService`** (occupies the `ctx.ui` service key):

| Member | Purpose |
|---|---|
| `contribute(c): Disposable` | Registers a contribution. Returns a disposer — when a plugin unloads, its contribution goes with it, and the shell "naturally stops seeing it", with no invalidation protocol needed. Emits `ui/changed` on every add/remove. |
| `registerView(id, component): Disposable` | Binds a view id to a component. Registering the same id twice only warns and ignores the later one (two packages fighting over one id means the shell renders "whichever loaded last" — a coin-flip bug). |
| `routes` / `commands` / `menus` / `settings` | Read-only lists filtered by `kind`. Sort rule: the `order` field first, insertion order second, **never object identity** (`byOrder`). |
| `slotsFor(slot): SlotContribution[]` | The contributions under a given slot id. |
| `runCommand(id, args?)` | Finds and runs a command by id; throws if it does not exist. |
| `viewFor(id): unknown \| undefined` | Returns the component bound to an id. **`undefined` is a normal state, not an error**: a plugin may ship a desktop view but no mobile view — the shell renders a placeholder rather than crashing (the standing cost of ADR-2, docs/08 §3). |
| `missingViews(): string[]` | The ids of routes/slots/settings contributed without a matching view on this target; drives diagnostics. |

**Key type decision**: `registerView`'s `component` parameter is `unknown` — `@BBeBee/protocol` depends on no React variant, and type narrowing happens at each shell's own boundary, cast exactly once.

## Events

- `ui/changed` (via the `Events` augmentation): emitted whenever any contribution or view registration changes; the shells listen to it to re-read the registry.

## Configuration and capabilities

- No config, no inject, `capabilities: []`.
- Contributes the service key: `ui`.

## Exports

```ts
export class Ui extends Service   // ctx.ui
export const name = 'plugin-ui'
export async function apply(ctx: Context)  // deliberately awaits ctx.plugin(Ui)
export default { name, apply }
```

> ⚠️ `apply` must be an `async function` and deliberately `await ctx.plugin(...)` internally (same reasoning as every service plugin; see `conventions.test.ts` and this package's comments).

## Related docs

- `docs/08-ui-architecture.md` §2/§3: the descriptor model, "one plugin, two shells"
- `packages/protocol/src/services/ui.ts`: the full definitions of every `Contribution` kind
