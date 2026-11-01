/**
 * The play-count heatmap for mobile — the stats page's daily activity chart.
 *
 * Same data and same colour scale as the desktop chart: the days come from
 * `player.getHistoryHeatmap` (via `usePlayHistoryHeatmap`), the colour depth
 * from the shared level scale in `@BBeBee/ui-tokens`, and the grid is cut the
 * same way — pad the first week to its start weekday, then into columns of
 * seven. One implementation renders a full year (the stats page) and the
 * most recent three months (the shell's navigation drawer,
 * docs/ui/architecture.md §7.4); only the summary line is host-supplied,
 * because "in the past year" is true for one of those callers.
 *
 * Desktop-only affordances (cell click-to-filter, hover tooltips) have no
 * touch equivalent here; the chart reads, it does not filter.
 */

import { createElement as h, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { PlayHistoryHeatmapDay } from '@BBeBee/protocol'
import { HEATMAP_LEVEL_COLORS, getHeatmapLevel, tokens } from '@BBeBee/ui-tokens'
import { Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'

/** Translator type shared with the owning screen's `useI18n` result. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

export interface PlayHeatmapProps {
  heatmap: readonly PlayHistoryHeatmapDay[]
  /** From the owning screen's `useI18n` — the chart carries no context of its own. */
  t: TranslateFn
  /** Right-aligned header line (the stats page's "played N times" summary). Absent → title only. */
  summary?: string
}

const CELL = 10
const GAP = 3
/** The weekday label column the grid is offset by. */
const WEEKDAY_COLUMN_WIDTH = 24

/** Full-literal month keys for the heatmap header row (UI display). */
const MONTH_KEYS = [
  'history:playHeatmap.jan',
  'history:playHeatmap.feb',
  'history:playHeatmap.mar',
  'history:playHeatmap.apr',
  'history:playHeatmap.may',
  'history:playHeatmap.jun',
  'history:playHeatmap.jul',
  'history:playHeatmap.aug',
  'history:playHeatmap.sep',
  'history:playHeatmap.oct',
  'history:playHeatmap.nov',
  'history:playHeatmap.dec',
] as const

/** Parse YYYY-MM-DD into a local Date without timezone offset issues. */
function parseIsoDate(str: string): Date {
  const parts = str.split('-').map(Number)
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1)
}

/** Formats milliseconds into human-readable duration (e.g. 1 hr 30 min). */
export function formatPlayDuration(t: TranslateFn, ms: number): string {
  if (ms <= 0) return t('history:playHeatmap.durationZero')
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes === 0) return t('history:playHeatmap.durationUnderOneMinute')
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return t('history:playHeatmap.durationMinutes', { minutes })
  if (minutes === 0) return t('history:playHeatmap.durationHours', { hours })
  return t('history:playHeatmap.hrMin', { hours, minutes })
}

interface MonthHeader {
  month: string
  weekIndex: number
}

