/**
 * The play-count heatmap's colour scale — one scale for every chart that
 * renders daily play counts.
 *
 * The desktop history screen and the mobile stats page / navigation drawer
 * render the same data (`player.getHistoryHeatmap`) as a GitHub-style grid;
 * sharing the buckets and the colours here is what keeps their cells
 * comparable — a day that reads "busy" on desktop reads "busy" on the phone,
 * and no second scale can drift apart from this one.
 */

/** Green intensity levels matching GitHub's dark theme palette, by level. */
export const HEATMAP_LEVEL_COLORS = [
  'rgba(255, 255, 255, 0.07)', // 0: none
  '#0e4429', // 1: 1–2
  '#006d32', // 2: 3–5
  '#26a641', // 3: 6–10
  '#39d353', // 4: 11+
] as const

/** A day's bucket into the level scale. */
export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

/** Maps a day's play count onto the level scale both platforms colour by. */
export function getHeatmapLevel(count: number): HeatmapLevel {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}
