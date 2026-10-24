# @bbebee/plugin-source-local

Layer 4 (feature) — local files as a `MediaProvider`: a fully equal citizen with zero privilege over other sources.

## Overview

The local library is **deliberately not favored**: it goes through exactly the same SPI, the same URN scheme, and the same resolve path as every other server. The only method that differs is `resolveStream` — it answers `kind: 'local'` immediately. This is also why the M3 download plugin can hook in "without the player ever knowing": a downloaded track and a local track are shaped identically, differing only in `media_bindings.origin`.

Its `auth` is the trivial `NoAuth` (`flow: 'none'`), four lines — which precisely proves that "requiring every provider to implement auth" costs nothing (docs/06 §1.1).

**Division of labor with `plugin-local-scanner`**: the scanner does the **filling** (turning files on disk into catalog entries), this package does the **answering** (what is in the catalog, how to play it). Writer and responder are separated; both read and write the same tables (docs/06 §8).

## Source files

### `src/index.ts`

The package's only source file: the `SourceLocal` service, `NoAuth`, the capability constants, and the plugin entry.

**`SourceLocal extends Service`** (owns the `ctx.sourceLocal` service key; `static inject = ['db', 'fs', 'sources']`):

| Member | Purpose |
|---|---|
| `[Service.init]()` | Nested injection of `['scanner']` (fetches the scan-root list; missing only degrades the feature); registers the provider via `ctx.sources.register(this.provider())` — the registration itself is the disposer, so unloading the plugin or signing out makes downstream stop "seeing" it. ⚠️ The disposer is wrapped in a local closure before being returned: what crosses the service proxy is not the function the fiber would collect. On startup one `logger.info` registration line is written — "my local music disappeared" must be answerable from the log file. |
| `provider(): MediaProvider` | Assembles the provider object handed to `ctx.sources`. |

**Required core surface**:

- `getTrack(id)` — queries the row for that URN directly. An earlier version listed the entire catalog's first page and then fell back — "two queries per song" of waste; this is the path the player calls per track.
- `getTracks(ids)` — the batch version. The entire reason the SPI has this member: `ids.map(getTrack)` is N round trips, while a queue restore needs the whole queue at once.
- `resolveStream(id, prefs)` — **the moment a URN becomes bytes, and the only method that differs from a remote provider**. Looks up `media_bindings` for the file, verifies with `ctx.fs.exists` (a missing file must surface as the player's `NotFoundError` error branch, not fail later at decode time), then finishes with `ctx.fs.toPlayableUri` — this is the **explicit un-leaking of Android SAF**: the folder the user picked is a `content://` tree URI the decoder cannot open, and right here it becomes something that can be opened (docs/04 §1). The result carries `codec`/`bitrateKbps`/`sampleRate`/`byteLength`.
- `ping()` — cheap (by contract): the root exists and is readable.

**Optional surface**:

- `search(query, page)` — answered from the FTS index maintained by `ctx.sources` (narrowed by this sourceId). One index, two entry points (here and `searchLocal`), rather than two tokenizer configurations that drift apart. The `fullText: true` capability constant holds for this reason — this package does not build an index itself.
- `browse(nodeId?, page?)` — the local library's "explore" surface is the folder tree. Directories come from `ctx.fs`; **a file is a leaf only if the scanner actually imported it** — browsing a folder of entirely unsupported files yields an empty result, not a pile of unplayable tracks. Performance: two queries per folder (a `scan_entries` uri→urn batch map + a batched tracks read); a 300-track folder used to cost 600 round trips. A directory read failure **logs first, then throws**: the throw is only a message on a screen the user may not be looking at — "which folder failed to read" is the whole diagnosis. A revoked SAF permission and an unplugged USB drive look identical in the UI.
- `getAlbum` / `getArtist` — delegated to `ctx.sources`' catalog hydration.
- `getArtwork(id)` — the artwork is already on disk; the id is the row that knows where (`artworks.local_uri`).

**Sign-out = `forgetEverything()`**: there are no credentials, so what gets cleared is the catalog rows and scan bookkeeping (`scan_entries`/`media_bindings`/`tracks`/`albums`/`artists`, one transaction) — the local equivalent of clearing the cookie jar; **the files themselves belong to the user and are never touched**. Then emits `library/changed` and `source/signed-out`.

**Capability constants `CAPABILITIES`**: search (tracks + fullText), browse, artwork, library.read, streaming `{ qualities: ['lossless'], seekable: true, urlExpiry: false }` — "a file on disk is always seekable and never expires"; only by saying so can the UI offer a scrub bar without probing.

## Configuration

```ts
export interface SourceLocalConfig {
  sourceId?: string    // default 'local', must match the scanner's
  displayName?: string // default 'This device'
}
```

## Capabilities

`fs:read:all`, `db:read:core`, `db:write:core`.

## Exports

```ts
export class SourceLocal extends Service      // ctx.sourceLocal
export interface SourceLocalConfig
export const name = 'plugin-source-local'
export async function apply(ctx, config?)     // deliberately awaits ctx.plugin(SourceLocal, config)
export default { name, apply }
export { parseUrn }
```

## Related docs

- `docs/06-music-sources.md` §1/§8: the MediaProvider SPI, the local source's equal standing
- `docs/04-core-services.md` §1: `ctx.fs.toPlayableUri` and SAF
- `packages/feature/plugin-local-scanner/README.md`: the writing side
