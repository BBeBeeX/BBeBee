# 插件加载机制与动态注册表

> **历史章节映射：** 原 `docs-zh/03-plugin-system.md §6`。

## 6. 加载

BBeBee 采用**双模插件加载架构**：
- **移动端（`apps/mobile`）**：Metro 无法在运行时解析动态计算出的模块路径，因此移动端插件依靠 codegen 脚本（`apps/mobile/generated/plugins.ts`）在构建期进行全静态绑定。
- **桌面端（`apps/desktop`）**：Electron + Vite 原生支持 ESM 模块动态求值。桌面端全面采用动态加载机制 —— 通过 Vite 动态 glob（`getBuiltinPluginRegistry()`）发现所有工作区内置插件，并通过特权 `bbebee-plugin://` 协议桥接（`loadExternalPluginRegistry()`）加载外部第三方插件，无需任何静态代码生成文件。

### 6.1 移动端静态加载 —— `plugin-loader-static`

Metro 无法解析运行时计算出的模块路径，因此移动端插件导入必须可被静态分析。一个代码生成步骤
（`pnpm gen:plugins`，在构建前与开发监视期间运行）扫描工作区中含有 `BBeBee.plugin.json`
的包，并生成：

```ts
// apps/mobile/generated/plugins.ts — GENERATED, do not edit
import type { PluginRegistry } from '@BBeBee/kernel'

export const bundled: PluginRegistry = {
  '@BBeBee/plugin-player': {
    load: () => import('@BBeBee/plugin-player'),
    manifest: { /* … */ },
    builtin: true,
  },
  '@BBeBee/plugin-source-local': {
    load: () => import('@BBeBee/plugin-source-local'),
    manifest: { /* … */ },
    builtin: true,
  },
}
```

配置决定其中哪些真正被实例化、用什么设置。加载器在启动时按需执行 `load()` 进行动态加载，未启用的插件不会被加载或求值。生成的文件会被提交入库，因此干净的检出无需先跑
codegen 即可构建。

#### 并发加载与首帧后延时启动
为最大化启动性能，同时保持 Cordis 依赖注入生命周期的完整性：
- **并发 `loadPlugins`**：启用的插件通过 `Promise.all` 并发实例化，而非逐个串行执行。Cordis 原生依靠 `inject` 声明与 `PENDING` 机制解析依赖，天然支持乱序就绪。原先 1.3s 的插件串行段被压缩至“最慢单个插件”的加载耗时。核心服务 `bootstrap` 数组则维持串行有序不动。
- **首帧后延后启动（Deferred Loading）**：对首屏绘制非必须的插件（如 `plugin-local-scanner`、`plugin-download`、`plugin-share`、`plugin-visualizer`、`plugin-sleep-timer`、`plugin-history`）从 `INITIAL_ENABLED` 中拆离。在 Shell 首帧渲染后，应用通过 `requestIdleCallback`（降级 `setTimeout`）在空闲期调用 `app.loadPlugin(id)` 逐一加载。当延后插件激活并在 `ctx.ui` 注册路由/视图时，触发 `ui/changed` 事件并平滑更新导航与界面，杜绝启动阻塞。


### 6.2 桌面端动态加载 —— `plugin-loader-dynamic`

桌面端现已完整实现第三方外部插件的运行时动态加载，同时保持沙箱隔离、`contextIsolation` 与严格的 CSP：

1. **主进程中的特权协议（`apps/desktop/main/index.ts`）**：
   在应用就绪前注册特权协议：
   ```ts
   protocol.registerSchemesAsPrivileged([{
     scheme: 'bbebee-plugin',
     privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
   }])
   ```
   主进程协议处理器 `protocol.handle('bbebee-plugin', ...)` 严格限定在 `userData/installed-plugins/<pluginDirName(id)>/` 下提供服务，并执行严格的路径包含检查（拒绝 `..` 路径穿越并返回 403 Forbidden），正确响应 `text/javascript`、`application/json` 等 MIME 类型。

