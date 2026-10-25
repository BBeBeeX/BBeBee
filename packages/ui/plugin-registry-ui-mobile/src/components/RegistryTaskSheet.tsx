/**
 * The registry task center, React Native — the mobile twin of the desktop
 * package's `RegistryTaskDrawer`, as a bottom sheet.
 *
 * Every tracked install/update operation, newest first, with its kind, stage,
 * progress, error text and start time. All state comes in through props from
 * `useRegistryTasks` (the service's snapshot); the sheet holds none.
 *
 * Status colors follow the desktop chip treatment: running accent, success
 * green, failed red, awaiting confirmation neutral.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntryKind, RegistryTask } from '@BBeBee/protocol'
import { Button, EmptyState, nativePrimitives, Sheet, Text, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { formatDateTime } from '../utils/format.js'

export interface RegistryTaskSheetProps {
  /** The app context — read for the interface language. */
  ctx: Context
  tasks: readonly RegistryTask[]
  /** False when the service lacks the optional `clearFinishedTasks`. */
  canClear: boolean
  onClearFinished: () => void
  onClose: () => void
}

/** The `t()` signature from `useI18n`, for the label helpers below. */
type Translate = (key: string, params?: Record<string, string | number>) => string

const KIND_LABELS: Record<RegistryEntryKind, (t: Translate) => string> = {
  'music-source': (t) => t('registry:registry.musicSource'),
  'lyric-source': (t) => t('registry:registry.lyricSource'),
  theme: (t) => t('registry:registry.theme'),
  plugin: (t) => t('registry:registry.plugin'),
}

/** Stage labels map 1:1 onto fixed catalogue keys — no runtime key assembly. */
function stageLabel(t: Translate, stage: RegistryTask['stage']): string {
  switch (stage) {
    case 'download':
      return t('registry:registryTask.stageDownloading')
    case 'verify':
      return t('registry:registryTask.stageVerifying')
    case 'install':
      return t('registry:registryTask.stageInstalling')
  }
}

/** The status chip's text and tone, straight off the service's record. */
function statusFor(t: Translate, task: RegistryTask): { label: string; tone: 'accent' | 'ok' | 'error' | 'muted' } {
  switch (task.status) {
    case 'pending':
      // Waiting on the user is a neutral state, not an active one.
      return { label: t('registry:registryTask.awaitingConfirmation'), tone: 'muted' }
    case 'running':
      return { label: stageLabel(t, task.stage), tone: 'accent' }
    case 'success':
      return { label: t('registry:registryTask.success'), tone: 'ok' }
    case 'failed':
      return { label: t('registry:registryTask.failed'), tone: 'error' }
  }
}

export function RegistryTaskSheet({
  ctx,
  tasks,
  canClear,
  onClearFinished,
  onClose,
}: RegistryTaskSheetProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  // The palette snapshot: subscribe so a theme change repaints the sheet.
  const p = usePalette()
  const finishedCount = tasks.filter((task) => task.status === 'success' || task.status === 'failed').length
  const clearEnabled = canClear && finishedCount > 0

  return h(
    Sheet,
    {
      open: true,
      onClose,
      title: t('registry:registryTask.tasks'),
      accessibilityLabel: t('registry:registryTask.taskCenter'),
    },
    h(
      native.View as never,
      {
        testID: 'registry-task-drawer',
        style: { gap: tokens.space[3], marginTop: tokens.space[2], maxHeight: 420 },
      },
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[2] } },
        h(
          Text,
          { variant: 'xs', tone: 'muted' },
          tasks.length > 0
            ? t('registry:registryTask.recordsWithCount', { count: tasks.length })
            : t('registry:registryTask.records'),
        ),
        h(Button, {
          testID: 'registry-tasks-clear',
          variant: 'secondary',
          disabled: !clearEnabled,
          onPress: onClearFinished,
          children: t('registry:registryTask.clearFinished'),
        }),
      ),
      tasks.length === 0
        ? h(
            native.View as never,
            { testID: 'registry-tasks-empty' },
            h(EmptyState, {
              icon: '☰',
              title: t('registry:registryTask.noTasksYet'),
              description: t('registry:registryTask.progressShowsHereWhileYou'),
            }),
          )
        : h(
            native.View as never,
            { style: { gap: tokens.space[2] } },
            tasks.map((task) => {
              const status = statusFor(t, task)
              return h(
                native.View as never,
                {
                  key: task.id,
                  testID: `registry-task-item-${task.id}`,
                  style: { gap: tokens.space[1], padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle },
                },
                h(
                  native.View as never,
                  { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], flexWrap: 'wrap' } },
                  h(Text, { variant: 'xs', tone: 'muted', children: KIND_LABELS[task.kind](t) }),
                  h(Text, { variant: 'sm', numberOfLines: 1, children: task.entryName }),
                  h(
                    native.View as never,
                    {
                      testID: `registry-task-status-${task.id}`,
                      style: {
                        marginLeft: 'auto',
                        paddingHorizontal: tokens.space[2],
                        paddingVertical: 2,
                        borderRadius: tokens.radius.pill,
                        backgroundColor: p.bg.overlay,
                      },
                    },
                    h(Text, { variant: 'xs', tone: status.tone, children: status.label }),
                  ),
                ),
                task.progress
                  ? h(
                      native.View as never,
                      { key: 'progress', style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
                      h(
                        native.View as never,
                        { style: { flex: 1, height: 4, borderRadius: tokens.radius.pill, backgroundColor: p.border.subtle, overflow: 'hidden' } },
                        h(native.View as never, {
                          style: {
                            height: '100%',
                            width: `${
                              task.progress.total > 0
                                ? Math.min(100, Math.round((task.progress.done / task.progress.total) * 100))
                                : 100
                            }%`,
                            borderRadius: tokens.radius.pill,
                            backgroundColor: p.accent.base,
                          },
                        }),
                      ),
                      h(
                        Text,
                        { variant: 'xs', tone: 'muted' },
                        `${task.progress.done}/${task.progress.total}`,
                      ),
                    )
                  : null,
                task.error
                  ? h(
                      native.View as never,
                      { key: 'error', style: { padding: tokens.space[1], borderRadius: tokens.radius.sm, backgroundColor: 'rgba(244, 63, 94, 0.08)' } },
                      h(Text, { variant: 'xs', tone: 'error', children: task.error }),
                    )
                  : null,
                h(Text, { key: 'time', variant: 'xs', tone: 'muted', children: formatDateTime(task.startedAt) }),
              )
            }),
          ),
    ),
  )
}
