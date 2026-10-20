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

/**
 * npm-style semver range test (deliberate subset).
 *
 * Supported: `*`/`x`/empty (any), exact (`1.2.3`), comparison operators
 * (`>=1.0.0`, `<2.0.0`, …), caret (`^1.2.3`), tilde (`~1.2.3`), partial
 * versions (`1.2.x`, `1.x`), space-separated AND groups and `||` OR groups
 * (`>=1.0.0 <2.0.0 || >=3.0.0`). Hyphen ranges (`1.2.3 - 2.0.0`) are *not*
 * supported and make the range unsatisfiable rather than silently wrong.
 *
 * Pre-release rule (npm-compatible): a pre-release version only satisfies a
 * group that mentions a pre-release on the same `major.minor.patch`.
 */
export function satisfiesRange(version: string | undefined, range: string | undefined): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const trimmed = (range ?? '').trim()
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'x') return true

  return trimmed.split('||').some((group) => {
    const comparators = group
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(parseComparator)
    if (comparators.some((c) => !c)) return false
    const fns = comparators as Array<(v: ParsedVersion) => boolean>
    if (!fns.every((fn) => fn(parsed))) return false
    if (parsed.prerelease.length > 0) {
      // npm: a pre-release version needs a pre-release comparator on the same core.
      const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`
      return group.includes('-') && group.includes(core)
    }
    return true
  })
}

/** Highest version satisfying `range` (undefined range = highest overall), or undefined. */
export function maxSatisfying(
  versions: readonly string[],
  range?: string,
): string | undefined {
  let best: string | undefined
  for (const v of versions) {
    if (!satisfiesRange(v, range)) continue
    if (best === undefined || compareVersions(v, best) > 0) best = v
  }
  return best
}

type Comparator = (v: ParsedVersion) => boolean

/** A version that may carry `x`/` *` wildcards in minor/patch position. */
interface PartialVersion {
  major: number
  minor?: number
  patch?: number
  prerelease: readonly string[]
}

const PARTIAL_RE = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/

function parsePartial(value: string): PartialVersion | undefined {
  const match = PARTIAL_RE.exec(value.trim())
  if (!match) return undefined
  const num = (s: string | undefined): number | undefined =>
    s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s)
  return {
    major: Number(match[1]),
    minor: num(match[2]),
    patch: num(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function gte(bound: ParsedVersion): Comparator {
  return (v) => compareParsed(v, bound) >= 0
}

function lt(bound: ParsedVersion): Comparator {
  return (v) => compareParsed(v, bound) < 0
}

function full(p: PartialVersion): ParsedVersion | undefined {
  if (p.minor === undefined || p.patch === undefined) return undefined
  return { major: p.major, minor: p.minor, patch: p.patch, prerelease: p.prerelease }
}

function parseComparator(token: string): Comparator | undefined {
  const t = token.trim()
  if (!t || t === '*' || t.toLowerCase() === 'x') return () => true
  const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(t)
  if (!m) return undefined
  const op = m[1] ?? ''
  const partial = parsePartial(m[2]!)
  if (!partial) return undefined

  // Wildcard partials (`1.x`, `1.2.*`) desugar to a >= / < pair.
  if (partial.minor === undefined) {
    const lo: ParsedVersion = { major: partial.major, minor: 0, patch: 0, prerelease: [] }
    const hi: ParsedVersion = { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] }
    if (op === '' || op === '=' || op === '^' || op === '~') return (v) => gte(lo)(v) && lt(hi)(v)
    return undefined
  }
  if (partial.patch === undefined) {
    const lo: ParsedVersion = { major: partial.major, minor: partial.minor, patch: 0, prerelease: [] }
    const hi: ParsedVersion =
      op === '^'
        ? { major: partial.major + 1, minor: 0, patch: 0, prerelease: [] }
        : { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: [] }
    if (op === '' || op === '=' || op === '~' || op === '^') return (v) => gte(lo)(v) && lt(hi)(v)
    return undefined
  }

  const ver = full(partial)!
  switch (op) {
    case '':
    case '=':
      return (v) => compareParsed(v, ver) === 0
    case '>':
      return (v) => compareParsed(v, ver) > 0
    case '>=':
      return gte(ver)
    case '<':
      return lt(ver)
    case '<=':
      return (v) => compareParsed(v, ver) <= 0
    case '^': {
      // ^1.2.3 := >=1.2.3 <2.0.0 ; ^0.2.3 := >=0.2.3 <0.3.0 ; ^0.0.3 := >=0.0.3 <0.0.4
      const hi: ParsedVersion =
        ver.major > 0
          ? { major: ver.major + 1, minor: 0, patch: 0, prerelease: [] }
          : ver.minor > 0
            ? { major: 0, minor: ver.minor + 1, patch: 0, prerelease: [] }
            : { major: 0, minor: 0, patch: ver.patch + 1, prerelease: [] }
      return (v) => gte(ver)(v) && lt(hi)(v)
    }
    case '~': {
      // ~1.2.3 := >=1.2.3 <1.3.0
      const hi: ParsedVersion = { major: ver.major, minor: ver.minor + 1, patch: 0, prerelease: [] }
      return (v) => gte(ver)(v) && lt(hi)(v)
    }
    default:
      return undefined
  }
}
