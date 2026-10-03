# Plugin Loading & Dynamic Registries

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §6`.

## 6. Loading

Per [ADR-1 as amended](../architecture/overview.md#adr-1--plugins-are-statically-bundled-on-every-target),
there is **one loader on both targets**: the plugin graph is fixed at build time everywhere. The
thing a user adds at runtime is a music **source string**, which is data interpreted by
`plugin-source-runtime` ([06](../sources/spec.md)) rather than code handed to `ctx.plugin()`.

§6.2 documents the dynamic loader as a shelf design — worked out, not wired up — because the
decision to shelve it is reversible and the CSP problem it solves is not obvious.

### 6.1 Every target — `plugin-loader-static`

Metro cannot resolve a module path computed at runtime, so plugin imports must be statically
analysable. A codegen step (`pnpm gen:plugins`, run pre-build and in dev watch) scans the
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
   - `loadExternalPluginRegistry()` scans installed plugins at boot and synthesizes `DynamicRegistryEntry` objects with `builtin: false` and dynamic `import('bbebee-plugin://app/${pluginId}/${entryMain}')`.
   - `boot.ts` merges `bundled` (built-in static plugins) with `externalRegistry` into `compositeRegistry`.
   - `installAndActivatePlugin(app, pluginId, files, manifest)`: Writes plugin files via the main process bridge, registers into `app.registerPlugin(id, entry)`, and activates in Cordis via `app.loadPlugin(id)`.
   - `uninstallExternalPlugin(app, pluginId)`: Safely disposes the Cordis fiber first via `app.unloadPlugin(id)` before deleting files from disk.

4. **Kernel Dynamic Plugin Registration (`@BBeBee/kernel`)**:
   - `app.registerPlugin(pluginId, entry)`: Appends to the active registry at runtime.
   - `app.loadPlugin(pluginId)`: Instantiates and activates dynamic plugins with non-builtin capability checks (`ungranted` if unapproved).
   - `app.unloadPlugin(pluginId)`: Unmounts fibers and unwinds disposers.

### 6.3 Standardized Manifest Specification (`BBeBee.plugin.json`)

Every plugin package across all layers (Core, Logs, Feature, UI) carries a standardized `BBeBee.plugin.json` containing 13 required fields:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique package ID matching npm package name (e.g. `"@BBeBee/plugin-sources-ui-desktop"`) |
| `name` | `string` | Short technical name (e.g. `"sources-ui-desktop"`) |
| `displayName` | `string` | Human-readable title (e.g. `"Music Sources (Desktop UI)"`) |
| `description` | `string` | Clear description of the plugin's responsibilities |
| `version` | `string` | Semantic version string (e.g. `"0.0.0"`) |
| `author` | `string` | Author or organization (e.g. `"BBeBee Team"`) |
| `engines` | `Record<string, string>` | Environment constraints (e.g. `{"node": ">=22.12.0"}`) |
| `enabled` | `boolean` | Default activation flag |
| `dependencies` | `string[]` | Array of prerequisite plugin IDs required to be loaded |
| `systemId` | `string` | Architectural layer stratum ID: `"layer-2"`, `"layer-3"`, `"layer-4"`, or `"layer-5"` |
| `moduleId` | `string` | Functional domain grouping: `"sources"`, `"playback"`, `"lyrics"`, `"storage"`, `"dsp"`, `"settings"`, `"inspector"`, `"share"`, `"ui"`, `"core"`, `"logs"` |
| `entry` | `PluginEntry` | Entry paths (`{"main": "...", "desktop": "...", "mobile": "..."}`) |
| `capabilities` | `Capability[]` | Capability grant requests (`["ui:component", "action:sources/*"]`) |
| `contributes` | `PluginContributes` | Extension slots, routes, settings schemas (`{"slots": ["sidebar-primary"]}`) |

> ⚠️ **Field Name Requirement:** The layer stratum ID is explicitly named **`systemId`** (not `subsystemId`).

#### Example Manifest:
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

### 6.4 Codegen Tooling (`@BBeBee/tooling-gen-plugins`)

A single command (`pnpm gen:plugins`) scans all `BBeBee.plugin.json` manifests and produces:
- `apps/mobile/generated/plugins.ts`: Static registry for mobile.
- `apps/desktop/generated/plugins.ts`: Static built-in registry for desktop.
- `packages/ui/plugin-inspector-ui-desktop/src/pcb-manifests.generated.ts`: `PLUGIN_MANIFESTS` dictionary used by the PCB topology inspector to visualize system layers, module domains, dependencies, and capabilities.

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
> ([07 §4.1](../data-model/urn.md#41-sources-accounts-and-sessions)), imported and edited in the app,
> and `plugin-source-runtime` gives each one its own fiber inside its own `ctx.isolate('http')`
> scope (§5). Putting them in a config file would mean hand-editing JSON to add a server, and
> would make "import this string" a developer action
> ([06 §9](../sources/authoring.md#9-importing-updating-and-sharing)).

### 6.5 Hot reload

In development, `@cordisjs/plugin-hmr` watches the workspace and reloads changed plugins in place.
Because unload is total, this is genuinely equivalent to a restart for the affected subtree — the
audio graph, listeners, and timers of the old fiber are all gone. This works on desktop; on mobile
it composes with Metro Fast Refresh for the view layer while the kernel reloads underneath.

---

