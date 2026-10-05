/**
 * View hooks for `ctx.lyrics` — public subpath of the lyrics feature.
 *
 * The implementations live in `@BBeBee/toolkit/hooks` (the shared headless
 * library every view package may import) so that the desktop-lyrics surfaces
 * can bind to lyrics state without importing the lyrics feature. This subpath
 * remains the lyrics feature's own hook surface and re-exports them one-to-one.
 */

export { useActiveLyricIndex, useCurrentLyric, useLyrics } from '@BBeBee/toolkit/hooks'

export type { CurrentLyricInfo, LyricPlaybackStage, UseLyricsResult } from '@BBeBee/toolkit/hooks'
