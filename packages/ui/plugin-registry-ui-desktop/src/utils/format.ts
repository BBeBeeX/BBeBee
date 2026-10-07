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

/** Wall-clock ms → a short locale date-time, for the settings card's 上次检查 row. */
export function formatDateTime(ms: number | undefined): string {
  if (ms === undefined) return '从未'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '从未'
  return date.toLocaleString()
}
