import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

/**
 * Layer 1: Color Primitives extracted directly from the Bee anime character:
 * - Black / White high-contrast tech body & outfit
 * - Ice Blue & Electric Blue glowing wing roots and accents
 * - Periwinkle & Lavender wing feathers and floating music notes
 * - Soft Violet tips, headphones glow, and anime sparkles
 * - Deep Blue / Navy shadow tones
 */
export const cyberBeePrimitives = {
  // Neutral
  black950: '#05060A',
  black900: '#080A10',
  black850: '#0B0E16',
  black800: '#0F121C',
  white100: '#FFFFFF',
  white90: 'rgba(255, 255, 255, 0.90)',
  white75: 'rgba(255, 255, 255, 0.75)',
  white55: 'rgba(255, 255, 255, 0.55)',
  white35: 'rgba(255, 255, 255, 0.35)',

  // Ice Blue
  iceBlue100: '#EAF1FF',
  iceBlue200: '#D4E2FF',
  iceBlue300: '#B7CCFF',
  iceBlue400: '#91B0FF',
  iceBlue500: '#7598FF',

  // Electric Blue
  electricBlue400: '#6F9BFF',
  electricBlue500: '#5F87FF',
  electricBlue600: '#4F73FF',

  // Periwinkle
  periwinkle400: '#8996FF',
  periwinkle500: '#7C86FF',
  periwinkle600: '#6E75F5',

  // Lavender
  lavender300: '#D4CCFF',
  lavender400: '#BEB4FF',
  lavender500: '#A99CFF',
  lavender600: '#9687FF',

  // Violet
  violet400: '#B28CFF',
  violet500: '#9B73F5',
  violet600: '#875EE8',

  // Deep Blue
  deepBlue950: '#080D1A',
  deepBlue900: '#0B1124',
  deepBlue800: '#101831',
  deepBlue700: '#162142',
} as const

/**
 * Layer 2: Semantic Color Tokens
 */
export const midnightPurpleTokens: ColorTokens = {
  bg: {
    app: cyberBeePrimitives.black950,
    primary: cyberBeePrimitives.black900,
    secondary: cyberBeePrimitives.deepBlue950,
    tertiary: cyberBeePrimitives.deepBlue900,
  },
  surface: {
    s1: cyberBeePrimitives.deepBlue950,
    s2: cyberBeePrimitives.deepBlue900,
    s3: cyberBeePrimitives.deepBlue800,
    hover: cyberBeePrimitives.deepBlue800,
    active: cyberBeePrimitives.deepBlue700,
    selected: 'rgba(117, 152, 255, 0.12)',
  },
  brand: {
    primary: cyberBeePrimitives.electricBlue500, // #5F87FF
    primaryHover: cyberBeePrimitives.iceBlue400, // #91B0FF
    primaryActive: cyberBeePrimitives.periwinkle500, // #7C86FF
    accent: cyberBeePrimitives.lavender500, // #A99CFF
    accentHover: cyberBeePrimitives.lavender400, // #BEB4FF
  },
  gradient: {
    brand: 'linear-gradient(135deg, #5F87FF 0%, #7C86FF 45%, #9687FF 75%, #A99CFF 100%)',
    progress: 'linear-gradient(90deg, #4F73FF 0%, #6F9BFF 35%, #8996FF 65%, #B28CFF 100%)',
    blueViolet: 'linear-gradient(90deg, #5F87FF 0%, #7C86FF 50%, #A99CFF 100%)',
    ice: 'linear-gradient(135deg, #91B0FF 0%, #BEB4FF 50%, #D4CCFF 100%)',
    spectrum: 'linear-gradient(90deg, #4F73FF, #6F9BFF, #8996FF, #A99CFF, #B28CFF)',
  },
  text: {
    primary: cyberBeePrimitives.white100,
    secondary: cyberBeePrimitives.white75,
    tertiary: cyberBeePrimitives.white55,
    muted: cyberBeePrimitives.white35,
    disabled: 'rgba(255, 255, 255, 0.22)',
    placeholder: 'rgba(255, 255, 255, 0.35)',
  },
  border: {
    subtle: 'rgba(145, 176, 255, 0.08)',
    default: 'rgba(145, 176, 255, 0.14)',
    hover: 'rgba(145, 176, 255, 0.25)',
    active: 'rgba(117, 152, 255, 0.40)',
    focus: 'rgba(117, 152, 255, 0.50)',
  },
  semantic: {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#7598FF',
  },
  music: {
    playing: cyberBeePrimitives.lavender400, // #BEB4FF
    lyrics: cyberBeePrimitives.iceBlue300, // #B7CCFF
    lyricsActive: cyberBeePrimitives.lavender300, // #D4CCFF
    lyricsHighlight: cyberBeePrimitives.iceBlue200, // #D4E2FF
    waveform: cyberBeePrimitives.electricBlue400, // #6F9BFF
    waveformActive: cyberBeePrimitives.lavender400, // #BEB4FF
  },
  glow: {
    xs: '0 0 6px rgba(117, 152, 255, 0.25)',
    sm: '0 0 12px rgba(117, 152, 255, 0.18), 0 0 24px rgba(169, 156, 255, 0.10)',
    md: '0 0 18px rgba(117, 152, 255, 0.22), 0 0 36px rgba(169, 156, 255, 0.14)',
    lg: '0 0 28px rgba(117, 152, 255, 0.25), 0 0 48px rgba(169, 156, 255, 0.16)',
    blueXs: '0 0 6px rgba(117, 152, 255, 0.25)',
    blueSm: '0 0 12px rgba(117, 152, 255, 0.20)',
    blueMd: '0 0 20px rgba(117, 152, 255, 0.28)',
    purpleXs: '0 0 6px rgba(169, 156, 255, 0.25)',
    purpleSm: '0 0 12px rgba(169, 156, 255, 0.20)',
    purpleMd: '0 0 20px rgba(169, 156, 255, 0.28)',
    brandSm: '0 0 12px rgba(117, 152, 255, 0.18), 0 0 24px rgba(169, 156, 255, 0.10)',
    brandMd: '0 0 18px rgba(117, 152, 255, 0.22), 0 0 36px rgba(169, 156, 255, 0.14)',
  },
}

