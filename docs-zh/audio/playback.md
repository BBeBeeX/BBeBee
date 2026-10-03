# 播放控制状态机与队列管理

> **历史章节映射：** 原 `docs-zh/05-audio-playback.md §2，§4 – §8`。

## 2. `ctx.player` —— 播放控制与队列

```ts
export type PlayMode = 'shuffle' | 'sequence' | 'single-loop' | 'list-loop'
export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueItem {
  id: string
  trackUrn: string
  /** Where this came from — an album, a playlist, radio. Drives "playing from". */
  sourceContext?: { kind: 'album' | 'playlist' | 'artist' | 'search' | 'radio'; urn?: string; label?: string }
  addedBy: 'user' | 'autoplay' | 'radio'
}

export interface TransportState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stalled' | 'error'
  currentItemId?: string
  trackUrn?: string
  positionMs: number
  durationMs: number
  bufferedMs: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  playMode: PlayMode
  error?: { code: string; message: string; retryable: boolean }
}

export interface PlayerService {
  readonly state: Readonly<TransportState>
  readonly currentStream?: Readonly<StreamHandle>

  play(): Promise<void>
  pause(): void
  togglePlay(): void
  stop(): void
  seek(positionMs: number): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>       // restarts current if past the threshold — see below

  setVolume(v: number): void
  setMuted(m: boolean): void
  setRepeat(m: RepeatMode): void
  setShuffle(on: boolean): void
  setPlayMode(mode: PlayMode): void
  cyclePlayMode(): PlayMode

  // Queue
  readonly queue: readonly QueueItem[]
  playNow(urns: string[], opts?: { startIndex?: number; context?: QueueItem['sourceContext'] }): Promise<void>
  enqueueNext(urns: string[]): void
  enqueueLast(urns: string[]): void
  removeItems(ids: string[]): void
  moveItem(id: string, toIndex: number): void
  clearQueue(): void
}
```

### 播放控制状态机

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> loading: play() with a queue
    loading --> playing: source ready
    loading --> error: resolve or load failed
    playing --> paused: pause() / interruption began
    paused --> playing: play() / interruption ended and shouldResume
    playing --> stalled: buffer underrun / 播放中途的致命元素错误
    stalled --> playing: buffer recovered
    stalled --> error: timeout exceeded
    playing --> loading: track ended and queue advances
    playing --> idle: track ended and queue exhausted
    error --> loading: retry (manual or automatic)
    error --> loading: failover to a linked URN
```

有几处行为值得钉死，因为播放器"手感不对"往往就出在这里：

- **`previous()`** 在 position > 3000 ms 时重启当前曲目，否则切回上一首。阈值可配置，默认值与所有其他播放器给用户养成的习惯一致。
- **随机播放（shuffle）** 持久化的是**一个种子加上一个排列**，而不是每次现选的随机结果。这让乱序在重启后保持稳定，让 `previous()` 仍有意义，也让即将播放的队列能够如实展示。
- **单曲循环**不重新解析流，而是复用已加载的缓冲。
- **`stalled`** 与 `paused` 是两回事。UI 显示的是转圈，而不是播放按钮，并且 `ctx.mediaSession` 继续上报 `playing`，以免锁屏界面闪烁。
- **开始播放之后才发生的致命错误按 underrun 上报，而不是按自然结束。** 流式句柄的媒体元素在曲目播放中途死亡（CDN 断流、URL 过期）时上报 `onStalled(true)` 而非 `onEnded`：当作自然结束会让播放器把该曲记为"已完整播放"并直接切下一曲——下一曲面对同样坏掉的网络，只能无声地停在 0:00。按 stall 上报则走 `stalled → error` 看门狗，在冻结的原位置变成可重试的网络错误（按播放键即重试）。曲子从未出声就报错的死链仍然上报 `ended`，队列照旧跳过从不发声的链接。

### 播放模式 (`PlayMode`)

播放器将队列遍历与循环控制统一收敛为 4 种明确的播放模式：

| 模式 | 键值 | `shuffle` | `repeat` | 队列行为说明 |
|---|---|---|---|---|
| **顺序播放** | `'sequence'` | `false` | `'off'` | 按队列顺序逐曲播放，播至队尾停止播放。 |
| **单曲循环** | `'single-loop'` | `false` | `'one'` | 单曲循环重放，复用已加载音频缓冲，不重新解析媒体流。 |
| **列表循环** | `'list-loop'` | `false` | `'all'` | 按队列顺序逐曲播放，队尾自动循环回到第一首。 |
| **随机播放** | `'shuffle'` | `true` | `'all'` | 基于伪随机种子排列乱序播放并无限循环。 |

- **模式循环**：`cyclePlayMode()` 按业界标准次序切换：`顺序播放 (sequence)` $\to$ `单曲循环 (single-loop)` $\to$ `列表循环 (list-loop)` $\to$ `随机播放 (shuffle)` $\to$ `顺序播放`。
- **双向兼容**：调用旧版 `setRepeat()` 或 `setShuffle()` 会通过 `derivePlayMode()` 自动联动更新 `state.playMode`；反之调用 `setPlayMode()` 会同步配置底层队列的 `repeat` 与 `shuffle` 状态。

### 解析流水线

从"队列前进了一格"到"声音出来了"之间发生的事。这是插件架构回报最直观的一段时序。

```mermaid
sequenceDiagram
    participant Q as ctx.player
    participant W as waterfall player/before-resolve
    participant DL as plugin-download
    participant SRC as ctx.sources
    participant A as ctx.audio

    Q->>W: resolve(trackUrn, prefs)
    W->>DL: next()
    alt a media_binding exists for this URN
        DL-->>Q: { kind: 'local', uri, format }
        Note over DL: The player never learns downloads exist.
    else no local copy
        DL->>SRC: next()
        SRC->>SRC: source.resolveStream(ref, prefs)
        SRC-->>Q: StreamHandle { url, headers, expiresAt }
    end
    Q->>A: load(target, { strategy })
    A-->>Q: AudioSourceHandle
    Q->>A: handle.node.connect(chainInput)
    Q->>A: handle.play()
