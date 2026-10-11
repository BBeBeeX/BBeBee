# @BBeBee/plugin-local-scanner-ui-mobile

Layer 5 (ui) — the mobile view package of `plugin-local-scanner` (headless): the twin half of the desktop version.

## Overview

The React Native version of the same scan-roots settings screen: the same hooks (`useScanRoots`/`useScanState`/`summarise`), the same view id (`scanner.settings`), the same behavior — only the elements differ. Progress bookkeeping lives in the headless hooks, shared by both shells.

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'scanner-ui-mobile'`):

| id | Component |
|---|---|
| `scanner.settings` | `ScanRootsScreen` |

**`ScanRootsScreen({ ctx })`** — maps one-to-one onto desktop, with the elements swapped for the RN primitives from `nativePrimitives()` (`View` etc., asserted `as never`):

- Header row (RN `flexDirection: 'row'`): "Music folders" + "Add folder" (`ctx.fs.pickDirectory()` — the picker is what carries Android's persistable permission, deliberately no text field) + "Scan now" (disabled, not hidden) + "Cancel" while scanning;
- Progress row / `summarise(lastSummary)` (errors → warn tone) — updated per batch, so a large library never looks frozen the whole time;
- Root list: `List<ScanRoot>` + empty state 📁 "No folders yet"; per row the URI, `lastError` on the row (error tone), `Enable/Disable` (with a URI-bearing `accessibilityLabel`), 🗑 remove (tracks kept by default);
- Bottom-of-screen note: "Removing a folder keeps the tracks it found. Nothing is deleted from disk."

**`bound(ctx, Screen)`** — closes over the context at this plugin's `apply` time; `h(Screen, …)` rather than a function call (the same pattern as every view package, guarding against `cannot get property … without inject` thrown off the shell context).

## Declaration & exports

```ts
export const name = 'plugin-local-scanner-ui-mobile'
export const inject = ['ui', 'scanner', 'fs']
export function ScanRootsScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## Tests

`src/screen.test.tsx`: rendering assertions with fake primitives injected via `configureNative` (the same seam as the `ui-kit-mobile` tests).

## Related docs

- `packages/ui/plugin-local-scanner-ui-desktop/README.md`: the twin half (the full behavior description)
- `packages/feature/plugin-local-scanner/README.md`: the headless side
- `apps/mobile/`: `configureNative` and the settings-page mount
