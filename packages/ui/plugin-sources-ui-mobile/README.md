# @BBeBee/plugin-sources-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-sources` (headless): the twin half of `plugin-sources-ui-desktop`.

## Overview

The **same hooks, the same view ids, the same behavior** as the desktop version — only the elements and shapes differ. All domain state comes from `@BBeBee/plugin-sources/hooks`; kit primitives are obtained via `nativePrimitives()` (injected by `ui-kit-mobile`'s `configureNative`); the headless package is only a devDependency.

## Source files

### `src/index.tsx`

**Registered views** (generator effect, fiber name `'sources-ui-mobile'`): `sources.search` / `sources.settings` / `sources.import` / `sources.test`, four screens isomorphic with the desktop. The library home lives in `plugin-library-ui-mobile`, album details in `plugin-album-ui-mobile`.

**Screens** (behavior matches the desktop; mobile differences listed below):

- **`AlbumScreen`** — moved to `plugin-album-ui-mobile` (`album.view`): a centred vertical header, a 200px cover, and a fallback navigation back to the library. The library and search screens only navigate to that route id.
- **`ImportScreen`** — multi-line `TextField` with `rows: 10` (desktop 14); a shorter placeholder; the report text always uses tone `'muted'` (the desktop uses `'accent'` when added/updated > 0). Preview, all issues and `summariseImport` behave identically.
- **`SearchScreen`** — the same hooks and the same row model as the desktop: hero state (search bar + source switches centred) → after submit both shrink to the top and the results fill the remaining height; Clear returns to the hero. The differences are layout only: the search box and the Search/Clear buttons are **stacked vertically** (the desktop has them side by side), the source switches wrap horizontally, and the results are still a single `List` (FlashList) carrying one section per source; tapping a track calls `playFromList`, album rows are handed to the router.
- **`TestScreen({ sourceId })`** — isomorphic with the desktop; all differences are in the controls: the source picker is a **Button plus an expanded option list** (RN has no native `<select>`), test sections and fields stack vertically, the Stream section has no quality input (the default quality is used), and the trace uses `View` + `borderLeftWidth/Color` + `Text variant: 'sm'` (no aria-live equivalent). The file comment adds one line: this screen matters most on the phone — sources pasted from forums break on the device, and the whole point of the "source as a string" model is being able to fix it on the spot.

**`bound(ctx, Screen)`** — same as every view package: closes over the context from this plugin's `apply`; `h(Screen, …)` rather than a function call.

## Tests (`src/screens.test.tsx`)

jsdom + Testing Library. Since jsdom has no RN, `configureNative({…})` first injects DOM host components standing in for View/Text/Pressable/Image/Modal/ActivityIndicator/TextInput, and **FlashList is implemented separately** (it consumes `data/renderItem/ListEmptyComponent` instead of children, mapping `accessibilityLabel/Role`, `testID` and `onPress` onto DOM attributes) — the **same seam** that `apps/mobile` swaps for real RN.

11 cases (the mobile file header states the scope explicitly: pin the shared assumptions (context shape), not full-screen parity):

1. **Library (4)** — renders a given directory (scoped context derived from `inject` + real `sourcesPlugin`; the library screen renders the inserted "Jóga"); taps must no-op without a player (click errors collected via `reportedDuring` asserted empty — a regression of a real-device bug shared with the desktop); an empty library shows "No music yet"; All/Local/Favorites scope switching;
2. **SourcesList (2)** — lists imported sources (name / URL / Test button), an empty list shows "No sources yet";
3. **Test (1)** — running a script in a build without a sandbox reports "no JavaScript sandbox" inline instead of failing silently;
4. **Search (4)** — before searching only the search bar and source switches exist, one independent section per source, a failing source reports its error while the others render normally, toggled-off sources are never asked. The mobile test pre-fills the query via the `query` prop (the host `TextInput` does not simulate typing).

## Related docs

- `docs/06-music-sources.md` §10: import/edit/trace screens
- `packages/feature/plugin-sources/README.md`: the headless side
- `packages/ui/plugin-sources-ui-desktop/README.md`: the twin half (with a fuller description of the desktop-side behavior)
