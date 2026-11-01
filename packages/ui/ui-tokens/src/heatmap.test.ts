import { describe, expect, it } from 'vitest'
import { HEATMAP_LEVEL_COLORS, getHeatmapLevel } from './heatmap.js'

describe('getHeatmapLevel', () => {
  it('buckets play counts onto the five levels', () => {
    expect(getHeatmapLevel(0)).toBe(0)
    expect(getHeatmapLevel(-3)).toBe(0)
    expect(getHeatmapLevel(1)).toBe(1)
    expect(getHeatmapLevel(2)).toBe(1)
    expect(getHeatmapLevel(3)).toBe(2)
    expect(getHeatmapLevel(5)).toBe(2)
    expect(getHeatmapLevel(6)).toBe(3)
    expect(getHeatmapLevel(10)).toBe(3)
    expect(getHeatmapLevel(11)).toBe(4)
    expect(getHeatmapLevel(999)).toBe(4)
  })

  it('has exactly one colour per level', () => {
    expect(HEATMAP_LEVEL_COLORS).toHaveLength(5)
    for (const color of HEATMAP_LEVEL_COLORS) expect(typeof color).toBe('string')
  })
})
