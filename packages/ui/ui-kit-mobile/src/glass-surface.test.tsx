import { describe, expect, it } from 'vitest'
import { GlassSurface, configureNative, type LiquidGlassOptions } from './index.js'

const BASE = {
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Image: 'Image',
  Modal: 'Modal',
  FlashList: 'FlashList',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
} as const

const LIQUID: LiquidGlassOptions = {
  general: { enabled: true, variant: 'clear', interactive: false, intensity: 60 },
  advanced: {
    thickness: 1.5,
    refraction: true,
    tilt: false,
    edgeReflectionStrength: 0.5,
    legibilityFloor: 0.2,
  },
}

describe('GlassSurface tiers', () => {
  it('renders LiquidGlassView when liquid is enabled and wired', () => {
    configureNative({ ...BASE, BlurView: 'FakeBlur', LiquidGlassView: 'FakeLiquid' })
    const element = GlassSurface({ liquid: LIQUID, borderRadius: 14, children: 'x' })
    expect(element.type).toBe('FakeLiquid')
    const props = element.props as Record<string, unknown>
    expect(props.variant).toBe('clear')
    expect(props.thickness).toBe(1.5)
    expect(props.borderRadius).toBe(14)
    expect(props.intensity).toBe(60)
  })

  it('falls back to BlurView when liquid is disabled', () => {
    configureNative({ ...BASE, BlurView: 'FakeBlur', LiquidGlassView: 'FakeLiquid' })
    const element = GlassSurface({
      liquid: { ...LIQUID, general: { ...LIQUID.general, enabled: false } },
      intensity: 85,
      children: 'x',
    })
    expect(element.type).toBe('FakeBlur')
    expect((element.props as Record<string, unknown>).intensity).toBe(85)
  })

  it('falls back to BlurView when no LiquidGlassView is wired', () => {
    configureNative({ ...BASE, BlurView: 'FakeBlur', LiquidGlassView: 'View' })
    const element = GlassSurface({ liquid: LIQUID, children: 'x' })
    expect(element.type).toBe('FakeBlur')
  })

  it('falls back to a translucent View when neither native view is wired', () => {
    configureNative({ ...BASE, BlurView: 'View', LiquidGlassView: 'View' })
    const element = GlassSurface({ liquid: LIQUID, children: 'x' })
    expect(element.type).toBe('View')
    const style = (element.props as { style: unknown[] }).style
    expect(style[0]).toMatchObject({ backgroundColor: 'rgba(12, 16, 26, 0.82)' })
  })
})
