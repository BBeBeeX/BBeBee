# @BBeBee/plugin-local-scanner

Layer 4 (feature) — `ctx.scanner`: the scanner for the local filesystem.

## Overview

Walks the user-designated music directories, reads tag metadata, and writes files into the catalogue. Division of labor with `plugin-source-local` (docs/06 §8): **this package fills** (turns files on disk into catalogue entries), `plugin-source-local` answers (says what is in the catalogue and how to play it).

Three design goals, each backed by a test:

| Property | Meaning |
|---|---|
| **Incremental** | `(size, mtime)` against `scan_entries` decides whether a file is opened at all — rescanning an unchanged library costs only stat calls |
| **Interruptible** | One transaction per batch, `AbortSignal` cancellation, one checkpoint per batch — a suspension loses at most one batch |
| **Honest** | A file that cannot be decoded is recorded as an error entry with its reason, never silently skipped |

## Service declaration

- `class Scanner extends Service implements ScannerService`, `super(ctx, 'scanner')` → `ctx.scanner`.
- Required injections: `['fs', 'db', 'codec']`; optional (nested) injections: `['ui']` (the settings page descriptor), `['background']` (the polling fallback).
- Capabilities: `fs:read:media`, `fs:read:all`, `db:read:core`, `db:write:core`, `background`.

## Source files

### `src/index.ts` — ScannerService and the scan flow

**Config (`ScannerConfig`)**: `batchSize=200` (files per transaction), `extensions` (default 16: mp3/flac/m4a/aac/ogg/oga/opus/wav/aiff/aif/wma/alac/ape/wv/dsf/dff/m4b), `sourceId='local'`, `pollIntervalMinutes=1440` (1 day), `watchDebounceMs=2000`.

**Public API**:

| Member | Purpose |
|---|---|
| `roots` / `progress` | The list of scan roots (in-memory cache) / `{ rootId, done, total? }` |
| `addRoot(uri, opts?)` | Defaults to `recursive: true`; adding again = re-enable (upsert) |
| `removeRoot(id, opts?)` | With `forgetTracks: true`, runs `forgetFile` per entry and emits `library/changed` |
| `setEnabled(id, on)` | Enable/disable a root and rebuild the watcher |
| `scan(opts?)` | The main entry. Returns `ScanSummary` |
| `cancel()` | Aborts the internal controller |

