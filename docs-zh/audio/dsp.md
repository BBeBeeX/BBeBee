# DSP 效果链与音频处理

> **历史章节映射：** 原 `docs-zh/05-audio-playback.md §3`。

## 3. `ctx.dsp` —— 效果链

每一个效果都是一个插件。这个服务本身只是一个注册表加上一个链构建器。

```ts
export type EffectParamValue = number | string | boolean | number[]

export interface EffectSegment {
  /** 音频进入与离开该效果的节点。可以是同一个节点。 */
  input: AudioNode
  output: AudioNode
  /** 持久化参数变更时调用。必须为零内存分配。 */
  setParam(name: string, value: EffectParamValue): void
  /** 计入上报的效果链延迟，用于音画同步与可视化对齐。 */
  latencyMs?: number
  dispose(): void
}

/**
 * 极简 Schema 结构，与 Standard Schema 保持结构兼容。
 * 本地声明而非导入 @standard-schema/spec，使 @BBeBee/protocol 保持零运行时依赖。
 */
export interface ParamSchema<Out = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => { value: Out } | { issues: readonly { message: string }[] } | PromiseLike<unknown>
  }
}

export interface EffectDefinition<P = Record<string, unknown>> {
  id: string                      // 'eq10', 'reverb', 'normalize'
  displayName: string
  /** 默认序号。越小执行越早。用户可覆盖。 */
  defaultOrder: number
  Params: ParamSchema<P>
  presets?: { name: string; params: P; builtin?: boolean }[]
  build(ctx: BaseAudioContext, params: P): EffectSegment
  /**
   * 原生引擎适配器（mpv）：将该效果参数序列化为引擎 af 滤镜链片段。
   */
  buildLavfi?(params: Record<string, unknown>): string
}

export interface DspService {
  register(def: EffectDefinition<never>): Disposable
  readonly definitions: readonly EffectDefinition<never>[]

  readonly chain: readonly { effectId: string; enabled: boolean; ordinal: number }[]
  setEnabled(effectId: string, on: boolean): Promise<void>
  setOrder(effectId: string, ordinal: number): Promise<void>
  setParam(effectId: string, name: string, value: EffectParamValue): Promise<void>
  getParams?(effectId: string): Record<string, unknown>
  applyPreset(effectId: string, presetName: string): Promise<void>

  /** 总额外延迟，供可视化器与歌词做时间补偿。 */
  readonly latencyMs: number
}
```

一个效果插件很小：

```ts
export const name = 'plugin-effect-eq10'
export const inject = ['dsp']

const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export function apply(ctx: Context) {
  return ctx.dsp.register({
    id: 'eq10',
    displayName: '10-Band Equalizer',
    defaultOrder: 20,
    Params: EqParams,                       // Zod/Valibot schema: gains + preamp
    presets: [{ name: 'Flat', params: { gains: BANDS.map(() => 0) } }],
    build(audioCtx, params) {
      const filters = BANDS.map((f, i) => {
        const n = audioCtx.createBiquadFilter()
        n.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking'
        n.frequency.value = f
        n.Q.value = 1.41
        n.gain.value = params.gains[i]
        return n
      })
      filters.reduce((a, b) => (a.connect(b), b))
      return {
        input: filters[0],
        output: filters[filters.length - 1],
        setParam(nameOfParam, value) {
          const i = Number(nameOfParam.replace('band', ''))
          // Ramp rather than assign — a step change on a live filter clicks.
          filters[i].gain.setTargetAtTime(Number(value), audioCtx.currentTime, 0.02)
        },
        dispose() { filters.forEach((f) => f.disconnect()) },
      }
    },
  })
}
```

### 效果链组装

`ctx.dsp` 发出 `dsp/build-chain` 瀑布（waterfall）钩子，每个已注册效果按 ordinal 顺序贡献一个 segment，结果被拼接进 `chainInput` 与主音量之间。重建只发生在结构性变化时（某个效果被启用、禁用或重排）；**参数变化绝不重建图**，它们走 `setParam`。若每次拖动 EQ 滑块都重建图，那是听得出来的。

重建本身也是带斜坡的：主增益在 20 ms 内下潜，重新接线，增益再回升。没有这一步，播放中途切换效果会发出咔哒声。

