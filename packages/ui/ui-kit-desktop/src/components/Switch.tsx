import { createElement as h } from 'react'
import type { ReactElement } from 'react'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: SwitchProps): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': accessibilityLabel,
      disabled,
      onClick: () => {
        if (!disabled) onChange(!checked)
      },
      style: {
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked
          ? 'var(--color-primary, #5F87FF)'
          : 'var(--switch-off-bg, var(--border-default, #D1D5DB))',
        border: checked ? '1px solid transparent' : '1px solid var(--border-subtle, rgba(0, 0, 0, 0.1))',
        boxShadow: checked ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.35))' : 'none',
        padding: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        transition: 'background-color 0.2s, border-color 0.2s, box-shadow 0.2s',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#ffffff',
        transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        transition: 'transform 0.2s',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      },
    }),
  )
}
