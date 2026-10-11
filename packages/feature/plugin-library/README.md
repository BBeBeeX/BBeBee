# @BBeBee/plugin-library

Layer 4 (feature) — `ctx.library`: the user's **curation** (playlists, favorites, collections), and now the **library home**.

## Overview

- **Read surface**: `sources.library` has been removed; the library home is handled by this plugin's `library.home`, showing playlists, albums (read via `ctx.sources`), and collections together.
- **Collections are folders**: members can be any URN — **album, playlist, track** (and artist); they can nest (`parent_id`). Playlists/albums enter a collection by **self-reference**, so the songs inside reach the library "indirectly"; no catalog rows are duplicated.
- **Playlists are a queue-style ordered song table**: they can carry smart rules and can come from remote sources; the detail page supports per-song deletion.
- Catalog reads stay in `ctx.sources`; this plugin only writes `playlists` / `playlist_items` / `library_items` / `collections` / `collection_items` (docs/07 §4.6).

## Views and routes

```ts
LIBRARY_VIEWS = {
  home: 'library.home',            // /library       sidebar + tab-bar, order 0
  playlist: 'library.playlist',    // /playlist/:urn no placement
  collection: 'library.collection',// /collection/:id no placement
  favorites: 'library.favorites',  // /favorites     sidebar, order 1
  local: 'library.local',          // /local-music   no placement
}
```

## Source files

| File | Contents |
|---|---|
| `src/index.ts` | The `Library` service: favorites (`library_items`, idempotent save/pin), playlists (create/rename/delete/add-remove-move tracks/smart rules, `track_count`/`duration_ms` recomputed in the same transaction as tracks), collections (nesting, member add/remove); emits `library/changed` and `library/collections-changed`; contributes 5 routes |
| `src/playlists.ts` | `playlists` + `playlist_items`; `between()` fractional-index row moves, `recount` in the same transaction, smart trees compiled into parameterized SQL (`smart.ts`) |
| `src/smart.ts` | Rule tree → WHERE, field whitelist + values always bound (`inLast` only for date fields, etc.) |
| `src/saved.ts` | `library_items`: saving keeps the original `added_at`, pinned first |
| `src/collections.ts` | Folder semantics: any URN, `(collection_id, urn)` idempotent, sibling fractional index, FK cascading subtree delete |
| `src/hooks.ts` | Shared by both shells: `usePlaylists/usePlaylist/useSaved/useCollections/useToggleFavorite/useCollectionDetail` (members hydrated by kind: track→Track, album→title/artist, playlist→name/track count) |
| `src/views.ts` | The id constants above |

## Events and capabilities

- Emits: `library/changed(kind, urns)`, `library/collections-changed()`.
- Manifest: `db:read:core`, `db:write:core`; `contributes.services: ['library']`.
- For `@BBeBee/ui-menus`: the playlist menu's "Add to collection" adds the **playlist URN** as a member (not a snapshot); the track menu's "Add to collection" adds the track URN.

## Tests

`smart.test.ts` (compiler safety boundaries), `playlists.test.ts` (ordering/single-row moves/smart read-only/derived column consistency), `saved.test.ts`, `collections.test.ts` (nesting/idempotence/cascade), `index.test.ts` (lifecycle/leaks/events), `hooks.test.tsx`.

## Related docs

- `docs/07-data-model.md` §4.6: the five tables and smart rules
- `docs/08-ui-architecture.md` §2–§4: descriptors and hooks
- View twins: `packages/ui/plugin-library-ui-desktop/`, `packages/ui/plugin-library-ui-mobile/`
- Menu model: `packages/ui/ui-menus/`
