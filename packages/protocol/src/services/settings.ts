/**
 * `ctx.settings` — global application preferences and configuration service.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'
import type { DesktopLyricsPosition } from './lyrics.js'
import type { DynamicThemeScheme, ThemeCategory } from './theme.js'
import type { SettingsContribution } from './ui.js'

export type { SettingsContribution }

export interface DesktopLyricsSettings {
  /** Whether desktop lyrics is currently enabled/visible. Default is false. */
  enabled?: boolean
  /** Saved screen position (x, y coordinates). */
  position?: DesktopLyricsPosition
  /** Whether lyrics window mouse penetration is locked. */
  locked?: boolean
  /** Line display mode: single line or double line. */
  lineMode: 'single' | 'double'
  /** Horizontal alignment: center, left, or right. */
  align: 'center' | 'left' | 'right'
  /** Font family for desktop lyrics. */
  fontFamily: string
  /** Font size in pixels. */
  fontSize: number
  /** Text highlight/primary color (hex string, e.g. '#FFFFFF'). */
  textColor: string
  /** Text opacity between 0.2 and 1.0. */
  opacity: number
}

export interface ShortcutKeybindings {
  playPause: string
  prevTrack: string
  nextTrack: string
  volumeUp: string
  volumeDown: string
  toggleLyrics: string
  toggleWindow: string
  toggleLoved: string
  seekForward: string
  seekBackward: string
}

export interface GlobalShortcutsSettings {
  /** Master switch for global desktop shortcuts. */
  enabled: boolean
  /** Keybindings mapped to specific actions. */
  keybindings: ShortcutKeybindings
}

export interface ProxySettings {
  /** Whether network proxy is enabled. */
  enabled: boolean
  /** Proxy protocol type. */
  protocol: 'http' | 'https' | 'socks5'
  /** Proxy server host. */
  host: string
  /** Proxy server port. */
  port: number
  /** Optional proxy authentication username. */
  username?: string
  /** Optional proxy authentication password. */
  password?: string
  /** Per-source proxy enable toggle (sourceId -> boolean). */
  sourceRules: Record<string, boolean>
}

export type VisualizerStyle = 'bars' | 'wave' | 'circle' | 'particles'
export type VisualizerColorTheme = 'accent' | 'neon' | 'rainbow' | 'monochrome'

export interface VisualizerSettings {
  /** Whether the visualizer is enabled on the now playing screen. */
  enabled: boolean
  /** Visualizer display style: 'bars', 'wave', 'circle', or 'particles'. */
  style: VisualizerStyle
  /** Visualizer color theme: 'accent', 'neon', 'rainbow', or 'monochrome'. */
  colorTheme: VisualizerColorTheme
  /** FFT size for frequency analysis (must be power of 2: 64, 128, 256). */
  fftSize: number
  /** Sensitivity multiplier for amplitude (0.5 to 2.0). */
  sensitivity: number
}

/**
 * Where the user downloads from, stored as a preference. Today it is advisory:
 * the GitHub download layer always tries the official endpoint first and only
 * reads this value into its logs; acceleration happens through
 * `githubAccelerationPrefixes`.
 */
/** Dynamic (cover-derived) theme generation preferences. */
export interface DynamicThemeSettings {
  /** Matugen-style scheme algorithm used to expand the cover seed colour. */
  scheme: DynamicThemeScheme
  /**
   * Contrast adjustment, -100 (least) to 100 (most), 0 = standard.
   * Mirrors the Matugen contrast slider in the settings UI.
   */
  contrast: number
  /** Theme variant id used when no track/cover is available. */
  fallbackThemeId: string
}

/** OS window-level glass effect (layer "B" of the glass plan, desktop only). */
export type WindowGlassEffect = 'auto' | 'acrylic' | 'mica' | 'vibrancy' | 'blur'

export interface WindowGlassSettings {
  /** Whether the OS window effect is on. Unsupported platforms ignore it. */
  enabled: boolean
  /** Effect kind; 'auto' resolves per platform (macOS vibrancy, Windows acrylic, Linux none). */
  effect: WindowGlassEffect
  /** Opacity of the window tint layer, 0–100. */
  tintOpacity: number
  /** Whether the window tint follows the active theme's brand colour. */
  tintFollowTheme: boolean
  /** Custom window tint hex colour, used when `tintFollowTheme` is false. */
  tintColor?: string
}

