import { describe, expect, it } from 'vitest'
import { compareVersions, maxSatisfying, normalizeVersion, satisfiesRange } from './semver.js'

describe('compareVersions', () => {
  it('compares numeric segments numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })

  it('ranks a pre-release below its release, the npm way', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })

  it('compares numeric pre-release identifiers numerically', () => {
    expect(compareVersions('1.0.0-2', '1.0.0-10')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
    expect(compareVersions('1.0.0-10', '1.0.0-2')).toBe(1)
  })

  it('treats invalid or absent input as 0.0.0', () => {
    expect(compareVersions(undefined, undefined)).toBe(0)
    expect(compareVersions(undefined, '0.0.0')).toBe(0)
    expect(compareVersions('garbage', '0.0.1')).toBe(-1)
    expect(compareVersions('1.0.0', undefined)).toBe(1)
  })
})

describe('normalizeVersion', () => {
  it('passes a plain version through', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3-alpha.1')).toBe('1.2.3-alpha.1')
  })

  it('maps absent and malformed input to 0.0.0', () => {
    expect(normalizeVersion(undefined)).toBe('0.0.0')
    expect(normalizeVersion('')).toBe('0.0.0')
    expect(normalizeVersion('1.2')).toBe('0.0.0')
    expect(normalizeVersion('next')).toBe('0.0.0')
  })
})

describe('satisfiesRange', () => {
  it('handles exact, wildcard and empty ranges', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false)
    expect(satisfiesRange('1.2.3', '*')).toBe(true)
    expect(satisfiesRange('1.2.3', '')).toBe(true)
    expect(satisfiesRange('1.2.3', 'x')).toBe(true)
  })

  it('handles caret ranges', () => {
    expect(satisfiesRange('1.2.3', '^1.2.0')).toBe(true)
    expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfiesRange('1.1.9', '^1.2.0')).toBe(false)
    expect(satisfiesRange('0.2.5', '^0.2.3')).toBe(true)
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false)
    expect(satisfiesRange('0.0.3', '^0.0.3')).toBe(true)
    expect(satisfiesRange('0.0.4', '^0.0.3')).toBe(false)
  })

  it('handles tilde and comparison ranges', () => {
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false)
    expect(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
    expect(satisfiesRange('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
    expect(satisfiesRange('1.0.0', '>1.0.0')).toBe(false)
    expect(satisfiesRange('1.0.1', '>1.0.0')).toBe(true)
  })

  it('handles partial versions and OR groups', () => {
    expect(satisfiesRange('1.2.7', '1.2.x')).toBe(true)
    expect(satisfiesRange('1.3.0', '1.2.x')).toBe(false)
    expect(satisfiesRange('1.9.9', '1.x')).toBe(true)
    expect(satisfiesRange('2.0.0', '1.x')).toBe(false)
    expect(satisfiesRange('3.1.0', '>=1.0.0 <2.0.0 || >=3.0.0')).toBe(true)
    expect(satisfiesRange('2.5.0', '>=1.0.0 <2.0.0 || >=3.0.0')).toBe(false)
  })

  it('keeps pre-releases out unless the range names their tuple', () => {
    // npm rule: a pre-release version only satisfies when its
    // [major, minor, patch] tuple matches a comparator that itself has a
    // pre-release tag on that same tuple.
    expect(satisfiesRange('1.2.3-alpha', '^1.0.0')).toBe(false)
    expect(satisfiesRange('1.2.3-alpha', '^1.0.0-alpha')).toBe(false)
    expect(satisfiesRange('1.0.0-alpha', '^1.0.0-alpha')).toBe(true)
    expect(satisfiesRange('1.2.3', '^1.0.0')).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(satisfiesRange(undefined, '^1.0.0')).toBe(false)
    expect(satisfiesRange('garbage', '^1.0.0')).toBe(false)
    expect(satisfiesRange('1.2.3', '1.2.3 - 2.0.0')).toBe(false)
  })
})

describe('maxSatisfying', () => {
  it('picks the highest matching version', () => {
    expect(maxSatisfying(['1.0.0', '1.2.0', '2.0.0'], '^1.0.0')).toBe('1.2.0')
    expect(maxSatisfying(['1.0.0', '1.2.0'], '>=9.0.0')).toBeUndefined()
    expect(maxSatisfying(['1.0.0', '2.0.0'])).toBe('2.0.0')
  })
})
