/**
 * Mobile React Native DSP Chain Editor Screen for `@BBeBee/plugin-dsp`.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'
import { EQ10_BANDS } from '@BBeBee/plugin-dsp/effects'

export interface DspScreenProps {
  ctx: Context
}

const p = () => palettes.dark

export function DspScreen({ ctx }: DspScreenProps): ReactElement {
  const native = nativePrimitives()
  const { chain, definitions, latencyMs, setEnabled, setOrder, setParam, applyPreset, getParams } =
    useDsp(ctx)

  const [activeTab, setActiveTab] = useState<'eq' | 'chain'>('eq')

  const eqDef = definitions.find((d) => d.id === 'eq10')
  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const eqParams = getParams('eq10')
  const eqGains = (Array.isArray(eqParams.gains) ? eqParams.gains : EQ10_BANDS.map(() => 0)) as number[]

  const handleBandChange = (index: number, dbVal: number) => {
    const next = [...eqGains]
    next[index] = Math.round(dbVal)
    void setParam('eq10', `band${index}`, next[index]!)
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

  const renderToggle = (checked: boolean, onToggle: () => void) =>
    h(
      native.Pressable as never,
      {
        onPress: onToggle,
        style: {
          width: 48,
          height: 26,
          borderRadius: 13,
          backgroundColor: checked ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
          justifyContent: 'center',
          padding: 2,
        },
      },
      h(native.View as never, {
        style: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#ffffff',
          transform: [{ translateX: checked ? 22 : 0 }],
        },
      }),
    )

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: p().bg.base,
        padding: tokens.space[4],
        gap: tokens.space[4],
      },
    },
    // Header
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255, 255, 255, 0.08)',
          paddingBottom: tokens.space[3],
        },
      },
      h(
        native.View as never,
        null,
        h(Text, { variant: 'lg', children: 'Audio effects & equalizer (DSP)' }),
        h(Text, { variant: 'xs', tone: 'muted', children: 'Live effect chain and 10-band graphic equalizer' }),
      ),
      h(
        native.View as never,
        {
          style: {
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            paddingVertical: 4,
            paddingHorizontal: 8,
            borderRadius: tokens.radius.sm,
          },
        },
        h(Text, { variant: 'xs', children: `Latency: ${latencyMs}ms` }),
      ),
    ),

    // Tab Switcher
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      h(
        native.Pressable as never,
        {
          onPress: () => setActiveTab('eq'),
          style: {
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: tokens.radius.sm,
            backgroundColor: activeTab === 'eq' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
          },
        },
        h(Text, { variant: 'sm', tone: activeTab === 'eq' ? 'accent' : 'muted', children: '🎚️ 10-Band EQ' }),
      ),
      h(
        native.Pressable as never,
        {
          onPress: () => setActiveTab('chain'),
          style: {
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: tokens.radius.sm,
            backgroundColor: activeTab === 'chain' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
          },
        },
        h(Text, { variant: 'sm', tone: activeTab === 'chain' ? 'accent' : 'muted', children: '🔗 Effect chain' }),
      ),
    ),

    // Tab 1: EQ
    activeTab === 'eq' &&
      h(
        native.View as never,
        {
          style: {
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderRadius: tokens.radius.md,
            padding: tokens.space[3],
            gap: tokens.space[3],
          },
        },
        h(
          native.View as never,
          {
            style: {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
          },
          h(Text, { variant: 'md', children: 'Enable equalizer' }),
          renderToggle(eqEntry?.enabled ?? false, () => {
            void setEnabled('eq10', !(eqEntry?.enabled ?? false))
          }),
        ),

        // Presets Chips
        eqDef?.presets &&
          h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2], paddingVertical: 4 } },
            eqDef.presets.map((preset) =>
              h(
                native.Pressable as never,
                {
                  key: preset.name,
                  onPress: () => void applyPreset('eq10', preset.name),
                  style: {
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: tokens.radius.sm,
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  },
                },
                h(Text, { variant: 'xs', children: preset.name }),
              ),
            ),
          ),

        // EQ Bands list (vertical list on mobile for better touch control)
        h(
          native.View as never,
          { style: { gap: tokens.space[2], marginTop: 8 } },
          EQ10_BANDS.map((freq, idx) => {
            const gain = eqGains[idx] ?? 0
            const label = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`
            return h(
              native.View as never,
              {
                key: freq,
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: tokens.space[2],
                },
              },
              h(
                native.View as never,
                { style: { width: 70 } },
                h(Text, { variant: 'xs', children: label }),
              ),
              h(
                native.View as never,
                { style: { flex: 1 } },
                h(Slider, {
                  value: gain + 12,
                  max: 24,
                  accessibilityLabel: `${label} gain`,
                  onChange: (v) => handleBandChange(idx, v - 12),
                }),
              ),
              h(
                native.View as never,
                { style: { width: 45, alignItems: 'flex-end' } },
                h(Text, {
                  variant: 'xs',
                  tone: gain !== 0 ? 'accent' : 'muted',
                  children: `${gain > 0 ? '+' : ''}${gain}dB`,
                }),
              ),
            )
          }),
        ),
      ),

    // Tab 2: Chain
    activeTab === 'chain' &&
      h(
        native.View as never,
        { style: { gap: tokens.space[3] } },
        chain.map((entry, index) => {
          const def = definitions.find((d) => d.id === entry.effectId)
          if (!def) return null
          const params = getParams(entry.effectId)

          return h(
            native.View as never,
            {
              key: entry.effectId,
              style: {
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                borderRadius: tokens.radius.md,
                padding: tokens.space[3],
                gap: tokens.space[2],
                borderWidth: 1,
                borderColor: entry.enabled ? 'rgba(57, 211, 83, 0.3)' : 'rgba(255, 255, 255, 0.06)',
              },
            },
            // Card Header
            h(
              native.View as never,
              {
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                },
              },
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
                renderToggle(entry.enabled, () => {
                  void setEnabled(entry.effectId, !entry.enabled)
                }),
                h(Text, { variant: 'sm', children: def.displayName }),
              ),
              h(
                native.View as never,
                { style: { flexDirection: 'row', gap: 6 } },
                h(Button, {
                  disabled: index === 0,
                  onPress: () => void handleMoveUp(index),
                  children: '↑',
                }),
                h(Button, {
                  disabled: index === chain.length - 1,
                  onPress: () => void handleMoveDown(index),
                  children: '↓',
                }),
              ),
            ),

            // Controls
            entry.effectId === 'preamp' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Gain: ${params.gainDb ?? 0}dB` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: (Number(params.gainDb ?? 0)) + 20,
                    max: 40,
                    accessibilityLabel: 'Preamp gain',
                    onChange: (v) => void setParam('preamp', 'gainDb', Math.round(v - 20)),
                  }),
                ),
              ),

            entry.effectId === 'normalize' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Gain: ${params.gainDb ?? 0}dB` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: (Number(params.gainDb ?? 0)) + 12,
                    max: 24,
                    accessibilityLabel: 'Normalization gain',
                    onChange: (v) => void setParam('normalize', 'gainDb', Math.round(v - 12)),
                  }),
                ),
                def.presets &&
                  h(
                    native.View as never,
                    { style: { flexDirection: 'row', gap: 4 } },
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

            entry.effectId === 'compressor' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Threshold: ${params.threshold ?? -24}dB` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: (Number(params.threshold ?? -24)) + 60,
                    max: 60,
                    accessibilityLabel: 'Compressor threshold',
                    onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                  }),
                ),
                def.presets &&
                  h(Button, {
                    onPress: () => void applyPreset('compressor', 'Night Mode'),
                    children: 'Night',
                  }),
              ),

            entry.effectId === 'reverb' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Reverb: ${Math.round((Number(params.mix ?? 0.25)) * 100)}%` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round((Number(params.mix ?? 0.25)) * 100),
                    max: 100,
                    accessibilityLabel: 'Reverb mix',
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'widener' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Width: ${Number(params.width ?? 1.2).toFixed(1)}x` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round((Number(params.width ?? 1.2)) * 50),
                    max: 100,
                    accessibilityLabel: 'Stereo width',
                    onChange: (v) => void setParam('widener', 'width', Math.round(v) / 50),
                  }),
                ),
              ),

            entry.effectId === 'crossfeed' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Crossfeed: ${Math.round((Number(params.amount ?? 0.35)) * 100)}%` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round((Number(params.amount ?? 0.35)) * 100),
                    max: 100,
                    accessibilityLabel: 'Crossfeed amount',
                    onChange: (v) => void setParam('crossfeed', 'amount', Math.round(v) / 100),
                  }),
                ),
              ),

            entry.effectId === 'limiter' &&
              h(
                native.View as never,
                { style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
                h(Text, { variant: 'xs', children: `Ceiling: ${params.ceilingDb ?? -0.5}dB` }),
                h(
                  native.View as never,
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round(((Number(params.ceilingDb ?? -0.5)) + 12) * 8.33),
                    max: 100,
                    accessibilityLabel: 'Limiter ceiling',
                    onChange: (v) => void setParam('limiter', 'ceilingDb', -Math.round((100 - v) / 8.33 * 10) / 10),
                  }),
                ),
              ),
          )
        }),
      ),
  )
}
