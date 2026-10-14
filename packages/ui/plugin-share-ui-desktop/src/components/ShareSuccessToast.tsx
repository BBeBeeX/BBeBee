import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface ShareSuccessToastProps {
  message: string | null
}

export function ShareSuccessToast({ message }: ShareSuccessToastProps): ReactElement | null {
  if (!message) return null

  return h(
    'div',
    {
      'data-testid': 'share-success-toast',
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(34, 197, 94, 0.15)',
        border: '1px solid rgba(34, 197, 94, 0.35)',
        color: '#86EFAC',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
      },
    },
    tablerIcon('check', { size: 16 }),
    h('span', null, message),
  )
}
