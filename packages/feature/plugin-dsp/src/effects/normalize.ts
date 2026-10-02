import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface NormalizeParams {
  targetLufs: number
  gainDb: number
}

const DEFAULT_PARAMS: NormalizeParams = {
  targetLufs: -14,
  gainDb: 0,
}

export const NormalizeEffect: EffectDefinition<NormalizeParams> = {
  id: 'normalize',
  displayName: '响度标准化 (Normalization)',
  defaultOrder: 30,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '流媒体标准 (-14 LUFS)', params: { targetLufs: -14, gainDb: 0 }, builtin: true },
    { name: '古典安静 (-18 LUFS)', params: { targetLufs: -18, gainDb: -4 }, builtin: true },
    { name: '高响度 (-11 LUFS)', params: { targetLufs: -11, gainDb: 3 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    // The WebAudio build is a plain gain node (targetLufs informs the UI's
    // suggested gain, it is not applied here either).
    const gainDb = typeof params['gainDb'] === 'number' ? Math.max(-20, Math.min(20, params['gainDb'] as number)) : 0
    if (Math.abs(gainDb) < 0.01) return ''
    return `volume=volume=${gainDb.toFixed(2)}dB`
  },
  build(audioCtx: BaseAudioContext, params: NormalizeParams): EffectSegment {
    const node = audioCtx.createGain()
    const gainDb = Math.max(-20, Math.min(20, params.gainDb ?? 0))
    node.gain.value = Math.pow(10, gainDb / 20)

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
