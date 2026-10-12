import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import { useI18n } from '@BBeBee/ui-kit-desktop'
import type { BackgroundMode } from '../utils/canvasRenderer.js'

export interface BackgroundModeSelectorProps {
  ctx: Context
  mode: BackgroundMode
  onChange: (mode: BackgroundMode) => void
  label?: string
  compact?: boolean
}

export function BackgroundModeSelector(props: BackgroundModeSelectorProps): ReactElement {
  const { t } = useI18n(props.ctx)
  const {
    mode,
    onChange,
    label = t('share:backgroundModeSelector.background'),
    compact = false,
  } = props
  const modes: Array<{ id: BackgroundMode; label: string }> = [
    {
      id: 'cover',
      label: t(compact ? 'share:backgroundModeSelector.themeColor' : 'share:backgroundModeSelector.solidThemeColor'),
    },
    { id: 'gradient', label: t('share:backgroundModeSelector.gradient') },
    { id: 'black', label: t('share:backgroundModeSelector.solidBlack') },
  ]

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: compact ? 'space-between' : 'center',
        gap: compact ? 0 : 8,
        width: '100%',
        marginTop: compact ? 0 : 6,
      },
    },
    h(
      'span',
      { style: { fontSize: 12, color: 'var(--text-muted, #8B95B0)' } },
      label,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: tokens.radius.pill,
          padding: compact ? 2 : 3,
          gap: compact ? 2 : 4,
        },
      },
      modes.map(({ id, label: modeLabel }) => {
        const isActive = mode === id
        return h(
          'button',
          {
            key: id,
            type: 'button',
            onClick: () => onChange(id),
            style: {
              background: isActive ? 'var(--button-primary-bg, #4D8BFF)' : 'transparent',
              color: isActive ? '#FFFFFF' : 'var(--text-secondary, #C5CAD8)',
              border: 'none',
              borderRadius: tokens.radius.pill,
              padding: compact ? '4px 10px' : '5px 12px',
              fontSize: compact ? 11 : 12,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            },
          },
          modeLabel,
        )
      }),
    ),
  )
}
