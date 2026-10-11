# Plugin Loading & Dynamic Registries

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §6`.

## 6. Loading

BBeBee implements a **Dual-Mode loading architecture** (规范见
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2），本节只讲原理与用法):
mobile is the static side (§6.1), desktop the dynamic side (§6.2).

### 6.1 Mobile target — `plugin-loader-static`

Metro cannot resolve a module path computed at runtime (规范见
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2）). A codegen step (`pnpm gen:plugins`, run pre-build and in dev watch) scans the
workspace for packages containing a `BBeBee.plugin.json` and emits:

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

Configuration decides which of these are actually instantiated and with what settings. The loader
dynamically invokes `load()` on demand at startup, ensuring that unconfigured plugins are neither
fetched nor evaluated. The generated file is committed so a clean checkout builds without running
codegen first.

#### Concurrent Loading & Deferred Startup
To maximize startup performance without breaking Cordis DI lifecycle:
- **Concurrent `loadPlugins`**: Enabled plugins are instantiated concurrently with `Promise.all`
  rather than serialized one by one. Cordis resolves inter-plugin dependencies through `inject`
  declarations and tracks `PENDING` states, which natively supports out-of-order resolution.
  The serial plugin loading phase is compressed to the duration of the slowest single plugin.
  The `bootstrap` core services array remains strictly sequential.
- **Post-first-frame Deferred Loading**: Plugins non-essential to the initial UI frame (such as
  `plugin-local-scanner`, `plugin-download`, `plugin-share`, `plugin-visualizer`, `plugin-sleep-timer`,
  and `plugin-history`) are excluded from `INITIAL_ENABLED`. After the Shell mounts its first paint,
  the app invokes `app.loadPlugin(id)` during `requestIdleCallback` (or `setTimeout` fallback).
  As deferred plugins activate and register their views/routes onto `ctx.ui`, `ui/changed` fires and
  dynamically populates navigation entries without blocking the initial screen.


### 6.2 Desktop dynamic loading — `plugin-loader-dynamic`

> 规范见 [rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2），本节只讲原理与用法。

Desktop implements runtime dynamic loading for external third-party plugins while maintaining sandbox integrity, `contextIsolation`, and a strict CSP:

1. **Privileged Scheme in Main (`apps/desktop/main/index.ts`)**:
   `main` registers a privileged custom scheme before app ready:
   ```ts
   protocol.registerSchemesAsPrivileged([{
     scheme: 'bbebee-plugin',
     privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
   }])
   ```
   The `protocol.handle('bbebee-plugin', ...)` handler serves files strictly out of `userData/installed-plugins/<pluginDirName(id)>/`. Path containment is enforced so directory traversal attempts (`..`) are rejected with 403 Forbidden. Correct MIME types (`text/javascript`, `application/json`, etc.) are returned.

2. **Renderer Bridge (`apps/desktop/preload/index.ts`)**:
   Exposes `window.BBeBee.plugins` with:
   - `listInstalled(): Promise<Array<{ id: string, version: string, manifest: unknown, dirName: string }>>`
   - `install(pluginId: string, files: Record<string, string>): Promise<void>`
   - `uninstall(pluginId: string): Promise<void>`

3. **Dynamic Loader & Composition (`apps/desktop/renderer/dynamic-loader.ts` & `boot.ts`)**:
   - `getBuiltinPluginRegistry()` dynamically discovers all workspace plugin manifests matching `'desktop'` via `import.meta.glob('../../../packages/**/BBeBee.plugin.json', { eager: true, import: 'default' })` and associates lazy module imports `import.meta.glob('../../../packages/**/src/index.{ts,tsx}')`.
   - `loadExternalPluginRegistry()` scans user-installed external plugins at boot and synthesizes `DynamicRegistryEntry` objects with `builtin: false` and dynamic `import('bbebee-plugin://app/${pluginId}/${entryMain}')`.
   - `boot.ts` dynamically merges `getBuiltinPluginRegistry()` with `externalRegistry` into `compositeRegistry`.
   - `installAndActivatePlugin(app, pluginId, files, manifest)`: Writes plugin files via the main process bridge, registers into `app.registerPlugin(id, entry)`, and activates in Cordis via `app.loadPlugin(id)`.
   - `uninstallExternalPlugin(app, pluginId)`: Safely disposes the Cordis fiber first via `app.unloadPlugin(id)` before deleting files from disk.

4. **Kernel Dynamic Plugin Registration (`@BBeBee/kernel`)**: the three runtime APIs —
   `app.registerPlugin(pluginId, entry)` (appends to the active registry), `app.loadPlugin(pluginId)`
   (capability checks for non-builtins, `ungranted` rejection) and `app.unloadPlugin(pluginId)`
   (unmounts fibers, unwinds disposers) — are specified in
   [rules/plugins.md §7](../../rules/plugins.md#7-dual-mode-plugin-loading)（L2）.

### 6.3 Standardized Manifest Specification (`BBeBee.plugin.json`)

Every plugin package across Layers 2–5 (Core, Logs, Feature, UI) carries a standardized
`BBeBee.plugin.json`. The 15 standardized fields (plus the optional `platforms` target filter),
their enumerations, and the field-name requirement (`systemId`, never `subsystemId`) are specified
once in [rules/plugins.md §6 Manifest Standards (`BBeBee.plugin.json`)](../../rules/plugins.md#6-manifest-standards-bbebeepluginjson)（L2）,
which is authoritative over any wording here; the TypeScript shapes are `PluginManifest`,
`PluginEntrypoints`, `PluginContributes` and `Capability` in `packages/protocol/src/manifest.ts`.

#### Example Manifest:
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

### 6.4 Codegen Tooling (`@BBeBee/tooling-gen-plugins`)

> 规范见 [rules/plugins.md §8 Scaffolding & Codegen](../../rules/plugins.md#8-scaffolding--codegen)（L2），本节只讲原理与用法。

One command (`pnpm gen:plugins`) scans every `BBeBee.plugin.json` in the workspace and regenerates
the two committed artifacts specified there. Desktop produces no codegen artifact — discovery
happens at runtime (§6.2).

### 6.5 Configuration

One config document (YAML on desktop, JSON on mobile), read through `ctx.fs` before any feature
plugin loads:

```yaml
plugins:
  '@BBeBee/plugin-player':
    enabled: true
    config: { crossfadeMs: 0, prefetchNext: true }
  '@BBeBee/plugin-source-runtime':
    enabled: true
    config: { defaultRate: '2/1000' }
```

Editing config disposes and rebuilds only the affected fibers.

> **Music sources are not configured here.** They are rows in the `sources` table
> ([schema.md §4.1](../data-model/schema.md#41-sources-accounts-and-sessions)), imported and edited in the app,
> and `plugin-source-runtime` gives each one its own fiber inside its own `ctx.isolate('http')`
> scope (§5). Putting them in a config file would mean hand-editing JSON to add a server, and
> would make "import this string" a developer action
> ([authoring.md §9](../sources/authoring.md#9-importing-updating-and-sharing)).

### 6.6 Hot reload

In development, `@cordisjs/plugin-hmr` watches the workspace and reloads changed plugins in place.
Because unload is total, this is genuinely equivalent to a restart for the affected subtree — the
audio graph, listeners, and timers of the old fiber are all gone. This works on desktop; on mobile
it composes with Metro Fast Refresh for the view layer while the kernel reloads underneath.

---

