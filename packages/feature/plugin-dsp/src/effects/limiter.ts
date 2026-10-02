import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface LimiterParams {
  ceilingDb: number
}

const DEFAULT_PARAMS: LimiterParams = {
  ceilingDb: -0.5,
}

export const LimiterEffect: EffectDefinition<LimiterParams> = {
  id: 'limiter',
  displayName: '峰值限制器 (Peak Limiter)',
  defaultOrder: 90,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '安全防破音 (-0.5 dB)', params: { ceilingDb: -0.5 }, builtin: true },
    { name: '严格限制 (-1.0 dB)', params: { ceilingDb: -1.0 }, builtin: true },
    { name: '微弱限制 (-0.1 dB)', params: { ceilingDb: -0.1 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const ceiling = typeof params['ceilingDb'] === 'number'
      ? Math.max(-12, Math.min(0, params['ceilingDb'] as number))
      : -0.5
    const limit = Math.pow(10, ceiling / 20) // alimiter takes a linear 0..1 limit
    return `alimiter=limit=${limit.toFixed(3)}:level=0`
  },
  build(audioCtx: BaseAudioContext, params: LimiterParams): EffectSegment {
    const node = audioCtx.createDynamicsCompressor()
    const ceiling = Math.min(0, Math.max(-12, params.ceilingDb ?? -0.5))
    node.threshold.value = ceiling
    node.knee.value = 0 // Hard knee for brickwall limiting
    node.ratio.value = 20 // Heavy limiting ratio
    node.attack.value = 0.001 // Fast attack to catch peaks
    node.release.value = 0.05 // Quick release

    return {
      input: node,
      output: node,
      setParam(name, value) {
        if (name === 'ceilingDb') {
          const val = Math.min(0, Math.max(-12, Number(value)))
          const now = audioCtx.currentTime
          if (typeof node.threshold.setTargetAtTime === 'function') {
            node.threshold.setTargetAtTime(val, now, 0.01)
          } else {
            node.threshold.value = val
          }
        }
      },
      dispose() {
        node.disconnect()
      },
    }
  },
}
