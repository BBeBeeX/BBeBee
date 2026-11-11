/** The transfer log — offers answered, sends, receives — newest first. */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LanShareTransfer } from '@BBeBee/protocol'
import { EmptyState, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

const STATE_TONE: Record<LanShareTransfer['state'], string> = {
  pending: 'var(--text-secondary, #8e8e93)',
  accepted: 'var(--text-secondary, #8e8e93)',
  declined: 'var(--text-secondary, #8e8e93)',
  transferring: 'var(--color-primary, #57f287)',
  completed: 'var(--success, #39d353)',
  failed: 'rgba(255, 105, 97, 0.9)',
  cancelled: 'var(--text-secondary, #8e8e93)',
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exp = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]!}`
}

/** Done files / total for a transfer — the honest granularity the transport gives. */
function progressOf(transfer: LanShareTransfer): string {
  const done = transfer.items.filter((i) => i.transferredBytes !== undefined).length
  return `${done}/${transfer.items.length}`
}

export function TransferList({
  ctx,
  transfers,
}: {
  ctx: Context
  transfers: readonly LanShareTransfer[]
}): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h(
      'div',
      { style: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.medium } },
      'Transfers',
    ),
    transfers.length === 0
      ? h(EmptyState, { title: t('share:lanShare.noTransfersYet'), description: t('share:lanShare.pickDeviceToSend') })
      : h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
          transfers.map((transfer) =>
            h(
              'div',
              {
                key: transfer.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: tokens.space[2],
                  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
                  borderRadius: tokens.radius.sm,
                  background: 'var(--surface-selected, rgba(255,255,255,0.04))',
                },
              },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.sm } },
                  `${transfer.direction === 'send' ? '→' : '←'} ${transfer.peer.name} · ${transfer.items.length} file(s)`,
                ),
                transfer.error
                  ? h(
                      'div',
                      { style: { fontSize: tokens.font.size.xs, color: STATE_TONE.failed } },
                      transfer.error.slice(0, 100),
                    )
                  : null,
              ),
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
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                  formatBytes(transfer.items.reduce((sum, i) => sum + i.sizeBytes, 0)),
                ),
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.xs, color: STATE_TONE[transfer.state] } },
                  transfer.state === 'transferring' ? progressOf(transfer) : transfer.state,
                ),
                transfer.state === 'pending' || transfer.state === 'transferring' || transfer.state === 'accepted'
                  ? h(
                      'button',
                      {
                        onClick: () => void ctx.lanShare.cancelTransfer(transfer.id).catch(() => undefined),
                        style: {
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-secondary, #8e8e93)',
                          cursor: 'pointer',
                          fontSize: tokens.font.size.xs,
                        },
                      },
                      'Cancel',
                    )
                  : null,
              ),
            ),
          ),
        ),
  )
}
