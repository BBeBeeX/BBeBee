/**
 * `@BBeBee/kernel` — Layer 1. Cordis plus BBeBee's bootstrap.
 *
 * **Plugins import Cordis from here, not from `cordis` directly.** Cordis is a
 * release candidate whose README says the API may change without notice; this
 * re-export is the single adapter that would absorb such a change instead of
 * 40 packages each importing upstream. See docs/09-project-structure.md §5.1.
 *
 * This file has **two surfaces, and they are not equally available** — the
 * second of docs/02 §1's two invariants:
 *
 *   - **The plugin surface** (the first block below): the pinned Cordis
 *     re-exports. Layers 2, 3 and 4 may all import these. They only *type* a
 *     plugin.
 *   - **The bootstrap surface** (everything after it): `createApp`, the config
 *     loader, the plugin loader, the capability gate, the SQL guards, the
 *     migration runner. These *drive* the kernel, and are for Layer 2 and the
 *     composition root (`apps/x/boot.ts`) only. A feature plugin is handed a
 *     context; it does not build one, resolve plugins, read the config store,
 *     or consult the gate.
 *
 * The split is enforced by `eslint.config.js`, which allow-lists the plugin
 * surface for everything above Layer 2, and `layers.test.ts` keeps that
 * allow-list and the first block below from drifting apart. So **adding an
 * export here is a decision**: put it in the first block and every layer may
 * call it; put it below and only Layer 2 may.
 */

import { Context } from 'cordis'

// React checks `$$typeof` on objects during rendering, reconciliation,
// and DevTools inspection. On a scoped Cordis Context, accessing an un-injected
// property throws `cannot get property "$$typeof" without inject`.
// Defining `$$typeof: undefined` on `Context.prototype` ensures `Reflect.has(target, '$$typeof')`
// is true, answering `undefined` rather than throwing when React inspects a context.
try {
  Object.defineProperty(Context.prototype, '$$typeof', {
    value: undefined,
    configurable: true,
    writable: true,
  })
} catch {
  // Ignore in environments where prototype is immutable
}

// ── The pinned Cordis surface — open to every layer ───────────────────────
// Deliberately narrow: this is the entire API the project uses, which bounds
// the blast radius of an upstream change and makes it auditable.
//
// `layers.test.ts` parses this block. Keep every re-export of `cordis` and
// `./fiber-state.js` inside it, and nothing else.
export { Context, Service, Inject } from 'cordis'
// `Disposable` is deliberately NOT re-exported from cordis: `@BBeBee/protocol`
// exports its own structurally identical one, and two same-named types would
// be easy for plugin authors to mix up. Import it from the protocol package.
export type { Plugin, Fiber, Effect, EffectMeta, Inject as InjectSpec } from 'cordis'

// `FiberState` is re-exported from our own mirror rather than from cordis:
// upstream declares it as an ambient `const enum`, which cannot be imported
// under isolatedModules (i.e. under esbuild, Metro, or Vite).
export { FiberState, fiberStateName, isActive, isSettled } from './fiber-state.js'
export type { FiberStateName, FiberStateValue } from './fiber-state.js'

// ── The bootstrap surface — Layer 2 and the composition root only ────────
// Everything below drives the kernel rather than typing a plugin. Above Layer
// 2 these are a lint error (docs/02 §1 — the invariant, rule 2).
export { createApp, BootstrapError } from './bootstrap/app.js'
export type { App, AppOptions, BootstrapEntry, Target } from './bootstrap/app.js'

export { resolveConfig, isEnabled } from './config/config.js'
export type { AppConfig, PluginEntry, ResolvedPlugin } from './config/config.js'

export { loadPlugins, loadPlugin } from './loader/loader.js'
export { readCapabilityGrants } from './loader/grants.js'
export type {
  LoadOptions,
  LoadState,
  LoadedPlugin,
  PluginLoader,
  PluginModule,
  PluginRegistry,
  RegistryEntry,
} from './loader/loader.js'

export {
  scopeContext,
  capabilityConfigOf,
  assertFs,
  assertHost,
  assertWsHost,
  assertGranted,
  assertDb,
  assertDbForCaller,
  assertOwnNamespace,
  ownNamespaceOf,
  tablesReferenced,
  classifyDbAccess,
  storageNamespace,
} from './capability-gate/capability.js'
export {
  sanitizeSql,
  statementsOf,
  isMultiStatement,
  assertSingleStatement,
  assertSqlAllowed,
} from './capability-gate/sql.js'
export type { CapabilityConfig, DbAccess, GrantOptions } from './capability-gate/capability.js'

export {
  MigrationRunner,
  MigrationError,
  NamespaceCollisionError,
  CORE_NAMESPACE,
  MIGRATIONS_TABLE,
  NAMESPACES_TABLE,
  nsPrefix,
  expandNs,
  escapeLike,
} from './migrations/runner.js'
export { MIN_SQLITE_VERSION } from './migrations/runner.js'
export type { MigrationDb, MigrationTx } from './migrations/runner.js'
export { CORE_MIGRATIONS } from './migrations/core.js'
