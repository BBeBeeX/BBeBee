import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface WidenerParams {
  width: number
  delayMs: number
}

const DEFAULT_PARAMS: WidenerParams = {
  width: 1.2,
  delayMs: 15,
}

export const WidenerEffect: EffectDefinition<WidenerParams> = {
  id: 'widener',
  displayName: '立体声展宽 (Widener)',
  defaultOrder: 60,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '适度展宽 (Moderate)', params: { width: 1.2, delayMs: 12 }, builtin: true },
    { name: '开阔声场 (Wide)', params: { width: 1.5, delayMs: 18 }, builtin: true },
    { name: '单声道收窄 (Narrow)', params: { width: 0.5, delayMs: 5 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const width = typeof params['width'] === 'number' ? Math.max(0, Math.min(4, params['width'] as number)) : 1.2
    if (Math.abs(width - 1) < 0.01) return ''
    // extrastereo scales the side level — the delay-based mid/side widening
    // of the WebAudio version has no exact libavfilter counterpart.
    return `extrastereo=m=${width.toFixed(2)}`
  },
  build(audioCtx: BaseAudioContext, params: WidenerParams): EffectSegment {
    const input = audioCtx.createGain()
    const output = audioCtx.createGain()

    if (
      typeof audioCtx.createChannelSplitter !== 'function' ||
      typeof audioCtx.createChannelMerger !== 'function' ||
      typeof audioCtx.createDelay !== 'function'
    ) {
      // Fallback pass-through for basic environments
      input.connect(output)
      return {
        input,
        output,
        setParam() {},
        dispose() {
          input.disconnect()
          output.disconnect()
        },
      }
    }

    const splitter = audioCtx.createChannelSplitter(2)
    const merger = audioCtx.createChannelMerger(2)
    const delayL = audioCtx.createDelay()
    const delayR = audioCtx.createDelay()
    const sideGain = audioCtx.createGain()

    const delaySec = Math.max(0.001, (params.delayMs ?? 15) / 1000)
    delayL.delayTime.value = delaySec
    delayR.delayTime.value = delaySec
    sideGain.gain.value = Math.max(0, Math.min(2, params.width ?? 1.2)) - 1

    input.connect(splitter)

    // Direct path
    splitter.connect(merger, 0, 0)
    splitter.connect(merger, 1, 1)

    // Haas side widening cross-path
    splitter.connect(delayL, 0)
    splitter.connect(delayR, 1)
    delayL.connect(sideGain)
    delayR.connect(sideGain)
    sideGain.connect(merger, 0, 1) // L to R
    sideGain.connect(merger, 0, 0) // R to L

    merger.connect(output)

    return {
      input,
      output,
      setParam(name, value) {
        const num = Number(value)
        if (Number.isNaN(num)) return
        const now = audioCtx.currentTime
        if (name === 'width') {
          const target = Math.max(0, Math.min(2, num)) - 1
          if (typeof sideGain.gain.setTargetAtTime === 'function') {
            sideGain.gain.setTargetAtTime(target, now, 0.02)
          } else {
            sideGain.gain.value = target
          }
        } else if (name === 'delayMs') {
          const target = Math.max(0.001, Math.min(0.05, num / 1000))
          delayL.delayTime.value = target
          delayR.delayTime.value = target
        }
      },
      dispose() {
        input.disconnect()
        splitter.disconnect()
        delayL.disconnect()
        delayR.disconnect()
        sideGain.disconnect()
        merger.disconnect()
        output.disconnect()
      },
    }
  },
}
