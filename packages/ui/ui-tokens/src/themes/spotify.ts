import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'
import {
  emeraldGreenTokens,
  emeraldGreenLightTokens,
  emeraldGreenCssVariables,
  emeraldGreenLightCssVariables,
  emeraldGreenTheme,
} from './emerald-green.js'

export * from './emerald-green.js'

// Backward-compatible aliases for legacy imports
export const spotifyTokens: ColorTokens = emeraldGreenTokens
export const spotifyLightTokens: ColorTokens = emeraldGreenLightTokens
export const spotifyCssVariables: Record<string, string> = emeraldGreenCssVariables
export const spotifyLightCssVariables: Record<string, string> = emeraldGreenLightCssVariables
export const spotifyTheme: ThemeDefinition = emeraldGreenTheme
