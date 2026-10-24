# @bbebee/plugin-album

Layer 4 (feature) — **the album page**: route/view descriptors and the `useAlbum` read, split out of `plugin-sources`.

## Overview

A **surface plugin**, deliberately thin:

- It owns the album route (`/album/:urn`) and view id (`album.view`);
- It **declares no service key** — an album has no state of its own: the details are a read, and playing is `ctx.player`'s business;
- Catalogue reads still go through `ctx.sources.getAlbum`: reads stay next to writes (MD-3, docs/11 §1.3), and `plugin-sources` remains the only service holding the catalogue.

The benefit of the split: `plugin-sources` no longer carries a screen, and album-specific work (cross-source links, completion, album editing) now has a home that does not belong to the source registry.

> `placement: []` rather than omitted: the desktop shell treats a route with a **missing** placement as `sidebar` by default (`r.placement?.includes('sidebar') ?? true`), so omitting it would add a lonely "Album" entry to the sidebar. The empty array is what means "reachable only via navigation" (docs/08 §3).

## Source files

### `src/index.ts`

`apply(ctx)`:

1. `ctx.logger.info('plugin-album: loaded')`;
2. `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: 'album.view', path: '/album/:urn', title: 'Album', placement: [], order: 0 }) }, 'album-ui-contributions'))`.

A build without `ui` does not get stuck: the nested inject is a **child fiber** — being inactive just means no contribution; when the parent plugin unloads, the child fiber unloads with it (the returned disposer calls `fiber.dispose()`).

### `src/hooks.ts`

| Hook | Description |
|---|---|
| `useAlbum(ctx, urn?)` | `AsyncState<AlbumDetail>`; both `undefined` data and a failed read land in `error` (the screen says the same sentence to both: "this album cannot be shown"); with an empty `urn`, `idle`. |

### `src/views.ts`

```ts
ALBUM_VIEWS = { album: 'album.view' }
ALBUM_ROUTES = ALBUM_VIEWS   // same values
```

## Tests

- `src/index.test.ts` (4) — registers the route descriptor (asserted verbatim), loads fine without `ui`, and two unload snapshots (with/without ui) show no leaks.
- `src/hooks.test.tsx` (3) — reads an album, a missing album lands in error rather than an empty success, and `idle` with no urn.

## Exports

```ts
// '.'
export const name = 'plugin-album'
export function apply(ctx)
// './hooks': useAlbum
// './views': ALBUM_VIEWS / ALBUM_ROUTES
```

## Related docs

- `docs/08-ui-architecture.md` §2–§3: descriptors, the two shells, placement
- `packages/feature/plugin-sources/README.md`: `getAlbum/listAlbums` still live there
- View halves: `packages/ui/plugin-album-ui-desktop/`, `packages/ui/plugin-album-ui-mobile/`
