import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import { useMiniPlayerState } from '@BBeBee/plugin-mini-player/hooks'

export interface MiniPlayerButtonProps {
  ctx: Context
  style?: Record<string, unknown>
}

export function MiniPlayerButton({ ctx, style }: MiniPlayerButtonProps): ReactElement {
  const { visible, toggle } = useMiniPlayerState(ctx)

  return h(
    'button',
    {
      type: 'button',
      'aria-label': visible ? '关闭小窗模式' : '打开小窗模式 / 灵动岛',
      title: visible ? '关闭小窗模式' : '打开小窗模式 / 灵动岛',
      onClick: () => toggle(),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: tokens.radius.sm,
        border: visible ? '1px solid var(--color-primary, #5F87FF)' : '1px solid var(--border-subtle, rgba(145, 176, 255, 0.14))',
        background: visible ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'transparent',
        color: visible ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))',
        boxShadow: visible ? 'var(--glow-brand-sm, 0 0 12px rgba(117, 152, 255, 0.18))' : 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
        ...style,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        if (!visible) {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.1))'
          e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
        }
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        if (!visible) {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary, rgba(255, 255, 255, 0.7))'
        }
      },
    },
    // Floating Window / Picture-in-picture Icon
    h(
      'svg',
      {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // Outer screen
      h('rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }),
      // Mini floating window in corner
      h('rect', { x: 12, y: 9, width: 8, height: 6, rx: 1, fill: 'currentColor' }),
    ),
  )
}
