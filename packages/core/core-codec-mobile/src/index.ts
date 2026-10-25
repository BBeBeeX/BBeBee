/**
 * `ctx.codec` on iOS and Android.
 *
 * ## What is inherited, what is native, and why the line moved
 *
 * This package extends the desktop implementation rather than duplicating it.
 * Tag reading in `core-codec-desktop` is `music-metadata` over `ctx.fs` — no
 * `node:fs`, no Node API, nothing platform-shaped anywhere in it — so single
 * reads (`readMetadata`, `readArtwork`, `readMetadataWithArtwork`) stay with
 * the inherited pure-JS parser: a native tag reader for those would add a
 * native module to every mobile build to produce a second answer to a
 * question that already has one, and the risk register's second-loudest
 * entry is two implementations of one service drifting apart.
 *
 * Three things genuinely differ on a device, and they are implemented here:
 *
 * - **`supportedFormats()`**, which is the OS decoder's answer and differs by
 *   OS version. It is configured by the shell, which knows its engine.
 * - **`decode()`**, which is `react-native-audio-api`'s `decodeAudioData`
 *   rather than the renderer's — the one place a platform SDK is genuinely
 *   required.
 * - **`readArtworkBatch()`, `transcode()` and `getEncoderCapabilities()`**,
 *   which ride the native audio-engine library through the
 *   `bbebeeNativeCodec` seam when it is present. Batch artwork parsing on
 *   Hermes stalls the UI thread for the whole scan (the inherited fallback
 *   parses `music-metadata` cooperatively but still on-thread), and mobile
 *   has no `node:child_process` to shell out to ffmpeg with — the engine's
 *   bundled libavcodec is the only encoder on the device. When the seam is
 *   missing (a JS-only build, a dev client predating the module), every
 *   override falls back to the inherited implementation, which stays correct
 *   — batch answers are honest and transcode keeps failing with a clear
 *   error instead of pretending.
 *
 * ⚠️ `music-metadata` on Hermes needs more than the runtime's UTF-8-only
 * `TextDecoder`: a Latin-1 ID3v2.3 tag written by a 2004 ripper, and the
 * codec's GBK recovery, both need legacy encodings. The mobile shell
 * installs the full WHATWG `text-encoding` implementation at boot, before
 * anything reads a tag (see `apps/mobile/src/boot.ts`); without that
 * install, GBK recovery is skipped and old Latin-1 titles mangle (docs/11 §8).
 *
 * See docs/04 §13 and docs/11 §4.1.
 */

import { decodeAudioData } from 'react-native-audio-api'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  DecodedAudio,
  TranscodeOptions,
  TranscodeResult,
  Uri,
} from '@BBeBee/protocol'
import { decodeBase64 } from '@BBeBee/toolkit'
import {
  CodecNode,
  KNOWN_ENCODERS,
  SUPPORTED_INPUT_FORMATS,
  deriveOutputFormats,
  type CodecNodeConfig,
} from '@bbebee/core-codec-desktop'

export interface CodecRnConfig extends CodecNodeConfig {
  /**
   * Formats the device can decode.
   *
   * ⚠️ Left unset, the default is `CodecNode`'s own list — the 15 formats the
   * bundled native engine decodes — and that is the honest answer here: the
   * mobile engine *is* the same bundled libmpv/libavcodec build the desktop
   * native engine runs (staged by `with-audio-engine` from the same release
   * artifacts), so its decode capability is the desktop engine's. The old
   * hand-picked six under-declared it, and a track in one of the missing
   * containers (ogg, opus, wma, ape, wv, dsf, dff, m4b) imported as an error
   * the file did not deserve. The shell may still configure a narrower list
   * for a build it knows shipped without the engine.
   */
  supportedFormats?: string[]
}

/**
 * The `bbebeeNativeCodec` seam — installed by
 * `apps/mobile/modules/audio-engine/index.ts` when the native module is in
 * the build. Structural, not imported, because this package must load in
 * vitest and on desktop where no such global exists.
 */
interface NativeCodecSeam {
  readArtworkBatch(uris: string[]): Promise<Array<string | null>>
  transcode(options: {
    jobId?: string
    inputUri: string
    outputUri: string
    format: string
    bitrate?: string
    sampleRate?: number
    channels?: number
    startSeconds?: number
    endSeconds?: number
    // The desktop ffmpeg options, forwarded verbatim. The native layer rules
    // on them: the start answer's `unsupported` names any field the linked
    // engine build cannot apply, so this side never has to guess what the
    // engine supports.
    bitDepth?: number
    vbr?: boolean
    vbrQuality?: number
    volumeGainDb?: number
    fadeInSeconds?: number
    fadeOutSeconds?: number
  }): Promise<{ ok: boolean; jobId?: string; error?: string; unsupported?: string[] }>
  cancelTranscode(jobId: string): Promise<boolean>
  getTranscodeState(jobId: string): Promise<{
    found: boolean
    running: boolean
    done: boolean
    ok: boolean
    cancelled: boolean
    progress: number
    currentTimeSec: number
    durationSec: number
    error?: string
  }>
  getTranscodeCapabilities(): Promise<{ supported: boolean; encoders: Record<string, boolean> }>
}

