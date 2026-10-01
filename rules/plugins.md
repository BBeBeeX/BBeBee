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

## 6. Scaffolding & Dynamic Plugin Registry

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install        # link the new workspace package
pnpm gen:plugins    # update apps/*/generated/plugins.ts with dynamic imports
pnpm check
```

- `--kind` is `feature` (default) or `effect`.
- Generated registry (`apps/*/generated/plugins.ts`) maps IDs to dynamic loaders:
  `load: () => import('@BBeBee/plugin-name')`.
- The generated registry is committed. Run `pnpm gen:plugins` after adding/removing a plugin.
