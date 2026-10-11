/**
 * Pure display formatting for the registry views. Dates and versions only —
 * no domain decisions belong here.
 */

/** `2026-01-17T08:24:00Z` → a short locale date (`2026/1/17`), or `—` when absent/unparseable. */
export function formatShortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

/** Wall-clock ms → a short locale date, for the installed tab's lock record. */
export function formatDateMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

/** Wall-clock ms → a short locale date-time, for the settings card's 上次检查 row. */
export function formatDateTime(ms: number | undefined): string {
  if (ms === undefined) return '从未'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '从未'
  return date.toLocaleString()
}

/** `999` → `999`, `1234` → `1.2k`, `1234567` → `1.2M` — for the stats badges. */
export function formatCompactCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '—'
  if (count < 1000) return String(count)
  if (count < 1_000_000) {
    const k = count / 1000
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  const m = count / 1_000_000
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`
}
