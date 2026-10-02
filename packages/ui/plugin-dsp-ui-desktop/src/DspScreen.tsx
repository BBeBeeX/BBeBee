/**
 * Desktop DSP Screen for `@BBeBee/plugin-dsp`.
 *
 * Provides a Spotify-style 6-band interactive equalizer with smooth bezier curves,
 * gradient fill, draggable knobs, preset selection, custom preset persistence,
 * and a full effect chain management view.
 */

import { createElement as h, useState, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Slider, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { EQ_PRESETS } from '@BBeBee/plugin-dsp/effects'

export interface DspScreenProps {
  ctx: Context
}

const EQ_LABELS = [
  '31Hz',
  '62Hz',
  '125Hz',
  '250Hz',
  '500Hz',
  '1KHz',
  '2KHz',
  '4KHz',
  '8KHz',
  '16KHz',
]
const STORAGE_KEY_CUSTOM_PRESETS = 'bbebee_custom_eq_presets'

interface CustomPreset {
  name: string
  gains: number[]
}

function Switch({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': accessibilityLabel,
      disabled,
      onClick: () => {
        if (!disabled) onChange(!checked)
      },
      style: {
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--color-primary, #5F87FF)' : 'rgba(255, 255, 255, 0.2)',
        boxShadow: checked ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.35))' : 'none',
        border: 'none',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        flexShrink: 0,
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#ffffff',
        transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '0 2px 5px rgba(0, 0, 0, 0.3)',
      },
    }),
  )
}

/**
 * Build a smooth cubic bezier SVG path across given coordinate points.
 */