/**
 * Probe and shape-check the seam. A global that exists but does not answer
 * the surface (a stale dev client pairing a new JS bundle) must count as
 * absent, or every call below would trust a half-seam.
 */
function probeNativeCodec(): NativeCodecSeam | undefined {
  const seam = (globalThis as { bbebeeNativeCodec?: unknown }).bbebeeNativeCodec
  if (
    seam &&
    typeof (seam as NativeCodecSeam).readArtworkBatch === 'function' &&
    typeof (seam as NativeCodecSeam).transcode === 'function' &&
    typeof (seam as NativeCodecSeam).cancelTranscode === 'function' &&
    typeof (seam as NativeCodecSeam).getTranscodeState === 'function' &&
    typeof (seam as NativeCodecSeam).getTranscodeCapabilities === 'function'
  ) {
    return seam as NativeCodecSeam
  }
  return undefined
}

/** How often the transcode poll reads the native job registry. */
const TRANSCODE_POLL_MS = 200

export class CodecRn extends CodecNode {
  constructor(ctx: Context, config: CodecRnConfig = {}) {
    // No format override: the default is the bundled libmpv engine's list
    // (`CodecNode`'s own), which is what the phone actually decodes. See
    // `CodecRnConfig.supportedFormats`.
    super(ctx, config)
  }

