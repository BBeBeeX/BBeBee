# @bbebee/plugin-library-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-library` (headless): the twin half of the desktop version.

## Overview

The same hooks and behaviour, only the elements and shapes differ. `inject = ['ui', 'library', 'player']`; `sources`/`downloads` optional via `serviceOf`.

## Registered views

`library.home` / `library.playlist` / `library.collection` / `library.favorites` (generator effect `'library-ui-mobile'`).

- **`LibraryScreen`** — the library home. The Playlists / Albums / Collections sections share **one FlashList** (a phone scrolls one surface at a time; nested scrollers are the old road where both break), rendering section headers and rows in one flat union; playlist/collection rows support long-press and a `⋯` menu, album rows open `album.view`.
- **`PlaylistDetailScreen`** — isomorphic with the desktop; smart playlists have no remove key.
- **`CollectionScreen`** — collection members: album/playlist rows open their own pages; the top Play button plays the collection's tracks.
- **`FavoritesScreen`** — favorited tracks.

## Tests

`screen.test.tsx` (DOM host components): library home render/create/delete and navigation, playlist detail, favorites unsaving, collection mixed members and navigation.
