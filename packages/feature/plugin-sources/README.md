# @bbebee/plugin-sources

Layer 4 (feature) — `ctx.sources`: imported source documents, the provider registry, the catalog cache, and the unified catalog read surface.

## Overview

`MediaProvider` is an **internal interface with exactly two implementations** (the per-source adapter in `plugin-source-runtime` and `plugin-source-local`), not an extension point — people outside the repository write source documents, not providers. Data flow: **runtime/local call `register()` to provide answers; this package stores the answers** (docs/06 §1).

It owns both "source management" (import/enable/remove source documents) and "the catalog" (caching remote data, FTS search, cross-source links), synthesizing the two into the single entry through which a shell reads the catalog.

## Service declaration

- `class Sources extends Service implements SourcesService` → `ctx.sources`.
- Required injections: `['db']`; optional (nested `ctx.inject`): `['ui']` (contributes route/settings descriptors).
- Capabilities: `db:read:core`, `db:write:core`. **This package never calls `ctx.db.defineSchema`** — every table it writes is declared by the kernel's core migrations (v1 creates the tables, v2 adds FTS5, v3 is ADR-5's `providers`→`sources` migration).

## Source files

### `src/index.ts` — SourcesService (1091 lines, the largest file)

| Member | Purpose |
|---|---|
| `import(input)` | Import/update a source document: `parseSourceInput` parses → `validateDocument` validates → dedupe by `sourceUrl` (same id = update). Emits `source/imported` (**once per batch**; emitting added+changed separately once made the runtime stop/start twice). |
| `remove(id, { forgetCatalogue? })` | See the two modes in `store.ts`. Emits `source/removed`. |
| `setEnabled(id, on)` | Enable/disable. Emits `source/changed`. |
| `register(provider) / unregister` | The provider registry. Emits `source/registered` / `source/unregistered` (the disposer does an identity check — preventing an old disposer from tearing down a newer registration). |
| `providers / forUrn(urn)` | Live provider list / find a provider by URN. |
| `searchAll(q, opts)` | Cross-source fan-out: every source asked (including failures and timeouts) gets its own entry, never merged, never failing as a whole — "three answered, one rate-limited, one needs re-import" must be sayable. |
| `searchSource(sourceId, q, page?, opts?)` | Single-source paginated search: queries only the specified source and supports `page` pagination, with results written into the catalog cache. Serves the per-panel search view's single-source "load more" next page. |
| `searchLocal(text, opts)` | FTS5 within the catalog, instant offline; answers a different question than `searchAll`. |
| `cache(providers, results)` | Writes provider search/browse results into the catalog tables (via the `CacheWriter` holder, delegating to `cache.ts` — see below), then emits `library/changed(kind, urns)` — only for the URNs actually written. |
| `getAlbum / getArtist / getTracks / tracksOf…` | Catalog hydration (credits, artwork, pagination). |
| `readVars / writeVar / clearVars` | The read/write gate for `source_vars` — the runtime loads variables before registration, otherwise `auth.status` misreports anonymous on the first frame. |
| `debug(sourceId, step)` | Delegates to the corresponding provider's `debug()` — the rule tracer. |
| `check(sourceId)` | Liveness check, emits `source/checked`. |

Every emit on a post-commit path is wrapped in `safeEmit`: a listener throwing only warns, and an already-awaited report is never lost.

### `src/catalog.ts` — the catalog read surface

The `Catalog` class + `ftsQuery`: FTS5 query construction (`SEARCHABLE_KINDS`), paginated catalog reads (tracks/albums/artists, joining `track_stats` for "most played" ordering), `index(urns)` writing tracks into `tracks_fts` (bridged urn↔rowid via `tracks_fts_map`; deleting the map first would permanently strand index rows). Listens to `library/changed` (the init return value; `index(urns)` when `kind === 'track'`) — both the scanner and the runtime cache paths trigger it.

### `src/cache.ts` — cache writes

`cacheEntities`: upserts the plain data returned by providers into `tracks`/`albums`/`artists`/`track_artists`/`artworks`/`external_ids`. **Payloads are stored in `tracks.raw_json`/`albums.raw_json`** — this is why `ruleStream` can work hours later, even offline from the original search (it does not re-run the search; it reads the originally stored raw payload). `MAX_PAYLOAD_BYTES` caps a single payload.

`CacheWriter`: a **plain holder** for the db handle captured at init (same idea as `Catalog` and `SourceStore`); `Sources.cache()` writes/links through it. ⚠️ Using `Sources.ownDb` directly would not work: `searchAll` arrives through the UI package's service proxy, so the method executes in the **caller's context** (no db grant) and the captured handle would be re-shadowed to the caller — writes rejected, `cache()` catches and only warns, and the result is search results with a permanently empty catalog, the queue falling back to showing URNs, and a player bar with no artwork.

### `src/identity.ts` — source document identity, validation, and import

