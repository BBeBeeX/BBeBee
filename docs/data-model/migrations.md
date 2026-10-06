# Forward Database Migrations & Versioning

> **Legacy Reference:** Formerly `docs/07-data-model.md §6, §8`.

## 6. Migrations

### Core schema

Forward-only, versioned, in `packages/kernel/src/migrations/`. Each is a numbered module applied
in a transaction; the applied version is recorded.

```sql
CREATE TABLE schema_migrations (
  namespace   TEXT NOT NULL,                 -- 'core' or 'plugin:<id>'
  version     INTEGER NOT NULL,
  applied_at  INTEGER NOT NULL,
  PRIMARY KEY (namespace, version)
);
```

`down` migrations exist only for development. In production, downgrading the app against a
newer database refuses to start with an explanatory message rather than attempting a rollback —
a half-applied downgrade is worse than a clear failure.

> **Each migration's statements and its bookkeeping row commit together, in one transaction.**
> This is load-bearing, not tidiness: without it, an interruption partway through a multi-statement
> migration leaves the tables created but the version unrecorded, so the next boot re-runs it into
> `table already exists` — and every boot after that. The database becomes permanently unbootable
> with no recourse but deleting files by hand. `MigrationDb` therefore requires a `transaction()`
> method; it is not optional. `BEGIN IMMEDIATE` takes the write lock up front rather than
> upgrading mid-transaction.

#### Core migrations catalog (`CORE_MIGRATIONS`)

Implemented in `packages/kernel/src/migrations/core.ts`:

| Version | Purpose | Key changes |
|---|---|---|
| **v1** | Base database schema | Initial tables: `providers`, `accounts`, `cookie_jars`, `artworks`, `artists`, `albums`, `tracks`, `track_artists`, `track_genres`, `genres`, `external_ids`, `track_links`, `media_bindings`, `scan_specified_dirs`, `scan_entries`, `playlists`, `playlist_items`, `library_items`, `collections`, `collection_items`, `queue_items`, `playback_state`, `play_history`, `track_stats`, `download_tasks`, `download_policies`, `effect_chains`, `effect_nodes`, `presets`, `settings`, `plugin_records`, `capability_grants`, `lyrics`, `cache_entries`. |
| **v2** | Full-text search (FTS5) | Creates `tracks_fts` virtual table using `fts5(title, artist_names, album_title, content='', contentless_delete=1)` and `tracks_fts_map(rowid, urn)`. |
| **v3** | Sources transition (ADR-5) | Replaces `providers` with `sources` and `source_vars`; renames `instance_id` to `source_id` across all catalogue and playlist tables; drops `providers`. |
| **v4** | Local scan performance index | Adds `CREATE INDEX idx_scan_entries_track ON scan_entries(track_urn)`. |
| **v5** | Library data cleanup | Prunes un-favorited local tracks mistakenly inserted into `library_items`. |
| **v6** | User profile table | Adds singleton table `CREATE TABLE library_profile (id TEXT PRIMARY KEY, name TEXT NOT NULL)`. |
| **v7** | Dragged files reading whitelist | Adds `CREATE TABLE scan_dropped_files (uri TEXT PRIMARY KEY, added_at INTEGER NOT NULL)` for individually dropped desktop tracks. |

### Plugin-owned schemas

A plugin platform where only the core may create tables is not really a platform. Plugins declare
their own:

```ts
await ctx.db.defineSchema('plugin:@BBeBee/plugin-scrobble', [
  {
    version: 1,
    up: `CREATE TABLE {{ns}}_submissions (
           id TEXT PRIMARY KEY,
           play_id TEXT NOT NULL,
           submitted_at INTEGER,
           status TEXT NOT NULL
         )`,
  },
  { version: 2, up: `CREATE INDEX {{ns}}_status ON {{ns}}_submissions(status)` },
])
```

Rules:

- `{{ns}}` expands to a sanitised prefix derived from the plugin id, so ownership is legible in
  the schema. The transform is **lossy** — `-`, `.`, and `_` all fold to `_`, so `plugin:a-b` and
  `plugin:a.b` both yield `plugin_a_b`. Uniqueness is therefore enforced separately: a
  `schema_namespaces` table records which namespace owns each prefix, and a second namespace
  claiming it is refused with `NamespaceCollisionError` rather than silently sharing tables.
- A plugin may only write its own tables, and may only `defineSchema` for
  `plugin:<its own instance id>` — otherwise it could claim `core` and own the catalogue.
  **No first-party plugin currently ships its own schema** — the scanner, the player and the
  sources UI all read and write *core* tables under `db:read:core`/`db:write:core`. The
  `{{ns}}` machinery below is implemented in the kernel and tested, but exercised by no bundled
  plugin yet.
  Reading core tables requires `db:read:core`, and changing their rows requires `db:write:core` —
  a separate grant, not one implied by the first ([capabilities.md §7](../plugins/capabilities.md#capability-grammar)).
  Each `up` entry is **one statement**: a driver runs the first and discards the rest in silence,
  so a multi-statement string is refused before anything executes rather than half-applied with
  its version recorded ([contracts.md §5](../services/contracts.md#5-ctxdb--sql)). That is what the array form
  is for. `ATTACH`/`DETACH` are refused outright, since
  they would turn the database handle into an arbitrary-file primitive.
- ⚠️ The check is a **regex over table identifiers, not a SQL parser**. It fails closed — an
  identifier it cannot attribute is treated as foreign — and it stops the ordinary mistake and the
  casual overreach. It is not a boundary against an author who is trying, who shares the runtime
  anyway ([concepts.md §7](../plugins/concepts.md#where-the-gate-actually-runs)).
- Migrations run inside `ctx.plugin()`, so a failing migration fails that plugin only.
- **Uninstall** offers "remove data" — drops the namespace's tables and its `schema_migrations`
  rows — or "keep data", leaving them dormant so a reinstall resumes where it left off. Defaulting
  to keep is the safer choice.

### Data retention

`play_history` grows without bound. A maintenance pass keeps full rows for 2 years (configurable),
then collapses older ones into `track_stats` and deletes them. `cache_entries` follow [schema.md §4.11](schema.md#411-lyrics-and-cache).
Everything else is bounded by the size of the user's library.

---

## 8. Where to go next

[UI Architecture](../ui/architecture.md) covers how this data reaches two different view
layers without either of them owning it.
