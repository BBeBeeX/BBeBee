/**
 * Version parsing, SemVer comparison, and channel lifecycle verification.
 *
 * Rules:
 * 1. Version format is `x.y.z`, where `z` is patch version (bug fixes only, no new features).
 * 2. Channels: `main` (stable) and `dev` (preview/development).
 * 3. 1 month after dev version freeze/release, the corresponding main version is released.
 * 4. Main release uses the latest patch version of that `x.y` series.
 */

import type { UpdateChannel, UpdateRelease, VersionInfo } from '@BBeBee/protocol'

/** Standard 30-day millisecond window for 1 calendar month maturation. */
export const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000

const VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Parse a version string (e.g., "1.2.0", "v1.2.3", "1.2.0-dev", "1.2.1-dev.2") into `VersionInfo`.
 */
export function parseVersion(raw: string): VersionInfo | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const match = VERSION_REGEX.exec(trimmed)
  if (!match) return null

  const major = parseInt(match[1]!, 10)
  const minor = parseInt(match[2]!, 10)
  const patch = parseInt(match[3]!, 10)
  const prerelease = match[4]

  const channel: UpdateChannel =
    prerelease && prerelease.toLowerCase().includes('dev') ? 'dev' : 'main'

  return {
    major,
    minor,
    patch,
    channel,
    prerelease,
    raw: trimmed,
  }
}

/**
 * Compare two versions.
 * Returns:
 *   > 0 if a > b
 *   < 0 if a < b
 *   0 if a === b
 */
export function compareVersions(
  a: VersionInfo | string,
  b: VersionInfo | string,
): number {
  const vA = typeof a === 'string' ? parseVersion(a) : a
  const vB = typeof b === 'string' ? parseVersion(b) : b

  if (!vA && !vB) return 0
  if (!vA) return -1
  if (!vB) return 1

  if (vA.major !== vB.major) return vA.major - vB.major
  if (vA.minor !== vB.minor) return vA.minor - vB.minor
  if (vA.patch !== vB.patch) return vA.patch - vB.patch

  // Both have the same x.y.z: a release without prerelease is newer than one with prerelease.
  if (!vA.prerelease && vB.prerelease) return 1
  if (vA.prerelease && !vB.prerelease) return -1
  if (vA.prerelease && vB.prerelease) {
    return vA.prerelease.localeCompare(vB.prerelease, undefined, { numeric: true })
  }

  return 0
}

/**
 * Check whether a target version is purely a patch update over current version
 * (i.e. same major and minor, only patch `z` incremented).
 */
export function isPatchOnlyUpdate(current: VersionInfo, target: VersionInfo): boolean {
  return (
    target.major === current.major &&
    target.minor === current.minor &&
    target.patch > current.patch
  )
}

/**
 * Check whether a dev release is eligible for main release promotion
 * (dev release date is at least 1 month in the past).
 */
export function isDevEligibleForMain(
  devFreezeDate: Date | string | number,
  referenceDate: Date | string | number = Date.now(),
): boolean {
  const freezeEpoch =
    typeof devFreezeDate === 'number'
      ? devFreezeDate
      : new Date(devFreezeDate).getTime()
  const refEpoch =
    typeof referenceDate === 'number'
      ? referenceDate
      : new Date(referenceDate).getTime()

  if (isNaN(freezeEpoch) || isNaN(refEpoch)) return false
  return refEpoch - freezeEpoch >= ONE_MONTH_MS
}

/**
 * Given a list of releases and a target series `x.y`, find the release with the highest patch `z`.
 * Implements: "main版本发布时使用对应x.y版本的最新补丁版本".
 */
export function resolveLatestPatchForSeries(
  releases: UpdateRelease[],
  series: { major: number; minor: number },
): UpdateRelease | undefined {
  const matches = releases.filter(
    (r) =>
      r.parsedVersion.major === series.major &&
      r.parsedVersion.minor === series.minor,
  )

  if (matches.length === 0) return undefined

  // Sort descending by patch and prerelease
  matches.sort((a, b) => compareVersions(b.parsedVersion, a.parsedVersion))
  return matches[0]
}

/**
 * Find all unique (major, minor) series present in a release collection.
 */
export function getReleaseSeries(
  releases: UpdateRelease[],
): Array<{ major: number; minor: number }> {
  const seen = new Set<string>()
  const result: Array<{ major: number; minor: number }> = []

  for (const r of releases) {
    const key = `${r.parsedVersion.major}.${r.parsedVersion.minor}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ major: r.parsedVersion.major, minor: r.parsedVersion.minor })
    }
  }

  return result
}
