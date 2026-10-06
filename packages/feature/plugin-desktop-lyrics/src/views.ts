/**
 * The view ids `plugin-desktop-lyrics` contributes.
 *
 * Shared by the view package so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const DESKTOP_LYRICS_VIEWS = {
  /** The floating lyrics window. */
  floating: 'desktop-lyrics.floating',
  /** The toggle button in the now-playing actions slot. */
  toggle: 'desktop-lyrics.toggle',
  /** The settings card: display style, colours and the live preview. */
  settingsCard: 'desktop-lyrics.settings',
} as const
