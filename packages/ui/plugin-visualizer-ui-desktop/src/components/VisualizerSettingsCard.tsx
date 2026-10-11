/**
 * VisualizerSettingsCard — Settings section for configuring audio visualizer.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'
import { useVisualizer } from '@BBeBee/plugin-visualizer/hooks'
import { Slider, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { VisualizerCanvas } from './VisualizerCanvas.js'

export interface VisualizerSettingsCardProps {
  ctx: Context
}

const STYLES: { id: VisualizerStyle; label: string; icon: string; desc: string }[] = [
  { id: 'bars', label: 'Spectrum bars', icon: 'chart-bar', desc: 'Classic multi-band jumping spectrum bars' },
  { id: 'wave', label: 'Smooth wave', icon: 'wave-sine', desc: 'A soft, flowing oscilloscope curve' },
  { id: 'circle', label: 'Radial circle', icon: 'circle-dot', desc: 'A 360-degree dynamic halo radiating from the center' },
  { id: 'particles', label: 'Pulsing particles', icon: 'sparkles', desc: 'A swarm of particles floating with the volume pulse' },
]

const THEMES: { id: VisualizerColorTheme; label: string; color: string }[] = [
  { id: 'accent', label: 'Brand neon', color: 'linear-gradient(135deg, #5F87FF, #A99CFF)' },
  { id: 'neon', label: 'Aurora teal', color: 'linear-gradient(135deg, #00FF87, #60EFFF)' },
  { id: 'rainbow', label: 'Iridescent rainbow', color: 'linear-gradient(135deg, #FF0844, #FFB199, #FEE140, #38F9D7)' },
  { id: 'monochrome', label: 'Minimal silver', color: 'linear-gradient(135deg, #FFFFFF, #8E8E93)' },
]

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
        background: checked ? 'var(--color-primary, #5F87FF)' : 'var(--switch-off-bg, rgba(255, 255, 255, 0.15))',
        boxShadow: checked ? 'var(--glow-brand-sm, 0 0 10px rgba(95, 135, 255, 0.35))' : 'none',
        border: checked ? '1px solid transparent' : '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        transition: 'background-color 0.2s, box-shadow 0.2s',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#ffffff',
        transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        transition: 'transform 0.2s',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      },
    }),
  )
}

export function VisualizerSettingsCard({ ctx }: VisualizerSettingsCardProps): ReactElement {
  const { settings, updateSettings } = useVisualizer(ctx)

  return h(
    'section',
    {
      'data-testid': 'visualizer-settings-card',
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 32,
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
        'Audio visualization',
      ),
      h(
        'p',
        {
          style: {
            fontSize: 12,
            color: 'var(--text-secondary, #8E8E93)',
            margin: '3px 0 0',
            lineHeight: 1.4,
          },
        },
        'Shows music-frequency and sound-wave animations in the playback UI, with custom display styles and colors',
      ),
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
          padding: '16px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
          gap: 16,
        },
      },
    // Header & Master Switch Row
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 0 16px',
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h(Text, { variant: 'sm', children: 'Audio Visualizer' }),
        h(Text, {
          variant: 'xs',
          tone: 'muted',
          children: 'Once enabled, shows a live spectrum or waveform in the full-screen playback UI',
        }),
      ),
      h(Switch, {
        checked: settings.enabled,
        accessibilityLabel: 'Audio visualization',
        onChange: (checked) => {
          void updateSettings({ enabled: checked })
        },
      }),
    ),

    settings.enabled
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
          // Live Preview Area
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 16,
                borderRadius: 8,
                background: 'var(--color-bg-tertiary, rgba(0, 0, 0, 0.35))',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                alignItems: 'center',
              },
            },
            h(
              'div',
              {
                style: {
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                },
              },
              h(Text, { variant: 'xs', tone: 'muted', children: 'Live preview' }),
              h(Text, {
                variant: 'xs',
                tone: 'muted',
                children: STYLES.find((s) => s.id === settings.style)?.label ?? '',
              }),
            ),
            h(VisualizerCanvas, {
              ctx,
              height: 64,
              previewStyle: settings.style,
              previewTheme: settings.colorTheme,
            }),
          ),

          // Style Selection
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(Text, { variant: 'sm', children: 'Display style' }),
            h(
              'div',
              {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                },
              },
              STYLES.map((st) => {
                const isSelected = settings.style === st.id
                return h(
                  'button',
                  {
                    key: st.id,
                    type: 'button',
                    onClick: () => void updateSettings({ style: st.id }),
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: isSelected
                        ? '1px solid var(--color-primary, #5F87FF)'
                        : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                        : 'var(--color-surface, rgba(255, 255, 255, 0.03))',
                      color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      gap: 4,
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                    tablerIcon(st.icon as 'chart-bar' | 'wave-sine', { size: 16 }),
                    h(Text, {
                      variant: isSelected ? 'md' : 'sm',
                      children: st.label,
                    }),
                  ),
                  h(Text, { variant: 'xs', tone: 'muted', children: st.desc }),
                )
              }),
            ),
          ),

          // Color Theme Selection
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(Text, { variant: 'sm', children: 'Color theme' }),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                },
              },
              THEMES.map((theme) => {
                const isSelected = settings.colorTheme === theme.id
                return h(
                  'button',
                  {
                    key: theme.id,
                    type: 'button',
                    onClick: () => void updateSettings({ colorTheme: theme.id }),
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: isSelected
                        ? '1px solid var(--color-primary, #5F87FF)'
                        : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                        : 'var(--color-surface, rgba(255, 255, 255, 0.03))',
                      color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
                      cursor: 'pointer',
                    },
                  },
                  h('div', {
                    style: {
                      width: 14,
                      height: 14,
                      borderRadius: tokens.radius.pill,
                      background: theme.color,
                    },
                  }),
                  h(Text, { variant: 'sm', children: theme.label }),
                )
              }),
            ),
          ),

          // Sensitivity Slider
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              h(Text, { variant: 'sm', children: 'Amplitude sensitivity' }),
              h(Text, {
                variant: 'xs',
                tone: 'muted',
                children: `${Math.round((settings.sensitivity ?? 1) * 100)}%`,
              }),
            ),
            h(Slider, {
              value: Math.round((settings.sensitivity ?? 1) * 100),
              max: 200,
              accessibilityLabel: 'Amplitude sensitivity',
              onChange: (val) => {
                const sensitivity = Math.max(0.5, Math.min(2.0, Math.round(val) / 100))
                void updateSettings({ sensitivity })
              },
            }),
          ),
        )
      : null,
    ),
  )
}
