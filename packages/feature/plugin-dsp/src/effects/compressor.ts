import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface CompressorParams {
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
}

const DEFAULT_PARAMS: CompressorParams = {
  threshold: -24,
  knee: 30,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
}

export const CompressorEffect: EffectDefinition<CompressorParams> = {
  id: 'compressor',
  displayName: '动态压缩器 (Compressor)',
  defaultOrder: 40,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    {
      name: '夜间模式 (Night Mode)',
      params: { threshold: -28, knee: 30, ratio: 8, attack: 0.003, release: 0.25 },
      builtin: true,
    },
    {
      name: '温和顺滑 (Subtle)',
      params: { threshold: -16, knee: 20, ratio: 2.5, attack: 0.01, release: 0.3 },
      builtin: true,
    },
    {
      name: '强劲动态 (Heavy)',
      params: { threshold: -30, knee: 36, ratio: 12, attack: 0.002, release: 0.15 },
      builtin: true,
    },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const num = (key: string, dflt: number) =>
      typeof params[key] === 'number' ? (params[key] as number) : dflt
    const threshold = Math.max(-60, Math.min(0, num('threshold', -24)))
    const ratio = Math.max(1, Math.min(20, num('ratio', 4)))
    const attack = Math.max(0.001, num('attack', 0.003)) * 1000 // WebAudio s → lavfi ms
    const release = Math.max(0.01, num('release', 0.25)) * 1000
    // knee has no acompressor counterpart — the hard-knee default applies.
    return `acompressor=threshold=${threshold.toFixed(1)}dB:ratio=${ratio.toFixed(1)}:attack=${attack.toFixed(0)}:release=${release.toFixed(0)}`
  },
  build(audioCtx: BaseAudioContext, params: CompressorParams): EffectSegment {
    const node = audioCtx.createDynamicsCompressor()
    node.threshold.value = params.threshold ?? -24
    node.knee.value = params.knee ?? 30
    node.ratio.value = params.ratio ?? 4
    node.attack.value = params.attack ?? 0.003
    node.release.value = params.release ?? 0.25

    return {
      input: node,
      output: node,
      setParam(name, value) {
        const num = Number(value)
        if (Number.isNaN(num)) return
        const now = audioCtx.currentTime
        switch (name) {
          case 'threshold':
            if (typeof node.threshold.setTargetAtTime === 'function') {
              node.threshold.setTargetAtTime(Math.max(-100, Math.min(0, num)), now, 0.02)
            } else {
              node.threshold.value = Math.max(-100, Math.min(0, num))
            }
            break
          case 'knee':
            if (typeof node.knee.setTargetAtTime === 'function') {
              node.knee.setTargetAtTime(Math.max(0, Math.min(40, num)), now, 0.02)
            } else {
              node.knee.value = Math.max(0, Math.min(40, num))
            }
            break
          case 'ratio':
            if (typeof node.ratio.setTargetAtTime === 'function') {
              node.ratio.setTargetAtTime(Math.max(1, Math.min(20, num)), now, 0.02)
            } else {
              node.ratio.value = Math.max(1, Math.min(20, num))
            }
            break
          case 'attack':
            if (typeof node.attack.setTargetAtTime === 'function') {
              node.attack.setTargetAtTime(Math.max(0, Math.min(1, num)), now, 0.02)
            } else {
              node.attack.value = Math.max(0, Math.min(1, num))
            }
            break
          case 'release':
            if (typeof node.release.setTargetAtTime === 'function') {
              node.release.setTargetAtTime(Math.max(0, Math.min(1, num)), now, 0.02)
            } else {
              node.release.value = Math.max(0, Math.min(1, num))
            }
            break
        }
      },
      dispose() {
        node.disconnect()
      },
    }
  },
}
