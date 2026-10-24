# 内容注册表（B_Be_Bee-registry）

> **本篇回答的问题。** 应用如何从社区注册表发现、检查并安装第三方内容 —— 音源、歌词源、主题与桌面插件 —— 以及注册表仓库如何接入本 monorepo。

音源是被导入的字符串，不是插件（规范见 [rules/sources.md §1 — What a Source Is](../../rules/sources.md#1-what-a-source-is)（L2））。注册表就是这些字符串 —— 以及另外三类可安装内容 —— 被发布、版本化与审核的策展之地，让用户在"粘贴论坛帖里的任意字符串"之外，有一条第一方的内容获取路径。

---

## 1. 仓库架构

（规范见 [rules/sources.md §6 — Registry](../../rules/sources.md#6-registry第三方注册表)（L2）：registry 仓库定位、四类内容、entry 字段与安装红线归该节；本节讲仓库结构与发现机制。）

注册表内容存放在独立仓库
[BBeBeeX/B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry)。
与包含打包产物的中心化旧模型不同，`B_Be_Bee-registry` 采用**去中心化 DMS 式纯元数据索引模型**：
第三方音源和插件的源码完全托管在开发者自己的 GitHub 仓库中，注册表仅维护纯元数据指针。

```
B_Be_Bee-registry/
├── music-sources/{username}-{name}.json   # 音乐源元数据指针
├── lyric-sources/{username}-{name}.json   # 歌词源元数据指针
├── plugins/{username}-{pluginname}.json   # 插件元数据指针
├── themes/                                # 主题包（内容进仓，格式 v2）
│   ├── {author}-{name}/
│   │   ├── theme.json                     # 包文档：variants[] 运行时主题变体
│   │   └── preview.png                    # 预览图（可选）
│   └── index.json                         # 生成的主题包摘要索引（浏览快速通道）
├── scripts/
│   ├── validate.mjs                       # CI 校验门禁与负向测试套件
│   └── lib/                               # 校验规则与对比度检查模块
├── CONTRIBUTING.md                        # 开发者规范与 Schema 指南
└── MODERATION.md                          # 真实性与防冒名审核标准
```

- **零中心化生成物**：无 `dist/` 编译产物目录，无单一庞大的 `registry.json`。
- **作者仓库产物契约**：
  - 音频源与歌词源：作者仓库托管源码并在仓库根目录下提供单文件 `index.json` 规则文档（例如 [B_Be_Bee-subsonic](https://github.com/BBeBeeX/B_Be_Bee-subsonic) 与 [B_Be_Bee-lrclib](https://github.com/BBeBeeX/B_Be_Bee-lrclib)）。
  - 插件：作者仓库根目录下提供 `index.js` 单文件 bundle 与 `manifest.json` 清单。
  - 主题：直接存放在注册表仓内的 `themes/{author}-{name}/`，无需独立代码仓。
- **远程发现**：客户端通过 GitHub Contents API 并发枚举各目录元数据（§5.1），并由本地 `ctx.store` 缓存。主题浏览另有快速通道：生成的 `themes/index.json` 只携带包摘要（`id`、`name`、`version`、`author`、`description`、`dir`、`variantCount`、`variants: [{ id, name, isDark }]`、`previewColors`），浏览页一次拉取即可渲染，各包的 `downloadUrl` 由 `themes/{dir}/theme.json` 推导；摘要拉取失败时回退到 Contents API 遍历 `themes/` 目录。

---

## 2. 元数据 Schema 格式

（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2）：entry 字段枚举与 version 语义归该节；本表展开每个字段的适用 kind 与含义。）

`music-sources/`、`lyric-sources/` 与 `plugins/` 下的条目均为独立的 `{username}-{name}.json` 文件：

```jsonc
// music-sources/bbebeex-subsonic.json
{
  "id": "subsonic",
  "name": "Subsonic",
  "version": "1.0.0",
  "author": "BBeBee",
  "description": "Subsonic 兼容自建音源（支持 Navidrome 与 Airsonic）",
  "repo": "https://github.com/BBeBeeX/B_Be_Bee-subsonic"
}
```

| 字段 | 适用类型 | 含义 |
|---|---|---|
| `id` | 全部 | 稳定条目 id。是 `lyric-source` / `theme` / `plugin` 的匹配键（§3）。 |
| `kind` | 全部 | `music-source` \| `lyric-source` \| `theme` \| `plugin`。 |
| `name` | 全部 | 展示名。 |
| `version` | 全部 | 最新发布的 semver —— 内容变更必须 bump；缺失即视为 `0.0.0`，更新检查会跳过（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2））。内置歌词源已经用该字段比对注册表副本是否更新。 |
| `author` | 全部 | 署名，展示在安装对话框。 |
| `description` | 全部 | 列表中展示的一行简介。 |
| `updatedAt` | 全部 | 条目的最后提交日期（ISO 8601），由索引生成器写入。 |
| `downloadUrl` | 全部 | 可安装产物的位置 —— 应用只消费 `dist/` 产物，从不消费条目源码（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2））。 |
| `minAppVersion` | 全部 | 条目所需的最低应用版本（semver）。可选字段；缺失即代表不限制应用版本。UI 侧通过 `minAppVersionBlock` 强校验拦截 —— 当当前运行的应用版本低于此版本时禁用安装并提示具体原因。 |
| `sourceUrl` | music-source | 文档的后端基址 —— 与已安装音源的匹配键（§3）。 |
| `previewUrl` | theme, plugin | 安装对话框的预览图。 |
| `repoUrl` | plugin | 插件作者本人的仓库。 |
| `sha256` | plugin | 插件包的完整性摘要（§5）。 |
| `capabilities` | plugin | 包内 manifest 声明的能力清单。 |
| `category` | plugin | 自由分类 slug（如 `ui-enhancement`），发现页的分类筛选按它分组；未知 slug 原文透传。 |

---

## 3. 匹配语义 —— 什么算"已安装"

（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2）：music-source 以 `sourceUrl` 为匹配键归该节；本节讲每种 kind 为何这样匹配。）

`checkUpdates()` 将索引条目与用户已有内容比对。每类内容使用的身份各不相同，因为它复用该类内容自己的身份：

| 类型 | 匹配键 | 原因 |
|---|---|---|
| `music-source` | `sourceUrl` | `SourceRecord` 的身份就是它的 `sourceUrl` —— 导入去重以它为准（[authoring.md §9](./authoring.md#9-导入更新与分享)）。注册表里两个指向同一后端的条目，对用户而言就是同一个源。 |
| `lyric-source` | `id` | 歌词源以文档 `id` 注册与索引。 |
| `theme` | `id` | 主题以包 `id` 索引（旧式单主题文档以其主题 `id` 索引）。每包写一条锁定记录。 |
| `plugin` | `id` | 插件以 manifest id 索引（`ctx['plugin-manager']`）。 |

已安装副本的版本低于条目 `version` 时产生一条 `RegistryUpdate`（`kind`、`id`、`name`、`installedVersion`、`availableVersion`、`downloadUrl`；当已安装副本是内置内容时附 `builtin: true` —— 今天只有内置 lrclib 歌词源）。

---

## 4. `ctx.contentRegistry` —— 服务

契约位于 `packages/protocol/src/services/registry.ts`：

```ts
export interface RegistryService {
  /** 拉取索引（endpoint 可经 store 覆盖），缓存最近一次成功副本供离线使用。 */
  getIndex(force?: boolean): Promise<RegistryIndex>
  /** 将已安装内容与索引比对；以结果触发 'registry/updates-available'。 */
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  /** 上一次 checkUpdates() 的结果（供角标读取而无需重新拉取）。 */
  updates(): readonly RegistryUpdate[]
  /** 拉取条目的分发文档，返回确认对话框必须展示的信息。 */
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  /** 安装/更新一个条目；调用方已向用户展示详情（hosts / 插件风险）—— 即 rules/sources.md §6 的 allowedHosts 展示红线。 */
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
  /// 组合根注入，使 plugin 类安装能到达桌面动态加载宿主。
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
}
```

> ⚠️ **服务键是 `contentRegistry`，不是 `registry`。** 在 Cordis 4 中，`registry` 这个键属于内核本身 —— 它的插件注册表服务，其方法以 `ctx.plugin` / `ctx.inject` 的形式暴露。内容索引改认领 `contentRegistry`。

**事件。** 每次*完成*的更新检查 —— 自动或手动 —— 都会触发 [`'registry/updates-available'`](../data-model/events.md)，携带完整的更新列表，**包括空列表**。空列表的触发是有意义的：它清掉上一次检查留下的角标。不存在单独的"检查结束"事件。

**持久化**（`ctx.store`）：

| 键 | 内容 |
|---|---|
| `registry.index-cache` | 最近一次成功拉取的索引（`{ fetchedAt, index }`），让列表与更新角标在离线时仍可用。 |
| `registry.prefs` | 用户偏好：`endpoint`（覆盖默认 `registry.json` 地址）与 `lastCheckAt`。 |

**设置。** `AppSettings.registryAutoCheck`（默认 `true`）控制自动检查：启动约 45 秒后首次运行，此后每 24 小时一次。手动检查不受影响。

**诊断。** `RegistryService` 另有两个*可选*方法 `getDiagnostics?()` 与 `rescanEntry?(entryId)` —— 未实现它们的旧实现/stub 依然合法，调用方须用可选链。`getDiagnostics()` 按四个严重度分组组装 `RegistryDiagnosticsReport`，每一项都来自真实服务状态（不编造数据，没有数据源的分组保持为空）：

- **冲突（conflicts）** —— 锁记录存在但内容已不在本机（`lock-orphan:*`）；已安装内容与索引条目匹配却缺少锁记录（`lock-missing:*`，内置歌词源豁免）；索引清洗捕获的重复 id（`duplicate-id:*`）；已记录的 manifest 与注册表能力声明不一致（`cap-mismatch:*`）；已安装插件声明的依赖未安装（`deps-unmet:*`）。
- **风险（risks）** —— 持久化的逐条目安全审计 findings：`fetchEntryDetails` 将扫描结果存入 store 键 `registry.audit-findings`（仅保留 block/warn；通过则删除记录），不再用完即弃。
- **警告（warnings）** —— 索引元数据异常（丢弃条目数、重复 id）、最近一次索引拉取失败、GitHub 下载线路全部不可用（由下载层记录），以及拉取持续失败时超过 24 小时的索引缓存。
- **信息（info）** —— 锁记录摘要与按类型的已安装版本一览。

`rescanEntry(entryId)` 在缓存索引中查找该条目，重跑 `fetchEntryDetails`（含静态安全扫描）并刷新存储的 findings / 能力不一致记录。它只做检测 —— 不安装任何内容，因此安装阶段的 `confirmed` 门禁在此不生效。

**任务中心。** `RegistryService` 还可选携带 `getTasks?()` 与 `clearFinishedTasks?()`，以及 `'registry/tasks-changed'` 事件（每次变更后以完整快照、新 → 旧触发）。每一次用户可见的安装/更新都会被记录为一个 `RegistryTask`，沿生命周期 `pending → running → success | failed` 流转，依次经过 `download → verify → install` 三个阶段；确认弹窗打开期间任务停留在 `pending`（"等待确认"）。任务仅存于内存 —— 进行中的记录加上最近 50 条已完成的记录 —— 不做持久化；`clearFinishedTasks` 只清除已完成的记录。

---

## 5. 安装流程、作者仓库制品链与安全体系

注册表建立了一套覆盖发现、下载、静态安全审计、确认对话框与召回（封禁/下架）的完整安全门禁体系：

安装链路的每个阶段（下载/校验/安装）在执行时向任务中心（§4）上报；诊断重扫（`rescanEntry`）走相同的拉取路径但不上报。

### 5.1 GitHub Contents API 多目录发现机制

`getIndex()` 不再单纯读取单个 `registry.json`，而是通过 GitHub Contents API 枚举 4 个分类目录：
- `music-sources/`
- `lyric-sources/`
- `plugins/`
- `themes/` —— 先走快速通道：生成的 `themes/index.json`（§1）一次拉取即得全部包摘要并跳过目录遍历；仅当该拉取失败时才回退为遍历 `themes/`。

各目录条目经解析与合法性清洗后聚合为统一索引。若网络或接口故障，服务会先回退到传统单一 `registry.json`，最后回退至本地 store 离线缓存（`registry.index-cache`），确保断网下仍可查看已缓存内容。

### 5.2 作者仓库制品链

针对第三方插件及作者独立仓库：
1. **解析提交**：请求 `https://api.github.com/repos/{owner}/{repo}/commits/HEAD` 解析不可变的 HEAD 提交 SHA。
2. **下载制品**：严格基于该 commit 钉定版本下载根目录 `manifest.json` 与 `index.js`（或 `index.json`）。
3. **能力一致性校验**：严格比对 `manifest.json` 中声明的能力（capabilities）与注册表元数据。若 manifest 申请了未在注册表声明的能力或遗漏了声明能力，立即拒绝安装。

### 5.3 静态安全审计（`ctx.securityAudit`）

内置 `@BBeBee/plugin-security-audit` 插件（Layer 4）转出 `packages/feature/toolkit` 中的扫描器（`scanCode`）。它先跑 **9 条静态正则规则**，再做 **2 组动态扫描** —— 合计 14 个 rule id。告警策略（2026-10-24）：只有不透明载荷导入与泄露凭证会阻断安装，其余只警告 —— 这些正则只是评审辅助，不是隔离手段，打包后的生产代码也常常触发它们。

静态规则（正则；每处命中记一条 finding）：

- `eval-function-constructor` —— `eval()`、`new Function()`、`window/globalThis.eval()`（warn）。
- `dynamic-code-execution` —— 字符串代码形态的 `setTimeout`/`setInterval`、`vm.runIn*` / `new vm.Script`、`require('vm')`（warn）。
- `credential-private-key` —— `-----BEGIN … PRIVATE KEY-----` 私钥块（block）。
- `credential-api-token` —— 高风险平台令牌（`ghp_…`、`github_pat_…`、`AKIA…`、`sk-…`）（block）。
- `credential-generic-secret` —— 赋给 `api_key` / `secret_key` / `private_key` / `auth_token` 这类键的长字面量（warn）。
- `prototype-pollution` —— 对 `__proto__`、`Object.prototype`、`constructor.prototype` 的改写（warn）。
- `remote-dynamic-import` —— 指向远端 URL 或不确定目标的动态 `import()`（block）。
- `data-blob-dynamic-import` —— 字面量 `data:`/`blob:` 载荷的动态 `import()`，没有主机可供出站规则判断（block）。
- `obfuscation-packer` —— 已知 JS packer / 混淆器包装特征（`eval(function(p,a,c,k,e,d/r)…`）（warn）。

动态扫描组：

- **未声明出站** —— `undeclared-host-egress`：代码中的 URL 字面量，其主机不在条目声明的 `allowedHosts` 内（warn；真正强制出站的是运行时能力门，不是这条静态启发式）。
- **混淆特征** —— 四个 id：`obfuscation-dense-hex`（密集 `\x` 转义；≥ 3 次 warn，密集 ≥ 6 次同样 warn）、`obfuscation-dense-unicode`（密集 `\u00…` 转义，warn）、`obfuscation-packer-identifiers`（`_0x…` 标识符群，warn）、`high-entropy-string`（40+ 字符字面量中香农熵 ≥ 4.8，warn）。

findings 标记为 `block`（高危）或 `warn`（可疑）。只要存在任何 `block` 级 finding，默认拒绝安装；仅有 `warn` 级 finding 时记日志、安装继续进行，确认按钮也不禁用。

### 5.4 安装前审计确认对话框

在执行安装或更新前，桌面 UI（`packages/ui/plugin-registry-ui-desktop`）弹出 `InstallConfirmDialog`：
- **安全审计报告（Security Audit Report）**：展示审计等级徽标（`通过 (Pass)` / `警告 (Warn)` / `高危风险 (Block)`）并逐条列出发现问题（类别、等级、代码片段、行号）。
- **作者仓库与 Commit**：展示代码仓库直链与 commit SHA。
- **提交差异（Commit Diff）**：更新时展示提交哈希前进差异（如 `a1b2c3d → e4f5g6h`）。
- **阻断门禁（Block Gating）**：审计等级为 `block` 时确认按钮默认禁用 —— 即"用户显式确认高危风险"红线（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2））；桌面 UI 以 `我已知晓高危风险并确认强制安装` 覆写复选框实现它。仅有 `warn` 级 finding 时确认按钮保持可用。

### 5.5 `registry.lock.json` 安装记录管理

- **路径**：App 用户数据目录下的 `registry.lock.json`（同时同步到 `ctx.store` 的 `registry.lock`）。
- **数据格式**：
  ```jsonc
  {
    "version": 1,
    "records": {
      "custom-plugin": {
        "id": "custom-plugin",
        "kind": "plugin",
        "repo": "https://github.com/alice/custom-plugin",
        "commit": "a1b2c3d4e5f67890",
        "sha256": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
        "installedAt": 1775894400000
      }
    }
  }
  ```
- **适用范围**：上述锁记录覆盖音源、歌词源与主题。`kind: "plugin"` 的记录是**历史遗留** —— 由已退役的 GitHub 打包安装流程写入；锁管理器仍会读取它们（安装状态匹配、诊断），但不再写入新的。npm 安装的插件由 plugin-manager 记录在自己的 store（`npm:installed`，仅 tarball `sha256`）中，不在这里。
- **启动时校验（仅召回）**：桌面端动态加载器（`apps/desktop/renderer/dynamic-loader.ts`）在启动时只在记录带有召回标记时隔离插件 —— 注册表封禁（`blocked`）或下架（`delisted`）。原先的启动时篡改比对（重算 SHA-256 与锁比对）已于 2026-10-24 移除。

### 5.6 下载区域与 GitHub 加速

注册表发起的所有 GitHub 请求 —— Contents 目录枚举、commit 解析与全部 raw/api 下载 —— 统一经过一个下载层（`plugin-registry/src/github-fetch.ts`）。每个 URL 会被展开为一条有序候选链：

1. **官方地址** —— 原始 URL，永远第一。
2. **jsDelivr（系统内置）** —— 仅当 URL 形如 `raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` 且 commit 段存在时生成，改写为 `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{commit}/{path}`；`api.github.com` 与其它地址不会生成该候选。
3. **自定义前缀** —— 每条已配置的加速前缀各生成一个候选（gh-proxy 风格：`前缀 + 原始完整 URL`），按用户排序依次尝试；对 raw 与 api 主机均适用。

仅当上一个候选确实失败（传输错误或 HTTP 状态码 ≥ 400）时才切换下一个，绝不投机预判。每次切换都会通过 `ctx.logger` 记录一行（如 `[github-fetch] official failed (403), falling back to jsdelivr: …`），不以 toast 或弹窗打扰用户。非 GitHub 主机的 URL（例如作者自有的 `downloadUrl`）永远只保留官方一个候选，绝不会被改写。

上述行为由两项设置支撑，入口在设置页「网络与代理」标签的「下载与 GitHub 加速」卡片：

| 设置 | 含义 |
|---|---|
| `AppSettings.downloadRegion` | `'global'`（默认）或 `'mainland-china'`，作为偏好存储。当前仅为存储偏好：官方优先规则不变，区域值会出现在下载层日志行中。 |
| `AppSettings.githubAccelerationPrefixes` | 有序的 HTTPS 前缀列表（如 `https://ghproxy.example.com/`），逐一拼接到原始完整 URL 之前；数组顺序即尝试顺序，编辑器在任意变更时上报完整数组，系统内置的 jsDelivr 行不占用该数组。 |

`registry.prefs.endpoint` 覆盖端点（§4）语义保持不变：配置的覆盖端点**本身就是官方候选**，不会被二次加速 —— 只有默认 GitHub 端点才会走完整候选链。

---

## 6. 各类型的安装流程

| 类型 | 流程 |
|---|---|
| `music-source` | 拉取 `dist/` 文档 → `ctx.sources.import(text, { originUri: downloadUrl })`。完整导入管线生效；写入 `registry.lock.json`。 |
| `lyric-source` | 拉取文档/作者仓库 → 形状校验 → 静态安全审计 → `ctx.lyricSources.registerSource(doc)` → 写入 `registry.lock.json`。 |
| `theme` | 拉取包文档 → 形状校验 → 对包内**每个变体**执行 WCAG AA 对比度门禁（任一变体不过门整包拒绝）→ 每个变体打上 `origin: 'registry'` 后 `ctx.theme.registerThemePack(pack)`（旧宿主回退为逐变体 `registerTheme`）→ 每包一条锁定记录写入 `registry.lock.json`。旧式单主题文档按单变体包走同一条链。 |
| `plugin` | 拉取插件包/作者仓库 → 能力一致性校验 → 静态安全审计 → 经桌面动态加载宿主 `installAndActivatePlugin` 安装激活 → 写入 `registry.lock.json`。 |

---

## 7. 内置内容约束

（规范见 [rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表)（L2）：有且只有一个内置歌词源、无内置 music source、registry 不得新增 built-in。）原因：内置内容随应用二进制发布，走内置升级比对；而注册表中的一切都是用户确认后的自愿安装内容。今天的这一个内置内容就是 lrclib 歌词源（索引中 id 为 `builtin-lrclib`）。

## 8. 视图选址

注册表视图（"发现"，路由 `/registry`）在桌面端 shell 中注册的放置位置为 `placement: ['tray']`（TopBar 右上角托盘），而非左侧 `sidebar`（侧边栏），决策依据如下：

1. **信息架构层级分明**：左侧侧边栏专注于核心播放与本地曲库浏览（搜索、曲库、专辑、歌单等）；而扩展内容、工具箱与资源管理类视图（注册表/发现、下载管理、历史记录、导入分享）统一收拢于顶栏托盘（Tray）中，避免侧边栏层级过度膨胀。
2. **更新通知徽标联动**：`apps/desktop/renderer/TopBar.tsx` 中的 `TrayIndicator` 监听 `registry/updates-available` 事件。当检测到可更新内容时，会在顶栏托盘触发按钮上展示全局更新红点（`topbar-tray-update-dot`），并在展开面板中的“发现”入口展示红点（`topbar-tray-item-update-dot`）。将注册表置于托盘中，使更新提醒能够醒目触达用户，同时不干扰核心音乐界面的日常使用。

### 8.1 发现页功能面

在四类 kind tab 之外，页面承载一组客户端视图功能（均为视图状态；除收藏外不做持久化）：

- **第三方筛选** —— “显示第三方内容”开关，默认开启。官方判定只有一条规则：条目 `repo`/`repoUrl` 的 owner 等于 GitHub 组织 `BBeBeeX`。组织名全局唯一、无法仿冒，因此仓库 owner 是唯一信任锚点；未发布仓库的条目——包括内置歌词源——一律视为第三方，在开关关闭时被隐藏。
- **排序** —— 按名称（本地化比较），或按 GitHub star 数 / 贡献者数，经由伴生服务 `ctx.registryMetadata`（contracts §25.1）。仅当数值排序键激活时才发起请求，结果缓存 24 小时，失败降级为“—”，绝不阻塞渲染。
- **插件分类筛选** —— 选项来自索引中实际出现的 `category` slug（§2）；未知 slug 原文透传而非崩溃。
- **收藏 / 已安装 tab** —— 收藏是 localStorage 中的 id 集合（`bbebee_registry_favorites`）；已安装 tab 列出各内容服务报告为已安装或可更新的条目，附带 lock 记录的 commit/日期信息（§5.5），并为拥有移除 API 的类型提供卸载（插件类型没有移除 API，此时指向插件管理）。
- **任务中心与诊断** —— 顶栏任务按钮与“诊断”tab 渲染 §4 记录的可选服务面。

---

## 9. 下一步阅读

[spec.md](./spec.md) 定义注册表 `music-source` 条目编译出的音源文档模型；[runtime.md](./runtime.md) 定义被导入的源能做什么、不能做什么；[rules/sources.md §6](../../rules/sources.md#6-registry第三方注册表) 是注册表模型的规范性摘要；注册表仓的
[CONTRIBUTING](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/CONTRIBUTING.md)
与
[MODERATION](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/MODERATION.md)
定义条目如何进入注册表。
