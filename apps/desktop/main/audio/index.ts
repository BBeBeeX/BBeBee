import { FfmpegDecoder } from './ffmpeg-decoder.js'
import { AudioDeviceEnumerator, type AudioMainLogger } from './audio-devices.js'
import { AudioEngineSupervisor, type FftFrame, type PlaybackStateEvent } from './audio-engine-supervisor.js'
import type { AudioDecodedPcm, AudioProbeResult, AudioRequestOptions } from './types.js'
export * from './types.js'
export { FfmpegDecoder } from './ffmpeg-decoder.js'
export { AudioDeviceEnumerator, cleanAndTagDeviceLabel, type AudioMainLogger } from './audio-devices.js'
export { AudioEngineSupervisor, type FftFrame, type PlaybackStateEvent, type CrashEvent } from './audio-engine-supervisor.js'

export interface DspConfig {
  eq?: {
    enabled: boolean
    /** 10 bands in dB: 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 */
    gains: number[]
  }
  preamp?: {
    enabled: boolean
    gainDb: number
  }
  compressor?: {
    enabled: boolean
    threshold?: number
    ratio?: number
    attack?: number
    release?: number
  }
}

export interface AudioHostApi {
  probe(uri: string, options?: AudioRequestOptions): Promise<AudioProbeResult>
  decodePcm(uri: string, options?: AudioRequestOptions): Promise<AudioDecodedPcm>
  getOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]>
  setOutputDevice(id: string): Promise<void>

  // MPV Audio Engine operations
  mpvLoad(uri: string, options?: AudioRequestOptions): Promise<{ durationMs: number; resumed?: boolean }>
  mpvAppend(uri: string, playNow?: boolean): Promise<void>
  mpvPlay(atMs?: number): Promise<void>
  mpvPause(): Promise<void>
  mpvStop(): Promise<void>
  mpvSeek(positionMs: number): Promise<void>
  mpvSetVolume(volume: number): Promise<void>
  mpvSetMuted(muted: boolean): Promise<void>
  mpvSetDspConfig(config: DspConfig): Promise<void>
  mpvSetVisualizer(enabled: boolean, fftSize?: number): Promise<void>
  mpvGetFftFrame(): Promise<FftFrame | null>
  mpvGetState(): Promise<PlaybackStateEvent>
  mpvGetAudioDevices(): Promise<Array<{ name: string; description: string }>>

  readonly supervisor: AudioEngineSupervisor
}

export function createAudioHost(logger?: AudioMainLogger): AudioHostApi {
  const decoder = new FfmpegDecoder()
  const devices = new AudioDeviceEnumerator(logger)
  const supervisor = new AudioEngineSupervisor(logger)

  let lastState: PlaybackStateEvent = {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
  }
  let lastFftFrame: FftFrame | null = null

  supervisor.onStateChange((state) => {
    lastState = state
  })

  supervisor.onFftFrame((frame) => {
    lastFftFrame = frame
  })

  return {
    probe: (uri, options) => decoder.probe(uri, options),
    decodePcm: (uri, options) => decoder.decodePcm(uri, options),
    getOutputDevices: () => devices.getOutputDevices(),
    setOutputDevice: async (id) => {
      await devices.setOutputDevice(id)
      supervisor.setOutputDevice(id)
    },

    mpvLoad: async (uri, options) => {
      return supervisor.load(uri, options)
    },
    mpvAppend: async (uri, playNow) => {
      return supervisor.append(uri, playNow)
    },
    mpvPlay: async (atMs) => {
      // `null` arrives over IPC when the renderer omitted the position: a
      // position-less play must reach the engine as "no seek" (resume from
      // its own clock), not as a seek back to zero.
      supervisor.play(typeof atMs === 'number' && atMs >= 0 ? atMs : undefined)
    },
    mpvPause: async () => {
      supervisor.pause()
    },
    mpvStop: async () => {
      supervisor.stop()
    },
    mpvSeek: async (positionMs) => {
      supervisor.seek(positionMs)
    },
    mpvSetVolume: async (volume) => {
      supervisor.setVolume(volume)
    },
    mpvSetMuted: async (muted) => {
      supervisor.setMuted(muted)
    },
    mpvSetDspConfig: async (config) => {
      supervisor.setDspConfig(config)
    },
    mpvSetVisualizer: async (enabled, fftSize) => {
      supervisor.setVisualizer(enabled, fftSize)
    },
    mpvGetFftFrame: async () => {
      return lastFftFrame
    },
    mpvGetState: async () => {
      return lastState
    },
    mpvGetAudioDevices: async () => {
      return supervisor.getAudioDevices()
    },

    supervisor,
  }
}
