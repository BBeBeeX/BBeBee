import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface LocalSourceWarningProps {
  show: boolean
  message?: string
}

export function LocalSourceWarning({
  show,
  message = "Can't share local music",
}: LocalSourceWarningProps): ReactElement | null {
  if (!show) return null

  return h(
    'div',
    {
      'data-testid': 'local-source-warning',
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(239, 68, 68, 0.15)',
        border: '1px solid rgba(239, 68, 68, 0.35)',
        color: '#FCA5A5',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
      },
    },
    tablerIcon('alert-circle', { size: 16 }),
    h('span', null, message),
  )
}
