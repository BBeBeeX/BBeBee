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
import type { ScanSpecifiedDir, Uri } from '@BBeBee/protocol'
import { summarise, useScanErrors, useScanSpecifiedDirs, useScanState } from '@BBeBee/plugin-local-scanner/hooks'
import { Button, EmptyState, IconButton, List, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export function ScanSpecifiedDirsScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const dirs = useScanSpecifiedDirs(ctx)
  const scan = useScanState(ctx)
  const scanErrors = useScanErrors(ctx)

  const addFolder = async () => {
    // The picker is what carries a durable permission grant on Android; a
    // typed path would not, so there is deliberately no text field here.
    let uri: string | undefined = undefined
    if (ctx.fs?.pickDirectory) {
      try {
        uri = await ctx.fs.pickDirectory()
      } catch (err) {
        ctx.logger.warn(`fs.pickDirectory failed: ${String(err)}`)
      }
    }
    if (!uri) {
      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as { BBeBee?: { dialog?: { pickDirectory?: () => Promise<string | undefined> } } }).BBeBee
          : undefined
      if (bridge?.dialog?.pickDirectory) {
        const picked = await bridge.dialog.pickDirectory()
        if (picked) {
          const normalized = picked.replace(/\\/g, '/')
          uri = normalized.startsWith('file://')
            ? normalized
            : normalized.startsWith('/')
              ? `file://${normalized}`
              : `file:///${normalized}`
        }
      }
    }
    if (uri && ctx.scanner) {
      const dir = await ctx.scanner.addSpecifiedDir(uri as Uri)
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
    // The file currently being read — the thing that answers "is it stuck,
    // and on what" when the counts stop moving.
    scan.running && scan.progress?.currentFile
      ? h(Text, {
          variant: 'sm',
          tone: 'muted',
          numberOfLines: 1,
          children: scan.progress.currentFile,
        })
      : null,
    // Files that failed, with reasons — a count without the list is
    // unactionable. Only shown when not running; during a scan the list is
    // still being written.
    !scan.running && scanErrors.length > 0
      ? h(
          'section',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
              padding: tokens.space[3],
              borderRadius: tokens.radius.md,
              background: 'var(--bg-secondary, #f5f5f5)',
            },
          },
          h(Text, {
            variant: 'md',
            tone: 'warn',
            children: t('localScanner:index.scanErrorsCount', { count: scanErrors.length }),
          }),
          h(
            List<{ uri: string; error: string }>,
            {
              items: [...scanErrors],
              accessibilityLabel: t('localScanner:index.scanErrors'),
              estimatedItemSize: tokens.size.row,
              keyExtractor: (item) => item.uri,
              renderItem: (item) =>
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: tokens.space[1],
                      padding: `${tokens.space[2]} 0`,
                    },
                  },
                  h(Text, { variant: 'sm', numberOfLines: 1, children: item.uri }),
                  h(Text, { variant: 'sm', tone: 'error', numberOfLines: 2, children: item.error }),
                ),
            },
          ),
        )
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

export const inject = ['ui', 'scanner', 'fs']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-local-scanner-ui-desktop: loaded')
}

export default { name, inject, apply }