/** Where the component glass layer's blurred backdrop comes from. */
export type GlassAmbientSource = 'cover' | 'theme' | 'desktop' | 'none'

/** Component-level glass preferences (layer "A" of the glass plan). */
export interface ComponentGlassSettings {
  /** Whether frosted component surfaces are on. */
  enabled: boolean
  /** Backdrop blur radius in px. */
  blurPx: number
  /** Backdrop saturation percentage (100 = unchanged). */
  saturate: number
  /** Glass surface opacity, 0–100. */
  opacity: number
  /** Glass border/highlight opacity, 0–100. */
  borderOpacity: number
  /** Backdrop source painted behind glass surfaces. */
  ambientSource: GlassAmbientSource
  /** Blur radius in px applied to the ambient backdrop itself. */
  ambientBlurPx: number
  /** Ambient backdrop opacity, 0–100. */
  ambientOpacity: number
}

/** The glass surfaces that can override the global component values. */
export type GlassSurfaceId = 'sidebar' | 'topbar' | 'player' | 'cards' | 'popovers'

/** Per-surface glass overrides; absent fields inherit the global values. */
export interface GlassSurfaceOverride {
  blurPx?: number
  saturate?: number
  opacity?: number
  borderOpacity?: number
}

/**
 * Glassmorphism preferences. Two independent layers: `window` is the OS
 * compositor effect (B), `components` is the in-app frosted-surface layer
 * (A). A theme may recommend component values via its glass preset, but
 * these user settings always win, and the window layer is user-only.
 */
export interface GlassSettings {
  window: WindowGlassSettings
  components: ComponentGlassSettings
  surfaces: Partial<Record<GlassSurfaceId, GlassSurfaceOverride>>
}

export type DownloadRegion = 'global' | 'mainland-china'

export type AudioOutputEngine = 'mpv' | 'wasapi'

export type LoudnessNormalizationMode = 'track' | 'album' | 'dynamic'

