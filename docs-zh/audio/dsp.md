# DSP 效果链与音频处理

> **历史章节映射：** 原 `docs-zh/05-audio-playback.md §3`。

## 3. `ctx.dsp` —— 效果链

每一个效果都是一个插件。这个服务本身只是一个注册表加上一个链构建器。

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface EffectSegment {
  /** Where audio enters and leaves this effect. May be the same node. */
  input: AudioNode
  output: AudioNode
  /** Called when a persisted parameter changes. Must be allocation-free. */
  setParam(name: string, value: number | string | boolean): void
  /** Added to the reported chain latency, for A/V sync and visualiser alignment. */
  latencyMs?: number
  dispose(): void
}

export interface EffectDefinition<P = Record<string, unknown>> {
  id: string                      // 'eq10', 'reverb', 'normalize'
  displayName: string
  /** Default ordinal. Lower runs earlier. Users may override. */
  defaultOrder: number
  Params: StandardSchemaV1<unknown, P>
  presets?: { name: string; params: P }[]
  build(ctx: AudioContextLike, params: P): EffectSegment
}

export interface DspService {
  register(def: EffectDefinition): Disposable
  readonly definitions: readonly EffectDefinition[]

  readonly chain: readonly { effectId: string; enabled: boolean; ordinal: number }[]
  setEnabled(effectId: string, on: boolean): Promise<void>
  setOrder(effectId: string, ordinal: number): Promise<void>
  setParam(effectId: string, name: string, value: number | string | boolean): Promise<void>
  applyPreset(effectId: string, presetName: string): Promise<void>

  /** Total added latency, so the visualiser and lyrics can compensate. */
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
| `preamp` | 10 | `GainNode` | EQ 之前的净空（headroom）；钳制在 −20…+20 dB |
| `eq10` | 20 | 10 × `BiquadFilterNode` | 低架、8 个峰值、高架 |
| `normalize` | 30 | `GainNode` driven by ReplayGain tags | 曲目或专辑模式；回退到扫描器测得的值 |
| `compressor` | 40 | `DynamicsCompressorNode` | 供安静聆听使用的"夜间模式"预设 |
| `reverb` | 50 | `ConvolverNode` | 冲激响应作为资源随包分发；湿/干混合 |
| `widener` | 60 | `ChannelSplitter` + `Delay` + `ChannelMerger` | 基于 Haas 效应；UI 中给出单声道兼容性警告 |
| `crossfeed` | 65 | `IIRFilterNode` + delay | Bauer 风格，缓解耳机听感疲劳 |
| `tempo-pitch` | 70 | JS `AudioWorklet` (phase vocoder) | ⚠️ CPU 开销大；默认关闭，低电量时自动禁用 |
| `limiter` | 90 | `DynamicsCompressorNode`, hard settings | 永远在最后；防止各效果增益累积爆音 |

### 原生 libavfilter 适配器 (MPV 引擎)

在运行原生 MPV 引擎（`@BBeBee/core-audio-mpv`）时，效果器声明可选的 `buildLavfi(params)` 适配器生成 FFmpeg 滤镜链片段，并在原生进程内直接执行：
- `preamp`: `volume=volume=...dB`
- `eq10`: 10 段均衡滤镜链（`lowshelf`, `equalizer`, `highshelf`）
- `normalize`: ReplayGain 增益调整
- `compressor`: `acompressor`
- `reverb`: `aecho=in_gain=1:out_gain=...:delays=...:decays=...`
- `widener`: `extrastereo=m=...`
- `crossfeed`: `crossfeed=strength=...:range=...`（截断频率归一化至 `[0, 1]` 范围）
- `limiter`: `alimiter=limit=...:level=0`

> ⚠️ `tempo-pitch` 作为 `AudioWorklet` 跑在音频线程上，从 `build()` 收到的那个 `AudioContext` 创建——与所有其他效果一样，它不导入任何平台相关的东西，也不知道底层是哪个引擎。尽管如此，它仍是唯一在中端 Android 上有真实性能风险的效果：它会自行上报掉帧（dropout）计数，在风险出现时以用户可见的提示自我禁用，而不是拖垮整条效果链。

---

