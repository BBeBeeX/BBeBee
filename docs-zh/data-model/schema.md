# SQLite 数据库模式与实体数据表

> **历史章节映射：** 原 `docs-zh/07-data-model.md §2 – §4，§7`。

## 2. 实体—关系总览

```mermaid
erDiagram
    sources ||--o{ accounts : "has"
    sources ||--o{ source_vars : "remembers"
    sources ||--o{ tracks : "owns"
    sources ||--o{ albums : "owns"
    sources ||--o{ artists : "owns"
    sources ||--o{ playlists : "owns"

    albums ||--o{ tracks : "contains"
    tracks }o--o{ artists : "track_artists"
    albums }o--o{ artists : "album_artists"
    tracks }o--o{ genres : "track_genres"

    tracks ||--o{ external_ids : "identified by"
    tracks ||--o{ track_links : "linked to"
    tracks ||--o{ media_bindings : "materialised as"
    tracks ||--o{ lyrics : "has"
    tracks ||--o| track_stats : "aggregates"
    tracks ||--o{ play_history : "played as"
    tracks ||--o{ download_tasks : "downloaded by"

    playlists ||--o{ playlist_items : "contains"
    playlist_items }o--|| tracks : "references"

    queue_items }o--|| tracks : "references"
    playback_state ||--o| queue_items : "points at"

    scan_specified_dirs ||--o{ scan_entries : "yields"
    scan_entries }o--o| tracks : "produces"

    artworks ||--o{ tracks : "illustrates"
    artworks ||--o{ albums : "illustrates"

    effect_chains ||--o{ effect_nodes : "orders"
    plugin_records ||--o{ capability_grants : "granted"
```

---

## 3. 约定

- SQLite 启用 `journal_mode = WAL`、`foreign_keys = ON`、`synchronous = NORMAL`。
- 时间戳一律是 **epoch 毫秒**，类型为 `INTEGER`。不存日期字符串，也不存时区。
- 布尔值用 `INTEGER` 0/1 表示。
- JSON 列用 `TEXT` 存放 JSON，列名带 `_json` 后缀。
- 每张镜像远端数据的表都带有 `fetched_at`，因此数据是否陈旧始终有据可查。
- 指向目录（catalogue）行的外键是 URN `TEXT`，而不是整数 id —— 后端给出的 id 一旦离开它所属的音源便毫无意义，以 URN 作联结键让这类错误无从发生。
- 子行无法脱离父行存在的地方使用 `ON DELETE CASCADE`；可以独立存在的地方则做显式清理。

---

## 4. 表

### 4.1 音源、账号与会话

**音源文档就是表里那一行。** `doc_json` 原样保存被导入的字符串；其余每一列要么由它派生（因此可以重建），要么是应用维护的状态，在音源被分享时不应随之外流。

```sql
CREATE TABLE sources (
  id            TEXT PRIMARY KEY,          -- 'music-example-org-35be9fe2', derived ([sources/authoring.md §1.2](../sources/authoring.md#12-身份源-id))
  source_url    TEXT NOT NULL UNIQUE,      -- the document's identity; dedup key on import
  name          TEXT NOT NULL,             -- denormalised from doc_json for list rendering
  source_group  TEXT,                      -- comma-separated, free text
  source_type   TEXT NOT NULL DEFAULT 'music',  -- music|podcast|radio
  doc_json      TEXT NOT NULL,             -- the SourceDocument, verbatim ([sources/spec.md §2.1](../sources/spec.md#21-顶层文档结构))
  doc_hash      TEXT NOT NULL,             -- sha256 of doc_json; drives the import diff
  enabled       INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT,                  -- derived Capabilities, cached ([sources/rule-engines.md §1.3](../sources/rule-engines.md#13-能力是推导出来的不是声明出来的))
  allowed_hosts_json TEXT,                 -- the egress allowlist shown at import ([sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么))
  locally_modified INTEGER NOT NULL DEFAULT 0,  -- edited in-app since import
  origin_uri    TEXT,                      -- where it was imported from, if a URL
  imported_at   INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_check_at INTEGER,                   -- last `check` run ([sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源))
  last_error    TEXT,                      -- the failing rule, if any
  fail_count    INTEGER NOT NULL DEFAULT 0,-- 3 consecutive RuleErrors → stale badge ([sources/authoring.md §7](../sources/authoring.md#7-错误))
  respond_time_ms INTEGER
);
CREATE INDEX idx_sources_enabled ON sources(enabled, sort_order);

-- Per-source persisted state written by rules via src.vars ([sources/rule-engines.md §3.4](../sources/rule-engines.md#34-js-内的执行环境)).
-- Credential-grade: never exported, cleared by signOut().
CREATE TABLE source_vars (
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, key)
);

CREATE TABLE accounts (
  source_id      TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  remote_user_id TEXT,
  display_name   TEXT,
  status         TEXT NOT NULL,            -- anonymous|authenticated|expired|error
  expires_at     INTEGER,
  updated_at     INTEGER NOT NULL
);

-- Mobile only. Desktop keeps cookies in Chromium's own persisted partition
-- and never writes this table. See ../services/overview.md#21-cookie-jars.
CREATE TABLE cookie_jars (
  name        TEXT PRIMARY KEY,            -- the source id
  ciphertext  BLOB NOT NULL,               -- AES-GCM over the serialised jar
  iv          BLOB NOT NULL,
  key_ref     TEXT NOT NULL,               -- ctx.secrets key holding the AES key
  updated_at  INTEGER NOT NULL
);
```

