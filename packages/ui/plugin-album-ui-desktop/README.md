# @bbebee/plugin-album-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-album` (headless): the album page's layout and event wiring.

## Overview

Binds `album.view` to the desktop kit. All domain state comes from `@bbebee/plugin-album/hooks`; `ctx.sources` is accessed via `inject` (required for album reads), while `player` / `downloads` use `serviceOf` (optional — without them one control is missing rather than the whole screen erroring). This package depends on the headless `@bbebee/plugin-album` (hooks and route ids).

Migrated wholesale from `plugin-sources-ui-desktop` (route/view/`useAlbum` moved together); the library and search screens now only navigate to `ALBUM_VIEWS.album`.

## Source files

### `src/index.tsx`

**Registered view**: `album.view` → `AlbumScreen` (generator effect, fiber name `'album-ui-desktop'`).

**`AlbumScreen({ urn })`** — `useAlbum` → three-state branch (`Pending` / "Album unavailable" + reason / content):

- **header (scrolls away with the list)**: a horizontal 232px `Artwork` (through `CachedArtwork` on `ctx.cache`; paints the fallback first on a miss, never hands the remote URL to a second request) + title + artist + "Play album". The hero and the action bar live in the `List`'s `header` slot and scroll away with the content; when the play button nears the top, the `StickyDetailBar` sticky bar (title + play button) slides in from above the viewport and docks (zoom action) once scrolled past half its height; the table header is fixed right below the sticky bar via the `stickyHeader` slot, with no sort arrow by default (shown on hover). The gradient covers only the header area (`headerGradient`, transitioning exactly into a solid colour at its bottom edge, scrolling away with the content); the content below and the docked table header are both solid `--bg-primary`; the header tint comes from the cover's `dominantColor` (`useImageColor`, extracted from the canvas when missing, falling back to a neutral gradient on failure);
- **action bar and multi-key sorting**:
  - green primary play button (`▶`), shuffle, heart favorite button (`♥`/`♡` wired to `library.setSaved`, reflected in the music library once saved) and `⋯` more actions;
  - the album three-dots menu offers "Add to folder" (formerly Add to collection), "Add to music library/Remove from music library", "Add to play queue", "Download" (hidden automatically for local albums) and "Sleep timer"; the originally redundant "Add to playlist" and "Go to album" were removed;
  - the right side has a sort dropdown (e.g. `Default order ≣` / `Title ≣`); clicking opens a `ContextMenu` supporting quick switching among default order, title, duration and play count, plus ascending/descending toggling.
- **track list and header interactions**:
  - header columns (`#`, `Title`, play count, `🕒 Duration`) support click-to-sort; clicking again toggles ascending/descending, with the current sort column highlighted and an arrow indicator (`▲`/`▼`).
  - track `List`: `showArtwork: false`, `estimatedItemSize: tokens.size.row`; an empty album shows "This album has no tracks"; local album rows do not show a download button;
  - in-row `TrackLibraryActionButton`: shows `+` when not favorited; clicking **dual-writes** both stores (`sources.setLoved` first, then `library.setSaved`); shows `♥` when favorited; clicking again opens the "Add to playlist" popover. In-library state is derived from the live saved set + re-reading loved on `library/changed` — `track.loved` in the album data is only a load-time snapshot; on `library/changed` (kind `track`) the page re-reads the catalogue by event URN and the row returns to `+` after unfavouriting;
- **playback semantics** (the reason this screen exists):
  - "Play album" → `player.playNow(all sorted tracks)` — the explicit "play this album from the top" gesture, replacing the queue outright; `disabled: no tracks`, disabled rather than hidden.
  - Tapping a track → `player.playFromContext(track, all sorted tracks, { context: { kind: 'album', urn, label } })` — the playback context matches the page's current sort exactly.
  - **Playback never navigates**: the transport bar announces what is playing; the user stays put.
- **download**: for non-local albums `onDownload` → `ctx.downloads.enqueue([urn])`; local albums (`BBeBee:local:`) hide the download button and menu item automatically; builds without `ctx.downloads` do not draw the button.

**`bound(ctx, Screen)`** — binds to this plugin's context (the shell renders views with the context from `app.ready(['ui'])`; reading `ctx.sources` there throws `cannot get property … without inject`); uses `h(Screen, …)` rather than a function call, otherwise child component hooks get spliced into the parent's hook list.

## Tests (`src/screens.test.tsx`)

jsdom + Testing Library; `withListLayout` gives the virtual list a height. The harness registers sources/player/downloads/ui stubs and derives a scoped context from `inject`. Cases cover:

1. draws the album + "Play album" → `playNow([A, B])` (verbatim; the hero and the sticky bar each have a Play album, take the first);
2. tapping "Jóga" → `playFromContext(B, [A, B], { kind: 'album', urn, label: 'Homogenic' })`;
3. download button → `downloads.enqueue([A])` and **does not touch playback**;
4. missing album → "Album unavailable" + "no album", not an empty page;
5. clicking header columns toggles sorting, verifying that `playFromContext` receives the reversed/sorted URN list on track taps;
6. the action bar's sort dropdown switches the sort key, verifying the sorted play queue context;
7. the album-level heart button toggles `isSaved` (the `♥`/`♡` icon flips with state);
8. in-row `TrackLibraryActionButton`: clicking `+` saves to Favorites and immediately turns `♥`; clicking again opens the "Add to playlist" popover;
9. local albums hide every download entry point;
10. the three-dots menu item set and the "Add to music library" action;
11. the album table header exists and supports sort toggling.

## Related docs

- `packages/feature/plugin-album/README.md`: the headless side and route ids
- `packages/ui/plugin-album-ui-mobile/README.md`: the twin half
- `packages/ui/plugin-sources-ui-desktop/README.md`: library/search screens (navigation entry)
