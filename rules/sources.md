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
- **Multi-P Video & Virtual Album Expansion** (`ruleAlbum.childUrl`, Bilibili): Multi-part videos map to tracks with `<bvid>_p<page>` suffix (defaulting to P1 for plain BVIDs). When `payload.childUrl` is not cached from previous browsing, `ruleAlbum.childUrl` acts as a dynamic URL fallback, allowing direct navigation to albums from tracks ("转至专辑"). Multi-P tracks resolve accurate stream audio and lyrics by targeting the page's specific `cid` from cached `pagelist`, and external links append `?p=<page>`.
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

- **Dual-file development lives in the registry repo** — `bbebeex-registry`, wired into this repo as the pinned `registry/` submodule (`registry/music-sources/<id>/`, `registry/lyric-sources/<id>/`). The main repo no longer keeps a top-level `sources/` directory.
- **CLI Commands (main repo)**:
  - `pnpm build:sources`: Compiles the submodule's dirs into single-file JSONs — `fixtures/sources/` (music) and `fixtures/lyric-sources/` (lyric) — and regenerates `plugin-lyric-sources`'s builtin module.
  - `pnpm watch:sources`: Watch mode (one watcher per registry dir) for live re-compilation.
  - `--sources <dir>`: legacy single-directory build (music + lyric mixed, routed per document); `--lyric-sources <dir>` overrides just the lyric dir of the default flow.
  - `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]`: Unpacks a single-file JSON back into `source.json` and `source.js` (default destination `registry/music-sources/unpacked`).
- **Registry-side tooling** (in the registry repo, Node builtins only): `node scripts/compile.mjs` (compile + validate → `dist/`), `node scripts/compile.mjs --unpack <file> [dest]` (same unpack), `node scripts/generate-index.mjs` (regenerate `registry.json` + README), `node scripts/validate.mjs` (full validation). See the registry's `CONTRIBUTING.md`.

---

## 5. Third-Party Lyric Sources & Sandbox

- **Audio Source Attribute**: Each audio source supports `needsLyricSource?: boolean` (defaults to `!ruleLyric`). If enabled, the player queries external lyric sources (`ctx.lyricSources`) with higher priority.
- **Strict Data Sandbox**: External lyric sources execute in an isolated QuickJS realm or shadowed JS sandbox. They are passed **ONLY** `{ title, artist, duration }` and an egress-checked `httpFetch` bridge.
- **Unified Normalization**: All external outputs (standard LRC strings, TTML, LRCLIB JSON, translated dual-line LRCs, line arrays) are parsed and converted into the application standard `Lyrics` contract.

---

## 6. Registry（第三方注册表）

The community registry ([bbebeex-registry](https://github.com/BBeBeeX/bbebeex-registry)) publishes installable content as a `registry.json` index. The app consumes it through the `contentRegistry` service — see [docs/sources/registry.md](../docs/sources/registry.md).

- **Four kinds of content**: `music-source`, `lyric-source`, `theme`, `plugin`.
- **`registry.json` entry fields**: `id`, `kind`, `name`, `version`, `author`, `updatedAt`, `downloadUrl`, `minAppVersion`. Music-source entries additionally carry `sourceUrl` (their matching key against installed sources); plugin entries additionally carry `sha256` (integrity digest of the install bundle) and `capabilities`.
- **Version semantics**: any content change must bump the entry's semver `version`; an entry missing `version` is treated as `0.0.0`. Lyric sources already use `version` for the built-in source's upgrade comparison.
- **Install safety red lines**: a music source's `allowedHosts` must be shown to the user before install is confirmed; plugin installs verify the downloaded bundle against the entry's `sha256` and require an explicit risk confirmation; the app only consumes `dist/` build artifacts — per-entry source in the registry repo exists for human review, not for direct consumption.
- **Built-in constraint**: the app ships exactly one built-in lyric source (lrclib) and no built-in music sources; the registry must not add new built-in sources.
- Contribution rules and moderation standards live in the registry repo's `CONTRIBUTING.md` / `MODERATION.md`.
