# @BBeBee/plugin-sources

Layer 4（feature）— `ctx.sources`：导入的源文档、provider 注册表、目录缓存与统一目录读面。

## 概述

`MediaProvider` 是**内部接口、恰好两个实现**（`plugin-source-runtime` 的 per-source adapter 与 `plugin-source-local`），不是扩展点——仓库之外的人写的是源文档，不是 provider。数据流向：**runtime/local 调用 `register()` 提供答案；本包存答案**（docs/06 §1）。

它同时拥有"源管理"（导入/启停/删除源文档）与"目录"（缓存远端数据、FTS 搜索、跨源链接），并把两者合成为 shell 唯一读目录的入口。

## 服务声明

- `class Sources extends Service implements SourcesService` → `ctx.sources`。
- 必需注入：`['db']`；可选（嵌套 `ctx.inject`）：`['ui']`（贡献 route/settings 描述符）。
- 能力声明：`db:read:core`、`db:write:core`。**本包不调用 `ctx.db.defineSchema`**——它写的表全部由 kernel 的 core 迁移声明（v1 建表、v2 加 FTS5、v3 是 ADR-5 的 `providers`→`sources` 迁移）。

## 源文件

### `src/index.ts` — SourcesService（1091 行，最大文件）

| 成员 | 作用 |
|---|---|
| `import(input)` | 导入/更新源文档：`parseSourceInput` 解析 → `validateDocument` 校验 → 按 `sourceUrl` 去重（同 id = update）。emit `source/imported`（**每批一次**，added+changed 一起发曾导致 runtime 停启两次）。 |
| `remove(id, { forgetCatalogue? })` | 见 `store.ts` 的两种模式。emit `source/removed`。 |
| `setEnabled(id, on)` | 启停。emit `source/changed`。 |
| `register(provider) / unregister` | provider 注册表。emit `source/registered` / `source/unregistered`（disposer 做身份校验——防旧 disposer 拆掉新注册）。 |
| `providers / forUrn(urn)` | 活 provider 列表 / 按 URN 找 provider。 |
| `searchAll(q, opts)` | 跨源扇出：每个被问到的源（含失败、超时）各一条 entry，绝不合并、绝不整体失败——"三家答了、一家限流、一家要重导"必须能说出来。 |
| `searchSource(sourceId, q, page?, opts?)` | 单源分页搜索：仅向指定音源请求检索并支持 `page` 分页，结果同步写入目录缓存。供分面板搜索视图执行单源“加载更多”下一页数据。 |
| `searchLocal(text, opts)` | 目录内 FTS5，离线即时；与 `searchAll` 回答的是不同问题。 |
| `cache(providers, results)` | 把 provider 返回的搜索/browse 结果写入目录表（经 `CacheWriter` holder 委托 `cache.ts`——见下），随后 emit `library/changed(kind, urns)`——只对实际写入的 URN。 |
| `getAlbum / getArtist / getTracks / tracksOf…` | 目录 hydrate（credits、封面、分页）。 |
| `readVars / writeVar / clearVars` | `source_vars` 的读写门——runtime 的变量提前于注册加载，否则 `auth.status` 首帧错报 anonymous。 |
| `debug(sourceId, step)` | 委托给对应 provider 的 `debug()`——规则追踪。 |
| `check(sourceId)` | 存活检查，emit `source/checked`。 |

所有 post-commit 路径上的 emit 经 `safeEmit` 包裹：listener 抛错只 warn，绝不丢掉已等待的报告。

### `src/catalog.ts` — 目录读面

`Catalog` 类 + `ftsQuery`：FTS5 查询构造（`SEARCHABLE_KINDS`）、分页目录读（tracks/albums/artists，join `track_stats` 排序"最常播放"）、`index(urns)` 把 track 写进 `tracks_fts`（经 `tracks_fts_map` 桥接 urn↔rowid；先删 map 会永久搁浅索引行）。监听 `library/changed`（init 返回值，`kind === 'track'` 时 `index(urns)`）——scanner 与 runtime 缓存路径都触发它。

### `src/cache.ts` — 缓存写入

`cacheEntities`：把 provider 返回的纯数据 upsert 进 `tracks`/`albums`/`artists`/`track_artists`/`artworks`/`external_ids`。**payload 存进 `tracks.raw_json`/`albums.raw_json`**——这是 `ruleStream` 能在几小时后、甚至离线于当初搜索的情况下工作的原因（不重跑搜索，直接读当初存的原始 payload）。`MAX_PAYLOAD_BYTES` 封顶单个 payload。

`CacheWriter`：持有 init 时捕获的 db handle 的**普通 holder**（与 `Catalog`、`SourceStore` 同理），`Sources.cache()` 经它写入/链接。⚠️ 不能直接用 `Sources.ownDb`：`searchAll` 是从 UI 包的服务代理进来的，方法在**调用方的 context**（无 db 授权）下执行，捕获的 handle 会被重新 shadow 成调用方——写被拒、`cache()` 捕获后只 warn，于是搜索有结果但目录始终为空，队列只能回退显示 URN、播放条没有封面。

