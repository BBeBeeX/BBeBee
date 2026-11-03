/**
 * React Native views for `@bbebee/plugin-queue`.
 *
 * Screen: the up-next list and recently played history tabs.
 * Every value comes from the shared bindings in `@BBeBee/toolkit/hooks` /
 * `@bbebee/plugin-player/hooks` — the queue model belongs to the player,
 * this package handles layout, presentation, and event wiring only (docs/08 §1).
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { PlayRecord, QueueItem, QueueSourceContext, SettingsService, Track } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { QUEUE_VIEWS } from '@bbebee/plugin-queue/views'
import {
  queueTrackFallback,
  usePlayHistory,
  useQueue,
  useTracksByUrn,
  useTransport,
  useUpcoming,
} from '@bbebee/plugin-player/hooks'
import { ContextMenu, EmptyState, List, Text, TrackRow, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@bbebee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { serviceOf } from '@BBeBee/ui-core'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

/** Catalogue keys for the label shown for a context that carries a kind but no label. */
const CONTEXT_KIND_LABEL_KEYS: Record<QueueSourceContext['kind'], string> = {
  album: 'queue:index.contextKindLabels.album',
  playlist: 'queue:index.contextKindLabels.playlist',
  artist: 'queue:index.contextKindLabels.artist',
  search: 'queue:index.contextKindLabels.search',
  radio: 'queue:index.contextKindLabels.radio',
  local: 'queue:index.contextKindLabels.local',
  favorites: 'queue:index.contextKindLabels.favorites',
}

