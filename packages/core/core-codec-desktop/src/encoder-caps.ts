/**
 * The encoder capability vocabulary shared by every codec implementation.
 *
 * `CodecNode.getEncoderCapabilities` (desktop: local ffmpeg probe) and
 * `CodecRn.getEncoderCapabilities` (mobile: native libavcodec probe) must
 * report the SAME encoder ids, display names and output-format derivation,
 * or the converter UI promises different things per platform. The table and
 * the derivation live here so they cannot drift; only the availability
 * probe differs per platform.
 */

export interface KnownEncoder {
  /** The encoder id as `ffmpeg -encoders` / libavcodec spell it. */
  key: string
  name: string
  /** The output format this encoder unlocks for the converter UI. */
  format: string
  description: string
}

export const KNOWN_ENCODERS: readonly KnownEncoder[] = [
  { key: 'libmp3lame', name: 'MP3 (LAME)', format: 'mp3', description: 'MP3 audio encoder' },
  { key: 'flac', name: 'FLAC', format: 'flac', description: 'Free Lossless Audio Codec' },
  { key: 'aac', name: 'AAC', format: 'aac', description: 'Advanced Audio Coding' },
  { key: 'libopus', name: 'Opus', format: 'opus', description: 'Opus audio codec' },
  { key: 'libvorbis', name: 'Vorbis', format: 'ogg', description: 'Ogg Vorbis audio codec' },
  { key: 'wmav2', name: 'Windows Media Audio', format: 'wma', description: 'WMA version 2' },
  { key: 'alac', name: 'Apple Lossless', format: 'alac', description: 'ALAC audio codec' },
  { key: 'pcm_s16le', name: 'PCM 16-bit LE', format: 'wav', description: 'Uncompressed PCM 16-bit' },
  { key: 'pcm_s24le', name: 'PCM 24-bit LE', format: 'wav', description: 'Uncompressed PCM 24-bit' },
  { key: 'pcm_s16be', name: 'PCM 16-bit BE', format: 'aiff', description: 'AIFF uncompressed PCM' },
]

/**
 * Everything the demux layer can be handed, independent of the encoder
 * probe: input capability is what a file already IS, not what we turn it
 * into. The container-only pseudo-formats (`pcm`) ride on the wav demuxer.
 */
export const SUPPORTED_INPUT_FORMATS: readonly string[] = [
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus',
  'wma', 'aiff', 'alac', 'webm', 'pcm', 'ape', 'wv',
]

/**
 * Derive the output-format set from a per-encoder availability map — the
 * same rules the desktop capability code has always applied (AAC also
 * unlocks the m4a container, Opus also webm, the PCM encoder also the
 * container-only `pcm` pseudo format).
 */
export function deriveOutputFormats(
  isAvailable: (key: string) => boolean,
): string[] {
  const supported = new Set<string>()
  for (const item of KNOWN_ENCODERS) {
    if (!isAvailable(item.key)) continue
    supported.add(item.format)
    if (item.format === 'aac') supported.add('m4a')
    if (item.format === 'opus') supported.add('webm')
    if (item.key === 'pcm_s16le') supported.add('pcm')
  }
  return Array.from(supported)
}