export interface AppSettings {
  /** Visual appearance theme mode. */
  theme: 'dark' | 'light' | 'system'
  /** Color theme identifier (e.g. 'midnight-purple', 'emerald-green'). */
  themeId?: string
  /**
   * Which settings-page category the active theme belongs to
   * ('builtin' | 'dynamic' | 'custom' | 'registry'). Orthogonal to the
   * `theme` appearance mode: it records where the active variant came
   * from and which tab the theme card opens on.
   */
  themeCategory?: ThemeCategory
  /** Id of the theme pack the active variant belongs to, when known. */
  themePackId?: string
  /** Cover-derived dynamic theme preferences (the "自动" category). */
  dynamicTheme: DynamicThemeSettings
  /** Glassmorphism preferences (window layer B + component layer A). */
  glass: GlassSettings
  /** Full-screen player style layout identifier (e.g. 'classic', 'cinematic'). */
  nowPlayingStyle: string
  /** User interface language. */
  language: 'zh' | 'en' | 'system'
  /** Default startup playback volume (0 to 100). */
  defaultVolume?: number
  /** Whether crossfade is enabled between tracks. */
  crossfadeEnabled: boolean
  /** Crossfade transition duration in seconds (1 to 10). */
  crossfadeDurationSeconds: number
  /** Whether gapless playback is enabled. */
  gaplessPlayback: boolean
  /** Whether loudness normalization is enabled between tracks. Defaults to false. */
  loudnessNormalizationEnabled?: boolean
  /** Normalization mode: 'track' (per-track ReplayGain), 'album' (preserve album dynamics), or 'dynamic' (EBU R128 real-time). */
  loudnessNormalizationMode?: LoudnessNormalizationMode
  /** Target loudness in LUFS (defaults to -14). */
  loudnessTargetLufs?: number
  /** Preamp adjustment in dB (defaults to 0). */
  loudnessPreampDb?: number
  /** Whether to pause playback when headphones/audio devices unplug. */
  pauseOnUnplug: boolean
  /** Whether closing the main window minimizes to system tray (desktop only). */
  closeToTray: boolean
  /** Custom download directory path. */
  downloadDir?: string
  /** Preferred download audio format ('auto', 'flac', 'mp3', 'mp4'). */
  downloadFormat?: 'auto' | 'flac' | 'mp3' | 'mp4' | (string & {})
  /** Whether to download only when connected to Wi-Fi. */
  downloadWifiOnly?: boolean
  /** Custom media cache directory path. */
  cacheDir?: string
  /** Audio output engine: 'mpv' (native libmpv engine); 'wasapi' is the legacy settings value for the same engine. */
  audioOutputEngine?: AudioOutputEngine
  /** Whether to use exclusive mode when MPV audio backend is active. Defaults to false. */
  audioExclusive?: boolean
  /** Selected audio output device ID. Defaults to 'default'. */
  audioOutputDeviceId?: string
  /**
   * Sent as the HTTP `User-Agent` header on every request that goes through
   * `ctx.http` without setting its own — music sources, lyric sources, and
   * artwork fetches. Empty string restores the built-in default; a source
   * document that declares its own `header` rule still wins over this.
   */
  userAgent: string
  /**
   * Master switch for third-party music sources. When false, the source
   * runtime stops every imported document's fiber (search and playback
   * resolve to "no provider") while the imported rows stay in place, so
   * re-enabling restores everything without a re-import. Local files and
   * downloads are unaffected.
   */
  thirdPartySourcesEnabled: boolean
  /**
   * Master switch for third-party lyric sources. When false, lyric lookup
   * through `ctx.lyricSources` returns nothing; per-source toggles keep
   * their state for when it is turned back on.
   */
  thirdPartyLyricSourcesEnabled: boolean
  /**
   * Whether the registry service checks the community index for content
   * updates automatically (once shortly after boot, then daily). Turning it
   * off leaves manual checks and installs working.
   */
  registryAutoCheck?: boolean
  /**
   * Download region preference (`'global'` by default). The GitHub download
   * layer keeps the official endpoint first regardless of the region; the
   * value is read (and surfaced in its logs) as a stored preference.
   *
   * The plugin manager also reads this as the "domestic" switch: when
   * `'mainland-china'`, the effective npm registry defaults to npmmirror and
   * the community registry index defaults to jsDelivr, unless the two manual
   * overrides below are set (a manual URL always wins over the region default).
   */
  downloadRegion?: DownloadRegion
  /**
   * GitHub acceleration prefixes, in the order they are tried. Each entry is
   * an HTTPS base URL (e.g. `https://ghproxy.example.com/`) that gets the
   * original full URL appended, gh-proxy style. The system jsDelivr mirror
   * is built in and not listed here; an empty list means no custom
   * acceleration lines.
   */
  githubAccelerationPrefixes?: readonly string[]
  /**
   * Manual npm registry base URL override for plugin downloads
   * (e.g. a private Verdaccio). Empty/undefined means "derive from
   * `downloadRegion`": npmmirror for `'mainland-china'`, the official
   * `https://registry.npmjs.org` otherwise. A manual URL always wins.
   */
  npmRegistryUrl?: string
  /**
   * Manual base URL override for the community registry raw files
   * (replaces `https://raw.githubusercontent.com/<owner>/<repo>/<branch>`).
   * Empty/undefined means "derive from `downloadRegion`": jsDelivr for
   * `'mainland-china'`, the official raw host otherwise. A manual URL always
   * wins. The value must already contain owner/repo/branch, e.g.
   * `https://ghproxy.example.com/https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-registry/main`.
   */
  githubRawBaseUrl?: string
  /** Desktop floating lyrics display settings. */
  desktopLyrics: DesktopLyricsSettings
  /** Global desktop keyboard shortcuts configuration. */
  shortcuts: GlobalShortcutsSettings
  /** Network proxy routing configuration. */
  proxy: ProxySettings
  /** Audio visualizer configuration. */
  visualizer: VisualizerSettings
}

export const DEFAULT_DYNAMIC_THEME_SETTINGS: DynamicThemeSettings = {
  scheme: 'tonal-spot',
  contrast: 0,
  fallbackThemeId: 'midnight-purple',
}

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  window: {
    enabled: false,
    effect: 'auto',
    tintOpacity: 72,
    tintFollowTheme: true,
  },
  components: {
    enabled: false,
    blurPx: 20,
    saturate: 160,
    opacity: 78,
    borderOpacity: 12,
    ambientSource: 'cover',
    ambientBlurPx: 40,
    ambientOpacity: 55,
  },
  surfaces: {},
}

export const DEFAULT_VISUALIZER_SETTINGS: VisualizerSettings = {
  enabled: true,
  style: 'bars',
  colorTheme: 'accent',
  fftSize: 128,
  sensitivity: 1.0,
}

