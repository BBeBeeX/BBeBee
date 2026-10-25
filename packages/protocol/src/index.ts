/**
 * `@BBeBee/protocol` — Layer 0, the contract layer.
 *
 * Every service interface, entity type, and event-map entry lives here, and
 * every plugin depends on this package and (almost) nothing else. It is the
 * seam that makes `core-fs-mobile` and `core-fs-desktop` interchangeable, and the
 * one layer every other layer is allowed to depend on (docs/02 §1).
 *
 * Its emptiness is the feature: because nothing here runs, a Layer 3 plugin
 * and a Layer 2 core plugin can share a contract without sharing a line of
 * code, and either can be swapped for a test double at the same seam.
 *
 * Constraints this package holds itself to:
 *   - No runtime dependencies. `cordis` is a peer, imported for types only.
 *   - No side effects on import, so it is safe to load in any runtime.
 *   - No platform access of any kind.
 *
 * The small amount of runtime code here (URN helpers, the error taxonomy,
 * capability matching) is dependency-free and pure — it lives here because
 * every plugin needs it, and a second package for six functions would be
 * worse than the exception.
 */

// Importing the service modules for their side effect-free `declare module`
// augmentations is what puts `ctx.fs`, `ctx.player`, … on the Context type.
export * from './common.js'
export * from './entities/index.js'
export * from './errors.js'
export * from './events.js'
export * from './frac-index.js'
export * from './hash.js'
export * from './logging.js'
export * from './manifest.js'
export * from './redact.js'
export * from './services/index.js'
export * from './urn.js'
export * from './sort-key.js'
export * from './crypto.js'
export * from './service-keys.generated.js'
