/**
 * React Native views for `@bbebee/plugin-history`.
 *
 * One screen: playback history and activity statistics.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, SettingsService, Track } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { HISTORY_VIEWS } from '@bbebee/plugin-history/views'
import {
  usePlayHistory,
  usePlayHistoryHeatmap,
  usePlayHistoryStats,
  useTracksByUrn,
  useTransport,
} from '@bbebee/plugin-player/hooks'
import { ContextMenu, EmptyState, List, Text, TrackRow, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@bbebee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { serviceOf } from '@BBeBee/ui-core'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { PlayHeatmap, formatPlayDuration } from './PlayHeatmap.js'

function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

function fallbackTrack(urn: string, title = ''): Track {
  return { urn, title, artists: [] }
}

function formatHistoryTime(
  t: (key: string, params?: Record<string, string | number>) => string,
  timestamp: number,
): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const timeStr = `${hours}:${minutes}`

  if (isToday) return t('history:history.todayAt', { time: timeStr })
  if (isYesterday) return t('history:history.yesterdayAt', { time: timeStr })

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${timeStr}`
  }
  return `${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timeStr}`
}

function StatCard({
  title,
  value,
  subtext,
}: {
  title: string
  value: string
  subtext?: string
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        width: 135,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
      },
    },
    h(Text, { variant: 'xs', tone: 'muted', style: { marginBottom: 4 }, children: title }),
    h(Text, { variant: 'md', style: { fontWeight: '700' }, children: value }),
    subtext
      ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1, style: { marginTop: 4 }, children: subtext })
      : null,
  )
}

export function HistoryScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const native = nativePrimitives()

  const { stats } = usePlayHistoryStats(ctx)
  const { heatmap } = usePlayHistoryHeatmap(ctx, 365)
  const { records, loading } = usePlayHistory(ctx, {
    limit: 500,
    date: selectedDate ?? undefined,
  })

  const { uniqueRecords, playCountMap } = useMemo(() => {
    const counts = new Map<string, number>()
    const seen = new Set<string>()
    const list: PlayRecord[] = []
    for (const r of records) {
      counts.set(r.trackUrn, (counts.get(r.trackUrn) ?? 0) + 1)
      if (!seen.has(r.trackUrn)) {
        seen.add(r.trackUrn)
        list.push(r)
      }
    }
    return { uniqueRecords: list, playCountMap: counts }
  }, [records])

  const transport = useTransport(ctx)
  const tracks = useTracksByUrn(
    ctx,
    uniqueRecords.map((r) => r.trackUrn),
  )
  const menu = useTrackMenu(ctx)

  const handleClear = async () => {
    try {
      await ctx.player?.clearHistory?.()
    } finally {
      setConfirmClear(false)
    }
  }

  const completionRate =
    stats.totalPlays > 0
      ? `${((stats.completedPlays / stats.totalPlays) * 100).toFixed(1)}%`
      : '0%'

  const renderTopBar = () =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[3],
          paddingBottom: tokens.space[2],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0, marginRight: tokens.space[2] } },
        h(Text, { variant: 'lg', style: { fontWeight: '700' }, children: t('history:history.playHistory') }),
        h(
          Text,
          { variant: 'xs', tone: 'muted', numberOfLines: 1, style: { marginTop: 2 } },
          t('history:history.subtitle'),
        ),
      ),
      confirmClear
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
            h(Text, { variant: 'xs', style: { color: '#ff453a' }, children: t('history:history.clearPlayHistory') }),
            h(
              native.Pressable as never,
              {
                accessibilityRole: 'button',
                onPress: handleClear,
                style: {
                  backgroundColor: '#ff453a',
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: tokens.radius.sm,
                },
              },
              h(Text, { variant: 'xs', style: { color: '#ffffff', fontWeight: '700' }, children: t('app:common.confirm') }),
            ),
            h(
              native.Pressable as never,
              {
                accessibilityRole: 'button',
                onPress: () => setConfirmClear(false),
                style: {
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: tokens.radius.sm,
                },
              },
              h(Text, { variant: 'xs', children: t('app:common.cancel') }),
            ),
          )
        : h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              onPress: () => setConfirmClear(true),
              disabled: stats.totalPlays === 0,
              style: {
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: tokens.radius.sm,
                paddingHorizontal: 10,
                paddingVertical: 4,
                opacity: stats.totalPlays === 0 ? 0.4 : 1,
              },
            },
            h(Text, { variant: 'xs', tone: 'muted', children: t('history:history.clearHistory') }),
          ),
    )

  const renderStatCards = () =>
    h(
      native.ScrollView as never,
      {
        horizontal: true,
        showsHorizontalScrollIndicator: false,
        style: { flexGrow: 0, marginBottom: tokens.space[2] },
        contentContainerStyle: {
          gap: tokens.space[2],
          paddingHorizontal: tokens.space[4],
          paddingVertical: tokens.space[1],
        },
      },
      h(StatCard, {
        title: t('history:history.totalPlays'),
        value:
          stats.totalPlays === 1
            ? t('history:history.plays.one', { count: stats.totalPlays.toLocaleString() })
            : t('history:history.plays.other', { count: stats.totalPlays.toLocaleString() }),
        subtext: t('history:history.allTimePlayCount'),
      }),
      h(StatCard, {
        title: t('history:history.totalListeningTime'),
        value: formatPlayDuration(t, stats.totalMsPlayed),
        subtext: t('history:history.timeImmersedInMusic'),
      }),
      h(StatCard, {
        title: t('history:history.playedToday'),
        value:
          stats.todayPlays === 1
            ? t('history:history.tracks.one', { count: stats.todayPlays })
            : t('history:history.tracks.other', { count: stats.todayPlays }),
        subtext: t('history:history.tracksHeardToday'),
      }),
      h(StatCard, {
        title: t('history:history.completionRate'),
        value: completionRate,
        subtext: t('history:history.playedToCompletion', { completedPlays: stats.completedPlays }),
      }),
    )

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        minHeight: 0,
      },
    },
    renderTopBar(),
    renderStatCards(),
    h(
      native.View as never,
      {
        style: {
          paddingHorizontal: tokens.space[4],
          marginBottom: tokens.space[2],
        },
      },
      h(PlayHeatmap, {
        heatmap,
        selectedDate,
        onSelectDate: (date) => setSelectedDate(date),
        t,
        summary: t('history:playHeatmap.playedSummary', {
          plays: stats.totalPlays,
          duration: formatPlayDuration(t, stats.totalMsPlayed),
        }),
      }),
    ),
    h(
      native.View as never,
      {
        style: {
          paddingHorizontal: tokens.space[4],
          paddingVertical: tokens.space[2],
        },
      },
      h(Text, {
        variant: 'sm',
        style: { fontWeight: '700' },
        children: selectedDate
          ? (uniqueRecords.length === 1
              ? t('history:history.playRecordsFor.one', {
                  date: selectedDate,
                  count: uniqueRecords.length,
                })
              : t('history:history.playRecordsFor.other', {
                  date: selectedDate,
                  count: uniqueRecords.length,
                }))
          : (uniqueRecords.length === 1
              ? t('history:history.recentPlayRecords.one', { count: uniqueRecords.length })
              : t('history:history.recentPlayRecords.other', { count: uniqueRecords.length })),
      }),
    ),
    uniqueRecords.length === 0 && !loading
      ? h(EmptyState, {
          icon: '🎵',
          title: selectedDate
            ? t('history:history.noPlayRecordsFor', { selectedDate })
            : t('history:index.noPlayRecordsYet'),
          description: selectedDate
            ? t('history:history.noListeningOnThisDay')
            : t('history:index.afterPlayingMusicFromThe'),
        })
      : h(
          native.View as never,
          {
            style: {
              flex: 1,
              minHeight: 0,
            },
          },
          h(List<PlayRecord>, {
            items: uniqueRecords,
            accessibilityLabel: t('history:history.playHistory'),
            estimatedItemSize: tokens.size.row,
            keyExtractor: (item) => item.id,
            renderItem: (item) => {
              const track =
                tracks.get(item.trackUrn) ??
                { ...fallbackTrack(item.trackUrn), title: t('history:history.loading') }
              const isActive = transport.trackUrn === item.trackUrn
              const playCount = playCountMap.get(item.trackUrn) ?? 1
              return h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 } },
                h(
                  native.View as never,
                  { style: { flex: 1, minWidth: 0 } },
                  h(CachedTrackRow, {
                    ctx,
                    track,
                    active: isActive,
                    showArtwork: true,
                    onPress: () => {
                      void ctx.player?.playNow?.([item.trackUrn])
                    },
                    onMore: (anchor) => menu.open({ track, historyRecordId: item.id }, anchor),
                  }),
                ),
                h(
                  native.View as never,
                  {
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[2],
                      paddingRight: tokens.space[3],
                    },
                  },
                  h(
                    native.View as never,
                    {
                      style: {
                        paddingHorizontal: tokens.space[2],
                        paddingVertical: 2,
                        borderRadius: tokens.radius.sm,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      },
                    },
                    h(
                      Text,
                      { variant: 'xs', tone: 'muted' },
                      playCount === 1
                        ? t('history:history.plays.one', { count: playCount })
                        : t('history:history.plays.other', { count: playCount }),
                    ),
                  ),
                  item.completed
                    ? h(
                        native.View as never,
                        {
                          style: {
                            paddingHorizontal: tokens.space[2],
                            paddingVertical: 2,
                            borderRadius: tokens.radius.sm,
                            backgroundColor: 'rgba(57, 211, 83, 0.15)',
                          },
                        },
                        h(Text, { variant: 'xs', style: { color: '#39d353' } }, t('history:history.completed')),
                      )
                    : item.skipped
                      ? h(
                          native.View as never,
                          {
                            style: {
                              paddingHorizontal: tokens.space[2],
                              paddingVertical: 2,
                              borderRadius: tokens.radius.sm,
                              backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            },
                          },
                          h(Text, { variant: 'xs', tone: 'muted' }, t('history:history.skipped')),
                        )
                      : null,
                  h(Text, { variant: 'xs', tone: 'muted' }, formatHistoryTime(t, item.startedAt)),
                ),
              )
            },
          }),
        ),
    h(ContextMenu, { ...menu.menuProps, liquid: liquidGlass }),
  )
}

/**
 * The stats page's play-count heatmap, exported for the shell: the navigation
 * drawer mounts this same chart with the most recent three months of data
 * (docs/ui/architecture.md §7.4) rather than growing a second implementation.
 */
export { PlayHeatmap, formatPlayDuration } from './PlayHeatmap.js'
export type { PlayHeatmapProps, TranslateFn } from './PlayHeatmap.js'

export const name = 'plugin-history-ui-mobile'
export const inject = ['ui', 'player', 'sources']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-history-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(HISTORY_VIEWS.history, bound(ctx, HistoryScreen))
    /*
     * The history screen's mobile entrance. The shell's tab bar is a fixed
     * four — a deliberate product decision — so the page has no tab and
     * would otherwise ship unreachable. A settings link row is the answer
     * the settings screen already knows how to draw: a contribution with no
     * `action` renders as a row whose button hands the id to
     * `ui.navigate`, pushing the route onto the stack, so Back returns to
     * Settings exactly as from any detail page. Contributed here, not in the
     * headless plugin, because the desktop keeps its own entrances — this
     * row exists only where the tab disappeared.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: HISTORY_VIEWS.history,
      section: 'general',
      title: 'history:history.playHistory',
      order: 70,
    })
  }, 'history-ui-mobile')
}

export default { name, inject, apply }
