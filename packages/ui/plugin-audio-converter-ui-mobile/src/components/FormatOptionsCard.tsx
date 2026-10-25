/**
 * FormatOptionsCard — target format, compression preset, and the real transcode
 * options the codec engine passes through (bitrate, sample rate, channels, bit
 * depth, VBR, volume gain, fades), plus the live compression estimate.
 *
 * Option names mirror the desktop workbench option for option — both shells
 * feed the same `AudioConvertOptions` into `ctx.audioConverter.enqueue`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  AudioConvertOptions,
  AudioFormat,
  CompressionEstimate,
  CompressionPreset,
} from '@BBeBee/protocol'
import { nativePrimitives, Text, TextField, useI18n } from '@BBeBee/ui-kit-mobile'
import { formatBytes } from '@BBeBee/toolkit'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { isLosslessFormat } from '@bbebee/plugin-audio-converter'
import {
  applyPreset,
  BIT_DEPTH_OPTIONS,
  BITRATE_OPTIONS,
  FORMAT_OPTIONS,
  parseNumberField,
  PRESET_LABEL_KEYS,
  PRESET_OPTIONS,
  SAMPLE_RATE_OPTIONS,
  withOption,
} from '../options.js'

const p = () => palettes.dark

export interface FormatOptionsCardProps {
  ctx: Context
  targetFormat: AudioFormat
  options: AudioConvertOptions
  onFormatChange: (fmt: AudioFormat) => void
  onOptionsChange: (opts: AudioConvertOptions) => void
  estimate?: CompressionEstimate
}

function Chip(props: {
  label: string
  selected: boolean
  disabled?: boolean
  testID?: string
  accessibilityLabel?: string
  onPress: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      onPress: props.disabled ? undefined : props.onPress,
      accessibilityRole: 'button',
      accessibilityLabel: props.accessibilityLabel ?? props.label,
      accessibilityState: { selected: props.selected, disabled: Boolean(props.disabled) },
      testID: props.testID,
      style: {
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: tokens.radius.sm,
        borderWidth: 1,
        borderColor: props.selected ? p().accent.base : p().border.subtle,
        backgroundColor: props.selected ? p().accent.muted : 'transparent',
        opacity: props.disabled ? 0.4 : 1,
      },
    },
    h(Text, { variant: 'xs', tone: props.selected ? 'accent' : 'muted' }, props.label),
  )
}

function Row(props: { label: string; children?: ReactElement[] }): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { gap: 4 } },
    h(Text, { variant: 'xs', tone: 'muted' }, props.label),
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1] } },
      ...(props.children ?? []),
    ),
  )
}

function Toggle(props: { label: string; checked: boolean; onToggle: () => void }): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } },
    h(Text, { variant: 'xs', tone: 'muted' }, props.label),
    h(
      native.Pressable as never,
      {
        onPress: props.onToggle,
        accessibilityRole: 'switch',
        accessibilityState: { checked: props.checked },
        accessibilityLabel: props.label,
        testID: `converter-toggle-${props.label}`,
        style: {
          width: 48,
          height: 26,
          borderRadius: 13,
          backgroundColor: props.checked ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
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
          transform: [{ translateX: props.checked ? 22 : 0 }],
        },
      }),
    ),
  )
}

export function FormatOptionsCard({
  ctx,
  targetFormat,
  options,
  onFormatChange,
  onOptionsChange,
  estimate,
}: FormatOptionsCardProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const isLossless = isLosslessFormat(targetFormat)

  return h(
    native.View as never,
    {
      testID: 'converter-format-options',
      style: {
        gap: tokens.space[3],
        padding: tokens.space[3],
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: tokens.radius.md,
      },
    },
    // Target format
    h(
      Row,
      { label: t('converter:index.targetFormat') },
      FORMAT_OPTIONS.map((fmt) =>
        h(Chip, {
          key: fmt,
          label: fmt.toUpperCase(),
          selected: targetFormat === fmt,
          testID: `converter-format-${fmt}`,
          onPress: () => onFormatChange(fmt),
        }),
      ),
    ),

    // Compression preset
    h(
      Row,
      { label: t('converter:index.preset') },
      PRESET_OPTIONS.map((preset: CompressionPreset) =>
        h(Chip, {
          key: preset,
          label: t(PRESET_LABEL_KEYS[preset]),
          selected: (options.preset ?? 'balanced') === preset,
          testID: `converter-preset-${preset}`,
          onPress: () => onOptionsChange(applyPreset(options, preset, isLossless)),
        }),
      ),
    ),

    // Bitrate — meaningless for a lossless target, dimmed the way the desktop dims it
    h(
      native.View as never,
      { style: { opacity: isLossless ? 0.4 : 1 } },
      h(
        Row,
        { label: t('converter:index.bitrate') },
        BITRATE_OPTIONS.map((kbps) =>
          h(Chip, {
            key: kbps,
            label: `${kbps} kbps`,
            selected: options.bitrateKbps === kbps,
            disabled: isLossless,
            testID: `converter-bitrate-${kbps}`,
            onPress: () => onOptionsChange(withOption(options, 'bitrateKbps', kbps)),
          }),
        ),
      ),
    ),

    // Sample rate
    h(
      Row,
      { label: t('converter:index.sampleRate') },
      SAMPLE_RATE_OPTIONS.map((hz) =>
        h(Chip, {
          key: hz,
          label: hz >= 44100 && hz === 44100 ? '44,100 Hz (CD)' : `${hz.toLocaleString('en-US')} Hz`,
          selected: options.sampleRate === hz,
          testID: `converter-samplerate-${hz}`,
          onPress: () => onOptionsChange(withOption(options, 'sampleRate', hz)),
        }),
      ),
    ),

    // Channels
    h(
      Row,
      { label: t('converter:index.channels') },
      [
        { value: 1 as const, label: t('converter:index.mono') },
        { value: 2 as const, label: t('converter:index.stereo') },
      ].map((ch) =>
        h(Chip, {
          key: ch.value,
          label: ch.label,
          selected: options.channels === ch.value,
          testID: `converter-channels-${ch.value}`,
          onPress: () => onOptionsChange(withOption(options, 'channels', ch.value)),
        }),
      ),
    ),

    // Bit depth — applies to lossless/PCM targets only
    h(
      native.View as never,
      { style: { opacity: isLossless ? 1 : 0.4 } },
      h(
        Row,
        { label: t('converter:index.bitDepth') },
        BIT_DEPTH_OPTIONS.map((depth) =>
          h(Chip, {
            key: depth,
            label: `${depth}-bit`,
            selected: options.bitDepth === depth,
            disabled: !isLossless,
            testID: `converter-bitdepth-${depth}`,
            onPress: () => onOptionsChange(withOption(options, 'bitDepth', depth)),
          }),
        ),
      ),
    ),

    // Variable bitrate
    h(Toggle, {
      label: t('converter:index.vbr'),
      checked: options.vbr ?? false,
      onToggle: () => onOptionsChange(withOption(options, 'vbr', !(options.vbr ?? false))),
    }),

    // Audio filters — gain and fades, parsed leniently; a blank field unsets.
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.volumeGain')),
        h(TextField, {
          value: options.volumeGainDb !== undefined ? String(options.volumeGainDb) : '',
          placeholder: '0 dB',
          accessibilityLabel: t('converter:index.volumeGain'),
          testID: 'converter-volume-gain',
          onChange: (val: string) =>
            onOptionsChange(withOption(options, 'volumeGainDb', parseNumberField(val))),
        }),
      ),
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.fadeIn')),
        h(TextField, {
          value: options.fadeInSeconds !== undefined ? String(options.fadeInSeconds) : '',
          placeholder: '0s',
          accessibilityLabel: t('converter:index.fadeIn'),
          testID: 'converter-fade-in',
          onChange: (val: string) =>
            onOptionsChange(withOption(options, 'fadeInSeconds', parseNumberField(val))),
        }),
      ),
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.fadeOut')),
        h(TextField, {
          value: options.fadeOutSeconds !== undefined ? String(options.fadeOutSeconds) : '',
          placeholder: '0s',
          accessibilityLabel: t('converter:index.fadeOut'),
          testID: 'converter-fade-out',
          onChange: (val: string) =>
            onOptionsChange(withOption(options, 'fadeOutSeconds', parseNumberField(val))),
        }),
      ),
    ),

    // Live estimate for the first staged file — the desktop card, condensed.
    estimate
      ? h(
          native.View as never,
          {
            testID: 'converter-estimate-card',
            style: {
              gap: 2,
              padding: tokens.space[2],
              borderRadius: tokens.radius.sm,
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
            },
          },
          h(
            Text,
            { variant: 'sm' },
            `${t('converter:index.estimatedRatio')}: ~${estimate.estimatedRatio}% (${formatBytes(estimate.estimatedSize)})`,
          ),
          h(Text, { variant: 'xs', tone: 'muted' }, estimate.note),
        )
      : null,
  )
}

