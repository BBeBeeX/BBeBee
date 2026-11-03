import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { getScheme, nativePrimitives } from '../primitives.js'

/**
 * Resolved Liquid Glass settings, as handed to a surface by its caller.
 * This mirrors `MobileLiquidGlassSettings` in `@BBeBee/protocol` without
 * importing it: the kit's primitives stay dependency-free, and the caller
 * (which already reads the settings service) does the mapping. `tintColor`
 * is intentionally absent — unset means the system adapts the tint, and
 * v1 does not offer a custom tint control.
 */
export interface LiquidGlassOptions {
  general: {
    enabled: boolean
    variant: 'regular' | 'clear'
    interactive: boolean
    intensity: number
  }
  advanced: {
    thickness: number
    refraction: boolean
    tilt: boolean
    edgeReflectionStrength: number
    legibilityFloor: number
  }
}

export interface GlassSurfaceProps {
  children?: ReactNode
  intensity?: number
  tint?: 'dark' | 'light' | 'default'
  /** Resolved Liquid Glass settings. When present and enabled, and the
   * shell wired a real `LiquidGlassView`, it wins over the blur path. */
  liquid?: LiquidGlassOptions
  /** Lens corner radius for the Liquid Glass path (the style's radius
   * still clips the blur/translucent fallbacks). */
  borderRadius?: number
  style?: unknown
  testID?: string
  accessibilityRole?: string
  accessibilityLabel?: string
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto'
}

/**
 * A cross-platform glass surface, in three tiers:
 *
 * 1. Liquid Glass — when `liquid` is enabled and `LiquidGlassView` is wired
 *    by the shell via `configureNative` (e.g. `react-native-liquid-glassmorphism`):
 *    native `UIGlassEffect` on iOS 26, an AGSL refraction shader on Android 13+,
 *    blur/tint fallbacks below those, all inside the library.
 * 2. Frosted blur — when `BlurView` is wired (e.g. `expo-blur`):
 *    hardware-accelerated GPU blur across iOS (`UIBlurEffect`) and modern Android.
 * 3. Translucent `View` — when neither native view is wired (or in tests):
 *    semi-opaque fill, no real blur.
 */
export function GlassSurface(props: GlassSurfaceProps): ReactElement {
  const native = nativePrimitives()
  const scheme = getScheme()
  const LiquidGlass = native.LiquidGlassView
  const Blur = native.BlurView

  const commonProps = {
    testID: props.testID,
    accessibilityRole: props.accessibilityRole,
    accessibilityLabel: props.accessibilityLabel,
    pointerEvents: props.pointerEvents,
  }

  if (props.liquid?.general.enabled && LiquidGlass && LiquidGlass !== 'View') {
    const { general, advanced } = props.liquid
    return h(
      LiquidGlass as never,
      {
        ...commonProps,
        variant: general.variant,
        intensity: general.intensity,
        interactive: general.interactive,
        thickness: advanced.thickness,
        refraction: advanced.refraction,
        tilt: advanced.tilt,
        edgeReflectionStrength: advanced.edgeReflectionStrength,
        legibilityFloor: advanced.legibilityFloor,
        borderRadius: props.borderRadius,
        style: [{ overflow: 'hidden' }, props.style],
      },
      props.children,
    )
  }

  const resolvedTint = props.tint ?? (scheme === 'light' ? 'light' : 'dark')

  if (Blur && Blur !== 'View') {
    return h(
      Blur as never,
      {
        ...commonProps,
        intensity: props.intensity ?? 80,
        tint: resolvedTint,
        experimentalBlurMethod: 'dimezisBlurView',
        style: [{ overflow: 'hidden' }, props.style],
      },
      props.children,
    )
  }

  // Fallback translucent styling
  const fallbackBg =
    scheme === 'light'
      ? 'rgba(255, 255, 255, 0.85)'
      : 'rgba(12, 16, 26, 0.82)'

  return h(
    native.View as never,
    {
      ...commonProps,
      style: [
        {
          backgroundColor: fallbackBg,
          overflow: 'hidden',
        },
        props.style,
      ],
    },
    props.children,
  )
}
