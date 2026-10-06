import { createElement as h } from 'react'
import type { ReactElement } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'inline-flex',
        background: 'var(--bb-bg-sunken, rgba(255, 255, 255, 0.08))',
        borderRadius: 6,
        padding: 2,
        gap: 2,
      },
    },
    options.map((opt) => {
      const isSelected = opt.value === value
      return h(
        'button',
        {
          key: opt.value,
          type: 'button',
          disabled,
          onClick: () => {
            if (!disabled && opt.value !== value) onChange(opt.value)
          },
          style: {
            border: 'none',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 12,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: isSelected ? 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.2))' : 'transparent',
            color: isSelected ? 'var(--bb-text-primary, #ffffff)' : 'var(--bb-text-secondary, #8e8e93)',
            fontWeight: isSelected ? 600 : 400,
            transition: 'all 0.15s',
          },
        },
        opt.label,
      )
    }),
  )
}
