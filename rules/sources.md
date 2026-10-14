# Music Sources & Sandbox Rules

Rules governing music source documents, rule engines, QuickJS sandboxing, and authoring in BBeBee.

> **L2 · When to read**: when writing music-source JSON, modifying the source runtime/sandbox, or touching the third-party registry and install chain.
> **What goes wrong without it**: credentials written into source documents, the `allowedHosts` disclosure red line breached, sources packaged as plugins, the registry model misunderstood (a four-directory enumeration, not a single-file index).
> **Deeper reading**: docs/sources/spec.md (model and fields), rule-engines.md (the rule language), runtime.md (sandbox and limits), registry.md (the registry and install flows, including the 13-rule security scan list), parameters.md (parameters and the lyric-source sandbox).

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
| `@css:` | CSS Selector | DOM extraction (stub — parses, but evaluation raises `RuleEngineUnavailableError`) |
| `@xpath:` | XPath | XML/HTML extraction (stub — parses, but evaluation raises `RuleEngineUnavailableError`) |
| `@js:` | QuickJS Sandbox | Sandboxed JavaScript evaluation |
| `=` | String Literal | Returns constant string |
| *(bare)* | Inferred | Inferred based on syntax |

- URL template fields (`searchUrl`, `exploreUrl`, `recommendUrl`) use `{{ }}` for variable substitution (path, not expression).
- **Detail Pagination** (`ruleAlbum`, `rulePlaylist`): `getAlbum(id, page?)` and `getPlaylist(id, page?)` accept an optional `PageRequest`. The runtime maps page numbers/cursors to query parameters (`pn`/`page_num`, `ps`/`page_size`) and propagates `hasMore` and `cursor` in `AlbumDetail` / `PlaylistDetail`, enabling infinite scroll without eager bulk fetching.
- **Multi-P Video & Virtual Album Expansion** (`ruleAlbum.childUrl`): Multi-part videos map to tracks with `<bvid>_p<page>` suffix (defaulting to P1 for plain BVIDs). When `payload.childUrl` is not cached from previous browsing, `ruleAlbum.childUrl` acts as a dynamic URL fallback, allowing direct navigation to albums from tracks ("Go to album"). Multi-P tracks resolve accurate stream audio and lyrics by targeting the page's specific `cid` from cached `pagelist`, and external links append `?p=<page>`.
- **Recommendations** (`ruleRecommend`, optional `recommendUrl`): one page of curated playlist cards per call — the recommendation shelf renders the first page ("show all" pages through the rest). Rows are browse rows (`kind: 'album'`/`'playlist'` with `childUrl`), so a recommended playlist opens through the same album-detail pipeline a browsed one does. `recommendUrl` is optional: a source whose recommendations are a curated list lets the `@js:` rule build rows from nothing (`result` is `null`). For directory-based backends (such as Subsonic / OpenSubsonic), recommendations yield the library's default playlist or root directory as the first card, followed by randomized collections across other directories.
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
- **Custom endpoints & dynamic allowlisting**: When a source declares `params` containing `sourceurl`, user modifications to the server endpoint dynamically append the extracted host to the QuickJS sandbox's `allowedHosts` allowlist with zero restart required, preserving preexisting static endpoints.
- **Declarative Configuration UI & Parameter Pruning**: Source configure modals (`SourceConfigureModal` in desktop and mobile) strictly expose parameters declared in `doc.params`, `loginUi`, and `loginType`. Host inputs are omitted on fixed backends; credentials render only declared fields (with `var` hidden unless form-variable login is used); arbitrary undeclared key-value inputs ("Add variable") are prohibited because the sandbox cannot read undeclared variables.
- **Credentials**: Passwords and tokens must NEVER be hardcoded into source documents. All sensitive values are stored in `ctx.secrets.namespace(sourceId)` which is shared across caller plugins.

---

## 4. Source Authoring Workflow

