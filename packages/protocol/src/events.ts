/**
 * The typed event map.
 *
 * The dispatch mode is part of the contract, because it determines whether a
 * listener can block, transform, or veto:
 *
 *   emit      fire-and-forget notification
 *   parallel  all listeners awaited; one failing does not block the others
 *   serial    ordered; the first non-nullish return short-circuits
 *   waterfall middleware — listeners transform the value and control `next`
 *
 * ⚠️ **`emit` does not isolate the emitter from a throwing listener.** Cordis
 * dispatches synchronously, so a listener that throws propagates straight out
 * of `ctx.emit(...)` and into whatever was emitting — which for
 * `source/imported` is the middle of an import whose report the caller is
 * waiting for. "Fire and forget" describes the *return value*, not the
 * failure mode. Emit sites on a path that must not fail wrap the call.
 *
 * ⚠️ **`next` takes no arguments.** Cordis closes it over the original
 * argument list, so `next(somethingElse)` is silently the same as `next()`.
 * A listener therefore has exactly two moves: **mutate the argument in place**
 * (rewrite `req.headers`, splice the array) and call `next()`, or
 * **short-circuit** by returning a value and never calling `next` at all.
 * Pinned by `cordis-assumptions.test.ts`, because an upgrade that changed it
 * would otherwise be found by a plugin author debugging a header that
 * vanished.
 *
 * The waterfall hooks are the composition mechanism of the whole architecture:
 * they are how `plugin-download` substitutes a local file for a stream URL
 * without `ctx.player` knowing downloads exist. See docs/02 §5, docs/07 §5.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PlayRecord, QueueItem, TransportState } from './entities/playback.js'
import type { StreamHandle, StreamPrefs } from './entities/media.js'
import type { EffectSegment, ChainEntry } from './services/audio.js'
import type { HttpRequest, HttpResponse } from './services/http.js'
import type { AuthStatus } from './services/sources.js'
import type { CheckReport } from './services/source-document.js'
import type { SourceError } from './errors.js'
import type { ScanSpecifiedDir, ScanSummary } from './services/scanner.js'
import type { AppSettings, AudioOutputEngine, SettingsContribution } from './services/settings.js'
import type { SleepTimerState } from './services/sleep-timer.js'
import type { DesktopLyricsState, LyricsState } from './services/lyrics.js'
import type { MiniPlayerServiceState } from './services/mini-player.js'
import type { ThemeDefinition } from './services/theme.js'
import type { NowPlayingStyleId, NowPlayingStyleMeta } from './services/now-playing.js'
import type { LyricSourceDefinition } from './services/lyric-sources.js'
import type { ShareTarget } from './services/share.js'
import type { RegistryTask, RegistryUpdate } from './services/registry.js'
import type { UrnKind } from './urn.js'

declare module 'cordis' {
  interface Events {
    'settings/changed'(settings: AppSettings): void
    'settings/contributions-changed'(contributions: readonly SettingsContribution[]): void
    /* ── audio ────────────────────────────────────────── emit ── */
    'audio/engine-changed'(payload: { engine: AudioOutputEngine }): void
    'audio/context-rebuilt'(): void
    /* ── theme ───────────────────────────────────────── emit ── */
    'theme/changed'(theme: ThemeDefinition, scheme?: 'dark' | 'light'): void
    'theme/registry-changed'(themes: readonly ThemeDefinition[]): void
    /* ── lyrics ──────────────────────────────────────── emit ── */
    'lyrics/changed'(state: LyricsState): void
    'lyrics/active-changed'(activeIndex: number): void
    'desktop-lyrics/changed'(state: DesktopLyricsState): void
    /* ── share ───────────────────────────────────────── emit ── */
    'share/open'(target: ShareTarget): void
    'share/import'(): void
    /* ── player ─────────────────────────────────────── emit ── */
    'player/state-changed'(state: TransportState): void
    'player/track-changed'(trackUrn: string | undefined, previous?: string): void
    /** Throttled to 1 Hz. The UI interpolates between ticks. */
    'player/position'(positionMs: number, durationMs: number): void
    'player/error'(error: SourceError, trackUrn: string): void
    'player/history-changed'(): void

    /* ── player ─────────────────────────────────── parallel ── */
    'player/track-completed'(play: PlayRecord): void

    /* ── player ────────────────────────────────── waterfall ── */
    /**
     * Decide what actually gets played.
     *
     * `plugin-download` hooks this to substitute a local file when a binding
     * exists; `plugin-failover` hooks it to retry the same recording on
     * another source when this one is unavailable or its rules have rotted.
     */
    'player/before-resolve'(
      urn: string,
      prefs: StreamPrefs,
      next: () => Promise<StreamHandle>,
    ): Promise<StreamHandle>
    'player/before-enqueue'(urns: string[], next: () => void): void

    /* ── queue ──────────────────────────────────────── emit ── */
    'queue/changed'(items: readonly QueueItem[]): void

    /* ── sources ────────────────────────────────────── emit ── */
    'source/registered'(sourceId: string): void
    'source/unregistered'(sourceId: string): void
    'source/authenticated'(sourceId: string, status: AuthStatus): void
    'source/unreachable'(sourceId: string, error: SourceError): void

    /* ── sources: the document itself ───────────────── emit ── */
    /** One or more documents were imported. The runtime starts their fibers. */
    'source/imported'(sourceIds: string[]): void
    /** A stored document changed. The runtime rebuilds exactly that fiber. */
    'source/changed'(sourceId: string, changedFields: string[]): void
    'source/removed'(sourceId: string, forgotCatalogue: boolean): void
    /**
     * A rule produced nothing where something was required.
     *
     * Coalesced per source: one rotted source can fail a rule per track in a
     * queue, and the stale badge needs the fact, not the volume.
     */
    'source/rule-failed'(sourceId: string, rule: { block: string; field: string }): void
    'source/checked'(sourceId: string, report: CheckReport): void

    /* ── sources ──────────────────────────────────── serial ── */
    /** The session refresher gets first refusal before the UI prompts. */
    'source/auth-expired'(sourceId: string): void

    /* ── sources ────────────────────────────────── parallel ── */
    /** Listeners purge session-derived state; sign-out awaits them all. */
    'source/signed-out'(sourceId: string): void

    /* ── http ──────────────────────────────────── waterfall ── */
    /** Auth injection, retry, rate limiting, and caching all hook here. */
    'http/request'(req: HttpRequest, next: () => Promise<HttpResponse>): Promise<HttpResponse>

    /* ── downloads ──────────────────────────────────── emit ── */
    'download/queued'(taskId: string): void
    'download/progress'(taskId: string, done: number, total?: number): void
    'download/completed'(taskId: string, bindingId: string): void
    'download/failed'(taskId: string, error: Error): void
    /**
     * The task list changed in a way the four above do not describe.
     *
     * Pause, resume, cancel, retry, remove and clear are all state transitions,
     * and a screen subscribed only to progress/completed would keep rendering
     * the old row. Screens re-read `ctx.downloads.tasks` on this.
     */
    'download/changed'(): void

    /* ── library & scanning ─────────────────────────── emit ── */
    'library/changed'(kind: UrnKind, urns: string[]): void
    /**
     * A collection was created, renamed, deleted or re-membered.
     *
     * Separate from `library/changed` because a collection has no URN and no
     * `UrnKind`, and folding it in would mean emitting a kind that names
     * something else. Collections are folders; the name change is the whole
     * event.
     */
    'library/collections-changed'(): void
    /**
     * The local user's profile changed (currently: the name, editable in
     * Settings). Screens showing the user as a creator re-read
     * `ctx.library.getProfile()` on this.
     */
    'library/profile-changed'(): void
    'scan/specified-dirs-changed'(dirs: readonly ScanSpecifiedDir[]): void
    'scan/started'(specifiedDirId: string): void
    'scan/progress'(specifiedDirId: string, done: number, total?: number): void
    /**
     * A walk finished, or stopped early.
     *
     * The payload is the whole `ScanSummary`, `incomplete` included: a
     * listener that cannot tell a complete scan from a truncated one will
     * report "0 removed" as though the library were reconciled.
     */
    'scan/finished'(specifiedDirId: string, summary: ScanSummary): void

    /* ── dsp ───────────────────────────────────── waterfall ── */
    'dsp/build-chain'(segments: EffectSegment[], next: () => EffectSegment[]): EffectSegment[]
    /* ── dsp ────────────────────────────────────────── emit ── */
    'dsp/chain-changed'(chain: readonly ChainEntry[]): void
    /** The enabled chain serialized for the native engine's `af` (mpv), plus optional native replaygain config. */
    'dsp/af-changed'(payload: {
      af: string
      replaygain?: string
      replaygainClip?: boolean
      replaygainPreamp?: string
      replaygainFallback?: string
    }): void

    /* ── ui ─────────────────────────────────────────── emit ── */
    'ui/changed'(): void
    'ui/navigate'(routeId: string, params?: Record<string, unknown>): void

    /* ── plugins ────────────────────────────────────── emit ── */
    'plugin/loaded'(id: string): void
    'plugin/failed'(id: string, error: Error): void
    'plugin/unloaded'(id: string): void

    /* ── sleep timer ─────────────────────────────────── emit ── */
    'sleep-timer/changed'(state: SleepTimerState): void
    'sleep-timer/fired'(): void

    /* ── mini player ─────────────────────────────────── emit ── */
    'mini-player/changed'(state: MiniPlayerServiceState): void

    /* ── now-playing ─────────────────────────────────── emit ── */
    'now-playing/style-changed'(styleId: NowPlayingStyleId): void
    'now-playing/registry-changed'(styles: readonly NowPlayingStyleMeta[]): void

    /* ── lyric-sources ───────────────────────────────── emit ── */
    'lyric-sources/changed'(sources: readonly LyricSourceDefinition[]): void

    /* ── plugin-manager ──────────────────────────────── emit ── */
    'plugin-manager/enabled-changed'(payload: { id: string; enabled: boolean }): void
    'plugin-manager/changed'(): void

    /* ── registry ───────────────────────────────────── emit ── */
    /**
     * Fired after EVERY completed update check, with the full current list —
     * possibly empty, so a listener rendering a badge can clear it rather
     * than go stale. See `RegistryService.checkUpdates`.
     */
    'registry/updates-available'(updates: readonly RegistryUpdate[]): void
    /**
     * Fired after every task-center mutation — a task created, a stage
     * advanced, a task finished or the finished records cleared — with the
     * full current task list, newest first. Listeners re-render from the
     * payload rather than accumulating deltas. See `RegistryService.getTasks`.
     */
    'registry/tasks-changed'(tasks: readonly RegistryTask[]): void
  }
}

