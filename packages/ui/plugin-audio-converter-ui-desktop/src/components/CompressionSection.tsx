/**
 * Audio compression presets, detailed encoding parameters, and real-time size estimation.
 */

import { createElement as h, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  AudioConvertOptions,
  AudioFormat,
  CompressionEstimate,
  CompressionPreset,
} from '@BBeBee/protocol'
import { Select, Switch, Text, TextField, useI18n, type SelectOption } from '@BBeBee/ui-kit-desktop'
import { formatBytes } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { isLosslessFormat } from '@bbebee/plugin-audio-converter'

export interface CompressionSectionProps {
  ctx: Context
  targetFormat: AudioFormat
  options: AudioConvertOptions
  onOptionsChange: (opts: AudioConvertOptions) => void
  estimate?: CompressionEstimate
  sourceSize?: number
}

const BITRATE_OPTIONS: readonly SelectOption<string>[] = [
  { value: '64', label: '64 kbps' },
  { value: '96', label: '96 kbps' },
  { value: '128', label: '128 kbps' },
  { value: '192', label: '192 kbps' },
  { value: '256', label: '256 kbps' },
  { value: '320', label: '320 kbps' },
]

const SAMPLE_RATE_OPTIONS: readonly SelectOption<string>[] = [
  { value: '22050', label: '22,050 Hz' },
  { value: '44100', label: '44,100 Hz (CD)' },
  { value: '48000', label: '48,000 Hz (Pro/Video)' },
]

const CHANNEL_OPTIONS: readonly SelectOption<string>[] = [
  { value: '1', label: 'Mono (1 Channel)' },
  { value: '2', label: 'Stereo (2 Channels)' },
]

const BIT_DEPTH_OPTIONS: readonly SelectOption<string>[] = [
  { value: '16', label: '16-bit' },
  { value: '24', label: '24-bit (Hi-Res)' },
  { value: '32', label: '32-bit' },
]

