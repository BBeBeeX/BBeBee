# 内容注册表（B_Be_Bee-registry）

> **本篇回答的问题。** 应用如何从社区注册表发现、检查并安装第三方内容 —— 音源、歌词源、主题与桌面插件 —— 以及注册表仓库如何接入本 monorepo。

音源是被导入的字符串，不是插件（[spec.md](./spec.md)）。注册表就是这些字符串 —— 以及另外三类可安装内容 —— 被发布、版本化与审核的策展之地，让用户在"粘贴论坛帖里的任意字符串"之外，有一条第一方的内容获取路径。

---

## 1. 仓库接入方式

注册表内容存放在独立仓库
[BBeBeeX/B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry)，本 monorepo 以 **git submodule 形式将其钉在 `registry/`** 消费：

```
registry/
├── music-sources/<id>/     音源双文件开发目录（source.json + source.js）
├── lyric-sources/<id>/     歌词源双文件开发目录
├── themes/<id>/            主题文档
├── plugins/                插件元数据文件
├── dist/                   应用实际下载的编译产物（单文件文档）
├── registry.json           生成的索引（见 §2）
├── scripts/                compile / generate-index / validate（仅用 Node 内置模块）
├── CONTRIBUTING.md         条目提交流程
└── MODERATION.md           发布前维护者审核标准
```

