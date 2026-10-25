/**
 * Pure option mapping for the mobile converter workbench.
 *
 * The same preset semantics as the desktop `CompressionSection` — a preset is
 * an option *patch*, never a hand-rolled branch in the view. Kept free of
 * React and of the native primitives so it unit-tests in plain Node.
 */

import type { AudioConvertOptions, AudioFormat, CompressionPreset } from '@BBeBee/protocol'

/** The twelve output formats the service accepts (`validateFormat`). */
export const FORMAT_OPTIONS: readonly AudioFormat[] = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'ogg',
  'opus',
  'alac',
  'aiff',
  'wma',
  'webm',
  'pcm',
]

export const BITRATE_OPTIONS: readonly number[] = [64, 96, 128, 192, 256, 320]

export const SAMPLE_RATE_OPTIONS: readonly number[] = [22050, 44100, 48000]

export const BIT_DEPTH_OPTIONS: readonly (16 | 24 | 32)[] = [16, 24, 32]

export const PRESET_OPTIONS: readonly CompressionPreset[] = [
  'high_quality',
  'balanced',
  'small_size',
  'speech',
  'custom',
]

/** i18n catalogue keys for the preset labels (`converter:index.preset*`). */
export const PRESET_LABEL_KEYS: Record<CompressionPreset, string> = {
  high_quality: 'converter:index.presetHighQuality',
  balanced: 'converter:index.presetBalanced',
  small_size: 'converter:index.presetSmallSize',
  speech: 'converter:index.presetSpeech',
  custom: 'converter:index.presetCustom',
}

/** The defaults the desktop workbench starts from. */
export function defaultConvertOptions(defaultFormat: AudioFormat): AudioConvertOptions {
  return {
    targetFormat: defaultFormat,
    preset: 'balanced',
    bitrateKbps: 192,
    sampleRate: 44100,
    channels: 2,
    vbr: false,
    overwrite: false,
  }
}

/**
 * Apply a compression preset — the exact patches the desktop
 * `CompressionSection.handlePresetChange` writes, lossless-gated the same way
 * (a lossless target ignores the bitrate field rather than carrying a
 * meaningless value).
 */
export function applyPreset(
  options: AudioConvertOptions,
  preset: CompressionPreset,
  isLossless: boolean,
): AudioConvertOptions {
  if (preset === 'custom') {
    return { ...options, preset: 'custom' }
  }
  if (preset === 'high_quality') {
    return {
      ...options,
      preset,
      bitrateKbps: isLossless ? undefined : 320,
      sampleRate: 44100,
      channels: 2,
      bitDepth: 24,
      vbr: false,
    }
  }
  if (preset === 'small_size') {
    return {
      ...options,
      preset,
      bitrateKbps: isLossless ? undefined : 128,
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      vbr: true,
    }
  }
  if (preset === 'speech') {
    return {
      ...options,
      preset,
      bitrateKbps: isLossless ? undefined : 64,
      sampleRate: 22050,
      channels: 1,
      bitDepth: 16,
      vbr: true,
    }
  }
  // 'balanced'
  return {
    ...options,
    preset,
    bitrateKbps: isLossless ? undefined : 192,
    sampleRate: 44100,
    channels: 2,
    bitDepth: 16,
    vbr: true,
  }
}

/**
 * One chip edit marks the preset custom — the desktop rule: any manual
 * parameter change detaches the row from the named preset.
 */
export function withOption<K extends keyof AudioConvertOptions>(
  options: AudioConvertOptions,
  key: K,
  value: AudioConvertOptions[K],
): AudioConvertOptions {
  return { ...options, [key]: value, preset: 'custom' }
}

/** Parse a numeric text-field value; `undefined` (meaning "unset") when blank or NaN. */
export function parseNumberField(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) ? n : undefined
}
