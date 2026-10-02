# @BBeBee/plugin-sources-ui-desktop

Layer 5（ui）— `plugin-sources`（headless）的桌面视图包：布局、手势与事件接线，别无其他。

## 概述

把 headless 贡献的 4 个视图 id（`SOURCES_VIEWS`）绑到桌面 kit 组件上。全部领域状态来自 `@BBeBee/plugin-sources/hooks`；服务经注入的 `ctx.sources` 访问；对 headless 包只有 devDependency（类型/常量/测试用）——不是运行时 import，符合"Layer 5 对 Layer 4 仅 types"的规则。

> 专辑页已拆到 `plugin-album-ui-desktop`（`album.view`）。本包只保留库/搜索/源列表/导入/测试五屏；库与搜索屏导航专辑时从 `@BBeBee/plugin-album/views` 取 route id（`ALBUM_VIEWS.album`）。

**共同纪律**（文件头注释）：loading / empty / failed 三态必须区分——混同会让用户面对一块空白而不知是没扫完还是读库失败。`Pending`（`EmptyState`）与 `Failed`（⚠ + 错误信息 + "Try again" 重试）是这条纪律的实现。

## 源文件

### `src/index.tsx`

**注册的视图**（`apply` 经 generator effect `yield ctx.ui.registerView(...)`，fiber 名 `'sources-ui-desktop'`）：

| id | 组件 |
|---|---|
| `sources.search` | `SearchScreen` |
| `sources.settings` | `SourcesListScreen` |
| `sources.import` | `ImportScreen` |
| `sources.test` | `TestScreen` |
| `sources.recommend` | `RecommendScreen` |
| `sources.recommendAll` | `RecommendAllScreen` |

全部视图均注册在 `apply` 中，按需导航加载。

**各屏幕**：

- **`AlbumScreen`** — 已迁至 `plugin-album-ui-desktop`（`album.view`）；库与搜索屏只负责导航到该 route id。
- **`ImportScreen`** — 粘贴源字符串（单个文档或整个 set）。本屏存在的理由：论坛粘贴来的 set 是不透明的，"静默加进 11 个源"的导入是用户无法撤销的，所以**按按钮之前就要点名将会导入什么**。`useSourceImport`（输入即解析的 `preview`、每次提交的**全部** `issues`、`busy`/`report`/`submit`/`reset`）→ 多行 `TextField`（`rows: 14`，placeholder 含 `ruleStream`）→ 预览块（`aria-label='What will be imported'`，"N source(s)" + 名字列表）→ `Import` 按钮（`disabled: busy || !preview`）+ `Clear` → 结果行 `summariseImport(report)`："N added, N updated, N unchanged, N rejected"，**永不为空字符串**（"nothing to import" 也要说出来，否则读起来像按钮没工作）。
- **`SearchScreen`** — 跨源搜索。hero 态：搜索条在顶部、源开关垂直居中；提交后两者收缩到顶部，剩余高度给结果。状态全部来自 headless：`useSearchSourceSelection`（**排除式**选择——所有可搜索的源默认选中，后导入的源自动加入下一次搜索）、`useSourceSearch`（`searchAll`，generation 防后发结果被先发覆盖）、`searchResultRows`（摊平成单条虚拟 `List`：每源 header + track/album/artist/playlist 行）。每个源的失败、超时、无结果都保留自己的 header（`entry.error.message` / "still searching…" / "no matches · N ms"）；track 行点击走 `playFromList`（本段队列 + `{ kind: 'search', label }` 语境），专辑行导航 `/album/:urn`。Clear 回到 hero；搜索框为空或一个源都没选时 Search 禁用。
- **`TestScreen({ sourceId })`** — 单源逐能力测试（docs/06 §10）。桌面用原生 `<select>` 选源；每个测试区只在 provider 的派生能力/方法存在时出现——Search（`capabilities.search.tracks`）、Browse、Album/Artist/Playlist/Lyrics（方法存在）、Library list（`capabilities.library.read`）、Stream（有 provider 即有，质量选项来自 `capabilities.streaming.qualities`），外加两个与文档无关的探针：经源自身 client 发 HTTP（GET/POST、URL、headers JSON、body）与脚本（文档函数在作用域内，code + args JSON）。所有运行流进右栏 `TraceList`（`<ol aria-live="polite">`、mono 字体、每条左侧 3px 色条）：`http` → `METHOD url → status (Nms)`（**status 0 显式写成 "no response"**）、`error` → `✗`、`result` → `✓`、`log` → `·`，`value` 事件用 `JsonTree`（解析失败则原样文本）。左栏 440px 独立滚动，未跑过显示 "No trace yet"。**包括成功的每一步都显示**——失败通常发生在空结果往前两步；数据已在上游 redacted，这里只排版。
- **`RecommendScreen`** — 推荐流主屏。顶部展示两行个人动态专辑货架（"最近播放 · 专辑"由 `useRecentPlayedAlbums` 读取最近 20 首去重播放记录所在专辑；"收藏随选 · 专辑"由 `useFavoriteAlbums` 随机抽取 20 首收藏歌曲所在专辑），之后动态渲染各支持推荐能力的第三方源歌单货架（`RecommendShelf`，每源提供"显示全部"跳至 `RecommendAllScreen`）。货架通用组件 `RecommendShelfRow` 实现两端内收的弧形封面轮播（bent-ends carousel：仅当前可见最左与最右卡片呈 `perspective + rotateY(±22deg)` 3D 向内弯曲并辅以圆柱光影渐变，到达第一张或最后一张时自动取消对应侧的翻折与箭头，外层设 `overflowY: 'hidden'` 防止劫持页面垂直滚动，鼠标悬浮时 ❮ / ❯ 磨砂玻璃大按钮平滑淡入）。
- **`RecommendAllScreen({ sourceId, name })`** — 单源推荐全量网格屏（瀑布流）。将该源的推荐条目排布为响应式卡片网格，底部支持分页加载。

