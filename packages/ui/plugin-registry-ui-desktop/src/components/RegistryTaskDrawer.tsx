/**
 * The registry task center drawer: every tracked install/update operation,
 * newest first, with its kind, stage, progress, error text and start time.
 *
 * It is the kit's `Sheet` — the same overlay/card chrome the install confirm
 * dialog uses, no bespoke modal. All state comes in through props from
 * `useRegistryTasks` (the service's snapshot); the drawer holds none.
 *
 * Status chips share one treatment (`statusChip`): colored text over a tint
 * of the same tone — 进行中 primary, 成功 green, 失败 red, 等待确认 neutral.
 * Rows carry a slim progress bar when the record knows its done/total; the
 * empty state uses the package's shared ghost-icon treatment.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { RegistryEntryKind, RegistryTask } from '@BBeBee/protocol'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { formatDateTime } from '../utils/format.js'
import { RegistryEmptyState } from './RegistryEmptyState.js'
import { CHIP, GHOST_BUTTON, TONE, statusChip } from '../styles.js'

export interface RegistryTaskDrawerProps {
  tasks: readonly RegistryTask[]
  /** False when the service lacks the optional `clearFinishedTasks`. */
  canClear: boolean
  onClearFinished: () => void
  onClose: () => void
}

const KIND_LABELS: Record<RegistryEntryKind, string> = {
  'music-source': '音乐源',
  'lyric-source': '歌词源',
  theme: '界面主题',
  plugin: '插件',
}

const RUN_STAGE_LABELS: Record<RegistryTask['stage'], string> = {
  download: '下载中',
  verify: '校验中',
  install: '安装中',
}

/** The status chip's text and tone, straight off the service's record. */
function statusFor(task: RegistryTask): { label: string; color: string } {
  switch (task.status) {
    case 'pending':
      // Waiting on the user is a neutral state, not an active one.
      return { label: '等待确认', color: TONE.neutral }
    case 'running':
      return { label: RUN_STAGE_LABELS[task.stage], color: TONE.primary }
    case 'success':
      return { label: '成功', color: TONE.success }
    case 'failed':
      return { label: '失败', color: TONE.error }
  }
}

const clearButtonStyle = (enabled: boolean) =>
  ({
    ...GHOST_BUTTON,
    padding: '4px 12px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.45,
  }) as const

const rowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
} as const

const progressBarStyle = {
  height: 4,
  borderRadius: 999,
  background: 'var(--surface-3, rgba(255, 255, 255, 0.10))',
  overflow: 'hidden',
} as const

const errorBoxStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: TONE.error,
  background: 'color-mix(in srgb, var(--color-error, #F43F5E) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--color-error, #F43F5E) 25%, transparent)',
  borderRadius: 6,
  padding: '6px 8px',
  wordBreak: 'break-word',
} as const

export function RegistryTaskDrawer({
  tasks,
  canClear,
  onClearFinished,
  onClose,
}: RegistryTaskDrawerProps): ReactElement {
  const finishedCount = tasks.filter((task) => task.status === 'success' || task.status === 'failed').length
  const clearEnabled = canClear && finishedCount > 0

  return h(
    Sheet,
    {
      open: true,
      onClose,
      title: '任务',
      accessibilityLabel: '任务中心',
    },
    h(
      'div',
      { 'data-testid': 'registry-task-drawer', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          tasks.length > 0
            ? `安装与更新记录（新 → 旧，共 ${tasks.length} 条）`
            : '安装与更新记录',
        ),
        clearEnabled
          ? h(
              'button',
              {
                type: 'button',
                'data-testid': 'registry-tasks-clear',
                onClick: onClearFinished,
                className: 'bbreg-btn bbreg-btn-ghost',
                style: clearButtonStyle(true),
              },
              tablerIcon('trash', { size: 12 }),
              '清空已完成',
            )
          : h(
              'button',
              {
                type: 'button',
                'data-testid': 'registry-tasks-clear',
                disabled: true,
                style: clearButtonStyle(false),
              },
              '清空已完成',
            ),
      ),
      tasks.length === 0
        ? h(
            'div',
            { 'data-testid': 'registry-tasks-empty' },
            h(RegistryEmptyState, {
              icon: 'list-check',
              title: '暂无任务',
              description: '安装音乐源、主题或插件时会在这里显示进度',
              compact: true,
            }),
          )
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' } },
            tasks.map((task) => {
              const status = statusFor(task)
              return h(
                'div',
                {
                  key: task.id,
                  'data-testid': `registry-task-item-${task.id}`,
                  style: rowStyle,
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { style: CHIP }, KIND_LABELS[task.kind]),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--text-primary, #F5F7FF)',
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    task.entryName,
                  ),
                  h(
                    'span',
                    {
                      'data-testid': `registry-task-status-${task.id}`,
                      style: statusChip(status.color),
                    },
                    status.label,
                  ),
                ),
                task.progress
                  ? h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      h(
                        'div',
                        { style: { ...progressBarStyle, flex: 1 } },
                        h('div', {
                          style: {
                            height: '100%',
                            width: `${
                              task.progress.total > 0
                                ? Math.min(100, Math.round((task.progress.done / task.progress.total) * 100))
                                : 100
                            }%`,
                            borderRadius: 999,
                            background: 'var(--gradient-progress, linear-gradient(90deg, #4F73FF 0%, #B28CFF 100%))',
                          },
                        }),
                      ),
                      h(
                        'span',
                        {
                          style: {
                            fontSize: 11,
                            color: 'var(--text-tertiary, #8B95B0)',
                            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          },
                        },
                        `${task.progress.done}/${task.progress.total}`,
                      ),
                    )
                  : null,
                task.error ? h('div', { style: errorBoxStyle }, task.error) : null,
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-tertiary, #8B95B0)' } },
                  tablerIcon('clock', { size: 11 }),
                  formatDateTime(task.startedAt),
                ),
              )
            }),
          ),
    ),
  )
}