/** Documented dispatch mode per event, asserted by the kernel's tests. */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'

export const DISPATCH_MODES = {
  'player/state-changed': 'emit',
  'player/track-changed': 'emit',
  'player/position': 'emit',
  'player/error': 'emit',
  'player/history-changed': 'emit',
  'player/track-completed': 'parallel',
  'player/before-resolve': 'waterfall',
  'player/before-enqueue': 'waterfall',
  'queue/changed': 'emit',
  'source/registered': 'emit',
  'source/unregistered': 'emit',
  'source/authenticated': 'emit',
  'source/unreachable': 'emit',
  'source/imported': 'emit',
  'source/changed': 'emit',
  'source/removed': 'emit',
  'source/rule-failed': 'emit',
  'source/checked': 'emit',
  'source/auth-expired': 'serial',
  'source/signed-out': 'parallel',
  'http/request': 'waterfall',
  'download/queued': 'emit',
  'download/progress': 'emit',
  'download/completed': 'emit',
  'download/failed': 'emit',
  'download/changed': 'emit',
  'library/changed': 'emit',
  'library/collections-changed': 'emit',
  'library/profile-changed': 'emit',
  'scan/specified-dirs-changed': 'emit',
  'scan/started': 'emit',
  'scan/progress': 'emit',
  'scan/finished': 'emit',
  'dsp/build-chain': 'waterfall',
  'dsp/chain-changed': 'emit',
  'dsp/af-changed': 'emit',
  'ui/changed': 'emit',
  'ui/navigate': 'emit',
  'plugin/loaded': 'emit',
  'plugin/failed': 'emit',
  'plugin/unloaded': 'emit',
  'sleep-timer/changed': 'emit',
  'sleep-timer/fired': 'emit',
  'settings/changed': 'emit',
  'settings/contributions-changed': 'emit',
  'theme/changed': 'emit',
  'theme/registry-changed': 'emit',
  'mini-player/changed': 'emit',
  'now-playing/style-changed': 'emit',
  'now-playing/registry-changed': 'emit',
  'lyric-sources/changed': 'emit',
  'share/open': 'emit',
  'share/import': 'emit',
  'plugin-manager/enabled-changed': 'emit',
  'plugin-manager/changed': 'emit',
  'registry/updates-available': 'emit',
  'registry/tasks-changed': 'emit',
} as const satisfies Record<string, DispatchMode>

export type BBeBeeEventName = keyof typeof DISPATCH_MODES
