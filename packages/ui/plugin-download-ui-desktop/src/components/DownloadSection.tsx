import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DownloadTask } from '@BBeBee/protocol'
import { Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { DownloadRow } from './DownloadRow.js'

export function DownloadSection({
  ctx,
  title,
  tasks,
}: {
  ctx: Context
  title: string
  tasks: readonly DownloadTask[]
}): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h(Text, { variant: 'md', tone: 'muted' }, title),
    h(
      'ul',
      {
        'aria-label': title,
        style: {
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1],
        },
      },
      ...tasks.map((task) => h(DownloadRow, { key: task.id, ctx, task })),
    ),
  )
}
