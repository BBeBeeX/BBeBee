# Waterfall Hooks & Typed Event Map

> **Legacy Reference:** Formerly `docs/07-data-model.md §5`.

## 5. The event map

Declared once in `@BBeBee/protocol` by augmenting Cordis's `Events` interface. The dispatch mode is
part of the contract: it determines whether a listener can block, transform, or veto.

```ts
declare module 'cordis' {
  interface Events {
    /* ── settings ────────────────────────────────────── emit ── */
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
     * `plugin-download` hooks this to substitute a local file when a binding
     * exists; `plugin-failover` hooks it to retry on another source.
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

    /* ── sources: document lifecycle ────────────────── emit ── */
    'source/imported'(sourceIds: string[]): void
    'source/changed'(sourceId: string, changedFields: string[]): void
    'source/removed'(sourceId: string, forgotCatalogue: boolean): void
    /** A rule produced nothing where something was required. Drives the stale badge. */
    'source/rule-failed'(sourceId: string, rule: { block: string; field: string }): void
    'source/checked'(sourceId: string, report: CheckReport): void

    /* ── sources ──────────────────────────────────── serial ── */
    /** The session refresher gets first refusal before the UI prompts. */
    'source/auth-expired'(sourceId: string): void

    /* ── sources ────────────────────────────────── parallel ── */
    /** Listeners purge session-derived state; sign-out awaits them all. */
    'source/signed-out'(sourceId: string): void

    /* ── http ──────────────────────────────────── waterfall ── */
    /** Auth injection, retry, rate limiting, and caching hook here. */
    'http/request'(req: HttpRequest, next: () => Promise<HttpResponse>): Promise<HttpResponse>

    /* ── downloads ──────────────────────────────────── emit ── */
    'download/queued'(taskId: string): void
    'download/progress'(taskId: string, done: number, total?: number): void
    'download/completed'(taskId: string, bindingId: string): void
    'download/failed'(taskId: string, error: Error): void
    /** The task list changed (pause, resume, cancel, retry, clear). */
    'download/changed'(): void

    /* ── library & scanning ─────────────────────────── emit ── */
    'library/changed'(kind: UrnKind, urns: string[]): void
    'library/collections-changed'(): void
    'library/profile-changed'(): void
    'scan/specified-dirs-changed'(dirs: readonly ScanSpecifiedDir[]): void
    'scan/started'(specifiedDirId: string): void
    'scan/progress'(specifiedDirId: string, done: number, total?: number): void
    'scan/finished'(specifiedDirId: string, summary: ScanSummary): void

    /* ── dsp ───────────────────────────────────── waterfall ── */
    'dsp/build-chain'(segments: EffectSegment[], next: () => EffectSegment[]): EffectSegment[]

    /* ── dsp ────────────────────────────────────────── emit ── */
    'dsp/chain-changed'(chain: readonly ChainEntry[]): void
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
  }
}
```

> ⚠️ A waterfall listener's `next` is closed over the original arguments and **ignores anything
> passed to it**. Rewrite by mutating the argument in place, or short-circuit by returning without
> calling `next`. The signatures above are strictly written `next: () => …` for that reason.

| Event group | Mode | Why |
|---|---|---|
| `player/before-resolve`, `player/before-enqueue`, `http/request`, `dsp/build-chain` | **waterfall** | Listeners transform the value and control whether the chain continues. The composition mechanism of [layers.md §5](../architecture/layers.md#5-composition-how-features-reach-each-other) |
| `*/changed`, `*/progress`, `player/*`, `plugin/*`, `now-playing/*`, `theme/*`, `lyrics/*`, `settings/*`, `ui/*`, `sleep-timer/*`, `mini-player/*`, `share/*`, `plugin-manager/*` | **emit** | Fire-and-forget notification. Listener errors do not affect the emitter |
| `player/track-completed` | **parallel** | Scrobblers, stats, and history all run; all are awaited; one failing does not block the others |
| `source/auth-expired` | **serial** | Ordered handling — the session refresher gets first refusal before the UI prompts |
| `source/signed-out` | **parallel** | Every listener purging session-derived state is awaited, so sign-out completes only once the cleanup has actually finished |
| `source/imported`, `source/changed`, `source/removed` | **emit** | Notification. The runtime rebuilds the affected fibers; views re-render |
| `source/rule-failed` | **emit**, coalesced per source | One rotted source can fail a rule per track in a queue; the badge needs the fact, not the volume |
| `player/position` | **emit**, throttled to 1 Hz | At 60 Hz it would dominate the event bus for no benefit; the UI interpolates between ticks |

---

