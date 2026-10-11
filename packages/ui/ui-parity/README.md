# @BBeBee/ui-parity

Layer 5 (ui) — the check that makes ADR-2 affordable.

## Overview

Two kits, zero shared component code, one product. Without a gate the kits drift: one end renames a prop, a component exists on only one end, a palette is readable in only one scheme. Fixed the week it happens this is cheap; a year later it is expensive — by then every plugin author has written code around it.

So the component set is **data**, checked in CI, rather than an agreement. A plugin author writing the two view packages should be transcribing, not redesigning (docs/08 §6). Adding a component here is a deliberate act: it promises that someone will write it twice.

## Source files

### `src/contract.ts` — the component contract (data)

- **`ComponentSpec` / `PropSpec`** — `{ name, purpose, props: [{ name, required?, note? }] }`. The `note` states why a prop exists; the moment to read it is "someone is deciding whether a new component really needs a seventh prop".
- **`UNIVERSAL`** — the `testID` and `accessibilityLabel` every component accepts: the accessible name is written once, here, and each kit maps it to `aria-label` or `accessibilityLabel`; a per-component decision would guarantee someone gets it wrong.
- **`COMPONENT_CONTRACT: ComponentSpec[]`** — the full contract of the 11 components (`Button`, `IconButton`, `TrackRow`, `Slider`, `Sheet`, `List`, `EmptyState`, `Toast`, `TextField`, `Text`, `Artwork`), each with a purpose and per-prop notes (e.g. the division of labor between `Slider.onChange`/`onCommit`, `TextField.multiline` answering "hundreds of lines of JSON against a one-line rule", `IconButton.accessibilityLabel` being the only required label).
- `COMPONENT_NAMES` — the list of names, used by `checkParity` to judge "exports outside the contract".

### `src/index.ts` — the checker

| Export | Purpose |
|---|---|
| `KitExports` / `KitPropMap` | One kit as the checker sees it: its export object — the check runs on module objects, **no renderer, DOM, or device needed**, which is exactly why it can run in CI on every change rather than once a release. The props manifest is a **declaration, not reflection**: React component parameter names are erased at runtime, and recovering them via a build step is more suspect than the manifest itself. |
| `checkParity(input): ParityProblem[]` | Produces a list of problems (not a boolean — CI logs must be able to name the component and prop directly): <br>· `missing` — one end lacks a contracted component<br>· `extra` — an **uppercase** component exported outside the contract (plugin authors will find and use it; helpers are not restricted)<br>· `not-a-component` — a wrong shape in the barrel file<br>· `missing-prop` — the manifest does not declare a prop the contract requires<br>· `contrast` — a WCAG AA failure in the palette (from `ui-tokens.paletteContrastIssues()`) |
| `formatProblems(problems)` | A CI-readable message; an empty list prints "kits are in parity". |
| `specFor(name)` / `requiredProps(name)` | Contract entry lookups for the kits' own tests. |

## Tests (the gate closing its loop)

- **`index.test.ts`** — the checker's own behavior (that each kind of problem is produced).
- **`kits.test.ts`** — using the **real manifests of both kits** (`@BBeBee/ui-kit-desktop/manifest`, `@BBeBee/ui-kit-mobile/manifest`), asserts: correct target identifiers, `checkParity` finds no problems, both ends' export-name sets equal the contract, and **per-component props, once sorted, are exactly identical** — specifically guarding against "one end quietly grows one extra prop", the most expensive and least visible drift.

## Exports

```ts
export interface PropSpec / ComponentSpec / ParityProblem / ParityInput
export type KitExports / KitPropMap
export const COMPONENT_CONTRACT, COMPONENT_NAMES
export function checkParity, formatProblems, specFor, requiredProps
```

## Related docs

- `docs/08-ui-architecture.md` §6, `docs/11-roadmap-M1.md` §4.11
- `packages/ui/ui-kit-desktop/manifest.ts`, `packages/ui/ui-kit-mobile/manifest.ts`: the two declarations this package consumes
