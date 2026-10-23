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

/**
 * Where a theme (variant or pack) came from. The origin decides how the
 * theme service persists it: built-in and plugin packs are never written to
 * the store, custom packs persist under the custom key, registry packs under
 * the registry key, and the dynamic pack is regenerated from the playing
 * track's cover and never persisted at all.
 */
export type ThemeOrigin = 'builtin' | 'plugin' | 'custom' | 'registry' | 'dynamic'

/** The settings-page category a theme pack belongs to. */
export type ThemeCategory = 'builtin' | 'dynamic' | 'custom' | 'registry'

/**
 * Maps a pack origin to the settings-page category that lists it. Plugin
 * packs (e.g. Catppuccin) are presented inside the built-in ("通用") group —
 * they ship with an installed plugin rather than through the custom or
 * registry channels.
 */
export function themeCategoryOf(origin: ThemeOrigin): ThemeCategory {
  switch (origin) {
    case 'dynamic':
      return 'dynamic'
    case 'custom':
      return 'custom'
    case 'registry':
      return 'registry'
    case 'builtin':
    case 'plugin':
      return 'builtin'
  }
}

/** Matugen-style colour-scheme algorithms for cover-derived dynamic themes. */
export type DynamicThemeScheme =
  | 'tonal-spot'
  | 'vibrant'
  | 'expressive'
  | 'content'
  | 'neutral'

/**
 * A theme's glassmorphism preset (component layer, "A" in the glass plan):
 * the values a theme *recommends* for frosted surfaces. A preset is only a
 * default — the user's `AppSettings.glass` values always win over it, and
 * the window-level OS effect ("B") is a user setting, never a theme preset,
 * because a theme must not be able to change the OS window chrome.
 */
export interface ThemeGlassPreset {
  /** Backdrop blur radius in px for glass surfaces. */
  blurPx?: number
  /** Backdrop saturation percentage (100 = unchanged). */
  saturate?: number
  /** Glass surface opacity, 0–100 (percent of the surface colour). */
  opacity?: number
  /** Glass border/highlight opacity, 0–100. */
  borderOpacity?: number
}

export interface ThemeDefinition {
  /** Unique theme identifier (e.g., 'midnight-purple', 'emerald-green'). */
  id: string
  /** Human-readable theme display name. */
  name: string
  /** Optional theme description. */
  description?: string
  /**
   * Registry/distribution semantic version (e.g. '1.0.0'). Registry metadata;
   * update checks treat absence as '0.0.0'.
   */
  version?: string
  /** Author or maintainer. Registry metadata; absent for built-in themes. */
  author?: string
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
  /** Id of the {@link ThemePack} this variant belongs to, when known. */
  packId?: string
  /** Where this variant came from; absent means 'builtin' for legacy data. */
  origin?: ThemeOrigin
  /** Optional effect presets this theme recommends (user settings win). */
  effects?: {
    glass?: ThemeGlassPreset
  }
}

/**
 * A theme pack: one installable/importable unit containing one or more
 * theme variants (e.g. Catppuccin's Latte/Frappé/Macchiato/Mocha). The
 * variant remains the executable unit — the pack is the grouping,
 * distribution and management unit the settings page works with.
 */
export interface ThemePack {
  /** Unique pack identifier (e.g. 'catppuccin', 'midnight-purple'). */
  id: string
  /** Human-readable pack display name. */
  name: string
  /** Optional pack description. */
  description?: string
  /** Author or maintainer. Absent for built-in packs. */
  author?: string
  /**
   * Pack semantic version (e.g. '1.0.0'). Registry metadata; update checks
   * treat absence as '0.0.0'.
   */
  version?: string
  /** Where this pack came from. */
  origin: ThemeOrigin
  /** The pack's variants, at least one. Variant ids are globally unique. */
  variants: readonly ThemeDefinition[]
  /**
   * Preview colours for browse/settings cards, as
   * `[background, surface, brand]` hex colours — enough for the UI to draw
   * a miniature window preview without any image asset. Absent means the
   * UI derives the same triple from the first variant's tokens.
   */
  preview?: {
    colors: readonly [string, string, string]
  }
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

  /* ── Theme packs (optional during the ThemePack rollout) ─────────────── */

  /**
   * Returns all registered theme packs, grouped as the settings page shows
   * them. Optional: hosts predating the ThemePack release do not provide
   * it, and callers fall back to wrapping {@link getThemes} results.
   */
  getPacks?(): readonly ThemePack[]

  /**
   * Registers a whole pack at once. Every variant becomes selectable;
   * re-registering a pack replaces its previous variants. If a replaced
   * variant was active, the theme is re-applied so changed tokens (or
   * effect presets) take effect immediately. Returns a disposable that
   * unregisters the entire pack.
   */
  registerThemePack?(pack: ThemePack): Disposable

  /**
   * Removes an entire pack and all its variants. Built-in packs cannot be
   * removed. If the active variant belonged to the pack, falls back to the
   * default theme. Returns true if removed, false otherwise.
   */
  removePack?(packId: string): boolean
}

declare module 'cordis' {
  interface Context {
    theme: ThemeService
  }
}
