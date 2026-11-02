import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { getScheme, nativePrimitives } from '../primitives.js'

export interface GlassSurfaceProps {
  children?: ReactNode
  intensity?: number
  tint?: 'dark' | 'light' | 'default'
  style?: unknown
  testID?: string
  accessibilityRole?: string
  accessibilityLabel?: string
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto'
}

/**
 * A cross-platform frosted glass surface (Apple Music-style blur).
 *
 * When `BlurView` is wired by the shell via `configureNative` (e.g. `expo-blur`),
 * renders hardware-accelerated GPU blur across iOS (`UIBlurEffect`) and modern Android.
 * When absent or in tests, smoothly degrades to a translucent `View`.
 */
export function GlassSurface(props: GlassSurfaceProps): ReactElement {
  const native = nativePrimitives()
  const scheme = getScheme()
  const Blur = native.BlurView

  const resolvedTint = props.tint ?? (scheme === 'light' ? 'light' : 'dark')

  if (Blur && Blur !== 'View') {
    return h(
      Blur as never,
      {
        testID: props.testID,
        accessibilityRole: props.accessibilityRole,
        accessibilityLabel: props.accessibilityLabel,
        pointerEvents: props.pointerEvents,
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
      testID: props.testID,
      accessibilityRole: props.accessibilityRole,
      accessibilityLabel: props.accessibilityLabel,
      pointerEvents: props.pointerEvents,
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
