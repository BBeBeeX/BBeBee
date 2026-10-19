/**
 * `ctx.codec` for desktop — the bridge between bytes on disk and something the
 * audio engine can use.
 *
 * Tags come from `music-metadata`, which is pure JavaScript: it reads through
 * `ctx.fs` like everything else rather than reaching for `node:fs`, so the
 * same implementation works in the desktop webview (where `ctx.fs` crosses
 * the bridge) and in the sidecar host.
 *
 * The load-bearing property is that **`readMetadata` does not read the whole
 * file**. A 40 MB FLAC costs the bytes its tag blocks actually occupy, not
 * 40 MB across an IPC channel — the difference between a 5,000-file scan
 * taking minutes and taking an afternoon. That is achieved with a real
 * seekable tokenizer (`./tokenizer.ts`): `parseFromTokenizer` lets the
 * parser ask for exactly the bytes it needs — an ID3v2 header declares its
 * own length, a tail `moov` is seeked to, appending headers are found by
 * reading backwards from EOF — instead of the old guess-a-head-window and
 * re-parse-on-miss loop, which re-read overlapping bytes and re-parsed the
 * tag block on every escalation.
 *
 * See docs/04-core-services.md §13.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AudioMetadata, CodecService, DecodedAudio, TranscodeOptions, TranscodeResult, Uri } from '@BBeBee/protocol'
import { parseFromTokenizer, selectCover, type IAudioMetadata, type IOptions } from 'music-metadata'
import iconv from 'iconv-lite'
import { FsRangeTokenizer } from './tokenizer.js'

/**
 * Recover GBK-encoded text that was misdecoded.
 *
 * Chinese files with GBK tags (mislabeled in the tag header) come out of
 * music-metadata as mojibake. Two cases:
 *
 * 1. Mislabeled as Latin1: each GBK byte becomes U+0080-U+00FF. Fully
 *    recoverable via `Buffer.from(str, 'latin1')` → `iconv.decode(bytes,
 *    'gbk')`.
 * 2. Mislabeled as UTF-8: valid sequences become wrong-but-valid chars,
 *    invalid ones become U+FFFD (�). The � parts have lost their bytes and
 *    cannot be recovered; the valid parts can via UTF-8 re-encoding.
 *
 * Heuristic: only attempt when the string has no CJK yet but the GBK
 * decoding produces CJK. Correctly-decoded text (including proper Chinese)
 * is left untouched.
 */
function recoverGbkText(input: string | undefined): string | undefined {
  if (!input || typeof input !== 'string') return input
  if (/[\u4e00-\u9fff]/.test(input)) return input

  // Case 1: Latin1 misdecode — no �, but high-byte chars present.
  if (!input.includes('�') && /[\u0080-\u00ff]/.test(input)) {
    try {
      const bytes = Buffer.from(input, 'latin1')
      const decoded = iconv.decode(bytes, 'gbk')
      // Require at least 2 CJK characters: a single accented Latin char
      // (e.g. ó in "Jóga") can coincidentally form one valid GBK sequence
      // with its neighbor, but real Chinese text has runs of CJK.
      if (
        decoded !== input &&
        /[\u4e00-\u9fff][\u4e00-\u9fff]/.test(decoded) &&
        !decoded.includes('�')
      ) {
        return decoded
      }
    } catch {
      // Fall through to return original.
    }
    return input
  }

  // Case 2: UTF-8 misdecode — has �. Recover segment by segment, keeping �
  // for the unrecoverable parts.
  if (input.includes('�')) {
    const segments = input.split('�')
    let recoveredAny = false
    const out = segments.map((seg) => {
      if (!seg || /[\u4e00-\u9fff]/.test(seg)) return seg
      try {
        const bytes = Buffer.from(seg, 'utf8')
        const decoded = iconv.decode(bytes, 'gbk')
        if (
          decoded !== seg &&
          /[\u4e00-\u9fff][\u4e00-\u9fff]/.test(decoded) &&
          !decoded.includes('�') &&
          !decoded.includes('锟')
        ) {
          recoveredAny = true
          return decoded
        }
      } catch {
        // Keep original segment.
      }
      return seg
    })
    if (recoveredAny) return out.join('�')
  }

  return input
}

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

export class CodecNode extends Service implements CodecService {
  static inject = ['fs']

  private readonly formats: string[]

  constructor(ctx: Context, config: CodecNodeConfig = {}) {
    super(ctx, 'codec')
    this.formats = (config.supportedFormats ?? DEFAULT_FORMATS).map((f) => f.toLowerCase())
  }

