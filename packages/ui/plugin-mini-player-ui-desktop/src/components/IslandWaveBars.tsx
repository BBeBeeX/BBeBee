import { createElement as h } from 'react'
import type { ReactElement } from 'react'

export interface IslandWaveBarsProps {
  isPlaying: boolean
  color?: string
  barCount?: number
  height?: number
}

const BAR_VARIANTS = [
  { keyframes: 'miniPlayerWave0', duration: '0.85s', delay: '0s', idleScale: 0.35 },
  { keyframes: 'miniPlayerWave1', duration: '0.75s', delay: '0.12s', idleScale: 0.65 },
  { keyframes: 'miniPlayerWave2', duration: '0.95s', delay: '0.06s', idleScale: 0.3 },
  { keyframes: 'miniPlayerWave3', duration: '0.8s', delay: '0.18s', idleScale: 0.5 },
]

const KEYFRAME_STYLES = `
@keyframes miniPlayerWave0 {
  0% { transform: scaleY(0.3); }
  30% { transform: scaleY(0.75); }
  60% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.7); }
  100% { transform: scaleY(0.3); }
}
@keyframes miniPlayerWave1 {
  0% { transform: scaleY(0.25); }
  25% { transform: scaleY(0.95); }
  55% { transform: scaleY(0.5); }
  80% { transform: scaleY(1.0); }
  100% { transform: scaleY(0.25); }
}
@keyframes miniPlayerWave2 {
  0% { transform: scaleY(0.35); }
  20% { transform: scaleY(0.55); }
  50% { transform: scaleY(0.25); }
  75% { transform: scaleY(0.6); }
  100% { transform: scaleY(0.35); }
}
@keyframes miniPlayerWave3 {
  0% { transform: scaleY(0.2); }
  35% { transform: scaleY(0.85); }
  60% { transform: scaleY(0.4); }
  85% { transform: scaleY(0.8); }
  100% { transform: scaleY(0.2); }
}
`

export function IslandWaveBars({
  isPlaying,
  color = 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
  barCount = 4,
  height = 16,
}: IslandWaveBarsProps): ReactElement {
  const bars = Array.from({ length: barCount }, (_, i) => i)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        height,
        padding: '0 2px',
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
          background: color,
          borderRadius: 2,
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

