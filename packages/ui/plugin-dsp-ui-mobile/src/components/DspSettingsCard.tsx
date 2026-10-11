import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import { Button, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

const p = () => palettes.dark

export function DspSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')
  const reverbParams = getParams('reverb')

  const renderSectionHeader = (title: string, subtitle?: string) =>
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
      h(Text, { variant: 'sm', tone: 'accent', children: title }),
      subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
    )

  const renderCard = (children: ReactNode[]) =>
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
      ...children,
    )

  const renderRow = (title: string, description: string | undefined, control: ReactNode) =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[3],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'md', children: title }),
        description ? h(Text, { variant: 'xs', tone: 'muted', children: description }) : null,
      ),
      control,
    )

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
    null,
    renderSectionHeader('Audio effects & equalizer (DSP)', 'Graphic EQ, loudness normalization, dynamic compression and spatial reverb'),
    renderCard([
      // 1. EQ
      renderRow(
        '10-Band equalizer (EQ)',
        'Adjust per-band gain to shape the sound',
        renderToggle(eqEntry?.enabled ?? false, () =>
          void setEnabled('eq10', !(eqEntry?.enabled ?? false)),
        ),
      ),
      eqEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: 'Flat', label: 'Flat' },
              { id: 'Bass Boost', label: 'Bass' },
              { id: 'Vocal', label: 'Vocal' },
              { id: 'Treble', label: 'Treble' },
            ].map((preset) =>
              h(Button, {
                key: preset.id,
                variant: 'secondary',
                onPress: () => void applyPreset('eq10', preset.id),
                children: preset.label,
              }),
            ),
          )
        : null,

      // 2. Compressor
      renderRow(
        'Dynamic compressor (Compressor)',
        'Tames loud peaks and lifts quiet details',
        renderToggle(compEntry?.enabled ?? false, () =>
          void setEnabled('compressor', !(compEntry?.enabled ?? false)),
        ),
      ),
      compEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: 'Night Mode', label: 'Night Mode' },
              { id: 'Subtle', label: 'Subtle' },
              { id: 'Heavy', label: 'Heavy' },
            ].map((preset) =>
              h(Button, {
                key: preset.id,
                variant: 'secondary',
                onPress: () => void applyPreset('compressor', preset.id),
                children: preset.label,
              }),
            ),
          )
        : null,

      // 4. Reverb
      renderRow(
        'Spatial reverb (Reverb)',
        'Synthesizes natural spatial reflections and reverb tails',
        renderToggle(reverbEntry?.enabled ?? false, () =>
          void setEnabled('reverb', !(reverbEntry?.enabled ?? false)),
        ),
      ),
      reverbEntry?.enabled
        ? h(
            native.View as never,
            { style: { gap: tokens.space[1] } },
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
              [
                { id: 'Small Room', label: 'Small Room' },
                { id: 'Concert Hall', label: 'Concert Hall' },
                { id: 'Plate', label: 'Plate' },
              ].map((preset) =>
                h(Button, {
                  key: preset.id,
                  variant: 'secondary',
                  onPress: () => void applyPreset('reverb', preset.id),
                  children: preset.label,
                }),
              ),
            ),
            h(Text, {
              variant: 'xs',
              tone: 'muted',
              children: `Reverb mix: ${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
            }),
            h(Slider, {
              value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
              max: 100,
              accessibilityLabel: 'Reverb mix',
              onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
            }),
          )
        : null,

      // 5. Advanced Panel Link
      renderRow(
        'Advanced effect tuning and routing',
        `Nodes: ${chain.length} · Latency: ${latencyMs}ms`,
        h(Button, {
          children: 'Effects panel',
          onPress: () => {
            ctx.ui?.navigate?.('dsp.view')
          },
        }),
      ),
    ]),
  )
}
