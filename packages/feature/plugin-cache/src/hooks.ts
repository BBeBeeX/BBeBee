/**
 * View hooks for `ctx.cache` — public subpath of the cache feature.
 *
 * The implementation lives in `@BBeBee/toolkit/hooks` (the shared headless
 * library every view package may import) so that artwork resolution is
 * reachable without importing the cache feature. This subpath remains the
 * cache's own hook surface and re-exports it one-to-one.
 */

export { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