/**
 * Layer 3: Component-level tokens & full CSS custom properties mapping.
 */
export const cyberBeeCssVariables: Record<string, string> = {
  // Color Primitives
  '--black-950': cyberBeePrimitives.black950,
  '--black-900': cyberBeePrimitives.black900,
  '--black-850': cyberBeePrimitives.black850,
  '--black-800': cyberBeePrimitives.black800,
  '--white-100': cyberBeePrimitives.white100,
  '--white-90': cyberBeePrimitives.white90,
  '--white-75': cyberBeePrimitives.white75,
  '--white-55': cyberBeePrimitives.white55,
  '--white-35': cyberBeePrimitives.white35,

  '--ice-blue-100': cyberBeePrimitives.iceBlue100,
  '--ice-blue-200': cyberBeePrimitives.iceBlue200,
  '--ice-blue-300': cyberBeePrimitives.iceBlue300,
  '--ice-blue-400': cyberBeePrimitives.iceBlue400,
  '--ice-blue-500': cyberBeePrimitives.iceBlue500,

  '--electric-blue-400': cyberBeePrimitives.electricBlue400,
  '--electric-blue-500': cyberBeePrimitives.electricBlue500,
  '--electric-blue-600': cyberBeePrimitives.electricBlue600,

  '--periwinkle-400': cyberBeePrimitives.periwinkle400,
  '--periwinkle-500': cyberBeePrimitives.periwinkle500,
  '--periwinkle-600': cyberBeePrimitives.periwinkle600,

  '--lavender-300': cyberBeePrimitives.lavender300,
  '--lavender-400': cyberBeePrimitives.lavender400,
  '--lavender-500': cyberBeePrimitives.lavender500,
  '--lavender-600': cyberBeePrimitives.lavender600,

  '--violet-400': cyberBeePrimitives.violet400,
  '--violet-500': cyberBeePrimitives.violet500,
  '--violet-600': cyberBeePrimitives.violet600,

  '--deep-blue-950': cyberBeePrimitives.deepBlue950,
  '--deep-blue-900': cyberBeePrimitives.deepBlue900,
  '--deep-blue-800': cyberBeePrimitives.deepBlue800,
  '--deep-blue-700': cyberBeePrimitives.deepBlue700,

  // Semantic Colors
  '--color-bg-app': 'var(--black-950)',
  '--color-bg-primary': 'var(--black-900)',
  '--color-bg-secondary': 'var(--deep-blue-950)',
  '--color-bg-tertiary': 'var(--deep-blue-900)',

  '--color-surface': 'var(--deep-blue-900)',
  '--color-surface-hover': 'var(--deep-blue-800)',
  '--color-surface-active': 'var(--deep-blue-700)',
  '--color-surface-selected': 'rgba(117, 152, 255, 0.12)',

  '--color-text-primary': 'var(--white-100)',
  '--color-text-secondary': 'var(--white-75)',
  '--color-text-tertiary': 'var(--white-55)',
  '--color-text-muted': 'var(--white-35)',
  '--color-text-disabled': 'rgba(255, 255, 255, 0.22)',

  '--color-primary': 'var(--electric-blue-500)',
  '--color-primary-hover': 'var(--ice-blue-400)',
  '--color-primary-active': 'var(--periwinkle-500)',

  '--color-accent': 'var(--lavender-500)',
  '--color-accent-hover': 'var(--lavender-400)',

  '--color-playing': 'var(--lavender-400)',
  '--color-lyrics': 'var(--ice-blue-300)',
  '--color-lyrics-active': 'var(--lavender-300)',
  '--color-lyrics-highlight': 'var(--ice-blue-200)',
  '--color-waveform': 'var(--electric-blue-400)',
  '--color-waveform-active': 'var(--lavender-400)',

  // Gradients
  '--gradient-brand': 'linear-gradient(135deg, #5F87FF 0%, #7C86FF 45%, #9687FF 75%, #A99CFF 100%)',
  '--gradient-blue-violet': 'linear-gradient(90deg, #5F87FF 0%, #7C86FF 50%, #A99CFF 100%)',
  '--gradient-ice': 'linear-gradient(135deg, #91B0FF 0%, #BEB4FF 50%, #D4CCFF 100%)',
  '--gradient-progress': 'linear-gradient(90deg, #4F73FF 0%, #6F9BFF 35%, #8996FF 65%, #B28CFF 100%)',
  '--gradient-spectrum': 'linear-gradient(90deg, #4F73FF, #6F9BFF, #8996FF, #A99CFF, #B28CFF)',

  // Glow System
  '--glow-blue-xs': '0 0 6px rgba(117, 152, 255, 0.25)',
  '--glow-blue-sm': '0 0 12px rgba(117, 152, 255, 0.20)',
  '--glow-blue-md': '0 0 20px rgba(117, 152, 255, 0.28)',

  '--glow-purple-xs': '0 0 6px rgba(169, 156, 255, 0.25)',
  '--glow-purple-sm': '0 0 12px rgba(169, 156, 255, 0.20)',
  '--glow-purple-md': '0 0 20px rgba(169, 156, 255, 0.28)',

  '--glow-brand-sm': '0 0 12px rgba(117, 152, 255, 0.18), 0 0 24px rgba(169, 156, 255, 0.10)',
  '--glow-brand-md': '0 0 18px rgba(117, 152, 255, 0.22), 0 0 36px rgba(169, 156, 255, 0.14)',

  // Component Tokens
  // Button
  '--button-primary-bg': 'var(--gradient-brand)',
  '--button-primary-hover': 'var(--gradient-ice)',
  '--button-primary-text': '#FFFFFF',

  // Player
  '--player-bg': 'var(--bg-app)',
  '--player-progress': 'var(--gradient-progress)',
  '--player-playing': 'var(--lavender-400)',

  // Slider
  '--slider-track': 'rgba(255, 255, 255, 0.10)',
  '--slider-active': 'var(--gradient-progress)',
  '--slider-thumb': 'var(--ice-blue-300)',

  // Waveform
  '--waveform-idle': 'rgba(117, 152, 255, 0.35)',
  '--waveform-active': 'var(--gradient-spectrum)',

  // Lyrics
  '--lyrics-normal': 'rgba(255, 255, 255, 0.45)',
  '--lyrics-active': 'var(--lavender-300)',
  '--lyrics-highlight': 'var(--ice-blue-200)',

  // Sidebar
  '--sidebar-bg': 'var(--black-900)',
  '--sidebar-item-hover': 'rgba(117, 152, 255, 0.07)',
  '--sidebar-item-active': 'rgba(169, 156, 255, 0.12)',
  '--sidebar-active-indicator': 'var(--gradient-brand)',

  // Card
  '--card-bg': 'var(--deep-blue-950)',
  '--card-hover': 'var(--deep-blue-900)',
  '--card-border': 'rgba(145, 176, 255, 0.10)',
  '--card-border-hover': 'rgba(145, 176, 255, 0.25)',
  '--card-shadow': 'none',
  '--settings-card-bg': 'var(--deep-blue-950)',
  '--settings-card-border': 'rgba(145, 176, 255, 0.10)',
  '--settings-card-shadow': 'none',
  '--switch-off-bg': 'rgba(255, 255, 255, 0.15)',

  // Tabs
  '--tab-text': 'var(--white-55)',
  '--tab-text-active': 'var(--ice-blue-200)',
  '--tab-indicator': 'var(--gradient-brand)',

  // Input
  '--input-bg': 'rgba(255, 255, 255, 0.035)',
  '--input-border': 'rgba(145, 176, 255, 0.10)',
  '--input-focus-border': 'rgba(117, 152, 255, 0.50)',
  '--input-focus-glow': 'var(--glow-blue-sm)',

  // Playing Item
  '--playing-item-bg': 'rgba(117, 152, 255, 0.06)',
  '--playing-item-border': 'rgba(169, 156, 255, 0.18)',
  '--playing-item-indicator': 'var(--gradient-brand)',
  '--playing-item-glow': 'var(--glow-brand-sm)',
}