**Scan flow**: `scan` is serialized with an `inFlight` promise (a watch event, a poll, and a manual scan can all arrive at once, and two concurrent walks would overwrite each other's abort controller) → the signal is bridged to an internal `AbortController` → per root: `scan/started` → BFS `walk` → read that root's `scan_entries` in one go → batched `importBatch` (one transaction per batch, progress updates, emit `scan/progress` and `library/changed`) → finish with `scan/finished`.

**BFS guards**: `MAX_SCAN_DEPTH=24`, `MAX_SCAN_DIRS=20_000`, `visited` dedup. `ctx.fs.list` follows directory symlinks, so `ln -s . loop` makes the queue never drain; the depth cap alone is not enough (two mutually-linked directories produce new paths exponentially), and the directory budget keeps the blow-up finite in both dimensions. An unreadable directory does not count as a failure but is counted in `unreadable` and sets `truncated`.

**Reconciliation (the most important invariant)**: **only a complete view may delete**. `complete = !aborted && !truncated`; "gone files" are deleted only when complete. A truncated walk is indistinguishable from "vanished from disk", and reconciling on a partial view would silently delete files that are still on disk — worse than the hang it replaced (a hang is at least visible). `summary.incomplete` is sticky across roots. When incomplete: **stale over wrong, always**.

**watch/poll three-tier fallback**: `ctx.fs.watch` (the desktop ideal path, debounced by `watchDebounceMs`) → `ctx.background.schedule('scanner:poll', …)` (mobile, the OS scheduler) → its own chained `setTimeout` polling (chained rather than an interval — a scan that overruns must not have the next one queued behind it; the required fallback on desktop until `core-background-tauri` lands).

**Relationship with `ctx.sources`**: the catalogue's foreign keys point at `sources` rows, so the scanner, as the writer, must first ensure the source row exists — `ensureSourceRow()` writes the minimal row (id defaults to `'local'`, `source_url = 'bbebee://local'`, and `doc_json` is a real document: `{ sourceName: 'This device', sourceComment: 'Files on this device. Managed by the scanner, not imported.' }`).

### `src/import.ts` — how a file becomes a catalogue entry

The walk decides which files to look at; this decides what they mean. All writes go through the caller's single transaction — "a suspension loses at most one batch, never half a track".

- **`importTrack(ctx, input)`**: title falls back to the file name → `artworks` (content-addressed id dedupes covers; ⚠️ `blurhash`/`dominant_color` stay NULL — `ctx.codec` decodes audio, not images, a declared degradation) → `albums` (`COALESCE(excluded.x, albums.x)`: missing new data does not clobber old values) → `tracks` upsert → `track_artists` delete-then-insert (role `'main'`, a junction table rather than free text — "Artist feat. Other" as free text would make featuring unbrowsable) → `genres`/`track_genres` (normalized lower-case) → `external_ids` (isrc/mbid: "M2 records cheaply now what identity linking will need to join on") → **`media_bindings`** (`origin: 'scan'` — this binding is the entire meaning of "this track is a file on disk"; the M3 download plugin writes same-shaped `origin: 'download'` rows, which is why the player never needs the concept of "downloaded").
- **`forgetFile(ctx, uri)`**: deletes the binding; if the track has no remaining bindings, deletes the track row too (for the local source, the file is the track).
- **`splitArtists(value)`**: splits multiple artists inlined in a tag. `/` only counts as a separator when it has whitespace on both sides (AC/DC is one band); `feat./ft./with` require surrounding whitespace.
- **`sortKey` is a re-export, not a local copy**: catalogue sort rules belong to `@BBeBee/protocol`, not to whichever writer got there first — the source cache once grew its own copy, which made "The Beatles" appear twice in a list.

### `src/ids.ts` — how stable ids are derived

Derived, not random: the same file must produce the same URN on every scan, otherwise one rescan orphans every playlist entry, queue row, and play record pointing at it.

- **`stableId(...parts)`**: parts joined with NUL (`\x00`), 64 bits = **two FNV-1a rounds over different salts** (zero dependencies, stable across platforms; explicitly not a security hash and never treated as one).
- **`trackId(uri)`** / **`albumId(title, artist)`** / **`artistId(name)`**: derived after `normalise` (trim + lower-case + whitespace collapse).
- **`artworkId(bytes)`**: content-addressed (two rounds over different salts + the byte count) — two files sharing a cover share one artwork row; a single 32-bit round collides at library scale, and a collision here silently gives one album another's cover.

> Note: this file contains literal control characters (`\x00`/`\x01` as join separators); some tools will classify it as binary.

### `src/hooks.ts` — React hooks (shared by both shells)

The core is progress: a scan emits events per batch, and a settings screen that only looks at the result would sit frozen for minutes on a large library, looking broken.

- **`useScanRoots(ctx)`** — subscribes to `scan/started|finished` and `library/changed`, returns `ctx.scanner.roots`.
- **`useScanState(ctx): ScanState`** — `{ progress?, running, lastSummary? }`; on `scan/finished` it **clears progress** — a progress bar frozen at 90% after the scan ended is worse than no progress bar.
- **`summarise(summary?)`** — summarizes into one sentence. ⚠️ **`incomplete` overrides every count; it is not their footnote**: rendering a truncated scan as "nothing changed" would tell the user the library is reconciled when the opposite is true.

### `src/views.ts` — view id constants

```ts
export const SCANNER_VIEWS = { settings: 'scanner.settings' } as const
```

Ids only; actual components are bound by each platform's UI package via `ctx.ui.registerView`. init registers the settings descriptor (section `'sources'`, title "Music folders") — the descriptor is not a component, so on a platform whose view package is not loaded the settings page can still list it and show "not available on this platform".

## Tables written

`sources` (ensured row), `scan_roots`, `scan_entries` (`status ∈ { ok, error }`, error carries a reason), `tracks`, `albums`, `artists`, `track_artists`, `album_artists`, `genres`, `track_genres`, `artworks`, `external_ids`, `media_bindings` — all upsert semantics, naturally idempotent.

## Exports

```ts
export const name = 'plugin-local-scanner'
export interface ScannerConfig
export async function apply(ctx, config?)   // deliberately awaits ctx.plugin(Scanner, config)
export { importTrack, forgetFile, splitArtists, sortKey } from './import.js'
export { trackId, albumId, artistId, artworkId } from './ids.js'
// './hooks': useScanRoots / useScanState / summarise
// './views': SCANNER_VIEWS
```

## Related docs

- `docs/06-music-sources.md` §8/§12: local sources and the scanner division of labor
- `docs/11-roadmap-M1.md`: the incremental-scan exit criterion
- `packages/feature/plugin-source-local/README.md`: the answering side
