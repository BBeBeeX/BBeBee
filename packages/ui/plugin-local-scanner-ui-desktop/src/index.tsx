/**
 * React DOM views for `plugin-local-scanner`.
 *
 * The scan-root settings screen: which folders, what happened last time, and
 * a way to start a walk. Layout and wiring only — the progress bookkeeping is
 * in `plugin-local-scanner/hooks`, shared with the mobile twin (docs/08 1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { ScanSpecifiedDir } from '@BBeBee/protocol'
import { SCANNER_VIEWS } from '@BBeBee/plugin-local-scanner/views'
import { summarise, useScanSpecifiedDirs, useScanState } from '@BBeBee/plugin-local-scanner/hooks'
import { Button, EmptyState, IconButton, List, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export function ScanSpecifiedDirsScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const dirs = useScanSpecifiedDirs(ctx)
  const scan = useScanState(ctx)

  const addFolder = async () => {
    // The picker is what carries a durable permission grant on Android; a
    // typed path would not, so there is deliberately no text field here.
    const uri = await ctx.fs.pickDirectory()
    if (uri) {
      const dir = await ctx.scanner.addSpecifiedDir(uri)
      void ctx.scanner.scan({ specifiedDirId: dir.id })
    }
  }

  return h(
    'section',
    { style: { padding: tokens.space[4], display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(Text, { variant: 'lg', children: t('localScanner:index.musicFolders') }),
      h(Button, { onPress: () => void addFolder(), children: t('localScanner:index.addFolder') }),
      h(Button, {
        variant: 'secondary',
        // Disabled while running rather than hidden: a control that vanishes
        // mid-scan makes the screen look like it lost the button.
        disabled: scan.running,
        onPress: () => void ctx.scanner.scan(),
        accessibilityLabel: t('localScanner:index.scanNow'),
        children: scan.running ? t('localScanner:index.scanning') : t('localScanner:index.scanNow'),
      }),
      scan.running
        ? h(Button, {
            variant: 'ghost',
            onPress: () => ctx.scanner.cancel(),
            children: t('app:common.cancel'),
          })
        : null,
    ),
    // Progress per batch, not per scan: a large library takes minutes, and a
    // screen that only learned the outcome would look frozen throughout.
    scan.progress
      ? h(Text, {
          tone: 'muted',
          accessibilityLabel: t('localScanner:index.scanProgress'),
          children: scan.progress.total
            ? t('localScanner:index.scannedOf', { done: scan.progress.done, total: scan.progress.total })
            : t('localScanner:index.scannedFiles', { done: scan.progress.done }),
        })
      : scan.lastSummary
        ? h(Text, {
            tone: scan.lastSummary.errors > 0 ? 'warn' : 'muted',
            children: t('localScanner:index.lastScan', { summary: summarise(scan.lastSummary) }),
          })
        : null,
    h(List<ScanSpecifiedDir>, {
      items: dirs,
      accessibilityLabel: t('localScanner:index.musicFolders'),
      estimatedItemSize: tokens.size.row,
      keyExtractor: (dir) => dir.id,
      empty: h(EmptyState, {
        icon: 'folder',
        title: t('localScanner:index.noFoldersYet'),
        description: t('localScanner:index.addOneAndItsMusic'),
      }),
      renderItem: (dir) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[3],
              height: tokens.size.row,
              opacity: dir.enabled ? 1 : 0.5,
            },
          },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(Text, { numberOfLines: 1, children: dir.uri }),
            // The reason a folder failed, kept in front of the user rather
            // than only in a log they will never open.
            dir.lastError
              ? h(Text, { variant: 'sm', tone: 'error', numberOfLines: 1, children: dir.lastError })
              : null,
          ),
          h(Button, {
            variant: 'ghost',
            disabled: scan.running || !dir.enabled,
            onPress: () => void ctx.scanner.scan({ specifiedDirId: dir.id }),
            accessibilityLabel: t('localScanner:index.scanUri', { uri: dir.uri }),
            children: t('localScanner:index.scan'),
          }),
          h(Button, {
            variant: 'ghost',
            onPress: () => void ctx.scanner.setEnabled(dir.id, !dir.enabled),
            accessibilityLabel: dir.enabled
              ? t('localScanner:index.disableUri', { uri: dir.uri })
              : t('localScanner:index.enableUri', { uri: dir.uri }),
            children: dir.enabled ? t('localScanner:index.disable') : t('localScanner:index.enable'),
          }),
          h(IconButton, {
            icon: 'trash',
            // Removing a specified dir keeps its tracks by default: losing a library
            // to a mis-clicked button is far worse than a stale row.
            accessibilityLabel: t('localScanner:index.removeUri', { uri: dir.uri }),
            onPress: () => void ctx.scanner.removeSpecifiedDir(dir.id),
          }),
        ),
    }),
    h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: t('localScanner:index.removeKeepsTracks'),
    }),
  )
}

export const name = 'plugin-local-scanner-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.scanner` through its hooks threw
 * `cannot get property "scanner" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}


export const inject = ['ui', 'scanner', 'fs']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-local-scanner-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SCANNER_VIEWS.settings, bound(ctx, ScanSpecifiedDirsScreen))
  }, 'scanner-ui-desktop')
}

export default { name, inject, apply }