function buildSplinePath(points: { x: number; y: number }[]): string {
  if (!points || points.length === 0) return ''
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2]!

    // Catmull-Rom to Cubic Bezier control points
    const cp1x = p1.x + (p2.x - p0.x) / 5
    const cp1y = p1.y + (p2.y - p0.y) / 5
    const cp2x = p2.x - (p3.x - p1.x) / 5
    const cp2y = p2.y - (p3.y - p1.y) / 5
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`
  }
  return d
}

export function DspScreen({ ctx }: DspScreenProps): ReactElement {
  const { chain, definitions, latencyMs, setEnabled, setOrder, setParam, applyPreset, getParams } =
    useDsp(ctx)

  const [activeTab, setActiveTab] = useState<'eq' | 'chain'>('eq')
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isSavingPreset, setIsSavingPreset] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const [selectedPresetName, setSelectedPresetName] = useState<string>('原声 (Flat)')
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement | null>(null)

  // Load custom presets from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CUSTOM_PRESETS)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setCustomPresets(parsed)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const isEqEnabled = eqEntry?.enabled ?? false
  const eqParams = getParams('eq10')
  const eqGains = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    if (typeof eqParams[`band${i}`] === 'number') {
      return eqParams[`band${i}`] as number
    }
    if (Array.isArray(eqParams.gains) && typeof eqParams.gains[i] === 'number') {
      return eqParams.gains[i] as number
    }
    return 0
  })

  // Determine active preset label
  const allPresets = [
    ...EQ_PRESETS.map((p) => ({ name: p.name, gains: p.params.gains, builtin: true })),
    ...customPresets.map((p) => ({ name: p.name, gains: p.gains, builtin: false })),
  ]

  const matchedPreset = allPresets.find((p) =>
    p.gains.every((val, i) => val === (eqGains[i] ?? 0)),
  )
  const displayPresetName = matchedPreset ? matchedPreset.name : '手动'

  const handleBandChange = (index: number, dbVal: number) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(dbVal)))
    const next = [...eqGains]
    next[index] = clamped
    void setParam('eq10', `band${index}`, clamped)
    void setParam('eq10', 'gains', next)
    setSelectedPresetName('手动')
  }

  const handleSelectPreset = (preset: { name: string; gains: number[] }) => {
    setSelectedPresetName(preset.name)
    setIsDropdownOpen(false)
    void applyPreset('eq10', preset.name)
    void setParam('eq10', 'gains', preset.gains)
    preset.gains.forEach((g, idx) => {
      void setParam('eq10', `band${idx}`, g)
    })
  }

  const handleReset = () => {
    const flatGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    setSelectedPresetName('原声 (Flat)')
    void applyPreset('eq10', '原声 (Flat)')
    void setParam('eq10', 'gains', flatGains)
    flatGains.forEach((g, idx) => {
      void setParam('eq10', `band${idx}`, g)
    })
  }

  const handleSaveCustomPreset = () => {
    const name = newPresetName.trim()
    if (!name) return
    const updated = [
      ...customPresets.filter((p) => p.name !== name),
      { name, gains: [...eqGains] },
    ]
    setCustomPresets(updated)
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(updated))
    } catch {
      // ignore
    }
    setSelectedPresetName(name)
    setIsSavingPreset(false)
    setNewPresetName('')
  }

  const handleDeleteCustomPreset = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = customPresets.filter((p) => p.name !== name)
    setCustomPresets(updated)
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(updated))
    } catch {
      // ignore
    }
    if (selectedPresetName === name) {
      setSelectedPresetName('手动')
    }
  }

  // Pointer drag calculations for interactive curve
  // SVG coordinate space: viewBox="0 0 1000 250"
  // Top: y = 24 (+12dB)
  // Center: y = 114 (0dB)
  // Bottom: y = 204 (-12dB)
  // Text: y = 238
  const xs = [60, 160, 260, 360, 460, 560, 660, 760, 860, 960]
  const points = eqGains.map((gain, i) => {
    const clamped = Math.max(-12, Math.min(12, gain))
    const y = 24 + ((12 - clamped) / 24) * 180
    return { x: xs[i]!, y }
  })

  const curveD = buildSplinePath(points)
  const areaD = `${curveD} L ${xs[xs.length - 1]} 204 L ${xs[0]} 204 Z`

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.preventDefault()
    setDraggingIdx(index)
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingIdx === null || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    const svgY = relY * 250
    const clampedSvgY = Math.max(24, Math.min(204, svgY))
    const gain = Math.round(12 - ((clampedSvgY - 24) / 180) * 24)
    handleBandChange(draggingIdx, gain)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingIdx !== null) {
      try {
        ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
      setDraggingIdx(null)
    }
  }

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return
    const current = chain[index]
    const prev = chain[index - 1]
    if (current && prev) {
      const targetOrdinal = prev.ordinal
      await setOrder(current.effectId, targetOrdinal)
      await setOrder(prev.effectId, targetOrdinal + 1)
    }
  }

  const handleMoveDown = async (index: number) => {
    if (index >= chain.length - 1) return
    const current = chain[index]
    const next = chain[index + 1]
    if (current && next) {
      const targetOrdinal = next.ordinal
      await setOrder(current.effectId, targetOrdinal)
      await setOrder(next.effectId, targetOrdinal - 1)
    }
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 32px',
        gap: 20,
        color: '#f5f5f7',
      },
    },
    // Top Bar with Navigation Tabs and Latency
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 16,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('h1', { style: { fontSize: 22, fontWeight: 700, margin: 0 } }, '音频效果器与均衡器 (DSP)'),
        h(
          'div',
          { style: { display: 'flex', gap: 6, marginLeft: 16 } },
          h(
            'button',
            {
              type: 'button',
              onClick: () => setActiveTab('eq'),
              style: {
                padding: '6px 14px',
                borderRadius: tokens.radius.sm,
                border: 'none',
                background: activeTab === 'eq' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                color: activeTab === 'eq' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              },
            },
            '🎚️ 10 频段均衡器 (EQ)',
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setActiveTab('chain'),
              style: {
                padding: '6px 14px',
                borderRadius: tokens.radius.sm,
                border: 'none',
                background: activeTab === 'chain' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                color: activeTab === 'chain' ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              },
            },
            '🔗 效果链编排 (Effect Chain)',
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '6px 12px',
            borderRadius: tokens.radius.sm,
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.7)',
          },
        },
        `处理延迟: ${latencyMs} ms`,
      ),
    ),

    // Tab 1: Equalizer Screen (Spotify Aesthetic)
    activeTab === 'eq' &&
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        // Top Header of Equalizer with Switch
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 4px',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(
              'span',
              {
                style: {
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#ffffff',
                  letterSpacing: 0.5,
                },
              },
              '均衡器',
            ),
            h(
              'span',
              {
                style: {
                  fontSize: 12,
                  color: isEqEnabled ? 'var(--color-primary, #5F87FF)' : 'var(--text-tertiary, #8E8E93)',
                  fontWeight: 500,
                  background: isEqEnabled ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'rgba(255, 255, 255, 0.06)',
                  padding: '2px 8px',
                  borderRadius: 10,
                  border: isEqEnabled ? '1px solid var(--color-primary, #5F87FF)' : '1px solid var(--border-subtle, rgba(145, 176, 255, 0.10))',
                },
              },
              isEqEnabled ? '已启用' : '未启用（仍可调整参数与保存）',
            ),
          ),
          h(Switch, {
            checked: isEqEnabled,
            accessibilityLabel: '启用 10 频段均衡器',
            onChange: (on) => void setEnabled('eq10', on),
          }),
        ),

        // Main Visualizer Card
        h(
          'div',
          {
            'data-testid': 'equalizer-card',
            style: {
              background: 'var(--surface-1, #0D101A)',
              borderRadius: 12,
              border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.08))',
              padding: '24px 28px 20px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-card, 0 8px 24px rgba(0, 0, 0, 0.5))',
              position: 'relative',
              opacity: 1,
              transition: 'opacity 0.2s ease',
            },
          },
          // Card Top Toolbar: 预设 dropdown & 保存预设
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                position: 'relative',
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { fontSize: 14, color: '#8E8E93', fontWeight: 500 } }, '预设'),
              // Dropdown Button
              h(
                'div',
                { style: { position: 'relative' } },
                h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': 'preset-dropdown-button',
                    onClick: () => setIsDropdownOpen((prev) => !prev),
                    style: {
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      borderRadius: 4,
                      outline: 'none',
                    },
                  },
                  displayPresetName,
                  h(
                    'span',
                    {
                      style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginLeft: 2,
                        transform: isDropdownOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                      },
                    },
                    tablerIcon('chevron-down', { size: 16 }),
                  ),
                ),
                // Dropdown Menu Popover
                isDropdownOpen &&
                  h(
                    'div',
                    {
                      'data-testid': 'preset-dropdown-menu',
                      style: {
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: 6,
                        background: 'var(--surface-2, #111522)',
                        borderRadius: 8,
                        boxShadow: 'var(--shadow-dropdown, 0 8px 32px rgba(0, 0, 0, 0.7))',
                        border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.1))',
                        zIndex: 100,
                        minWidth: 200,
                        maxHeight: 280,
                        overflowY: 'auto',
                        padding: '6px 0',
                      },
                    },
                    // Built-in presets
                    EQ_PRESETS.map((preset) => {
                      const isSelected = displayPresetName === preset.name
                      return h(
                        'button',
                        {
                          key: preset.name,
                          type: 'button',
                          onClick: () =>
                            handleSelectPreset({
                              name: preset.name,
                              gains: preset.params.gains,
                            }),
                          style: {
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 16px',
                            background: isSelected ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'transparent',
                            color: isSelected ? 'var(--color-primary, #5F87FF)' : 'var(--text-primary, #FFFFFF)',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: isSelected ? 600 : 400,
                          },
                        },
                        preset.name,
                      )
                    }),
                    // Custom presets divider & list
                    customPresets.length > 0 &&
                      h(
                        'div',
                        {
                          style: {
                            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
                            margin: '6px 0',
                            padding: '4px 16px 2px',
                            fontSize: 11,
                            color: 'var(--text-tertiary, #8E8E93)',
                          },
                        },
                        '自定义预设',
                      ),
                    customPresets.map((preset) => {
                      const isSelected = displayPresetName === preset.name
                      return h(
                        'div',
                        {
                          key: preset.name,
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 16px',
                            background: isSelected ? 'var(--surface-selected, rgba(99, 102, 241, 0.15))' : 'transparent',
                            cursor: 'pointer',
                          },
                          onClick: () => handleSelectPreset(preset),
                        },
                        h(
                          'span',
                          {
                            style: {
                              color: isSelected ? 'var(--color-primary, #5F87FF)' : 'var(--text-primary, #ffffff)',
                              fontSize: 13,
                              fontWeight: isSelected ? 600 : 400,
                            },
                          },
                          preset.name,
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            'aria-label': `删除 ${preset.name}`,
                            onClick: (e) => handleDeleteCustomPreset(preset.name, e),
                            style: {
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-tertiary, #8E8E93)',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: '2px 6px',
                            },
                          },
                          tablerIcon('x', { size: 16 }),
                        ),
                      )
                    }),
                  ),
              ),

              // Save Preset Button or Inline Input
              !isSavingPreset
                ? h(
                    'button',
                    {
                      type: 'button',
                      'data-testid': 'save-preset-button',
                      onClick: () => setIsSavingPreset(true),
                      style: {
                        background: 'none',
                        border: 'none',
                        color: '#A0A0AE',
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                        marginLeft: 16,
                        padding: '4px 6px',
                        outline: 'none',
                        transition: 'color 0.15s ease',
                      },
                      onMouseEnter: (e) => {
                        e.currentTarget.style.color = '#ffffff'
                      },
                      onMouseLeave: (e) => {
                        e.currentTarget.style.color = '#A0A0AE'
                      },
                    },
                    '保存预设',
                  )
                : h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16 } },
                    h('input', {
                      type: 'text',
                      'data-testid': 'custom-preset-input',
                      value: newPresetName,
                      placeholder: '预设名称...',
                      autoFocus: true,
                      onChange: (e) => setNewPresetName(e.target.value),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') handleSaveCustomPreset()
                        if (e.key === 'Escape') setIsSavingPreset(false)
                      },
                      style: {
                        background: 'var(--surface-2, #0B1124)',
                        border: '1px solid var(--color-primary, #5F87FF)',
                        borderRadius: 4,
                        color: 'var(--text-primary, #ffffff)',
                        padding: '4px 8px',
                        fontSize: 13,
                        outline: 'none',
                        width: 120,
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: handleSaveCustomPreset,
                        style: {
                          background: 'var(--button-primary-bg, var(--gradient-brand))',
                          border: 'none',
                          color: 'var(--button-primary-text, #ffffff)',
                          fontWeight: 600,
                          fontSize: 12,
                          borderRadius: 4,
                          padding: '4px 10px',
                          cursor: 'pointer',
                          boxShadow: 'var(--glow-brand-sm, 0 0 12px rgba(117, 152, 255, 0.18))',
                        },
                      },
                      '保存',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => setIsSavingPreset(false),
                        style: {
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-tertiary, #8E8E93)',
                          fontSize: 12,
                          padding: '4px 6px',
                          cursor: 'pointer',
                        },
                      },
                      '取消',
                    ),
                  ),
            ),
          ),

          // Interactive SVG Equalizer Canvas
          h(
            'div',
            {
              style: {
                position: 'relative',
                width: '100%',
                height: 250,
                userSelect: 'none',
                touchAction: 'none',
              },
            },
            h(
              'svg',
              {
                ref: svgRef,
                'data-testid': 'equalizer-svg-canvas',
                viewBox: '0 0 1000 250',
                preserveAspectRatio: 'none',
                onPointerMove: handlePointerMove,
                onPointerUp: handlePointerUp,
                style: {
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  cursor: 'crosshair',
                },
              },
              h(
                'defs',
                null,
                h(
                  'linearGradient',
                  { id: 'eqGradient', x1: '0', y1: '0', x2: '0', y2: '1' },
                  h('stop', { offset: '0%', stopColor: 'var(--electric-blue-500, #5F87FF)', stopOpacity: '0.45' }),
                  h('stop', { offset: '100%', stopColor: 'var(--lavender-500, #A99CFF)', stopOpacity: '0.0' }),
                ),
              ),

              // Y-axis labels on left
              h(
                'text',
                {
                  x: 10,
                  y: 28,
                  fill: 'rgba(255, 255, 255, 0.65)',
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                },
                '+12dB',
              ),
              h(
                'text',
                {
                  x: 10,
                  y: 208,
                  fill: 'rgba(255, 255, 255, 0.65)',
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                },
                '-12dB',
              ),

              // 0dB Center Reference Line
              h('line', {
                x1: 60,
                y1: 114,
                x2: 960,
                y2: 114,
                stroke: 'rgba(255, 255, 255, 0.1)',
                strokeWidth: 1,
              }),

              // 10 Vertical Guide Lines
              xs.map((x) =>
                h('line', {
                  key: x,
                  x1: x,
                  y1: 24,
                  x2: x,
                  y2: 204,
                  stroke: 'rgba(255, 255, 255, 0.08)',
                  strokeWidth: 1,
                }),
              ),

              // Gradient Fill Area underneath the curve
              h('path', {
                d: areaD,
                fill: 'url(#eqGradient)',
                opacity: isEqEnabled ? 1 : 0.65,
                pointerEvents: 'none',
              }),

              // Smooth Equalizer Curve
              h('path', {
                d: curveD,
                fill: 'none',
                stroke: 'var(--color-waveform, #6F9BFF)',
                opacity: isEqEnabled ? 1 : 0.85,
                strokeWidth: 3,
                strokeLinecap: 'round',
                pointerEvents: 'none',
              }),

              // Invisible interactive drag columns and visible knob handles
              points.map((pt, idx) => {
                const gain = eqGains[idx] ?? 0
                const isHovered = hoveredIdx === idx
                const isDragging = draggingIdx === idx

                return h(
                  'g',
                  { key: idx },
                  h('rect', {
                    x: pt.x - 20,
                    y: 24,
                    width: 40,
                    height: 180,
                    fill: 'transparent',
                    style: { cursor: 'pointer' },
                    onPointerDown: (e) => {
                      handlePointerDown(idx, e)
                      const rect = svgRef.current?.getBoundingClientRect()
                      if (rect) {
                        const relY = (e.clientY - rect.top) / rect.height
                        const svgY = relY * 250
                        const clamped = Math.max(24, Math.min(204, svgY))
                        const newG = Math.round(12 - ((clamped - 24) / 180) * 24)
                        handleBandChange(idx, newG)
                      }
                    },
                    onMouseEnter: () => setHoveredIdx(idx),
                    onMouseLeave: () => setHoveredIdx(null),
                  }),
                  h('circle', {
                    cx: pt.x,
                    cy: pt.y,
                    r: isDragging || isHovered ? 8 : 5.5,
                    fill: '#ffffff',
                    style: {
                      cursor: 'grab',
                      transition: 'r 0.1s ease',
                      filter:
                        isDragging || isHovered
                          ? 'drop-shadow(0 0 8px var(--electric-blue-500, #5F87FF))'
                          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                    },
                    onPointerDown: (e) => handlePointerDown(idx, e),
                    onMouseEnter: () => setHoveredIdx(idx),
                    onMouseLeave: () => setHoveredIdx(null),
                  }),
                  (isDragging || isHovered) &&
                    h(
                      'text',
                      {
                        x: pt.x,
                        y: Math.max(16, pt.y - 12),
                        textAnchor: 'middle',
                        fill: 'var(--color-primary, #5F87FF)',
                        fontSize: 12,
                        fontWeight: 700,
                        pointerEvents: 'none',
                      },
                      `${gain > 0 ? '+' : ''}${gain}dB`,
                    ),
                  h(
                    'text',
                    {
                      x: pt.x,
                      y: 238,
                      textAnchor: 'middle',
                      fill: isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.75)',
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      pointerEvents: 'none',
                    },
                    EQ_LABELS[idx],
                  ),
                )
              }),
            ),
          ),

          // Card Bottom Row: Reset Button
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 8,
              },
            },
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'reset-eq-button',
                onClick: handleReset,
                style: {
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'rgba(255, 255, 255, 0.3)',
                  borderRadius: 20,
                  padding: '6px 20px',
                  background: 'transparent',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                },
                onMouseEnter: (e) => {
                  e.currentTarget.style.borderColor = '#ffffff'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                  e.currentTarget.style.background = 'transparent'
                },
              },
              '重置',
            ),
          ),
        ),
      ),

    // Tab 2: Full Effect Chain List
    activeTab === 'chain' &&
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        chain.map((entry, index) => {
          const def = definitions.find((d) => d.id === entry.effectId)
          if (!def) return null
          const params = getParams(entry.effectId)

          return h(
            'div',
            {
              key: entry.effectId,
              style: {
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: tokens.radius.md,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: entry.enabled
                  ? '1px solid rgba(57, 211, 83, 0.3)'
                  : '1px solid rgba(255, 255, 255, 0.05)',
              },
            },
            // Card Header
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h(
                  'span',
                  {
                    style: {
                      fontSize: 12,
                      color: 'rgba(255, 255, 255, 0.4)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    },
                  },
                  `#${entry.ordinal}`,
                ),
                h('span', { style: { fontWeight: 600, fontSize: 15 } }, def.displayName),
                h(Switch, {
                  checked: entry.enabled,
                  accessibilityLabel: `启用 ${def.displayName}`,
                  onChange: (on) => void setEnabled(entry.effectId, on),
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                h(Button, {
                  disabled: index === 0,
                  onPress: () => void handleMoveUp(index),
                  children: '↑ 上移',
                }),
                h(Button, {
                  disabled: index === chain.length - 1,
                  onPress: () => void handleMoveDown(index),
                  children: '↓ 下移',
                }),
              ),
            ),

            // Effect-Specific Controls
            entry.effectId === 'preamp' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `增益: ${params.gainDb ?? 0} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Number(params.gainDb ?? 0) + 20,
                    max: 40,
                    accessibilityLabel: '前级增益',
                    onChange: (v) => void setParam('preamp', 'gainDb', Math.round(v - 20)),
                  }),
                ),
              ),

            entry.effectId === 'normalize' &&
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 10, width: '100%' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                  h('span', { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 80 } }, '均衡模式:'),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    [
                      { id: 'track', label: '单曲均衡 (Track)' },
                      { id: 'album', label: '专辑均衡 (Album)' },
                      { id: 'loudnorm', label: '动态 EBU R128' },
                      { id: 'manual', label: '手动' },
                    ].map((m) =>
                      h(Button, {
                        key: m.id,
                        variant: ((params.mode as string) ?? 'track') === m.id ? 'primary' : 'secondary',
                        onPress: () => void setParam('normalize', 'mode', m.id),
                        children: m.label,
                      }),
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                  h(
                    'span',
                    { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                    params.mode === 'loudnorm'
                      ? `目标: ${params.targetLufs ?? -14} LUFS`
                      : `当前增益: ${params.gainDb ?? 0} dB`,
                  ),
                  params.mode !== 'loudnorm' &&
                    h(
                      'div',
                      { style: { width: 220 } },
                      h(Slider, {
                        value: Number(params.gainDb ?? 0) + 12,
                        max: 24,
                        accessibilityLabel: '标准化增益',
                        onChange: (v) => void setParam('normalize', 'gainDb', Math.round(v - 12)),
                      }),
                    ),
                  def.presets &&
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6 } },
                      def.presets.map((preset) =>
                        h(Button, {
                          key: preset.name,
                          variant: 'secondary',
                          onPress: () => void applyPreset('normalize', preset.name),
                          children: preset.name.split(' ')[0] ?? preset.name,
                        }),
                      ),
                    ),
                ),
              ),

            entry.effectId === 'compressor' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `阈值: ${params.thresholdDb ?? -24} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Number(params.thresholdDb ?? -24) + 60,
                    max: 60,
                    accessibilityLabel: '压缩阈值',
                    onChange: (v) => void setParam('compressor', 'thresholdDb', Math.round(v - 60)),
                  }),
                ),
                def.presets &&
                  h(Button, {
                    onPress: () => void applyPreset('compressor', '夜间模式 (Night Mode)'),
                    children: '🌙 夜间模式',
                  }),
              ),

            entry.effectId === 'reverb' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `混响比例: ${Math.round((Number(params.mix ?? 0.25)) * 100)}%`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.mix ?? 0.25)) * 100),
                    max: 100,
                    accessibilityLabel: '混响比例',
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'widener' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `立体声宽度: ${Number(params.width ?? 1.2).toFixed(1)}x`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.width ?? 1.2)) * 50),
                    max: 100,
                    accessibilityLabel: '立体声宽度',
                    onChange: (v) => void setParam('widener', 'width', Math.round(v) / 50),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: 'rgba(255, 200, 50, 0.8)' } },
                  '⚠️ 过度展宽可能降低单声道兼容性',
                ),
              ),

            entry.effectId === 'crossfeed' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `馈入量: ${Math.round((Number(params.amount ?? 0.35)) * 100)}%`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round((Number(params.amount ?? 0.35)) * 100),
                    max: 100,
                    accessibilityLabel: '耳机交叉馈入量',
                    onChange: (v) => void setParam('crossfeed', 'amount', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'limiter' &&
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h(
                  'span',
                  { style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', width: 140 } },
                  `上限阈值: ${params.ceilingDb ?? -0.5} dB`,
                ),
                h(
                  'div',
                  { style: { width: 220 } },
                  h(Slider, {
                    value: Math.round(((Number(params.ceilingDb ?? -0.5)) + 12) * 8.33),
                    max: 100,
                    accessibilityLabel: '限制器上限',
                    onChange: (v) => void setParam('limiter', 'ceilingDb', -Math.round((100 - v) / 8.33 * 10) / 10),
                  }),
                ),
              ),
          )
        }),
      ),
  )
}