**`bound(ctx, Screen)`** — 绑定到**本插件**的 context 而非 shell 的（shell 渲染视图用的是 `app.ready(['ui'])` 的 context，读 `ctx.sources` 会抛 `cannot get property … without inject`）；必须 `h(Screen, …)` 而非 `Screen(…)`——函数调用会把子组件的 hooks 拼进父组件的 hook 链表。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library，**对真实 `ctx.sources` 渲染而非 mock**——值得钉住的是交互语义（粘贴后提交前显示什么、坏文档给用户留下什么）。harness：真实 `FsNode`/`DbNode(':memory:')`/`sourcesPlugin`，然后从**包自己的 `inject` 派生** scoped context（两者不会漂移）。23 个用例：

1. **Import（4）**——预览先于写入（`sources` 仍为 0）、空输入禁用、导入成功报 "1 added"、坏粘贴**保留输入 + 一次给出全部问题**；
2. **Test（3）**——测试区随 provider 的能力/方法出现且不多不少、选择器默认第一源、未跑 trace 显示 "No trace yet"；
3. **Search（6）**——搜索前只有搜索条与源开关（没有空结果屏）、每源一个独立 section（标题、"1 track"、track 标题）、失败源报错且其余源照常显示、被 toggle 关掉的源不会被问、单曲/艺人过滤透传、外部参数唤醒联动；
4. **SourcesList（3）**——源开关切换与响应、确认删除对话框保护、本地源文件夹管理；
5. **RecommendScreen（5）**——单源推荐流渲染、无效资源占位符防御、无推荐空状态、最近播放专辑推荐行置顶渲染、收藏随选专辑推荐行置顶渲染；
6. **RecommendShelfRow（1）**——两端内收弧形卡片弯曲、边界卡片平整恢复、悬浮大箭头交互与滚动联动；
7. **RecommendAllScreen（1）**——全量网格排布与触底加载。

## 相关文档

- `docs/08-ui-architecture.md`：descriptors、双壳、渲染规则
- `packages/feature/plugin-sources/README.md`：headless 侧的 hooks 与视图 id
- `packages/ui/plugin-sources-ui-mobile/README.md`：孪生半边
