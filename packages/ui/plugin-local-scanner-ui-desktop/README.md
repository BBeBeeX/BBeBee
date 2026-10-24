# @bbebee/plugin-local-scanner-ui-desktop

Layer 5 (ui) — the desktop view package of `plugin-local-scanner` (headless): the scan-roots settings screen.

## Overview

Which folders exist, what happened on the last scan, and a way to kick off a traversal. Layout and wiring only — progress bookkeeping lives in `plugin-local-scanner/hooks`, shared with the mobile twin (docs/08 §1).

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'scanner-ui-desktop'`):

| id | Component |
|---|---|
| `scanner.settings` | `ScanRootsScreen` |

**`ScanRootsScreen({ ctx })`** — the scan-root management screen. Fed by `useScanRoots` + `useScanState` (headless hooks). Structure:

- **Header row**: a "Music folders" title + "Add folder" + "Scan now" (while scanning it reads "Scanning…" and is `disabled` — **disabled, not hidden**: "a control that vanishes mid-scan makes the screen look like it lost a button") + a "Cancel" (ghost) that appears while scanning.
  - **`addFolder()` goes through `ctx.fs.pickDirectory()`**: the picker is what carries persistable permission on Android; a hand-typed path cannot get one — hence **deliberately no text field**.
- **Progress row** (per batch, not per file): `scan.progress` → "Scanned N of M / Scanned N files"; otherwise `scan.lastSummary` → "Last scan: …" (`summarise`), **tone `'warn'` when there are errors**. A large library takes minutes to scan, and a screen that only learns the result at the end looks frozen the whole time.
- **Root list**: `List<ScanRoot>` (`estimatedItemSize: tokens.size.row`), empty state 📁 "No folders yet". Per row: the URI (one clipped line) + **the failure reason `root.lastError` shown on the row in error tone** — "why a folder failed stays in front of the user, not only in a log they will never open"; `Enable/Disable` buttons (`accessibilityLabel` derived from the URI); a 🗑 `IconButton` to remove.
  - **Removal keeps tracks by default** (`removeRoot(id)` without `forgetTracks`) — "one mis-tap wiping a whole library is far worse than one row of stale data". A fixed line at the bottom of the screen explains: "Removing a folder keeps the tracks it found. Nothing is deleted from disk."
- Disabled root rows use `opacity: 0.5`.

**`bound(ctx, Screen)`** — closes over the context at this plugin's `apply` time (the shell's context carries only `ui`; reading `ctx.scanner` on it throws); `h(Screen, …)` rather than a function call.

## Declaration & exports

```ts
export const name = 'plugin-local-scanner-ui-desktop'
export const inject = ['ui', 'scanner', 'fs']
export function ScanRootsScreen
export async function apply(ctx)
export default { name, inject, apply }
```

`fs` is in `inject` because of `pickDirectory` — adding a folder is the only place this screen directly consumes a platform-capability service.

## Tests

`src/screen.test.tsx`: rendering and interaction of the settings screen (root list, progress/summary rows, scan button states).

## Related docs

- `packages/feature/plugin-local-scanner/README.md`: the headless side (`ScannerService`, hooks, the incomplete semantics of `summarise`)
- `packages/ui/plugin-local-scanner-ui-mobile/README.md`: the twin half
