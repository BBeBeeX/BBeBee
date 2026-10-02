import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface ReverbParams {
  mix: number
  decay: number
  preDelay: number
}

const DEFAULT_PARAMS: ReverbParams = {
  mix: 0.25,
  decay: 1.5,
  preDelay: 0.01,
}

/**
 * Deterministically generate a stereo impulse response for convolution reverb.
 * Using deterministic pseudo-random sequences guarantees reproducible offline-render tests.
 */
function createSyntheticImpulse(
  ctx: BaseAudioContext,
  decaySeconds: number,
  preDelaySeconds: number,
): AudioBuffer | null {
  if (typeof ctx.createBuffer !== 'function') return null
  const sampleRate = ctx.sampleRate || 44100
  const length = Math.max(128, Math.round(sampleRate * Math.min(5, Math.max(0.1, decaySeconds))))
  const preDelaySamples = Math.round(sampleRate * Math.max(0, Math.min(0.1, preDelaySeconds)))

  const buffer = ctx.createBuffer(2, length, sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)

  // Simple pseudo-random LCG sequence for determinism
  let seed = 12345
  function nextRand() {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 2147483648 - 1
  }

  const decayFactor = 3 / length
  for (let i = 0; i < length; i++) {
    if (i < preDelaySamples) {
      left[i] = 0
      right[i] = 0
    } else {
      const envelope = Math.exp(-(i - preDelaySamples) * decayFactor)
      left[i] = nextRand() * envelope
      right[i] = nextRand() * envelope
    }
  }

  return buffer
}

export const ReverbEffect: EffectDefinition<ReverbParams> = {
  id: 'reverb',
  displayName: '空间混响 (Reverb)',
  defaultOrder: 50,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    {
      name: '小型房间 (Small Room)',
      params: { mix: 0.15, decay: 0.8, preDelay: 0.01 },
      builtin: true,
    },
    {
      name: '音乐大厅 (Concert Hall)',
      params: { mix: 0.3, decay: 2.5, preDelay: 0.03 },
      builtin: true,
    },
    {
      name: '板式混响 (Plate)',
      params: { mix: 0.25, decay: 1.8, preDelay: 0.005 },
      builtin: true,
    },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const num = (key: string, dflt: number) =>
      typeof params[key] === 'number' ? (params[key] as number) : dflt
    const mix = Math.max(0, Math.min(1, num('mix', 0.25)))
    const decay = Math.max(0.1, Math.min(5, num('decay', 1.5)))
    const preDelay = Math.max(0, Math.min(0.1, num('preDelay', 0.01)))
    if (mix <= 0.01) return ''
    // aecho approximation of the convolver: the dry path stays at unity
    // (in_gain=1), three echo taps scaled by the mix, delays spread by decay.
    const d1 = Math.round(80 + preDelay * 1000 + decay * 60)
    const d2 = Math.round(d1 + decay * 220)
    const d3 = Math.round(d2 + decay * 330)
    const g = (m: number) => (mix * m).toFixed(2)
    return `aecho=in_gain=1:out_gain=1:delays=${d1}|${d2}|${d3}:decays=${g(0.5)}|${g(0.3)}|${g(0.2)}`
  },
  build(audioCtx: BaseAudioContext, params: ReverbParams): EffectSegment {
    const input = audioCtx.createGain()
    const output = audioCtx.createGain()
    const dryGain = audioCtx.createGain()
    const wetGain = audioCtx.createGain()

    let mix = Math.max(0, Math.min(1, params.mix ?? 0.25))
    let decay = Math.max(0.1, Math.min(5, params.decay ?? 1.5))
    let preDelay = Math.max(0, Math.min(0.1, params.preDelay ?? 0.01))

    dryGain.gain.value = 1 - mix
    wetGain.gain.value = mix

    input.connect(dryGain)
    dryGain.connect(output)

    let convolver: ConvolverNode | null = null
    if (typeof audioCtx.createConvolver === 'function') {
      convolver = audioCtx.createConvolver()
      const ir = createSyntheticImpulse(audioCtx, decay, preDelay)
      if (ir) convolver.buffer = ir
      input.connect(convolver)
      convolver.connect(wetGain)
      wetGain.connect(output)
    }

    return {
      input,
      output,
      setParam(name, value) {
        const num = Number(value)
        if (Number.isNaN(num)) return
        const now = audioCtx.currentTime
        if (name === 'mix') {
          mix = Math.max(0, Math.min(1, num))
          if (typeof dryGain.gain.setTargetAtTime === 'function') {
            dryGain.gain.setTargetAtTime(1 - mix, now, 0.02)
            wetGain.gain.setTargetAtTime(mix, now, 0.02)
          } else {
            dryGain.gain.value = 1 - mix
            wetGain.gain.value = mix
          }
        } else if (name === 'decay') {
          decay = Math.max(0.1, Math.min(5, num))
          if (convolver) {
            const ir = createSyntheticImpulse(audioCtx, decay, preDelay)
            if (ir) convolver.buffer = ir
          }
        } else if (name === 'preDelay') {
          preDelay = Math.max(0, Math.min(0.1, num))
          if (convolver) {
            const ir = createSyntheticImpulse(audioCtx, decay, preDelay)
            if (ir) convolver.buffer = ir
          }
        }
      },
      dispose() {
        input.disconnect()
        dryGain.disconnect()
        wetGain.disconnect()
        convolver?.disconnect()
        output.disconnect()
      },
    }
  },
}
