/**
 * React DOM views for `plugin-download`.
 *
 * The download queue and what it has cached. Every value comes from
 * `@BBeBee/plugin-download/hooks` — the list, the header's numbers, one task's
 * completion — and this package is layout, gestures and event wiring only
 * (docs/08 §1).
 *
 * The one thing worth doing carefully here is the **state → controls** map.
 * A queued task can be paused but not resumed; a failed one can be retried but
 * not paused. Offering the wrong control is worse than offering none, so the
 * buttons follow the state rather than the other way round. It lives with the
 * row that renders it, in `components/DownloadRow.tsx`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { DOWNLOADS_VIEWS } from '@BBeBee/plugin-download/views'
import { summariseDownloads, useDownloadPolicy, useDownloadTasks } from '@BBeBee/plugin-download/hooks'
import { Button, EmptyState, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import type { UseI18nResult } from '@BBeBee/ui-kit-desktop'
import { formatBytes } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { DownloadSection } from './components/DownloadSection.js'
import { PolicyToggle } from './components/PolicyToggle.js'

export function DownloadsScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const tasks = useDownloadTasks(ctx)
  const policy = useDownloadPolicy(ctx)
  const summary = summariseDownloads(tasks)

  const active = tasks.filter(
    (task) => task.state === 'queued' || task.state === 'running' || task.state === 'paused',
  )
  const finished = tasks.filter((task) => !active.includes(task))
  // Kept downloads are the user's files; only their own 🗑 deletes one, so the
  // header's clear button is offered for cache entries and dead tasks only.
  const clearable = finished.filter(
    (task) => task.state === 'canceled' || (task.state === 'done' && !task.kept),
  )

  return h(
    'section',
    {
      'aria-label': t('download:index.downloads'),
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[4],
        padding: tokens.space[4],
      },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'lg' }, t('download:index.downloads')),
      h(Text, { variant: 'sm', tone: 'muted' }, summaryLine(t, summary)),
      clearable.length > 0
        ? h(Button, {
            variant: 'secondary',
            onPress: () => void ctx.downloads.clearFinished(),
            testID: 'downloads-clear',
            children: t('download:index.clearFinished'),
          })
        : null,
    ),
    // The policy applies to the queue the moment it is flipped — a held task
    // starts, or a running one is paused with its bytes kept.
    h(
      'div',
      {
        role: 'group',
        'aria-label': t('download:index.downloadNetworkPolicy'),
        style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] },
      },
      h(PolicyToggle, {
        label: t('download:index.wiFiOnly'),
        active: policy.wifiOnly,
        onPress: () => void ctx.downloads.setPolicy({ wifiOnly: !policy.wifiOnly }),
        testID: 'downloads-wifi-only',
      }),
      h(PolicyToggle, {
        label: t('download:index.chargingOnly'),
        active: policy.chargingOnly,
        onPress: () => void ctx.downloads.setPolicy({ chargingOnly: !policy.chargingOnly }),
        testID: 'downloads-charging-only',
      }),
    ),
    tasks.length === 0
      ? h(EmptyState, {
          icon: 'download',
          title: t('download:index.noDownloads'),
          description: t('download:index.emptyDescription'),
        })
      : null,
    active.length > 0
      ? h(DownloadSection, { ctx, title: t('download:index.inProgress'), tasks: active })
      : null,
    finished.length > 0
      ? h(DownloadSection, { ctx, title: t('download:index.downloaded'), tasks: finished })
      : null,
  )
}

function summaryLine(t: UseI18nResult['t'], summary: ReturnType<typeof summariseDownloads>): string {
  const parts: string[] = []
  if (summary.active) parts.push(t('download:index.inProgress2', { active: summary.active }))
  if (summary.done)
    parts.push(t('download:index.summaryDownloaded', { done: summary.done, bytes: formatBytes(summary.bytes) }))
  if (summary.failed) parts.push(t('download:index.summaryFailed', { failed: summary.failed }))
  return parts.length > 0 ? parts.join(' · ') : t('download:index.nothingYet')
}

export const name = 'plugin-download-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.downloads` through its hooks threw on a
 * device while every test passed, because tests built a root context where
 * that read answers `undefined` instead. See the note in every view package.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'downloads']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-download-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(DOWNLOADS_VIEWS.page, bound(ctx, DownloadsScreen))
  }, 'downloads-ui-desktop')
}

export default { name, inject, apply }
