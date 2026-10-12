import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'

export interface ShareModalHeaderProps {
  ctx: Context
  title: string
  onClose: () => void
}

export function ShareModalHeader({ ctx, title, onClose }: ShareModalHeaderProps): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    'div',
    {
      style: {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
      },
    },
    h(
      'span',
      { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
      title,
    ),
    h(
      'button',
      {
        type: 'button',
        onClick: onClose,
        'aria-label': t('app:common.close'),
        style: {
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted, #8B95B0)',
          cursor: 'pointer',
          display: 'flex',
          padding: 4,
        },
      },
      tablerIcon('x', { size: 18 }),
    ),
  )
}
