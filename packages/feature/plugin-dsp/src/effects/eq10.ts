import type { EffectDefinition, EffectSegment } from '@BBeBee/protocol'
import { createParamSchema } from './schema.js'

export const EQ10_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_BANDS = EQ10_BANDS
export const EQ6_BANDS = EQ10_BANDS

export interface Eq10Params {
  gains: number[]
}

const DEFAULT_PARAMS: Eq10Params = {
  gains: EQ_BANDS.map(() => 0),
}

export const EQ_PRESETS = [
  { name: '原声 (Flat)', params: { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, builtin: true },
  { name: '低音增强 (Bass Boost)', params: { gains: [6, 5, 4, 2, 1, 0, 0, 0, 0, 0] }, builtin: true },
  { name: '清晰人声 (Vocal)', params: { gains: [-2, -1, 0, 2, 4, 3, 2, 1, 0, -1] }, builtin: true },
  { name: '清亮高音 (Treble)', params: { gains: [0, 0, 0, 0, 0, 1, 2, 3, 5, 6] }, builtin: true },
  { name: '摇滚 (Rock)', params: { gains: [5, 3, 2, 0, -1, -1, 1, 3, 4, 5] }, builtin: true },
  { name: '流行 (Pop)', params: { gains: [-1, 1, 3, 4, 3, 1, -1, 0, 2, 3] }, builtin: true },
  { name: '电子乐 (Electronic)', params: { gains: [5, 4, 2, 0, -2, 1, 2, 4, 5, 4] }, builtin: true },
  { name: '古典 (Classical)', params: { gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 3] }, builtin: true },
]

export const Eq10Effect: EffectDefinition<Eq10Params> = {
  id: 'eq10',
  displayName: '均衡器 (Equalizer)',
  defaultOrder: 20,
  Params: createParamSchema(DEFAULT_PARAMS),
  presets: EQ_PRESETS,
  buildLavfi(params: Record<string, unknown>): string {
    // setParam stores flat band<N> keys; getParams' preset fallback returns a
    // gains array — the adapter reads both shapes.
    const raw: number[] = EQ_BANDS.map((_, i) => {
      const band = params[`band${i}`]
      if (typeof band === 'number') return band
      const gains = Array.isArray(params['gains']) ? (params['gains'] as number[]) : []
      return typeof gains[i] === 'number' ? gains[i]! : 0
    })
    const parts: string[] = []
    EQ_BANDS.forEach((freq, i) => {
      const g = Math.max(-12, Math.min(12, raw[i] ?? 0))
      if (Math.abs(g) <= 0.05) return
      if (i === 0) parts.push(`lowshelf=f=${freq}:g=${g.toFixed(2)}`)
      else if (i === EQ_BANDS.length - 1) parts.push(`highshelf=f=${freq}:g=${g.toFixed(2)}`)
      else parts.push(`equalizer=f=${freq}:width_type=q:w=1.41:g=${g.toFixed(2)}`)
    })
    return parts.join(',')
  },
  build(audioCtx: BaseAudioContext, params: Eq10Params): EffectSegment {
    const rawGains = Array.isArray(params.gains) ? params.gains : []
    const gains = EQ_BANDS.map((_, i) =>
      typeof rawGains[i] === 'number' ? Math.max(-12, Math.min(12, rawGains[i]!)) : 0,
    )

    const filters: BiquadFilterNode[] = EQ_BANDS.map((freq, i) => {
      const node = audioCtx.createBiquadFilter()
      node.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      node.frequency.value = freq
      node.Q.value = 1.41
      node.gain.value = gains[i] ?? 0
      return node
    })

    const first = filters[0]!
    const last = filters[filters.length - 1]!

    // Serial chain: filter[0] -> filter[1] -> ... -> filter[N-1]
    for (let i = 0; i < filters.length - 1; i++) {
      const current = filters[i]
      const next = filters[i + 1]
      if (current && next) {
        current.connect(next)
      }
    }

    return {
      input: first,
      output: last,
      setParam(name, value) {
        if (name.startsWith('band')) {
          const idx = Number(name.replace('band', ''))
          const filter = filters[idx]
          if (filter) {
            const db = Math.max(-12, Math.min(12, Number(value)))
            if (typeof filter.gain.setTargetAtTime === 'function') {
              filter.gain.setTargetAtTime(db, audioCtx.currentTime, 0.02)
            } else {
              filter.gain.value = db
            }
          }
        } else if (name === 'gains' && Array.isArray(value)) {
          value.forEach((v, idx) => {
            const filter = filters[idx]
            if (filter) {
              const db = Math.max(-12, Math.min(12, Number(v)))
              if (typeof filter.gain.setTargetAtTime === 'function') {
                filter.gain.setTargetAtTime(db, audioCtx.currentTime, 0.02)
              } else {
                filter.gain.value = db
              }
            }
          })
        }
      },
      dispose() {
        for (const f of filters) {
          f.disconnect()
        }
      },
    }
  },
}
