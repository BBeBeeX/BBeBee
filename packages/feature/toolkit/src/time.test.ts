import { describe, expect, it } from 'vitest'
import { formatAddedDate, formatDuration, formatPlayedDate, formatTotalDuration } from './time.js'

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9_000)).toBe('0:09')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(599_000)).toBe('9:59')
  })

  it('pads the minutes only once there are hours', () => {
    // 1:05:00, not 1:5:00 — and 5:00, not 05:00.
    expect(formatDuration(3_900_000)).toBe('1:05:00')
    expect(formatDuration(300_000)).toBe('5:00')
  })

  it('truncates rather than rounds', () => {
    // A track showing 3:34 the instant before it ends is right; showing 3:35
    // for a 3:34 track is the kind of wrong a user notices once and remembers.
    expect(formatDuration(3999)).toBe('0:03')
  })

  it('shows a placeholder rather than a lie when the duration is unknown', () => {
    // A live stream has no duration, and `0:00` would claim it does.
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(Number.NaN)).toBe('--:--')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('--:--')
    expect(formatDuration(-1)).toBe('--:--')
  })

  it('handles a long track without breaking down', () => {
    expect(formatDuration(7_265_000)).toBe('2:01:05')
  })
})

describe('formatTotalDuration', () => {
  it('returns empty string for empty or 0ms items', () => {
    expect(formatTotalDuration([])).toBe('')
    expect(formatTotalDuration([{ durationMs: 0 }, undefined])).toBe('')
  })

  it('formats under an hour as minutes and seconds', () => {
    expect(formatTotalDuration([{ durationMs: 125_000 }])).toBe('2 分钟 5 秒')
  })

  it('formats over an hour as hours and minutes', () => {
    expect(formatTotalDuration([{ durationMs: 3_665_000 }])).toBe('1 小时 1 分钟')
    expect(formatTotalDuration([{ durationMs: 7_200_000 }])).toBe('2 小时 0 分钟')
  })
})

describe('formatAddedDate', () => {
  const DAY = 86_400_000

  it('renders an absent timestamp as a dash', () => {
    expect(formatAddedDate(undefined)).toBe('-')
    expect(formatAddedDate(0)).toBe('-')
  })

  it('names today and yesterday', () => {
    const now = Date.now()
    expect(formatAddedDate(now - 3_600_000)).toBe('今天')
    expect(formatAddedDate(now - 25 * 3_600_000)).toBe('昨天')
  })

  it('counts days, then weeks, before the date stops being relative', () => {
    const now = Date.now()
    expect(formatAddedDate(now - 3 * DAY)).toBe('3天前')
    expect(formatAddedDate(now - 2 * 7 * DAY)).toBe('2周前')
  })

  it('falls back to the full date past a month', () => {
    const timestamp = Date.now() - 40 * DAY
    const d = new Date(timestamp)
    expect(formatAddedDate(timestamp)).toBe(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`)
  })
})

describe('formatPlayedDate', () => {
  it('spells a played timestamp the same way an added one is', () => {
    const now = Date.now()
    expect(formatPlayedDate(undefined)).toBe('-')
    expect(formatPlayedDate(now - 3_600_000)).toBe('今天')
    expect(formatPlayedDate(now - 25 * 3_600_000)).toBe('昨天')
  })
})