export const midnightPurpleLightTokens: ColorTokens = {
  bg: {
    app: '#F0F4FC',
    primary: '#FFFFFF',
    secondary: '#F6F8FE',
    tertiary: '#EDF2FC',
  },
  surface: {
    s1: '#F6F8FE',
    s2: '#EDF2FC',
    s3: '#E2EAFC',
    hover: '#E8F0FE',
    active: '#DCE7FA',
    selected: 'rgba(59, 102, 245, 0.12)',
  },
  brand: {
    primary: '#3B66F5',
    primaryActive: '#1F3FA8',
    primaryHover: '#294FD6',
    accent: '#7048E8',
    accentHover: '#5F3DC4',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #3B66F5 0%, #5C4BE2 45%, #7048E8 100%)',
    progress: 'linear-gradient(90deg, #3B66F5 0%, #5C4BE2 50%, #7048E8 100%)',
    blueViolet: 'linear-gradient(90deg, #3B66F5 0%, #7048E8 100%)',
    ice: 'linear-gradient(135deg, #60A5FA 0%, #A78BFA 100%)',
    spectrum: 'linear-gradient(90deg, #3B66F5, #5C4BE2, #7048E8)',
  },
  text: {
    primary: '#080A10',
    secondary: '#4B5563',
    tertiary: '#6B7280',
    muted: '#9CA3AF',
    disabled: '#D1D5DB',
    placeholder: '#9CA3AF',
  },
  border: {
    subtle: '#E5E7EB',
    default: '#9CA3AF',
    hover: '#3B66F5',
    active: '#294FD6',
    focus: '#3B66F5',
  },
  semantic: {
    success: '#0E7A3D',
    warning: '#8A5A00',
    error: '#C1291F',
    info: '#2563EB',
  },
  music: {
    playing: '#3B66F5',
    lyrics: '#4B5563',
    lyricsActive: '#3B66F5',
    lyricsHighlight: '#7048E8',
    waveform: '#3B66F5',
    waveformActive: '#7048E8',
  },
  glow: {
    xs: '0 0 6px rgba(59, 102, 245, 0.15)',
    sm: '0 0 12px rgba(59, 102, 245, 0.12)',
    md: '0 0 20px rgba(59, 102, 245, 0.18)',
    lg: '0 0 32px rgba(59, 102, 245, 0.15)',
    blueXs: '0 0 6px rgba(59, 102, 245, 0.15)',
    blueSm: '0 0 12px rgba(59, 102, 245, 0.12)',
    blueMd: '0 0 20px rgba(59, 102, 245, 0.18)',
    purpleXs: '0 0 6px rgba(112, 72, 232, 0.15)',
    purpleSm: '0 0 12px rgba(112, 72, 232, 0.12)',
    purpleMd: '0 0 20px rgba(112, 72, 232, 0.18)',
    brandSm: '0 0 12px rgba(59, 102, 245, 0.15), 0 0 24px rgba(112, 72, 232, 0.08)',
    brandMd: '0 0 18px rgba(59, 102, 245, 0.18), 0 0 36px rgba(112, 72, 232, 0.12)',
  },
}

