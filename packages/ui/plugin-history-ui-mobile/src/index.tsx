/**
 * React Native views for `@bbebee/plugin-history`.
 *
 * One screen: playback history and activity statistics.
 */

import { createElement as h, Fragment, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { PlayRecord, Track } from '@BBeBee/protocol'
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

export function HistoryScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const { records, loading } = usePlayHistory(ctx, { limit: 200 })
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

  const { stats } = usePlayHistoryStats(ctx)
  // The stats page's heatmap: a year of daily play counts, the same chart the
  // shell's navigation drawer mounts with the most recent three months.
  const { heatmap } = usePlayHistoryHeatmap(ctx, 365)
  const transport = useTransport(ctx)
  const tracks = useTracksByUrn(
    ctx,
    uniqueRecords.map((r) => r.trackUrn),
  )
  const menu = useTrackMenu(ctx)

  if (uniqueRecords.length === 0 && !loading) {
    return h(EmptyState, {
      icon: '🎵',
      title: t('history:index.noPlayRecordsYet'),
      description: t('history:index.afterPlayingMusicFromThe'),
    })
  }

  return h(
    Fragment,
    null,
    // Mobile Header Stats Summary
    h(
      nativePrimitives().View as never,
      {
        style: {
          paddingHorizontal: tokens.space[4],
          paddingTop: tokens.space[3],
          paddingBottom: tokens.space[3],
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255, 255, 255, 0.08)',
        },
      },
      h(Text, { variant: 'lg', children: t('history:history.playHistory') }),
      h(
        nativePrimitives().View as never,
        {
          style: {
            flexDirection: 'row',
            gap: tokens.space[4],
            marginTop: tokens.space[2],
          },
        },
        h(
          Text,
          { variant: 'xs', tone: 'muted' },
          t('history:index.totalPlays', { totalPlays: stats.totalPlays }),
        ),
        h(
          Text,
          { variant: 'xs', tone: 'muted' },
          t('history:index.totalTime', { duration: formatPlayDuration(t, stats.totalMsPlayed) }),
        ),
        h(
          Text,
          { variant: 'xs', tone: 'muted' },
          t('history:index.todayTracks', { todayPlays: stats.todayPlays }),
        ),
      ),
    ),
    h(PlayHeatmap, {
      heatmap,
      t,
      summary: t('history:playHeatmap.playedSummary', {
        plays: stats.totalPlays,
        duration: formatPlayDuration(t, stats.totalMsPlayed),
      }),
    }),
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
          nativePrimitives().View as never,
          { style: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 } },
          h(
            nativePrimitives().View as never,
            { style: { flex: 1, minWidth: 0 } },
            h(CachedTrackRow, {
              ctx,
              track,
              active: isActive,
              showArtwork: true,
              onPress: () => {
                void ctx.player?.playNow?.([item.trackUrn])
              },
              onMore: (anchor) => menu.open({ track }, anchor),
            }),
          ),
          h(
            nativePrimitives().View as never,
            {
              style: {
                paddingHorizontal: tokens.space[2],
                paddingVertical: 2,
                borderRadius: tokens.radius.sm,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                marginRight: tokens.space[2],
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
        )
      },
    }),
    h(ContextMenu, menu.menuProps),
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
