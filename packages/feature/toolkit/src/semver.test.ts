import { describe, expect, it } from 'vitest'
import { compareVersions, normalizeVersion } from './semver.js'

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
