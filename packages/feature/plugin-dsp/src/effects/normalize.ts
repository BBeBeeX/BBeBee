import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export type NormalizeMode = 'track' | 'album' | 'loudnorm' | 'manual'

export interface NormalizeParams {
  targetLufs: number
  gainDb: number
  mode?: NormalizeMode
  preampDb?: number
  fallbackGainDb?: number
}

const DEFAULT_PARAMS: NormalizeParams = {
  targetLufs: -14,
  gainDb: 0,
  mode: 'track',
  preampDb: 0,
  fallbackGainDb: 0,
}

export const NormalizeEffect: EffectDefinition<NormalizeParams> = {
  id: 'normalize',
  displayName: '响度标准化 (Normalization)',
  defaultOrder: 5,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '流媒体标准 (-14 LUFS)', params: { targetLufs: -14, gainDb: 0, mode: 'track', preampDb: 0, fallbackGainDb: 0 }, builtin: true },
    { name: '古典安静 (-18 LUFS)', params: { targetLufs: -18, gainDb: -4, mode: 'album', preampDb: 0, fallbackGainDb: -4 }, builtin: true },
    { name: '高响度广播 (-11 LUFS)', params: { targetLufs: -11, gainDb: 3, mode: 'track', preampDb: 0, fallbackGainDb: 0 }, builtin: true },
    { name: '动态 EBU R128 (loudnorm)', params: { targetLufs: -14, gainDb: 0, mode: 'loudnorm', preampDb: 0, fallbackGainDb: 0 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const mode = params['mode'] as NormalizeMode | undefined
    if (mode === 'loudnorm') {
      const targetLufs = typeof params['targetLufs'] === 'number' ? params['targetLufs'] : -14
      return `loudnorm=I=${targetLufs.toFixed(1)}:TP=-1.0:LRA=11`
    }
    if (mode === 'track' || mode === 'album') {
      // In native engine (MPV), ReplayGain for track/album is handled directly by
      // MPV's native replaygain decoder property to avoid double volume scaling conflict.
      return ''
    }
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