### `src/identity.ts` — 源文档的身份、校验与导入

- **`sourceIdFor(sourceUrl)`**：`hostSlug(sourceUrl) + "-" + sha256Hex(sourceUrl)[0..8]`。**派生而非随机**——同一文档重导入产生同一 id，于是重导入是 *update*，URN/缓存行/cookie jar/播放列表引用全部幸存。8 hex（32 bit）区分同 host 不同路径；id 中永不出现 `:`（否则整个 URN 命名空间不可解析）。
- **`validateDocument(value)`**：收集**全部**问题（不逐个报）抛 `SourceFormatError`。要点：`sourceUrl` 必须绝对 http/https 且禁止内嵌凭据；所有规则字段必须是字符串（最常见的作者错误是 `header` 写成对象）；`ruleStream` 是唯一必需块且 `ruleStream.url` 必填；规则块内未知字段拒绝（typo 若放行会表现为"后端变了"）、顶层未知字段保留（前向兼容）；`allowedHosts` 拒绝携带路径/端口（allowlist 是 per-host）。
- **`parseSourceInput(input)`**：容忍 markdown code fence、单对象或数组；`ParsedEntry.text` 保留输入原文切片。
- **导出与 diff**：`APP_MAINTAINED = ['lastUpdated','respondTime','weight']` 导出时剥离（分享不该泄露你的网络速度）；`isShareable` 排除 `bbebee://` 迁移占位行；`changedFields` 按 canonical 值比较（键重排不算变更；`Object.create(null)` 防 `__proto__` 陷阱）。
- **`recordFor(doc)`**：文档→`sources` 行；existing 行的 `enabled` 优先于文档的。
- **`allowedHostsFor(doc)`**：`sourceUrl` 的 host + `allowedHosts`，排序去重。

### `src/links.ts` — track_links：跨源身份

同一首歌在 Navidrome/Jellyfin/本地磁盘是**三行三 URN**，由 `track_links` 关联——绝不合并成一行（码率、可用性不同）。

- **`MERGE_CONFIDENCE = 1`**：低于此值是**提示**（failover 候选、"also available on…"），永不用于静默合并库条目——live 版/重制版共享标题、艺术家、时长。
- **`writeExternalIds`**：存 provider 报告的标识符；归一化（ISRC 去 `-` 大写、UPC 只留数字）+ 形状校验（ISRC `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`、mbid 必须 UUID、拒绝全零占位符——真实后端会产出 `isrc:"???"` 这种垃圾）。
- **`linkTracks(urns)`**：缓存写之后**只对刚写入的 URN**跑（全库重匹配是二次方的）；每 namespace 一条 JOIN（走 `idx_external_lookup`）；`EXACT = [{isrc}, {mbid}]` 命中即 confidence 1.00。
- **`upsertLink`**：`MIN/MAX` 排序用 **SQLite 的 BINARY collation**——JS 的 `<` 比较 UTF-16、SQLite 比较 UTF-8 字节，BMP 之上不一致，曾导致 CHECK 约束拒绝插入、整批丢失 `library/changed`。`manual` 方法永不被自动化降级。
- `linksFor`（双向 UNION）、`linkManually`、`unlink`。

### `src/store.ts` — `SourceStore`：sources 表持久化

- `all()` — 排序返回；单行 `doc_json` 解析失败剔除该行，不拖垮列表。
- `put(record)` — upsert；**`enabled` 刻意不在 UPDATE 列表里**："enabled 是用户的开关，不是文档的"——作者发布更新不能重新启用用户关掉的源。
- `remove(id, { forgetCatalogue })` — `true`：单事务删行，FK cascade 带走 tracks/albums/…，但**按值引用的表必须手动清**（`tracks_fts` → `tracks_fts_map` → `lyrics` → `library_items` → `track_links` → `external_ids`，顺序错了会搁浅 FTS 行、让下一个源的轨道被错误链接）；`false`（默认）：只 `UPDATE … SET enabled = 0`——误触不应丢整个曲库，重新导入也不会重新启用。
- `recordCheck(id, { ok, respondTimeMs?, message? })` — `fail_count` 成功清零失败 +1（连续三次 RuleError 标记 stale，docs/06 §7）。

### `src/hooks.ts` — React hooks（双壳共享）

