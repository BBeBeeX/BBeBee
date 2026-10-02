import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface PreampParams {
  gainDb: number
}

const DEFAULT_PARAMS: PreampParams = {
  gainDb: 0,
}

export const PreampEffect: EffectDefinition<PreampParams> = {
  id: 'preamp',
  displayName: '前级增益 (Preamp)',
  defaultOrder: 10,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '默认 (0 dB)', params: { gainDb: 0 }, builtin: true },
    { name: '轻微增益 (+3 dB)', params: { gainDb: 3 }, builtin: true },
    { name: '衰减防过载 (-3 dB)', params: { gainDb: -3 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const gainDb = typeof params['gainDb'] === 'number' ? (params['gainDb'] as number) : 0
    if (Math.abs(gainDb) < 0.01) return ''
    const clamped = Math.max(-60, Math.min(24, gainDb))
    return `volume=volume=${clamped.toFixed(2)}dB`
  },
  build(audioCtx: BaseAudioContext, params: PreampParams): EffectSegment {
    const node = audioCtx.createGain()
    const clampedDb = Math.max(-20, Math.min(20, params.gainDb ?? 0))
    node.gain.value = Math.pow(10, clampedDb / 20)

    return {
      input: node,
      output: node,
      setParam(name, value) {
        if (name === 'gainDb') {
          const db = Math.max(-20, Math.min(20, Number(value)))
          const target = Math.pow(10, db / 20)
          if (typeof node.gain.setTargetAtTime === 'function') {
            node.gain.setTargetAtTime(target, audioCtx.currentTime, 0.02)
          } else {
            node.gain.value = target
          }
        }
      },
      dispose() {
        node.disconnect()
      },
    }
  },
}
