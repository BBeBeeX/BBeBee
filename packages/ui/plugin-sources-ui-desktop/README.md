# @BBeBee/plugin-sources-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-sources` (headless): layout, gestures and event wiring, nothing more.

## Overview

Binds the 4 view ids contributed by the headless package (`SOURCES_VIEWS`) to desktop kit components. All domain state comes from `@BBeBee/plugin-sources/hooks`; services are accessed through the injected `ctx.sources`; the headless package is only a devDependency (types/constants/tests) — not a runtime import, per the "Layer 5 sees Layer 4 as types only" rule.

> The album page has moved to `plugin-album-ui-desktop` (`album.view`). This package keeps only the five screens: library / search / source list / import / test; when the library and search screens navigate to an album they take the route id from `@BBeBee/plugin-album/views` (`ALBUM_VIEWS.album`).

**Shared discipline** (file-header comment): the loading / empty / failed states must be kept distinct — conflating them leaves the user staring at a blank area with no idea whether scanning is unfinished or the library read failed. `Pending` (`EmptyState`) and `Failed` (⚠ + error message + a "Try again" retry) are the implementation of that discipline.

## Source files

### `src/index.tsx`

**Registered views** (`apply` registers via generator effect `yield ctx.ui.registerView(...)`, fiber name `'sources-ui-desktop'`):

| id | component |
|---|---|
| `sources.search` | `SearchScreen` |
| `sources.import` | `ImportScreen` |
| `sources.test` | `TestScreen` |
| `sources.recommend` | `RecommendScreen` |
| `sources.recommendAll` | `RecommendAllScreen` |

All views are registered in `apply` and loaded on navigation.

**Screens**:

- **`AlbumScreen`** — moved to `plugin-album-ui-desktop` (`album.view`); the library and search screens only navigate to that route id.
- **`ImportScreen`** — paste a source string (a single document or a whole set). The reason this screen exists: a set pasted from a forum is opaque, and an import that "silently adds 11 sources" is one the user cannot undo, so **the button must name what will be imported before it is pressed**. `useSourceImport` (`preview` parsed as you type, **all** `issues` of each submit, `busy`/`report`/`submit`/`reset`) → multi-line `TextField` (`rows: 14`, placeholder mentions `ruleStream`) → preview block (`aria-label='What will be imported'`, "N source(s)" + list of names) → an `Import` button (`disabled: busy || !preview`) + `Clear` → result row `summariseImport(report)`: "N added, N updated, N unchanged, N rejected", **never an empty string** ("nothing to import" must also be said, otherwise it reads as if the button did nothing).
- **`SearchScreen`** — cross-source search with per-source panels. Hero state: the search bar sits on top with the source switches centred; after submit both shrink to the top and the remaining height goes to the results. All state comes from the headless package: `useSearchSourceSelection` (**exclusion-style** selection — every searchable source is selected by default, and newly imported sources join the next search automatically), `useSourceSearch` (`searchAll`, generation-guarded so late results never overwrite earlier ones; supports `loadMore(sourceId)` for per-source pagination). The top of the results area shows a total-source-count summary and quick "Expand all / Collapse all" switches; each source's results are wrapped in an independent **`SourcePanel`** card:
  - **Sticky header and independent collapse**: the panel header can be clicked to collapse/expand, with a smoothly rotating chevron, the source name, a status summary badge and request duration; configured with `position: sticky; top: 0; zIndex: 10` and an opaque frosted-glass surface, the **panel header stays pinned and visible while the panel body scrolls**;
  - **Constrained inner scrolling**: the container sets `maxHeight: min(520px, 60vh)`, the content area uses `flex: 1; minHeight: 0; overflowY: 'auto'`, so a single source's multi-page search results scroll smoothly inside its panel;
  - **Per-source pagination**: the bottom of the panel has a "Load more" button (`variant: 'secondary'`) that fetches only the current source's next page and appends it to the panel;
  - **Single-track enqueue semantics**: clicking a track row calls `playFromList(ctx, track.urn, { urns: [track.urn], context: { kind: 'search', label: search.text } })`, following the single-track playback mode — **only that one track** is added to and shown in the play queue, so auditioning from search never pollutes the user's real queue; album rows navigate to `/album/:urn`;
  - **Theme-aware colors**: everything uses CSS theme custom properties (`var(--surface-1)`, `var(--border-subtle)`, `var(--color-primary)` etc.) with `background:` shorthand, so the panels adapt to the active theme dynamically.