- **Independent source repositories**: Each source lives in its own GitHub repository (e.g. `B_Be_Bee-subsonic`, `B_Be_Bee-lrclib`). Source development uses dual files (`src/source.json` + `src/source.js`).
- **Source repository tooling** (Node builtins only):
  - `node scripts/compile.mjs`: Compiles `src/source.json` and `src/source.js` into root `index.json`.
  - `node scripts/validate.mjs`: Validates schema, readability, and byte-for-byte reproducibility against root `index.json`.
- **Registry repository** (`B_Be_Bee-registry`):
  - Pure DMS-style metadata index storing entry pointers (`music-sources/{username}-{name}.json`, `lyric-sources/{username}-{name}.json`, `plugins/{username}-{name}.json`) and native themes (`themes/{username}-{name}/`).
  - Strict metadata validation via `node scripts/validate.mjs`.
- **Main app repo tooling**:
  - `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]`: Unpacks a single-file JSON back into `source.json` and `source.js` for inspection.

---

## 5. Third-Party Lyric Sources & Sandbox

- **Audio Source Attribute**: Each audio source supports `needsLyricSource?: boolean` (defaults to `!ruleLyric`). If enabled, the player queries external lyric sources (`ctx.lyricSources`) with higher priority.
- **Strict Data Sandbox**: External lyric sources execute in an isolated QuickJS realm or shadowed JS sandbox. They are passed **ONLY** a frozen `{ title, artist, duration }` query — plus a frozen `config` copy when the source defines one — and an `httpFetch` bridge proxied by the host and restricted to the source's `allowedHosts`.
- **Unified Normalization**: All external outputs (standard LRC strings, TTML, LRCLIB JSON, translated dual-line LRCs, line arrays) are parsed and converted into the application standard `Lyrics` contract.

---

## 6. Registry (third-party registry)

The community registry ([B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry)) is a decentralized metadata index: the app discovers entries by enumerating four categorized directories (`music-sources/`, `lyric-sources/`, `plugins/`, `themes/`) through the GitHub Contents API, falling back to a legacy single `registry.json` and then to the offline cache. The app consumes it through the `contentRegistry` service — see [docs/sources/registry.md](../docs/sources/registry.md).

- **Four kinds of content**: `music-source`, `lyric-source`, `theme`, `plugin`.
- **Entry fields** (one `{username}-{name}.json` pointer per entry): `id`, `kind`, `name`, `description`, `version`, `author`, `updatedAt`, `downloadUrl`, `minAppVersion`. Music-source entries additionally carry `sourceUrl` (their matching key against installed sources) and optional `params` (e.g. `["sourceurl", "username", "password"]`); theme and plugin entries carry `previewUrl`; plugin entries additionally carry `repoUrl`, `category`, `sha256` (integrity digest of the install bundle) and `capabilities`.
- **Configurable parameters (`params`)**: Music sources declaring `params: ["sourceurl", ...]` allow the user to customize the backend instance URL/path. Modifying `sourceurl` in the app dynamically injects the target host into the sandbox `allowedHosts` allowlist and relaxes strict `entry.sourceUrl` equality in discovery/install state.
- **Version semantics**: any content change must bump the entry's semver `version`; an entry missing `version` is treated as `0.0.0`. Lyric sources already use `version` for the built-in source's upgrade comparison.
- **Install safety red lines**: any source — imported as text or installed from the registry — must have its `allowedHosts` shown to the user before it takes effect; plugin installs verify the downloaded bundle against the entry's `sha256` and require an explicit risk confirmation; the app only consumes `dist/` build artifacts — per-entry source in the registry repo exists for human review, not for direct consumption.
- **Built-in constraint**: the app ships exactly one built-in lyric source (lrclib) and no built-in music sources; the registry must not add new built-in sources.
- Contribution rules and moderation standards live in the registry repo's `CONTRIBUTING.md` / `MODERATION.md`.
