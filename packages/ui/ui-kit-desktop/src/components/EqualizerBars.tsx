import { createElement as h, type ReactElement } from 'react'

export interface EqualizerBarsProps {
  /** Whether playback is actively running; pauses animation when false. */
  isPlaying?: boolean
  /** Bar color, defaults to theme primary color. */
  color?: string
  /** Total height of the equalizer component in px, defaults to 14. */
  height?: number
  /** Number of bars to display, defaults to 4. */
  barCount?: number
  testID?: string
}

const BAR_VARIANTS = [
  { keyframes: 'bbebeeEqWave0', duration: '0.8s', delay: '0s', idleScale: 0.35 },
  { keyframes: 'bbebeeEqWave1', duration: '0.7s', delay: '0.15s', idleScale: 0.65 },
  { keyframes: 'bbebeeEqWave2', duration: '0.9s', delay: '0.08s', idleScale: 0.3 },
  { keyframes: 'bbebeeEqWave3', duration: '0.75s', delay: '0.2s', idleScale: 0.5 },
]

const KEYFRAME_STYLES = `
@keyframes bbebeeEqWave0 {
  0% { transform: scaleY(0.3); }
  30% { transform: scaleY(0.85); }
  60% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.75); }
  100% { transform: scaleY(0.3); }
}
@keyframes bbebeeEqWave1 {
  0% { transform: scaleY(0.25); }
  25% { transform: scaleY(1.0); }
  55% { transform: scaleY(0.5); }
  80% { transform: scaleY(0.95); }
  100% { transform: scaleY(0.25); }
}
@keyframes bbebeeEqWave2 {
  0% { transform: scaleY(0.35); }
  20% { transform: scaleY(0.65); }
  50% { transform: scaleY(0.25); }
  75% { transform: scaleY(0.8); }
  100% { transform: scaleY(0.35); }
}
@keyframes bbebeeEqWave3 {
  0% { transform: scaleY(0.2); }
  35% { transform: scaleY(0.9); }
  60% { transform: scaleY(0.35); }
  85% { transform: scaleY(0.85); }
  100% { transform: scaleY(0.2); }
}
`

export function EqualizerBars({
  isPlaying = true,
  color = 'var(--color-primary, #5F87FF)',
  height = 14,
  barCount = 4,
  testID = 'equalizer-bars',
}: EqualizerBarsProps): ReactElement {
  const bars = Array.from({ length: barCount }, (_, i) => i)

  return h(
    'div',
    {
      'data-testid': testID,
      'aria-label': 'Equalizer animation',
      style: {
        display: 'inline-flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 2,
        height,
        padding: '0 2px',
        boxSizing: 'border-box',
      },
    },
    h('style', null, KEYFRAME_STYLES),
    ...bars.map((index) => {
      const variant = BAR_VARIANTS[index % BAR_VARIANTS.length] ?? BAR_VARIANTS[0]!
      return h('span', {
        key: index,
        style: {
          width: 2.5,
          height: '100%',
          backgroundColor: color,
          borderRadius: 1,
          animation: isPlaying
            ? `${variant.keyframes} ${variant.duration} ease-in-out ${variant.delay} infinite alternate`
            : 'none',
          transform: isPlaying ? undefined : `scaleY(${variant.idleScale})`,
          transformOrigin: 'bottom',
          transition: 'transform 0.25s ease',
          willChange: 'transform',
        },
      })
    }),
  )
}
