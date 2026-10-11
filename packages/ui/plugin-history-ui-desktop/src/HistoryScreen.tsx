/**
 * React DOM view for `@BBeBee/plugin-history`.
 *
 * Displays:
 * 1. Playback summary statistics (total plays, total time, today plays, completion rate).
 * 2. Playback activity heatmap (GitHub-style 52w x 7d).
 * 3. Playback history track list with date filtering, playback controls, and context menus.
 */

import { createElement as h, memo, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, Track } from '@BBeBee/protocol'
import {
  usePlayHistory,
  usePlayHistoryStats,
  usePlayHistoryHeatmap,
  useTracksByUrn,
  useTransport,
  useResolvedArtwork,
} from '@BBeBee/toolkit/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { ContextMenu, EmptyState, List, TrackRow } from '@BBeBee/ui-kit-desktop'
import type { MenuAnchor, TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { PlayHeatmap, formatPlayDuration } from './PlayHeatmap.js'

const CachedTrackRow = memo(
  function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
    const artwork = useResolvedArtwork(ctx, props.track.artwork)
    return h(TrackRow, {
      ...props,
      track: artwork ? { ...props.track, artwork } : props.track,
    })
  },
  (prev, next) =>
    prev.track.urn === next.track.urn &&
    prev.track.title === next.track.title &&
    prev.track.artwork === next.track.artwork &&
    prev.active === next.active,
)

interface HistoryTrackRowProps {
  ctx: Context
  record: PlayRecord
  track: Track
  isActive: boolean
  playCount: number
  onPress: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMore: (anchor?: MenuAnchor) => void
}

const HistoryTrackRow = memo(
  function HistoryTrackRow({
    ctx,
    record,
    track,
    isActive,
    playCount,
    onPress,
    onContextMenu,
    onMore,
  }: HistoryTrackRowProps): ReactElement {
    return h(
      'div',
      {
        onContextMenu,
        style: {
          display: 'flex',
          alignItems: 'center',
          borderRadius: tokens.radius.sm,
          background: isActive ? 'rgba(87, 242, 135, 0.06)' : 'transparent',
          height: 56,
          boxSizing: 'border-box',
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
          onPress,
          onMore,
        }),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingRight: 16,
            fontSize: 12,
            color: 'var(--text-secondary, #8e8e93)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--surface-1, rgba(255, 255, 255, 0.08))',
              color: 'var(--text-secondary, #8e8e93)',
            },
          },
          `${playCount} ${playCount === 1 ? 'play' : 'plays'}`,
        ),
        record.completed
          ? h(
              'span',
              {
                style: {
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(57, 211, 83, 0.15)',
                  color: 'var(--success, #39d353)',
                },
              },
              'Completed',
            )
          : record.skipped
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: 'var(--surface-1, rgba(255, 255, 255, 0.08))',
                    color: 'var(--text-secondary, #8e8e93)',
                  },
                },
                'Skipped',
              )
            : null,
        h('span', null, formatHistoryTime(record.startedAt)),
      ),
    )
  },
  (prev, next) =>
    prev.record.id === next.record.id &&
    prev.record.completed === next.record.completed &&
    prev.record.skipped === next.record.skipped &&
    prev.track.urn === next.track.urn &&
    prev.track.title === next.track.title &&
    prev.track.artwork === next.track.artwork &&
    prev.isActive === next.isActive &&
    prev.playCount === next.playCount,
)

function formatHistoryTime(timestamp: number): string {
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

  if (isToday) return `Today ${timeStr}`
  if (isYesterday) return `Yesterday ${timeStr}`

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
  return h(
    'div',
    {
      style: {
        flex: 1,
        minWidth: 150,
        background: 'var(--surface-1, #16161a)',
        borderRadius: tokens.radius.md,
        padding: '14px 18px',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
      },
    },
    h('div', { style: { fontSize: 12, color: 'var(--text-secondary, #8e8e93)', marginBottom: 6 } }, title),
    h('div', { style: { fontSize: 20, fontWeight: 700, color: 'var(--text-primary, #f5f5f7)' } }, value),
    subtext
      ? h('div', { style: { fontSize: 11, color: 'var(--text-tertiary, #6e6e73)', marginTop: 4 } }, subtext)
      : null,
  )
}

function fallbackTrack(urn: string): Track {
  return { urn, title: 'Loading…', artists: [] }
}

