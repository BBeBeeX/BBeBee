/**
 * The pure half of the native audio-engine binding: adapters that shape the
 * `BbebeeAudioEngine` Expo module surface into the two seams the app probes.
 *
 * Split from `index.ts` so unit tests can exercise the mapping (the JSON
 * contracts, the header serialization, the degrade-on-not-ok rule) without
 * importing `expo`, which has no vitest alias — `index.ts` is the only file
 * allowed to touch `requireNativeModule`, and it is loaded for its side
 * effect from `boot.ts`.
 *
 * - `buildMpvAdapter` installs as `globalThis.bbebeeMobileMpv` — the playback
 *   contract table in `docs/audio/engine.md`.
 * - `buildCodecAdapter` installs as `globalThis.bbebeeNativeCodec` — the
 *   codec seam `CodecRn` reads for batch artwork and FFmpeg transcoding,
 *   backed by the same `libbbebee_audio_jni.so`.
 */

/** mpv takes one `http-header-fields` string: `Key: Value\r\n…`. */
export function headersToFields(headers?: Record<string, string>): string | null {
  if (!headers) return null
  const entries = Object.entries(headers).filter(([, v]) => v != null)
  if (entries.length === 0) return null
  return entries.map(([k, v]) => `${k}: ${v}`).join('\r\n')
}

/**
 * The Kotlin/Expo surface — one method per JNI export. The C++ declarations
 * in `engine/jni/bbebee_audio_jni.hpp` (B_Be_Bee-audio-engine) are the
 * authority for payloads; JSON answers arrive as strings and parse here.
 */
export interface NativeAudioEngine {
  loadEx(uri: string, headers: string | null): Promise<string>
  append(uri: string, headers: string | null): Promise<boolean>
  playAt(atMs: number): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  seekMs(ms: number): Promise<void>
  setVolume(volume01: number): Promise<void>
  setMuted(muted: boolean): Promise<void>
  getState(): Promise<string>
  engineStatus(): Promise<string>
  /** Destroy and re-create the native mpv context; true when the new engine came up. */
  reinit(): Promise<boolean>
  setVisualizer(enabled: boolean, fftSize: number): Promise<void>
  setDspConfig(
    af: string,
    replaygain: string,
    replaygainClip: boolean,
    replaygainPreamp: string,
    replaygainFallback: string,
  ): Promise<void>
  setOutputDevice(id: string): Promise<void>
  setStreamPlayback(playing: boolean): Promise<void>
  setAudioExclusive(exclusive: boolean): Promise<void>
  /**
   * mpv's `audio-device-list` shape, as a JSON string: `[{ name, description }]`,
   * with the system default route reported as `name: 'auto'` — exactly what the
   * desktop engine supervisor's `audio-devices` payload carries, and what
   * `core-audio-mpv`'s `listOutputDevices` maps into `OutputDevice`s.
   */
  mpvGetAudioDevices(): Promise<string>
  getSpectrum(): Promise<{
    ok: boolean
    frequencyData: number[]
    timeDomainData: number[]
  }>
  // Codec seam: transcode + batch artwork.
  transcode(options: NativeTranscodeParams): Promise<string>
  cancelTranscode(jobId: string): Promise<boolean>
  getTranscodeState(jobId: string): Promise<string>
  getTranscodeCapabilities(): Promise<string>
  readArtworkBatch(uris: string[]): Promise<Array<string | null>>
}

/** The `mpvLoad` answer — the trailing fields are optional in the contract
 * and arrive only once mpv's audio chain knows them. */
export interface MpvLoadResult {
  ok: boolean
  durationMs: number
  resumed: boolean
  endedCount: number
  sampleRate?: number
  channels?: number
  bitDepth?: number
}

export interface MpvStateResult {
  positionMs: number
  durationMs: number
  // `error`: the engine went idle (or lost its mpv core) after a load had
  // taken, with no user stop — the polling model's reading of a mid-track
  // failure, which the handle turns into a stall or a skip.
  status: 'idle' | 'playing' | 'paused' | 'ended' | 'error'
  endedCount: number
}

export interface EngineStatusResult {
  running: boolean
  mpvAvailable: boolean
  pcmTapAvailable: boolean
  transcodeAvailable?: boolean
}

/** One entry of the native `mpvGetAudioDevices` answer (mpv's device list). */
export interface MpvAudioDevice {
  /** The device id in the engine's vocabulary; `auto` is the default route. */
  name: string
  description: string
}

export interface NativeTranscodeParams {
  jobId?: string
  inputUri: string
  outputUri: string
  format: string
  bitrate?: string
  sampleRate?: number
  channels?: number
  startSeconds?: number
  endSeconds?: number
  /**
   * The desktop ffmpeg options, forwarded verbatim. The native layer rules on
   * them: the start answer's `unsupported` names any field the linked engine
   * build cannot apply, so callers never guess what the engine supports.
   */
  bitDepth?: number
  vbr?: boolean
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
}

export interface TranscodeStartAnswer {
  ok: boolean
  jobId?: string
  error?: string
  /** Fields the linked engine build cannot apply (absent when all were honoured). */
  unsupported?: string[]
}

