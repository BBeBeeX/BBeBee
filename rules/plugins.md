# Plugin Development Rules

Guidelines for writing and modifying BBeBee plugins (Layers 2, 4, 5).

---

## 1. Shape

Every plugin must have a diagnostic `name` matching its package suffix and specify its dependencies in `inject`.

```ts
import type { Context } from '@BBeBee/protocol'

export const name = 'plugin-media-keys'
export const inject = ['player', 'device']

export async function apply(ctx: Context) {
  const off = ctx.device.onMediaKey((k) => { /* … */ })
  return () => off()          // the returned disposer is the plugin's teardown
}
```

Or a `Service` subclass when the plugin claims a service key:
```ts
import { Service } from 'cordis'
import type { Context, PlayerService } from '@BBeBee/protocol'

export class Player extends Service implements PlayerService {
  static inject = ['audio', 'db', 'mediaSession']

  constructor(ctx: Context) {
    super(ctx, 'player')   // claims ctx.player
  }

  async [Service.init]() {
    await this.restoreQueue()
    const off = this.ctx.mediaSession.onCommand((c) => this.handle(c))
    return () => {
      off()
      this.audioNode?.disconnect()
    }
  }
}
```

> ⚠️ **Plugin entry points must be `async function`, an arrow function, or method shorthand.**
> Cordis decides "is this a class?" with `!!func.prototype`. A plain `function apply(…)` has one,
> so it is `new`-ed as a service and **the disposer it returns is discarded**.

---

## 2. Every side effect goes through the fiber

Anything a plugin starts, it must register so the fiber can stop it upon unload:

```ts
// ❌ Disposer returned through proxy is not what the fiber collects.
export async function apply(ctx: Context) {
  return ctx.dsp.registerEffect(effect)
}

// ✅ Wrapped in a local closure, collected by the fiber.
export async function apply(ctx: Context) {
  const off = ctx.dsp.registerEffect(effect)
  return () => off()
}

// ✅ Several disposables — generator form; unwind in reverse order.
export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.on('player/track-changed', onTrack)
    const timer = setInterval(tick, 30_000)
    yield () => clearInterval(timer)
    yield ctx.ui.contribute({ kind: 'slot', id: 'scrobble.badge', slot: 'now-playing.actions', order: 50 })
  }, 'scrobbler')
}
```

**Anti-patterns**: bare `window.addEventListener`; uncleared `setInterval`; module-level mutable state; floating `(async () => { ... })()`. For long async work, take an `AbortSignal` and abort it in the disposer.

---

## 3. Dependencies & Injections

- `inject` is a declaration of need, not an import. Load order is derived; nothing sequences startup by hand.
- Everything named in `inject` is required. A fiber stays `PENDING` until all injected services are `ACTIVE`.
- **Optional dependency = nested `ctx.inject([...], …)`** (or the `@Inject` decorator on a service method). The outer plugin activates immediately; only the inner block waits.
- Inject the **narrowest** set required.
- `@Inject` is a **2023-11 standard decorator**, not legacy experimental decorators.

---

## 4. Isolation and Interception

- `ctx.isolate(key)`: private instance of a service for a subtree (e.g. each imported source gets an isolated `http` stack with its own cookie jar and rate limiter).
- `ctx.intercept(key, config)`: same instance, different configuration (used by capability gate and per-plugin storage namespaces).

---

## 5. Capability Grammar

Declared in each package's `BBeBee.plugin.json`, mediated by the kernel via interception:

| Capability | Grants |
|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | `own`, `media`, `cache`, `downloads`, or `all` |
| `net:host/<glob>` | Outbound HTTP and WebSocket, plus a per-plugin persisted cookie jar |
| `db:own` | Its own `{{ns}}_`-prefixed tables outright — read, write, schema |
| `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>` | Another namespace, by verb. Reading & writing the catalogue is `db:read:core` *and* `db:write:core` |
| `secrets:own` | Its own credential namespace |
| `js` | May evaluate untrusted script in `ctx.js` (`plugin-source-runtime` only) |
| `audio`, `mediaSession`, `notify`, `shell`, `background` | Audio graph / OS-level actions |

> ⚠️ When a capability error appears: **widen the manifest, never the gate.**

