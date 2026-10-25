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
import type { AudioMetadata, CodecService, DecodedAudio, TranscodeOptions, TranscodeResult, Uri } from '@BBeBee/protocol'
import { parseFromTokenizer, selectCover, type IAudioMetadata, type IOptions } from 'music-metadata'
import type * as childProcess from 'node:child_process'
import type * as nodeUrl from 'node:url'
import type * as nodePath from 'node:path'
import type * as nodeFs from 'node:fs'
import type * as nodeOs from 'node:os'
import { FsRangeTokenizer } from './tokenizer.js'
import { KNOWN_ENCODERS, SUPPORTED_INPUT_FORMATS, deriveOutputFormats } from './encoder-caps.js'

// iconv-lite is the desktop fallback for GBK recovery (it needs Buffer).
// Load it lazily: the first line of defence is the platform TextDecoder
// (see decodeGbk), so React Native never reaches this import at all, and a
// browser bundle never includes it either.
type IconvLite = {
  decode(buffer: Buffer, encoding: string): string
  encode(str: string, encoding: string): Buffer
}
let iconvLite: IconvLite | undefined
async function getIconv(): Promise<IconvLite | undefined> {
  if (iconvLite) return iconvLite
  try {
    const mod = (await import('iconv-lite')) as unknown as {
      default?: IconvLite
    } & IconvLite
    iconvLite = mod.default ?? mod
    return iconvLite
  } catch {
    return undefined
  }
}

/**
 * The platform GBK decoder, when the platform has one.
 *
 * Node ≥ 14 (full ICU — the desktop sidecar) and any shell that installs the
 * WHATWG `text-encoding` polyfill answer `new TextDecoder('gbk')` directly.
 * Hermes does not (UTF-8 only); `null` here means "fall through to iconv or
 * skip recovery".
 */
let platformGbkDecoder: TextDecoder | null | undefined
function getPlatformGbkDecoder(): TextDecoder | null {
  if (platformGbkDecoder === undefined) {
    try {
      platformGbkDecoder = new TextDecoder('gbk')
    } catch {
      platformGbkDecoder = null
    }
  }
  return platformGbkDecoder
}

/** Latin-1 string → bytes without `Buffer`: one byte per UTF-16 code unit. */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

const utf8Encoder: TextEncoder | undefined =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined

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
/**
 * Decode GBK bytes with the first decoder this platform can offer.
 * `undefined` means the platform has none — recovery is skipped.
 */
async function decodeGbkBytes(bytes: Uint8Array): Promise<string | undefined> {
  const platform = getPlatformGbkDecoder()
  if (platform) return platform.decode(bytes)
  const iconv = await getIconv()
  if (!iconv) return undefined
  try {
    return iconv.decode(Buffer.from(bytes), 'gbk')
  } catch {
    return undefined
  }
}

