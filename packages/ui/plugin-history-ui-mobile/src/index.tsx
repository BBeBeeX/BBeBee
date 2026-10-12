/**
 * React Native views for `@BBeBee/plugin-history`.
 *
 * One screen: playback history and activity statistics.
 */

import { createElement as h, Fragment, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { I18nService, PlayRecord, Track } from '@BBeBee/protocol'
import { HISTORY_VIEWS } from '@BBeBee/plugin-history/views'
import {
  usePlayHistory,
  usePlayHistoryStats,
  useTracksByUrn,
  useTransport,
} from '@BBeBee/plugin-player/hooks'
import { ContextMenu, EmptyState, List, Text, TrackRow, useI18n } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

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

function formatPlayDuration(t: I18nService['t'], ms: number): string {
  if (ms <= 0) return t('history:playHeatmap.durationZero')
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes === 0) return t('history:playHeatmap.durationUnderOneMinute')
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return t('history:playHeatmap.durationMinutes', { minutes })
  if (minutes === 0) return t('history:playHeatmap.durationHours', { hours })
  return t('history:playHeatmap.hrMin', { hours, minutes })
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
      'div',
      {
        style: {
          padding: '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
      h(Text, { variant: 'lg', children: t('history:history.playHistory') }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 16,
            marginTop: 8,
            fontSize: 12,
            color: '#8e8e93',
          },
        },
        h('span', null, t('history:index.totalPlays', { totalPlays: stats.totalPlays })),
        h(
          'span',
          null,
          t('history:index.totalTime', { duration: formatPlayDuration(t, stats.totalMsPlayed) }),
        ),
        h('span', null, t('history:index.todayTracks', { todayPlays: stats.todayPlays })),
      ),
    ),
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
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              paddingRight: 12,
            },
          },
          h(
            'div',
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
            'span',
            {
              style: {
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#8e8e93',
                whiteSpace: 'nowrap',
              },
            },
            playCount === 1
              ? t('history:history.plays.one', { count: playCount })
              : t('history:history.plays.other', { count: playCount }),
          ),
        )
      },
    }),
    h(ContextMenu, menu.menuProps),
  )
}

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
  }, 'history-ui-mobile')
}

export default { name, inject, apply }