2. **渲染层 Preload 桥接（`apps/desktop/preload/index.ts`）**：
   暴露安全且类型完备的 `window.BBeBee.plugins` API：
   - `listInstalled(): Promise<Array<{ id: string, version: string, manifest: unknown, dirName: string }>>`
   - `install(pluginId: string, files: Record<string, string>): Promise<void>`
   - `uninstall(pluginId: string): Promise<void>`

3. **动态加载器与组合根启动（`apps/desktop/renderer/dynamic-loader.ts` & `boot.ts`）**：
   - `getBuiltinPluginRegistry()` 启动时通过 Vite 的 `import.meta.glob('../../../packages/**/BBeBee.plugin.json', { eager: true, import: 'default' })` 动态发现所有符合 desktop 平台的内置插件清单，并映射到动态模块加载器 `import.meta.glob('../../../packages/**/src/index.{ts,tsx}')`。
   - `loadExternalPluginRegistry()` 在启动期扫描已安装第三方插件目录，将其合成带有 `builtin: false` 的 `DynamicRegistryEntry`，通过 `import('bbebee-plugin://app/${pluginId}/${entryMain}')` 进行 ESM 动态导入。
   - `boot.ts` 在启动时将动态内置注册表 `getBuiltinPluginRegistry()` 与外部插件注册表 `externalRegistry` 合并为 `compositeRegistry`。
   - `installAndActivatePlugin(app, pluginId, files, manifest)`：通过主进程桥接写入文件，注册到内核 `app.registerPlugin(id, entry)`，并通过 `app.loadPlugin(id)` 立即激活。
   - `uninstallExternalPlugin(app, pluginId)`：先调用 `app.unloadPlugin(id)` 释放 Cordis fiber，而后再安全删除磁盘文件（保证析构顺序）。

4. **内核动态注册扩展（`@BBeBee/kernel`）**：
   - `app.registerPlugin(pluginId, entry)`：在运行时向活跃注册表动态追加插件条目。
   - `app.loadPlugin(pluginId)`：支持运行时即时加载与能力网关校验（未获授权的非内置插件将被标记为 `ungranted` 并拒绝加载）。
   - `app.unloadPlugin(pluginId)`：卸载 fiber 并反向执行所有资源释放器（disposers）。

### 6.3 插件标准化描述清单（`BBeBee.plugin.json`）

系统内所有分层（Core、Logs、Feature、UI）的全部插件包均标准化包含一份具有 14 项规范字段的 `BBeBee.plugin.json`：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 唯一插件包 ID（必须与 npm package.json 的 name 一致，如 `"@BBeBee/plugin-sources-ui-desktop"`） |
| `name` | `string` | 短技术名称（如 `"sources-ui-desktop"`） |
| `displayName` | `string` | 面向用户的可读展示名称（如 `"Music Sources (Desktop UI)"`） |
| `description` | `string` | 功能职责清晰描述 |
| `version` | `string` | 语义化版本号（如 `"0.0.0"`） |
| `author` | `string` | 插件作者或组织（如 `"BBeBee Team"`） |
| `engines` | `Record<string, string>` | 运行时环境版本约束（如 `{"node": ">=22.12.0"}`） |
| `enabled` | `boolean` | 默认启用标志（`true`） |
| `dependencies` | `string[]` | 前置依赖插件 ID 数组（必须已加载方可启动） |
| `systemId` | `string` | 架构所在层级 ID：`"layer-1"` 到 `"layer-5"` |
| `moduleId` | `string` | 所属功能模块/域 ID：`"sources"`、`"playback"`、`"lyrics"`、`"storage"`、`"dsp"`、`"settings"`、`"inspector"`、`"share"`、`"ui"`、`"core"`、`"logs"` |
| `entry` | `PluginEntry` | 模块入口路径（`{"main": "...", "desktop": "...", "mobile": "..."}`） |
| `capabilities` | `Capability[]` | 申请的能力权限清单（`["ui:component", "action:sources/*"]`） |
| `contributes` | `PluginContributes` | 扩展贡献槽位、路由与服务声明（`{"services": ["audio"], "routes": [...]}`） |
| `effect` | `string \| null` | 核心副作用标识（如 `"audio"`, `"fs"`, `"bridge"` 或 `null`） |

