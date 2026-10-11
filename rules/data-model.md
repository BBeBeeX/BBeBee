# Data Model & State Rules

Rules governing URNs, SQLite storage, migrations, and event hooks in BBeBee.

> **L2 · 何时读**：动 URN、SQLite 表、迁移或事件钩子时——WAL 约定、时间戳/布尔/JSON 列规范、waterfall 语义、状态所有权。
> **不读会怎样**：迁移语句被驱动器静默截断、时间戳/布尔/JSON 存法跑偏、waterfall 的 `next` 误用吞掉链路数据。
> **深读指引**：docs/data-model/urn.md（URN 设计动机）、schema.md §3–§4（表级细节）、events.md（事件正典）、migrations.md（迁移机制）。

---

## 1. URN (Uniform Resource Name)

Catalog entities are addressed by typed, immutable URNs:
`BBeBee:<sourceId>:<kind>:<id>`

- `kind`: `track | album | artist | playlist | genre`.
- `sourceId`: Derived from `sourceUrl` (slugified host + first 8 hex of SHA-256).
- `parseUrn` splits only on the first three colons, so source-local IDs may contain colons.
- **Multi-source joining**: The same song on two different music sources has two distinct URNs and two rows in `tracks`, joined by `track_links` — never merged into a single row. The unified library merges at display time.

---

## 2. SQLite Database Conventions

- `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`.
- **Timestamps**: Epoch milliseconds as `INTEGER` (not seconds, not ISO strings).
- **Booleans**: `INTEGER` (0 or 1).
- **JSON columns**: `TEXT` with a `_json` suffix (e.g. `meta_json`, `scope_json`).
- Tables mirroring remote data carry `fetched_at INTEGER`.
- Foreign keys to catalogue entities use `URN TEXT`.

---

## 3. Database Migrations

- **Migrations are forward-only**, namespaced (`core` or `plugin:<id>`), and tracked in `schema_migrations`.
- **Atomic transactions**: All statements of an `up` migration and its bookkeeping row commit together in **one transaction**.
- **One statement per `up` entry**: SQLite drivers only compile the first statement of a multi-statement string and drop the rest. Use an array of single-statement strings:
  ```ts
  up: [
    'CREATE TABLE IF NOT EXISTS {{ns}}_items (id TEXT PRIMARY KEY, title TEXT);',
    'CREATE INDEX IF NOT EXISTS {{ns}}_items_idx ON {{ns}}_items (title);',
  ]
  ```
- **Namespace expansion**: `{{ns}}` expands to the prefixed namespace (`core_` or `plugin_scrobble_`).
- A plugin may only declare schema within its own instance namespace (`ctx.db.defineSchema('plugin:<id>', ...)`).

---

## 4. Events & Waterfall Hooks

Declared in `@BBeBee/protocol` augmenting Cordis's `Events`.

| Hook | Type | Purpose |
|---|---|---|
| `player/before-resolve` | Waterfall | `plugin-download` substitutes a local file; `plugin-cache` a cached stream |
| `http/request` | Waterfall | Source runtime injects headers/cookies; response caching and rate limits |
| `dsp/build-chain` | Waterfall | Each audio effect inserts its DSP node segment |
| `player/position` | emit | Emitted at 1 Hz; UI interpolates with `requestAnimationFrame` (never poll) |

> ⚠️ **A waterfall's `next` takes no arguments.** Cordis closes it over the original argument list.
> A listener either:
> 1. **Mutates the argument in place** and calls `await next()`, or
> 2. **Short-circuits** by returning a value directly without calling `next()`.

---

## 5. State Ownership

Each piece of application state has exactly ONE owner:
- Catalogue entities → `ctx.db` (written via `ctx.sources`)
- Source documents → `ctx.sources` (persisted in `sources`)
- Transport & queue → `ctx.player`
- Audio nodes → `ctx.audio`
- Effect parameters → `ctx.dsp`
- Credentials & tokens → `ctx.secrets` (per source ID)
- Now Playing layout styles & sandboxed plugins → `ctx.nowPlaying`
- Visual themes → `ctx.theme`
- UI contributions → `ctx.ui`
- Plugin configuration → `@BBeBee/kernel`

**React holds no domain state** — only view/transient UI state.

---

## 6. Collections & Folders Structure

- **Entity hierarchy**: Folders (`collections`) organize collection-level entities: `playlist`, `album`, `artist`, and child folders (`collection`).
- **No direct tracks**: Folders **never** hold individual tracks (`track` URNs). Individual tracks belong exclusively to playlists or albums. `ctx.library.addToCollection` rejects `track` URNs with `LibraryError(..., 'invalid-urn')`.

## 7. Local User & Library Seeds

- **One profile row**: `library_profile` (core migration v6) holds the local user — UUID id, name defaulting to `Mine`, editable via `ctx.library.updateProfile` (Settings → 通用 → 用户). Created playlists display the *current* profile name as creator (`playlist.owner` wins for remote ones); renames emit `library/profile-changed`.
- **Never-empty library**: on init `plugin-library` seeds one playlist named `我的歌单` while the library holds no playlists, so the curation page never opens empty.
