/**
 * The listen-together screen.
 *
 * Not following: leaders heard on the network (join with one click) plus the
 * manual-address fallback for networks where multicast is blocked. Following:
 * the mirrored now-playing with transport controls and the leave button.
 * Always: the follower roster for this device — every device is passively a
 * potential leader, so "who is listening with me" is always meaningful.
 *
 * All state lives in `ctx.lanSync`; these components only subscribe.
 */

import { createElement as h, useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SyncCommand, SyncLeaderInfo } from '@BBeBee/protocol'
import {
  useLanSyncLeaders,
  useLanSyncSession,
  useLanSyncSettings,
  useMirrorPosition,
} from '@bbebee/plugin-lan-sync/hooks'
import { Button, Switch, TextField } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

const ERROR_COLOR = 'rgba(255, 105, 97, 0.9)'

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function LeaderList({
  leaders,
  onJoin,
}: {
  leaders: readonly SyncLeaderInfo[]
  onJoin: (id: string) => void
}): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h('div', { style: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold } }, 'On this network'),
    leaders.length === 0
      ? h(
          'div',
          { style: { fontSize: tokens.font.size.sm, color: 'var(--text-secondary, #8e8e93)' } },
          'No devices yet. They appear once another BBeBee device on this network opens this screen.',
        )
      : leaders.map((leader) =>
          h(
            'div',
            {
              key: leader.id,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[3],
                padding: tokens.space[3],
                borderRadius: tokens.radius.md,
                border: '1px solid rgba(255, 255, 255, 0.08)',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold } }, leader.name),
              h(
                'div',
                { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
                `${leader.platform} · ${leader.host}:${leader.httpPort}`,
              ),
            ),
            h(Button, { onPress: () => onJoin(leader.id), variant: 'primary', children: 'Listen' }),
          ),
        ),
  )
}

function ManualConnect({ ctx, onError }: { ctx: Context; onError: (message: string | undefined) => void }): ReactElement {
  const [hostDraft, setHostDraft] = useState('')
  const [portDraft, setPortDraft] = useState('53318')

  const connect = useCallback(async () => {
    onError(undefined)
    const port = Number(portDraft)
    if (!hostDraft.trim() || !Number.isInteger(port) || port <= 0 || port > 65_535) {
      onError('Enter a host and a port between 1 and 65535.')
      return
    }
    try {
      await ctx.lanSync.connectByAddress(hostDraft.trim(), port)
    } catch (error) {
      onError(String((error as Error).message ?? error))
    }
  }, [ctx, hostDraft, portDraft, onError])

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h('div', { style: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold } }, 'Connect by address'),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center', flexWrap: 'wrap' } },
      h('div', { style: { width: 180 } }, h(TextField, { value: hostDraft, placeholder: 'e.g. 192.168.1.9', onChange: setHostDraft })),
      h('div', { style: { width: 90 } }, h(TextField, { value: portDraft, placeholder: 'Port', onChange: setPortDraft })),
      h(Button, { onPress: () => void connect(), variant: 'secondary', children: 'Connect' }),
    ),
  )
}

