/**
 * Audio compression presets, output size estimation, and lossy/lossless heuristics.
 */

import type {
  AudioConvertOptions,
  AudioFormat,
  CompressionEstimate,
  CompressionPreset,
} from '@BBeBee/protocol'

/** Formats that represent uncompressed PCM audio. */
export const UNCOMPRESSED_FORMATS: ReadonlySet<AudioFormat> = new Set(['wav', 'aiff', 'pcm'])

/** Formats that represent lossless compressed audio. */
export const LOSSLESS_COMPRESSED_FORMATS: ReadonlySet<AudioFormat> = new Set(['flac', 'alac'])

/** Formats that represent lossy compressed audio. */
export const LOSSY_FORMATS: ReadonlySet<AudioFormat> = new Set([
  'mp3',
  'aac',
  'm4a',
  'ogg',
  'opus',
  'wma',
  'webm',
])

export function isLosslessFormat(format: string): boolean {
  const f = format.toLowerCase() as AudioFormat
  return UNCOMPRESSED_FORMATS.has(f) || LOSSLESS_COMPRESSED_FORMATS.has(f)
}

/**
 * Resolved configuration parameters for presets across different formats.
 */
export function resolvePresetOptions(
  preset: CompressionPreset,
  targetFormat: AudioFormat,
  customOptions?: Partial<AudioConvertOptions>,
): AudioConvertOptions {
  if (preset === 'custom' && customOptions) {
    return {
      targetFormat,
      preset: 'custom',
      bitrateKbps: customOptions.bitrateKbps ?? 192,
      sampleRate: customOptions.sampleRate ?? 44100,
      channels: customOptions.channels ?? 2,
      bitDepth: customOptions.bitDepth ?? 16,
      vbr: customOptions.vbr ?? false,
      vbrQuality: customOptions.vbrQuality,
      volumeGainDb: customOptions.volumeGainDb,
      fadeInSeconds: customOptions.fadeInSeconds,
      fadeOutSeconds: customOptions.fadeOutSeconds,
      startTimeSeconds: customOptions.startTimeSeconds,
      endTimeSeconds: customOptions.endTimeSeconds,
    }
  }

  const isLossless = isLosslessFormat(targetFormat)

  switch (preset) {
    case 'high_quality':
      return {
        targetFormat,
        preset: 'high_quality',
        bitrateKbps: isLossless ? undefined : 320,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 24,
        vbr: false,
      }
    case 'balanced':
      return {
        targetFormat,
        preset: 'balanced',
        bitrateKbps: isLossless ? undefined : 192,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
        vbr: true,
        vbrQuality: 2,
      }
    case 'small_size':
      return {
        targetFormat,
        preset: 'small_size',
        bitrateKbps: isLossless ? undefined : 128,
        sampleRate: targetFormat === 'opus' ? 48000 : 44100,
        channels: 2,
        bitDepth: 16,
        vbr: true,
        vbrQuality: 5,
      }
    case 'speech':
      return {
        targetFormat,
        preset: 'speech',
        bitrateKbps: isLossless ? undefined : (targetFormat === 'opus' ? 48 : 64),
        sampleRate: targetFormat === 'opus' ? 48000 : 22050,
        channels: 1, // Mono optimized for speech
        bitDepth: 16,
        vbr: true,
        vbrQuality: 7,
      }
    default:
      return {
        targetFormat,
        preset: 'balanced',
        bitrateKbps: isLossless ? undefined : 192,
        sampleRate: 44100,
        channels: 2,
        bitDepth: 16,
      }
  }
}

/**
 * Estimates output file size and compression ratio prior to execution.
 * Differentiates strictly between lossy and lossless formats.
 */
export function estimateCompression(params: {
  durationMs: number
  sourceSize: number
  targetFormat: AudioFormat
  bitrateKbps?: number
  channels?: number
  sampleRate?: number
  sourceFormat?: string
}): CompressionEstimate {
  const { durationMs, sourceSize, targetFormat, sourceFormat } = params
  const durationSec = Math.max(1, durationMs > 0 ? durationMs / 1000 : 180) // fallback 3 mins if duration unknown
  const targetIsLossless = isLosslessFormat(targetFormat)
  const sourceIsLossy = sourceFormat ? LOSSY_FORMATS.has(sourceFormat.toLowerCase() as AudioFormat) : false

  let estimatedSize: number
  let warning: string | undefined

  if (targetFormat === 'wav' || targetFormat === 'aiff' || targetFormat === 'pcm') {
    // Uncompressed PCM: sampleRate * channels * (bitDepth / 8) * durationSec
    const sr = params.sampleRate ?? 44100
    const ch = params.channels ?? 2
    const bytesPerSec = sr * ch * 2 // 16-bit default
    estimatedSize = Math.round(bytesPerSec * durationSec) + 44
  } else if (targetFormat === 'flac' || targetFormat === 'alac') {
    // Lossless compression typically reduces raw PCM to ~50-65%
    const sr = params.sampleRate ?? 44100
    const ch = params.channels ?? 2
    const uncompressedBytes = sr * ch * 2 * durationSec
    estimatedSize = Math.round(uncompressedBytes * 0.58)

    if (sourceIsLossy) {
      warning =
        'Converting lossy audio (e.g. MP3/AAC) to lossless format (FLAC) will significantly increase file size without restoring lost audio frequencies.'
      // Lossless encoding of lossy source is usually slightly larger than original source
      if (sourceSize > 0) {
        estimatedSize = Math.max(estimatedSize, Math.round(sourceSize * 1.5))
      }
    }
  } else {
    // Lossy formats: Bitrate-based calculation
    const effectiveBitrate = params.bitrateKbps ?? 192
    // (bitrate in bps / 8) * seconds * container overhead factor (1.02)
    estimatedSize = Math.round(((effectiveBitrate * 1000) / 8) * durationSec * 1.02)

    if (sourceIsLossy) {
      warning =
        'Re-encoding an already lossy audio file may cause generational audio degradation. For best results, convert from uncompressed or lossless originals.'
    }
  }

  const ratio = sourceSize > 0 ? (estimatedSize / sourceSize) * 100 : 100
  const estimatedRatio = Math.round(ratio * 10) / 10

  const note = targetIsLossless
    ? 'Estimate based on lossless audio complexity (~58% of uncompressed PCM).'
    : `Estimate calculated from target bitrate (${params.bitrateKbps ?? 192} kbps) and container metadata overhead.`

  return {
    estimatedSize,
    estimatedRatio,
    isLossless: targetIsLossless,
    warning,
    note,
  }
}
