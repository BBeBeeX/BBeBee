import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Button, Slider, useI18n } from '@BBeBee/ui-kit-desktop'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

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
        width: 42,
        height: 24,
        borderRadius: 12,
        padding: 2,
        background: checked ? 'var(--accent-base, #5F87FF)' : 'var(--switch-off-bg, rgba(255, 255, 255, 0.15))',
        border: checked ? '1px solid transparent' : '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        outline: 'none',
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#FFFFFF',
        transform: checked ? 'translateX(18px)' : 'translateX(0)',
        transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
      },
    }),
  )
}

function SectionWrapper({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}): ReactElement {
  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 32,
        scrollMarginTop: 24,
      },
    },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        title,
      ),
      description
        ? h(
            'p',
            {
              style: {
                fontSize: 12,
                color: '#8E8E93',
                margin: '3px 0 0',
                lineHeight: 1.4,
              },
            },
            description,
          )
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '2px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
        },
      },
      children,
    ),
  )
}

function RowWrapper({
  title,
  description,
  action,
  isNested = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  borderBottom = true,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  isNested?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  children?: React.ReactNode
  borderBottom?: boolean
}): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderBottom: borderBottom ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isNested ? '12px 16px 12px 28px' : '14px 4px',
          gap: 16,
          background: isNested ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
          borderLeft: isNested ? '2px solid rgba(255, 255, 255, 0.15)' : 'none',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
          },
        },
        expandable
          ? h(
              'button',
              {
                type: 'button',
                onClick: onToggleExpand,
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#8E8E93',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                },
              },
              '▶',
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--bb-text-primary, #FFFFFF)' } }, title),
          description
            ? h('span', { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.4 } }, description)
            : null,
        ),
      ),
      action ? h('div', { style: { flexShrink: 0 } }, action) : null,
    ),
    expandable && expanded && children ? children : null,
  )
}

