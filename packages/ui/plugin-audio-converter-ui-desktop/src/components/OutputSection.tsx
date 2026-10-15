/**
 * Output files section: shows conversion results, file sizes, savings, and open folder actions.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ConvertTask, Uri } from '@BBeBee/protocol'
import { Button, EmptyState, IconButton, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { formatBytes } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'

export interface OutputSectionProps {
  ctx: Context
  tasks: readonly ConvertTask[]
  onRemoveTask?: (id: string) => void
  onClearFinished?: () => void
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function OutputSection({
  ctx,
  tasks,
  onRemoveTask,
  onClearFinished,
}: OutputSectionProps): ReactElement {
  const { t } = useI18n(ctx)

  const completed = tasks.filter((t) => t.status === 'completed')

  const totalOriginal = completed.reduce((sum, t) => sum + (t.sourceSize ?? 0), 0)
  const totalOutput = completed.reduce((sum, t) => sum + (t.outputSize ?? 0), 0)
  const totalSaved = totalOriginal - totalOutput
  const totalSavedPct = totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0

  const handleReveal = async (path?: string) => {
    if (!path) return
    try {
      if (ctx.shell?.revealInFileManager) {
        await ctx.shell.revealInFileManager(path as Uri)
      }
    } catch (err) {
      ctx.logger?.warn?.('Failed to reveal file in manager:', err)
    }
  }

  return h(
    'section',
    {
      'data-testid': 'converter-output-section',
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
        h(Text, { variant: 'md' }, t('converter:index.outputFiles')),
        completed.length > 0
          ? h(
              'span',
              {
                style: {
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#22C55E',
                  fontWeight: 600,
                },
              },
              `${completed.length} ${t('converter:index.completed')}`,
            )
          : null,
      ),
      completed.length > 0 && onClearFinished
        ? h(Button, {
            variant: 'ghost',
            testID: 'clear-completed-btn',
            onPress: onClearFinished,
            children: t('converter:index.clearFinished'),
          })
        : null,
    ),

    // Total Savings Summary banner
    completed.length > 0 && totalOriginal > 0 && totalOutput > 0
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${tokens.space[2]} ${tokens.space[3]}`,
              background:
                totalSaved >= 0
                  ? 'rgba(34, 197, 94, 0.08)'
                  : 'rgba(245, 158, 11, 0.08)',
              borderRadius: tokens.radius.sm,
              border: `1px solid ${
                totalSaved >= 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)'
              }`,
            },
          },
          h(
            'div',
            { style: { display: 'flex', gap: tokens.space[4], alignItems: 'center' } },
            h(
              Text,
              { variant: 'sm', tone: 'muted' },
              `${t('converter:index.original')}: ${formatBytes(totalOriginal)} → ${t(
                'converter:index.output',
              )}: ${formatBytes(totalOutput)}`,
            ),
          ),
          h(
            'span',
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                color: totalSaved >= 0 ? '#22C55E' : '#F59E0B',
              },
            },
            totalSaved >= 0
              ? `${t('converter:index.savedSpace')}: ${formatBytes(totalSaved)} (-${totalSavedPct}%)`
              : `+${Math.abs(totalSavedPct)}% (${formatBytes(Math.abs(totalSaved))})`,
          ),
        )
      : null,

    // Empty state or Completed files list
    completed.length === 0
      ? h(EmptyState, {
          icon: 'check',
          title: t('converter:index.noOutputFiles'),
          description: t('converter:index.outputPlaceholder'),
        })
      : h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
          completed.map((task) => {
            const fileName = task.fileName || task.outputUri.split(/[/\\]/).pop() || 'Unknown'
            const savedBytes =
              task.sourceSize && task.outputSize ? task.sourceSize - task.outputSize : 0
            const savedPct =
              task.sourceSize && task.outputSize && task.sourceSize > 0
                ? Math.round((savedBytes / task.sourceSize) * 100)
                : 0

            return h(
              'div',
              {
                key: task.id,
                'data-testid': `output-row-${task.id}`,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: `${tokens.space[2]} ${tokens.space[3]}`,
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
                  borderRadius: tokens.radius.sm,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
                },
              },
              // Left: Format badge + File info
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[3],
                    minWidth: 0,
                    flex: 1,
                  },
                },
                h(
                  'span',
                  {
                    style: {
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: tokens.radius.sm,
                      background: 'rgba(34, 197, 94, 0.15)',
                      color: '#22C55E',
                      letterSpacing: '0.05em',
                      flexShrink: 0,
                    },
                  },
                  task.targetFormat.toUpperCase(),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                      overflow: 'hidden',
                    },
                  },
                  h(
                    Text,
                    { variant: 'sm', numberOfLines: 1 },
                    fileName,
                  ),
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: tokens.space[2],
                        marginTop: 2,
                      },
                    },
                    task.outputUri
                      ? h(
                          Text,
                          {
                            variant: 'xs',
                            tone: 'muted',
                            numberOfLines: 1,
                          },
                          task.outputUri,
                        )
                      : null,
                    task.durationMs
                      ? h(
                          Text,
                          { variant: 'xs', tone: 'muted' },
                          `• ${formatDuration(task.durationMs)}`,
                        )
                      : null,
                  ),
                ),
              ),

              // Middle: Sizes & Savings
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[3],
                    margin: `0 ${tokens.space[3]}`,
                    flexShrink: 0,
                  },
                },
                task.outputSize
                  ? h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                        },
                      },
                      h(
                        Text,
                        { variant: 'sm' },
                        formatBytes(task.outputSize),
                      ),
                      task.sourceSize
                        ? h(
                            Text,
                            { variant: 'xs', tone: 'muted' },
                            `${t('converter:index.was')} ${formatBytes(task.sourceSize)}`,
                          )
                        : null,
                    )
                  : null,

                savedPct !== 0
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            savedBytes >= 0
                              ? 'rgba(34, 197, 94, 0.15)'
                              : 'rgba(245, 158, 11, 0.15)',
                          color: savedBytes >= 0 ? '#22C55E' : '#F59E0B',
                        },
                      },
                      savedBytes >= 0 ? `-${savedPct}%` : `+${Math.abs(savedPct)}%`,
                    )
                  : null,
              ),

              // Right: Action buttons
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                    flexShrink: 0,
                  },
                },
                task.outputUri
                  ? h(Button, {
                      variant: 'secondary',
                      testID: `reveal-btn-${task.id}`,
                      onPress: () => void handleReveal(task.outputUri),
                      children: t('converter:index.revealInFolder'),
                    })
                  : null,
                onRemoveTask
                  ? h(IconButton, {
                      icon: 'trash',
                      variant: 'ghost',
                      size: 16,
                      accessibilityLabel: t('converter:index.remove'),
                      testID: `remove-output-btn-${task.id}`,
                      onPress: () => onRemoveTask(task.id),
                    })
                  : null,
              ),
            )
          }),
        ),
  )
}
