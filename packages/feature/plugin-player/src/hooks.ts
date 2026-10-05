/**
 * View hooks for `ctx.player` — public subpath of the player feature.
 *
 * The implementations live in `@BBeBee/toolkit/hooks`, the shared headless
 * library every view package may import. Housing them there is what lets a
 * desktop view (history, queue, now-playing, lyrics, visualizer) bind to the
 * transport without importing the player feature, and what keeps the logic —
 * which events invalidate which state, how a position is interpolated —
 * written once for both platforms (docs/08 4).
 *
 * This subpath remains the player's own hook surface: the player view packages
 * and their tests consume it, and it re-exports the shared implementations
 * one-to-one.
 */

export {
  isPlayingLike,
  queueTrackFallback,
  useDuration,
  useNowPlaying,
  usePlayHistory,
  usePlayHistoryHeatmap,
  usePlayHistoryStats,
  usePlayMode,
  usePosition,
  useQueue,
  useTracksByUrn,
  useTransport,
  useTransportAvailability,
  useUpcoming,
} from '@BBeBee/toolkit/hooks'

export type {
  TransportAvailability,
  UsePlayHistoryHeatmapResult,
  UsePlayHistoryResult,
  UsePlayHistoryStatsResult,
} from '@BBeBee/toolkit/hooks'
