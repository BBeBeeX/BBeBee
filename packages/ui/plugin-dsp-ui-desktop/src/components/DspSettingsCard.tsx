import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Button, Slider } from '@BBeBee/ui-kit-desktop'
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
      title: 'Audio effects & equalizer (DSP)',
      description: 'Tuning panel for the graphic equalizer, dynamic compression and spatial reverb',
    },
    // 1. EQ
    h(
      RowWrapper,
      {
        title: '10-Band graphic equalizer (10-Band EQ)',
        description: 'Adjust the gain of each band to shape a sound curve better suited to headphones or speakers',
        expandable: eqEntry?.enabled ?? false,
        expanded: eqExpanded,
        onToggleExpand: () => setEqExpanded((prev) => !prev),
        action: h(Switch, {
          checked: eqEntry?.enabled ?? false,
          accessibilityLabel: 'Enable 10-band equalizer',
          onChange: (checked) => void setEnabled('eq10', checked),
        }),
      },
      eqEntry?.enabled
        ? h(RowWrapper, {
            isNested: true,
            title: 'Equalizer preset styles',
            description: 'Quickly switch between Flat, Bass Boost, Vocal and other tuning styles',
            borderBottom: false,
            action: h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              [
                { id: 'Flat', label: 'Flat' },
                { id: 'Bass Boost', label: 'Bass Boost' },
                { id: 'Vocal', label: 'Vocal' },
                { id: 'Treble', label: 'Treble' },
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
        title: 'Dynamic range compressor (Compressor)',
        description: 'Tames sudden loud peaks, lifts quiet details and smooths the dynamic range',
        expandable: compEntry?.enabled ?? false,
        expanded: compExpanded,
        onToggleExpand: () => setCompExpanded((prev) => !prev),
        action: h(Switch, {
          checked: compEntry?.enabled ?? false,
          accessibilityLabel: 'Enable dynamic compressor',
          onChange: (checked) => void setEnabled('compressor', checked),
        }),
      },
      compEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: 'Compression preset styles',
              description: 'Choose a compression curve for quiet night listening or strong dynamics',
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: 'Night Mode', label: '🌙 Night Mode' },
                  { id: 'Subtle', label: 'Subtle' },
                  { id: 'Heavy', label: 'Heavy' },
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
              title: 'Compressor threshold (Threshold)',
              description: `Signal level ceiling that triggers compression: ${compParams.threshold ?? -24} dB`,
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
                    accessibilityLabel: 'Compressor threshold',
                    onChange: (v) => void setParam('compressor', 'threshold', Math.round(v - 60)),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  `${compParams.threshold ?? -24}dB`,
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
        title: 'Spatial reverb (Reverb)',
        description: 'Synthesizes natural acoustic reflections and reverb tails for an immersive sense of space',
        expandable: reverbEntry?.enabled ?? false,
        expanded: reverbExpanded,
        onToggleExpand: () => setReverbExpanded((prev) => !prev),
        action: h(Switch, {
          checked: reverbEntry?.enabled ?? false,
          accessibilityLabel: 'Enable spatial reverb',
          onChange: (checked) => void setEnabled('reverb', checked),
        }),
      },
      reverbEntry?.enabled
        ? h(
            'div',
            null,
            h(RowWrapper, {
              isNested: true,
              title: 'Reverb space type',
              description: 'Switch between impulse response models of different acoustic spaces',
              action: h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [
                  { id: 'Small Room', label: 'Small Room' },
                  { id: 'Concert Hall', label: 'Concert Hall' },
                  { id: 'Plate', label: 'Plate' },
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
              title: 'Reverb wet-dry mix (Mix)',
              description: `Wet level: ${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
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
                    accessibilityLabel: 'Reverb mix',
                    onChange: (v) => void setParam('reverb', 'mix', Math.round(v) / 100),
                  }),
                ),
                h(
                  'span',
                  { style: { fontSize: 12, color: '#8E8E93', width: 34, textAlign: 'right' } },
                  `${Math.round(Number(reverbParams.mix ?? 0.25) * 100)}%`,
                ),
              ),
            }),
          )
        : null,
    ),
    // 5. Open full DSP screen button
    h(RowWrapper, {
      title: 'Advanced effect tuning and routing',
      description: `The current effect chain contains ${chain.length} processing nodes, latency: ${latencyMs}ms`,
      borderBottom: false,
      action: h(Button, {
        children: 'Open audio effects panel →',
        onPress: () => {
          serviceOf<UiService>(ctx, 'ui')?.navigate?.('dsp.view')
        },
      }),
    }),
  )
}
