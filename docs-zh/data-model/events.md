# 瀑布流钩子与强类型事件映射表

> **历史章节映射：** 原 `docs-zh/07-data-model.md §5`。

## 5. 事件表

在 `@BBeBee/protocol` 中通过扩充 Cordis 的 `Events` 接口一次性声明。派发模式是契约的一部分：它决定了监听器能否阻塞、变换或否决这次派发。

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
    /** 节流至 1 Hz。UI 在两次节拍之间自行插值。 */
    'player/position'(positionMs: number, durationMs: number): void
    'player/error'(error: SourceError, trackUrn: string): void
    'player/history-changed'(): void

    /* ── player ─────────────────────────────────── parallel ── */
    'player/track-completed'(play: PlayRecord): void

    /* ── player ────────────────────────────────── waterfall ── */
    /**
     * 决定实际播放哪个流。
     * `plugin-download` 拦截此钩子在存在本地绑定时代换为本地文件；
     * `plugin-failover` 拦截此钩子在当前音源失效时重试其他音源。
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

    /* ── sources: 文档生命周期 ──────────────────────── emit ── */
    'source/imported'(sourceIds: string[]): void
    'source/changed'(sourceId: string, changedFields: string[]): void
    'source/removed'(sourceId: string, forgotCatalogue: boolean): void
    /** 规则在必填处未返回任何内容。驱动陈旧徽标显示。 */
    'source/rule-failed'(sourceId: string, rule: { block: string; field: string }): void
    'source/checked'(sourceId: string, report: CheckReport): void

    /* ── sources ──────────────────────────────────── serial ── */
    /** 会话刷新器拥有第一处理权，之后才轮到 UI 出面提示。 */
    'source/auth-expired'(sourceId: string): void

    /* ── sources ────────────────────────────────── parallel ── */
    /** 监听器清除会话派生状态；登出等待所有监听器执行完成。 */
    'source/signed-out'(sourceId: string): void

    /* ── http ──────────────────────────────────── waterfall ── */
    /** 认证凭据注入、重试、限流与缓存拦截点。 */
    'http/request'(req: HttpRequest, next: () => Promise<HttpResponse>): Promise<HttpResponse>

    /* ── downloads ──────────────────────────────────── emit ── */
    'download/queued'(taskId: string): void
    'download/progress'(taskId: string, done: number, total?: number): void
    'download/completed'(taskId: string, bindingId: string): void
    'download/failed'(taskId: string, error: Error): void
    /** 任务列表发生状态变更（暂停、恢复、取消、重试、清空）。 */
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

> ⚠️ 瀑布式监听器收到的 `next` 闭包捕获的是最初传入的参数，并且**忽略任何传给它的东西**。要改写值，就原地修改参数；要短路，就不调用 `next` 直接返回。上面的签名正是因此才严格写成 `next: () => …`。

| 事件组 | 模式 | 理由 |
|---|---|---|
| `player/before-resolve`、`player/before-enqueue`、`http/request`、`dsp/build-chain` | **waterfall** | 监听器变换传入的值，并决定链条是否继续。这正是 [layers.md §5](../architecture/layers.md#5-组合功能之间如何触达彼此) 所述的组合机制 |
| `*/changed`、`*/progress`、`player/*`、`plugin/*`、`now-playing/*`、`theme/*`、`lyrics/*`、`settings/*`、`ui/*`、`sleep-timer/*`、`mini-player/*`、`share/*`、`plugin-manager/*` | **emit** | 即发即弃通知。监听器抛出的错误不得影响发出方 |
| `player/track-completed` | **parallel** | scrobble、统计与历史记录全部执行；全部被 await；其中一个失败不阻塞其余 |
| `source/auth-expired` | **serial** | 按序处理 —— 会话刷新器拥有第一处理权，之后才轮到 UI 出面提示 |
| `source/signed-out` | **parallel** | 每个清除会话派生状态的监听器都被 await，因此登出只有在清理真正完成之后才算结束 |
| `source/imported`、`source/changed`、`source/removed` | **emit** | 通知。运行时重建受影响的 fiber；视图随之重渲染 |
| `source/rule-failed` | **emit**，按音源合并 | 一个腐烂的音源能让一个队列里的每首曲目都各失败一次规则；徽标需要的是事实本身，而不是它的量 |
| `player/position` | **emit**，节流到 1 Hz | 若按 60 Hz 派发，它会毫无收益地霸占事件总线；UI 在两次节拍之间自行插值 |

---