> ⚠️ **字段命名规范：** 分层架构 ID 统一固定为 **`systemId`**（严禁写为 `subsystemId`）。

#### 清单示例：
```jsonc
{
  "id": "@BBeBee/plugin-sources-ui-desktop",
  "name": "sources-ui-desktop",
  "displayName": "Music Sources (Desktop UI)",
  "description": "Desktop source management views, editor, and explorer.",
  "version": "0.0.0",
  "author": "BBeBee Team",
  "engines": {
    "node": ">=22.12.0"
  },
  "enabled": true,
  "dependencies": [
    "@BBeBee/plugin-sources"
  ],
  "systemId": "layer-5",
  "moduleId": "sources",
  "entry": {
    "main": "./src/index.tsx",
    "desktop": "./src/index.tsx"
  },
  "capabilities": [
    "ui:component",
    "action:sources/*"
  ],
  "contributes": {
    "slots": [
      "sidebar-primary"
    ]
  }
}
```

### 6.4 代码生成工具链（`@BBeBee/tooling-gen-plugins`）

运行 `pnpm gen:plugins` 自动扫描全部插件包的 `BBeBee.plugin.json` 并生成：
- `apps/mobile/generated/plugins.ts`：移动端全静态绑定注册表。
- `apps/mobile/generated/plugins.ts`：移动端静态注册表（Metro 无法在运行时计算模块路径）。
- `packages/ui/plugin-inspector-ui-desktop/src/pcb-manifests.generated.ts`：导出全部 70+ 个插件清单的 `PLUGIN_MANIFESTS` 字典，供 PCB 架构拓扑检视器直接进行节点分层、模块归属、依赖及能力的实时可视化。
*（桌面端不再使用静态生成文件，全面采用 Vite 动态加载机制与特权 `bbebee-plugin://` 协议桥接）。*

### 6.5 配置

`entry.ui` 是可选且分目标平台的：插件可以只提供桌面视图而不提供移动端视图。当某个贡献项的
视图在某个目标平台缺失时，外壳必须渲染占位符而非崩溃 —— 这是 ADR-2 的直接代价，UI 注册表
把它显式化了（[08 §3](../ui/architecture.md#3-从描述符解析到视图)）。

### 6.4 配置

一份配置文档（桌面端为 YAML，移动端为 JSON），在任何功能插件加载之前通过 `ctx.fs` 读取：

```yaml
plugins:
  '@BBeBee/plugin-player':
    enabled: true
    config: { crossfadeMs: 0, prefetchNext: true }
  '@BBeBee/plugin-source-runtime':
    enabled: true
    config: { defaultRate: '2/1000' }
```

编辑配置只会释放并重建受影响的 fiber。

> **音源不在这里配置。** 它们是 `sources` 表中的行
> （[07 §4.1](../data-model/urn.md#41-音源账号与会话)），在应用内导入与编辑，
> `plugin-source-runtime` 给每个音源一个属于自己的 fiber，运行在其专属的 `ctx.isolate('http')`
> 作用域内（§5）。把它们放进配置文件，意味着加一台服务器要手改 JSON，也让"导入这串字符串"
> 变成开发者的动作（[06 §9](../sources/authoring.md#9-导入更新与分享)）。

### 6.5 热重载

开发环境下，`@cordisjs/plugin-hmr` 监视工作区，并在原位重载发生变化的插件。由于卸载是彻底
的，这对受影响的子树而言确实等价于一次重启 —— 旧 fiber 的音频图、监听器与定时器全部消失。
桌面端可直接使用；移动端则由内核在底层重载，同时与 Metro Fast Refresh 在视图层配合。

---