- **`sourceIdFor(sourceUrl)`**: `hostSlug(sourceUrl) + "-" + sha256Hex(sourceUrl)[0..8]`. **Derived, not random** — re-importing the same document produces the same id, so re-import is an *update*, and the URNs/cache rows/cookie jar/playlist references all survive. 8 hex (32 bit) distinguishes same-host different-path; `:` never appears in an id (otherwise the entire URN namespace becomes unparseable).
- **`validateDocument(value)`**: collects **all** problems (not one at a time) and throws `SourceFormatError`. Key points: `sourceUrl` must be absolute http/https and must not embed credentials; every rule field must be a string (the most common author mistake is `header` written as an object); `ruleStream` is the only required block and `ruleStream.url` is mandatory; unknown fields inside a rule block are rejected (a typo let through would surface as "the backend changed"); unknown top-level fields are kept (forward compatibility); `allowedHosts` entries carrying a path/port are rejected (the allowlist is per-host).
- **`parseSourceInput(input)`**: tolerates markdown code fences, a single object or an array; `ParsedEntry.text` keeps the original input slice.
- **Export and diff**: `APP_MAINTAINED = ['lastUpdated','respondTime','weight']` is stripped on export (sharing should not leak your network speed); `isShareable` excludes `bbebee://` migration placeholder rows; `changedFields` compares by canonical value (key reordering is not a change; `Object.create(null)` guards the `__proto__` trap).
- **`recordFor(doc)`**: document → `sources` row; an existing row's `enabled` takes precedence over the document's.
- **`allowedHostsFor(doc)`**: the host of `sourceUrl` + `allowedHosts`, sorted and deduped.

### `src/links.ts` — track_links: cross-source identity

The same song on Navidrome/Jellyfin/local disk is **three rows with three URNs**, associated by `track_links` — never merged into one row (bitrate and availability differ).

- **`MERGE_CONFIDENCE = 1`**: anything below is a **hint** (a failover candidate, "also available on…"), never used to silently merge catalog entries — a live version/a remaster shares title, artist, and duration.
- **`writeExternalIds`**: stores provider-reported identifiers; normalization (ISRC strips `-` and uppercases, UPC keeps digits only) + shape validation (ISRC `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`, mbid must be a UUID, all-zero placeholders rejected — real backends produce garbage like `isrc:"???"`).
- **`linkTracks(urns)`**: after a cache write it runs **only on the just-written URNs** (re-matching the whole library is quadratic); one JOIN per namespace (via `idx_external_lookup`); `EXACT = [{isrc}, {mbid}]` hits set confidence to 1.00.
- **`upsertLink`**: `MIN/MAX` ordering uses **SQLite's BINARY collation** — JS `<` compares UTF-16 while SQLite compares UTF-8 bytes; above the BMP they disagree, which once caused the CHECK constraint to reject inserts and lose an entire batch of `library/changed`. The `manual` method is never downgraded by automation.
- `linksFor` (bidirectional UNION), `linkManually`, `unlink`.

### `src/store.ts` — `SourceStore`: sources table persistence

- `all()` — returns sorted; a row whose `doc_json` fails to parse is dropped from the list without taking the list down.
- `put(record)` — upsert; **`enabled` is deliberately not in the UPDATE list**: "enabled is the user's switch, not the document's" — an author publishing an update must not re-enable a source the user turned off.
- `remove(id, { forgetCatalogue })` — `true`: deletes the row in one transaction, with the FK cascade taking tracks/albums/… along, but **tables that reference by value must be cleared manually** (`tracks_fts` → `tracks_fts_map` → `lyrics` → `library_items` → `track_links` → `external_ids`; the wrong order strands FTS rows and mis-links the next source's tracks); `false` (default): only `UPDATE … SET enabled = 0` — an accidental tap must not lose the whole library, and re-importing will not re-enable it either.
- `recordCheck(id, { ok, respondTimeMs?, message? })` — `fail_count` resets on success, +1 on failure (three consecutive RuleErrors mark it stale, docs/06 §7).

### `src/hooks.ts` — React hooks (shared by both shells)

| Hook | Description |
|---|---|
| `useTracks / useAlbums(ctx, query?)` | Paginated catalog reads (`PagedState`); internally uses a **generation counter** to prevent two in-flight page responses from appending duplicate pages during fast scrolling; listens to `library/changed` to trigger a reload |
| `useSources(ctx)` / `useLiveSourceIds(ctx)` | Imported sources / imported+enabled but not yet registered (the "starting…" state) — deliberately kept apart |
| `useSourceImport(ctx)` | The import screen; **input is the preview** (parsing is a local pure computation); rejected documents go into issues rather than throwing (otherwise a bad document "looks like the button does nothing") |
| `useSourceTrace(ctx, sourceId?)` | The step tracer; events are **appended as they arrive** (the diagnosis for an unresponsive server is "one http line followed by nothing"); a generation ref keeps old and new traces from interleaving |
| `useSetLoved(ctx)` | The favorite toggle; writes `catalog.setLoved`, then emits `library/changed`. |
| `useSearchSourceSelection(ctx)` | The search screen's source switches: `options` (`searchable` comes from the provider's derived capabilities) + `selectedIds` + `toggle`/`toggleAll`. **Stored as an exclusion set** — a source imported later joins the next search by default instead of being silently missed. |
| `useSourceSearch(ctx)` | `searchAll` in on-screen form: `status/text/data/run/reset`; internally maintains per-source pagination state (`pagination[sourceId]`: `loading/hasMore/cursor/error`) and exposes `loadMore(sourceId)`, fetching the next page for that source and seamlessly appending merged songs/albums; a generation ref guarantees a later search is not overwritten by an earlier one. |
| `searchResultRows(result, nameOf)` | Flattens an `AggregatedSearch` into rows for a single virtual list (header/track/album/artist/playlist) — each source's failure/timeout/empty result keeps its own header; track rows carry their segment of the queue, click to play. Shared by both shells, eliminating each shell drawing its own sections. |
| `listAllTracks(ctx, query)` / `playFromList(ctx, urn, list)` | Non-hook shared playback logic: the former pages the query **to the end** ("play this list" means the whole list, not the pages scrolled in so far); the latter resolves the list the clicked row belongs to (`urns` in hand or freshly fetched from `query`) and hands it to `player.playFromContext` — if the queue already has the track it jumps there, otherwise the whole list is swapped into the queue; a catalog read failure still plays the single track |

