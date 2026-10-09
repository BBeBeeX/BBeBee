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
      "id": "bilibili",
      "kind": "music-source",
      "name": "Bilibili",
      "version": "1.0.0",
      "author": "BBeBee",
      "description": "…",
      "updatedAt": "2026-10-07T10:22:39-04:00",
      "downloadUrl": "https://…/dist/music-sources/bilibili.json",
      "sourceUrl": "https://www.bilibili.com"
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

## 5. 各类型的安装流程

`install(entry)` 分派给拥有该类型的服务 —— 注册表服务是一个薄协调者：下游服务已校验的东西它不再校验，用户确认前必须看到的东西它也绝不隐藏：

| 类型 | 流程 |
|---|---|
| `music-source` | 拉取 `dist/` 文档 → `ctx.sources.import(text, { originUri: downloadUrl })`。完整导入管线生效：校验、按 `sourceUrl` 去重、对 rejected/conflicted 行的呈现。若报告中不存在该条目 `sourceUrl` 对应的已接受行，安装会大声失败。 |
| `lyric-source` | 拉取 `dist/` 文档 → 形状校验（`id` / `name` / `script`）→ `ctx.lyricSources.registerSource(doc)`。 |
| `theme` | 拉取 `dist/` 文档 → 形状校验 → 与用户自建主题**相同的暗/亮双模式对比度门禁** → `ctx.theme.registerTheme(doc)`。 |
| `plugin` | 拉取插件包（`{ manifest, files }` JSON）→ **条目未发布 `sha256` 时拒绝安装** → 将下载字节与摘要比对 → manifest 形状校验 → 经 `setPluginInstaller` 交给桌面动态加载宿主。仅桌面端。 |

**安装安全红线 —— 在调用 `install()` 之前由 UI 强制：**

- **`allowedHosts` 安装前明示。** `fetchEntryDetails()` 会提取音源文档的出站域名清单，让确认对话框说出该源被允许访问的每一个主机。域名清单是一句用户能自己判断的话；它必须在文档导入之前出现在屏幕上，而不是安装之后才被发现。
- **插件安装是风险确认。** 对话框展示条目的 `repoUrl`、声明的 `capabilities` 与校验过的 `sha256`；用户明确确认后代码才会被加载。
- **应用只消费 `dist/` 产物。** 注册表仓里的条目源码是给人审核用的（`MODERATION.md`）；运行时不会拉取它们。

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