function MirrorPanel({ ctx, onCommand, onError }: { ctx: Context; onCommand: (cmd: SyncCommand) => void; onError: (message: string | undefined) => void }): ReactElement {
  const session = useLanSyncSession(ctx)
  const position = useMirrorPosition(ctx)
  const snapshot = session?.snapshot
  if (session?.role !== 'follower' || !snapshot || !session.leader) return h('div', {}, '')

  const progress = position && position.durationMs > 0 ? Math.min(1, position.positionMs / position.durationMs) : 0
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        padding: tokens.space[4],
        borderRadius: tokens.radius.md,
        border: '1px solid rgba(87, 242, 135, 0.25)',
        background: 'rgba(87, 242, 135, 0.06)',
      },
    },
    h(
      'div',
      { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
      `Listening with ${session.leader.name}`,
    ),
    h(
      'div',
      { style: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.bold } },
      snapshot.track?.title ?? 'Nothing playing',
    ),
    snapshot.track?.artist
      ? h('div', { style: { fontSize: tokens.font.size.sm, color: 'var(--text-secondary, #8e8e93)' } }, snapshot.track.artist)
      : null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.12)', overflow: 'hidden' } },
        h('div', {
          style: { width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--accent, #57f287)' },
        }),
      ),
      h(
        'div',
        { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)', fontVariantNumeric: 'tabular-nums' } },
        `${formatMs(position?.positionMs ?? 0)} / ${formatMs(snapshot.durationMs)}`,
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
      h(Button, { onPress: () => onCommand({ action: 'previous' }), variant: 'ghost', children: '⏮' }),
      h(
        Button,
        {
          onPress: () => onCommand({ action: 'toggle' }),
          variant: 'primary',
          children: position?.playing ? '⏸ Pause' : '▶ Play',
        },
      ),
      h(Button, { onPress: () => onCommand({ action: 'next' }), variant: 'ghost', children: '⏭' }),
      h(
        Button,
        {
          onPress: () => {
            onError(undefined)
            void ctx.lanSync.leave().catch((error) => onError(String((error as Error).message ?? error)))
          },
          variant: 'secondary',
          children: 'Leave',
        },
      ),
    ),
    snapshot.queue && snapshot.queue.length > 0
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1], marginTop: tokens.space[2] } },
          h(
            'div',
            { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
            'Up next',
          ),
          ...snapshot.queue.slice(0, 8).map((item) =>
            h(
              'div',
              { key: item.urn, style: { fontSize: tokens.font.size.sm } },
              `${item.title}${item.artist ? ` — ${item.artist}` : ''}`,
            ),
          ),
        )
      : null,
  )
}

function FollowerRoster({ ctx }: { ctx: Context }): ReactElement | null {
  const session = useLanSyncSession(ctx)
  if (!session || session.followers.length === 0) return null
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
    h(
      'div',
      { style: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold } },
      `Listening with you (${session.followers.length})`,
    ),
    ...session.followers.map((follower) =>
      h(
        'div',
        {
          key: follower.sessionId,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          },
        },
        h(
          'div',
          { style: { flex: 1 } },
          h('div', { style: { fontSize: tokens.font.size.sm } }, follower.name),
          h(
            'div',
            { style: { fontSize: tokens.font.size.xs, color: 'var(--text-secondary, #8e8e93)' } },
            `${follower.platform} · synced ${Math.max(0, Math.round((Date.now() - follower.lastSeen) / 1000))}s ago`,
          ),
        ),
      ),
    ),
  )
}

export function LanSyncScreen({ ctx }: { ctx: Context }): ReactElement {
  const leaders = useLanSyncLeaders(ctx)
  const session = useLanSyncSession(ctx)
  const settings = useLanSyncSettings(ctx)
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const follow = session?.role === 'follower'
  const command = useCallback(
    (cmd: SyncCommand) => {
      setError(undefined)
      void ctx.lanSync.sendCommand(cmd).catch((err) => setError(String((err as Error).message ?? err)))
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
    // Header: identity + discovery.
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3], flexWrap: 'wrap' } },
      h(
        'div',
        { style: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.bold, marginRight: tokens.space[2] } },
        'Listen Together',
      ),
      h(TextField, {
        value: nameDraft ?? settings?.deviceName ?? '',
        placeholder: 'Device name',
        onChange: setNameDraft,
        disabled: !settings,
      }),
      h(
        Button,
        {
          onPress: () => {
            if (nameDraft !== undefined && nameDraft.trim()) {
              void ctx.lanSync.updateSettings({ deviceName: nameDraft.trim() }).catch(() => undefined)
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
          onChange: (checked) => void ctx.lanSync.updateSettings({ discovery: checked }).catch(() => undefined),
          accessibilityLabel: 'Visible to other devices on the local network',
        }),
        'Visible to others',
      ),
      h(Button, { onPress: () => ctx.lanSync.refresh(), variant: 'ghost', children: 'Refresh' }),
    ),

    error ? h('div', { style: { fontSize: tokens.font.size.sm, color: ERROR_COLOR } }, error) : null,

    follow ? h(MirrorPanel, { ctx, onCommand: command, onError: setError }) : null,

    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[4], alignItems: 'flex-start', flexWrap: 'wrap' } },
      h(
        'div',
        { style: { flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
        follow
          ? null
          : h(LeaderList, {
              leaders,
              onJoin: (id) => {
                setError(undefined)
                void ctx.lanSync.joinLeader(id).catch((err) => setError(String((err as Error).message ?? err)))
              },
            }),
        follow ? null : h(ManualConnect, { ctx, onError: setError }),
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
        h(FollowerRoster, { ctx }),
      ),
    ),
  )
}
