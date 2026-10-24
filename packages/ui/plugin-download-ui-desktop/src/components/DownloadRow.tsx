import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadTask, PlayerService } from '@BBeBee/protocol'
import { downloadProgress, holdLabel } from '@bbebee/plugin-download/hooks'
import { Button, IconButton, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import type { UseI18nResult } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { formatBytes } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { p } from './palette.js'
import { ProgressBar } from './ProgressBar.js'

export function DownloadRow({ ctx, task }: { ctx: Context; task: DownloadTask }): ReactElement {
  const { t } = useI18n(ctx)
  const scheme = p()
  const progress = downloadProgress(task)
  const player = serviceOf<PlayerService>(ctx, 'player')

  return h(
    'li',
    {
      'data-testid': `download-${task.id}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        padding: tokens.space[3],
        borderRadius: tokens.radius.sm,
        background: scheme.bg.raised,
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
      h(Text, { numberOfLines: 1 }, task.title),
      task.artist ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, task.artist) : null,
      h(
        Text,
        {
          variant: 'xs',
          tone: task.state === 'failed' ? 'error' : 'muted',
          numberOfLines: 1,
        },
        statusLine(t, task),
      ),
      progress !== undefined
        ? h(ProgressBar, { value: progress, label: t('download:download.progressFor', { title: task.title }) })
        : null,
    ),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], flexShrink: 0 } },
      ...actionsFor(t, ctx, task, player),
    ),
  )
}

/**
 * What one task can do next.
 *
 * Derived from the state rather than from capabilities, because every task is
 * owned by this service: `done` offers play and delete, `failed` offers retry
 * and delete, and the four moving states split on whether they are currently
 * transferring.
 */
function actionsFor(
  t: UseI18nResult['t'],
  ctx: Context,
  task: DownloadTask,
  player: PlayerService | undefined,
): ReactElement[] {
  const actions: ReactElement[] = []

  if (task.state === 'done') {
    actions.push(
      h(Button, {
        key: 'play',
        variant: 'secondary',
        onPress: () => void player?.playNow([task.trackUrn]),
        disabled: !player,
        testID: `download-play-${task.id}`,
        children: t('download:index.play'),
      }),
      h(IconButton, {
        key: 'remove',
        icon: 'trash',
        accessibilityLabel: t('download:index.deleteTask', { title: task.title }),
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    )
    return actions
  }

  if (task.state === 'failed' || task.state === 'canceled') {
    actions.push(
      h(Button, {
        key: 'retry',
        variant: 'secondary',
        onPress: () => void ctx.downloads.retry(task.id),
        testID: `download-retry-${task.id}`,
        children: t('app:common.retry'),
      }),
      h(IconButton, {
        key: 'remove',
        icon: 'trash',
        accessibilityLabel: t('download:index.deleteTask', { title: task.title }),
        onPress: () => void ctx.downloads.remove(task.id),
        testID: `download-remove-${task.id}`,
      }),
    )
    return actions
  }

  if (task.state === 'paused') {
    actions.push(
      h(Button, {
        key: 'resume',
        variant: 'secondary',
        onPress: () => void ctx.downloads.resume(task.id),
        testID: `download-resume-${task.id}`,
        children: t('download:index.resume'),
      }),
    )
  } else {
    actions.push(
      h(Button, {
        key: 'pause',
        variant: 'ghost',
        onPress: () => void ctx.downloads.pause(task.id),
        testID: `download-pause-${task.id}`,
        children: t('download:index.pause'),
      }),
    )
  }

  actions.push(
    h(IconButton, {
      key: 'cancel',
      icon: 'x',
      accessibilityLabel: t('download:index.cancelTask', { title: task.title }),
      onPress: () => void ctx.downloads.cancel(task.id),
      testID: `download-cancel-${task.id}`,
    }),
  )
  return actions
}

/** One line saying where a task is, in the user's terms. */
function statusLine(t: UseI18nResult['t'], task: DownloadTask): string {
  const hold = holdLabel(task)
  if (hold) return task.state === 'paused' ? `Paused — ${hold.toLowerCase()}` : hold
  switch (task.state) {
    case 'queued':
      return t('download:index.queued')
    case 'running':
      return task.bytesTotal
        ? t('download:index.bytesOfTotal', {
            done: formatBytes(task.bytesDone),
            total: formatBytes(task.bytesTotal),
          })
        : formatBytes(task.bytesDone)
    case 'paused':
      return t('download:index.pausedWithBytes', { bytes: formatBytes(task.bytesDone) })
    case 'done':
      // A kept download is the user's to keep; a cache entry is evictable.
      return task.kept
        ? task.quality
          ? t('download:download.downloaded', { quality: task.quality })
          : t('download:index.downloaded')
        : t('download:index.cached')
    case 'failed':
      return task.error ?? t('download:index.failed')
    case 'canceled':
      return t('download:index.canceled')
  }
}
