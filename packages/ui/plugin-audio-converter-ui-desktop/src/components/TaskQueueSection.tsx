/**
 * Real-time Task Queue, progress tracking, and task actions section.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ConvertTask } from '@BBeBee/protocol'
import { Button, IconButton, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface TaskQueueSectionProps {
  ctx: Context
  tasks: readonly ConvertTask[]
  onCancelTask: (id: string) => void
  onRetryTask: (id: string) => void
  onRemoveTask: (id: string) => void
  onClearFinished: () => void
}

export function TaskQueueSection({
  ctx,
  tasks,
  onCancelTask,
  onRetryTask,
  onRemoveTask,
  onClearFinished,
}: TaskQueueSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const [selectedLogsTask, setSelectedLogsTask] = useState<ConvertTask | null>(null)

  const pending = tasks.filter((t) => t.status === 'pending').length
  const processing = tasks.filter((t) => t.status === 'processing').length

  const getStatusColor = (status: ConvertTask['status']): string => {
    switch (status) {
      case 'completed':
        return '#22C55E'
      case 'processing':
        return 'var(--color-primary, #5F87FF)'
      case 'failed':
        return '#EF4444'
      case 'cancelled':
        return '#9CA3AF'
      default:
        return '#F59E0B'
    }
  }

  return h(
    'section',
    {
      'data-testid': 'converter-queue-section',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        padding: tokens.space[4],
        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
        borderRadius: tokens.radius.md,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    // Header
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[2] } },
        h(Text, { variant: 'md' }, t('converter:index.queue')),
        processing > 0
          ? h(
              'span',
              {
                style: {
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'var(--color-primary-subtle, rgba(95, 135, 255, 0.15))',
                  color: 'var(--color-primary, #5F87FF)',
                  fontWeight: 600,
                },
              },
              `${processing} active`,
            )
          : null,
        pending > 0
          ? h(Text, { variant: 'xs', tone: 'muted' }, `${pending} waiting`)
          : null,
      ),
      tasks.some((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
        ? h(Button, {
            variant: 'ghost',
            onPress: onClearFinished,
            testID: 'converter-clear-finished',
            children: t('converter:index.clearFinished'),
          })
        : null,
    ),

    // Tasks List
    tasks.length === 0
      ? h(
          'div',
          {
            style: {
              padding: tokens.space[6],
              textAlign: 'center',
              color: 'var(--text-tertiary, #8B92A6)',
              fontSize: 13,
            },
          },
          t('converter:index.noTasksYet'),
        )
      : h(
          'ul',
          {
            'data-testid': 'converter-tasks-list',
            style: {
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
              maxHeight: 280,
              overflowY: 'auto',
            },
          },
          ...tasks.map((task) =>
            h(
              'li',
              {
                key: task.id,
                'data-testid': `converter-task-row-${task.id}`,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  padding: tokens.space[3],
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
                  borderRadius: tokens.radius.sm,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.space[2],
                      minWidth: 0,
                    },
                  },
                  // Status dot
                  h('span', {
                    style: {
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: getStatusColor(task.status),
                      flexShrink: 0,
                    },
                  }),
                  // File name & conversion direction
                  h(
                    Text,
                    { numberOfLines: 1, style: { fontWeight: 600, fontSize: 13 } },
                    task.fileName,
                  ),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 11,
                        color: 'var(--text-tertiary, #8B92A6)',
                        fontWeight: 500,
                      },
                    },
                    `→ ${task.targetFormat.toUpperCase()}`,
                  ),
                ),
                // Actions
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: tokens.space[1] } },
                  task.status === 'processing' || task.status === 'pending'
                    ? h(Button, {
                        variant: 'secondary',
                        onPress: () => onCancelTask(task.id),
                        testID: `converter-task-cancel-${task.id}`,
                        children: t('converter:index.cancel'),
                      })
                    : null,
                  task.status === 'failed' || task.status === 'cancelled'
                    ? h(Button, {
                        variant: 'secondary',
                        onPress: () => onRetryTask(task.id),
                        testID: `converter-task-retry-${task.id}`,
                        children: t('converter:index.retry'),
                      })
                    : null,
                  task.error
                    ? h(Button, {
                        variant: 'ghost',
                        onPress: () => setSelectedLogsTask(task),
                        testID: `converter-task-logs-${task.id}`,
                        children: t('converter:index.logs'),
                      })
                    : null,
                  h(IconButton, {
                    icon: 'trash',
                    variant: 'ghost',
                    size: 16,
                    accessibilityLabel: 'Delete task',
                    onPress: () => onRemoveTask(task.id),
                    testID: `converter-task-remove-${task.id}`,
                  }),
                ),
              ),
              // Progress Bar & Stage indicator
              task.status === 'processing' || task.status === 'pending'
                ? h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      },
                    },
                    h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: 'var(--text-tertiary, #8B92A6)',
                        },
                      },
                      h('span', null, `Stage: ${task.stage}`),
                      h('span', null, `${task.progress}%`),
                    ),
                    h(
                      'div',
                      {
                        style: {
                          width: '100%',
                          height: 4,
                          borderRadius: 2,
                          background: 'rgba(255, 255, 255, 0.1)',
                          overflow: 'hidden',
                        },
                      },
                      h('div', {
                        style: {
                          width: `${task.progress}%`,
                          height: '100%',
                          background: 'var(--color-primary, #5F87FF)',
                          transition: 'width 0.2s ease',
                        },
                      }),
                    ),
                  )
                : null,
            ),
          ),
        ),

    // Log modal if error opened
    selectedLogsTask
      ? h(
          'div',
          {
            style: {
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            },
            onClick: () => setSelectedLogsTask(null),
          },
          h(
            'div',
            {
              style: {
                background: 'var(--surface-overlay, #1E2028)',
                padding: tokens.space[4],
                borderRadius: tokens.radius.md,
                maxWidth: 500,
                width: '90%',
                maxHeight: '80%',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.space[3],
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
              },
              onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
            },
            h(Text, { variant: 'md' }, `Logs: ${selectedLogsTask.fileName}`),
            h(
              'pre',
              {
                style: {
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  fontSize: 12,
                  color: '#EF4444',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                },
              },
              selectedLogsTask.error || selectedLogsTask.logs?.join('\n') || 'No error logs',
            ),
            h(Button, {
              variant: 'secondary',
              onPress: () => setSelectedLogsTask(null),
              children: 'Close',
            }),
          ),
        )
      : null,
  )
}
