/**
 * React Native views for `@bbebee/plugin-lan-sync`.
 *
 * One screen: the mirrored session while following (now playing, transport
 * controls, leave), otherwise leaders heard on the network plus the manual
 * address fallback. The mobile tab bar is a fixed four — a deliberate
 * product decision — so the entrance is a settings link row (the same
 * pattern the history screen uses), contributed here where the row exists.
 */

import { createElement as h, useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SyncCommand } from '@BBeBee/protocol'
import { LAN_SYNC_VIEWS } from '@bbebee/plugin-lan-sync/views'
import {
  useLanSyncLeaders,
  useLanSyncSession,
  useLanSyncSettings,
  useMirrorPosition,
} from '@bbebee/plugin-lan-sync/hooks'
import { Button, TextField, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

const ACCENT = '#39d353'

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function MirrorPanel({ ctx, onError }: { ctx: Context; onError: (message: string | undefined) => void }): ReactElement {
  const native = nativePrimitives()
  const session = useLanSyncSession(ctx)
  const position = useMirrorPosition(ctx)
  const snapshot = session?.snapshot
  if (session?.role !== 'follower' || !snapshot || !session.leader) return h(native.View as never, {})

  const command = (cmd: SyncCommand): void => {
    onError(undefined)
    void ctx.lanSync.sendCommand(cmd).catch((error) => onError(String((error as Error).message ?? error)))
  }
  const progress = position && position.durationMs > 0 ? Math.min(1, position.positionMs / position.durationMs) : 0

  return h(
    native.View as never,
    {
      style: {
        gap: tokens.space[3],
        padding: tokens.space[4],
        borderRadius: tokens.radius.md,
        borderWidth: 1,
        borderColor: 'rgba(57, 211, 83, 0.3)',
        backgroundColor: 'rgba(57, 211, 83, 0.07)',
      },
    },
    h(Text, { variant: 'xs', tone: 'muted' }, `Listening with ${session.leader.name}`),
    h(Text, { variant: 'lg', style: { fontWeight: '700' } }, snapshot.track?.title ?? 'Nothing playing'),
    snapshot.track?.artist ? h(Text, { variant: 'sm', tone: 'muted' }, snapshot.track.artist) : null,
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255, 255, 255, 0.12)', overflow: 'hidden' } },
        h(native.View as never, {
          style: { width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: ACCENT },
        }),
      ),
      h(
        Text,
        { variant: 'xs', tone: 'muted' },
        `${formatMs(position?.positionMs ?? 0)} / ${formatMs(snapshot.durationMs)}`,
      ),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2], alignItems: 'center', flexWrap: 'wrap' } },
      h(Button, { onPress: () => command({ action: 'previous' }), variant: 'ghost', children: '⏮' }),
      h(Button, {
        onPress: () => command({ action: 'toggle' }),
        variant: 'primary',
        children: position?.playing ? '⏸ Pause' : '▶ Play',
      }),
      h(Button, { onPress: () => command({ action: 'next' }), variant: 'ghost', children: '⏭' }),
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
  )
}

function LeaderRows({ ctx, onError }: { ctx: Context; onError: (message: string | undefined) => void }): ReactElement {
  const native = nativePrimitives()
  const leaders = useLanSyncLeaders(ctx)
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

  const join = (id: string): void => {
    onError(undefined)
    void ctx.lanSync.joinLeader(id).catch((error) => onError(String((error as Error).message ?? error)))
  }

  return h(
    native.View as never,
    { style: { gap: tokens.space[3] } },
    h(Text, { variant: 'sm', style: { fontWeight: '700' } }, 'On this network'),
    leaders.length === 0
      ? h(
          Text,
          { variant: 'sm', tone: 'muted' },
          'No devices yet. They appear once another BBeBee device on this network is running.',
        )
      : null,
    ...leaders.map((leader) =>
      h(
        native.View as never,
        {
          key: leader.id,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[3],
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.08)',
          },
        },
        h(
          native.View as never,
          { style: { flex: 1, minWidth: 0 } },
          h(Text, { variant: 'sm', style: { fontWeight: '700' } }, leader.name),
          h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1 }, `${leader.platform} · ${leader.host}:${leader.httpPort}`),
        ),
        h(Button, { onPress: () => join(leader.id), variant: 'primary', children: 'Listen' }),
      ),
    ),
    h(Text, { variant: 'sm', style: { fontWeight: '700' } }, 'Connect by address'),
    h(TextField, { value: hostDraft, placeholder: 'e.g. 192.168.1.9', onChange: setHostDraft }),
    h(TextField, { value: portDraft, placeholder: 'Port', onChange: setPortDraft }),
    h(Button, { onPress: () => void connect(), variant: 'secondary', children: 'Connect' }),
  )
}

export function LanSyncScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const session = useLanSyncSession(ctx)
  const settings = useLanSyncSettings(ctx)
  const [error, setError] = useState<string | undefined>(undefined)
  const following = session?.role === 'follower'

  return h(
    native.ScrollView as never,
    {
      style: { flex: 1 },
      contentContainerStyle: {
        padding: tokens.space[4],
        gap: tokens.space[4],
        paddingBottom: 160,
      },
    },
    h(Text, { variant: 'lg', style: { fontWeight: '700' } }, 'Listen Together'),
    error ? h(Text, { variant: 'sm', style: { color: '#ff453a' } }, error) : null,
    following ? h(MirrorPanel, { ctx, onError: setError }) : null,
    following ? null : h(LeaderRows, { ctx, onError: setError }),
    // The roster + the visibility toggle matter on both sides.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
      h(Text, { variant: 'sm', tone: 'muted', style: { flex: 1 } }, 'Visible to other devices'),
      h(Button, {
        onPress: () => void ctx.lanSync.updateSettings({ discovery: !(settings?.discovery ?? true) }).catch(() => undefined),
        variant: 'secondary',
        children: settings?.discovery ? 'On' : 'Off',
      }),
    ),
    session && session.followers.length > 0
      ? h(
          native.View as never,
          { style: { gap: tokens.space[2] } },
          h(Text, { variant: 'sm', style: { fontWeight: '700' } }, `Listening with you (${session.followers.length})`),
          ...session.followers.map((follower) =>
            h(
              native.View as never,
              {
                key: follower.sessionId,
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.md,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.08)',
                },
              },
              h(
                native.View as never,
                { style: { flex: 1 } },
                h(Text, { variant: 'sm' }, follower.name),
                h(Text, { variant: 'xs', tone: 'muted' }, follower.platform),
              ),
            ),
          ),
        )
      : null,
  )
}

export const name = 'plugin-lan-sync-ui-mobile'

export const inject = ['ui', 'lanSync']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lan-sync-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LAN_SYNC_VIEWS.host, bound(ctx, LanSyncScreen))
    /*
     * The sync screen's mobile entrance. The shell's tab bar is a fixed
     * four — a deliberate product decision — so the page has no tab and
     * would otherwise ship unreachable. A settings link row is the answer
     * the settings screen already knows how to draw (the same pattern the
     * history screen uses): a contribution with no `action` renders as a
     * row whose button hands the id to `ui.navigate`.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: 'lan-sync.host',
      section: 'general',
      title: 'Listen Together',
      order: 71,
    })
  }, 'lan-sync-ui-mobile')
}

export default { name, inject, apply }
