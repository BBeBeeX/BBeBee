/**
 * TaskQueueCard — the conversion queue on mobile: status, live progress and
 * stage, and the cancel / retry / remove actions, mirroring the desktop
 * `TaskQueueSection` row for row.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ConvertTask, TaskStatus } from '@BBeBee/protocol'
import { Button, nativePrimitives, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export interface TaskQueueCardProps {
  ctx: Context
  tasks: readonly ConvertTask[]
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onRemoveTask: (id: string) => void
  onClearFinished: () => void
}

/** The status dot's colour — the desktop `getStatusColor`, in palette tokens. */
export function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return p().state.ok
    case 'processing':
      return p().accent.base
    case 'failed':
      return p().state.error
    case 'cancelled':
      return p().text.secondary
    default:
      return p().state.warn
  }
}

export function TaskQueueCard({
  ctx,
  tasks,
  onCancelTask,
  onRetryTask,
  onRemoveTask,
  onClearFinished,
}: TaskQueueCardProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)

  const pending = tasks.filter((task) => task.status === 'pending').length
  const processing = tasks.filter((task) => task.status === 'processing').length
  const hasFinished = tasks.some(
    (task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled',
  )

  return h(
    native.View as never,
    {
      testID: 'converter-queue-card',
      style: {
        gap: tokens.space[2],
        padding: tokens.space[3],
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: tokens.radius.md,
      },
    },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(Text, { variant: 'md' }, t('converter:index.queue')),
      hasFinished
        ? h(Button, {
            variant: 'ghost',
            testID: 'converter-clear-finished',
            accessibilityLabel: t('converter:index.clearFinished'),
            onPress: onClearFinished,
            children: t('converter:index.clearFinished'),
          })
        : null,
    ),
    processing > 0 || pending > 0
      ? h(
          Text,
          { variant: 'xs', tone: 'muted' },
          `${processing} active · ${pending} waiting`,
        )
      : null,

    tasks.length === 0
      ? h(Text, { variant: 'sm', tone: 'muted' }, t('converter:index.noTasksYet'))
      : null,

    ...tasks.map((task) =>
      h(
        native.View as never,
        {
          key: task.id,
          testID: `converter-task-row-${task.id}`,
          style: {
            gap: tokens.space[1],
            padding: tokens.space[2],
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderRadius: tokens.radius.sm,
            borderWidth: 1,
            borderColor: p().border.subtle,
          },
        },
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
          h(native.View as never, {
            style: {
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: statusColor(task.status),
            },
          }),
          h(
            native.View as never,
            { style: { flex: 1, minWidth: 0 } },
            h(Text, { variant: 'sm', numberOfLines: 1 }, task.fileName),
          ),
          h(Text, { variant: 'xs', tone: 'muted' }, `→ ${task.targetFormat.toUpperCase()}`),
        ),

        task.status === 'processing' || task.status === 'pending'
          ? h(
              native.View as never,
              { style: { gap: 2 } },
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                `${task.stage} · ${task.progress}%`,
              ),
              h(
                native.View as never,
                {
                  style: {
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    overflow: 'hidden',
                  },
                },
                h(native.View as never, {
                  testID: `converter-task-progress-${task.id}`,
                  style: {
                    width: `${Math.max(0, Math.min(100, task.progress))}%`,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: p().accent.base,
                  },
                }),
              ),
            )
          : null,

        task.error
          ? h(Text, { variant: 'xs', tone: 'error', numberOfLines: 2 }, task.error)
          : null,

        h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
          task.status === 'processing' || task.status === 'pending'
            ? h(Button, {
                variant: 'secondary',
                testID: `converter-task-cancel-${task.id}`,
                accessibilityLabel: t('converter:index.cancel'),
                onPress: () => onCancelTask(task.id),
                children: t('converter:index.cancel'),
              })
            : null,
          task.status === 'failed' || task.status === 'cancelled'
            ? h(Button, {
                variant: 'secondary',
                testID: `converter-task-retry-${task.id}`,
                accessibilityLabel: t('converter:index.retry'),
                onPress: () => onRetryTask(task.id),
                children: t('converter:index.retry'),
              })
            : null,
          h(Button, {
            variant: 'ghost',
            testID: `converter-task-remove-${task.id}`,
            accessibilityLabel: t('converter:index.remove'),
            onPress: () => onRemoveTask(task.id),
            children: t('converter:index.remove'),
          }),
        ),
      ),
    ),
  )
}