### 内置效果

| id | Order | Implementation | Notes |
|---|---|---|---|
| `normalize` | 5 | `GainNode` driven by ReplayGain tags | 输入基准校准阶段；在 EQ 调音前统一不同曲目/专辑的基准电平 |
| `preamp` | 10 | `GainNode` | EQ 之前的净空（headroom）；钳制在 −20…+20 dB |
| `eq10` | 20 | 10 × `BiquadFilterNode` | 低架、8 个峰值、高架 |
| `compressor` | 40 | `DynamicsCompressorNode` | 供安静聆听使用的"夜间模式"预设 |
| `reverb` | 50 | `ConvolverNode` | 冲激响应作为资源随包分发；湿/干混合 |
| `widener` | 60 | `ChannelSplitter` + `Delay` + `ChannelMerger` | 基于 Haas 效应；UI 中给出单声道兼容性警告 |
| `crossfeed` | 65 | `IIRFilterNode` + delay | Bauer 风格，缓解耳机听感疲劳 |
| `tempo-pitch` | 70 | JS `AudioWorklet` (phase vocoder) | ⚠️ CPU 开销大；默认关闭，低电量时自动禁用 |
| `limiter` | 90 | `DynamicsCompressorNode`, hard settings | 永远在最后；防止各效果增益累积爆音 |

### 原生 libavfilter 适配器与 ReplayGain 集成 (MPV 引擎)

在运行原生 MPV 引擎（`@BBeBee/core-audio-mpv`）时，效果器声明可选的 `buildLavfi(params)` 适配器生成 FFmpeg 滤镜链片段，并在原生进程内直接执行：
- `normalize`:
  - **单曲 / 专辑模式**：直接由 libmpv 原生 ReplayGain 属性控制（`replaygain=track|album`、`replaygain-preamp`、`replaygain-clip`）。`buildLavfi()` 返回空字符串 `""`，**彻底杜绝双重增益冲突**（避免 libmpv 解码层与 libavfilter 滤镜层各缩放一次音量）。
  - **动态 EBU R128 模式 (`loudnorm`)**：原生 `replaygain` 设为 `no`，由 `buildLavfi()` 生成实时流式滤镜 `loudnorm=I=${targetLufs}:TP=-1.0:LRA=11`。
  - **手动模式**：在原生 `replaygain` 设为 `no` 时生成 `volume=volume=${gainDb}dB`。
- `preamp`: `volume=volume=...dB`
- `eq10`: 10 段均衡滤镜链（`lowshelf`, `equalizer`, `highshelf`）
- `compressor`: `acompressor`
- `reverb`: `aecho=in_gain=1:out_gain=...:delays=...:decays=...`
- `widener`: `extrastereo=m=...`
- `crossfeed`: `crossfeed=strength=...:range=...`（截断频率归一化至 `[0, 1]` 范围）
- `limiter`: `alimiter=limit=...:level=0`

### 设置项接口化贡献与 UI 解耦

曲目间音量均衡作为播放传输层输入校准功能，与创造性调声音效彻底解耦：
- **通过标准接口动态贡献**：由 `plugin-dsp` 通过 `ctx.ui.contribute({ kind: 'settings', id: 'settings.loudness-normalization', section: 'playback', display: 'card', order: 25 })` 动态贡献到播放设置中，由独立的 `LoudnessNormalizationCard` 渲染，设置容器无任何硬编码。
- **调音面板概念统一**：专用调音面板（`dsp.view` 与 `settings.dsp`）聚焦于 10 频段 EQ、动态范围压缩与空间混响，移除重复的音量均衡控件，避免概念混淆与 UI 冗余。

> ⚠️ `tempo-pitch` 作为 `AudioWorklet` 跑在音频线程上，从 `build()` 收到的那个 `AudioContext` 创建——与所有其他效果一样，它不导入任何平台相关的东西，也不知道底层是哪个引擎。尽管如此，它仍是唯一在中端 Android 上有真实性能风险的效果：它会自行上报掉帧（dropout）计数，在风险出现时以用户可见的提示自我禁用，而不是拖垮整条效果链。

---

