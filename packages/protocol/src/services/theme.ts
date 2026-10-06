/**
 * `ctx.theme` — Application color management and theme service.
 */

import type {} from 'cordis'
import type { Disposable } from '../common.js'

export interface ColorTokens {
  bg: {
    app: string
    primary: string
    secondary: string
    tertiary: string
  }
  surface: {
    s1: string
    s2: string
    s3: string
    hover: string
    active: string
    selected: string
  }
  brand: {
    primary: string
    primaryActive: string
    primaryHover: string
    accent: string
    accentHover: string
  }
  gradient: {
    brand: string
    progress: string
    blueViolet?: string
    ice?: string
    spectrum?: string
  }
  text: {
    primary: string
    secondary: string
    tertiary: string
    muted: string
    disabled: string
    placeholder: string
  }
  border: {
    subtle: string
    default: string
    hover: string
    active: string
    focus: string
  }
  semantic: {
    success: string
    warning: string
    error: string
    info: string
  }
  music: {
    playing: string
    lyrics: string
    lyricsActive?: string
    lyricsHighlight?: string
    waveform: string
    waveformActive: string
  }
  glow: {
    xs: string
    sm: string
    md: string
    lg: string
    blueXs?: string
    blueSm?: string
    blueMd?: string
    purpleXs?: string
    purpleSm?: string
    purpleMd?: string
    brandSm?: string
    brandMd?: string
  }
}

export interface ThemeDefinition {
  /** Unique theme identifier (e.g., 'midnight-purple', 'spotify'). */
  id: string
  /** Human-readable theme display name. */
  name: string
  /** Optional theme description. */
  description?: string
  /** Whether this theme is dark mode. */
  isDark: boolean
  /** Full set of color tokens. */
  tokens: ColorTokens
  /** Optional light mode tokens. Used when active color scheme is light. */
  lightTokens?: ColorTokens
  /** Optional extra CSS custom property overrides. */
  cssVariables?: Record<string, string>
  /** Optional extra CSS custom property overrides specifically for light mode. */
  lightCssVariables?: Record<string, string>
}

export interface ThemeService {
  /** Returns all available themes, including built-ins and runtime registered themes. */
  getThemes(): readonly ThemeDefinition[]

  /** Returns the currently active theme snapshot. */
  getCurrentTheme(): ThemeDefinition

  /** Returns the currently active effective color scheme ('dark' or 'light'). */
  getEffectiveScheme(): 'dark' | 'light'

  /** Switches the active theme by id and persists the change. */
  setTheme(themeId: string): Promise<void>

  /**
   * Registers a new theme at runtime.
   * Returns a disposable that unregisters the theme when called.
   */
  registerTheme(theme: ThemeDefinition): Disposable

  /**
   * Removes a custom theme by id. Built-in themes cannot be removed.
   * If the removed theme is currently active, falls back to the default theme.
   * Returns true if removed, false otherwise.
   */
  removeTheme(themeId: string): boolean

  /** Subscribes to theme changes. */
  onThemeChange(listener: (theme: ThemeDefinition, scheme?: 'dark' | 'light') => void): Disposable
}

declare module 'cordis' {
  interface Context {
    theme: ThemeService
  }
}
