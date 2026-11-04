import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { EmptyStateProps } from '@BBeBee/ui-core'
import { common, nativePrimitives, c } from '../primitives.js'
import { tablerIcon } from '../icons/tabler.js'
import { Text } from './Text.js'

export function EmptyState(props: EmptyStateProps): ReactElement {
  const native = nativePrimitives()
  const iconNode = props.icon
    ? (tablerIcon(props.icon, { size: 36, color: c().text.secondary }) ??
       h(Text, { variant: 'xl', children: props.icon }))
    : null
  return h(
    native.View as never,
    {
      ...common(props),
      style: {
        alignItems: 'center',
        gap: tokens.space[2],
        padding: tokens.space[6],
      },
    },
    iconNode,
    h(Text, { variant: 'lg', children: props.title }),
    props.description ? h(Text, { tone: 'muted', children: props.description }) : null,
    props.action as ReactNode,
  )
}

