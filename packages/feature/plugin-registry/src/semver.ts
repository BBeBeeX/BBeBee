/**
 * Semantic-version comparison, re-exported from `@BBeBee/toolkit`.
 *
 * The implementation lives in the toolkit (packages/feature/toolkit/src/semver.ts)
 * per the pure-helper hoisting rule — the registry UI compares
 * `entry.minAppVersion` against the running app version, so the helpers are
 * needed on both sides of the service boundary. This module keeps the
 * package's `./semver` subpath (and every existing import) working.
 */
export { compareVersions, normalizeVersion } from '@BBeBee/toolkit'
