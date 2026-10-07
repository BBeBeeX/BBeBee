/**
 * `ctx.settings` — global application preferences and configuration service.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'
import type { DesktopLyricsPosition } from './lyrics.js'
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

export type AudioOutputEngine = 'webaudio' | 'mpv' | 'wasapi'

export type LoudnessNormalizationMode = 'track' | 'album' | 'dynamic'

export interface AppSettings {
  /** Visual appearance theme mode. */
  theme: 'dark' | 'light' | 'system'
  /** Color theme identifier (e.g. 'midnight-purple', 'spotify'). */
  themeId?: string
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
  /** Custom media cache directory path. */
  cacheDir?: string
  /** Audio output engine: 'wasapi' (WASAPI desktop audio with FFmpeg decoding) or 'webaudio' (WebAudio). */
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
  /** Desktop floating lyrics display settings. */
  desktopLyrics: DesktopLyricsSettings
  /** Global desktop keyboard shortcuts configuration. */
  shortcuts: GlobalShortcutsSettings
  /** Network proxy routing configuration. */
  proxy: ProxySettings
  /** Audio visualizer configuration. */
  visualizer: VisualizerSettings
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

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  themeId: 'midnight-purple',
  nowPlayingStyle: 'classic',
  language: 'zh',
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
  cacheDir: '',
  audioOutputEngine: 'wasapi',
  audioExclusive: false,
  audioOutputDeviceId: 'default',
  userAgent: '',
  thirdPartySourcesEnabled: true,
  thirdPartyLyricSourcesEnabled: true,
  registryAutoCheck: true,
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
