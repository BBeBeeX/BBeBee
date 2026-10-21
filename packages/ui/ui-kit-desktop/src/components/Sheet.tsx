import { createElement as h, useRef, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { SheetProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'

export function Sheet(props: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  if (!props.open) return null
  return h(
    'div',
    {
      ...common(props),
      role: 'dialog',
      'aria-modal': true,
      ref,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') props.onClose()
      },
      style: {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 6, 11, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: tokens.z.overlay,
      },
      onClick: props.onClose,
    },
    h(
      'div',
      {
        onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
        style: {
          minWidth: 320,
          maxWidth: 560,
          maxHeight: 'min(90vh, 800px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: tokens.space[5],
          borderRadius: tokens.radius.lg,
          background: 'var(--surface-1, #0D101A)',
          border: '1px solid var(--border-default, rgba(148,163,184,0.14))',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.7), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255, 255, 255, 0.14)), var(--glow-xs)',
          color: 'var(--text-primary, #F5F7FF)',
        },
      },
      props.title ? h('h2', { style: { margin: `0 0 ${tokens.space[3]}px`, flexShrink: 0 } }, props.title) : null,
      props.children as ReactNode,
    ),
  )
}
