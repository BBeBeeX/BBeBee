# @bbebee/plugin-library-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-library` (headless): the unified music library home, local music, playlist detail, collection detail, and favorites.

## Overview

Layout, gestures and event wiring; every derived value comes from `@bbebee/plugin-library/hooks` and `@BBeBee/ui-menus`. `inject = ['ui', 'library', 'player', 'sources']`; `downloads` and friends are read optionally via `serviceOf` (the matching control is not drawn without them).

## Registered views

| id | Component | Description |
|---|---|---|
| `library.home` | `LibraryScreen` | Unified music library home: a single mixed stream (Favorites, Local music, playlists, saved albums, collection folders) |
| `library.local` | `LocalMusicScreen` | Local music detail: the locally scanned track list, one-click Play all, jump to scan settings |
| `library.playlist` | `PlaylistDetailScreen` | Playlist tracks; smart playlists are read-only and draw no delete key |
| `library.collection` | `CollectionScreen` | Collection members: track rows are playable (TrackRow + context menu), album/playlist rows open their own pages |
| `library.favorites` | `FavoritesScreen` | Favorited tracks |

## Core interaction design

### LibraryScreen (unified music library home)

1. **Saved-album filtering**: only albums the user actually saved to the music library are fetched via `useSaved(ctx, 'album')`, rather than showing every album in the remote catalogue.
2. **Single-stream presentation**: playlists, saved albums, collection folders, plus the special "Favorites" and "Local music" entries, are shown in one list stream (`UnifiedItem`) instead of separate blocks.
3. **First-track artwork**: when a playlist or collection has no dedicated cover, the first track's (or first album's) cover is extracted asynchronously and shown automatically.
4. **Row hover and cover-to-play**:
   - hovering a row highlights the background and surfaces a `⋯` action menu at the row's end;
   - hovering the cover shows a dark overlay with a white play arrow `▶`; clicking the cover plays all of its content, clicking elsewhere on the row opens the target page;
   - the redundant `Open` text button at the row's end was removed entirely.
5. **Top filter pills**: `Playlists` / `Albums` / `Folders` / `Downloaded` buttons; clicking one filters exclusively, clicking the active one again clears the filter.
6. **Search and sort toolbar**:
   - clicking the magnifier expands a search box that filters the current entries live;
   - the sort dropdown supports `Recently played`, `Recently added`, `Alphabetical`.
7. **Pin/unpin**: the context menu supports `Pin playlist` / `Unpin playlist`; pinned items always sort to the top of the list.

### PlaylistDetailScreen (playlist detail page)

1. **Header click sorting**: header columns (`# Custom order`, `Title`, `Album`, `Date added`, `🕒 Duration`, `✔` removed) support click-to-toggle sorting with ascending/descending and direction indicators (`▲`/`▼`).
2. **Action bar sort menu**: the action bar provides a "Custom order ≣" dropdown (`ContextMenu`) supporting custom order, title, artist, album, date added, duration, plus ascending/descending toggling.
3. **Decoupled data-item binding**: internal data is uniformly wrapped as `{ item, track, trackUrn, originalIndex }`; no matter the sort, the context menu and track-removal actions stay strictly bound to the original `PlaylistItem.id`.
4. **Unified row library interaction (TrackLibraryActionButton)**: hovering a row shows a `🖤` icon; clicking opens the "Add to playlist" submenu directly (supports creating a new playlist and quick add to an existing one).
5. **Adaptive play queue**: when tapping a track or the green primary play button, the playback context queue aligns in real time with the current sort and filter result.
6. **Scroll-fade header and cover theme colour**: the hero and action bar scroll away with the list; when the play button nears the top, the `StickyDetailBar` sticky bar slides in from above the viewport and the button is docked into the sticky bar once scrolled past half its height (zoom action); the table header is fixed right below the sticky bar via the `stickyHeader` slot, shows no sort arrow by default and reveals column dividers and arrows on hover; the gradient covers only the header area (`headerGradient`, scrolls away with the content, transitions exactly into a solid colour at its bottom edge), and the content below and the docked header are both solid `--bg-primary`; the header tint comes from the cover's `dominantColor` (neutral gradient fallback without a cover).

### LocalMusicScreen (local music page)

1. **Breaking the 100-track limit (full paginated loading)**: `fetchAllLocalTracks` and `fetchAllLocalAlbums` walk all data page by page (batches of `limit: 500`), showing every locally scanned song and album, no longer truncated at the first-screen 100 rows.
2. **Songs/albums dual view toggle**: the top action bar provides a "Songs" / "Albums" dual-mode capsule, switching between the local song list and the local album grid.
3. **Tracks view (Tracks Table)**:
   - header columns (`#`, `Title`, `Album`, `🕒 Duration`, `✔` removed) support click sorting and order reversal;
   - row hover interaction (`TrackLibraryActionButton`): no icon by default, shown when the current row is hovered; if the song is not in the music library, a `+` is shown — clicking quickly adds it to "Favorites" (`sources.setLoved` first, then `library.setSaved`, dual-write); if already saved, a `🖤` is shown — clicking opens the "Add to playlist" submenu. In-library state comes from the live saved set (the row returns to `+` after unsaving), not a mount-time snapshot;
   - the action bar dropdown supports sorting by default order, title, artist, album, duration, plus ascending/descending toggling;
   - "Play all" (`player.playNow`) and "⚙ Scan settings" (jump to `scanner.settings`) buttons.
