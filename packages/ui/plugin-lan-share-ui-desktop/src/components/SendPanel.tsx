/**
 * The send panel: search the local library, send matches to a peer.
 *
 * One search box over `ctx.sources.searchLocal` — the FTS index over rows
 * already stored — with a send button per match and a send-all for the
 * current page. Selection grows into a small cart so a multi-track send is
 * one offer instead of one per click.
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { Button, TextField } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import type { LanSharePeer } from '@BBeBee/protocol'

export function SendPanel({
  ctx,
  peer,
  onSend,
}: {
  ctx: Context
  peer: LanSharePeer
  onSend(peerId: string, urns: readonly string[]): Promise<void>
}): ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const searchToken = useRef(0)

  useEffect(() => {
    const term = query.trim()
    const token = ++searchToken.current
    const sources = ctx.sources as {
      searchLocal(text: string, opts?: { limit?: number }): Promise<{ tracks?: { items: readonly Track[] } }>
    }
    const timer = setTimeout(() => {
      void sources
        .searchLocal(term, { limit: 30 })
        .then((result) => {
          if (token === searchToken.current) setResults([...(result.tracks?.items ?? [])])
        })
        .catch(() => {
          if (token === searchToken.current) setResults([])
        })
    }, 180)
    return () => clearTimeout(timer)
  }, [ctx, query])

  const toggle = useCallback((urn: string): void => {
    setSelected((prev) => (prev.includes(urn) ? prev.filter((u) => u !== urn) : [...prev, urn]))
  }, [])

  const sendCart = useCallback(async (): Promise<void> => {
    if (selected.length === 0) return
    setSending(true)
    try {
      await onSend(peer.id, selected)
      setSelected([])
    } finally {
      setSending(false)
    }
  }, [onSend, peer.id, selected])

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[2],
        padding: tokens.space[3],
        borderRadius: tokens.radius.md,
        border: '1px solid var(--border-focus, rgba(255,255,255,0.15))',
      },
    },
    h(
      'div',
      { style: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.medium } },
      `Send to ${peer.name}`,
    ),
    h(TextField, { value: query, onChange: setQuery, placeholder: 'Search your library…' }),
    selected.length > 0
      ? h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
          h(
            'div',
            { style: { fontSize: tokens.font.size.sm, color: 'var(--text-secondary, #8e8e93)' } },
            `${selected.length} selected`,
          ),
          h(
            Button,
            {
              onPress: () => void sendCart(),
              variant: 'primary',
              loading: sending,
              children: `Send ${selected.length} song${selected.length === 1 ? '' : 's'}`,
            },
          ),
          h(Button, { onPress: () => setSelected([]), variant: 'ghost', disabled: sending, children: 'Clear' }),
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1], overflow: 'auto', maxHeight: 320 } },
      results.length === 0
        ? h(
            'div',
            { style: { fontSize: tokens.font.size.sm, color: 'var(--text-secondary, #8e8e93)', padding: tokens.space[2] } },
            query.trim() ? 'No matches in your library.' : 'Type to search the local library.',
          )
        : results.map((track) =>
            h(
              'button',
              {
                key: track.urn,
                onClick: () => toggle(track.urn),
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: tokens.space[2],
                  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
                  borderRadius: tokens.radius.sm,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: selected.includes(track.urn)
                    ? 'var(--surface-selected, rgba(255,255,255,0.08))'
                    : 'transparent',
                  color: 'var(--text-primary, #f5f5f7)',
                },
              },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  track.title,
                ),
                h(
                  'div',
                  { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                  track.artists?.map((a) => a.name).join(', ') ?? '',
                ),
              ),
              h(
                'div',
                { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                selected.includes(track.urn) ? '✓' : '+',
              ),
            ),
          ),
    ),
  )
}
