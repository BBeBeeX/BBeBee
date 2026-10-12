/**
 * Color picker component with dark theme presets and custom color hex input.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  accessibilityLabel?: string
  /**
   * Optional Cordis context. When provided, preset names are translated via
   * `useI18n`; without it the built-in English names render.
   */
  ctx?: Context
}

const COLOR_PRESET_DEFS = [
  { color: '#FFFFFF', labelKey: 'app:common.colorPicker.pureWhite', fallback: 'Pure White' },
  { color: '#5F87FF', labelKey: 'app:common.colorPicker.electricBlue', fallback: 'Electric Blue' },
  { color: '#7C86FF', labelKey: 'app:common.colorPicker.periwinkle', fallback: 'Periwinkle' },
  { color: '#A99CFF', labelKey: 'app:common.colorPicker.lavender', fallback: 'Lavender' },
  { color: '#9B73F5', labelKey: 'app:common.colorPicker.softPurple', fallback: 'Soft Purple' },
  { color: '#60EFFF', labelKey: 'app:common.colorPicker.iceBlue', fallback: 'Ice Blue' },
  { color: '#1DB954', labelKey: 'app:common.colorPicker.emeraldGreen', fallback: 'Emerald Green' },
  { color: '#EC4899', labelKey: 'app:common.colorPicker.neonPink', fallback: 'Neon Pink' },
] as const

/** Preset swatches with their built-in English names (untranslated data export). */
export const COLOR_PRESETS = COLOR_PRESET_DEFS.map(({ color, fallback }) => ({ color, label: fallback }))

export function ColorPicker({ value, onChange, accessibilityLabel, ctx }: ColorPickerProps): ReactElement {
  const [customVal, setCustomVal] = useState(value)
  // Deliberately hook-free: the kit's tree() tests invoke components as plain
  // functions. Locale changes reach this component because its
  // useI18n-subscribed ancestors re-render it.
  const i18n = ctx ? serviceOf<I18nService>(ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback

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
    COLOR_PRESET_DEFS.map((preset) => {
      const isSelected = value.toLowerCase() === preset.color.toLowerCase()
      const label = t(preset.labelKey, preset.fallback)
      return h('button', {
        key: preset.color,
        type: 'button',
        title: label,
        'aria-label': `${label} (${preset.color})`,
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