- **`TestScreen({ sourceId })`** — per-source capability-by-capability testing (docs/06 §10). The desktop uses a native `<select>` to pick the source; each test section appears only when the provider's derived capability/method exists — Search (`capabilities.search.tracks`), Browse, Album/Artist/Playlist/Lyrics (method exists), Library list (`capabilities.library.read`), Stream (present for any provider, quality options from `capabilities.streaming.qualities`), plus two probes that are not in the doc: HTTP via the source's own client (GET/POST, URL, headers JSON, body) and script (document functions in scope, code + args JSON). All runs flow into the right-hand `TraceList` (`<ol aria-live="polite">`, mono font, a 3px color bar on the left of each row): `http` → `METHOD url → status (Nms)` (**status 0 is spelled out as "no response"**), `error` → `✗`, `result` → `✓`, `log` → `·`, and `value` events use `JsonTree` (raw text when parsing fails). The left column is a 440px independent scroller and shows "No trace yet" before the first run. **Every step is shown, including successful ones** — failures usually happen two steps before the empty result; data is redacted upstream, this screen only lays it out.
- **`RecommendScreen`** — the main recommendation feed. The top shows two rows of personal album shelves ("Recently played · Albums" via `useRecentPlayedAlbums`, reading the albums behind the 20 most recent deduplicated plays; "Favorites picks · Albums" via `useFavoriteAlbums`, sampling the albums behind 20 random favorite songs), followed by dynamic playlist shelves for each third-party source that supports recommendations (`RecommendShelf`, each with a "Show all" jump to `RecommendAllScreen`). The shared shelf component `RecommendShelfRow` implements a bent-ends carousel with inset covers (only the leftmost and rightmost currently visible cards bend inward via `perspective + rotateY(±22deg)` 3D plus a cylindrical light-shade gradient; the bend and arrow on a given side disappear automatically at the first or last card; the outer container sets `overflowY: 'hidden'` so it never hijacks vertical page scrolling; large frosted-glass ❮ / ❯ buttons fade in on hover).
  - **Cold-Start Onboarding Hub & First-Run Wizard (`OnboardingHero`, `OnboardingModal`)**: When no sources are imported yet and user history is empty (`allSources.length === 0`), `RecommendScreen` replaces the plain empty state with `OnboardingHero`, providing two prominent, actionable paths:
    1. **Music Data Sources**: One-click local folder scanner trigger (`fs.pickDirectory` / `scanner.addSpecifiedDir`), local library navigation, and drag-and-drop audio file/folder hints; third-party source rule importer jump (`sources.import`) with QuickJS sandbox safety explanations.
    2. **Plugin Extensions**: Plugin discovery jump (`registry.screen`), highlighting desktop lyrics, DSP audio equalizer, visualizers, and themes.
    3. **First-run Wizard**: Uses `Sheet` dialog (`OnboardingModal`), popping up on cold start and saving state to `ctx.store` (`onboarding.completed`). Can be reopened anytime via `showGuide` prop or from "Settings -> About".
- **`RecommendAllScreen({ sourceId, name })`** — the full single-source recommendation grid (waterfall). Lays out the source's recommendation entries as a responsive card grid with pagination at the bottom.

**`bound(ctx, Screen)`** — binds to **this plugin's** context, not the shell's (the shell renders views with the context from `app.ready(['ui'])`; reading `ctx.sources` on it throws `cannot get property … without inject`); it must call `h(Screen, …)` rather than `Screen(…)` — invoking the function directly would splice the child component's hooks into the parent's hook list.

## Tests (`src/screens.test.tsx`)

jsdom + Testing Library, **rendering against a real `ctx.sources` rather than a mock** — what is worth pinning is the interaction semantics (what shows after pasting but before submitting, what a bad document leaves behind for the user). Harness: real `FsNode`/`DbNode(':memory:')`/`sourcesPlugin`, then a scoped context derived from **the package's own `inject`** (so the two cannot drift). 25 cases:

1. **Import (4)** — preview happens before any write (`sources` still 0), empty input is disabled, a successful import reports "1 added", a bad paste **keeps the input + reports all issues at once**;
2. **Test (3)** — test sections appear exactly when the provider's capabilities/methods exist, the selector defaults to the first source, an unrun trace shows "No trace yet";
3. **Search (6)** — before searching only the search bar and source switches exist (no empty-result screen), one independent section per source (title, "1 track", track titles), a failing source reports its error while the others render normally, toggled-off sources are never asked, single-track/artist filters pass through, external-parameter wake-up linkage;
4. **SourcesList (3)** — source toggles and their response, the delete-confirmation dialog guard, local source folder management;
5. **RecommendScreen (7)** — single-source recommendation feed renders, invalid-resource placeholder defense, empty state without recommendations, cold-start onboarding hero rendering and button targets, onboarding modal step switching and dismissal, recently-played album shelf renders on top, favorites-picks album shelf renders on top;
6. **RecommendShelfRow (1)** — bent-ends curved cards, flat restoration at the boundary cards, hover arrow interaction linked to scrolling;
7. **RecommendAllScreen (1)** — full grid layout and load-more at the bottom.

## Related docs

- `docs/08-ui-architecture.md`: descriptors, twin shells, rendering rules
- `packages/feature/plugin-sources/README.md`: the headless side's hooks and view ids
- `packages/ui/plugin-sources-ui-mobile/README.md`: the twin half
