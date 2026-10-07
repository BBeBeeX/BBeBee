/**
 * Semantic-version comparison for registry-style metadata.
 *
 * Deliberately small: the community registry publishes `'1.2.3'`-style
 * versions with an optional npm-style pre-release suffix, and the only
 * question the app asks is "is the published one newer than the installed
 * one?". A full `semver` implementation (ranges, build metadata, coercions)
 * would be a dependency bought for a comparison the registry UI and the
 * registry service each make a handful of times a day.
 *
 * Invalid or absent input is treated as `'0.0.0'` — a document that never
 * declared a version is the oldest thing in the world, which is exactly the
 * semantics an update check wants rather than an error it would have to
 * special-case.
 */

/** A parsed version: three numeric segments plus optional pre-release identifiers. */
interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Dot-separated pre-release identifiers, or `[]` for a release. */
  readonly prerelease: readonly string[]
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/

/**
 * Parse one version string. Returns `undefined` for absent, non-string or
 * malformed input — callers treat that as `'0.0.0'` via `normalizeVersion`.
 */
function parseVersion(value: string | undefined): ParsedVersion | undefined {
  if (typeof value !== 'string') return undefined
  const match = VERSION_RE.exec(value.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4]!.split('.') : [],
  }
}

const ZERO: ParsedVersion = { major: 0, minor: 0, patch: 0, prerelease: [] }

/** `'1.2.3'` style compare; `-1/0/1`. Invalid/absent inputs are treated as `'0.0.0'`. */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  return compareParsed(parseVersion(a) ?? ZERO, parseVersion(b) ?? ZERO)
}

/**
 * Canonical form of a version string: the input trimmed when it parses,
 * `'0.0.0'` when it does not. Used for display and for `installedVersion` on
 * a `RegistryUpdate`, so a user never sees a raw `undefined`.
 */
export function normalizeVersion(value: string | undefined): string {
  const parsed = parseVersion(value)
  if (!parsed) return '0.0.0'
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return parsed.prerelease.length ? `${core}-${parsed.prerelease.join('.')}` : core
}

/** Numeric segments compare numerically (`1.10.0` > `1.9.0`). */
function compareCore(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  return 0
}

/**
 * npm pre-release precedence: a version with a pre-release suffix is *older*
 * than the same version without one (`1.0.0-alpha` < `1.0.0`); numeric
 * identifiers compare numerically and sit below alphanumeric ones
 * (`1.0.0-2` < `1.0.0-10` < `1.0.0-beta` < `1.0.0-rc.1`).
 */
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 0
  // A release outranks any pre-release of the same core version.
  if (!a.length) return 1
  if (!b.length) return -1

  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i]
    const right = b[i]
    // A longer pre-release list outranks a prefix of it (`1.0.0-alpha.1` < `1.0.0-alpha.1.2`).
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const leftNumeric = isNumeric(left)
    const rightNumeric = isNumeric(right)
    if (leftNumeric && rightNumeric) {
      return Number(left) === Number(right) ? 0 : Number(left) < Number(right) ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left < right ? -1 : 1
  }
  return 0
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value)
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  const core = compareCore(a, b)
  if (core !== 0) return core
  return comparePrerelease(a.prerelease, b.prerelease)
}
