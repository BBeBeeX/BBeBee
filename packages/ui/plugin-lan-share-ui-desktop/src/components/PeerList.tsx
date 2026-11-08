/** The peers heard on the network, selectable for sending. */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { LanSharePeer } from '@BBeBee/protocol'
import { EmptyState } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

const ROW_HEIGHT = 52

export function PeerList({
  peers,
  selectedId,
  onSelect,
}: {
  peers: readonly LanSharePeer[]
  selectedId: string | undefined
  onSelect(id: string): void
}): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h(
      'div',
      { style: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.medium } },
      'Devices on this network',
    ),
    peers.length === 0
      ? h(EmptyState, { title: 'No devices found', description: 'Make sure BBeBee is running on the other device and both are on the same Wi-Fi.' })
      : h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
          peers.map((peer) =>
            h(
              'button',
              {
                key: peer.id,
                onClick: () => onSelect(peer.id),
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: ROW_HEIGHT,
                  padding: `0 ${tokens.space[3]}px`,
                  borderRadius: tokens.radius.md,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: peer.id === selectedId ? 'var(--surface-selected, rgba(255,255,255,0.08))' : 'transparent',
                  color: 'var(--text-primary, #f5f5f7)',
                },
              },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                h('div', { style: { fontSize: tokens.font.size.md } }, peer.name),
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                  `${peer.platform} · ${peer.host}`,
                ),
              ),
              h(
                'div',
                { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                'online',
              ),
            ),
          ),
        ),
  )
}