export function PlayHeatmap({ heatmap, t, summary }: PlayHeatmapProps): ReactElement | null {
  const native = nativePrimitives()

  const { weeks, monthHeaders } = useMemo(() => {
    if (!heatmap || heatmap.length === 0 || !heatmap[0]) {
      return { weeks: [] as (PlayHistoryHeatmapDay | null)[][], monthHeaders: [] as MonthHeader[] }
    }

    const firstDate = parseIsoDate(heatmap[0].date)
    const startDayOfWeek = firstDate.getDay() // 0 = Sun, 6 = Sat

    const weekList: (PlayHistoryHeatmapDay | null)[][] = []
    let currentWeek: (PlayHistoryHeatmapDay | null)[] = []

    for (let i = 0; i < startDayOfWeek; i++) currentWeek.push(null)
    for (const day of heatmap) {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weekList.push(currentWeek)
        currentWeek = []
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null)
      weekList.push(currentWeek)
    }

    const headers: MonthHeader[] = []
    let lastMonth = -1
    for (let w = 0; w < weekList.length; w++) {
      const week = weekList[w]
      if (!week) continue
      const firstValidDay = week.find((d) => d !== null)
      if (firstValidDay) {
        const m = parseIsoDate(firstValidDay.date).getMonth()
        if (m !== lastMonth && MONTH_KEYS[m]) {
          headers.push({ month: MONTH_KEYS[m] ?? '', weekIndex: w })
          lastMonth = m
        }
      }
    }

    return { weeks: weekList, monthHeaders: headers }
  }, [heatmap])

  // No data yet (or none at all): the host decides what an empty chart means.
  if (weeks.length === 0) return null

  const Scroller = native.ScrollView

  return h(
    native.View as never,
    {
      testID: 'play-heatmap',
      style: {
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
      },
    },
    // Header: section title, with the host's optional summary on the right.
    h(
      native.View as never,
      { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.space[2] } },
      h(Text, { variant: 'sm', children: t('history:playHeatmap.title') }),
      summary ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1, children: summary }) : null,
    ),
    // The grid scrolls horizontally: a year of weeks (~53 columns) cannot fit
    // any pane, a quarter fits without scrolling — same chart, both lengths.
    Scroller
      ? h(
          Scroller as never,
          { horizontal: true, showsHorizontalScrollIndicator: false },
          heatmapGrid(native, weeks, monthHeaders, t),
        )
      : heatmapGrid(native, weeks, monthHeaders, t),
    // Legend: the level scale itself, less → more.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: tokens.space[2] } },
      h(Text, { variant: 'xs', tone: 'muted', children: t('history:playHeatmap.less') }),
      ...HEATMAP_LEVEL_COLORS.map((color, idx) =>
        h(native.View as never, {
          key: idx,
          style: { width: CELL, height: CELL, borderRadius: 2, backgroundColor: color },
        }),
      ),
      h(Text, { variant: 'xs', tone: 'muted', children: t('history:playHeatmap.more') }),
    ),
  )
}

/** Weekday label column + month header row + the week columns themselves. */
function heatmapGrid(
  native: ReturnType<typeof nativePrimitives>,
  weeks: (PlayHistoryHeatmapDay | null)[][],
  monthHeaders: MonthHeader[],
  t: TranslateFn,
): ReactElement {
  return h(
    native.View as never,
    { style: { minWidth: '100%' } },
    // Month labels, one per week column where a month starts — absolutely
    // positioned so a label can run past its 13dp slot, exactly as on desktop.
    h(
      native.View as never,
      { style: { height: 14, marginLeft: WEEKDAY_COLUMN_WIDTH } },
      ...monthHeaders.map((hdr) =>
        h(
          native.View as never,
          {
            key: `${hdr.month}-${hdr.weekIndex}`,
            style: { position: 'absolute' as const, left: hdr.weekIndex * (CELL + GAP) },
          },
          h(Text, { variant: 'xs', tone: 'muted', children: t(hdr.month) }),
        ),
      ),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: GAP } },
      // Weekday labels (Mon, Wed, Fri), one row per day of the week.
      h(
        native.View as never,
        { style: { width: WEEKDAY_COLUMN_WIDTH, gap: GAP } },
        ...[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
          h(
            native.View as never,
            { key: dayOfWeek, style: { height: CELL, justifyContent: 'center' } },
            dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5
              ? h(
                  Text,
                  { variant: 'xs', tone: 'muted' },
                  t(
                    dayOfWeek === 1
                      ? 'history:playHeatmap.mon'
                      : dayOfWeek === 3
                        ? 'history:playHeatmap.wed'
                        : 'history:playHeatmap.fri',
                  ),
                )
              : null,
          ),
        ),
      ),
      // Week columns, level-coloured cells.
      ...weeks.map((week, wIdx) =>
        h(
          native.View as never,
          { key: wIdx, style: { gap: GAP } },
          ...week.map((day, dIdx) => {
            if (!day) {
              return h(native.View as never, {
                key: `empty-${dIdx}`,
                style: { width: CELL, height: CELL, backgroundColor: 'transparent' },
              })
            }
            return h(native.View as never, {
              key: day.date,
              testID: `heatmap-cell-${day.date}`,
              accessibilityLabel:
                day.count === 0
                  ? t('history:playHeatmap.noPlayRecords', { date: day.date })
                  : t('history:playHeatmap.cellTitle', {
                      date: day.date,
                      count: day.count,
                      duration: formatPlayDuration(t, day.msPlayed),
                    }),
              style: {
                width: CELL,
                height: CELL,
                borderRadius: 2,
                backgroundColor: HEATMAP_LEVEL_COLORS[getHeatmapLevel(day.count)],
              },
            })
          }),
        ),
      ),
    ),
  )
}
