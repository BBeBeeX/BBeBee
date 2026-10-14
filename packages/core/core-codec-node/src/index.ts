/**
 * `ctx.codec` for desktop — the bridge between bytes on disk and something the
 * audio engine can use.
 *
 * Tags come from `music-metadata`, which is pure JavaScript: it reads through
 * `ctx.fs` like everything else rather than reaching for `node:fs`, so the
 * same implementation works in the Electron renderer (where `ctx.fs` crosses
 * the bridge) and in `main`.
 *
 * The load-bearing property is that **`readMetadata` does not read the whole
 * file**. A 40 MB FLAC costs a bounded head window, not 40 MB across an IPC
 * channel — the difference between a 5,000-file scan taking minutes and taking
 * an afternoon. Streaming and letting the parser stop early does *not* achieve
 * that (the tokenizer drains what it is given, which the conformance suite
 * caught), so the window is read explicitly and the whole file is a fallback.
 *
 * See docs/04-core-services.md §13.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AudioMetadata, CodecService, DecodedAudio, TranscodeOptions, TranscodeResult, Uri } from '@BBeBee/protocol'
import { parseBuffer, selectCover, type IAudioMetadata, type IOptions } from 'music-metadata'

export interface CodecNodeConfig {
  /**
   * Formats to report as decodable.
   *
   * ⚠️ What a platform can actually decode differs by OS and OS version, and
   * this service reads tags rather than decoding — so the list is configured
   * by the shell, which knows its own engine, rather than guessed at here
   * (docs/04 §13).
   */
  supportedFormats?: string[]
}

const DEFAULT_FORMATS = [
  'mp3',
  'flac',
  'm4a',
  'm4b',
  'aac',
  'wav',
  'ogg',
  'opus',
  'aiff',
  'alac',
  'wma',
  'ape',
  'wv',
  'dsf',
  'dff',
]

/** How much of the head to read before falling back to the whole file. */
const TAG_WINDOW_BYTES = 256 * 1024

export class CodecNode extends Service implements CodecService {
  static inject = ['fs']

  private readonly formats: string[]

  constructor(ctx: Context, config: CodecNodeConfig = {}) {
    super(ctx, 'codec')
    this.formats = (config.supportedFormats ?? DEFAULT_FORMATS).map((f) => f.toLowerCase())
  }

  async readMetadata(uri: Uri): Promise<AudioMetadata> {
    const { size } = await this.ctx.fs.stat(uri)
    const parsed = await this.parse(uri, { duration: false, skipCovers: false })
    return toAudioMetadata(parsed, uri, size)
  }

  async readArtwork(uri: Uri): Promise<Uint8Array | undefined> {
    const parsed = await this.parse(uri, { duration: false, skipCovers: false })
    const cover = selectCover(parsed.common.picture)
    return cover ? new Uint8Array(cover.data) : undefined
  }

  /**
   * Decode to PCM.
   *
   * ⚠️ Not implemented here. Decoding is the audio engine's job — Web Audio's
   * `decodeAudioData` in the renderer, `AudioDecoder` on mobile — and a second
   * decoder in this service would be a second answer to "what can this
   * platform play". Callers that need PCM (waveforms, gain analysis) go
   * through `ctx.audio`; the method stays on the contract so the shells can
   * provide it where they have it.
   */
  async decode(_data?: Uint8Array | Uri): Promise<DecodedAudio> {
    throw new Error(
      'codec: PCM decoding is provided by the audio engine, not the tag reader. ' +
        'Load through ctx.audio instead.',
    )
  }

  async probeDuration(uri: Uri): Promise<number> {
    // `duration: true` is the one call that may scan a file whose header does
    // not carry a duration, so it is its own method rather than folded into
    // `readMetadata` — the scanner asks for it only when tags came up short.
    const parsed = await this.parse(uri, { duration: true, skipCovers: true })
    return Math.round((parsed.format.duration ?? 0) * 1000)
  }

  supportedFormats(): string[] {
    return [...this.formats]
  }