为什么 `doc_json` 要整体存储而不是拆散成列：这份文档是用户拥有的制品。让它在一个规范化的 schema 里走个来回，意味着导出产物会与导入内容有微妙差异 —— 键被重排、未知字段被丢弃、某条规则被重新排版 —— 而当用户编辑过的文档第一次导出后就变了样，他们就会不再信任导出。

**未知*顶层*字段能在旧版应用中幸存**，也是出于同样的原因：为更新版运行时编写的文档会被原样存储、原样再导出，这个构建所不理解的字段只是不会被读取。规则块**内部**的未知字段则会在导入时被拒绝（[sources/rule-engines.md §2.2](../sources/rule-engines.md#22-规则块)）—— 这种不对称是刻意的。游离的顶层键是向前兼容；`ruleSearch.titel` 则是一个拼写错误，若无这道检查它本会通过校验、永远不会被读取，并让音源半失灵地运行，看上去就像后端变了。

`doc_hash` 让重新导入成为一个三分判定，而不是掷硬币：未变化（哈希相同，跳过）、有更新（哈希不同，展示字段差异）、或冲突（哈希不同*且* `locally_modified`，要求确认）—— 见 [sources/authoring.md §9](../sources/authoring.md#9-导入更新与分享)。

它是一个**完整的 SHA-256**，`id` 的后缀取的正是其一的前 32 位。最初使用的那个短的非加密哈希错在两处：`id` 是主键，一次碰撞就会让一个音源的行覆盖另一个音源的行；而 `doc_hash` 决定更新到底会不会发生，在那里发生碰撞会把一份已变更的文档归类为"未变化"，然后悄无声息地跳过。

> **`enabled` 属于用户，而不属于文档。** 导入会写入其余每一列，唯独不写这一列。发布修复的作者绝不能把用户已关掉的音源重新打开 —— 而被禁用的行与"音源已移除但曲库保留"的行根本无法区分（[sources/runtime.md §4.1](../sources/runtime.md#41-一个源的生命周期)），所以导入路径不做猜测。

> **数据库中绝无可读凭据。** Token、密码与每个音源的变量都存放在 `ctx.secrets` 中，位于 `namespace(sourceId)` 之下；`source_vars` 只保存规则选择持久化的内容，并以同样的方式对待。Cookie 同样是凭据，但一个真实的会话 jar 会超出 `expo-secure-store` 的 2048 字节值上限，因此移动端对它采用**信封加密**：AES 密钥（很小）放 `ctx.secrets`，密文（不限大小）放 `cookie_jars`。不变式得以保住 —— 密钥与密文绝不同处一库，泄露的数据库文件什么都得不到（[services/overview.md §2.1](../services/overview.md#21-cookie-罐)、[services/contracts.md §6](../services/contracts.md#6-ctxsecrets--凭据存储)）。
>
> ⚠️ **音源文档绝不能包含凭据**，而 `export()` 无法剥离它认不出的东西。因此才有上面的分离：凭据在构造上就位于 `doc_json` 之外，于是"分享这个音源"默认就是安全的，而不依赖分享者记得这么做（[sources/runtime.md §5](../sources/runtime.md#5-认证与会话)）。
>
> `accounts` 只记录"存在一个会话"以及它何时失效。删除音源会级联删除 `accounts` 与 `source_vars`；而 `signOut()` 单独负责清空 `cookie_jars` 与 secrets 命名空间，因为它们处在 SQLite 级联之外（[sources/runtime.md §5.1](../sources/runtime.md#51-会话持久化--cookie-在应用关闭后依然存活)）。

### 4.2 封面图

它被多张表引用，所以放在最前面。

```sql
CREATE TABLE artworks (
  id             TEXT PRIMARY KEY,          -- content hash when local, else derived from source_url
  source_url     TEXT,
  local_uri      TEXT,                      -- populated once cached
  width          INTEGER,
  height         INTEGER,
  blurhash       TEXT,                      -- instant placeholder, no layout shift
  dominant_color TEXT,                      -- '#RRGGBB', drives adaptive player theming
  bytes          INTEGER,
  fetched_at     INTEGER
);
CREATE INDEX idx_artworks_local ON artworks(local_uri) WHERE local_uri IS NOT NULL;
```

`blurhash` 与 `dominant_color` 在缓存落盘时一次性算好，而不是每次渲染都算，因为在 UI 里做这件事会让每次列表滚动都损失一帧。

### 4.3 目录（catalogue）

```sql
CREATE TABLE artists (
  urn          TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  remote_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  sort_name    TEXT,
  artwork_id   TEXT REFERENCES artworks(id),
  bio          TEXT,
  fetched_at   INTEGER NOT NULL,
  raw_json     TEXT
);
CREATE INDEX idx_artists_source ON artists(source_id);
CREATE INDEX idx_artists_sort ON artists(sort_name);

CREATE TABLE albums (
  urn           TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  remote_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  sort_title    TEXT,
  album_type    TEXT,                       -- album|single|ep|compilation|live|soundtrack
  release_date  TEXT,                       -- ISO-8601, possibly partial ('1997', '1997-04')
  year          INTEGER,                    -- derived, for cheap sorting and filtering
  track_count   INTEGER,
  disc_count    INTEGER,
  artwork_id    TEXT REFERENCES artworks(id),
  is_various    INTEGER NOT NULL DEFAULT 0,
  fetched_at    INTEGER NOT NULL,
  raw_json      TEXT
);
CREATE INDEX idx_albums_source ON albums(source_id);
CREATE INDEX idx_albums_year ON albums(year);

CREATE TABLE tracks (
  urn                TEXT PRIMARY KEY,
  source_id          TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  remote_id          TEXT NOT NULL,
  title              TEXT NOT NULL,
  sort_title         TEXT,
  album_urn          TEXT REFERENCES albums(urn) ON DELETE SET NULL,
  track_no           INTEGER,
  disc_no            INTEGER,
  duration_ms        INTEGER,
  year               INTEGER,
  explicit           INTEGER NOT NULL DEFAULT 0,
  bpm                REAL,
  replay_gain_track  REAL,
  replay_gain_album  REAL,
  peak_track         REAL,
  available          INTEGER NOT NULL DEFAULT 1,   -- cleared on NotFoundError
  qualities_json     TEXT,                          -- StreamQuality[]
  artwork_id         TEXT REFERENCES artworks(id),
  fetched_at         INTEGER NOT NULL,
  raw_json           TEXT
);
CREATE INDEX idx_tracks_album ON tracks(album_urn, disc_no, track_no);
CREATE INDEX idx_tracks_source ON tracks(source_id);
CREATE INDEX idx_tracks_title ON tracks(sort_title);

CREATE TABLE track_artists (
  track_urn  TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
  artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'main',   -- main|featured|composer|remixer|conductor
  ordinal    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_urn, artist_urn, role)
);
CREATE INDEX idx_track_artists_artist ON track_artists(artist_urn);

CREATE TABLE album_artists (
  album_urn  TEXT NOT NULL REFERENCES albums(urn) ON DELETE CASCADE,
  artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_urn, artist_urn)
);

CREATE TABLE genres (
  id   TEXT PRIMARY KEY,                     -- normalised, lowercase
  name TEXT NOT NULL
);

CREATE TABLE track_genres (
  track_urn TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
  genre_id  TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (track_urn, genre_id)
);
```

`track_artists` 是一张带 `role` 字段的联结表，而不是一个拼接的艺术家字符串，因为把 "Artist feat. Other" 写成自由文本会让客串艺术家无法被浏览 —— 这是音乐类应用中最常见的数据建模错误之一。

**全文搜索**建立在本地目录之上，两个平台上行为完全一致：

```sql
CREATE VIRTUAL TABLE tracks_fts USING fts5(
  title, artist_names, album_title,
  content='', contentless_delete=1,          -- contentless; we manage rows explicitly
  tokenize='unicode61 remove_diacritics 2'
);

-- FTS5 addresses rows by integer rowid; the catalogue is keyed by URN.
CREATE TABLE tracks_fts_map (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  urn   TEXT NOT NULL UNIQUE REFERENCES tracks(urn) ON DELETE CASCADE
);
CREATE INDEX idx_tracks_fts_map_urn ON tracks_fts_map(urn);
```

变音符折叠是有意开启的：用户输入 `bjork` 就必须能找到 `Björk`。

> ⚠️ **`contentless_delete=1` 不是可选项。** 纯 `content=''` 的表会直接拒绝 `DELETE` 和
> `UPDATE`（"cannot DELETE from contentless fts5 table"），于是一条被改名或删除的曲目会永远
> 留在索引里，搜索将返回过期结果，除了整表重建之外无药可救。要求 SQLite ≥ 3.43，
> Node 22.12+ 与 Electron 44 自带的版本都满足。
>
> 即便加了这个开关，**部分列的** `UPDATE` 依然被拒 —— 必须整行重写。请以同一 rowid 上的
> `DELETE` + `INSERT` 来重新索引。

External-content FTS（`content='tracks'`）本可以省掉映射表，但在这里用不了：
`artist_names` 是对 `track_artists` 的聚合，不是 `tracks` 的列。

### 4.4 身份关联

```sql
CREATE TABLE external_ids (
  urn       TEXT NOT NULL,
  namespace TEXT NOT NULL,                   -- isrc|mbid|upc|acoustid|discogs
  value     TEXT NOT NULL,
  PRIMARY KEY (urn, namespace, value)
);
CREATE INDEX idx_external_lookup ON external_ids(namespace, value);

CREATE TABLE track_links (
  urn_a      TEXT NOT NULL,
  urn_b      TEXT NOT NULL,
  confidence REAL NOT NULL,                  -- 0..1, 参见 [sources/authoring.md §7](../sources/authoring.md#7-错误)
  method     TEXT NOT NULL,                  -- isrc|mbid|acoustid|fuzzy|manual
  created_at INTEGER NOT NULL,
  PRIMARY KEY (urn_a, urn_b),
  CHECK (urn_a < urn_b)                      -- canonical order: store each pair once
);
CREATE INDEX idx_links_b ON track_links(urn_b);
```

`CHECK (urn_a < urn_b)` 这条约束让这层关系保持对称：无需存两份，也不会冒两个方向不一致的风险。查询时会对两列同时检索。

### 4.5 本地媒体

```sql
CREATE TABLE media_bindings (
  id           TEXT PRIMARY KEY,
  track_urn    TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
  uri          TEXT NOT NULL,                -- ctx.fs Uri, never a raw path
  format       TEXT,                         -- 'flac', 'mp3', 'm4a'
  codec        TEXT,
  bitrate_kbps INTEGER,
  sample_rate  INTEGER,
  channels     INTEGER,
  bit_depth    INTEGER,
  size_bytes   INTEGER,
  checksum     TEXT,                         -- sha256, for integrity checks
  origin       TEXT NOT NULL,                -- download|scan|import
  quality      TEXT,                         -- StreamQuality this satisfies
  verified_at  INTEGER,                      -- last time the file was confirmed present
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_bindings_track ON media_bindings(track_urn);
CREATE UNIQUE INDEX idx_bindings_uri ON media_bindings(uri);
```

**所谓"已下载"，就是"存在一条绑定"。** 任何地方都没有 `is_downloaded` 这样的标志。`player/before-resolve` 瀑布（waterfall）钩子会询问是否存在绑定，存在就直接播放（[audio/playback.md §2](../audio/playback.md#解析流水线)）。一首曲目可以有多条绑定 —— 比如一份扫描到的本地副本和一份下载来的更高质量副本 —— 由解析器按质量挑选。

之所以需要 `verified_at`，是因为文件会消失：SD 卡被拔出、同步工具删除了文件夹、iOS 清掉了某个文件。文件已丢失的绑定会被直接删除，而不是留到播放那一刻才失败。

```sql
CREATE TABLE scan_specified_dirs (
  id            TEXT PRIMARY KEY,
  uri           TEXT NOT NULL UNIQUE,
  recursive     INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  include_globs TEXT,                        -- JSON array
  exclude_globs TEXT,
  last_scan_at  INTEGER,
  last_error    TEXT
);

CREATE TABLE scan_entries (
  uri              TEXT PRIMARY KEY,
  specified_dir_id TEXT NOT NULL REFERENCES scan_specified_dirs(id) ON DELETE CASCADE,
  size             INTEGER NOT NULL,
  mtime            INTEGER NOT NULL,
  track_urn        TEXT REFERENCES tracks(urn) ON DELETE SET NULL,
  status           TEXT NOT NULL,                  -- ok|error|skipped|pending
  error            TEXT,
  scanned_at       INTEGER NOT NULL
);
CREATE INDEX idx_scan_entries_specified_dir ON scan_entries(specified_dir_id, status);
CREATE INDEX idx_scan_entries_track ON scan_entries(track_urn);

CREATE TABLE scan_dropped_files (
  uri      TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
```

`(size, mtime)` 这一对就是增量扫描的判据：文件没变就只花一次 `stat`，再无其他开销（[sources/authoring.md §12](../sources/authoring.md#本地扫描器)）。

`scan_dropped_files` 是"本地曲目都来自指定目录"这条规则的例外：用户拖拽到桌面窗口里的文件是逐个导入的，如果把它们的文件夹设为扫描目录，导入的就会远多于用户拖进来的内容。因此拖放文件**不写** `scan_entries` 行 —— 曲目保留导入器写入的 `available = 1`，任何扫描的核对逻辑都不会碰它 —— 它的 uri 记在这里，桌面桥正是依据这张表（启动时读取、写入时即时生效）把这些文件加进可读白名单。

### 4.6 播放列表与曲库

```sql
CREATE TABLE playlists (
  urn          TEXT PRIMARY KEY,             -- local ones use source id 'local'
  source_id    TEXT REFERENCES sources(id) ON DELETE CASCADE,
  remote_id    TEXT,
  name         TEXT NOT NULL,
  description  TEXT,
  artwork_id   TEXT REFERENCES artworks(id),
  owner        TEXT,
  is_public    INTEGER NOT NULL DEFAULT 0,
  is_smart     INTEGER NOT NULL DEFAULT 0,
  smart_query_json TEXT,                     -- rule tree; see below
  track_count  INTEGER,
  duration_ms  INTEGER,
  revision     INTEGER NOT NULL DEFAULT 0,   -- bumped on every local edit
  remote_revision TEXT,                      -- the source's etag/version, for conflict detection
  sync_state   TEXT NOT NULL DEFAULT 'clean',-- clean|dirty|conflict
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE playlist_items (
  id           TEXT PRIMARY KEY,
  playlist_urn TEXT NOT NULL REFERENCES playlists(urn) ON DELETE CASCADE,
  position     TEXT NOT NULL,                -- fractional index; see below
  track_urn    TEXT NOT NULL,
  added_at     INTEGER NOT NULL,
  added_by     TEXT,
  note         TEXT
);
CREATE INDEX idx_playlist_items ON playlist_items(playlist_urn, position);
```

**`position` 是小数序索引（LexoRank 风格的字符串），不是整数。** 在 5,000 首曲目的播放列表中移动一首曲目，恰好只写一行 —— 一个严格落在其相邻两项之间的新键 —— 而不是把它之后的所有项重新编号。整数序号会让拖拽重排变成 O(n) 次写，在手机上慢得肉眼可见，还会产生庞大的同步增量。当键的长度超过阈值时，才会执行一次罕见的重平衡（rebalance）。

**智能播放列表**存储的是一棵规则树，在查询时才编译为 SQL：

```ts
export type SmartRule =
  | { op: 'and' | 'or'; rules: SmartRule[] }
  | { op: 'not'; rule: SmartRule }
  | { field: SmartField; cmp: 'eq'|'neq'|'gt'|'lt'|'contains'|'startsWith'|'inLast'; value: string | number }

export type SmartField =
  | 'title' | 'artist' | 'album' | 'genre' | 'year' | 'bpm' | 'durationMs'
  | 'playCount' | 'skipCount' | 'lastPlayedAt' | 'addedAt' | 'rating' | 'loved'
  | 'hasBinding' | 'sourceId' | 'quality'

export interface SmartPlaylist { rules: SmartRule; limit?: number; orderBy?: SmartField; desc?: boolean }
```

编译目标**只允许是参数化 SQL** —— 字段名通过固定的允许清单映射，值始终作为绑定参数。来自插件或导入播放列表的规则树都属于不可信输入。

```sql
CREATE TABLE library_items (
  urn         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- track|album|artist|playlist
  source_id   TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort_key    TEXT
);
CREATE INDEX idx_library_kind ON library_items(kind, added_at DESC);

CREATE TABLE collections (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  urn           TEXT NOT NULL,
  position      TEXT NOT NULL,
  PRIMARY KEY (collection_id, urn)
);

CREATE TABLE library_profile (
  id   TEXT PRIMARY KEY,                -- UUID,首次运行时生成一次
  name TEXT NOT NULL                    -- 默认 'Mine',可在设置中修改
);
```

**`ctx.library`（`plugin-library`）拥有全部五张表。** 它是迁移逻辑之外唯一的写入口，视图包调用它而不是直接触碰 `ctx.db`（MD-3，[UI 架构](../ui/architecture.md)）。

```ts
interface LibraryService {
  // 收藏夹 —— library_items
  isSaved(urn: string): Promise<boolean>
  setSaved(urn: string, saved: boolean): Promise<void>
  listSaved(kind?: SavedKind, page?: PageRequest): Promise<Paged<LibraryEntry>>
  setPinned(urn: string, pinned: boolean): Promise<void>

  // 播放列表 —— playlists + playlist_items
  listPlaylists(page?: PageRequest): Promise<Paged<Playlist>>
  getPlaylist(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined>
  createPlaylist(name: string, opts?: { description?: string; smart?: SmartPlaylist }): Promise<Playlist>
  updatePlaylist(urn: string, patch: { name?: string; description?: string | null; artworkUrl?: string | null }): Promise<void>
  deletePlaylist(urn: string): Promise<void>
  addTracks(urn: string, trackUrns: readonly string[], opts?: { at?: number }): Promise<number>
  removeItems(urn: string, itemIds: readonly string[]): Promise<void>
  moveItem(urn: string, itemId: string, toIndex: number): Promise<void>
  setSmartQuery(urn: string, query: SmartPlaylist): Promise<void>

  // 集合 —— collections + collection_items
  listCollections(): Promise<readonly Collection[]>
  createCollection(name: string, opts?: { parentId?: string }): Promise<Collection>
  renameCollection(id: string, name: string): Promise<void>
  moveCollection?(id: string, parentId: string | null): Promise<void>
  deleteCollection(id: string): Promise<void>
  listCollectionItems(id: string, page?: PageRequest): Promise<Paged<CollectionItem>>
  addToCollection(id: string, urns: readonly string[]): Promise<number>
  removeFromCollection(id: string, urns: readonly string[]): Promise<void>

  // 资料 —— library_profile (单行记录)
  getProfile(): Promise<UserProfile>
  updateProfile(patch: { name?: string }): Promise<UserProfile>
}
```

**智能**播放列表的 `PlaylistDetail.items` 在读取时根据规则树即时解析，并且是只读的：`id` 即为曲目 URN，对其调用条目修改操作将拒绝并抛出错误码为 `smart-playlist` 的 `LibraryError`。普通播放列表的 `track_count` 和 `duration_ms` 与其条目行在同一个事务中重新计算，确保派生列始终一致。`setSaved` 是幂等的 —— 保存已保存过的 URN 会保留其原始 `added_at`，防止另一个界面重复保存时静默重排列表。

该服务在收藏与歌单编辑时广播 `library/changed(kind, urns)`，在集合变更时广播 `library/collections-changed()`：集合没有 URN 和 `UrnKind`，若折叠进 `library/changed` 会迫使它传递指向其他实体的类型。`library/profile-changed` 则在本地用户改名时触发。

**本地用户（`library_profile`）只有一行**，由 `plugin-library` 在首次运行时播种（带有 UUID id，默认名称为 `Mine`），可在设置中编辑（`updateProfile` 拒绝空名称并广播 `library/profile-changed`）。它不保存歌单级字段：创建的所有歌单都将*当前*资料名称展示为其创建者，改名后全库即时同步 —— 而自带 `owner` 的歌单（来自远端源）仍展示其自有所有者。出于同样的"启动永不为空"原则，曲库首次运行时还会播种一个名为「我的歌单」的默认歌单，且仅在曲库完全没有歌单时才会重新播种。

集合（Collection）是用于容纳集合级实体（歌单、专辑、艺术家及子集合）的组织容器。集合**不能**直接容纳单首曲目；曲目专属归属于歌单或专辑。`addToCollection` 会校验实体类型，并拒绝任何带有 `track` 的 URN，抛出错误码为 `invalid-urn` 的 `LibraryError`。

### 4.7 播放

```sql
CREATE TABLE queue_items (
  id                  TEXT PRIMARY KEY,
  position            TEXT NOT NULL,          -- fractional index, as playlists
  track_urn           TEXT NOT NULL,
  source_context_json TEXT,                   -- QueueItem['sourceContext']
  added_by            TEXT NOT NULL,          -- user|autoplay|radio
  added_at            INTEGER NOT NULL
);
CREATE INDEX idx_queue_position ON queue_items(position);

CREATE TABLE playback_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),   -- singleton
  current_item_id  TEXT REFERENCES queue_items(id) ON DELETE SET NULL,
  position_ms      INTEGER NOT NULL DEFAULT 0,
  repeat_mode      TEXT NOT NULL DEFAULT 'off',
  shuffle          INTEGER NOT NULL DEFAULT 0,
  shuffle_seed     INTEGER,                   -- stable permutation; 参见 [audio/playback.md §2](../audio/playback.md#播放控制状态机)
  volume           REAL NOT NULL DEFAULT 1.0,
  muted            INTEGER NOT NULL DEFAULT 0,
  output_device_id TEXT,
  device_id        TEXT NOT NULL,             -- which device wrote this; for future sync
  updated_at       INTEGER NOT NULL
);

CREATE TABLE play_history (
  id             TEXT PRIMARY KEY,
  track_urn      TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  ms_played      INTEGER NOT NULL DEFAULT 0,
  completed      INTEGER NOT NULL DEFAULT 0,  -- reached the end
  skipped        INTEGER NOT NULL DEFAULT 0,
  source_json    TEXT,
  device_id      TEXT,
  scrobble_state TEXT NOT NULL DEFAULT 'none' -- none|pending|sent|failed
);
CREATE INDEX idx_history_track ON play_history(track_urn, started_at DESC);
CREATE INDEX idx_history_time ON play_history(started_at DESC);
CREATE INDEX idx_history_scrobble ON play_history(scrobble_state) WHERE scrobble_state = 'pending';

CREATE TABLE track_stats (
  urn            TEXT PRIMARY KEY,
  play_count     INTEGER NOT NULL DEFAULT 0,
  skip_count     INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER,
  rating         INTEGER,                     -- 0..5, NULL = unrated
  loved          INTEGER NOT NULL DEFAULT 0
);
```

`play_history` 是只追加的事实来源；`track_stats` 是派生缓存，与历史插入在同一事务中更新。`loved`（0/1）记录曲目是否被标记为用户喜爱，通过 `ctx.sources.setLoved(urn, loved)` 切换，并通过 `CatalogQuery.onlyLoved` 查询，用以驱动默认的"收藏"曲库。两者都保留意味着"最常播放"只需一次带索引的读取，而原始记录仍可用于重新计算 —— `scrobble_state` 还为离线 scrobble 提供了一个持久的发件箱（outbox），即使提交中途进程被杀也能存活。

### 4.8 下载

```sql
CREATE TABLE download_tasks (
  id            TEXT PRIMARY KEY,
  track_urn     TEXT NOT NULL,
  target_uri    TEXT NOT NULL,
  state         TEXT NOT NULL,                -- queued|running|paused|done|failed|canceled
  quality       TEXT,
  bytes_done    INTEGER NOT NULL DEFAULT 0,
  bytes_total   INTEGER,
  etag          TEXT,
  resume_token  TEXT,
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  binding_id    TEXT REFERENCES media_bindings(id) ON DELETE SET NULL,
  policy_id     TEXT REFERENCES download_policies(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_downloads_state ON download_tasks(state, priority DESC, created_at);
CREATE UNIQUE INDEX idx_downloads_track ON download_tasks(track_urn) WHERE state != 'done';

CREATE TABLE download_policies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  scope_json     TEXT NOT NULL,               -- SmartRule: what to auto-download
  quality        TEXT NOT NULL,
  wifi_only      INTEGER NOT NULL DEFAULT 1,
  max_bytes      INTEGER,
  charging_only  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
```

`bytes_done` 与 `resume_token` 在**每个分块**写完后立即落盘，而不是等任务完成 —— 正是这一点让 [architecture/layers.md §4](../architecture/layers.md#4-后台意味着什么) 中的移动端挂起模型变得可存活。启动时，被遗留在 `running` 状态的任务会重置为 `queued`；它们从 `bytes_done` 处用 `Range` 请求续传，并先校验 `etag`，这样远端文件一旦变化就干净地重新开始，而不是拼出一段损坏的数据。

这条部分唯一索引保证每首曲目至多有一个活动任务，又不妨碍日后的重新下载。

### 4.9 DSP 与设置

```sql
CREATE TABLE effect_chains (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  scope      TEXT NOT NULL DEFAULT 'global',  -- global|output:<id>|source:<sourceId>
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_chain_active ON effect_chains(scope) WHERE is_active = 1;

CREATE TABLE effect_nodes (
  chain_id    TEXT NOT NULL REFERENCES effect_chains(id) ON DELETE CASCADE,
  effect_id   TEXT NOT NULL,                  -- EffectDefinition.id
  ordinal     INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  params_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (chain_id, effect_id)
);
CREATE INDEX idx_effect_order ON effect_nodes(chain_id, ordinal);

CREATE TABLE presets (
  id        TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  params_json TEXT NOT NULL,
  builtin   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key        TEXT NOT NULL,                   -- 'plugin:@BBeBee/plugin-player/crossfadeMs'
  scope      TEXT NOT NULL DEFAULT 'global',  -- global|device|profile
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, scope)
);
```

设置键按插件 id 做了命名空间隔离，两个插件因此不可能互相冲突；`scope` 则区分应当跟随用户的（`global`）与真正属于单机的（`device`）—— 输出设备的选择就不应同步到手机上。

> **实现说明：** 虽然 `settings`、`effect_chains`、`effect_nodes` 和 `presets` 在文档中定义了 schema，但运行时用户设置实际持久化在 `ctx.store` 中（在桌面端由 `core-store-fs` 驱动，移动端由 AsyncStorage/内存驱动）。音频 DSP 效果链配置与均衡器预设同样作为序列化 JSON 持久化在 `ctx.store` 键（`dsp:chains`、`dsp:presets`）中，确保轻量级设置 I/O 不干扰关系型数据库事务。

### 4.10 插件

```sql
CREATE TABLE plugin_records (
  id           TEXT PRIMARY KEY,              -- package id
  version      TEXT NOT NULL,
  source       TEXT NOT NULL,                 -- bundled|local|registry
  enabled      INTEGER NOT NULL DEFAULT 1,
  config_json  TEXT,
  install_uri  TEXT,
  integrity    TEXT,                          -- sha256 of the loaded bundle
  installed_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_error   TEXT,
  fail_count   INTEGER NOT NULL DEFAULT 0     -- 2 consecutive → quarantine ([plugins/loading.md §6.2](../plugins/loading.md#62-桌面端的附加设计--plugin-loader-dynamic))
);

CREATE TABLE capability_grants (
  plugin_id  TEXT NOT NULL REFERENCES plugin_records(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,                   -- 'net:host/*.example.com'
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL DEFAULT 'user',    -- user|bundled
  PRIMARY KEY (plugin_id, capability)
);
```

### 4.11 歌词与缓存

```sql
CREATE TABLE lyrics (
  track_urn   TEXT NOT NULL,
  source_id   TEXT NOT NULL,                  -- which source provided them
  format      TEXT NOT NULL,                  -- lrc|ttml|plain
  content     TEXT NOT NULL,
  synced      INTEGER NOT NULL DEFAULT 0,
  offset_ms   INTEGER NOT NULL DEFAULT 0,     -- user-adjustable timing nudge
  language    TEXT,
  is_preferred INTEGER NOT NULL DEFAULT 0,    -- user's pick when several exist
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (track_urn, source_id, language)
);

CREATE TABLE cache_entries (
  key            TEXT PRIMARY KEY,            -- 'artwork:<id>@512', 'http:<sha256>'
  class          TEXT NOT NULL,               -- artwork|http|stream|codec
  uri            TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL,
  expires_at     INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_cache_evict ON cache_entries(class, last_access_at);
```

淘汰是**类内 LRU**，每一类有各自的配额，因为不同类的价值差别极大：淘汰一张封面图意味着一次重新抓取和一次可见的闪烁；淘汰一段下载了一半的流，用户就会丢失播放位置。默认值 —— 封面图桌面端 512 MB / 移动端 128 MB、HTTP 64 MB、流缓存 1 GB / 256 MB —— 全部可由用户调整。首次清理扫描延迟至启动后 5 秒以后台任务运行（避免冷启动时的磁盘 I/O 争抢），此后每小时运行一次；文件已丢失的 `cache_entries` 行在同一轮清理中被剪除。用户主动下载的文件则记录在 `media_bindings` 行中（[§4.5](#45-媒体绑定本地文件与下载)），绝不被自动淘汰。

### 4.12 遗留：providers

```sql
CREATE TABLE providers (
  instance_id       TEXT PRIMARY KEY,
  plugin_id         TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER
);
```

迁移 v1 中的历史表，已在迁移 v3 中被彻底移除（`DROP TABLE providers`）—— 当音源从插件形式转变为导入文档模型时（ADR-5）。在当前数据库版本中，`sources` 和 `source_vars` 完全取代了该表。

---

## 7. 运行时类型（从不持久化）

刻意保持瞬态。持久化其中任何一个，只会带来数据陈旧类的 bug，毫无好处。

| 类型 | 定义于 | 为何留在内存中 |
|---|---|---|
| `StreamHandle` | [runtime.md §6](../sources/runtime.md#6-流解析) | 频繁过期；必须重新解析，绝不信任来自存储的副本 |
| `TransportState` | [playback.md §2](../audio/playback.md#2-ctxplayer--播放控制与队列) | 活的；只有持久化的子集落入 `playback_state` |
| `Capabilities` | [rule-engines.md §1.3](../sources/rule-engines.md#13-能力是推导出来的不是声明出来的) | 由音源文档的规则块计算得出。缓存在 `sources.capabilities_json` 中，纯粹是为了在音源连接之前 UI 也能渲染 |
| `Paged<T>`、游标 | [rule-engines.md §4.3](../sources/rule-engines.md#43-分页限流与缓存) | 不透明且归音源所有；会话结束便无意义 |
| `TraceEvent` | [authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源) | 调试追踪记录的是对某个活后端的一次运行；把它存下来，等于把某个没人会问第二遍的问题的、已脱敏的答案永久保存 |
| `EffectSegment` | [dsp.md §3](../audio/dsp.md#3-ctxdsp--效果链) | 活的 `AudioNode`。只有 `params_json` 会持久化 |
| `AuthStatus` | [runtime.md §5](../sources/runtime.md#5-认证与会话) | 登录时重新计算；`accounts` 只保留持久摘要 |

---