  async readMetadata(uri: Uri): Promise<AudioMetadata> {
    return (await this.readMetadataWithArtwork(uri)).metadata
  }

  /**
   * Batch tag reads: parse multiple files with bounded concurrency.
   * One file failing does not fail the batch — its entry carries `{ error }`.
   */
  async readMetadataBatch(uris: Uri[]): Promise<Array<{ metadata?: AudioMetadata; error?: string }>> {
    const CONCURRENCY = 16
    const results: Array<{ metadata?: AudioMetadata; error?: string }> = new Array(uris.length)
    let next = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, uris.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= uris.length) break
        const uri = uris[i]!
        try {
          results[i] = { metadata: await this.readMetadata(uri) }
        } catch (e) {
          results[i] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
    })
    await Promise.all(workers)
    return results
  }

  async readArtwork(uri: Uri): Promise<Uint8Array | undefined> {
    return (await this.readMetadataWithArtwork(uri)).artwork
  }

  /**
   * Batch artwork extraction with bounded concurrency.
   * Files without embedded art yield `undefined` (not an error).
   */
  async readArtworkBatch(uris: Uri[]): Promise<Array<Uint8Array | undefined>> {
    const CONCURRENCY = 16
    const results: Array<Uint8Array | undefined> = new Array(uris.length)
    let next = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, uris.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= uris.length) break
        const uri = uris[i]!
        try {
          results[i] = await this.readArtwork(uri)
        } catch {
          results[i] = undefined
        }
      }
    })
    await Promise.all(workers)
    return results
  }

  /**
   * Single parse for tags + artwork. Previously `readMetadata` and
   * `readArtwork` each parsed the file; the scanner calls both per file,
   * so this halves the parse work for files with embedded art.
   *
   * No second-pass artwork re-read: the tokenizer lets the parser seek to
   * the whole tag block, so a parse that found no cover cannot find one by
   * reading more — the old 4 MB fallback only existed because the head
   * window could cut the tag block short.
   */
  async readMetadataWithArtwork(
    uri: Uri,
    signal?: AbortSignal,
  ): Promise<{ metadata: AudioMetadata; artwork?: Uint8Array }> {
    const { size } = await this.ctx.fs.stat(uri)
    const parsed = await this.parse(uri, { duration: false, skipCovers: false }, signal, size)
    const metadata = toAudioMetadata(parsed, uri, size)
    const cover = selectCover(parsed.common.picture)
    return { metadata, artwork: cover ? new Uint8Array(cover.data) : undefined }
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

  async getEncoderCapabilities(): Promise<{
    supportedInputFormats: string[]
    supportedOutputFormats: string[]
    encoders: Record<string, { name: string; description: string; available: boolean }>
  }> {
    const knownEncoders = [
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

    const encoderMap: Record<string, { name: string; description: string; available: boolean }> = {}
    let stdout = ''

    try {
      const { spawn } = await import('node:child_process')
      await new Promise<void>((resolve) => {
        const proc = spawn('ffmpeg', ['-encoders'])
        proc.stdout?.on('data', (d) => {
          stdout += d.toString()
        })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
    } catch {
      // fallback if spawn fails
    }

    const supportedOutputFormats = new Set<string>()
    for (const item of knownEncoders) {
      const regex = new RegExp(`\\b${item.key}\\b`, 'i')
      const available = stdout.length > 0 ? regex.test(stdout) : true
      encoderMap[item.key] = {
        name: item.name,
        description: item.description,
        available,
      }
      if (available) {
        supportedOutputFormats.add(item.format)
        if (item.format === 'aac') supportedOutputFormats.add('m4a')
        if (item.format === 'opus') supportedOutputFormats.add('webm')
        if (item.format === 'pcm_s16le') supportedOutputFormats.add('pcm')
      }
    }

    const supportedInputFormats = [
      'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus',
      'wma', 'aiff', 'alac', 'webm', 'pcm', 'ape', 'wv',
    ]

    return {
      supportedInputFormats,
      supportedOutputFormats: Array.from(supportedOutputFormats),
      encoders: encoderMap,
    }
  }

  async transcode(options: TranscodeOptions): Promise<TranscodeResult> {
    const exposed = (globalThis as unknown as {
      window?: {
        BBeBee?: {
          audio?: {
            transcode?: (
              opts: TranscodeOptions,
              onProgress?: (progress: number, currentTimeSeconds: number) => void,
            ) => Promise<TranscodeResult>
            cancelTranscode?: (jobId: string) => Promise<boolean>
          }
        }
      }
    }).window
    const bridgeTranscode = exposed?.BBeBee?.audio?.transcode
    if (bridgeTranscode) {
      if (options.signal?.aborted) {
        return { ok: false, error: 'Cancelled' }
      }

      const jobId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      let cleanupSignal: (() => void) | undefined
      if (options.signal && typeof options.signal.addEventListener === 'function') {
        const onAbort = () => {
          exposed?.BBeBee?.audio?.cancelTranscode?.(jobId)?.catch(() => {})
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        cleanupSignal = () => {
          try {
            options.signal?.removeEventListener?.('abort', onAbort)
          } catch {
            // ignore
          }
        }
      }

      const cleanOptions = {
        jobId,
        inputUri: options.inputUri,
        outputUri: options.outputUri,
        targetFormat: options.targetFormat,
        bitrate: options.bitrate,
        sampleRate: options.sampleRate,
        channels: options.channels,
        bitDepth: options.bitDepth,
        vbr: options.vbr,
        vbrQuality: options.vbrQuality,
        volumeGainDb: options.volumeGainDb,
        fadeInSeconds: options.fadeInSeconds,
        fadeOutSeconds: options.fadeOutSeconds,
        startTimeSeconds: options.startTimeSeconds,
        endTimeSeconds: options.endTimeSeconds,
      }

      try {
        return await bridgeTranscode(cleanOptions, options.onProgress)
      } finally {
        cleanupSignal?.()
      }
    }

    try {
      const { spawn } = await import('node:child_process')
      const { existsSync, statSync, unlinkSync } = await import('node:fs')
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

      if (options.signal?.aborted) {
        return { ok: false, error: 'Cancelled' }
      }

      const args = ['-y']

      if (typeof options.startTimeSeconds === 'number' && options.startTimeSeconds > 0) {
        args.push('-ss', options.startTimeSeconds.toFixed(3))
      }
      if (typeof options.endTimeSeconds === 'number' && options.endTimeSeconds > 0) {
        args.push('-to', options.endTimeSeconds.toFixed(3))
      }

      args.push('-i', inPath)

      const formatsWithCover = new Set(['mp3', 'flac', 'm4a', 'aac', 'mp4', 'alac', 'aiff', 'wma'])
      if (formatsWithCover.has(fmt)) {
        args.push('-map', '0:a', '-map', '0:v?', '-c:v', 'copy')
        if (fmt === 'mp3' || fmt === 'aiff') {
          args.push('-id3v2_version', '3')
        } else if (fmt === 'm4a' || fmt === 'aac' || fmt === 'mp4' || fmt === 'alac') {
          args.push('-disposition:v', 'attached_pic')
        }
      } else {
        args.push('-map', '0:a', '-vn')
      }
      args.push('-map_metadata', '0')

      if (fmt === 'flac') {
        args.push('-c:a', 'flac')
        if (options.bitDepth === 24) {
          args.push('-sample_fmt', 's32')
        } else if (options.bitDepth === 16) {
          args.push('-sample_fmt', 's16')
        }
      } else if (fmt === 'mp3') {
        args.push('-c:a', 'libmp3lame')
        if (options.vbr && typeof options.vbrQuality === 'number') {
          args.push('-q:a', String(Math.max(0, Math.min(9, Math.round(options.vbrQuality)))))
        } else {
          const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '320k'
          args.push('-b:a', b)
        }
      } else if (fmt === 'm4a' || fmt === 'aac' || fmt === 'mp4') {
        args.push('-c:a', 'aac')
        const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '320k'
        args.push('-b:a', b)
      } else if (fmt === 'opus') {
        args.push('-c:a', 'libopus')
        const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '256k'
        args.push('-b:a', b)
      } else if (fmt === 'ogg') {
        args.push('-c:a', 'libvorbis')
        if (options.vbr && typeof options.vbrQuality === 'number') {
          args.push('-q:a', String(Math.max(0, Math.min(10, Math.round(options.vbrQuality)))))
        } else {
          const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '256k'
          args.push('-b:a', b)
        }
      } else if (fmt === 'alac') {
        args.push('-c:a', 'alac')
      } else if (fmt === 'wma') {
        args.push('-c:a', 'wmav2')
        const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '192k'
        args.push('-b:a', b)
      } else if (fmt === 'aiff') {
        if (options.bitDepth === 24) {
          args.push('-c:a', 'pcm_s24be')
        } else {
          args.push('-c:a', 'pcm_s16be')
        }
      } else if (fmt === 'webm') {
        args.push('-c:a', 'libopus')
        const b = options.bitrate ? (options.bitrate.endsWith('k') ? options.bitrate : `${options.bitrate}k`) : '192k'
        args.push('-b:a', b)
      } else if (fmt === 'pcm' || fmt === 'raw') {
        args.push('-f', 's16le', '-c:a', 'pcm_s16le')
      } else if (fmt === 'wav') {
        if (options.bitDepth === 24) {
          args.push('-c:a', 'pcm_s24le')
        } else if (options.bitDepth === 32) {
          args.push('-c:a', 'pcm_s32le')
        } else {
          args.push('-c:a', 'pcm_s16le')
        }
      }

      if (options.sampleRate && options.sampleRate > 0) {
        args.push('-ar', String(Math.round(options.sampleRate)))
      }

      if (options.channels && (options.channels === 1 || options.channels === 2)) {
        args.push('-ac', String(options.channels))
      }

      const filters: string[] = []
      if (typeof options.volumeGainDb === 'number' && options.volumeGainDb !== 0) {
        filters.push(`volume=${options.volumeGainDb}dB`)
      }
      if (typeof options.fadeInSeconds === 'number' && options.fadeInSeconds > 0) {
        filters.push(`afade=t=in:ss=0:d=${options.fadeInSeconds.toFixed(2)}`)
      }
      if (typeof options.fadeOutSeconds === 'number' && options.fadeOutSeconds > 0) {
        const startFade = Math.max(0, (options.endTimeSeconds ?? 0) - options.fadeOutSeconds)
        if (startFade > 0) {
          filters.push(`afade=t=out:st=${startFade.toFixed(2)}:d=${options.fadeOutSeconds.toFixed(2)}`)
        }
      }
      if (filters.length > 0) {
        args.push('-af', filters.join(','))
      }

      args.push(outPath)

      return await new Promise<TranscodeResult>((resolve) => {
        let killed = false
        const proc = spawn('ffmpeg', args)

        const onAbort = () => {
          killed = true
          try {
            proc.kill('SIGTERM')
          } catch {
            // ignore kill failure
          }
          if (existsSync(outPath)) {
            try {
              unlinkSync(outPath)
            } catch {
              // ignore unlink failure
            }
          }
          resolve({ ok: false, error: 'Cancelled' })
        }

        if (options.signal) {
          options.signal.addEventListener('abort', onAbort, { once: true })
        }

        let stderr = ''
        let totalDurationSec = 0

        proc.stderr?.on('data', (d) => {
          const chunk = d.toString()
          stderr += chunk

          if (!totalDurationSec) {
            const matchDuration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(chunk)
            if (matchDuration) {
              const hours = parseFloat(matchDuration[1]!)
              const mins = parseFloat(matchDuration[2]!)
              const secs = parseFloat(matchDuration[3]!)
              totalDurationSec = hours * 3600 + mins * 60 + secs
            }
          }

          const matchTime = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(chunk)
          if (matchTime) {
            const h = parseFloat(matchTime[1]!)
            const m = parseFloat(matchTime[2]!)
            const s = parseFloat(matchTime[3]!)
            const curSec = h * 3600 + m * 60 + s
            if (totalDurationSec > 0 && options.onProgress) {
              const pct = Math.min(99, Math.max(0, Math.round((curSec / totalDurationSec) * 100)))
              options.onProgress(pct, curSec)
            }
          }
        })

        proc.on('close', (code) => {
          if (options.signal) {
            options.signal.removeEventListener('abort', onAbort)
          }
          if (killed) return

          if (code === 0 && existsSync(outPath)) {
            try {
              const st = statSync(outPath)
              options.onProgress?.(100, totalDurationSec)
              resolve({
                ok: true,
                outputSize: st.size,
                durationMs: totalDurationSec ? Math.round(totalDurationSec * 1000) : undefined,
              })
            } catch {
              resolve({ ok: true })
            }
          } else {
            resolve({ ok: false, error: stderr.slice(-500) || `ffmpeg exited with code ${code}` })
          }
        })

        proc.on('error', (err) => {
          if (options.signal) {
            options.signal.removeEventListener('abort', onAbort)
          }
          resolve({ ok: false, error: String(err) })
        })
      })
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  /**
   * Parse through a seekable tokenizer over `ctx.fs` range reads.
   *
   * There is no window to guess anymore: the parser seeks to what it needs —
   * the ID3v2 header declares its length, a tail `moov` is seeked to,
   * appending headers are found backwards from EOF — and each byte is read
   * at most once per parse (plus cache hits, which are free).
   *
   * The *content* decides the container. The extension is a hint of last
   * resort, not the answer: a `.mp3` holding FLAC is a thing real libraries
   * contain, and dispatching on the name reads it with the wrong parser and
   * reports it as untagged. Content sniffing gets it right; the hint is
   * retried only when sniffing fails outright, which is the case of a
   * container music-metadata cannot recognise from its magic bytes but can
   * parse once told.
   */
  private async parse(uri: Uri, options: IOptions, signal?: AbortSignal, size?: number): Promise<IAudioMetadata> {
    // The caller often already knows the size (readMetadataWithArtwork stats
    // up front); pass it through instead of stat-ing twice per file.
    const fileSize = size ?? (await this.ctx.fs.stat(uri)).size
    const hint = mimeFor(uri)
    const attempts: Array<string | undefined> = hint ? [undefined, hint] : [undefined]
    // Bounded first, escalate on failure — the old window escalation's shape,
    // without the re-reads: a normal file parses inside the first budget
    // (256 KB, the old first window; the conformance byte ceiling is
    // measured against it), and only a file whose tag block genuinely
    // exceeds it pays for a second parse. The second budget is 64 MB:
    // large enough for legitimate files with tag chunks far into the file
    // (e.g. a WAV with LIST after a big data chunk), still bounded against
    // pathological drains.
    const firstBudget = 256 * 1024
    const secondBudget = Math.min(fileSize, 64 * 1024 * 1024)
    const budgets = secondBudget > firstBudget ? [firstBudget, secondBudget] : [firstBudget]
    let lastError: unknown
    for (const mimeType of attempts) {
      for (const budget of budgets) {
        const tokenizer = new FsRangeTokenizer(this.ctx.fs, uri, fileSize, signal, mimeType, budget)
        try {
          signal?.throwIfAborted()
          const parsed = await parseFromTokenizer(tokenizer, options)
          if (hasUsableTags(parsed)) return parsed
          /*
           * A parse that found nothing at all is a failure, not a tagless track.
           *
           * ⚠️ This used to return whatever came back. Passing the extension's
           * mime type made the parser trust it, so a zero-byte file, a
           * truncated header and a JPEG renamed `.mp3` all "parsed" — into
           * `{ codec: 'mp3' }`, from the *hint*, with no bytes behind it. The
           * scanner then imported three phantom tracks named after their
           * filenames, which is worse than either of the two honest outcomes:
           * docs/11 §4.7 says a file that will not decode gets
           * `scan_entries.status = 'error'` with a reason, and is never
           * silently absent. It was silently *present* instead.
           *
           * A bigger budget cannot fix a parse that already saw everything —
           * but when the budget ran out mid-parse, the emptiness may be the
           * budget's fault (a tag block cut short reads as "no tags"), so
           * that case escalates instead of breaking to the hint attempt.
           */
          lastError = new Error(`codec: nothing readable in ${this.ctx.fs.basename(uri)}`)
          if (!tokenizer.budgetExhausted) break
        } catch (error) {
          // An abort is not a parse failure: let it propagate instead of
          // falling through to the escalation or the hint retry.
          signal?.throwIfAborted()
          lastError = error
        } finally {
          await tokenizer.close().catch(() => undefined)
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`codec: could not parse ${this.ctx.fs.basename(uri)}`)
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
      // The dsdiff loader's mimeTypes are ['audio/dsf', 'audio/dsd'] —
      // 'audio/dff' matches nothing, so the loader was never selected and
      // DFF fell through to content sniffing (which cannot see FRM8).
      return 'audio/dsd'
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
    ...(common.title ? { title: recoverGbkText(common.title) } : {}),
    ...(common.artist ? { artist: recoverGbkText(common.artist) } : {}),
    ...(common.albumartist ? { albumArtist: recoverGbkText(common.albumartist) } : {}),
    ...(common.album ? { album: recoverGbkText(common.album) } : {}),
    ...(common.track?.no ? { trackNo: common.track.no } : {}),
    ...(common.disk?.no ? { discNo: common.disk.no } : {}),
    ...(common.year ? { year: common.year } : {}),
    ...(common.genre?.length ? { genre: common.genre.map((g) => recoverGbkText(g) ?? g) } : {}),
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
    ...(common.lyrics?.[0]?.text ? { lyrics: recoverGbkText(common.lyrics[0].text) } : {}),
    ...(format.tagTypes?.length ? { tagTypes: format.tagTypes } : {}),
    hasArtwork: (common.picture?.length ?? 0) > 0,
  }
}

/**
 * @deprecated The windowed tag reader is gone: parsing now seeks through
 * `FsRangeTokenizer`, so there is no head window to size. Kept so existing
 * imports do not break; do not use for new code.
 */
export const TAG_WINDOW = 256 * 1024

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
