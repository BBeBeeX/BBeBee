/**
 * GitHub-style playback activity heatmap.
 *
 * 52-week × 7-day grid showing playback frequency over the past year.
 * Color intensity represents play count for each day.
 */

import { createElement as h, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { PlayHistoryHeatmapDay } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'

export interface PlayHeatmapProps {
  heatmap: readonly PlayHistoryHeatmapDay[]
  selectedDate?: string | null
  onSelectDate?: (date: string | null) => void
}

/** Formats milliseconds into human-readable duration (e.g. 1小时30分钟). */
export function formatPlayDuration(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes === 0) return '< 1 分钟'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分钟`
}

/** Parse YYYY-MM-DD into a local Date without timezone offset issues. */
function parseIsoDate(str: string): Date {
  const parts = str.split('-').map(Number)
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1)
}

const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
]


/** Green intensity levels matching GitHub's dark theme palette. */
const LEVEL_COLORS = [
  'rgba(255, 255, 255, 0.07)', // 0: None
  '#0e4429',                   // 1: 1-2
  '#006d32',                   // 2: 3-5
  '#26a641',                   // 3: 6-10
  '#39d353',                   // 4: 11+
] as const

export function getHeatmapLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}

interface MonthHeader {
  month: string
  weekIndex: number
}

export function PlayHeatmap({ heatmap, selectedDate, onSelectDate }: PlayHeatmapProps): ReactElement {
  const { weeks, monthHeaders, totalPlays, totalMs } = useMemo(() => {
    if (!heatmap || heatmap.length === 0 || !heatmap[0]) {
      return { weeks: [], monthHeaders: [], totalPlays: 0, totalMs: 0 }
    }

    let plays = 0
    let ms = 0
    for (const d of heatmap) {
      plays += d.count
      ms += d.msPlayed
    }

    const firstDate = parseIsoDate(heatmap[0].date)
    const startDayOfWeek = firstDate.getDay() // 0 = Sun, 6 = Sat

    const weekList: (PlayHistoryHeatmapDay | null)[][] = []
    let currentWeek: (PlayHistoryHeatmapDay | null)[] = []

    // Pad first week with nulls before startDayOfWeek
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push(null)
    }

    for (const day of heatmap) {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weekList.push(currentWeek)
        currentWeek = []
      }
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null)
      }
      weekList.push(currentWeek)
    }

    // Determine month label positions
    const headers: MonthHeader[] = []
    let lastMonth = -1
    for (let w = 0; w < weekList.length; w++) {
      const week = weekList[w]
      if (!week) continue
      const firstValidDay = week.find((d) => d !== null)
      if (firstValidDay) {
        const d = parseIsoDate(firstValidDay.date)
        const m = d.getMonth()
        if (m !== lastMonth && MONTH_NAMES[m]) {
          headers.push({ month: MONTH_NAMES[m] ?? '', weekIndex: w })
          lastMonth = m
        }
      }
    }

    return {
      weeks: weekList,
      monthHeaders: headers,
      totalPlays: plays,
      totalMs: ms,
    }
  }, [heatmap])

  return h(
    'div',
    {
      style: {
        background: 'var(--surface-1, #16161a)',
        borderRadius: tokens.radius.md,
        padding: '16px 20px',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
        marginBottom: 20,
      },
    },
    // Top Bar: Section Title and Total Count
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        },
      },
      h(
        'div',
        { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f5f5f7)' } },
        '播放热力图',
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--text-secondary, #8e8e93)' } },
        `最近一年共播放 ${totalPlays} 次 · 累计 ${formatPlayDuration(totalMs)}`,
      ),
    ),
    // Heatmap Container with horizontal scroll if needed
    h(
      'div',
      {
        style: {
          overflowX: 'auto',
          paddingBottom: 4,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'inline-flex',
            flexDirection: 'column',
            gap: 4,
            minWidth: 'max-content',
          },
        },
        // Month labels row
        h(
          'div',
          {
            style: {
              display: 'flex',
              paddingLeft: 24, // Offset for weekday labels
              height: 16,
              fontSize: 10,
              color: 'var(--text-tertiary, #8e8e93)',
              position: 'relative',
            },
          },
          monthHeaders.map((hdr) =>
            h(
              'span',
              {
                key: `${hdr.month}-${hdr.weekIndex}`,
                style: {
                  position: 'absolute',
                  left: 24 + hdr.weekIndex * 13, // 10px cell + 3px gap
                },
              },
              hdr.month,
            ),
          ),
        ),
        // Grid with Left Weekday labels + Week columns
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 3,
            },
          },
          // Left Weekday labels (Mon, Wed, Fri)
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                width: 21,
                fontSize: 9,
                color: 'var(--text-tertiary, #8e8e93)',
                userSelect: 'none',
              },
            },
            [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
              h(
                'div',
                {
                  key: dayOfWeek,
                  style: {
                    height: 10,
                    lineHeight: '10px',
                    textAlign: 'right',
                    paddingRight: 4,
                  },
                },
                dayOfWeek === 1 ? '一' : dayOfWeek === 3 ? '三' : dayOfWeek === 5 ? '五' : '',
              ),
            ),
          ),
          // Week columns
          weeks.map((week, wIdx) =>
            h(
              'div',
              {
                key: wIdx,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                },
              },
              week.map((day, dIdx) => {
                if (!day) {
                  return h('div', {
                    key: `empty-${dIdx}`,
                    style: {
                      width: 10,
                      height: 10,
                      background: 'transparent',
                    },
                  })
                }

                const level = getHeatmapLevel(day.count)
                const isSelected = selectedDate === day.date
                const title =
                  day.count === 0
                    ? `${day.date}: 无播放记录`
                    : `${day.date}: ${day.count} 次播放 (${formatPlayDuration(day.msPlayed)})`

                return h('div', {
                  key: day.date,
                  title,
                  'data-testid': `heatmap-cell-${day.date}`,
                  onClick: () => {
                    onSelectDate?.(isSelected ? null : day.date)
                  },
                  style: {
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: LEVEL_COLORS[level],
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    outline: isSelected ? '2px solid var(--success, #57f287)' : 'none',
                    outlineOffset: 1,
                    transition: 'transform 0.1s, outline 0.1s',
                  },
                })
              }),
            ),
          ),
        ),
      ),
    ),
    // Bottom Footer: Filter status and Legend
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
          paddingTop: 8,
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))',
          fontSize: 11,
          color: 'var(--text-secondary, #8e8e93)',
        },
      },
      selectedDate
        ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { color: 'var(--success, #57f287)' } }, `已筛选日期: ${selectedDate}`),
            h(
              'button',
              {
                onClick: () => onSelectDate?.(null),
                style: {
                  background: 'var(--surface-hover, rgba(255, 255, 255, 0.1))',
                  border: 'none',
                  color: 'var(--text-primary, #f5f5f7)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: 11,
                },
              },
              '清除筛选',
            ),
          )
        : h('div', null, '点击格子可筛选对应日期的播放记录'),
      // Legend
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          },
        },
        h('span', null, '少'),
        LEVEL_COLORS.map((color, idx) =>
          h('div', {
            key: idx,
            style: {
              width: 10,
              height: 10,
              borderRadius: 2,
              background: color,
            },
          }),
        ),
        h('span', null, '多'),
      ),
    ),
  )
}
