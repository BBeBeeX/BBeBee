import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'

export interface PluginSearchBoxProps {
  ctx: Context
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function PluginSearchBox({
  ctx,
  value,
  onChange,
  placeholder,
}: PluginSearchBoxProps): ReactElement {
  const { t } = useI18n(ctx)
  const effectivePlaceholder = placeholder ?? t('settings:pluginSearchBox.searchPlugins')
  return h(
    'div',
    {
      style: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        marginBottom: 20,
      },
    },
    h(
      'span',
      {
        style: {
          position: 'absolute',
          left: 12,
          display: 'flex',
          alignItems: 'center',
          color: 'var(--text-tertiary, #8E8E93)',
          pointerEvents: 'none',
        },
      },
      tablerIcon('search', { size: 16 }),
    ),
    h('input', {
      type: 'text',
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      placeholder: effectivePlaceholder,
      'aria-label': effectivePlaceholder,
      'data-testid': 'plugin-search-input',
      style: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 36px 9px 36px',
        fontSize: 13,
        borderRadius: 8,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
        background: 'rgba(255, 255, 255, 0.04)',
        color: 'var(--text-primary, #FFFFFF)',
        outline: 'none',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      },
      onFocus: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = 'var(--color-primary, #5F87FF)'
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)'
      },
      onBlur: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle, rgba(255, 255, 255, 0.12))'
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'
      },
    }),
    value
      ? h(
          'button',
          {
            type: 'button',
            onClick: () => onChange(''),
            'aria-label': t('settings:pluginSearchBox.clearSearch'),
            'data-testid': 'plugin-search-clear',
            style: {
              position: 'absolute',
              right: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: 'var(--text-tertiary, #8E8E93)',
              cursor: 'pointer',
              borderRadius: 4,
            },
          },
          tablerIcon('x', { size: 14 }),
        )
      : null,
  )
}
