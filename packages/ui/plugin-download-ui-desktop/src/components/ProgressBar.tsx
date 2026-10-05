import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { p } from './palette.js'

/**
 * A read-only bar.
 *
 * Not a `Slider`: that is a control, and a control a user can grab but that
 * does nothing is exactly the affordance mismatch the actions map in
 * `DownloadRow` avoids.
 */
export function ProgressBar({ value, label }: { value: number; label: string }): ReactElement {
  const scheme = p()
  const percent = Math.round(value * 100)
  return h(
    'div',
    {
      role: 'progressbar',
      'aria-label': label,
      'aria-valuenow': percent,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      style: {
        height: 3,
        width: '100%',
        borderRadius: 1.5,
        background: scheme.border.subtle,
        overflow: 'hidden',
      },
    },
    h('div', {
      style: {
        width: `${percent}%`,
        height: '100%',
        background: scheme.accent.base,
        transition: `width ${tokens.duration.fast}ms linear`,
      },
    }),
  )
}
