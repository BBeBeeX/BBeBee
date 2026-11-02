import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const crimsonNightTokens: ColorTokens = {
  bg: {
    app: '#070709',
    primary: '#0E0E14',
    secondary: '#16131B',
    tertiary: '#201824',
  },
  surface: {
    s1: '#15121A',
    s2: '#1E1824',
    s3: '#281F30',
    hover: '#2D2336',
    active: '#382B42',
    selected: 'rgba(255, 45, 85, 0.16)',
  },
  brand: {
    primary: '#FF2D55',
    primaryActive: '#E01E45',
    primaryHover: '#FF4D70',
    accent: '#FF375F',
    accentHover: '#FF5E7E',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #FF2D55 0%, #FF375F 50%, #FF6482 100%)',
    progress: 'linear-gradient(90deg, #E01E45 0%, #FF2D55 50%, #FF5E7E 100%)',
    blueViolet: 'linear-gradient(90deg, #FF2D55 0%, #C026D3 100%)',
    ice: 'linear-gradient(135deg, #FF6482 0%, #FFA1B5 100%)',
    spectrum: 'linear-gradient(90deg, #E01E45, #FF2D55, #FF5E7E, #C026D3)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#D4D4D8',
    tertiary: '#A1A1AA',
    muted: '#71717A',
    disabled: '#52525B',
    placeholder: '#3F3F46',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(255, 45, 85, 0.35)',
    active: 'rgba(255, 45, 85, 0.60)',
    focus: 'rgba(255, 45, 85, 0.70)',
  },
  semantic: {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#FF2D55',
    info: '#FB7185',
  },
  music: {
    playing: '#FF4D70',
    lyrics: '#FFFFFF',
    lyricsActive: '#FF2D55',
    lyricsHighlight: '#FF7597',
    waveform: '#FF375F',
    waveformActive: '#FF2D55',
  },
  glow: {
    xs: '0 0 6px rgba(255, 45, 85, 0.20)',
    sm: '0 0 12px rgba(255, 45, 85, 0.25)',
    md: '0 0 20px rgba(255, 45, 85, 0.35)',
    lg: '0 0 32px rgba(255, 45, 85, 0.30)',
    blueXs: '0 0 6px rgba(255, 45, 85, 0.20)',
    blueSm: '0 0 12px rgba(255, 45, 85, 0.25)',
    blueMd: '0 0 20px rgba(255, 45, 85, 0.35)',
    purpleXs: '0 0 6px rgba(192, 38, 211, 0.20)',
    purpleSm: '0 0 12px rgba(192, 38, 211, 0.25)',
    purpleMd: '0 0 20px rgba(192, 38, 211, 0.35)',
    brandSm: '0 0 12px rgba(255, 45, 85, 0.22), 0 0 24px rgba(192, 38, 211, 0.12)',
    brandMd: '0 0 18px rgba(255, 45, 85, 0.28), 0 0 36px rgba(192, 38, 211, 0.18)',
  },
}

export const crimsonNightCssVariables: Record<string, string> = {}

export const crimsonNightLightTokens: ColorTokens = {
  bg: {
    app: '#FDF2F4',
    primary: '#FFFFFF',
    secondary: '#FFF5F6',
    tertiary: '#FCE7EA',
  },
  surface: {
    s1: '#FFF1F3',
    s2: '#FCE7EA',
    s3: '#F9D5DA',
    hover: '#FADCE1',
    active: '#F5C2CB',
    selected: 'rgba(201, 24, 74, 0.12)',
  },
  brand: {
    primary: '#C9184A',
    primaryActive: '#801020',
    primaryHover: '#A01A3F',
    accent: '#B5179E',
    accentHover: '#831843',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #C9184A 0%, #B5179E 100%)',
    progress: 'linear-gradient(90deg, #C9184A 0%, #A21CAF 100%)',
    blueViolet: 'linear-gradient(90deg, #C9184A 0%, #7C3AED 100%)',
    ice: 'linear-gradient(135deg, #FF758F 0%, #FFB3C1 100%)',
    spectrum: 'linear-gradient(90deg, #A01A3F, #C9184A, #B5179E, #7C3AED)',
  },
  text: {
    primary: '#0F172A',
    secondary: '#4B5563',
    tertiary: '#6B7280',
    muted: '#9CA3AF',
    disabled: '#D1D5DB',
    placeholder: '#9CA3AF',
  },
  border: {
    subtle: '#FCE7EA',
    default: '#9CA3AF',
    hover: '#C9184A',
    active: '#A01A3F',
    focus: '#C9184A',
  },
  semantic: {
    success: '#0E7A3D',
    warning: '#8A5A00',
    error: '#C1291F',
    info: '#C9184A',
  },
  music: {
    playing: '#C9184A',
    lyrics: '#4B5563',
    lyricsActive: '#C9184A',
    lyricsHighlight: '#B5179E',
    waveform: '#C9184A',
    waveformActive: '#B5179E',
  },
  glow: {
    xs: '0 0 6px rgba(201, 24, 74, 0.15)',
    sm: '0 0 12px rgba(201, 24, 74, 0.12)',
    md: '0 0 20px rgba(201, 24, 74, 0.18)',
    lg: '0 0 32px rgba(201, 24, 74, 0.15)',
    blueXs: '0 0 6px rgba(201, 24, 74, 0.15)',
    blueSm: '0 0 12px rgba(201, 24, 74, 0.12)',
    blueMd: '0 0 20px rgba(201, 24, 74, 0.18)',
    purpleXs: '0 0 6px rgba(181, 23, 158, 0.15)',
    purpleSm: '0 0 12px rgba(181, 23, 158, 0.12)',
    purpleMd: '0 0 20px rgba(181, 23, 158, 0.18)',
    brandSm: '0 0 12px rgba(201, 24, 74, 0.15), 0 0 24px rgba(181, 23, 158, 0.08)',
    brandMd: '0 0 18px rgba(201, 24, 74, 0.18), 0 0 36px rgba(181, 23, 158, 0.12)',
  },
}

export const crimsonNightLightCssVariables: Record<string, string> = {}

export const crimsonNightTheme: ThemeDefinition = {
  id: 'crimson-night',
  name: 'Crimson Night',
  description: 'Deep obsidian paired with aurora crimson — the intense, brooding aura of a blood moon at night',
  isDark: true,
  tokens: crimsonNightTokens,
  lightTokens: crimsonNightLightTokens,
  cssVariables: crimsonNightCssVariables,
  lightCssVariables: crimsonNightLightCssVariables,
}
