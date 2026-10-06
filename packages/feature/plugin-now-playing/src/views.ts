/**
 * The view ids `plugin-now-playing` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3). The page is a route; the bar is a view the
 * shells resolve by id, which is why they are two constants and one of them
 * is absent from `NOW_PLAYING_ROUTES`.
 */
export const NOW_PLAYING_VIEWS = {
  /** The full-screen player on mobile; the expansion target on desktop. */
  nowPlaying: 'now-playing.view',
  /** The persistent bottom bar / mini-player. */
  bar: 'now-playing.bar',
  /** The layout-styles management card in the settings screen. */
  stylesSettings: 'now-playing.styles',
} as const

export const NOW_PLAYING_ROUTES = {
  nowPlaying: 'now-playing.view',
} as const
