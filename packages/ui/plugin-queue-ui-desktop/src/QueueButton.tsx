import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { QUEUE_VIEWS } from '@BBeBee/plugin-queue/views'

export interface QueueButtonProps {
  ctx: Context
  currentRoute?: string
}

/**
 * Button on the bottom transport bar to open/toggle the queue panel.
 */
export function QueueButton({
  ctx,
  currentRoute,
}: QueueButtonProps): ReactElement {
  const [activeRoute, setActiveRoute] = useState<string | undefined>(currentRoute)

  useEffect(() => {
    if (currentRoute !== undefined) {
      setActiveRoute(currentRoute)
    }
  }, [currentRoute])

  useEffect(() => {
    const off = ctx.on('ui/navigate', (id: string) => {
      setActiveRoute(id)
    })
    return () => void off()
  }, [ctx])

  const isQueueActive = activeRoute === QUEUE_VIEWS.queue || activeRoute === 'queue.view'

  const handleClick = () => {
    ctx.ui?.navigate?.(QUEUE_VIEWS.queue)
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': '播放队列',
      title: '播放队列',
      'data-testid': 'queue-button',
      onClick: handleClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: tokens.radius.sm,
        border: 'none',
        background: isQueueActive ? 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.15))' : 'transparent',
        color: isQueueActive ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, rgba(255, 255, 255, 0.7))',
        cursor: 'pointer',
        fontSize: 18,
        transition: 'all 0.15s ease',
        outline: 'none',
        flexShrink: 0,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = 'var(--bb-text-primary, #FFFFFF)'
        e.currentTarget.style.transform = 'scale(1.08)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = isQueueActive ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, rgba(255, 255, 255, 0.7))'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    tablerIcon('playlist', { size: 20 }),
  )
}