export function DspSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const { chain, latencyMs, setEnabled, applyPreset, getParams, setParam } = useDsp(ctx)
  const [eqExpanded, setEqExpanded] = useState(true)
  const [compExpanded, setCompExpanded] = useState(true)
  const [reverbExpanded, setReverbExpanded] = useState(true)

  const eqEntry = chain.find((c) => c.effectId === 'eq10')
  const compEntry = chain.find((c) => c.effectId === 'compressor')
  const reverbEntry = chain.find((c) => c.effectId === 'reverb')

  const compParams = getParams('compressor')
  const reverbParams = getParams('reverb')

  return h(
    SectionWrapper,
    {
      title: t('dsp:dspSettings.audioEffectsEqualizerDSP'),
      description: t('dsp:dspSettings.tuningPanelForTheGraphic'),
    },
    // 1. EQ
    h(
      RowWrapper,
      {
        title: t('dsp:dspSettings.bandGraphicEqualizerBandEQ'),
        description: t('dsp:dspSettings.adjustTheGainOfEach'),
        expandable: eqEntry?.enabled ?? false,
        expanded: eqExpanded,
        onToggleExpand: () => setEqExpanded((prev) => !prev),
        action: h(Switch, {
          checked: eqEntry?.enabled ?? false,
          accessibilityLabel: t('dsp:dsp.enableTenBandEqualizer'),
          onChange: (checked) => void setEnabled('eq10', checked),
        }),
      },
      eqEntry?.enabled
        ? h(RowWrapper, {
            isNested: true,
            title: t('dsp:dspSettings.equalizerPresetStyles'),
            description: t('dsp:dspSettings.quicklySwitchBetweenFlatBass'),
            borderBottom: false,
            action: h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              [
                { id: 'Flat', label: t('dsp:dspSettings.flat') },
                { id: 'Bass Boost', label: t('dsp:dspSettings.bassBoost') },
                { id: 'Vocal', label: t('dsp:dspSettings.vocal') },
                { id: 'Treble', label: t('dsp:dspSettings.treble') },
              ].map((p) =>
                h(Button, {
                  key: p.id,
                  variant: 'secondary',
                  onPress: () => void applyPreset('eq10', p.id),
                  children: p.label,
                }),
              ),
            ),
          })
        : null,
    ),
    // 2. Compressor
    h(
      RowWrapper,
      {
        title: t('dsp:dspSettings.dynamicRangeCompressorCompressor'),
        description: t('dsp:dspSettings.tamesSuddenLoudPeaksLifts'),
        expandable: compEntry?.enabled ?? false,
        expanded: compExpanded,
        onToggleExpand: () => setCompExpanded((prev) => !prev),
        action: h(Switch, {
          checked: compEntry?.enabled ?? false,
          accessibilityLabel: t('dsp:dspSettings.enableDynamicCompressor'),
          onChange: (checked) => void setEnabled('compressor', checked),
        }),
      },
      compEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: t('dsp:dspSettings.compressionPresetStyles'),
              description: t('dsp:dspSettings.chooseACompressionCurveFor'),
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: 'Night Mode', label: t('dsp:dspSettings.nightMode') },
                  { id: 'Subtle', label: t('dsp:dspSettings.subtle') },
                  { id: 'Heavy', label: t('dsp:dspSettings.heavy') },
                ].map((p) =>
                  h(Button, {
                    key: p.id,
                    variant: 'secondary',
                    onPress: () => void applyPreset('compressor', p.id),
                    children: p.label,
                  }),
                ),
              ),
            }),
            h(RowWrapper, {
              isNested: true,
              title: t('dsp:dspSettings.compressorThresholdThreshold'),
              description: t('dsp:dspSettings.signalLevelCeilingDescription', {
                value: Number(compParams.threshold ?? -24),
              }),
              borderBottom: false,
              action: h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Number(compParams.threshold ?? -24) + 60,
                    max: 60,
                    accessibilityLabel: t('dsp:dsp.compressorThresholdLabel'),
                    onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  t('dsp:dsp.dbValue', { value: Number(compParams.threshold ?? -24) }),
                ),
              ),
            }),
          )
        : null,
    ),
    // 4. Reverb
    h(
      RowWrapper,
      {
        title: t('dsp:dspSettings.spatialReverbReverb'),
        description: t('dsp:dspSettings.synthesizesNaturalAcousticReflectionsAnd'),
        expandable: reverbEntry?.enabled ?? false,
        expanded: reverbExpanded,
        onToggleExpand: () => setReverbExpanded((prev) => !prev),
        action: h(Switch, {
          checked: reverbEntry?.enabled ?? false,
          accessibilityLabel: t('dsp:dspSettings.enableSpatialReverb'),
          onChange: (checked) => void setEnabled('reverb', checked),
        }),
      },
      reverbEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: t('dsp:dspSettings.reverbSpaceType'),
              description: t('dsp:dspSettings.switchBetweenImpulseResponseModels'),
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: 'Small Room', label: t('dsp:dspSettings.smallRoom') },
                  { id: 'Concert Hall', label: t('dsp:dspSettings.concertHall') },
                  { id: 'Plate', label: t('dsp:dspSettings.plate') },
                ].map((p) =>
                  h(Button, {
                    key: p.id,
                    variant: 'secondary',
                    onPress: () => void applyPreset('reverb', p.id),
                    children: p.label,
                  }),
                ),
              ),
            }),
            h(RowWrapper, {
              isNested: true,
              title: t('dsp:dspSettings.reverbWetDryMixMix'),
              description: t('dsp:dspSettings.wetLevelDescription', {
                value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
              }),
              borderBottom: false,
              action: h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h(Slider, {
                    value: Math.round(Number(reverbParams.mix ?? 0.25) * 100),
                    max: 100,
                    accessibilityLabel: t('dsp:dsp.reverbMixLabel'),
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  t('dsp:dsp.percentValue', { value: Math.round(Number(reverbParams.mix ?? 0.25) * 100) }),
                ),
              ),
            }),
          )
        : null,
    ),
    // 5. Open full DSP screen button
    h(RowWrapper, {
      title: t('dsp:dspSettings.advancedEffectTuningAndRouting'),
      description:
        chain.length === 1
          ? t('dsp:dspSettings.effectChainSummary.one', { count: chain.length, latency: latencyMs })
          : t('dsp:dspSettings.effectChainSummary.other', { count: chain.length, latency: latencyMs }),
      borderBottom: false,
      action: h(Button, {
        children: t('dsp:dspSettings.openAudioEffectsPanel'),
        onPress: () => {
          serviceOf<UiService>(ctx, 'ui')?.navigate?.('dsp.view')
        },
      }),
    }),
  )
}
