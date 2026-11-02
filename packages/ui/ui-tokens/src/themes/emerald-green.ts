import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const emeraldGreenTokens: ColorTokens = {
  bg: {
    app: '#000000',
    primary: '#121212',
    secondary: '#181818',
    tertiary: '#242424',
  },
  surface: {
    s1: '#181818',
    s2: '#242424',
    s3: '#282828',
    hover: '#2A2A2A',
    active: '#333333',
    selected: 'rgba(29, 185, 84, 0.15)',
  },
  brand: {
    primary: '#1DB954',
    primaryActive: '#1AA34A',
    primaryHover: '#1ED760',
    accent: '#1ED760',
    accentHover: '#22E369',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #1DB954 0%, #1ED760 100%)',
    progress: 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
    blueViolet: 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
    ice: 'linear-gradient(135deg, #1ED760 0%, #1DB954 100%)',
    spectrum: 'linear-gradient(90deg, #1DB954, #1ED760, #22E369)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#B3B3B3',
    tertiary: '#8E8E93',
    muted: '#6A6A6A',
    disabled: '#4D4D4D',
    placeholder: '#5E5E5E',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(29, 185, 84, 0.35)',
    active: 'rgba(29, 185, 84, 0.60)',
    focus: 'rgba(29, 185, 84, 0.70)',
  },
  semantic: {
    success: '#1ED760',
    warning: '#FFA42B',
    error: '#F15E6C',
    info: '#38BDF8',
  },
  music: {
    playing: '#1DB954',
    lyrics: '#FFFFFF',
    lyricsActive: '#1ED760',
    lyricsHighlight: '#1DB954',
    waveform: '#1DB954',
    waveformActive: '#1ED760',
  },
  glow: {
    xs: '0 0 6px rgba(29, 185, 84, 0.12)',
    sm: '0 0 10px rgba(29, 185, 84, 0.20)',
    md: '0 0 18px rgba(29, 185, 84, 0.25)',
    lg: '0 0 28px rgba(29, 185, 84, 0.20)',
    blueXs: '0 0 6px rgba(29, 185, 84, 0.12)',
    blueSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    blueMd: '0 0 18px rgba(29, 185, 84, 0.25)',
    purpleXs: '0 0 6px rgba(29, 185, 84, 0.12)',
    purpleSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    purpleMd: '0 0 18px rgba(29, 185, 84, 0.25)',
    brandSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    brandMd: '0 0 18px rgba(29, 185, 84, 0.25)',
  },
}

export const emeraldGreenCssVariables: Record<string, string> = {
  // Emerald green primary button uses black text on vivid green fill
  '--button-primary-text': '#000000',
}

export const emeraldGreenLightTokens: ColorTokens = {
  bg: {
    app: '#F1F1F1',
    primary: '#FFFFFF',
    secondary: '#F8F8F8',
    tertiary: '#EEEEEE',
  },
  surface: {
    s1: '#F6F6F6',
    s2: '#EDEDED',
    s3: '#E2E2E2',
    hover: '#E8E8E8',
    active: '#DDDDDD',
    selected: 'rgba(18, 131, 60, 0.12)',
  },
  brand: {
    primary: '#12833C',
    primaryActive: '#0A5C2D',
    primaryHover: '#0D6E36',
    accent: '#107C41',
    accentHover: '#0D6E36',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #12833C 0%, #15803D 100%)',
    progress: 'linear-gradient(90deg, #12833C 0%, #15803D 100%)',
    blueViolet: 'linear-gradient(90deg, #12833C 0%, #15803D 100%)',
    ice: 'linear-gradient(135deg, #15803D 0%, #12833C 100%)',
    spectrum: 'linear-gradient(90deg, #12833C, #15803D, #16A34A)',
  },
  text: {
    primary: '#000000',
    secondary: '#4B5563',
    tertiary: '#6B7280',
    muted: '#8C8C8C',
    disabled: '#B0B0B0',
    placeholder: '#8C8C8C',
  },
  border: {
    subtle: '#E5E5E5',
    default: '#767676',
    hover: 'rgba(18, 131, 60, 0.40)',
    active: 'rgba(18, 131, 60, 0.70)',
    focus: 'rgba(18, 131, 60, 0.80)',
  },
  semantic: {
    success: '#0E7A3D',
    warning: '#8A5A00',
    error: '#C1291F',
    info: '#0284C7',
  },
  music: {
    playing: '#12833C',
    lyrics: '#4B5563',
    lyricsActive: '#12833C',
    lyricsHighlight: '#0D6E36',
    waveform: '#12833C',
    waveformActive: '#15803D',
  },
  glow: {
    xs: '0 0 6px rgba(18, 131, 60, 0.12)',
    sm: '0 0 10px rgba(18, 131, 60, 0.16)',
    md: '0 0 18px rgba(18, 131, 60, 0.20)',
    lg: '0 0 28px rgba(18, 131, 60, 0.15)',
    blueXs: '0 0 6px rgba(18, 131, 60, 0.12)',
    blueSm: '0 0 10px rgba(18, 131, 60, 0.16)',
    blueMd: '0 0 18px rgba(18, 131, 60, 0.20)',
    purpleXs: '0 0 6px rgba(18, 131, 60, 0.12)',
    purpleSm: '0 0 10px rgba(18, 131, 60, 0.16)',
    purpleMd: '0 0 18px rgba(18, 131, 60, 0.20)',
    brandSm: '0 0 10px rgba(18, 131, 60, 0.16)',
    brandMd: '0 0 18px rgba(18, 131, 60, 0.20)',
  },
}

export const emeraldGreenLightCssVariables: Record<string, string> = {}

export const emeraldGreenTheme: ThemeDefinition = {
  id: 'emerald-green',
  name: 'Emerald Green',
  description: 'The minimal dark green-on-black palette, preserving dark aesthetic and emerald-green brand identity.',
  isDark: true,
  tokens: emeraldGreenTokens,
  lightTokens: emeraldGreenLightTokens,
  cssVariables: emeraldGreenCssVariables,
  lightCssVariables: emeraldGreenLightCssVariables,
}