---

## 6. Manifest Standards (`BBeBee.plugin.json`)

Every plugin package across all layers (Core, Logs, Feature, UI) must carry a `BBeBee.plugin.json` containing 14 standardized fields:

1. `id`: Unique package ID matching npm package name (`"@BBeBee/plugin-..."`).
2. `name`: Short technical identifier (e.g. `"sources-ui-desktop"`).
3. `displayName`: Human-readable title for UI and inspectors.
4. `description`: Clear summary of the package's responsibilities.
5. `version`: Semantic version string (`"0.0.0"`).
6. `author`: Plugin author/maintainer (`"BBeBee Team"`).
7. `engines`: Platform runtime constraints (`{"node": ">=22.12.0"}`).
8. `enabled`: Default enabled boolean (`true`).
9. `dependencies`: Explicit list of prerequisite plugin IDs (`["@BBeBee/plugin-sources"]`).
10. `systemId`: Architectural layer stratum ID: `"layer-2"`, `"layer-3"`, `"layer-4"`, or `"layer-5"`.
    *(⚠️ Note: explicitly named `systemId`, never `subsystemId`).*
11. `moduleId`: Functional domain grouping ID: `"sources"`, `"playback"`, `"lyrics"`, `"storage"`, `"dsp"`, `"settings"`, `"inspector"`, `"share"`, `"ui"`, `"core"`, `"logs"`.
12. `entry`: Module entry points (`{"main": "...", "desktop": "...", "mobile": "..."}`).
13. `capabilities`: Explicit permission tokens requested by the plugin.
14. `contributes`: Extension slots, navigation routes, settings schemas (`{"slots": ["sidebar-primary"]}`).
15. `effect`: Context property/service registered on `ctx` (e.g. `"player"`, `"audio"`), or `null` if none.

---

## 7. Dual-Mode Plugin Loading

- **Mobile (React Native / Expo)**:
  - 100% static bundling.
  - Metro requires statically analysable module paths.
  - `apps/mobile/src/boot.ts` loads exclusively from `bundled` emitted into `apps/mobile/generated/plugins.ts`.
- **Desktop (Electron)**:
  - Fully dynamic loading architecture:
    - Built-in workspace plugins are discovered dynamically at startup via Vite glob imports (`getBuiltinPluginRegistry()`), eliminating static codegen.
    - External third-party plugins are loaded via the privileged `bbebee-plugin://` custom scheme (`loadExternalPluginRegistry()`).
  - Main process (`apps/desktop/main/index.ts`) registers privileged custom scheme `bbebee-plugin://` serving from `userData/installed-plugins/` with path-containment protection.
  - Preload bridge (`apps/desktop/preload/index.ts`) exposes typed `window.BBeBee.plugins`.
  - Renderer dynamic loader (`apps/desktop/renderer/dynamic-loader.ts`) discovers installed plugins at startup and merges them into `compositeRegistry` in `boot.ts`.
  - Runtime management: `installAndActivatePlugin()` and `uninstallExternalPlugin()` (fiber disposed first, then files removed).
- **Kernel (`@BBeBee/kernel`)**:
  - `app.registerPlugin(id, entry)`: Extends the running registry.
  - `app.loadPlugin(id)`: Verifies capability grants for non-builtin plugins (`ungranted` rejection if unauthorized).
  - `app.unloadPlugin(id)`: Safely tears down fibers and disposers in reverse order.

---

## 8. Scaffolding & Codegen

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install        # link the new workspace package
pnpm gen:plugins    # update apps/mobile/generated/plugins.ts & pcb-manifests.generated.ts
pnpm check
```

- `pnpm gen:plugins` updates:
  - `apps/mobile/generated/plugins.ts` (mobile static imports for Metro).
  - `packages/ui/plugin-inspector-ui-desktop/src/pcb-manifests.generated.ts` (`PLUGIN_MANIFESTS` dictionary driving the PCB topology visualizer).
  *(Desktop dynamically discovers and loads built-in and external plugins via Vite and `dynamic-loader.ts` without codegen).*
- The generated registries are committed. Run `pnpm gen:plugins` after adding/removing any mobile plugin or modifying a `BBeBee.plugin.json`.