/** @internal — exported for tests; the production path is readMetadata's. */
export async function recoverGbkText(input: string | undefined): Promise<string | undefined> {
  if (!input || typeof input !== 'string') return input
  if (/[\u4e00-\u9fff]/.test(input)) return input

  // Case 1: Latin1 misdecode — no �, but high-byte chars present.
  if (!input.includes('\uFFFD') && /[\u0080-\u00ff]/.test(input)) {
    try {
      const decoded = await decodeGbkBytes(latin1Bytes(input))
      // Require at least 2 CJK characters: a single accented Latin char
      // (e.g. ó in "Jóga") can coincidentally form one valid GBK sequence
      // with its neighbor, but real Chinese text has runs of CJK.
      if (
        decoded !== undefined &&
        decoded !== input &&
        /[\u4e00-\u9fff][\u4e00-\u9fff]/.test(decoded) &&
        !decoded.includes('\uFFFD')
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
  if (input.includes('\uFFFD') && utf8Encoder) {
    const segments = input.split('\uFFFD')
    let recoveredAny = false
    const out: string[] = []
    for (const seg of segments) {
      if (!seg || /[\u4e00-\u9fff]/.test(seg)) {
        out.push(seg)
        continue
      }
      try {
        const decoded = await decodeGbkBytes(utf8Encoder.encode(seg))
        if (
          decoded !== undefined &&
          decoded !== seg &&
          /[\u4e00-\u9fff][\u4e00-\u9fff]/.test(decoded) &&
          !decoded.includes('\uFFFD') &&
          !decoded.includes('\u951F')
        ) {
          recoveredAny = true
          out.push(decoded)
          continue
        }
      } catch {
        // Keep original segment.
      }
      out.push(seg)
    }
    if (recoveredAny) return out.join('\uFFFD')
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
  /**
   * Test seam / embedder override: the raw `ffmpeg -encoders` stdout that
   * `getEncoderCapabilities` parses. Empty string stands for "no local
   * ffmpeg answered", which is the React Native reality and a desktop
   * without ffmpeg on PATH.
   */
  probeEncoders?: () => Promise<string>
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

/** The default local probe: `ffmpeg -encoders` stdout, or empty when nothing answers. */
async function probeLocalFfmpegEncoders(): Promise<string> {
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
    // No `node:child_process` at all (React Native) — the empty stdout says so.
  }
  return stdout
}

export class CodecNode extends Service implements CodecService {  static inject = ['fs']

  private readonly formats: string[]
  private readonly probeEncoders: () => Promise<string>

  constructor(ctx: Context, config: CodecNodeConfig = {}) {
    super(ctx, 'codec')
    this.formats = (config.supportedFormats ?? DEFAULT_FORMATS).map((f) => f.toLowerCase())
    this.probeEncoders = config.probeEncoders ?? probeLocalFfmpegEncoders
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
   * Batch artwork extraction via a dedicated worker process.
   * Files without embedded art yield `undefined` (not an error).
   *
   * The worker process (`artwork-worker.mjs`) runs music-metadata parsing off
   * the sidecar's main event loop, so batch cover fetches don't starve other
   * bridge calls (e.g., 3Hz position updates). Falls back to in-process
   * extraction if the worker cannot be spawned.
   */
  async readArtworkBatch(uris: Uri[]): Promise<Array<Uint8Array | undefined>> {
    const paths = uris.map((u) => uriToFilePath(u as string))
    if (paths.some((p) => p === null)) {
      return this.readArtworkBatchInProcess(uris)
    }
    try {
      return await this.readArtworkBatchViaWorker(paths as string[])
    } catch {
      return this.readArtworkBatchInProcess(uris)
    }
  }

  private async readArtworkBatchInProcess(uris: Uri[]): Promise<Array<Uint8Array | undefined>> {
    const CONCURRENCY = 4
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
        await new Promise((resolve) => setImmediate(resolve))
      }
    })
    await Promise.all(workers)
    return results
  }

  private async readArtworkBatchViaWorker(filePaths: string[]): Promise<Array<Uint8Array | undefined>> {
    const { fork } = (await import('node:child_process')) as typeof childProcess
    const { fileURLToPath } = (await import('node:url')) as typeof nodeUrl
    const { dirname, join } = (await import('node:path')) as typeof nodePath
    const { existsSync } = (await import('node:fs')) as typeof nodeFs
    const { cpus } = (await import('node:os')) as typeof nodeOs

    // Resolve worker script: bundled sidecar has it as sibling of index.mjs
    const here = dirname(fileURLToPath(import.meta.url))
    const workerPath = join(here, 'artwork-worker.mjs')
    if (!existsSync(workerPath)) {
      throw new Error('artwork worker not found')
    }

    // Pool size: min(CPU cores, 4) — artwork parsing is CPU-bound.
    const POOL_SIZE = Math.min(Math.max(cpus().length, 2), 4)
    const results: Array<Uint8Array | undefined> = new Array(filePaths.length)
    // Distribute files round-robin across workers for load balancing.
    // Track global index per file — worker w gets global indices
    // w, w+POOL_SIZE, w+2*POOL_SIZE, ... (NOT contiguous blocks).
    const chunks: Array<Array<{ filePath: string; globalIndex: number }>> = Array.from(
      { length: POOL_SIZE },
      () => [],
    )
    filePaths.forEach((fp, i) => {
      chunks[i % POOL_SIZE]!.push({ filePath: fp, globalIndex: i })
    })

    const workerPromises = chunks.map((chunkFiles, w) => {
      if (chunkFiles.length === 0) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const child = fork(workerPath)
        let pending = chunkFiles.length
        let nextId = 0
        const idToGlobal = new Map<number, number>()

        const cleanup = () => {
          try {
            child.send({ cmd: 'shutdown' })
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            try {
              child.kill()
            } catch {
              /* ignore */
            }
          }, 1000).unref()
        }

        child.on('message', (msg: unknown) => {
          const m = msg as { id: number; artwork: string | null }
          const globalIdx = idToGlobal.get(m.id)
          if (globalIdx !== undefined) {
            results[globalIdx] = m.artwork ? new Uint8Array(Buffer.from(m.artwork, 'base64')) : undefined
            idToGlobal.delete(m.id)
            if (--pending === 0) {
              cleanup()
              resolve()
            }
          }
        })

        child.on('error', (err: Error) => {
          cleanup()
          reject(err)
        })

        child.on('exit', (code: number | null) => {
          if (pending > 0) {
            reject(new Error(`artwork worker ${w} exited early (code ${code}), ${pending} pending`))
          }
        })

        for (let l = 0; l < chunkFiles.length; l++) {
          const id = nextId++
          idToGlobal.set(id, chunkFiles[l]!.globalIndex)
          child.send({ id, filePath: chunkFiles[l]!.filePath })
        }

        setTimeout(() => {
          if (pending > 0) {
            cleanup()
            reject(new Error(`artwork worker ${w} timeout`))
          }
        }, 60000).unref()
      })
    })

    await Promise.all(workerPromises)
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
    const metadata = await toAudioMetadata(parsed, uri, size)
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
    const encoderMap: Record<string, { name: string; description: string; available: boolean }> = {}
    let stdout = ''
    try {
      stdout = await this.probeEncoders()
    } catch {
      // No local ffmpeg answered — handled below like an empty probe.
    }

    /*
     * An empty probe means no local ffmpeg exists — React Native (where the
     * `node:child_process` import throws on the Metro stub) or a desktop
     * without ffmpeg on PATH. Reporting every encoder as available then is a
     * lie the converter UI repeats to the user as a promise the very next
     * transcode cannot keep. The one honest exception is the native-engine
     * bridge: a desktop build without local ffmpeg still transcodes through
     * the engine, whose bundled encoders this probe cannot see.
     */
    const hasNativeEngine = () => {
      const exposed = (globalThis as unknown as {
        window?: { BBeBee?: { audio?: { transcode?: unknown } } }
      }).window
      return typeof exposed?.BBeBee?.audio?.transcode === 'function'
    }
    const probeFailed = stdout.length === 0
    const fallbackAvailable = hasNativeEngine()

    const isAvailable = (key: string): boolean =>
      probeFailed ? fallbackAvailable : new RegExp(`\\b${key}\\b`, 'i').test(stdout)

    for (const item of KNOWN_ENCODERS) {
      encoderMap[item.key] = {
        name: item.name,
        description: item.description,
        available: isAvailable(item.key),
      }
    }

    return {
      supportedInputFormats: [...SUPPORTED_INPUT_FORMATS],
      supportedOutputFormats: deriveOutputFormats(isAvailable),
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
    // (2 MB: large embedded covers (1MB+) are common; the old 256KB cut
    // off pictures mid-read, causing hasArtwork=false for files that DO
    // have covers. The conformance byte ceiling is measured against this),
    // and only a file whose tag block genuinely exceeds it pays for a
    // second parse. The second budget is 64 MB: large enough for legitimate
    // files with tag chunks far into the file (e.g. a WAV with LIST after
    // a big data chunk), still bounded against pathological drains.
    const firstBudget = 2 * 1024 * 1024
    const secondBudget = Math.min(fileSize, 64 * 1024 * 1024)
    const budgets = secondBudget > firstBudget ? [firstBudget, secondBudget] : [firstBudget]
    let lastError: unknown
    for (const mimeType of attempts) {
      for (const budget of budgets) {
        const tokenizer = new FsRangeTokenizer(this.ctx.fs, uri, fileSize, signal, mimeType, budget)
        try {
          signal?.throwIfAborted()
          const parsed = await parseFromTokenizer(tokenizer, options)
          // If the budget ran out mid-parse, format-level info (sampleRate,
          // duration) may be present while tags/pictures are cut off. Only
          // accept the result if we have real tags; otherwise escalate.
          const usable = tokenizer.budgetExhausted
            ? Boolean(
                parsed.common.title ??
                  parsed.common.artist ??
                  parsed.common.album ??
                  (parsed.common.picture?.length ? true : undefined),
              )
            : hasUsableTags(parsed)
          if (usable) return parsed
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
export async function toAudioMetadata(
  parsed: IAudioMetadata,
  uri: string,
  fileSize?: number,
): Promise<AudioMetadata> {
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

  const [title, artist, albumArtist, album, genre, lyrics] = await Promise.all([
    common.title ? recoverGbkText(common.title) : undefined,
    common.artist ? recoverGbkText(common.artist) : undefined,
    common.albumartist ? recoverGbkText(common.albumartist) : undefined,
    common.album ? recoverGbkText(common.album) : undefined,
    common.genre?.length
      ? Promise.all(common.genre.map((g) => recoverGbkText(g).then((r) => r ?? g)))
      : undefined,
    common.lyrics?.[0]?.text ? recoverGbkText(common.lyrics[0].text) : undefined,
  ])

  return {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(albumArtist ? { albumArtist } : {}),
    ...(album ? { album } : {}),
    ...(common.track?.no ? { trackNo: common.track.no } : {}),
    ...(common.disk?.no ? { discNo: common.disk.no } : {}),
    ...(common.year ? { year: common.year } : {}),
    ...(genre?.length ? { genre } : {}),
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
    ...(lyrics ? { lyrics } : {}),
    ...(format.tagTypes?.length ? { tagTypes: format.tagTypes } : {}),
    hasArtwork: (common.picture?.length ?? 0) > 0,
  }
}

/**
 * @deprecated The windowed tag reader is gone: parsing now seeks through
 * `FsRangeTokenizer`, so there is no head window to size. Kept so existing
 * imports do not break; do not use for new code.
 */
export const TAG_WINDOW = 2 * 1024 * 1024

export {
  KNOWN_ENCODERS,
  SUPPORTED_INPUT_FORMATS,
  deriveOutputFormats,
  type KnownEncoder,
} from './encoder-caps.js'

export const name = 'core-codec-desktop'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.codec` is usable.
 */
export async function apply(ctx: Context, config: CodecNodeConfig = {}) {
  ctx.logger.info('core-codec-desktop: loaded')
  const fiber = await ctx.plugin(CodecNode, config)
  return () => void fiber.dispose()
}

export default { name, apply }

/**
 * Convert a file URI to a local filesystem path for the artwork worker.
 * Returns null if the URI is not a local file.
 */
function uriToFilePath(uri: string): string | null {
  try {
    const fileUrl = uri.replace(/^bbebee-file:\/*/, 'file:///')
    if (!fileUrl.startsWith('file://')) return null
    // fileURLToPath is Node-only; guard for non-Node environments
    if (typeof process === 'undefined' || !process.versions?.node) return null
    // Dynamic require to avoid bundling issues in non-Node targets
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fileURLToPath } = require('node:url') as typeof nodeUrl
    const p = fileURLToPath(fileUrl)
    // Windows: /C:/path -> C:/path
    if (/^\/[a-zA-Z]:[\\/]/.test(p)) {
      return decodeURIComponent(p.slice(1))
    }
    return p
  } catch {
    return null
  }
}
