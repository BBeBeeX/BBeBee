# Plugin Loading & Dynamic Registries

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §6`.

## 6. Loading

BBeBee implements a **Dual-Mode loading architecture** (see the spec at
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading) (L2); this section covers only principles and usage):
mobile is the static side (§6.1), desktop the dynamic side (§6.2).

### 6.1 Mobile target — `plugin-loader-static`

Metro cannot resolve a module path computed at runtime (see the spec at
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading) (L2)). A codegen step (`pnpm gen:plugins`, run pre-build and in dev watch) scans the
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

> see the spec at [rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading) (L2); this section covers only principles and usage.

Desktop implements runtime dynamic loading for external third-party plugins while maintaining sandbox integrity, `contextIsolation`, and a strict CSP:

1. **Privileged Scheme in Desktop Host (`apps/desktop/src-tauri/src/main.rs` & `sidecar/protocols.ts`)**:
   The desktop host registers the privileged custom scheme `bbebee-plugin://`. The protocol handler serves files strictly out of `userData/installed-plugins/<pluginDirName(id)>/`. Path containment is enforced so directory traversal attempts (`..`) are rejected with 403 Forbidden. Correct MIME types (`text/javascript`, `application/json`, etc.) are returned.

2. **Webview Shim & Bridge (`apps/desktop/src-tauri/src/shim.js` & `renderer/preload-shim.ts`)**:
   Exposes `window.BBeBee.plugins` with:
   - `listInstalled(): Promise<Array<{ id: string, version: string, manifest: unknown, dirName: string, sha256?: string }>>`
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
   [rules/plugins.md §7](../../rules/plugins.md#7-dual-mode-plugin-loading) (L2).

### 6.3 Standardized Manifest Specification (`BBeBee.plugin.json`)

Every plugin package across Layers 2–5 (Core, Logs, Feature, UI) carries a standardized
`BBeBee.plugin.json`. The 15 standardized fields (plus the optional `platforms` target filter),
their enumerations, and the field-name requirement (`systemId`, never `subsystemId`) are specified
once in [rules/plugins.md §6 Manifest Standards (`BBeBee.plugin.json`)](../../rules/plugins.md#6-manifest-standards-bbebeepluginjson) (L2),
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

> see the spec at [rules/plugins.md §8 Scaffolding & Codegen](../../rules/plugins.md#8-scaffolding--codegen) (L2); this section covers only principles and usage.

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

### 6.7 npm install flow (desktop)

Third-party plugins are discovered through the community registry and downloaded
from npm. The two phases are deliberately separate:

1. **Browse (registry only).** The client fetches the aggregated index
   `plugins/index.json` from the `B_Be_Bee-registry` repository — one raw-file
   request, no GitHub API (the anonymous Contents API quota is 60 req/hour).
   The index carries **no `version`** (schema v2); the version truth lives on npm.
   Entries declare `services` (required cordis service keys), `platforms`
   (`desktop`/`mobile`), `npm` (package name), and `dependencies` as
   `"<registry-id>[@<semver-range>]"`. The market UI filters by platform.
2. **Resolve (npm metadata only).** For the chosen entry, the client reads the
   packument from the effective npm registry, picks `dist-tags.latest` (or the
   highest version satisfying a range), and resolves the transitive dependency
   closure recursively. Version conflicts between two dependency paths and
   dependency cycles fail loudly with the conflicting requirements named.
   `resolveInstallPlan` returns the plan **without downloading anything**, so
   the UI can show the exact version, the dependency closure, and any missing
   services for confirmation.
3. **Install (download → verify → activate).** The tarball is downloaded via
   `ctx.http` as a stream (buffered `bytes()` fallback where a host has no
   stream), with the size cap enforced against the running total so an
   oversized download aborts mid-flight rather than after buffering; its
   sha512 `dist.integrity` is verified, the bytes unpacked with
   a pure-JS gunzip+untar (no `node:*` in L4), and checked three ways: the
   selected version must equal `package.json#version` and
   `BBeBee.plugin.json#version`; `package.json#name` must equal the entry's
   `npm`; the manifest `id` must equal the entry `id` and must not collide with
   a built-in plugin id (anti-spoofing). Text files are passed as UTF-8
   strings; non-UTF-8 entries are refused in v1. Then the existing security
   scan runs (`block` level refuses), files are written through the desktop
   bridge (`installAndActivatePlugin`), and the install record
   `{ id, npm, version, sha256, entrySha256, installedAt }` is persisted per
   node as each one lands, so the store never claims a plugin whose files are
   not on disk (or vice versa). `sha256` is the whole-tarball digest;
   `entrySha256` is the SHA-256 of the entry main file, which boot merges
   into the dynamic loader's lock map — the tamper check hashes the on-disk
   entry file, and the two digests cover different bytes.

**Pre-install checklist** (any failure refuses the install with a readable
reason): required `services` ⊆ (services contributed by *enabled* known
plugins — the built-in set, the shell's own declaration and installed
plugins — ∪ the to-be-installed closure's services); resolvable
dependency closure; `minAppVersion`/`engines.BBeBee` compatible with the app;
`platforms` contains the current platform and agrees with the in-package
manifest; security scan passes; anti-spoofing checks pass; tarball within the
size limit and download timeout.

"Unavailable" is judged against **registered manifests** — the built-in
`BBeBee.plugin.json` set, the shell's declaration (`SHELL_MANIFEST`, for
any service the composition root wires directly) and installed plugins —
counting only **enabled** providers: when the only provider of a service
has been disabled, the service is unavailable and the install is refused,
naming it, until the provider is enabled again. `ui`, for example, is
available on desktop because `@BBeBee/plugin-ui` contributes it
(`contributes.services: ["ui"]`) and ships in the built-in set. A service
registered at runtime but declared in no manifest would still be
invisible to this check; the manifest-completeness gate
(`manifest-standards.test.ts`) makes that drift fail in CI before an
author can trip over it. Authors: see §6.8 item 3.

**Version management.** `checkUpdates()` re-fetches packuments (short TTL; also
runs automatically once ~24h after boot plus on user request). `updatePlugin`
installs the newest version satisfying `^<installed>` and keeps the enabled
state; a major-version bump without an explicit range throws
`MAJOR_UPDATE_NEEDS_CONFIRM` so the UI asks first. Before an update overwrites
anything, rollback material is staged for **every** already-installed node in
the closure by re-downloading its old tarball; if activation of the new
version fails partway, the replaced nodes are rolled back in reverse order
(files, manifests and their install records restored together). A node whose
old tarball can no longer be staged stays at the new version, with a loud
warning rather than a silent half-state. `uninstall` refuses
when other installed plugins depend on the target and names them; user data
(store namespaces, tables) is always kept.

**Mirrors & region.** Two settings control where bytes come from, both
overridable in Settings → Network → *Download & GitHub acceleration*:
- `downloadRegion: 'global' | 'mainland-china'` (existing preference, reused).
  `mainland-china` defaults the npm registry to `https://registry.npmmirror.com`
  and the registry index to jsDelivr
  (`https://cdn.jsdelivr.net/gh/BBeBeeX/B_Be_Bee-registry@main`, whose path
  shape `/gh/<owner>/<repo>@<branch>/<path>` the fetch layer adapts to).
- `npmRegistryUrl` / `githubRawBaseUrl`: manual overrides; a manual URL always
  wins over the region default, and empty means "derive from region".
- Private registries authenticate with a token stored via `ctx.secrets`
  (`plugin-manager.setNpmAuthToken`) — never in the settings store, never in
  logs; only the boolean "token saved" state is surfaced to the UI.
- Resilience: if the effective source fails, the client retries once against
  the official endpoint, then reports both attempted URLs.

### 6.8 Author checklist: publishing a plugin to npm

1. The published package root **must contain `BBeBee.plugin.json`**, and the
   `package.json` `files` array must include it (plus `dist/`).
   **Publication identity:** the packaged manifest `id` must equal the
   registry entry `id` — a kebab slug such as `bbebeex-visualizer`
   (`{username}-{name}`), *not* the feature package's monorepo manifest id
   (`@BBeBee/plugin-visualizer`). The installer's anti-spoofing check and
   the registry's CI content check both enforce the equality; the assembly
   tool stamps it with `--id` (§6.8 item 7). Likewise the npm package name
   must be the lowercase name the registry entry's `npm` field names —
   npm accepts lowercase names only, so the monorepo scope cannot be
   published as-is; assemble under the publication name with `--name`
   (the tool warns when the resulting name is not publishable).
2. **`package.json#version` is the single version truth.** It must equal
   `BBeBee.plugin.json#version`; the installer refuses on mismatch. The
   registry entry carries no version at all.
3. The registry entry's `services` array must honestly list every cordis
   service key the plugin `inject`s — headless and UI sides alike (the
   visualizer's entry lists `ui` because its views register through
   `ctx.ui`, which `@BBeBee/plugin-ui` contributes). The installer blocks
   the install when a listed service is unavailable, and a false
   declaration either blocks legitimate users or misleads them.
   Availability is judged against registered manifests — the built-in
   set, the shell's declaration and installed plugins — counting only
   **enabled** providers, so a service whose only provider the user has
   disabled refuses the install (naming the service) until that provider
   is enabled again.
4. Declare `platforms` accurately (`["desktop"]`, `["mobile"]`, or both).
5. v1 packages must be text-only (JS/JSON/CSS); binary assets are refused.
   Keep tarballs small (the client enforces a size cap).
6. Depend on other registry plugins via `dependencies:
   ["<registry-id>@<semver-range>"]`, not via npm `dependencies` — the
   installer resolves the plugin closure itself.
7. **Assemble combined (feature + UI) packages with the repo tool**, not by
   hand: `node scripts/assemble-plugin.mjs --feature packages/feature/<pkg>
   --ui packages/ui/<pkg>-ui-desktop [--ui-mobile <dir>]
   --id <registry-entry-id> --name <lowercase-npm-name>`. It builds both
   packages, copies the feature build as `dist/index.js`, re-bundles the UI
   as `dist/ui-desktop.js` with the host-shared modules (`react`,
   `react-dom`, …) **external**, merges the manifests into one
   `BBeBee.plugin.json`, and **generates `peerDependencies` from the host
   manifest** (`apps/desktop/renderer/host-modules.manifest.ts`) — never
   write a react version or range by hand in the published `package.json`.
   The tool refuses to assemble when the UI bundle contains React
   implementation code or no bare host-module import: the UI must render
   against the shell's single React instance (§6.9). At install time the
   client checks the declared peers against the host's actual versions
   and **warns** in the install plan on a mismatch — it never blocks, but
   a warning means the UI was built against a different React major and
   may fail to render.
8. **The install-time security scan reads your declared capabilities.**
   Hosts declared via `net:host/<glob>` capabilities in the packaged
   manifest are passed to the scanner as its allowlist, so declare real
   egress there. The scanner blocks on unambiguous payloads (eval /
   dynamic remote import / credential leaks / prototype-pollution writes /
   a URL literal handed straight to `fetch` & friends on an undeclared
   host / densely hex-escaped code). URL *string constants* that are never
   requested (an SVG namespace, a mirror default in bundled library code)
   and sparse escapes in a large bundle only warn — bundled production
   artifacts are expected, and are not treated as obfuscation.

### 6.9 Bundled UI: views in the same npm package

A plugin that needs views does **not** publish a second package. One npm
package carries the headless plugin and its UI side by side:

```
package root
├── package.json
├── BBeBee.plugin.json
└── dist/
    ├── index.js        headless plugin (entry.main)
    ├── ui-desktop.js   desktop UI (entry.ui.desktop)
    └── ui-mobile.js    mobile UI (entry.ui.mobile, declared, not yet loaded)
```

```json
"entry": {
  "main": "./dist/index.js",
  "ui": { "desktop": "./dist/ui-desktop.js", "mobile": "./dist/ui-mobile.js" }
}
```

The UI module is an ordinary Cordis plugin: it default-exports a plugin def,
`inject`s the services it needs, and registers its views through the
compositor/slots it contributes to. The desktop loader imports it from the
same installed directory over `bbebee-plugin://` and composes it with the
headless def into a **single registry entry** — one package, one version,
one lock record; enabling, disabling, uninstalling, and the integrity check
all follow the package. The UI def is registered as a child fiber of the
entry, after the headless def.

Failure isolation: if the UI module fails to import, or throws while it is
being registered, the loader logs a warning and runs the headless plugin on
its own. A broken view never takes the plugin's services down with it.

The whole loop — assemble → `npm pack` → registry validation → install →
composed load (the UI's `react` resolving to the host chunk, same object)
→ update → uninstall — is exercised end to end against a localhost
registry/npm stand-in by `node scripts/verify-plugin-pilot.mjs
[target]` (the visualizer is the default pilot target; further targets
are data in `scripts/verify-plugin-pilot.targets.mjs`. Module-resolution
hooks stand in for the shell's import map; the rest is the real
installer and loader).

Two authoring constraints:

- **The UI bundle must be self-contained, apart from the host modules.**
  The shell shares its React with plugins through an import map generated
  from `apps/desktop/renderer/host-modules.manifest.ts`: bare `react`,
  `react-dom`, `react-dom/client` and the JSX runtimes resolve to the
  host's copies — the same instance the app runs, which is what makes
  hooks and context work across the boundary. Everything else the UI
  needs must be bundled into the UI file itself. Declare the shared
  modules as `peerDependencies` in the package (e.g. `"react": "^19.0.0"`)
  and keep them external in your bundler — a bundled second React is the
  one failure mode the loader cannot detect for you. The v1 text-only rule
  applies to UI files exactly as to the headless entry.
- **Desktop first.** The desktop loader honours `entry.ui.desktop` only.
  `entry.ui.mobile` may be declared today, but it stays inert until mobile
  gains a dynamic loader — it is not a schema problem, and packages written
  now will not need to change when that lands.

CSP coupling: engines apply the app's `script-src` to inline import maps,
so an unlisted map would be blocked. The desktop build generates the CSP
and the import map together — the exact serialized map text is hashed
(SHA-256) and that `'sha256-…'` source is appended to the CSP meta's
`script-src` in the same `transformIndexHtml` step that injects the map.
The hash is computed, never hand-written; change the shared-module
manifest and both the map and its allowlist entry change together. The
build fails instead of shipping a page where React imports silently
resolve nowhere.

---

