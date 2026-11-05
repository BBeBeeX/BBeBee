/**
 * React Native views for `@bbebee/plugin-queue`.
 *
 * Screen: the up-next list and recently played history tabs.
 * Every value comes from the shared bindings in `@BBeBee/toolkit/hooks` /
 * `@bbebee/plugin-player/hooks` — the queue model belongs to the player,
 * this package handles layout, presentation, and event wiring only (docs/08 §1).
 */

import { createElement as h, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, QueueItem, SettingsService, Track } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { QUEUE_VIEWS } from '@bbebee/plugin-queue/views'
import {
  CONTEXT_KIND_LABEL_KEYS,
  formatRelativeTime,
  queueTrackFallback,
  useQueueView,
} from '@BBeBee/toolkit/hooks'
import { ContextMenu, EmptyState, List, Text, TrackRow, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@bbebee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { serviceOf } from '@BBeBee/ui-core'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

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
  const menu = useTrackMenu(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const native = nativePrimitives()

  const {
    tab,
    setTab,
    queue,
    upcoming,
    state,
    currentItem,
    queueTracks,
    historyLoading,
    uniqueHistoryRecords,
    uniqueHistoryUrns,
    historyTracks,
  } = useQueueView(ctx)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const handleHeaderTouchStart = (e: {
    nativeEvent?: { pageX?: number; pageY?: number }
    touches?: Array<{ pageX?: number; pageY?: number }>
  }) => {
    touchStartX.current = e.nativeEvent?.pageX ?? e.touches?.[0]?.pageX ?? 0
    touchStartY.current = e.nativeEvent?.pageY ?? e.touches?.[0]?.pageY ?? 0
  }

  const handleHeaderTouchEnd = (e: {
    nativeEvent?: { pageX?: number; pageY?: number }
    changedTouches?: Array<{ pageX?: number; pageY?: number }>
    touches?: Array<{ pageX?: number; pageY?: number }>
  }) => {
    const endX = e.nativeEvent?.pageX ?? e.changedTouches?.[0]?.pageX ?? e.touches?.[0]?.pageX ?? 0
    const endY = e.nativeEvent?.pageY ?? e.changedTouches?.[0]?.pageY ?? e.touches?.[0]?.pageY ?? 0
    const dx = endX - touchStartX.current
    const dy = endY - touchStartY.current

    // Downward swipe on drag handle or header: dismiss sheet
    if (dy > 25 && dy > Math.abs(dx)) {
      onClose?.()
    }
  }

  const handleContentTouchStart = (e: {
    nativeEvent?: { pageX?: number; pageY?: number }
    touches?: Array<{ pageX?: number; pageY?: number }>
  }) => {
    touchStartX.current = e.nativeEvent?.pageX ?? e.touches?.[0]?.pageX ?? 0
    touchStartY.current = e.nativeEvent?.pageY ?? e.touches?.[0]?.pageY ?? 0
  }

  const handleContentTouchEnd = (e: {
    nativeEvent?: { pageX?: number; pageY?: number }
    changedTouches?: Array<{ pageX?: number; pageY?: number }>
    touches?: Array<{ pageX?: number; pageY?: number }>
  }) => {
    const endX = e.nativeEvent?.pageX ?? e.changedTouches?.[0]?.pageX ?? e.touches?.[0]?.pageX ?? 0
    const endY = e.nativeEvent?.pageY ?? e.changedTouches?.[0]?.pageY ?? e.touches?.[0]?.pageY ?? 0
    const dx = endX - touchStartX.current
    const dy = endY - touchStartY.current

    // Horizontal swipe: switch tabs
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && tab === 'queue') {
        setTab('history')
      } else if (dx > 0 && tab === 'history') {
        setTab('queue')
      }
    }
    // Downward swipe on empty content area: dismiss sheet
    else if (dy > 40 && dy > Math.abs(dx)) {
      const isEmpty =
        (tab === 'queue' && (queue.length === 0 || !currentItem)) ||
        (tab === 'history' && uniqueHistoryRecords.length === 0)
      if (isEmpty) {
        onClose?.()
      }
    }
  }

  const renderDragHandle = () =>
    h(
      native.View as never,
      {
        testID: 'queue-sheet-drag-handle',
        onTouchStart: handleHeaderTouchStart,
        onTouchEnd: handleHeaderTouchEnd,
        style: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: tokens.space[2],
          width: '100%',
        },
      },
      h(native.View as never, {
        style: {
          width: 36,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: 'rgba(255, 255, 255, 0.35)',
        },
      }),
    )

  const renderHeader = () =>
    h(
      native.View as never,
      {
        testID: 'queue-header',
        onTouchStart: handleHeaderTouchStart,
        onTouchEnd: handleHeaderTouchEnd,
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[1],
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
            justifyContent: 'center',
            gap: tokens.space[6],
          },
        },
        h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: t('queue:index.queue'),
            onPress: () => setTab('queue'),
            style: {
              alignItems: 'center',
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
                  backgroundColor: c().accent.base,
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
              alignItems: 'center',
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
                  backgroundColor: c().accent.base,
                  borderRadius: 2,
                  marginTop: 4,
                },
              })
            : h(native.View as never, { style: { height: 3, marginTop: 4 } }),
        ),
      ),
    )

  const renderQueueContent = () => {
    if (queue.length === 0 || !currentItem) {
      return h(
        native.View as never,
        { style: { flex: 1, justifyContent: 'center', alignItems: 'center' } },
        h(EmptyState, {
          icon: 'playlist',
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
          icon: 'history',
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
    renderDragHandle(),
    renderHeader(),
    h(
      native.View as never,
      {
        testID: 'queue-content',
        onTouchStart: handleContentTouchStart,
        onTouchEnd: handleContentTouchEnd,
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