export const DEFAULT_DESKTOP_LYRICS_SETTINGS: DesktopLyricsSettings = {
  enabled: false,
  position: { x: -1, y: -1 },
  locked: false,
  lineMode: 'double',
  align: 'center',
  fontFamily: 'system-ui',
  fontSize: 24,
  textColor: '#FFFFFF',
  opacity: 0.92,
}

export const DEFAULT_SHORTCUTS_SETTINGS: GlobalShortcutsSettings = {
  enabled: true,
  keybindings: {
    playPause: 'CommandOrControl+Alt+Space',
    prevTrack: 'CommandOrControl+Alt+Left',
    nextTrack: 'CommandOrControl+Alt+Right',
    volumeUp: 'CommandOrControl+Alt+Up',
    volumeDown: 'CommandOrControl+Alt+Down',
    toggleLyrics: 'CommandOrControl+Alt+L',
    toggleWindow: 'CommandOrControl+Alt+W',
    toggleLoved: 'CommandOrControl+Alt+K',
    seekForward: 'CommandOrControl+Alt+RightBracket',
    seekBackward: 'CommandOrControl+Alt+LeftBracket',
  },
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
  username: '',
  password: '',
  sourceRules: {},
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  themeId: 'midnight-purple',
  themeCategory: 'builtin',
  themePackId: 'midnight-purple',
  dynamicTheme: { ...DEFAULT_DYNAMIC_THEME_SETTINGS },
  glass: {
    window: { ...DEFAULT_GLASS_SETTINGS.window },
    components: { ...DEFAULT_GLASS_SETTINGS.components },
    surfaces: {},
  },
  nowPlayingStyle: 'cinematic',
  /**
   * New installs follow the OS language. `plugin-settings` merges stored
   * values over these defaults (`mergeSettings`), so this change never
   * rewrites an existing user's explicit choice — only users without a
   * stored `language` see the new default.
   *
   * `'system'` resolves in `ctx.i18n` through BCP 47 negotiation against
   * the known catalogue locales (`device.locale`, e.g. `zh-HK` → `zh`,
   * `fr-FR` → `en`), so an unsupported OS language lands on English.
   */
  language: 'system',
  defaultVolume: 80,
  crossfadeEnabled: false,
  crossfadeDurationSeconds: 3,
  gaplessPlayback: true,
  loudnessNormalizationEnabled: false,
  loudnessNormalizationMode: 'track',
  loudnessTargetLufs: -14,
  loudnessPreampDb: 0,
  pauseOnUnplug: true,
  closeToTray: true,
  downloadDir: '',
  downloadFormat: 'auto',
  downloadWifiOnly: false,
  cacheDir: '',
  audioOutputEngine: 'wasapi',
  audioExclusive: false,
  audioOutputDeviceId: 'default',
  userAgent: DEFAULT_USER_AGENT,
  thirdPartySourcesEnabled: true,
  thirdPartyLyricSourcesEnabled: true,
  registryAutoCheck: true,
  downloadRegion: 'global',
  githubAccelerationPrefixes: [],
  desktopLyrics: { ...DEFAULT_DESKTOP_LYRICS_SETTINGS },
  shortcuts: {
    enabled: DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: { ...DEFAULT_SHORTCUTS_SETTINGS.keybindings },
  },
  proxy: {
    ...DEFAULT_PROXY_SETTINGS,
    sourceRules: { ...DEFAULT_PROXY_SETTINGS.sourceRules },
  },
  visualizer: { ...DEFAULT_VISUALIZER_SETTINGS },
}

export interface SettingsService {
  /** Returns the current application settings snapshot. */
  get(): Promise<AppSettings>

  /** Returns the cached application settings snapshot synchronously. */
  getSync(): AppSettings

  /** Updates settings partially and persists the changes. */
  update(partial: Partial<AppSettings>): Promise<AppSettings>

  /** Resets settings back to default values. */
  reset(): Promise<AppSettings>

  /** Subscribes to settings updates. */
  onSettingsChange(listener: (settings: AppSettings) => void): Disposable

  /**
   * Contributes a settings descriptor to the settings page.
   * Can be used by plugins to register their settings entries dynamically.
   */
  contribute(contribution: SettingsContribution): Disposable

  /**
   * Returns all contributed settings entries.
   */
  getContributions(): readonly SettingsContribution[]
}

declare module 'cordis' {
  interface Context {
    settings: SettingsService
  }
}