export interface TranscodeState {
  jobId: string
  found: boolean
  running: boolean
  done: boolean
  ok: boolean
  cancelled: boolean
  progress: number
  currentTimeSec: number
  durationSec: number
  error?: string
}

export interface TranscodeCapabilities {
  supported: boolean
  encoders: Record<string, boolean>
}

/**
 * The playback seam. The shape is the contract table in
 * `docs/audio/engine.md`; nothing may drift from it or the engine's probes
 * start lying.
 */
export function buildMpvAdapter(native: NativeAudioEngine) {
  return {
    async mpvLoad(uri: string, opts?: { strategy?: string; headers?: Record<string, string> }) {
      const parsed = JSON.parse(await native.loadEx(uri, headersToFields(opts?.headers))) as MpvLoadResult
      // The engine treats "no answer" as the degrade signal; `ok: false`
      // must therefore arrive as undefined, not as a truthy error object.
      return parsed.ok ? parsed : undefined
    },
    async mpvAppend(uri: string, _play?: boolean, opts?: { headers?: Record<string, string> }) {
      await native.append(uri, headersToFields(opts?.headers))
    },
    mpvPlay(atMs?: number) {
      // NaN is the "keep the engine's own position" marker the JNI side reads.
      return native.playAt(atMs ?? Number.NaN)
    },
    mpvPause: () => native.pause(),
    mpvStop: () => native.stop(),
    mpvSeek: (ms: number) => native.seekMs(ms),
    mpvSetVolume: (v: number) => native.setVolume(v),
    mpvSetMuted: (m: boolean) => native.setMuted(m),
    async mpvGetState() {
      return JSON.parse(await native.getState()) as MpvStateResult
    },
    async mpvGetFftFrame() {
      const frame = await native.getSpectrum()
      return frame.ok
        ? { frequencyData: frame.frequencyData, timeDomainData: frame.timeDomainData }
        : null
    },
    mpvSetVisualizer: (enabled: boolean, fftSize?: number) =>
      native.setVisualizer(enabled, fftSize ?? 0),
    async mpvEngineStatus() {
      return JSON.parse(await native.engineStatus()) as EngineStatusResult
    },
    /**
     * The mpv-shaped device list. Android has no mpv `audio-device-list` to
     * copy — the engine runs its own AudioManager — so the Kotlin side maps
     * its output devices into mpv's `{ name, description }` vocabulary (with
     * the default route as `auto`) and this parses it like every other JSON
     * answer. `core-audio-mpv`'s `listOutputDevices` maps `name`→`id` and
     * flags `auto`/`default` as the default, so no second mapping lives here.
     */
    async mpvGetAudioDevices(): Promise<MpvAudioDevice[]> {
      return JSON.parse(await native.mpvGetAudioDevices()) as MpvAudioDevice[]
    },
    // The recovery seam for a wedged native engine (destroy + re-create the
    // context). Deliberately not called by the adapter itself: when to give
    // up on the live engine is the service's policy, not the mapping's.
    mpvReinit: () => native.reinit(),
    mpvSetDspConfig: (cfg: {
      af?: string
      replaygain?: string
      replaygainClip?: boolean
      replaygainPreamp?: string
      replaygainFallback?: string
    }) =>
      native.setDspConfig(
        cfg.af ?? '',
        cfg.replaygain ?? 'no',
        cfg.replaygainClip === true,
        cfg.replaygainPreamp ?? '0',
        cfg.replaygainFallback ?? '0',
      ),
    mpvSetOutputDevice: (id: string) => native.setOutputDevice(id),
    // `shared.ts` probes this plain name (not the `mpv`-prefixed one) when
    // routing output by engine vocabulary.
    setOutputDevice: (id: string) => native.setOutputDevice(id),
    mpvSetStreamPlayback: (playing: boolean) => native.setStreamPlayback(playing),
    mpvSetAudioExclusive: (exclusive: boolean) => native.setAudioExclusive(exclusive),
  }
}

/**
 * The codec seam. Batch artwork answers are positional `(string | null)[]`
 * — base64 per hit, `null` per miss — which `CodecRn` converts to the
 * protocol's `Uint8Array | undefined` shape. Transcode answers mirror the
 * C++ job registry's JSON verbatim.
 */
export function buildCodecAdapter(native: NativeAudioEngine) {
  return {
    readArtworkBatch: (uris: string[]): Promise<Array<string | null>> => {
      if (uris.length === 0) return Promise.resolve([])
      return native.readArtworkBatch(uris)
    },
    async transcode(opts: NativeTranscodeParams): Promise<TranscodeStartAnswer> {
      // The native module takes one record; absent fields become the C++
      // side's defaults (empty bitrate → encoder default, 0 → keep source,
      // 0 times → no trim).
      const answer = JSON.parse(await native.transcode(opts)) as TranscodeStartAnswer
      return answer
    },
    cancelTranscode: (jobId: string): Promise<boolean> => native.cancelTranscode(jobId),
    async getTranscodeState(jobId: string): Promise<TranscodeState> {
      return JSON.parse(await native.getTranscodeState(jobId)) as TranscodeState
    },
    async getTranscodeCapabilities(): Promise<TranscodeCapabilities> {
      return JSON.parse(await native.getTranscodeCapabilities()) as TranscodeCapabilities
    },
  }
}