export function CompressionSection({
  ctx,
  targetFormat,
  options,
  onOptionsChange,
  estimate,
  sourceSize: _sourceSize = 0,
}: CompressionSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const isLossless = isLosslessFormat(targetFormat)

  const presetOptions = useMemo<readonly SelectOption<CompressionPreset>[]>(
    () => [
      { value: 'high_quality', label: t('converter:index.presetHighQuality') },
      { value: 'balanced', label: t('converter:index.presetBalanced') },
      { value: 'small_size', label: t('converter:index.presetSmallSize') },
      { value: 'speech', label: t('converter:index.presetSpeech') },
      { value: 'custom', label: t('converter:index.presetCustom') },
    ],
    [t],
  )

  const handlePresetChange = (preset: CompressionPreset) => {
    if (preset === 'custom') {
      onOptionsChange({ ...options, preset: 'custom' })
      return
    }

    if (preset === 'high_quality') {
      onOptionsChange({
        ...options,
        preset,
        bitrateKbps: isLossless ? undefined : 320,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 24,
        vbr: false,
      })
    } else if (preset === 'balanced') {
      onOptionsChange({
        ...options,
        preset,
        bitrateKbps: isLossless ? undefined : 192,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        vbr: true,
      })
    } else if (preset === 'small_size') {
      onOptionsChange({
        ...options,
        preset,
        bitrateKbps: isLossless ? undefined : 128,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        vbr: true,
      })
    } else if (preset === 'speech') {
      onOptionsChange({
        ...options,
        preset,
        bitrateKbps: isLossless ? undefined : 64,
        sampleRate: 22050,
        channels: 1,
        bitDepth: 16,
        vbr: true,
      })
    }
  }

  return h(
    'section',
    {
      'data-testid': 'converter-compression-section',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[4],
        padding: tokens.space[4],
        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
        borderRadius: tokens.radius.md,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    // Header & Preset Select
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h(Text, { variant: 'md' }, t('converter:index.preset')),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(Select<CompressionPreset>, {
          value: options.preset ?? 'balanced',
          options: presetOptions,
          onChange: handlePresetChange,
          accessibilityLabel: t('converter:index.preset'),
        }),
      ),
    ),

    // Parameter Grid
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: tokens.space[3],
        },
      },
      // Bitrate (disabled if lossless)
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            opacity: isLossless ? 0.4 : 1,
          },
        },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.bitrate')),
        h(Select<string>, {
          value: String(options.bitrateKbps ?? 192),
          options: BITRATE_OPTIONS,
          disabled: isLossless,
          onChange: (val) =>
            onOptionsChange({ ...options, bitrateKbps: parseInt(val, 10), preset: 'custom' }),
          accessibilityLabel: t('converter:index.bitrate'),
        }),
      ),
      // Sample Rate
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.sampleRate')),
        h(Select<string>, {
          value: String(options.sampleRate ?? 44100),
          options: SAMPLE_RATE_OPTIONS,
          onChange: (val) =>
            onOptionsChange({ ...options, sampleRate: parseInt(val, 10), preset: 'custom' }),
          accessibilityLabel: t('converter:index.sampleRate'),
        }),
      ),
      // Channels
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.channels')),
        h(Select<string>, {
          value: String(options.channels ?? 2),
          options: CHANNEL_OPTIONS,
          onChange: (val) =>
            onOptionsChange({
              ...options,
              channels: parseInt(val, 10) as 1 | 2,
              preset: 'custom',
            }),
          accessibilityLabel: t('converter:index.channels'),
        }),
      ),
      // Bit Depth (applicable for lossless/PCM)
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            opacity: isLossless ? 1 : 0.4,
          },
        },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.bitDepth')),
        h(Select<string>, {
          value: String(options.bitDepth ?? 16),
          options: BIT_DEPTH_OPTIONS,
          disabled: !isLossless,
          onChange: (val) =>
            onOptionsChange({
              ...options,
              bitDepth: parseInt(val, 10) as 16 | 24 | 32,
              preset: 'custom',
            }),
          accessibilityLabel: t('converter:index.bitDepth'),
        }),
      ),
    ),

    // Audio Filters (Gain, Fade, Crop, VBR)
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: tokens.space[3],
          paddingTop: tokens.space[2],
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
        },
      },
      // VBR Switch
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
          },
        },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.vbr')),
        h(Switch, {
          checked: options.vbr ?? false,
          disabled: isLossless,
          onChange: (checked) =>
            onOptionsChange({ ...options, vbr: checked, preset: 'custom' }),
          accessibilityLabel: t('converter:index.vbr'),
        }),
      ),
      // Volume Gain
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.volumeGain')),
        h(TextField, {
          value: options.volumeGainDb ? String(options.volumeGainDb) : '',
          placeholder: '0 dB',
          onChange: (val) =>
            onOptionsChange({
              ...options,
              volumeGainDb: val ? parseFloat(val) : undefined,
              preset: 'custom',
            }),
          accessibilityLabel: t('converter:index.volumeGain'),
        }),
      ),
      // Fade In
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.fadeIn')),
        h(TextField, {
          value: options.fadeInSeconds ? String(options.fadeInSeconds) : '',
          placeholder: '0s',
          onChange: (val) =>
            onOptionsChange({
              ...options,
              fadeInSeconds: val ? parseFloat(val) : undefined,
              preset: 'custom',
            }),
          accessibilityLabel: t('converter:index.fadeIn'),
        }),
      ),
      // Fade Out
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.fadeOut')),
        h(TextField, {
          value: options.fadeOutSeconds ? String(options.fadeOutSeconds) : '',
          placeholder: '0s',
          onChange: (val) =>
            onOptionsChange({
              ...options,
              fadeOutSeconds: val ? parseFloat(val) : undefined,
              preset: 'custom',
            }),
          accessibilityLabel: t('converter:index.fadeOut'),
        }),
      ),
    ),

    // Real-time Compression Estimation Card & Advisory
    estimate
      ? h(
          'div',
          {
            'data-testid': 'compression-estimate-card',
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            },
          },
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
              Text,
              { variant: 'sm' },
              t('converter:index.estimate'),
            ),
            h(
              'span',
              {
                style: {
                  fontSize: 12,
                  fontWeight: 600,
                  color:
                    estimate.estimatedRatio <= 100
                      ? 'var(--color-primary, #5F87FF)'
                      : '#F59E0B',
                },
              },
              `${t('converter:index.estimatedRatio')}: ~${estimate.estimatedRatio}% (${formatBytes(estimate.estimatedSize)})`,
            ),
          ),
          h(Text, { variant: 'xs', tone: 'muted' }, estimate.note),
          // Warning banner if lossy re-encoding or expanding
          estimate.warning
            ? h(
                'div',
                {
                  'data-testid': 'compression-warning-banner',
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                    padding: '6px 10px',
                    borderRadius: 4,
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    color: '#FBBF24',
                    fontSize: 11,
                  },
                },
                h('span', null, '⚠️'),
                h('span', null, estimate.warning),
              )
            : null,
        )
      : null,
  )
}
