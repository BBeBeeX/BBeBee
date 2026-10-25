/**
 * The JS half of the native audio-engine binding (`libbbebee_audio_jni.so`).
 *
 * Installs `globalThis.bbebeeMobileMpv` — the seam `createMobileMpvBridge` in
 * `apps/mobile/src/mobile-audio.ts` probes — as a thin adapter over the
 * `BbebeeAudioEngine` Expo module, which forwards to the JNI bridge built by
 * `B_Be_Bee-audio-engine` (`engine/jni/bbebee_audio_jni.cpp`). The method
 * surface is the contract table in `docs/audio/engine.md`; nothing here may
 * drift from it, or the engine's probes start lying.
 *
 * ⚠️ Loaded for its side effect from `boot.ts` and nowhere else: a build
 * without the native module (a dev client predating it, a JS-only run) must
 * fall back to the in-process simulation bridge rather than crash, so the
 * probe lives in one guarded place that runs before the audio service mounts.
 * It deliberately does NOT live in `mobile-audio.ts`, which unit tests import
 * without an Expo runtime.
 */

import { requireNativeModule } from 'expo'

interface NativeAudioEngine {
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
  getSpectrum(): Promise<{
    ok: boolean
    frequencyData: number[]
    timeDomainData: number[]
  }>
}

/** mpv takes one `http-header-fields` string: `Key: Value\r\n…`. */
function headersToFields(headers?: Record<string, string>): string | null {
  if (!headers) return null
  const entries = Object.entries(headers).filter(([, v]) => v != null)
  if (entries.length === 0) return null
  return entries.map(([k, v]) => `${k}: ${v}`).join('\r\n')
}

function install(): void {
  const globals = globalThis as { bbebeeMobileMpv?: unknown }
  if (globals.bbebeeMobileMpv) return

  let native: NativeAudioEngine
  try {
    native = requireNativeModule<NativeAudioEngine>('BbebeeAudioEngine')
  } catch {
    // No native module in this build — the simulation bridge takes over.
    return
  }

  globals.bbebeeMobileMpv = {
    async mpvLoad(uri: string, opts?: { strategy?: string; headers?: Record<string, string> }) {
      const parsed = JSON.parse(await native.loadEx(uri, headersToFields(opts?.headers))) as {
        ok: boolean
        durationMs: number
        resumed: boolean
        endedCount: number
      }
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
      return JSON.parse(await native.getState()) as {
        positionMs: number
        durationMs: number
        status: 'idle' | 'playing' | 'paused' | 'ended'
        endedCount: number
      }
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
      return JSON.parse(await native.engineStatus()) as {
        running: boolean
        mpvAvailable: boolean
        pcmTapAvailable: boolean
      }
    },
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

install()
