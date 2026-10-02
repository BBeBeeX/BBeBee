/**
 * The view ids `plugin-dsp` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const DSP_VIEWS = {
  /** The main DSP chain editor view. */
  main: 'dsp.view',
  /** The DSP settings section/tab. */
  settings: 'settings.dsp',
  /** The loudness normalization setting entry in playback settings. */
  normalizationSettings: 'settings.loudness-normalization',
} as const

export const DSP_ROUTES = DSP_VIEWS
