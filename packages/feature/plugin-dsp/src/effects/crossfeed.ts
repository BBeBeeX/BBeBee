import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export interface CrossfeedParams {
  amount: number
  cutoffHz: number
}

const DEFAULT_PARAMS: CrossfeedParams = {
  amount: 0.35,
  cutoffHz: 700,
}

export const CrossfeedEffect: EffectDefinition<CrossfeedParams> = {
  id: 'crossfeed',
  displayName: '耳机交叉馈入 (Crossfeed)',
  defaultOrder: 65,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: [
    { name: '自然舒缓 (Natural)', params: { amount: 0.35, cutoffHz: 700 }, builtin: true },
    { name: '强效混合 (High)', params: { amount: 0.6, cutoffHz: 800 }, builtin: true },
    { name: '轻度减疲劳 (Subtle)', params: { amount: 0.2, cutoffHz: 650 }, builtin: true },
  ],
  buildLavfi(params: Record<string, unknown>): string {
    const amount = typeof params['amount'] === 'number' ? Math.max(0, Math.min(1, params['amount'] as number)) : 0.35
    const cutoff = typeof params['cutoffHz'] === 'number' ? Math.max(200, Math.min(2000, params['cutoffHz'] as number)) : 700
    // ffmpeg's crossfeed filter pursues the same psychoacoustic idea as the
    // WebAudio mid/side version — the internals differ, the listening result
    // is close. The 'range' option expects a normalized [0, 1] soundstage wideness.
    const range = Math.max(0, Math.min(1, (cutoff - 200) / 1800))
    return `crossfeed=strength=${amount.toFixed(2)}:range=${range.toFixed(2)}`
  },
  build(audioCtx: BaseAudioContext, params: CrossfeedParams): EffectSegment {
    const input = audioCtx.createGain()
    const output = audioCtx.createGain()

    if (
      typeof audioCtx.createChannelSplitter !== 'function' ||
      typeof audioCtx.createChannelMerger !== 'function' ||
      typeof audioCtx.createBiquadFilter !== 'function'
    ) {
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
    const filterL = audioCtx.createBiquadFilter()
    const filterR = audioCtx.createBiquadFilter()
    const crossGain = audioCtx.createGain()

    const cutoff = Math.max(200, Math.min(2000, params.cutoffHz ?? 700))
    filterL.type = 'lowpass'
    filterL.frequency.value = cutoff
    filterR.type = 'lowpass'
    filterR.frequency.value = cutoff

    const amount = Math.max(0, Math.min(1, params.amount ?? 0.35))
    crossGain.gain.value = amount * 0.5

    input.connect(splitter)

    // Direct
    splitter.connect(merger, 0, 0)
    splitter.connect(merger, 1, 1)

    // Bauer cross-feed: L filtered -> R, R filtered -> L
    splitter.connect(filterL, 0)
    splitter.connect(filterR, 1)
    filterL.connect(crossGain)
    filterR.connect(crossGain)
    crossGain.connect(merger, 0, 1)
    crossGain.connect(merger, 0, 0)

    merger.connect(output)

    return {
      input,
      output,
      setParam(name, value) {
        const num = Number(value)
        if (Number.isNaN(num)) return
        const now = audioCtx.currentTime
        if (name === 'amount') {
          const target = Math.max(0, Math.min(1, num)) * 0.5
          if (typeof crossGain.gain.setTargetAtTime === 'function') {
            crossGain.gain.setTargetAtTime(target, now, 0.02)
          } else {
            crossGain.gain.value = target
          }
        } else if (name === 'cutoffHz') {
          const target = Math.max(200, Math.min(2000, num))
          filterL.frequency.value = target
          filterR.frequency.value = target
        }
      },
      dispose() {
        input.disconnect()
        splitter.disconnect()
        filterL.disconnect()
        filterR.disconnect()
        crossGain.disconnect()
        merger.disconnect()
        output.disconnect()
      },
    }
  },
}