export const midnightPurpleLightCssVariables: Record<string, string> = {
  // Primitives
  '--black-950': '#F0F4FC',
  '--black-900': '#FFFFFF',
  '--black-850': '#F6F8FE',
  '--black-800': '#EDF2FC',
  '--white-100': '#080A10',
  '--white-90': '#1F2937',
  '--white-75': '#4B5563',
  '--white-55': '#6B7280',
  '--white-35': '#9CA3AF',
  '--electric-blue-500': '#3B66F5',
  '--electric-blue-400': '#5B82F7',
  '--lavender-500': '#7048E8',
  '--lavender-400': '#845EF7',
  '--ice-blue-300': '#3B66F5',
  '--ice-blue-200': '#7048E8',

  // Semantic
  '--color-bg-app': '#F0F4FC',
  '--color-bg-primary': '#FFFFFF',
  '--color-bg-secondary': '#F6F8FE',
  '--color-bg-tertiary': '#EDF2FC',
  '--color-surface': '#F6F8FE',
  '--color-surface-hover': '#E8F0FE',
  '--color-surface-active': '#DCE7FA',
  '--color-surface-selected': 'rgba(59, 102, 245, 0.12)',
  '--color-text-primary': '#080A10',
  '--color-text-secondary': '#4B5563',
  '--color-text-tertiary': '#6B7280',
  '--color-text-muted': '#9CA3AF',
  '--color-text-disabled': '#D1D5DB',
  '--color-primary': '#3B66F5',
  '--color-primary-hover': '#294FD6',
  '--color-primary-active': '#1F3FA8',
  '--color-accent': '#7048E8',
  '--color-accent-hover': '#5F3DC4',
  '--color-playing': '#3B66F5',
  '--color-lyrics': '#4B5563',
  '--color-lyrics-active': '#3B66F5',
  '--color-lyrics-highlight': '#7048E8',
  '--color-waveform': '#3B66F5',
  '--color-waveform-active': '#7048E8',

  '--gradient-brand': 'linear-gradient(135deg, #3B66F5 0%, #5C4BE2 45%, #7048E8 100%)',
  '--gradient-blue-violet': 'linear-gradient(90deg, #3B66F5 0%, #7048E8 100%)',
  '--gradient-ice': 'linear-gradient(135deg, #60A5FA 0%, #A78BFA 100%)',
  '--gradient-progress': 'linear-gradient(90deg, #3B66F5 0%, #5C4BE2 50%, #7048E8 100%)',
  '--gradient-spectrum': 'linear-gradient(90deg, #3B66F5, #5C4BE2, #7048E8)',

  '--button-primary-bg': 'linear-gradient(135deg, #3B66F5 0%, #7048E8 100%)',
  '--button-primary-hover': 'linear-gradient(135deg, #294FD6 0%, #5F3DC4 100%)',
  '--button-primary-text': '#FFFFFF',
  '--player-bg': '#F0F4FC',
  '--player-progress': 'linear-gradient(90deg, #3B66F5 0%, #7048E8 100%)',
  '--player-playing': '#3B66F5',
  '--slider-track': 'rgba(0, 0, 0, 0.08)',
  '--slider-active': 'linear-gradient(90deg, #3B66F5 0%, #7048E8 100%)',
  '--slider-thumb': '#3B66F5',
  '--waveform-idle': 'rgba(59, 102, 245, 0.35)',
  '--waveform-active': 'linear-gradient(90deg, #3B66F5, #5C4BE2, #7048E8)',
  '--lyrics-normal': '#4B5563',
  '--lyrics-active': '#3B66F5',
  '--lyrics-highlight': '#7048E8',
  '--sidebar-bg': '#F0F4FC',
  '--sidebar-item-hover': 'rgba(59, 102, 245, 0.07)',
  '--sidebar-item-active': 'rgba(59, 102, 245, 0.12)',
  '--sidebar-active-indicator': 'linear-gradient(135deg, #3B66F5 0%, #7048E8 100%)',
  '--card-bg': '#EDF2FC',
  '--card-hover': '#E2EAFC',
  '--card-border': '#CBD5E1',
  '--card-border-hover': 'rgba(59, 102, 245, 0.35)',
  '--card-shadow': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
  '--settings-card-bg': '#EDF2FC',
  '--settings-card-border': '#CBD5E1',
  '--settings-card-shadow': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
  '--switch-off-bg': '#D1D5DB',
  '--tab-text': '#6B7280',
  '--tab-text-active': '#3B66F5',
  '--tab-indicator': '#3B66F5',
  '--input-bg': '#FFFFFF',
  '--input-border': '#CBD5E1',
  '--input-focus-border': '#3B66F5',
  '--input-focus-glow': '0 0 8px rgba(59, 102, 245, 0.25)',
  '--playing-item-bg': 'rgba(59, 102, 245, 0.06)',
  '--playing-item-border': 'rgba(112, 72, 232, 0.18)',
  '--playing-item-indicator': 'linear-gradient(135deg, #3B66F5 0%, #7048E8 100%)',
}

export const midnightPurpleTheme: ThemeDefinition = {
  id: 'midnight-purple',
  name: 'Bee Music · Cyber Neon (蓝紫电光)',
  description: '以 Bee 角色为视觉核心，黑白对比与冰蓝、电光蓝、薰衣草紫连续光谱，通透微光与沉浸深黑。',
  isDark: true,
  tokens: midnightPurpleTokens,
  lightTokens: midnightPurpleLightTokens,
  cssVariables: cyberBeeCssVariables,
  lightCssVariables: midnightPurpleLightCssVariables,
}
