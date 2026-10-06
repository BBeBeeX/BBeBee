/**
 * The view ids `plugin-theme` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const THEME_VIEWS = {
  /** The theme management card: swatches, import, delete. */
  settingsCard: 'theme.settings',
} as const
