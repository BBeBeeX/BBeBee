/**
 * OutputCard — completed conversions on mobile: where the file landed, what it
 * cost, and what it saved. The desktop's "Show in Folder" action has no
 * equivalent on a phone, so the location itself is the payload here: the row
 * shows the output URI the task reports.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ConvertTask } from '@BBeBee/protocol'
import { Button, nativePrimitives, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { formatBytes } from '@BBeBee/toolkit'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export interface OutputCardProps {
  ctx: Context
  tasks: readonly ConvertTask[]
  onRemoveTask: (id: string) => void
  onClearFinished: () => void
}

/** Saved bytes as a signed percentage string; `0` hides. */
export function savedPercent(sourceSize?: number, outputSize?: number): string | undefined {
  if (!sourceSize || !outputSize || sourceSize <= 0) return undefined
  const saved = sourceSize - outputSize
  const pct = Math.round((Math.abs(saved) / sourceSize) * 100)
  if (pct === 0) return undefined
  return saved >= 0 ? `-${pct}%` : `+${pct}%`
}

export function OutputCard({
  ctx,
  tasks,
  onRemoveTask,
  onClearFinished,
}: OutputCardProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)

  const completed = tasks.filter((task) => task.status === 'completed')
  const totalOriginal = completed.reduce((sum, task) => sum + (task.sourceSize ?? 0), 0)
  const totalOutput = completed.reduce((sum, task) => sum + (task.outputSize ?? 0), 0)
  const totalSaved = totalOriginal - totalOutput
  const totalSavedPct = totalOriginal > 0 ? Math.round((Math.abs(totalSaved) / totalOriginal) * 100) : 0

  return h(
    native.View as never,
    {
      testID: 'converter-output-card',
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
      h(Text, { variant: 'md' }, t('converter:index.outputFiles')),
      completed.length > 0
        ? h(Button, {
            variant: 'ghost',
            testID: 'converter-clear-completed',
            accessibilityLabel: t('converter:index.clearFinished'),
            onPress: onClearFinished,
            children: t('converter:index.clearFinished'),
          })
        : null,
    ),

    completed.length === 0
      ? h(Text, { variant: 'sm', tone: 'muted' }, t('converter:index.noOutputFiles'))
      : null,

    completed.length > 0 && totalOriginal > 0 && totalOutput > 0
      ? h(
          native.View as never,
          {
            testID: 'converter-savings-banner',
            style: {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: tokens.space[2],
              borderRadius: tokens.radius.sm,
              backgroundColor: totalSaved >= 0 ? 'rgba(30, 216, 96, 0.08)' : 'rgba(255, 164, 43, 0.08)',
            },
          },
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            `${formatBytes(totalOriginal)} → ${formatBytes(totalOutput)}`,
          ),
          h(
            Text,
            { variant: 'xs', tone: totalSaved >= 0 ? 'ok' : 'warn' },
            t('converter:index.savedSpace', { space: `${formatBytes(Math.abs(totalSaved))} (${totalSavedPct}%)` }),
          ),
        )
      : null,

    ...completed.map((task) => {
      const fileName = task.fileName || task.outputUri.split(/[/\\]/).pop() || 'Unknown'
      const pct = savedPercent(task.sourceSize, task.outputSize)
      return h(
        native.View as never,
        {
          key: task.id,
          testID: `converter-output-row-${task.id}`,
          style: {
            gap: 2,
            padding: tokens.space[2],
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: tokens.radius.sm,
            borderWidth: 1,
            borderColor: p().border.subtle,
          },
        },
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
          h(
            native.View as never,
            {
              style: {
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: tokens.radius.sm,
                backgroundColor: 'rgba(30, 216, 96, 0.15)',
              },
            },
            h(Text, { variant: 'xs' }, task.targetFormat.toUpperCase()),
          ),
          h(
            native.View as never,
            { style: { flex: 1, minWidth: 0 } },
            h(Text, { variant: 'sm', numberOfLines: 1 }, fileName),
          ),
          pct
            ? h(Text, { variant: 'xs', tone: pct.startsWith('-') ? 'ok' : 'warn' }, pct)
            : null,
        ),
        // The output location — the row's reason to exist on mobile.
        task.outputUri
          ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 2 }, task.outputUri)
          : null,
        h(
          Text,
          { variant: 'xs', tone: 'muted' },
          [
            task.outputSize ? formatBytes(task.outputSize) : undefined,
            task.sourceSize
              ? `${t('converter:index.was')} ${formatBytes(task.sourceSize)}`
              : undefined,
            task.durationMs ? `${Math.round(task.durationMs / 1000)}s` : undefined,
          ]
            .filter((part): part is string => part !== undefined)
            .join(' · '),
        ),
        h(Button, {
          variant: 'ghost',
          testID: `converter-output-remove-${task.id}`,
          accessibilityLabel: t('converter:index.remove'),
          onPress: () => onRemoveTask(task.id),
          children: t('converter:index.remove'),
        }),
      )
    }),
  )
}