function formatRelativeTime(
  t: (key: string, params?: Record<string, string | number>) => string,
  timestamp: number,
): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('queue:index.justNow')
  if (minutes < 60) return t('queue:index.minAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('queue:index.hrAgo', { hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('queue:index.daysAgo', { days })
  return new Date(timestamp).toLocaleDateString()
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

export interface QueueScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The up-next list and recently played history screen. */
export function QueueScreen({ ctx, onClose }: QueueScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const queue = useQueue(ctx)
  const upcoming = useUpcoming(ctx)
  const state = useTransport(ctx)
  const menu = useTrackMenu(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const native = nativePrimitives()

  // Track hydration for queue
  const queueTracks = useTracksByUrn(ctx, queue.map((item) => item.trackUrn))

  const currentIdx = useMemo(() => {
    let idx = queue.findIndex(
      (item) =>
        item.id === state.currentItemId ||
        (state.trackUrn && item.trackUrn === state.trackUrn),
    )
    if (idx === -1 && queue.length > 0) idx = 0
    return idx
  }, [queue, state.currentItemId, state.trackUrn])

  const currentItem = queue[currentIdx] ?? queue[0]

  // Play history resolution (de-duplicated by trackUrn, preserving most recent occurrence, capped at 50)
  const { records: historyRecords, loading: historyLoading } = usePlayHistory(ctx, { limit: 100 })
  const { uniqueHistoryRecords, uniqueHistoryUrns } = useMemo(() => {
    const seen = new Set<string>()
    const list: PlayRecord[] = []
    const urns: string[] = []
    for (const record of historyRecords) {
      if (!seen.has(record.trackUrn)) {
        seen.add(record.trackUrn)
        list.push(record)
        urns.push(record.trackUrn)
        if (list.length >= 50) {
          break
        }
      }
    }
    return { uniqueHistoryRecords: list, uniqueHistoryUrns: urns }
  }, [historyRecords])

  const historyTracks = useTracksByUrn(ctx, uniqueHistoryUrns)

  const renderHeader = () =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[2],
          paddingBottom: tokens.space[2],
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255, 255, 255, 0.08)',
        },
      },
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[4],
          },
        },
        h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: t('queue:index.queue'),
            onPress: () => setTab('queue'),
            style: {
              alignItems: 'flex-start',
            },
          },
          h(Text, {
            variant: 'md',
            tone: tab === 'queue' ? 'accent' : 'muted',
            style: { fontWeight: '700' },
            children: t('queue:index.queue'),
          }),
          tab === 'queue'
            ? h(native.View as never, {
                style: {
                  height: 3,
                  width: '100%',
                  backgroundColor: '#1DB954',
                  borderRadius: 2,
                  marginTop: 4,
                },
              })
            : h(native.View as never, { style: { height: 3, marginTop: 4 } }),
        ),
        h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: t('queue:index.recentlyPlayed'),
            onPress: () => setTab('history'),
            style: {
              alignItems: 'flex-start',
            },
          },
          h(Text, {
            variant: 'md',
            tone: tab === 'history' ? 'accent' : 'muted',
            style: { fontWeight: '700' },
            children: t('queue:index.recentlyPlayed'),
          }),
          tab === 'history'
            ? h(native.View as never, {
                style: {
                  height: 3,
                  width: '100%',
                  backgroundColor: '#1DB954',
                  borderRadius: 2,
                  marginTop: 4,
                },
              })
            : h(native.View as never, { style: { height: 3, marginTop: 4 } }),
        ),
      ),
      onClose
        ? h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              accessibilityLabel: t('queue:index.close'),
              onPress: onClose,
              hitSlop: 8,
              style: {
                padding: tokens.space[1],
              },
            },
            tablerIcon('x', { size: 20 }) ?? h(Text, { variant: 'md', tone: 'muted', children: '✕' }),
          )
        : null,
    )

  const renderQueueContent = () => {
    if (queue.length === 0 || !currentItem) {
      return h(
        native.View as never,
        { style: { flex: 1, justifyContent: 'center', alignItems: 'center' } },
        h(EmptyState, {
          icon: '🎵',
          title: t('queue:index.nothingQueued'),
          description: t('queue:index.playSomethingFromYourLibrary'),
        }),
      )
    }

    const currentTrack =
      queueTracks.get(currentItem.trackUrn) ??
      queueTrackFallback(currentItem, state.nowPlaying, true)

    const nextItem = upcoming[0]
    const nextContext = nextItem?.sourceContext
    const contextLabel = nextContext
      ? (nextContext.label ?? t(CONTEXT_KIND_LABEL_KEYS[nextContext.kind]))
      : undefined
    const nextTitle =
      nextItem && contextLabel
        ? t('queue:index.nextUpFrom', { contextLabel })
        : t('queue:index.nextUp')

    return h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      // Section 1: Now playing
      h(
        native.View as never,
        {
          role: 'list',
          accessibilityLabel: t('queue:index.nowPlaying'),
          style: { marginBottom: tokens.space[3] },
        },
        h(
          Text,
          {
            variant: 'sm',
            tone: 'muted',
            style: { fontWeight: '700', marginBottom: tokens.space[2] },
            children: t('queue:index.nowPlaying'),
          },
        ),
        h(
          native.View as never,
          { role: 'listitem' },
          h(CachedTrackRow, {
            ctx,
            track: currentTrack,
            active: true,
            onPress: () => void ctx.player.playFromContext(currentItem.trackUrn),
            onMore: (anchor) => menu.open({ track: currentTrack, queueItemId: currentItem.id }, anchor),
          }),
        ),
      ),
      // Section 2: Next up title & shuffle note
      h(
        native.View as never,
        { style: { marginTop: tokens.space[1], marginBottom: tokens.space[2] } },
        h(
          Text,
          {
            variant: 'sm',
            tone: 'muted',
            style: { fontWeight: '700', marginBottom: state.shuffle ? tokens.space[1] : 0 },
            children: nextTitle,
          },
        ),
        state.shuffle
          ? h(Text, { variant: 'xs', tone: 'muted', children: t('queue:index.shuffleOnNote') })
          : null,
      ),
      // Section 3: Upcoming list
      h(
        native.View as never,
        { style: { flex: 1, minHeight: 0 } },
        h(List<QueueItem>, {
          items: upcoming,
          accessibilityLabel: t('queue:index.nextUp'),
          estimatedItemSize: tokens.size.row,
          keyExtractor: (item) => item.id,
          empty: h(
            native.View as never,
            { style: { paddingVertical: tokens.space[3] } },
            h(Text, { variant: 'xs', tone: 'muted', children: t('queue:index.noMoreSongsQueued') }),
          ),
          renderItem: (item) => {
            const track =
              queueTracks.get(item.trackUrn) ??
              queueTrackFallback(item, state.nowPlaying, item.id === state.currentItemId)
            return h(CachedTrackRow, {
              ctx,
              track,
              active: item.id === state.currentItemId,
              onPress: () => void ctx.player.playFromContext(item.trackUrn),
              onMore: (anchor) => menu.open({ track, queueItemId: item.id }, anchor),
            })
          },
        }),
      ),
    )
  }

  const renderHistoryContent = () => {
    if (uniqueHistoryRecords.length === 0 && !historyLoading) {
      return h(
        native.View as never,
        { style: { flex: 1, justifyContent: 'center', alignItems: 'center' } },
        h(EmptyState, {
          icon: '🎵',
          title: t('queue:index.noPlayRecordsYet'),
          description: t('queue:index.afterPlayingMusicFromThe'),
        }),
      )
    }

    return h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<PlayRecord>, {
        accessibilityLabel: t('queue:index.recentlyPlayed'),
        items: uniqueHistoryRecords,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (record) => record.id,
        renderItem: (record) => {
          const track: Track = historyTracks.get(record.trackUrn) ?? {
            urn: record.trackUrn,
            title: record.trackUrn.split(':').pop() ?? record.trackUrn,
            artists: [],
          }
          const isActive = state.trackUrn === record.trackUrn
          return h(
            native.View as never,
            {
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
                minWidth: 0,
              },
            },
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(CachedTrackRow, {
                ctx,
                track,
                active: isActive,
                showArtwork: true,
                onPress: () => void ctx.player.playFromContext(record.trackUrn, uniqueHistoryUrns),
                onMore: (anchor) => menu.open({ track, historyRecordId: record.id }, anchor),
              }),
            ),
            h(
              native.View as never,
              {
                style: {
                  paddingRight: tokens.space[2],
                },
              },
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                formatRelativeTime(t, record.startedAt),
              ),
            ),
          )
        },
      }),
    )
  }

  return h(
    native.View as never,
    { style: { flex: 1, minHeight: 0 } },
    renderHeader(),
    h(
      native.View as never,
      {
        style: {
          flex: 1,
          minHeight: 0,
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[3],
        },
      },
      tab === 'queue' ? renderQueueContent() : renderHistoryContent(),
    ),
    h(ContextMenu, { ...menu.menuProps, liquid: liquidGlass }),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-queue-ui-mobile'

/**
 * `sources` is what the row hydration goes through; `player` is the queue
 * model itself. Both are required — a queue row with no catalogue read is
 * exactly the state this screen has `queueTrackFallback` for.
 */
export const inject = ['ui', 'player', 'sources']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin, and the reason this closure exists (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-queue-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(QUEUE_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'queue-ui-mobile')
}

export default { name, inject, apply }
