import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOBILE_LIQUID_GLASS_SETTINGS,
  resolveMobileLiquidGlassSettings,
} from './settings.js'

describe('resolveMobileLiquidGlassSettings', () => {
  it('returns the defaults for absent input', () => {
    expect(resolveMobileLiquidGlassSettings()).toEqual(DEFAULT_MOBILE_LIQUID_GLASS_SETTINGS)
    expect(resolveMobileLiquidGlassSettings(null)).toEqual(DEFAULT_MOBILE_LIQUID_GLASS_SETTINGS)
  })

  it('fills a partial tier without wiping the other tier', () => {
    const resolved = resolveMobileLiquidGlassSettings({ general: { variant: 'clear' } })
    expect(resolved.general.variant).toBe('clear')
    expect(resolved.general.enabled).toBe(DEFAULT_MOBILE_LIQUID_GLASS_SETTINGS.general.enabled)
    expect(resolved.advanced).toEqual(DEFAULT_MOBILE_LIQUID_GLASS_SETTINGS.advanced)
  })

  it('clamps numeric fields to the ranges the native views accept', () => {
    const resolved = resolveMobileLiquidGlassSettings({
      general: { intensity: 500 },
      advanced: { thickness: -1, edgeReflectionStrength: 2, legibilityFloor: Number.NaN },
    })
    expect(resolved.general.intensity).toBe(100)
    expect(resolved.advanced.thickness).toBe(0)
    expect(resolved.advanced.edgeReflectionStrength).toBe(1)
    expect(resolved.advanced.legibilityFloor).toBe(0)
  })

  it('guards an unknown variant back to the default', () => {
    const resolved = resolveMobileLiquidGlassSettings({
      general: { variant: 'glass' as 'regular' },
    })
    expect(resolved.general.variant).toBe('regular')
  })
})
