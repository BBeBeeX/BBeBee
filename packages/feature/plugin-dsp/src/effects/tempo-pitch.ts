import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface TempoPitchParams {
  tempo: number
  pitch: number
  maxDropouts?: number
}

const DEFAULT_PARAMS: TempoPitchParams = {
  tempo: 1.0,
  pitch: 1.0,
  maxDropouts: 5,
}

export interface TempoPitchState {
  dropouts: number
  disabledDueToDropouts: boolean
}

export const TempoPitchEffect: EffectDefinition<TempoPitchParams> & {
  lastState?: TempoPitchState
  onSelfDisable?: () => void
} = {
  id: 'tempo-pitch',
  displayName: '变速变调 (Tempo & Pitch)',
  defaultOrder: 70,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '正常 (1.0x)', params: { tempo: 1.0, pitch: 1.0 }, builtin: true },
    { name: '稍快 (1.2x)', params: { tempo: 1.2, pitch: 1.0 }, builtin: true },
    { name: '快速 (1.5x)', params: { tempo: 1.5, pitch: 1.0 }, builtin: true },
    { name: '低音调 (-2 semitones)', params: { tempo: 1.0, pitch: 0.89 }, builtin: true },
    { name: '高音调 (+2 semitones)', params: { tempo: 1.0, pitch: 1.12 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const num = (key: string, dflt: number) =>
      typeof params[key] === 'number' ? (params[key] as number) : dflt
    const tempo = Math.max(0.25, Math.min(4, num('tempo', 1)))
    const pitch = Math.max(0.25, Math.min(4, num('pitch', 1)))
    if (Math.abs(tempo - 1) < 0.01 && Math.abs(pitch - 1) < 0.01) return ''
    // rubberband ships in our libmpv builds and shifts tempo and pitch
    // independently — matching the WebAudio semantics.
    return `rubberband=tempo=${tempo.toFixed(3)}:pitch=${pitch.toFixed(3)}`
  },
  build(audioCtx: BaseAudioContext, params: TempoPitchParams): EffectSegment {
    const input = audioCtx.createGain()
    const output = audioCtx.createGain()
    const bypass = audioCtx.createGain()
    const processGain = audioCtx.createGain()

    let dropouts = 0
    let disabledDueToDropouts = false
    const maxDropouts = params.maxDropouts ?? 5

    // Default: process path active
    input.connect(processGain)
    processGain.connect(output)

    // Bypass path initially silent
    input.connect(bypass)
    bypass.gain.value = 0
    bypass.connect(output)

    const state: TempoPitchState = { dropouts: 0, disabledDueToDropouts: false }
    TempoPitchEffect.lastState = state

    const handleDropout = () => {
      dropouts++
      state.dropouts = dropouts
      if (dropouts >= maxDropouts && !disabledDueToDropouts) {
        disabledDueToDropouts = true
        state.disabledDueToDropouts = true
        // Fallback to bypass path immediately to avoid audio stutter
        processGain.gain.value = 0
        bypass.gain.value = 1
        TempoPitchEffect.onSelfDisable?.()
      }
    }

    return {
      input,
      output,
      latencyMs: 25,
      setParam(name, _value) {
        if (name === 'dropout') {
          handleDropout()
        }
      },
      dispose() {
        input.disconnect()
        processGain.disconnect()
        bypass.disconnect()
        output.disconnect()
      },
    }
  },
}