### `src/capabilities.ts` — provider capability decisions

`canSearchProvider(provider)`: the `search` method exists and at least one search type in the derived capabilities is true. The service and the search screen share this single decision — if the two drift, the switches drawn on screen would include sources `searchAll` silently skips, and "never asked" looks exactly like "no results".

### `src/views.ts` — descriptor id constants

```ts
SOURCES_VIEWS = { search: 'sources.search', sourceList: 'sources.settings',
                  sourceImport: 'sources.import', sourceTest: 'sources.test' }
SOURCES_ROUTES = { search, sourceImport, sourceTest }   // same values
```

Init contributes 4 descriptors: route `/search` (tab-bar + sidebar, order 1), settings (section `'sources'`, "Music sources"), route `/sources/import`, route `/sources/test`. The Test screen gives each capability of a source its own test area, all flowing into the same trace (docs/06 §10).

> The original `sources.library` (All/Local/Favorites library browsing) has been removed: the library home is handled by `plugin-library`'s `library.home`, which shows playlists, albums, and collections together (collections act as folders whose members can be an album/playlist/track).

> The album page has been split out into `plugin-album` (`album.view`): the route/view and `useAlbum` moved with the screen, while the catalog reads `getAlbum / listAlbums` stay in this package — reads stay next to writes (MD-3). The library and search screens take the route id from `@bbebee/plugin-album/views` when navigating.

## Events

| Direction | Events |
|---|---|
| Emits | `source/registered`, `source/unregistered`, `source/imported(sourceIds[])`, `source/changed(id, changedFields)`, `source/removed(id, forgotCatalogue)`, `source/checked(id, report)`, `library/changed(kind, urns)` |
| Listens | `library/changed` → `catalog.index(urns)` (when kind is track) |

## Database (declared by core migrations, read/written by this package)

`sources` (`doc_json` stores the verbatim original, `doc_hash`, `enabled`, `allowed_hosts_json`, `fail_count`…), `source_vars`, `tracks` (`raw_json` carries the payload), `albums`, `artists`, `track_artists`, `album_artists`, `artworks`, `external_ids`, `track_links` (`CHECK (urn_a < urn_b)`, BINARY collation), `tracks_fts` (FTS5, `contentless_delete=1`, `unicode61 remove_diacritics 2`) + `tracks_fts_map`. Conventions follow docs/07: timestamps in epoch-ms, booleans as 0/1, JSON columns with the `_json` suffix, foreign keys as URN TEXT, catalog tables `REFERENCES sources(id) ON DELETE CASCADE`.

## Exports

```ts
// '.'
export class Sources extends Service            // ctx.sources
export interface SourcesConfig { searchTimeoutMs?: number }
export const name = 'plugin-sources'
export function apply(ctx, config?)
export { Catalog, ftsQuery, SEARCHABLE_KINDS }
export { CacheWriter, cacheEntities, MAX_PAYLOAD_BYTES }
export { MERGE_CONFIDENCE, linkManually, linkTracks, linksFor, unlink, writeExternalIds }
export { SourceStore }
export { allowedHostsFor, changedFields, exportableDocument, parseSourceInput, sourceIdFor, validateDocument }
// './hooks': useTracks / useAlbums / useSources / useLiveSourceIds / useSourceImport /
//              useSourceTrace / useSetLoved / useSearchSourceSelection / useSourceSearch /
//              searchResultRows / listAllTracks / playFromList
// './views': SOURCES_VIEWS / SOURCES_ROUTES
```

## Related docs

- `docs/06-music-sources.md` §1–§3/§7: the SPI, identity, trust, staleness
- `docs/07-data-model.md`: the URN and every table
- Neighbors: `plugin-source-runtime/` (the maker of providers), `plugin-source-local/`, `plugin-local-scanner/`