  /**
   * Decode to PCM through the audio engine.
   *
   * Desktop refuses this outright and sends callers to `ctx.audio`, because
   * the renderer's `decodeAudioData` is right there. Mobile has the same
   * decoder behind an import rather than behind a graph, so answering here
   * costs nothing and saves every caller a platform branch.
   */
  override async decode(data: Uint8Array | Uri): Promise<DecodedAudio> {
    const bytes =
      typeof data === 'string'
        ? await this.ctx.fs.readBytes(data)
        : data

    // A copy, because `decodeAudioData` takes ownership of the buffer it is
    // given and a `Uint8Array` view onto a larger allocation would hand it
    // more than it was offered.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    const decoded = await decodeAudioData(buffer)
    const channels: Float32Array[] = []
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(decoded.getChannelData(channel))
    }
    return {
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      pcm: channels,
    }
  }

  /**
   * Batch artwork through the native worker pool: `MediaMetadataRetriever`
   * parsing on its own threads, answering positional base64 strings that
   * convert to the protocol's `Uint8Array | undefined` per entry. Any
   * structural surprise — seam gone mid-call, wrong answer length, a
   * rejection — degrades to the inherited in-process path, which is slower
   * but never wrong.
   */
  override async readArtworkBatch(uris: Uri[]): Promise<Array<Uint8Array | undefined>> {
    const seam = probeNativeCodec()
    if (!seam || uris.length === 0) return super.readArtworkBatch(uris)

    try {
      const answers = await seam.readArtworkBatch(uris.map((u) => String(u)))
      // The contract is positional; a length mismatch means the answers
      // cannot be attributed and the batch would silently misalign covers.
      if (answers.length !== uris.length) throw new Error('native artwork batch length mismatch')
      return answers.map((entry) => {
        if (!entry) return undefined
        try {
          return decodeBase64(entry)
        } catch {
          return undefined
        }
      })
    } catch {
      return super.readArtworkBatch(uris)
    }
  }

  /**
   * Transcode through the engine's libav pipeline: a JNI job registry, a
   * detached native worker, progress polled here and forwarded to the
   * caller's `onProgress`, cancellation through the same cooperative flag
   * the desktop engine honours.
   *
   * The full `TranscodeOptions` surface is forwarded to the seam verbatim —
   * `bitDepth`, `vbr`/`vbrQuality`, `volumeGainDb` and the fades included.
   * The native layer rules on them: the start answer carries an
   * `unsupported` list naming any field the linked engine build cannot
   * apply, and this side turns that report into one `logger.warn` before
   * the job runs — parity is not silence, but the ruling belongs to the
   * engine, not to a guessed field list that drifts the moment the engine
   * grows a receiver. A cancelled or failed job leaves any partial output
   * in place; the converter layer owns its temp path cleanup, same as on
   * desktop.
   */
  override async transcode(options: TranscodeOptions): Promise<TranscodeResult> {
    const seam = probeNativeCodec()
    if (!seam) return super.transcode(options)

    if (options.signal?.aborted) {
      return { ok: false, error: 'Cancelled' }
    }

    // Probe once: a build without HAVE_LIBAV answers `supported: false`, and
    // falling through then would hit the Metro-stubbed child_process import
    // and report an error no more informative than this honest refusal.
    try {
      const caps = await seam.getTranscodeCapabilities()
      if (!caps.supported) {
        return {
          ok: false,
          error: 'Native transcoder unavailable in this build (no FFmpeg)',
        }
      }
    } catch {
      return super.transcode(options)
    }

    const jobId = `rn-tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    let started: { ok: boolean; jobId?: string; error?: string; unsupported?: string[] }
    try {
      started = await seam.transcode({
        jobId,
        inputUri: String(options.inputUri),
        outputUri: String(options.outputUri),
        format: options.targetFormat,
        bitrate: options.bitrate,
        sampleRate: options.sampleRate,
        channels: options.channels,
        startSeconds: options.startTimeSeconds,
        endSeconds: options.endTimeSeconds,
        bitDepth: options.bitDepth,
        vbr: options.vbr,
        vbrQuality: options.vbrQuality,
        volumeGainDb: options.volumeGainDb,
        fadeInSeconds: options.fadeInSeconds,
        fadeOutSeconds: options.fadeOutSeconds,
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (!started.ok || !started.jobId) {
      return { ok: false, error: started.error ?? 'Native transcoder refused the job' }
    }

    // The engine's own ruling on the extended options, echoed once. Fields it
    // did apply produce no warning at all — this is the seam's answer, not a
    // hard-coded drop list.
    if (started.unsupported && started.unsupported.length > 0) {
      this.ctx.logger.warn(
        `transcode: native engine cannot apply ${started.unsupported.join(', ')} in this build — output will ignore them (only the desktop local-ffmpeg path honours these today)`,
      )
    }

    const nativeJobId = started.jobId

    // The poll loop nudges the cancel flag as long as the signal stays
    // aborted; the listener exists so an abort between polls lands within
    // milliseconds instead of on the next tick.
    const onAbort = (): void => {
      void seam.cancelTranscode(nativeJobId).catch(() => {})
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const startedAt = Date.now()
    try {
      while (true) {
        if (options.signal?.aborted) {
          void seam.cancelTranscode(nativeJobId).catch(() => {})
        }

        let state
        try {
          state = await seam.getTranscodeState(nativeJobId)
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
        if (!state.found) {
          return { ok: false, error: 'Transcode job vanished from the native registry' }
        }

        if (state.done) {
          if (state.ok) {
            let outputSize: number | undefined
            try {
              const stat = await this.ctx.fs.stat(String(options.outputUri))
              outputSize = stat.size
            } catch {
              // A stat failure must not erase a transcode that succeeded.
            }
            return { ok: true, outputSize, durationMs: Date.now() - startedAt }
          }
          return {
            ok: false,
            error: state.error ?? (state.cancelled ? 'Cancelled' : 'Transcode failed'),
          }
        }

        options.onProgress?.(state.progress, state.currentTimeSec)
        await new Promise((resolve) => setTimeout(resolve, TRANSCODE_POLL_MS))
      }
    } finally {
      try {
        options.signal?.removeEventListener('abort', onAbort)
      } catch {
        // The signal does not owe us a removal API.
      }
    }
  }

  /**
   * Encoder capabilities straight from the linked libavcodec, laid over the
   * shared vocabulary (`KNOWN_ENCODERS`) so the converter UI sees the same
   * encoder ids and the same output-format derivation it gets on desktop —
   * only the availability source differs.
   */
  override async getEncoderCapabilities(): Promise<{
    supportedInputFormats: string[]
    supportedOutputFormats: string[]
    encoders: Record<string, { name: string; description: string; available: boolean }>
  }> {
    const seam = probeNativeCodec()
    if (seam) {
      try {
        const caps = await seam.getTranscodeCapabilities()
        if (caps.supported) {
          const encoders: Record<string, { name: string; description: string; available: boolean }> = {}
          for (const item of KNOWN_ENCODERS) {
            encoders[item.key] = {
              name: item.name,
              description: item.description,
              available: caps.encoders[item.key] === true,
            }
          }
          return {
            supportedInputFormats: [...SUPPORTED_INPUT_FORMATS],
            supportedOutputFormats: deriveOutputFormats((key) => caps.encoders[key] === true),
            encoders,
          }
        }
      } catch {
        // Fall through to the inherited desktop-shaped probe.
      }
    }
    return super.getEncoderCapabilities()
  }
}

export const name = 'core-codec-mobile'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.codec` is usable.
 */
export async function apply(ctx: Context, config: CodecRnConfig = {}) {
  ctx.logger.info('core-codec-mobile: loaded')
  const fiber = await ctx.plugin(CodecRn, config)
  return () => void fiber.dispose()
}

export default { name, apply }
