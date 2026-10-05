import { palettes } from '@BBeBee/ui-tokens'

/**
 * The download screen's color scheme.
 *
 * A function rather than a constant so that a theme switch is a re-read on
 * the next render instead of a value captured at module load.
 */
export function p() {
  return palettes.dark
}