export function HistoryScreen({ ctx }: { ctx: Context }): ReactElement {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

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

  return h(
    'div',
    {
      style: {
        padding: '24px 32px',
        maxWidth: 1200,
        margin: '0 auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
      },
    },
    // Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexShrink: 0,
        },
      },
      h(
        'div',
        null,
        h('h1', { style: { fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text-primary, #f5f5f7)' } }, 'Play history'),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #8e8e93)', marginTop: 4 } },
          'Every melody that touched your heart, and the footprint of your listening',
        ),
      ),
      // Clear history actions
      confirmClear
        ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 12, color: 'var(--error, #ff453a)' } }, 'Clear play history?'),
            h(
              'button',
              {
                onClick: handleClear,
                style: {
                  background: 'var(--error, #ff453a)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                },
              },
              'OK',
            ),
            h(
              'button',
              {
                onClick: () => setConfirmClear(false),
                style: {
                  background: 'var(--surface-hover, rgba(255, 255, 255, 0.1))',
                  color: 'var(--text-primary, #f5f5f7)',
                  border: 'none',
                  borderRadius: 4,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                },
              },
              'Cancel',
            ),
          )
        : h(
            'button',
            {
              onClick: () => setConfirmClear(true),
              disabled: stats.totalPlays === 0,
              style: {
                background: 'transparent',
                color: stats.totalPlays === 0 ? 'var(--text-disabled, #48484a)' : 'var(--text-secondary, #8e8e93)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
                borderRadius: 6,
                padding: '6px 14px',
                cursor: stats.totalPlays === 0 ? 'default' : 'pointer',
                fontSize: 12,
                transition: 'all 0.15s',
              },
            },
            'Clear history',
          ),
    ),
    // Stat Cards
    h(
      'div',
      {
        style: {
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 20,
          flexShrink: 0,
        },
      },
      h(StatCard, {
        title: 'Total plays',
        value: `${stats.totalPlays.toLocaleString()} plays`,
        subtext: 'All-time play count',
      }),
      h(StatCard, {
        title: 'Total listening time',
        value: formatPlayDuration(stats.totalMsPlayed),
        subtext: 'Time immersed in music',
      }),
      h(StatCard, {
        title: 'Played today',
        value: `${stats.todayPlays} tracks`,
        subtext: 'Tracks heard today',
      }),
      h(StatCard, {
        title: 'Completion rate',
        value: completionRate,
        subtext: `${stats.completedPlays} played to completion`,
      }),
    ),
    // Heatmap
    h(
      'div',
      { style: { flexShrink: 0 } },
      h(PlayHeatmap, {
        heatmap,
        selectedDate,
        onSelectDate: (date) => setSelectedDate(date),
      }),
    ),
    // Track List Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexShrink: 0,
        },
      },
      h(
        'div',
        { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #f5f5f7)' } },
        selectedDate
          ? `Play records for ${selectedDate} (${uniqueRecords.length} tracks)`
          : `Recent play records (${uniqueRecords.length} tracks)`,
      ),
    ),
    // Track List or Empty State
    uniqueRecords.length === 0 && !loading
      ? h(EmptyState, {
          icon: 'music',
          title: selectedDate ? `No play records for ${selectedDate}` : 'No play records yet',
          description: selectedDate
            ? 'No listening on this day yet — pick a track and press play.'
            : 'After playing music from the library, your play history and statistics will appear here.',
        })
      : h(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 0,
            },
          },
          h(List<PlayRecord>, {
            items: uniqueRecords,
            estimatedItemSize: 56,
            keyExtractor: (r) => r.id,
            renderItem: (record) => {
              const track = tracks.get(record.trackUrn) ?? fallbackTrack(record.trackUrn)
              const isActive = transport.trackUrn === record.trackUrn
              const playCount = playCountMap.get(record.trackUrn) ?? 1

              return h(HistoryTrackRow, {
                ctx,
                record,
                track,
                isActive,
                playCount,
                onPress: () => {
                  void ctx.player?.playNow?.([record.trackUrn])
                },
                onContextMenu: (e: React.MouseEvent) => {
                  e.preventDefault()
                  menu.open({ track, historyRecordId: record.id }, { x: e.clientX, y: e.clientY })
                },
                onMore: (anchor) => menu.open({ track, historyRecordId: record.id }, anchor),
              })
            },
          }),
        ),
    h(ContextMenu, menu.menuProps),
  )
}
