import { describe, expect, it } from 'vitest'
import {
  CRITICAL_SERVICE_KEYS,
  SERVICE_KEYS,
  SERVICE_KEY_PROVIDERS,
  criticalServiceKeysOfProvider,
  isCriticalServiceKey,
  serviceKeysOfProvider,
} from './service-keys.generated.js'

describe('generated service-keys module', () => {
  it('critical keys are a subset of all keys, each with a declared provider', () => {
    expect(CRITICAL_SERVICE_KEYS.length).toBe(17)
    for (const key of CRITICAL_SERVICE_KEYS) {
      expect(SERVICE_KEYS).toContain(key)
      expect(SERVICE_KEY_PROVIDERS[key]?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('isCriticalServiceKey separates protected from replaceable keys', () => {
    expect(isCriticalServiceKey('secrets')).toBe(true)
    expect(isCriticalServiceKey('player')).toBe(true)
    expect(isCriticalServiceKey('visualizer')).toBe(false)
    expect(isCriticalServiceKey('lyrics')).toBe(false)
    expect(isCriticalServiceKey('no-such-key')).toBe(false)
  })

  it('maps providers to the keys they declare', () => {
    expect(criticalServiceKeysOfProvider('@bbebee/plugin-player')).toEqual(['player'])
    expect(criticalServiceKeysOfProvider('@bbebee/plugin-manager')).toEqual(['plugin-manager'])
    expect(serviceKeysOfProvider('@bbebee/plugin-visualizer')).toEqual(['visualizer'])
    expect(criticalServiceKeysOfProvider('@bbebee/plugin-visualizer')).toEqual([])
    expect(criticalServiceKeysOfProvider('@BBeBee/does-not-exist')).toEqual([])
  })

  it('every key in the providers map is a known service key', () => {
    for (const key of Object.keys(SERVICE_KEY_PROVIDERS)) {
      expect(SERVICE_KEYS).toContain(key)
    }
  })
})