```

失败时，流水线会被重新进入而不是立刻把错误抛给用户：`UnavailableError`——或来自某个规则已腐化的源的 `RuleError`（[06 §7](../sources/authoring.md#7-错误)）——会先触发一次 `track_links`（[07 §4.4](../data-model/urn.md#44-身份关联)）查询，寻找同一录音在其他源上的条目；只有这一步也一无所获，播放器才进入 `error`。

### 无缝（gapless）与交叉淡入淡出

- **无缝（gapless）** 使用 `AudioBufferQueueSourceNode`：在当前曲目最后约 15 秒内解码下一首并排入同一个 source 节点，因此交接是采样级精确的，没有 `AudioContext` 调度间隙。它要求 `strategy: 'buffer'`，因此只对本地文件与中短流启用，长流则跳过。
- **交叉淡入淡出（crossfade）** 是另一条路径：两个 source 节点，两段 `crossfadeMs` 的增益斜坡，等功率曲线。它与无缝模式互斥——两者同时开启会产生可听见的双重淡变——因此该设置是三选一：`gapless | crossfade | neither`。
- **预取**在距结尾 `max(15s, crossfadeMs + 5s)` 时开始，若队列发生变化则通过 `AbortSignal` 取消。
- **引擎自管预载时不再做第二次加载**：实现 `preloadNext` 的引擎（mpv 的 append）自己负责播放列表边界，播放器只移交 src——单解码核引擎上对下一首的第二次 `load` 等于 `loadfile replace`，会在曲目结束前杀掉仍在发声的这首歌，并把引擎暂停在无人启动的下一首上（表现为"提前跳曲后永久卡住"）。append 失败只是该次交接退化为普通换曲，下一首轮到时正常加载。
- **引擎 paused 是停滞而非静音**：mpv 源句柄轮询引擎状态，若引擎在传输层自称 `playing` 期间报告 `paused`，即被旁路暂停。宽限期（默认 2 秒，`pausedStallMs`）之后按冻结位置上报 stall（从未发声则上报 ended 以便跳过），而不是对静音的引擎无限轮询下去；引擎恢复发声则上报恢复。

### 持久化

`playback_state` 在播放期间以 5 秒节流写入，并在暂停、曲目切换与 `ctx.background.onWillSuspend` 时立即写入。启动时播放器会恢复队列与进度，但**不会自动播放**——一启动就出声是吓人的，尤其当那部手机刚在口袋里被点亮的时候。

### 响度标准化与 ReplayGain

为消除来自不同来源的歌曲和专辑之间听感响度忽大忽小的落差，BBeBee 提供了符合 ReplayGain 2.0 与 EBU R128 标准（-14 LUFS 流媒体基准）的响度标准化能力：
- **全局偏好设置配置 (`AppSettings`)**：
  - `loudnessNormalizationEnabled: boolean`：总开关。
  - `loudnessNormalizationMode: 'track' | 'album' | 'dynamic'`：单曲均衡（每首曲目匹配目标响度）、专辑均衡（保持整张专辑内动态对比）、或动态 EBU R128（实时 `loudnorm` 测量）。
  - `loudnessTargetLufs: number`：目标响度参考值（默认 -14 LUFS 流媒体标准、-18 LUFS 古典安静、-11 LUFS 高响度）。
  - `loudnessPreampDb: number`：前级校准微调。
- **切歌自动同步**：
  在 `player/track-changed` 事件触发时，`plugin-dsp` 读取当前音轨的元数据（`replayGainTrack` 或 `replayGainAlbum`）。在 Web Audio 模式下计算目标增益偏差并通过 `setTargetAtTime` 在 20 ms 内平滑拉平，消除任何咔哒爆音；在 MPV 模式下直接通过原生 ReplayGain 属性传递并启用防削波保护（`replaygain-clip`），同时避免向 libavfilter 注入重复的 `volume` 滤镜造成二次缩放。
- **接口化贡献呈现**：
  该功能通过 `ctx.ui.contribute({ kind: 'settings', id: 'settings.loudness-normalization', ... })` 动态注册于设置的播放分类中，由 `LoudnessNormalizationCard` 渲染，绝不硬编码。

---

## 4. 媒体会话集成

`ctx.player` 在每次曲目变化与状态变化时发布到 `ctx.mediaSession`，position 则节流为每秒一次。命令经由 `onCommand` 反向流入。

在移动端，封面图必须是本地 `Uri`，因此封面缓存在 `update()` 被调用前完成解析与下载；曲目切换时先立即发布不带封面的元数据，图片就绪后再更新一次，而不是拖住整个更新。

---

## 5. 打断、焦点与路由

这件事只在 `ctx.player` 中处理一次，依据的是 `ctx.audio` 的事件。每个平台的规则各不相同，但*策略*是统一的。

| 事件 | 策略 |
|---|---|
| 来电 / 闹钟开始 | 暂停。记住之前正在播放 |
| 打断结束且 `shouldResume` | 仅当确因该原因暂停、且此后用户未干预时才恢复 |
| 其他应用抢占音频焦点（Android） | 暂停。不要 duck——音乐播放器被 duck 是不对的 |
| 瞬时 duck 请求（导航播报） | 200 ms 内把主音量降到 20%，之后恢复 |
| 拔出耳机 / 蓝牙断开 | **立即暂停。**绝不在扬声器上继续 |
| 新输出设备接入 | 在当前设备上继续；没有用户操作不做迁移 |
| 输出设备在播放中消失 | 暂停，给出提示，提供切换选项 |

"拔耳机即暂停"这条规则重要到被设为不可配置。它是用户唯一一次都不会原谅的音频行为。

---

## 6. 播放与后台

交叉参考 [02 §4](../architecture/layers.md#4-后台意味着什么)。具体来说：

- **iOS** —— `UIBackgroundModes: ['audio']`，audio session 类别为 `playback`。播放可以无限持续；*非音频*的工作则不行。
- **Android** —— 一个带媒体通知的前台服务，播放开始时启动，播放结束时停止。没有它，进程会在几分钟内被杀掉。
- **桌面** —— 渲染进程必须保持存活，因此在音频播放时关闭窗口会隐藏到托盘。`powerSaveBlocker` 用于防止在某些 Windows 配置上屏幕休眠连带挂起音频线程。

---

## 7. 测试音频

音频很难测，所以策略是分层展开而非端到端：

1. **效果确定性** —— 每个效果的 `EffectDefinition.build` 都在 `OfflineAudioContext` 中对一份已知输入缓冲运行；输出与存储的参考值在容差内比对。这能抓住滤波系数的意外改动——否则这些改动要等到有人听出 EQ 不对劲才会被发现。
2. **播放控制状态机** —— 针对 mock 的 `AudioService` 做纯单元测试。§2 图中的每一条转移都有测试，包括加载中途被打断、预取中途队列变化。
3. **解析流水线** —— 对 `player/before-resolve` 瀑布（waterfall）钩子分别在加载与未加载 `plugin-download` 的情况下测试，断言除所选目标不同外播放器行为完全一致。
4. **真机冒烟测试** —— 每个发布版本执行一次手工矩阵：锁屏、蓝牙、拔耳机、来电、无缝边界、后台存活。以合理的成本无法自动化，文档对此直言不讳。

---

## 8. 下一步去哪里

[06 —— 音源](../sources/spec.md) 定义 URN 与流句柄从何而来。
