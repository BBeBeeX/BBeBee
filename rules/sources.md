# Music Sources & Sandbox Rules

Rules governing music source documents, rule engines, QuickJS sandboxing, and authoring in BBeBee.

---

## 1. What a Source Is

- **A music source is a JSON document imported as text**, NOT a plugin package.
- Interpreted solely by `plugin-source-runtime`.
- `MediaProvider` is an internal interface with only two implementations (`plugin-source-runtime` and `plugin-source-local`).
- Capabilities are derived from which rule blocks are present in the document.

---

## 2. Rule Language

Rule prefixes select the execution engine:

| Prefix | Engine | Description |
|---|---|---|
| `@json:` | JSONPath | Queries nested JSON structures |
| `@css:` | CSS Selector | DOM extraction (stubbed, parses but requires engine) |
| `@xpath:` | XPath | XML/HTML extraction |
| `@js:` | QuickJS Sandbox | Sandboxed JavaScript evaluation |
| `=` | String Literal | Returns constant string |
| *(bare)* | Inferred | Inferred based on syntax |

- URL template fields (`searchUrl`, `exploreUrl`, `recommendUrl`) use `{{ }}` for variable substitution (path, not expression).
- **Detail Pagination** (`ruleAlbum`, `rulePlaylist`): `getAlbum(id, page?)` and `getPlaylist(id, page?)` accept an optional `PageRequest`. The runtime maps page numbers/cursors to query parameters (`pn`/`page_num`, `ps`/`page_size`) and propagates `hasMore` and `cursor` in `AlbumDetail` / `PlaylistDetail`, enabling infinite scroll without eager bulk fetching.
- **Recommendations** (`ruleRecommend`, optional `recommendUrl`): one page of curated playlist cards per call — the recommendation shelf renders the first page ("show all" pages through the rest). Rows are browse rows (`kind: 'album'`/`'playlist'` with `childUrl`), so a recommended playlist opens through the same album-detail pipeline a browsed one does. `recommendUrl` is optional: a source whose recommendations are a curated list lets the `@js:` rule build rows from nothing (`result` is `null`).
- Only `{{@js:...}}` reaches the QuickJS sandbox.
- Combinators:
  - `||`: First non-empty result
  - `&&`: Concatenate results
  - `%%`: Interleave results
  - `##pattern##replacement##`: Regex replacement

---

## 3. Sandboxing & Security

- **Pure logic**: `packages/feature/source-rules` contains pure parsing/evaluation logic — no Cordis, no platform SDKs, no I/O.
- **Sandboxed QuickJS**: `ctx.js` runs untrusted scripts in isolated QuickJS realms without ambient Node or DOM globals. Objects cross the boundary by value cloning only.
- **Host allowlists**: Outbound HTTP requests from sources are gated against `allowedHosts` declared in the source manifest before and after `http/request` waterfall hooks.
- **Credentials**: Passwords and tokens must NEVER be hardcoded into source documents.

---

## 4. Source Authoring Workflow

- **Dual-file development in `sources/<id>/`**:
  - `source.json`: Metadata, capabilities, rules, endpoints.
  - `source.js`: External JavaScript library code with IDE syntax highlighting.
- **CLI Commands**:
  - `pnpm build:sources`: Compiles all `sources/` into single-file JSONs in `fixtures/sources/`.
  - `pnpm watch:sources`: Watch mode for live re-compilation.
  - `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]`: Unpacks a single-file JSON back into `source.json` and `source.js`.

---

## 5. Third-Party Lyric Sources & Sandbox

- **Audio Source Attribute**: Each audio source supports `needsLyricSource?: boolean` (defaults to `!ruleLyric`). If enabled, the player queries external lyric sources (`ctx.lyricSources`) with higher priority.
- **Strict Data Sandbox**: External lyric sources execute in an isolated QuickJS realm or shadowed JS sandbox. They are passed **ONLY** `{ title, artist, duration }` and an egress-checked `httpFetch` bridge.
- **Unified Normalization**: All external outputs (standard LRC strings, TTML, LRCLIB JSON, translated dual-line LRCs, line arrays) are parsed and converted into the application standard `Lyrics` contract.