  async transcode(options: TranscodeOptions): Promise<TranscodeResult> {
    const exposed = (globalThis as unknown as {
      window?: {
        BBeBee?: {
          audio?: {
            transcode?: (opts: TranscodeOptions) => Promise<TranscodeResult>
          }
        }
      }
    }).window
    const bridgeTranscode = exposed?.BBeBee?.audio?.transcode
    if (bridgeTranscode) {
      return bridgeTranscode(options)
    }

    try {
      const { spawn } = await import('node:child_process')
      const { existsSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const toPath = (u: string) => {
        const fileUrl = u.replace(/^bbebee-file:\/*/, 'file:///')
        if (fileUrl.startsWith('file://')) {
          const p = fileURLToPath(fileUrl)
          if (/^\/[a-zA-Z]:[\\/]/.test(p)) {
            return decodeURIComponent(p.slice(1))
          }
          return p
        }
        return u
      }
      const inPath = toPath(options.inputUri)
      const outPath = toPath(options.outputUri)
      const fmt = options.targetFormat.toLowerCase()

      const args = ['-y', '-i', inPath]
      if (fmt === 'flac') {
        args.push('-c:a', 'flac')
      } else if (fmt === 'mp3') {
        args.push('-c:a', 'libmp3lame', '-b:a', options.bitrate || '320k')
      } else if (fmt === 'm4a' || fmt === 'aac' || fmt === 'mp4') {
        args.push('-c:a', 'aac', '-b:a', options.bitrate || '320k')
      } else if (fmt === 'ogg' || fmt === 'opus') {
        args.push('-c:a', 'libopus', '-b:a', options.bitrate || '256k')
      } else if (fmt === 'wav') {
        args.push('-c:a', 'pcm_s16le')
      }
      args.push(outPath)

      return await new Promise<TranscodeResult>((resolve) => {
        const proc = spawn('ffmpeg', args)
        let stderr = ''
        proc.stderr?.on('data', (d) => {
          stderr += d.toString()
        })
        proc.on('close', (code) => {
          if (code === 0 && existsSync(outPath)) {
            resolve({ ok: true })
          } else {
            resolve({ ok: false, error: stderr.slice(-500) || `ffmpeg exited with code ${code}` })
          }
        })
        proc.on('error', (err) => {
          resolve({ ok: false, error: String(err) })
        })
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /**
   * Parse the head of the file, and only fall back to the whole of it.
   *
   * Streaming the file and letting the parser stop early *sounds* like the
   * bounded read, but it is not one: the tokenizer drains what it is given, so
   * a 40 MB FLAC costs 40 MB — measured, not assumed. Reading an explicit
   * window instead makes the bound real.
   *
   * Every container of interest puts its tags at the head: ID3v2, FLAC's
   * metadata blocks, MP4's `moov` when it is faststart-ed. The exceptions —
   * a trailing ID3v1, a tail `moov` — fall through to the full read, which is
   * correct and merely slower, and rare enough to be worth it.
   */
  private async parse(uri: Uri, options: IOptions): Promise<IAudioMetadata> {
    const { size } = await this.ctx.fs.stat(uri)

    if (size > TAG_WINDOW_BYTES) {
      const head = await this.readWindow(uri, TAG_WINDOW_BYTES)
      try {
        const parsed = await this.parseBytes(head, uri, undefined, options)
        if (hasUsableTags(parsed)) return parsed
      } catch {
        // The window cut through something the parser needed.
      }
    }

    const whole = await this.ctx.fs.readBytes(uri)
    const parsed = await this.parseBytes(whole, uri, size, options)

    /*
     * A parse that found nothing at all is a failure, not a tagless track.
     *
     * ⚠️ This used to return whatever came back. Passing the extension's mime
     * type made the parser trust it, so a zero-byte file, a truncated header
     * and a JPEG renamed `.mp3` all "parsed" — into `{ codec: 'mp3' }`, from
     * the *hint*, with no bytes behind it. The scanner then imported three
     * phantom tracks named after their filenames, which is worse than either
     * of the two honest outcomes: docs/11 §4.7 says a file that will not
     * decode gets `scan_entries.status = 'error'` with a reason, and is never
     * silently absent. It was silently *present* instead.
     */
    if (!hasUsableTags(parsed)) {
      throw new Error(`codec: nothing readable in ${this.ctx.fs.basename(uri)}`)
    }
    return parsed
  }

  /**
   * Parse bytes, letting the *content* decide the container.
   *
   * The extension is a hint of last resort, not the answer: a `.mp3` holding
   * FLAC is a thing real libraries contain, and dispatching on the name reads
   * it with the wrong parser and reports it as untagged. Content sniffing gets
   * it right; the hint is retried only when sniffing fails outright, which is
   * the case of a container music-metadata cannot recognise from its magic
   * bytes but can parse once told.
   */
  private async parseBytes(
    bytes: Uint8Array,
    uri: Uri,
    size: number | undefined,
    options: IOptions,
  ): Promise<IAudioMetadata> {
    const base = size === undefined ? {} : { size }
    try {
      return await parseBuffer(bytes, base, options)
    } catch (error) {
      const hint = mimeFor(uri)
      if (!hint) throw error
      return parseBuffer(bytes, { ...base, mimeType: hint }, options)
    }
  }

  private async readWindow(uri: Uri, bytes: number): Promise<Uint8Array> {
    const reader = this.ctx.fs.createReadStream(uri, { start: 0, end: bytes - 1 }).getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        total += value.byteLength
        if (total >= bytes) break
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }

    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.byteLength
    }
    return out
  }
}

/**
 * Whether a parse found anything worth keeping.
 *
 * A truncated window can yield a "successful" parse with nothing in it, which
 * would import a whole library as untitled files. Format-level facts count:
 * a FLAC with no tags at all is still legitimately tagless.
 */
function hasUsableTags(parsed: IAudioMetadata): boolean {
  const { common, format } = parsed
  return Boolean(
    common.title ??
      common.artist ??
      common.album ??
      // Format-level facts count: a FLAC with no tags at all is still
      // legitimately tagless, and the scanner falls back to its filename.
      // These come from the bytes now that no mime hint is volunteered, so
      // `codec` is evidence rather than an echo of the extension.
      format.sampleRate ??
      format.duration ??
      format.numberOfChannels,
  )
}

function mimeFor(uri: string): string | undefined {
  const ext = uri.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
    case 'm4b':
    case 'alac':
    case 'aac':
      return 'audio/mp4'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'opus':
      return 'audio/opus'
    case 'wav':
      return 'audio/wav'
    case 'aiff':
    case 'aif':
      return 'audio/aiff'
    case 'wma':
      return 'audio/x-ms-wma'
    case 'ape':
      return 'audio/ape'
    case 'wv':
      return 'audio/wavpack'
    case 'dsf':
      return 'audio/dsf'
    case 'dff':
      return 'audio/dff'
    default:
      return undefined
  }
}

/** `music-metadata`'s shape → the contract's. */
export function toAudioMetadata(
  parsed: IAudioMetadata,
  uri: string,
  fileSize?: number,
): AudioMetadata {
  const { common, format } = parsed
  const gain = common.replaygain_track_gain
  const albumGain = common.replaygain_album_gain

  const durationSec =
    format.duration ??
    (format.numberOfSamples && format.sampleRate ? format.numberOfSamples / format.sampleRate : undefined)

  let bitrateKbps: number | undefined
  if (format.bitrate && format.bitrate >= 32000) {
    bitrateKbps = Math.round(format.bitrate / 1000)
  } else if (fileSize && durationSec && durationSec > 0) {
    const computed = Math.round((fileSize * 8) / (durationSec * 1000))
    if (computed >= 32) {
      bitrateKbps = computed
    }
  } else if (format.bitrate && format.bitrate > 0) {
    bitrateKbps = Math.round(format.bitrate / 1000)
  }

  return {
    ...(common.title ? { title: common.title } : {}),
    ...(common.artist ? { artist: common.artist } : {}),
    ...(common.albumartist ? { albumArtist: common.albumartist } : {}),
    ...(common.album ? { album: common.album } : {}),
    ...(common.track?.no ? { trackNo: common.track.no } : {}),
    ...(common.disk?.no ? { discNo: common.disk.no } : {}),
    ...(common.year ? { year: common.year } : {}),
    ...(common.genre?.length ? { genre: common.genre } : {}),
    ...(durationSec ? { durationMs: Math.round(durationSec * 1000) } : {}),
    ...(bitrateKbps ? { bitrateKbps } : {}),
    ...(format.sampleRate ? { sampleRate: format.sampleRate } : {}),
    ...(format.numberOfChannels ? { channels: format.numberOfChannels } : {}),
    ...(format.bitsPerSample ? { bitDepth: format.bitsPerSample } : {}),
    ...(format.codec ? { codec: format.codec } : { codec: uri.split('.').pop() ?? '' }),
    ...(typeof gain === 'object' && gain && 'dB' in gain ? { replayGainTrack: gain.dB } : {}),
    ...(typeof albumGain === 'object' && albumGain && 'dB' in albumGain
      ? { replayGainAlbum: albumGain.dB }
      : {}),
    ...(common.isrc?.[0] ? { isrc: common.isrc[0] } : {}),
    ...(common.musicbrainz_recordingid
      ? { musicbrainzTrackId: common.musicbrainz_recordingid }
      : {}),
    ...(common.lyrics?.[0]?.text ? { lyrics: common.lyrics[0].text } : {}),
    ...(format.tagTypes?.length ? { tagTypes: format.tagTypes } : {}),
    hasArtwork: (common.picture?.length ?? 0) > 0,
  }
}

export const TAG_WINDOW = TAG_WINDOW_BYTES

export const name = 'core-codec-node'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.codec` is usable.
 */
export async function apply(ctx: Context, config: CodecNodeConfig = {}) {
  ctx.logger.info('core-codec-node: loaded')
  const fiber = await ctx.plugin(CodecNode, config)
  return () => void fiber.dispose()
}

export default { name, apply }
