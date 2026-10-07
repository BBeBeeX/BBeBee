/**
 * Now-playing presentation types.
 *
 * These are **layout** concerns — the spatial arrangement of the full-screen
 * player — and are orthogonal to the colour theme (`ctx.theme`).  The four
 * built-in styles share the same transport controls, the same hooks, and the
 * same data; what differs is where the artwork, metadata, and scrubber are
 * placed on screen.
 */

/**
 * The four built-in layout identifiers for the full-screen player.
 *
 *  - `classic`     Current default: centred artwork, info below, controls at bottom.
 *  - `full-cover`  Blurred artwork background, translucent controls overlay.
 *  - `vinyl`       Circular artwork spinning like a record, controls below.
 *  - `compact`     Side-by-side: large cover left, info + controls right.
 */
// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'

/**
 * The built-in layout identifiers for the full-screen player.
 *
 *  - `classic`     Current default: centred artwork, info below, controls at bottom.
 *  - `cinematic`   16:9 cinematic anime/MV aesthetic with dynamic waveform and synchronized lyrics.
 *  - `full-cover`  Blurred artwork background, translucent controls overlay.
 *  - `vinyl`       Circular artwork spinning like a record, controls below.
 *  - `compact`     Side-by-side: large cover left, info + controls right.
 */
export type BuiltinNowPlayingStyleId = 'classic' | 'full-cover' | 'vinyl' | 'compact' | 'cinematic'
export type NowPlayingStyleId = BuiltinNowPlayingStyleId | (string & {})

export type NowPlayingStyleType = 'builtin' | 'sandboxed'

export interface NowPlayingStyleMeta {
  id: NowPlayingStyleId
  /** Human-readable display name. */
  name: string
  /** Short description shown in the style picker. */
  description: string
  /** Tabler icon name for the picker UI. */
  icon: string
  /** Whether the style is built into the app or dynamically installed. */
  type?: NowPlayingStyleType
  /** Optional author or developer name. */
  author?: string
  /** Optional version string (e.g. '1.0.0'). */
  version?: string
  /** Raw HTML/CSS/JS source string for sandboxed iframe execution. */
  htmlContent?: string
  /** Optional external entry URL (e.g. data URI or bbebee-plugin:// URL). */
  entryUrl?: string
  /** Optional configuration dictionary. */
  config?: Record<string, unknown>
}

// ⚠️ Icon names must exist in the desktop icon registry
// (`ui-kit-desktop/src/icons`): an unknown name falls through `tablerIcon`
// and renders as clipped raw text instead of an icon.
export const NOW_PLAYING_STYLES: readonly NowPlayingStyleMeta[] = [
  { id: 'classic', name: '经典', description: '居中封面，经典布局', icon: 'music', type: 'builtin' },
  { id: 'full-cover', name: '沉浸封面', description: '全屏模糊封面背景', icon: 'photo', type: 'builtin' },
  { id: 'vinyl', name: '黑胶唱片', description: '旋转黑胶唱片风格', icon: 'disc', type: 'builtin' },
  { id: 'compact', name: '左右分栏', description: '封面与信息并排显示', icon: 'layout-sidebar', type: 'builtin' },
  { id: 'cinematic', name: '映画歌词', description: '16:9 映画质感与动态声波', icon: 'wave-sine', type: 'builtin' },
] as const

export const DEFAULT_NOW_PLAYING_STYLE: NowPlayingStyleId = 'classic'

/** Synchronized lyric line snapshot for sandboxed player bridge. */
export interface SandboxPlayerLyricLine {
  /** Timestamp in milliseconds from the start of track, or undefined if unsynced. */
  timeMs?: number
  /** The text content of this lyric line. */
  text: string
  /** Optional translated text (e.g. for bilingual display). */
  translation?: string
}

/** Read-only snapshot of current playback data passed to the sandbox. */
export interface SandboxPlayerSnapshot {
  /** Resolved safe artwork image URL, or null if no artwork is available. */
  cover: string | null
  /**
   * Vibrant dominant cover theme color (Hex string, e.g. '#3A5F7D' or null).
   * Provided by host image analysis, so sandboxes do not need canvas pixel access.
   */
  coverThemeColor: string | null
  /** Track title. */
  title: string
  /** Track artist name. */
  artist: string
  /** Album name, if available. */
  album?: string
  /** Synchronized lyrics and current active line index. */
  lyrics: {
    lines: SandboxPlayerLyricLine[]
    activeIndex: number
  }
  /** Current playback position in milliseconds. */
  positionMs: number
  /** Total track duration in milliseconds. */
  durationMs: number
  /** Whether playback is currently active. */
  isPlaying: boolean
  /** Whether the current track is saved in user's favorites/loved library. */
  isLoved: boolean
}

/** Strictly whitelisted actions that a sandboxed player plugin may dispatch. */
export type SandboxPlayerAction =
  | { type: 'action:play' }
  | { type: 'action:pause' }
  | { type: 'action:togglePlay' }
  | { type: 'action:previous' }
  | { type: 'action:next' }
  | { type: 'action:seek'; positionMs: number }
  | { type: 'action:toggleFavorite' }

export interface NowPlayingService {
  /** Returns the currently active full-screen player style id. */
  getStyle(): NowPlayingStyleId
  /** Changes the full-screen player style and persists the preference. */
  setStyle(id: NowPlayingStyleId): void
  /** Returns all available styles, including built-in and sandboxed plugins. */
  getStyles(): readonly NowPlayingStyleMeta[]
  /** Registers a new dynamic or sandboxed player style. */
  registerStyle(meta: NowPlayingStyleMeta): Disposable
  /** Removes a dynamically registered style by id. Returns true if removed. */
  removeStyle(id: string): boolean
}

declare module 'cordis' {
  interface Context {
    nowPlaying: NowPlayingService
  }
}
