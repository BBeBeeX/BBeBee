import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { p } from './palette.js'

/** A filter-sized toggle for the two policy switches. */
export function PolicyToggle({
  label,
  active,
  onPress,
  testID,
}: {
  label: string
  active: boolean
  onPress: () => void
  testID: string
}): ReactElement {
  const scheme = p()
  return h(
    'button',
    {
      type: 'button',
      onClick: onPress,
      'aria-pressed': active,
      'data-testid': testID,
      style: {
        minHeight: 26,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.pill,
        border: `1px solid ${active ? 'transparent' : scheme.border.subtle}`,
        background: active ? scheme.accent.base : 'transparent',
        color: active ? scheme.accent.on : scheme.text.secondary,
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.bold,
        cursor: 'pointer',
      },
    },
    label,
  )
}
