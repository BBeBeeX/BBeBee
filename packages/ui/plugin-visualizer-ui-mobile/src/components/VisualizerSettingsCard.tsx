/**
 * VisualizerSettingsCard — the mobile settings card for the audio visualizer:
 * master switch, live preview, style and colour pickers, sensitivity.
 *
 * Same settings, same i18n keys, same defaults as the desktop
 * `VisualizerSettingsCard` — chips and Pressables instead of a grid of buttons.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'
import { nativePrimitives, Slider, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useVisualizer } from '@bbebee/plugin-visualizer/hooks'
import { VisualizerCanvas } from './VisualizerCanvas.js'

const p = () => palettes.dark

export interface VisualizerSettingsCardProps {
  ctx: Context
}

const STYLES: readonly VisualizerStyle[] = ['bars', 'wave', 'circle', 'particles']

/** i18n catalogue keys for the style option labels (`visualizer:` namespace). */
const STYLE_LABEL_KEYS: Record<VisualizerStyle, string> = {
  bars: 'visualizer:visualizerSettings.spectrumBars',
  wave: 'visualizer:visualizerSettings.smoothWave',
  circle: 'visualizer:visualizerSettings.radialCircle',
  particles: 'visualizer:visualizerSettings.pulsingParticles',
}

const THEMES: { id: VisualizerColorTheme; color: string }[] = [
  { id: 'accent', color: '#5F87FF' },
  { id: 'neon', color: '#00FF87' },
  { id: 'rainbow', color: '#FFB199' },
  { id: 'monochrome', color: '#8E8E93' },
]

/** i18n catalogue keys for the theme option labels (`visualizer:` namespace). */
const THEME_LABEL_KEYS: Record<VisualizerColorTheme, string> = {
  accent: 'visualizer:visualizerSettings.brandNeon',
  neon: 'visualizer:visualizerSettings.auroraTeal',
  rainbow: 'visualizer:visualizerSettings.iridescentRainbow',
  monochrome: 'visualizer:visualizerSettings.minimalSilver',
}

function Chip(props: {
  label: string
  selected: boolean
  swatch?: string
  onPress: () => void
  testID?: string
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      onPress: props.onPress,
      accessibilityRole: 'button',
      accessibilityLabel: props.label,
      accessibilityState: { selected: props.selected },
      testID: props.testID,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: tokens.radius.sm,
        borderWidth: 1,
        borderColor: props.selected ? p().accent.base : p().border.subtle,
        backgroundColor: props.selected ? p().accent.muted : 'transparent',
      },
    },
    props.swatch
      ? h(native.View as never, {
          style: {
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: props.swatch,
          },
        })
      : null,
    h(Text, { variant: 'sm', tone: props.selected ? 'accent' : 'muted' }, props.label),
  )
}

export function VisualizerSettingsCard({ ctx }: VisualizerSettingsCardProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const { settings, updateSettings } = useVisualizer(ctx)

  return h(
    native.View as never,
    {
      testID: 'visualizer-settings-card',
      style: {
        gap: tokens.space[3],
        padding: tokens.space[3],
        borderRadius: tokens.radius.md,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: p().border.subtle,
      },
    },
    // Header & master switch
    h(
      native.View as never,
      { style: { gap: 2 } },
      h(Text, { variant: 'md' }, t('visualizer:visualizerSettings.audioVisualizationTitle')),
      h(
        Text,
        { variant: 'xs', tone: 'muted' },
        t('visualizer:visualizerSettings.audioVisualizationDesc'),
      ),
    ),
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(Text, { variant: 'sm' }, t('visualizer:visualizerSettings.audioVisualizerRowTitle')),
      h(
        native.Pressable as never,
        {
          onPress: () => void updateSettings({ enabled: !settings.enabled }),
          accessibilityRole: 'switch',
          accessibilityState: { checked: settings.enabled },
          accessibilityLabel: t('visualizer:visualizerSettings.audioVisualizationTitle'),
          testID: 'visualizer-enabled-switch',
          style: {
            width: 48,
            height: 26,
            borderRadius: 13,
            backgroundColor: settings.enabled ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
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
            transform: [{ translateX: settings.enabled ? 22 : 0 }],
          },
        }),
      ),
    ),

    // Style & colour pickers, live preview, sensitivity — while enabled.
    settings.enabled
      ? h(
          native.View as never,
          { style: { gap: tokens.space[3] } },
          // Live preview — the canvas itself, pinned to the current style/theme.
          h(
            native.View as never,
            { style: { gap: 4 } },
            h(
              Text,
              { variant: 'xs', tone: 'muted' },
              t('visualizer:visualizerSettings.livePreview'),
            ),
            h(VisualizerCanvas, {
              ctx,
              height: 64,
              previewStyle: settings.style,
              previewTheme: settings.colorTheme,
            }),
          ),

          // Display style
          h(
            native.View as never,
            { style: { gap: 4 } },
            h(Text, { variant: 'sm' }, t('visualizer:visualizerSettings.displayStyle')),
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1] } },
              ...STYLES.map((style) =>
                h(Chip, {
                  key: style,
                  label: t(STYLE_LABEL_KEYS[style]),
                  selected: settings.style === style,
                  testID: `visualizer-style-${style}`,
                  onPress: () => void updateSettings({ style }),
                }),
              ),
            ),
          ),

          // Colour theme
          h(
            native.View as never,
            { style: { gap: 4 } },
            h(Text, { variant: 'sm' }, t('visualizer:visualizerSettings.colorTheme')),
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1] } },
              ...THEMES.map((theme) =>
                h(Chip, {
                  key: theme.id,
                  label: t(THEME_LABEL_KEYS[theme.id]),
                  selected: settings.colorTheme === theme.id,
                  swatch: theme.color,
                  testID: `visualizer-theme-${theme.id}`,
                  onPress: () => void updateSettings({ colorTheme: theme.id }),
                }),
              ),
            ),
          ),

          // Sensitivity — 0..200 slider mapped onto the 0.5..2.0 multiplier.
          h(
            native.View as never,
            { style: { gap: 4 } },
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
                Text,
                { variant: 'sm' },
                t('visualizer:visualizerSettings.amplitudeSensitivity'),
              ),
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                `${Math.round((settings.sensitivity ?? 1) * 100)}%`,
              ),
            ),
            h(Slider, {
              value: Math.round((settings.sensitivity ?? 1) * 100),
              max: 200,
              accessibilityLabel: t('visualizer:visualizerSettings.amplitudeSensitivity'),
              onChange: (val: number) => {
                const sensitivity = Math.max(0.5, Math.min(2.0, Math.round(val) / 100))
                void updateSettings({ sensitivity })
              },
            }),
          ),
        )
      : null,
  )
}
