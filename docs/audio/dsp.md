# DSP Chain & Effects Processing

> **Legacy Reference:** Formerly `docs/05-audio-playback.md §3`.

## 3. `ctx.dsp` — the effect chain

Every effect is a plugin. The service is a registry plus a chain builder.

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
  getParams?(effectId: string): Record<string, unknown>
  applyPreset(effectId: string, presetName: string): Promise<void>

  /** Total added latency, so the visualiser and lyrics can compensate. */
  readonly latencyMs: number
}
```

An effect plugin is small:

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

### Chain assembly

`ctx.dsp` emits the `dsp/build-chain` waterfall, each registered effect contributing a segment in
ordinal order, and the result is spliced between `chainInput` and `chainOutput` (which feeds master volume).
Rebuilds happen only on structural change (an effect enabled, disabled, or reordered); **parameter changes never
rebuild the graph**, they call `setParam` (or `setTargetAtTime` on underlying audio parameters). Rebuilding
on every EQ slider drag would be audible.

Rebuilds are also ramped: `ctx.audio.dipVolume(20)` dips master gain over 20 ms, the graph is re-wired,
and gain returns. Without this, toggling or reordering an effect mid-playback clicks.

Chain ordering, per-effect enabled states, and effect parameters are automatically persisted in `ctx.store`
under the `'dsp'` namespace. Both desktop and mobile shells provide a dedicated DSP chain editor
(`@BBeBee/plugin-dsp-ui-*`, registering `dsp.view`). To avoid redundant UI controls and keep the settings center clean,
the dedicated DSP panel is opened as a distinct page (`dsp.view`) via an action button in the playback settings section,
rather than embedding a duplicate DSP section inside the main settings page.

### Built-in effects

| id | Order | Implementation | Notes |
|---|---|---|---|
| `normalize` | 5 | `GainNode` driven by ReplayGain tags | Input calibration stage; aligns track/album volume before tonal EQ |
| `preamp` | 10 | `GainNode` | Headroom before EQ; clamped to −20…+20 dB |
| `eq10` | 20 | 10 × `BiquadFilterNode` | Low-shelf, 8 peaking, high-shelf |
| `compressor` | 40 | `DynamicsCompressorNode` | "Night mode" preset for quiet listening |
| `reverb` | 50 | `ConvolverNode` | Impulse responses shipped as assets; wet/dry mix |
| `widener` | 60 | `ChannelSplitter` + `Delay` + `ChannelMerger` | Haas-based; mono-compatibility warning in the UI |
| `crossfeed` | 65 | `IIRFilterNode` + delay | Bauer-style, for headphone fatigue |
| `tempo-pitch` | 70 | JS `AudioWorklet` (phase vocoder) | ⚠️ CPU-heavy; off by default, disabled automatically on low battery |
| `limiter` | 90 | `DynamicsCompressorNode`, hard settings | Always last; protects against cumulative effect gain |

### Native libavfilter adapters & ReplayGain integration (MPV engine)

When running the native MPV engine (`@BBeBee/core-audio-mpv`), effects declare an optional `buildLavfi(params)` adapter to generate FFmpeg filtergraph fragments executed directly inside the native process:
- `normalize`:
  - **Track / Album mode**: Handled directly by libmpv native ReplayGain properties (`replaygain=track|album`, `replaygain-preamp`, `replaygain-clip`). `buildLavfi()` emits an empty string `""` to completely prevent the **double-gain conflict** where volume scaling would otherwise be applied twice (once by libmpv's native decoder and once by libavfilter).
  - **Dynamic EBU R128 mode (`loudnorm`)**: Native `replaygain` is set to `no`, and `buildLavfi()` generates the real-time EBU R128 filter `loudnorm=I=${targetLufs}:TP=-1.0:LRA=11`.
  - **Manual mode**: Emits `volume=volume=${gainDb}dB` while native `replaygain` is `no`.
- `preamp`: `volume=volume=...dB`
- `eq10`: 10-band chain (`lowshelf`, `equalizer`, `highshelf`)
- `compressor`: `acompressor`
- `reverb`: `aecho=in_gain=1:out_gain=...:delays=...:decays=...`
- `widener`: `extrastereo=m=...`
- `crossfeed`: `crossfeed=strength=...:range=...` (cutoff frequency normalized to range `[0, 1]`)
- `limiter`: `alimiter=limit=...:level=0`

### Settings Contribution & UI Separation

Volume normalization is a playback transport calibration feature rather than a sound-coloring creative DSP effect:
- **Contributed via interface**: Contributed via `ctx.ui.contribute({ kind: 'settings', id: 'settings.loudness-normalization', section: 'playback', display: 'card', order: 25 })` and rendered by `LoudnessNormalizationCard`. It is not hardcoded into settings containers.
- **Dedicated DSP view**: Creative audio effects (10-band EQ, compressor, reverb, widener) are presented in `DspSettingsCard` (under the `audio` section) and the full-page DSP editor (`dsp.view`), cleanly separated from playback volume normalization.

> ⚠️ `tempo-pitch` runs on the audio thread as an `AudioWorklet` created from the `AudioContext`
> that `build()` receives — like every other effect, it imports nothing platform-specific and does
> not know which engine is underneath. It is nonetheless the one effect with real performance risk
> on mid-range Android: it reports its own dropout count and disables itself with a user-visible
> notice rather than degrading the whole chain.

---

