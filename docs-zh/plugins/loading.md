# 插件加载机制与动态注册表

> **历史章节映射：** 原 `docs-zh/03-plugin-system.md §6`。

## 6. 加载

BBeBee 实现的是**双模（Dual-Mode）加载架构**（规范见
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2），本节只讲原理与用法）：
移动端是静态一侧（§6.1），桌面端是动态一侧（§6.2）。

### 6.1 移动端静态加载 —— `plugin-loader-static`

Metro 无法解析运行时计算出的模块路径（规范见
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2））。一个代码生成步骤
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

> 规范见 [rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2），本节只讲原理与用法。

桌面端为外部第三方插件实现了运行时动态加载，同时保持沙箱完整性、`contextIsolation` 与严格的 CSP：

1. **桌面端宿主中的特权协议（`apps/desktop/src-tauri/src/main.rs` 与 `sidecar/protocols.ts`）**：
   桌面宿主注册特权自定义协议 `bbebee-plugin://`。协议处理器严格限定在 `userData/installed-plugins/<pluginDirName(id)>/` 下提供服务，并执行严格的路径包含检查（拒绝 `..` 路径穿越并返回 403 Forbidden），正确响应 `text/javascript`、`application/json` 等 MIME 类型。

2. **Webview Shim 与桥接（`apps/desktop/src-tauri/gen/shim.js`，由 `renderer/preload-shim.ts` 经 `pnpm build:shim` 打包生成）**：
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

4. **内核动态插件注册（`@BBeBee/kernel`）**：三个运行时 API ——
   `app.registerPlugin(pluginId, entry)`（向活跃注册表追加插件条目）、`app.loadPlugin(pluginId)`
   （对非内置插件做能力检查，未授权即拒绝为 `ungranted`）与 `app.unloadPlugin(pluginId)`
   （卸载 fiber 并反向展开 disposers）—— 规定见
   [rules/plugins.md §7](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2）。

### 6.3 插件标准化描述清单（`BBeBee.plugin.json`）

横跨 Layer 2–5（Core、Logs、Feature、UI）的每个插件包都携带一份标准化的 `BBeBee.plugin.json`。
15 个规范字段（外加可选的 `platforms` 目标平台过滤器）、各自的枚举取值，以及字段命名要求
（`systemId`，绝非 `subsystemId`），统一规定于
[rules/plugins.md §6 Manifest Standards (`BBeBee.plugin.json`)](../../rules/plugins.md#6-manifest-standards-bbebeepluginjson)（L2），
该节对本文任何措辞拥有最终权威；TypeScript 形态是 `packages/protocol/src/manifest.ts` 中的
`PluginManifest`、`PluginEntrypoints`、`PluginContributes` 与 `Capability`。

#### 清单示例：
```jsonc
{
  "id": "@BBeBee/plugin-sources",
  "name": "@BBeBee/plugin-sources",
  "displayName": "Sources",
  "description": "ctx.sources — imported source documents, the registry, and the catalogue cache.",
  "version": "0.0.0",
  "author": "BBeBee Team",
  "engines": {
    "BBeBee": "^0.1.0"
  },
  "enabled": true,
  "dependencies": [],
  "systemId": "layer-4",
  "moduleId": "sources",
  "entry": {
    "main": "./dist/index.js",
    "ui": {
      "desktop": "./dist/index.js",
      "mobile": "./dist/index.js"
    }
  },
  "capabilities": [
    "db:read:core",
    "db:write:core"
  ],
  "contributes": {
    "services": [
      "sources"
    ]
  },
  "effect": "sources"
}
```

> `entry.ui` 是可选且分目标平台的：插件可以只提供桌面视图而不提供移动端视图。当某个贡献项的视图在某个目标平台缺失时，外壳必须渲染占位符而非崩溃 —— 这是 ADR-2 的直接代价，UI 注册表把它显式化了（[ui/architecture.md §3](../ui/architecture.md#3-从描述符解析到视图)）。

### 6.4 代码生成工具链（`@BBeBee/tooling-gen-plugins`）

> 规范见 [rules/plugins.md §8 Scaffolding & Codegen](../../rules/plugins.md#8-scaffolding--codegen)（L2），本节只讲原理与用法。

一条命令（`pnpm gen:plugins`）扫描工作区中每一份 `BBeBee.plugin.json`，并重新生成其中规定的
两份已提交产物。桌面端不产生任何 codegen 产物 —— 发现在运行时完成（§6.2）。

### 6.5 配置

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
> （[schema.md §4.1](../data-model/schema.md#41-音源账号与会话)），在应用内导入与编辑，
> `plugin-source-runtime` 给每个音源一个属于自己的 fiber，运行在其专属的 `ctx.isolate('http')`
> 作用域内（§5）。把它们放进配置文件，意味着加一台服务器要手改 JSON，也让"导入这串字符串"
> 变成开发者的动作（[authoring.md §9](../sources/authoring.md#9-导入更新与分享)）。

### 6.6 热重载

开发环境下，`@cordisjs/plugin-hmr` 监视工作区，并在原位重载发生变化的插件。由于卸载是彻底
的，这对受影响的子树而言确实等价于一次重启 —— 旧 fiber 的音频图、监听器与定时器全部消失。
桌面端可直接使用；移动端则由内核在底层重载，同时与 Metro Fast Refresh 在视图层配合。

---

