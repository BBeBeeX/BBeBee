/**
 * Color picker component with dark theme presets and custom color hex input.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  accessibilityLabel?: string
}

export const COLOR_PRESETS = [
  { color: '#FFFFFF', label: '纯白' },
  { color: '#5F87FF', label: '电光蓝' },
  { color: '#7C86FF', label: '长春花蓝' },
  { color: '#A99CFF', label: '薰衣草紫' },
  { color: '#9B73F5', label: '柔紫' },
  { color: '#60EFFF', label: '冰晶蓝' },
  { color: '#1DB954', label: '翡翠绿' },
  { color: '#EC4899', label: '霓虹粉' },
]

export function ColorPicker({ value, onChange, accessibilityLabel }: ColorPickerProps): ReactElement {
  const [customVal, setCustomVal] = useState(value)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      },
      'aria-label': accessibilityLabel,
    },
    COLOR_PRESETS.map((preset) => {
      const isSelected = value.toLowerCase() === preset.color.toLowerCase()
      return h('button', {
        key: preset.color,
        type: 'button',
        title: preset.label,
        'aria-label': `${preset.label} (${preset.color})`,
        'aria-pressed': isSelected,
        onClick: () => {
          setCustomVal(preset.color)
          onChange(preset.color)
        },
        style: {
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: preset.color,
          border: isSelected ? '2px solid var(--text-primary, #FFFFFF)' : '2px solid transparent',
          boxShadow: isSelected
            ? '0 0 0 2px var(--border-hover, rgba(255, 255, 255, 0.4)), 0 2px 6px rgba(0, 0, 0, 0.5)'
            : '0 1px 3px rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          padding: 0,
          outline: 'none',
          transition: 'all 0.15s ease',
          transform: isSelected ? 'scale(1.15)' : 'scale(1)',
        },
      })
    }),
    h('input', {
      type: 'text',
      value: customVal,
      placeholder: '#FFFFFF',
      maxLength: 9,
      onChange: (e: { target: { value: string } }) => {
        const val = e.target.value
        setCustomVal(val)
        if (/^#([0-9a-fA-F]{3,8})$/.test(val)) {
          onChange(val)
        }
      },
      style: {
        width: 78,
        height: 28,
        borderRadius: 6,
        background: 'var(--input-bg, rgba(255, 255, 255, 0.08))',
        border: '1px solid var(--input-border, rgba(255, 255, 255, 0.15))',
        color: 'var(--text-primary, #FFFFFF)',
        fontSize: 12,
        fontFamily: 'ui-monospace, monospace',
        padding: '0 8px',
        outline: 'none',
        textAlign: 'center',
      },
    }),
  )
}