| Hook | 说明 |
|---|---|
| `useTracks / useAlbums(ctx, query?)` | 分页目录读（`PagedState`）；内部用 **generation 计数**防快速滚动时两页响应 append 出重复页；监听 `library/changed` 触发 reload |
| `useSources(ctx)` / `useLiveSourceIds(ctx)` | 已导入的源 / 已导入+启用但未注册（"starting…" 状态）——两者刻意分开 |
| `useSourceImport(ctx)` | 导入屏；**输入即预览**（parse 是本地纯计算）；rejected 进 issues 而非 throw（否则坏文档"看起来按钮没反应"） |
| `useSourceTrace(ctx, sourceId?)` | 步骤 tracer；事件**到达即追加**（对无响应服务器的诊断就是"一行 http 后面什么都没有"）；generation ref 防新旧 trace 交错 |
| `useSetLoved(ctx)` | 收藏开关；写 `catalog.setLoved`，再 emit `library/changed`。 |
| `useSearchSourceSelection(ctx)` | 搜索屏的源开关：`options`（`searchable` 由 provider 的派生能力决定）+ `selectedIds` + `toggle`/`toggleAll`。**以排除集存储**——后导入的源默认加入下一次搜索，而不是被静默漏掉。 |
| `useSourceSearch(ctx)` | `searchAll` 的屏上形态：`status/text/data/run/reset`；内部维护各音源分页状态（`pagination[sourceId]`: `loading/hasMore/cursor/error`）并暴露 `loadMore(sourceId)`，拉取指定源下一页并无缝追加合并单曲/专辑等结果；generation ref 保证后发搜索不被先发覆盖。 |
| `searchResultRows(result, nameOf)` | 把 `AggregatedSearch` 摊平成单条虚拟列表的行（header/track/album/artist/playlist）——每源的失败/超时/无结果都保留自己的 header；track 行携带本段队列，点击即播。两壳共用，杜绝各画各的 section。 |
| `listAllTracks(ctx, query)` / `playFromList(ctx, urn, list)` | 非 hook 的共享播放逻辑：前者把 query **翻页取全**（"播放这个列表"指整个列表，不是已滚入的页）；后者解析被点行所属的列表（`urns` 在手或 `query` 现取）交给 `player.playFromContext`——队列已有该曲则跳转，没有则整列表换入队列；目录读失败仍播单曲 |

### `src/capabilities.ts` — provider 能力判定

`canSearchProvider(provider)`：`search` 方法存在且派生能力里至少一种搜索类型为真。服务与搜索屏共用这一份判定——两处若漂移，屏上画出的开关就会包含 `searchAll` 静默跳过的源，"没问到"和"没结果"长得一模一样。

### `src/views.ts` — 描述符 id 常量

```ts
SOURCES_VIEWS = { search: 'sources.search', sourceList: 'sources.settings',
                  sourceImport: 'sources.import', sourceTest: 'sources.test' }
SOURCES_ROUTES = { search, sourceImport, sourceTest }   // 同值
```

init 贡献 4 个 descriptor：route `/search`（tab-bar + sidebar，order 1）、settings（section `'sources'`，"Music sources"）、route `/sources/import`、route `/sources/test`。Test 屏把某源的每个能力各给一个测试区，全部流进同一条 trace（docs/06 §10）。

> 原来的 `sources.library`（All/Local/Favorites 的曲库浏览）已删除：库首页由 `plugin-library` 的 `library.home` 承担，同时显示 playlists、albums、collections（合集作为文件夹，其成员可以是 album/playlist/track）。

> 专辑页已拆出为 `plugin-album`（`album.view`）：route/view 与 `useAlbum` 随屏幕一起搬走，目录读 `getAlbum / listAlbums` 仍在本包——读留在写旁边（MD-3）。库与搜索屏导航时从 `@BBeBee/plugin-album/views` 取 route id。

## 事件

| 方向 | 事件 |
|---|---|
| emit | `source/registered`、`source/unregistered`、`source/imported(sourceIds[])`、`source/changed(id, changedFields)`、`source/removed(id, forgotCatalogue)`、`source/checked(id, report)`、`library/changed(kind, urns)` |
| 监听 | `library/changed` → `catalog.index(urns)`（kind 为 track 时） |

## 数据库（core 迁移声明、本包读写）

`sources`（`doc_json` 存 verbatim 原文、`doc_hash`、`enabled`、`allowed_hosts_json`、`fail_count`…）、`source_vars`、`tracks`（`raw_json` 承载 payload）、`albums`、`artists`、`track_artists`、`album_artists`、`artworks`、`external_ids`、`track_links`（`CHECK (urn_a < urn_b)`，BINARY collation）、`tracks_fts`（FTS5，`contentless_delete=1`，`unicode61 remove_diacritics 2`）+ `tracks_fts_map`。约定遵循 docs/07：时间戳 epoch-ms、布尔 0/1、JSON 列 `_json` 后缀、外键 URN TEXT、目录表 `REFERENCES sources(id) ON DELETE CASCADE`。

## 导出

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
// './hooks'：useTracks / useAlbums / useSources / useLiveSourceIds / useSourceImport /
//              useSourceTrace / useSetLoved / useSearchSourceSelection / useSourceSearch /
//              searchResultRows / listAllTracks / playFromList
// './views'：SOURCES_VIEWS / SOURCES_ROUTES
```

## 相关文档

- `docs/06-music-sources.md` §1–§3/§7：SPI、身份、信任、stale 判定
- `docs/07-data-model.md`：URN 与全部表
- 邻居：`plugin-source-runtime/`（provider 的制造者）、`plugin-source-local/`、`plugin-local-scanner/`
