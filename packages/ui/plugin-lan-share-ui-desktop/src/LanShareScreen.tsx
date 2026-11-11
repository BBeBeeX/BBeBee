/**
 * The LAN transfer screen.
 *
 * Left column: peers + the send panel for the selected peer. Right column:
 * incoming offers awaiting an answer, then the transfer log. Settings (device
 * name, discovery, auto-accept) sit in the header.
 *
 * All state lives in `ctx.lanShare`; these components only subscribe.
 */

import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LanShareIncomingRequest } from '@BBeBee/protocol'
import { useLanSharePeers, useLanShareSettings, useLanShareTransfers } from '@bbebee/plugin-lan-share/hooks'
import { Button, Switch, TextField, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { PeerList } from './components/PeerList.js'
import { SendPanel } from './components/SendPanel.js'
import { TransferList, formatBytes } from './components/TransferList.js'

const ERROR_COLOR = 'rgba(255, 105, 97, 0.9)'
const OFFER_BACKGROUND = 'rgba(87, 242, 135, 0.08)'
const OFFER_BORDER = '1px solid rgba(87, 242, 135, 0.25)'

/** Offers the receiver has not answered yet — LocalSend-style prompts. */
function IncomingOffers({ ctx }: { ctx: Context }): ReactElement | null {
  const [live, setLive] = useState<LanShareIncomingRequest[]>([])

  useEffect(() => {
    const seen = new Set<string>()
    const off = ctx.on('lan-share/incoming', (request: LanShareIncomingRequest) => {
      if (seen.has(request.id)) return
      seen.add(request.id)
      setLive((prev) => [...prev, request])
    })
    return () => {
      off()
    }
  }, [ctx])

  const answer = (id: string, which: 'accept' | 'decline'): void => {
    setLive((prev) => prev.filter((r) => r.id !== id))
    live.find((r) => r.id === id)?.[which]()
  }

  if (live.length === 0) return null
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    live.slice(-3).map((request: LanShareIncomingRequest) =>
      h(
        'div',
        {
          key: request.id,
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[2],
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            background: OFFER_BACKGROUND,
            border: OFFER_BORDER,
          },
        },
        h(
          'div',
          { style: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold } },
          `${request.peer.name} wants to send ${request.items.length} file(s)`,
        ),
        h(
          'div',
          { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
          request.items
            .map((f) => `${f.fileName} (${formatBytes(f.sizeBytes)})`)
            .join(', ')
            .slice(0, 140),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: tokens.space[2] } },
          h(Button, { onPress: () => answer(request.id, 'accept'), variant: 'primary', children: 'Accept' }),
          h(Button, { onPress: () => answer(request.id, 'decline'), variant: 'ghost', children: 'Decline' }),
        ),
      ),
    ),
  )
}

export function LanShareScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const peers = useLanSharePeers(ctx)
  const transfers = useLanShareTransfers(ctx)
  const settings = useLanShareSettings(ctx)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined)
  const [sendError, setSendError] = useState<string | undefined>(undefined)

  const selected = peers.find((p) => p.id === selectedId)

  const send = useCallback(
    async (peerId: string, urns: readonly string[]): Promise<void> => {
      setSendError(undefined)
      try {
        await ctx.lanShare.sendTo(peerId, urns)
      } catch (error) {
        setSendError(String((error as Error).message ?? error))
      }
    },
    [ctx],
  )

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[4],
        padding: tokens.space[4],
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
      },
    },
    // Header: identity + discovery/auto-accept.
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3], flexWrap: 'wrap' } },
      h(
        'div',
        { style: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.bold, marginRight: tokens.space[2] } },
        'LAN Transfer',
      ),
      h(TextField, {
        value: nameDraft ?? settings?.deviceName ?? '',
        placeholder: t('share:lanShare.deviceName'),
        onChange: setNameDraft,
        disabled: !settings,
      }),
      h(
        Button,
        {
          onPress: () => {
            if (nameDraft !== undefined && nameDraft.trim()) {
              void ctx.lanShare.updateSettings({ deviceName: nameDraft.trim() }).catch(() => undefined)
              setNameDraft(undefined)
            }
          },
          variant: 'secondary',
          disabled: nameDraft === undefined || !nameDraft.trim() || nameDraft === settings?.deviceName,
          children: 'Rename',
        },
      ),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2], fontSize: tokens.font.size.sm } },
        h(Switch, {
          checked: settings?.discovery ?? false,
          onChange: (checked) => void ctx.lanShare.updateSettings({ discovery: checked }).catch(() => undefined),
          accessibilityLabel: 'Discoverable on the local network',
        }),
        'Discoverable',
      ),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2], fontSize: tokens.font.size.sm } },
        h(Switch, {
          checked: settings?.autoAccept ?? false,
          onChange: (checked) => void ctx.lanShare.updateSettings({ autoAccept: checked }).catch(() => undefined),
          accessibilityLabel: 'Auto-accept incoming offers',
        }),
        'Auto-accept',
      ),
      h(Button, { onPress: () => ctx.lanShare.refresh(), variant: 'ghost', children: 'Refresh' }),
    ),

    h(IncomingOffers, { ctx }),

    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[4], flex: 1, minHeight: 0, alignItems: 'stretch' } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
        h(PeerList, { peers, selectedId, onSelect: setSelectedId, t }),
        selected ? h(SendPanel, { ctx, peer: selected, onSend: send }) : null,
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
        sendError
          ? h('div', { style: { fontSize: tokens.font.size.sm, color: ERROR_COLOR } }, sendError)
          : null,
        h(TransferList, { ctx, transfers }),
      ),
    ),
  )
}
