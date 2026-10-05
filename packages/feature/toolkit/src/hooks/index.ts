/**
 * `@BBeBee/toolkit/hooks` — the shared React bindings between services and
 * views.
 *
 * Every view package (and every headless package exposing view hooks) may
 * import this subpath; that is what keeps a desktop view from having to reach
 * across to *another* feature package for a binding the two of them both need.
 * The generic primitives live in `store.ts` / `react.ts`; the domain hooks
 * (`player.ts`, `artwork.ts`, `lyrics.ts`) read their services through service
 * keys and typed events only — no feature package is imported here.
 */

export * from './store.js'
export * from './react.js'
export * from './player.js'
export * from './artwork.js'
export * from './lyrics.js'
export * from './sources.js'
