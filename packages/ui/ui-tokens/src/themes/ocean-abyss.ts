import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const oceanAbyssTokens: ColorTokens = {
  bg: {
    app: '#040B11',
    primary: '#08131E',
    secondary: '#0D1C2A',
    tertiary: '#132638',
  },
  surface: {
    s1: '#0F2133',
    s2: '#162C42',
    s3: '#1E3752',
    hover: '#254464',
    active: '#2D5176',
    selected: 'rgba(6, 182, 212, 0.16)',
  },
  brand: {
    primary: '#06B6D4',
    primaryActive: '#0891B2',
    primaryHover: '#22D3EE',
    accent: '#14B8A6',
    accentHover: '#2DD4BF',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 50%, #38BDF8 100%)',
    progress: 'linear-gradient(90deg, #0891B2 0%, #06B6D4 50%, #22D3EE 100%)',
    blueViolet: 'linear-gradient(90deg, #06B6D4 0%, #6366F1 100%)',
    ice: 'linear-gradient(135deg, #38BDF8 0%, #A5F3FC 100%)',
    spectrum: 'linear-gradient(90deg, #0891B2, #06B6D4, #22D3EE, #14B8A6, #6366F1)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#CBD5E1',
    tertiary: '#94A3B8',
    muted: '#64748B',
    disabled: '#475569',
    placeholder: '#334155',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(6, 182, 212, 0.35)',
    active: 'rgba(6, 182, 212, 0.60)',
    focus: 'rgba(6, 182, 212, 0.70)',
  },
  semantic: {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#06B6D4',
  },
  music: {
    playing: '#22D3EE',
    lyrics: '#FFFFFF',
    lyricsActive: '#06B6D4',
    lyricsHighlight: '#67E8F9',
    waveform: '#14B8A6',
    waveformActive: '#06B6D4',
  },
  glow: {
    xs: '0 0 6px rgba(6, 182, 212, 0.20)',
    sm: '0 0 12px rgba(6, 182, 212, 0.25)',
    md: '0 0 20px rgba(6, 182, 212, 0.35)',
    lg: '0 0 32px rgba(6, 182, 212, 0.30)',
    blueXs: '0 0 6px rgba(6, 182, 212, 0.20)',
    blueSm: '0 0 12px rgba(6, 182, 212, 0.25)',
    blueMd: '0 0 20px rgba(6, 182, 212, 0.35)',
    purpleXs: '0 0 6px rgba(99, 102, 241, 0.20)',
    purpleSm: '0 0 12px rgba(99, 102, 241, 0.25)',
    purpleMd: '0 0 20px rgba(99, 102, 241, 0.35)',
    brandSm: '0 0 12px rgba(6, 182, 212, 0.22), 0 0 24px rgba(99, 102, 241, 0.12)',
    brandMd: '0 0 18px rgba(6, 182, 212, 0.28), 0 0 36px rgba(99, 102, 241, 0.18)',
  },
}

export const oceanAbyssCssVariables: Record<string, string> = {}

export const oceanAbyssLightTokens: ColorTokens = {
  bg: {
    app: '#F0F9FF',
    primary: '#FFFFFF',
    secondary: '#F5FAFE',
    tertiary: '#E0F2FE',
  },
  surface: {
    s1: '#F0F9FF',
    s2: '#E0F2FE',
    s3: '#BAE6FD',
    hover: '#D5EEFD',
    active: '#BCE3FB',
    selected: 'rgba(8, 126, 150, 0.12)',
  },
  brand: {
    primary: '#087E96',
    primaryActive: '#065565',
    primaryHover: '#08697D',
    accent: '#0D9488',
    accentHover: '#0F766E',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #087E96 0%, #0D9488 100%)',
    progress: 'linear-gradient(90deg, #087E96 0%, #0D9488 100%)',
    blueViolet: 'linear-gradient(90deg, #087E96 0%, #4338CA 100%)',
    ice: 'linear-gradient(135deg, #38BDF8 0%, #7DD3FC 100%)',
    spectrum: 'linear-gradient(90deg, #065565, #087E96, #0D9488, #4338CA)',
  },
  text: {
    primary: '#040B11',
    secondary: '#334155',
    tertiary: '#64748B',
    muted: '#94A3B8',
    disabled: '#CBD5E1',
    placeholder: '#94A3B8',
  },
  border: {
    subtle: '#E0F2FE',
    default: '#94A3B8',
    hover: '#087E96',
    active: '#065565',
    focus: '#087E96',
  },
  semantic: {
    success: '#0E7A3D',
    warning: '#8A5A00',
    error: '#C1291F',
    info: '#0284C7',
  },
  music: {
    playing: '#087E96',
    lyrics: '#334155',
    lyricsActive: '#087E96',
    lyricsHighlight: '#0D9488',
    waveform: '#087E96',
    waveformActive: '#0D9488',
  },
  glow: {
    xs: '0 0 6px rgba(8, 126, 150, 0.15)',
    sm: '0 0 12px rgba(8, 126, 150, 0.12)',
    md: '0 0 20px rgba(8, 126, 150, 0.18)',
    lg: '0 0 32px rgba(8, 126, 150, 0.15)',
    blueXs: '0 0 6px rgba(8, 126, 150, 0.15)',
    blueSm: '0 0 12px rgba(8, 126, 150, 0.12)',
    blueMd: '0 0 20px rgba(8, 126, 150, 0.18)',
    purpleXs: '0 0 6px rgba(67, 56, 202, 0.15)',
    purpleSm: '0 0 12px rgba(67, 56, 202, 0.12)',
    purpleMd: '0 0 20px rgba(67, 56, 202, 0.18)',
    brandSm: '0 0 12px rgba(8, 126, 150, 0.15), 0 0 24px rgba(13, 148, 136, 0.08)',
    brandMd: '0 0 18px rgba(8, 126, 150, 0.18), 0 0 36px rgba(13, 148, 136, 0.12)',
  },
}

export const oceanAbyssLightCssVariables: Record<string, string> = {}

export const oceanAbyssTheme: ThemeDefinition = {
  id: 'ocean-abyss',
  name: 'Ocean Abyss',
  description: 'Serene deep-sea blue and luminous fluorescent teal — an immersive, ethereal ocean of sound',
  isDark: true,
  tokens: oceanAbyssTokens,
  lightTokens: oceanAbyssLightTokens,
  cssVariables: oceanAbyssCssVariables,
  lightCssVariables: oceanAbyssLightCssVariables,
}
