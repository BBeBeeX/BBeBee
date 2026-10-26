/**
 * System-integration services: the surfaces where the player meets the OS
 * outside its own windows — haptics, home-screen quick actions, iOS Live
 * Activities, app lifecycle, and car mode.
 *
 * Each is a seam in the same sense as `ctx.fs`: a headless feature or a view
 * package may call these without knowing whether the platform implements them,
 * and the mobile implementations live in `packages/core/*-mobile` (Layer 2)
 * while the desktop shell loads a no-op twin or none at all.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable, Uri } from '../common.js'

/* ── ctx.haptics ─────────────────────────────────────────────────────────── */

export type HapticsImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
export type HapticsNotificationType = 'success' | 'warning' | 'error'

export interface HapticsService {
  /** False when the user turned feedback off; every method is then a no-op. */
  readonly enabled: boolean
  setEnabled(on: boolean): void
  /** The collision/drag cue. `style` defaults to `'light'`. */
  impact(style?: HapticsImpactStyle): void
  /** The outcome cue for results the user cannot see (export done, import failed). */
  notification(type?: HapticsNotificationType): void
  /** The tick for selectors, pickers and other discrete value changes. */
  selection(): void
  /** The one-tap confirmation cue — favorite, mode toggle, small switches. */
  tap(): void
}

/* ── ctx.quickActions ────────────────────────────────────────────────────── */

export interface QuickActionItem {
  id: string
  title: string
  subtitle?: string
  /** SF Symbol name on iOS, drawable name on Android; plain where omitted. */
  icon?: string
  params?: Record<string, unknown>
}

export interface QuickActionsService {
  /** False where the OS has no home-screen shortcuts. */
  readonly supported: boolean
  /** Replace the whole shortcut list. Resolved when the OS has the new set. */
  set(items: readonly QuickActionItem[]): Promise<void>
  clear(): Promise<void>
  /**
   * The action that launched the app, if any — the long-press shortcut the
   * user picked while the app was cold. Consumed exactly once, so a late
   * subscriber does not replay a navigation the user has already seen.
   */
  consumeInitial(): QuickActionItem | undefined
  /** Actions picked while the app is running, including `consumeInitial`'s. */
  onAction(cb: (item: QuickActionItem) => void): Disposable
}

/* ── ctx.liveActivity ────────────────────────────────────────────────────── */

export interface LiveActivityState {
  title: string
  artist?: string
  /** Must be a local Uri; remote artwork is cached first, as with NowPlaying. */
  artworkUri?: Uri
  status: 'playing' | 'paused'
  positionMs: number
  durationMs: number
}

export interface LiveActivityService {
  /** True only where ActivityKit exists — iPhone 14 Pro and later, iOS 16.1+. */
  readonly supported: boolean
  start(state: LiveActivityState): Promise<void>
  update(state: LiveActivityState): Promise<void>
  end(): Promise<void>
}

/* ── ctx.lifecycle ───────────────────────────────────────────────────────── */

export type LifecyclePhase = 'active' | 'inactive' | 'background'

export interface LifecycleService {
  readonly phase: LifecyclePhase
  /**
   * `'cold'` for the process's first activation; `'resume'` once a backgrounded
   * process has come forward again. RN cannot see the OS's warm-start
   * distinction, so this is the useful half: everything after the first
   * activation is a resume.
   */
  readonly launchKind: 'cold' | 'resume' | 'unknown'
  /** Reveal the app under the splash screen. Idempotent. */
  hideSplash(): Promise<void>
  onPhaseChange(cb: (phase: LifecyclePhase, previous: LifecyclePhase) => void): Disposable
}

/* ── ctx.carMode ─────────────────────────────────────────────────────────── */

export type CarModeTrigger = 'manual' | 'charging' | 'bluetooth' | 'assistant'

export interface CarModeService {
  /** Master switch; when false nothing activates car mode, however triggered. */
  readonly enabled: boolean
  setEnabled(on: boolean): void
  readonly active: boolean
  /** Why car mode is currently on; undefined while inactive. */
  readonly trigger?: CarModeTrigger
  activate(trigger: CarModeTrigger): void
  deactivate(trigger: CarModeTrigger): void
  /**
   * Auto-enter when the device starts charging — the proxy for "docked in the
   * car", because RN cannot see the Android car-dock broadcast or CarPlay's
   * connection without native code.
   */
  readonly autoOnCharging: boolean
  setAutoOnCharging(on: boolean): void
}

declare module 'cordis' {
  interface Context {
    haptics: HapticsService
    quickActions: QuickActionsService
    liveActivity: LiveActivityService
    lifecycle: LifecycleService
    carMode: CarModeService
  }
}