- 内容的**源头**是各条目目录；`dist/` 与 `registry.json` 是**生成物**（分别由 `scripts/compile.mjs` 与 `scripts/generate-index.mjs` 生成），`scripts/validate.mjs` 校验其新鲜度。
- 主仓的 `pnpm build:sources` 将 submodule 的 `music-sources/` 与 `lyric-sources/` 编译进 `fixtures/sources/`、`fixtures/lyric-sources/` 及内置歌词模块（[开发工作流](./spec.md#23-开发态双文件维护与打包)）。
- submodule 指向 `https://github.com/BBeBeeX/B_Be_Bee-registry.git`，通过 git submodule commit 钉定版本机制进行版本锁定，本地钉定提交与远端 `HEAD` 保持一致。

---

## 2. `registry.json` —— 索引格式

```jsonc
{
  "generatedAt": "2026-10-07T10:22:39-04:00",
  "repository": "BBeBeeX/B_Be_Bee-registry",
  "entries": [
    {
      "id": "subsonic",
      "kind": "music-source",
      "name": "Subsonic",
      "version": "1.0.0",
      "author": "BBeBee",
      "description": "…",
      "updatedAt": "2026-10-07T10:22:39-04:00",
      "downloadUrl": "https://…/dist/music-sources/subsonic.json",
      "sourceUrl": "https://music.example.org"
    }
  ]
}
```

| 字段 | 适用类型 | 含义 |
|---|---|---|
| `id` | 全部 | 稳定条目 id。是 `lyric-source` / `theme` / `plugin` 的匹配键（§3）。 |
| `kind` | 全部 | `music-source` \| `lyric-source` \| `theme` \| `plugin`。 |
| `name` | 全部 | 展示名。 |
| `version` | 全部 | 最新发布的 semver 版本。**内容变更必须 bump 此字段**；缺失 `version` 视为 `0.0.0`，更新检查会跳过。内置歌词源已经用该字段比对注册表副本是否更新。 |
| `author` | 全部 | 署名，展示在安装对话框。 |
| `description` | 全部 | 列表中展示的一行简介。 |
| `updatedAt` | 全部 | 条目的最后提交日期（ISO 8601），由索引生成器写入。 |
| `downloadUrl` | 全部 | 可安装产物的位置 —— 永远指向 `dist/` 编译产物，而不是条目源码。 |
| `minAppVersion` | 全部 | 条目所需的最低应用版本（semver）。可选字段；缺失即代表不限制应用版本。UI 侧通过 `minAppVersionBlock` 强校验拦截 —— 当当前运行的应用版本低于此版本时禁用安装并提示具体原因。 |
| `sourceUrl` | music-source | 文档的后端基址 —— 与已安装音源的匹配键（§3）。 |
| `previewUrl` | theme, plugin | 安装对话框的预览图。 |
| `repoUrl` | plugin | 插件作者本人的仓库。 |
| `sha256` | plugin | 插件包的完整性摘要（§5）。 |
| `capabilities` | plugin | 包内 manifest 声明的能力清单。 |

---

## 3. 匹配语义 —— 什么算"已安装"

`checkUpdates()` 将索引条目与用户已有内容比对。每类内容使用的身份各不相同，因为它复用该类内容自己的身份：

| 类型 | 匹配键 | 原因 |
|---|---|---|
| `music-source` | `sourceUrl` | `SourceRecord` 的身份就是它的 `sourceUrl` —— 导入去重以它为准（[authoring.md §9](./authoring.md#9-导入更新与分享)）。注册表里两个指向同一后端的条目，对用户而言就是同一个源。 |
| `lyric-source` | `id` | 歌词源以文档 `id` 注册与索引。 |
| `theme` | `id` | 主题以文档 `id` 索引。 |
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
  /** 安装/更新一个条目。调用方必须已经向用户展示详情（hosts / 插件风险）。 */
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

---

## 5. 安装流程、作者仓库制品链与安全体系

注册表建立了一套覆盖发现、下载、静态安全审计、确认对话框与本地防篡改锁定的完整安全门禁体系：

### 5.1 GitHub Contents API 多目录发现机制

`getIndex()` 不再单纯读取单个 `registry.json`，而是通过 GitHub Contents API 枚举 4 个分类目录：
- `music-sources/`
- `lyric-sources/`
- `plugins/`
- `themes/`

各目录条目经解析与合法性清洗后聚合为统一索引。若网络或接口故障，服务会先回退到传统单一 `registry.json`，最后回退至本地 store 离线缓存（`registry.index-cache`），确保断网下仍可查看已缓存内容。

### 5.2 作者仓库制品链

针对第三方插件及作者独立仓库：
1. **解析提交**：请求 `https://api.github.com/repos/{owner}/{repo}/commits/HEAD` 解析不可变的 HEAD 提交 SHA。
2. **下载制品**：严格基于该 commit 钉定版本下载根目录 `manifest.json` 与 `index.js`（或 `index.json`）。
3. **能力一致性校验**：严格比对 `manifest.json` 中声明的能力（capabilities）与注册表元数据。若 manifest 申请了未在注册表声明的能力或遗漏了声明能力，立即拒绝安装。

### 5.3 内置安全审计插件（`ctx.securityAudit`）

内置 `@BBeBee/plugin-security-audit`（Layer 4）提供静态源码扫描，涵盖 7 类高危安全模式（§1.4c）：
- `dynamic-execution`：`eval()`、`new Function()`、定时器字符串执行、`vm` 沙箱逃逸。
- `undeclared-egress`：未声明域名的外呼网络请求（对比 `allowedHosts` 白名单）。
- `hardcoded-credentials`：硬编码私钥（`-----BEGIN PRIVATE KEY-----`）与 API 凭证（`ghp_`、`sk_live_`、AWS 密钥）。
- `prototype-pollution`：原型污染变体（修改 `__proto__`、`Object.prototype`、`constructor.prototype`）。
- `remote-dynamic-import`：动态 `import()` 引用远端不可信 URL。
- `code-obfuscation`：密集 16 进制/Unicode 转义、压缩打包器特征。
- `high-entropy-string`：香农熵扫描识别可疑加密或混淆载荷。

审计结果区分为 `block`（高危阻断）与 `warn`（警告），存在 `block` 级别的条目默认禁止安装。

### 5.4 安装前审计确认对话框

在执行安装或更新前，桌面 UI（`packages/ui/plugin-registry-ui-desktop`）弹出 `InstallConfirmDialog`：
- **安全审计报告（Security Audit Report）**：展示审计等级徽标（`通过 (Pass)` / `警告 (Warn)` / `高危风险 (Block)`）并逐条列出发现问题（类别、等级、代码片段、行号）。
- **作者仓库与 Commit**：展示代码仓库直链与 commit SHA。
- **提交差异（Commit Diff）**：更新时展示提交哈希前进差异（如 `a1b2c3d → e4f5g6h`）。
- **阻断门禁（Block Gating）**：审计等级为 `block` 时确认按钮默认禁用，必须勾选 `我已知晓高危风险并确认强制安装` 复选框方可确认。

### 5.5 `registry.lock.json` 防篡改锁定管理

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
- **加载防篡改校验**：桌面端动态加载器（`apps/desktop/renderer/dynamic-loader.ts`）在应用启动或加载第三方插件时，重新计算入口文件 SHA-256 并与 `registry.lock.json` 比对。若哈希不符（文件遭外部篡改），标记为 `quarantined`（隔离）并拒绝加载，防止恶意代码注入。

---

## 6. 各类型的安装流程

| 类型 | 流程 |
|---|---|
| `music-source` | 拉取 `dist/` 文档 → `ctx.sources.import(text, { originUri: downloadUrl })`。完整导入管线生效；写入 `registry.lock.json`。 |
| `lyric-source` | 拉取文档/作者仓库 → 形状校验 → 静态安全审计 → `ctx.lyricSources.registerSource(doc)` → 写入 `registry.lock.json`。 |
| `theme` | 拉取文档/作者仓库 → 形状校验 → WCAG AA 对比度门禁 → `ctx.theme.registerTheme(doc)` → 写入 `registry.lock.json`。 |
| `plugin` | 拉取插件包/作者仓库 → 能力一致性校验 → 静态安全审计 → 经桌面动态加载宿主 `installAndActivatePlugin` 安装激活 → 写入 `registry.lock.json`。 |

---

## 6. 内置内容约束

应用只内置**一个歌词源**（lrclib，索引中 id 为 `builtin-lrclib`），**不内置任何音乐源**。注册表不得新增内置源：内置内容随应用二进制发布并走内置升级比对，而注册表中的一切都是用户确认后的自愿安装内容。

## 7. 视图选址

注册表视图（"发现"，路由 `/registry`）在桌面端 shell 中注册的放置位置为 `placement: ['tray']`（TopBar 右上角托盘），而非左侧 `sidebar`（侧边栏），决策依据如下：

1. **信息架构层级分明**：左侧侧边栏专注于核心播放与本地曲库浏览（搜索、曲库、专辑、歌单等）；而扩展内容、工具箱与资源管理类视图（注册表/发现、下载管理、历史记录、导入分享）统一收拢于顶栏托盘（Tray）中，避免侧边栏层级过度膨胀。
2. **更新通知徽标联动**：`apps/desktop/renderer/TopBar.tsx` 中的 `TrayIndicator` 监听 `registry/updates-available` 事件。当检测到可更新内容时，会在顶栏托盘触发按钮上展示全局更新红点（`topbar-tray-update-dot`），并在展开面板中的“发现”入口展示红点（`topbar-tray-item-update-dot`）。将注册表置于托盘中，使更新提醒能够醒目触达用户，同时不干扰核心音乐界面的日常使用。

---

## 8. 下一步阅读

[spec.md](./spec.md) 定义注册表 `music-source` 条目编译出的音源文档模型；[runtime.md](./runtime.md) 定义被导入的源能做什么、不能做什么；注册表仓的
[CONTRIBUTING](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/CONTRIBUTING.md)
与
[MODERATION](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/MODERATION.md)
定义条目如何进入注册表。
