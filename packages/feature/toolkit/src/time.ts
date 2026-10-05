/**
 * Time rendering shared by both shells.
 *
 * Written once because a duration is shown in every list row, every transport
 * bar and every now-playing screen, and the two kits drifting on how a
 * two-hour track is spelled is the kind of inconsistency nobody notices until
 * it ships.
 */

/**
 * `mm:ss`, or `h:mm:ss` past an hour.
 *
 * Unknown durations render as a placeholder rather than `0:00`, which would
 * claim a live stream is zero seconds long. Fractional seconds truncate: a
 * track showing 3:34 the instant before it ends is right; showing 3:35 for a
 * 3:34 track is the kind of wrong a user notices once and remembers.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`
}

/**
 * Total duration of a collection of items (such as tracks or playlist entries).
 * Formatted as "X 小时 Y 分钟" if >= 1 hour, or "Y 分钟 Z 秒" if < 1 hour,
 * or empty string if total duration is 0 or unmeasured.
 */
export function formatTotalDuration(items: readonly ({ durationMs?: number } | undefined)[]): string {
  const totalMs = items.reduce((sum, item) => sum + (item?.durationMs || 0), 0)
  if (totalMs <= 0) return ''
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟 ${seconds} 秒`
}

/**
 * A timestamp as a library shows it: 今天 / 昨天 / N天前 / N周前, and once
 * "N周前" stops being informative, the full date. An absent timestamp (never
 * added, never played) renders as `-` rather than claiming an epoch.
 */
export function formatAddedDate(timestamp?: number): string {
  if (!timestamp) return '-'
  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  const d = new Date(timestamp)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * The same relative spelling for a "最近播放" column.
 *
 * A separate name, not a second implementation: which column a timestamp
 * belongs to is the caller's business, but the relative vocabulary must not
 * drift between "added" and "played".
 */
export function formatPlayedDate(timestamp?: number): string {
  return formatAddedDate(timestamp)
}
