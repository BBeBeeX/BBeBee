import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import { Button, Slider, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

const p = () => palettes.dark

export function DspSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
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
    renderSectionHeader(t('dsp:dspSettings.audioEffectsEqualizerDSP'), t('dsp:dspSettings.mobileSettingsSubtitle')),
    renderCard([
      // 1. EQ
      renderRow(
        t('dsp:dspSettings.tenBandEqualizer'),
        t('dsp:dspSettings.adjustPerBandGain'),
        renderToggle(eqEntry?.enabled ?? false, () =>
          void setEnabled('eq10', !(eqEntry?.enabled ?? false)),
        ),
      ),
      eqEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: 'Flat', label: t('dsp:dspSettings.flat') },
              { id: 'Bass Boost', label: t('dsp:dspSettings.bass') },
              { id: 'Vocal', label: t('dsp:dspSettings.vocal') },
              { id: 'Treble', label: t('dsp:dspSettings.treble') },
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
        t('dsp:dspSettings.dynamicCompressor'),
        t('dsp:dspSettings.tamesLoudPeaks'),
        renderToggle(compEntry?.enabled ?? false, () =>
          void setEnabled('compressor', !(compEntry?.enabled ?? false)),
        ),
      ),
      compEntry?.enabled
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1], paddingVertical: 2 } },
            [
              { id: 'Night Mode', label: t('dsp:dspSettings.nightMode2') },
              { id: 'Subtle', label: t('dsp:dspSettings.subtle') },
              { id: 'Heavy', label: t('dsp:dspSettings.heavy') },
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
        t('dsp:dspSettings.spatialReverbReverb'),
        t('dsp:dspSettings.synthesizesNaturalSpatialReflections'),
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
                { id: 'Small Room', label: t('dsp:dspSettings.smallRoom') },
                { id: 'Concert Hall', label: t('dsp:dspSettings.concertHall') },
                { id: 'Plate', label: t('dsp:dspSettings.plate') },
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
              children: t('dsp:dsp.reverbMixReadout', {
                value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
              }),
            }),
            h(Slider, {
              value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
              max: 100,
              accessibilityLabel: t('dsp:dsp.reverbMixLabel'),
              onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
            }),
          )
        : null,

      // 5. Advanced Panel Link
      renderRow(
        t('dsp:dspSettings.advancedEffectTuningAndRouting'),
        chain.length === 1
          ? t('dsp:dspSettings.nodesLatency.one', { count: chain.length, latency: latencyMs })
          : t('dsp:dspSettings.nodesLatency.other', { count: chain.length, latency: latencyMs }),
        h(Button, {
          children: t('dsp:dspSettings.effectsPanel'),
          onPress: () => {
            ctx.ui?.navigate?.('dsp.view')
          },
        }),
      ),
    ]),
  )
}