4. **Albums view (Albums Grid)**:
   - locally scanned tracks are grouped automatically by album name; the first track with artwork becomes the album cover;
   - `LocalAlbumCard` renders album cards showing cover, album name, artist, track count;
   - hovering a card shows a floating green play button (`▶`); clicking sends the whole local album into the play queue; clicking the card body navigates to the album detail page (`album.view`);
   - the action bar sort menu switches dynamically to album dimensions: default order, album name, artist, year, track count, plus ascending/descending toggling.
5. **Scroll-fade header**: identical in both songs and albums modes — the hero and action bar scroll away with the content, and the sticky bar (title + play button) fades in to take over; albums mode has no virtual list; the page's own scroll container achieves the same structure.
6. **Drag-and-drop import with highlight coupling**:
   - receives the desktop drag-and-drop import params (`highlightUrn` / `highlightUrns`);
   - when triggered, automatically ensures the view is in "Songs" mode;
   - under default order, newly imported songs are placed at the very top of the list and the scroll container scrolls back to the top (`scrollTop = 0`);
   - the imported rows get a dedicated highlight style (blue left border `3px solid var(--accent-primary, #5F87FF)` and translucent background `rgba(95, 135, 255, 0.18)`); the visual indicator fades out softly after 8 seconds, keeping the list's sort position stable.
7. **Reactive data flow**: listens to `library/changed` and `scan/finished`; external scans, imports, and track changes automatically trigger a data reload and view update.

### CollectionScreen (collection/folder detail page)

1. **Track row interaction refactor**: abstracted into a standalone `CollectionTrackTableRow`, with the header `✔` removed;
2. **In-row actions**: hovering a track row surfaces the `TrackLibraryActionButton` (clicking `🖤` opens the add-to-playlist menu) and a `⋯` action menu; clicking the row starts playback directly.

### FavoritesScreen (Liked songs page)

Styling closely mirrors `LocalMusicScreen`:
1. **Dark gradient hero header**: the immersive "Liked songs" purple theme (fixed `#450af5`, generating the header gradient via `headerGradient`, with solid colour beneath), a large title, the "Playlist" category above, and a subtitle showing the saved-songs count.
2. **Action bar and live interactions**:
   - a 56px green round primary play button (`▶`) and shuffle (`🔀`);
   - a live search filter box (`🔍` search in Liked songs);
   - a sort dropdown (`ContextMenu`) supporting default order, title, artist, album, duration, plus ascending/descending toggling.
3. **Multi-key sortable header**: `#`, `Title`, `Album`, `🕒 Duration` (`✔` removed) support click sorting with ascending/descending arrow hints.
4. **Table row component (FavoriteTrackTableRow)**:
   - index and hover play key, 40px cover thumbnail, title and artist, parent album;
   - hovering the row surfaces the `TrackLibraryActionButton` (showing `🖤`; clicking opens the "Add to playlist" submenu);
   - hovering surfaces a `⋯` action menu (right-click or click both trigger the unified context menu);
   - song duration display.
5. **Adaptive play queue**: when tapping a track or Play all, the current sorted/filtered track URN list is automatically used as the playback queue context.
6. **Scroll-fade header**: the hero and action bar scroll away with the list; the sticky bar (title + play button) slides in as the play button nears the top and docks once scrolled past half its height (zoom action), tinted the fixed like-purple.

## Tests

`screens.test.tsx` (jsdom + `withListLayout`, all 32 cases pass):
- library home create/delete/open on row click;
- unified single-stream rendering (Favorites, Local music, playlists, saved albums, collections) with the matching route jumps;
- top filter pill toggling and restore;
- search input filtering;
- cover-overlay play arrow plays directly;
- context menu pin/unpin;
- playlist track playback and removal by item id;
- playlist header click sorting, menu ascending/descending switching, and sorted queue assertions;
- favorites page unfavorite via the heart button;
- favorites page hero header, action bar, sortable header and large play button tests;
- favorites page sticky bar (sticky positioning + play button fading in with scroll) tests;
- favorites page header sort toggling and sorted queue assertions;
- collection multi-kind member rendering and opening;
- local music page rendering and Play all;
- local music tracks-view sorting with descending queue assertions;
- local music albums-view switching, grid card rendering, and sort-by-album-name assertions.
