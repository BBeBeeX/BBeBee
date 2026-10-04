import type { AudioRequestOptions } from './types.js'
import { AudioDeviceEnumerator, type AudioMainLogger } from './audio-devices.js'
import { AudioEngineSupervisor, type FftFrame, type PlaybackStateEvent } from './audio-engine-supervisor.js'
export { AudioDeviceEnumerator, cleanAndTagDeviceLabel, type AudioMainLogger } from './audio-devices.js'
export { AudioEngineSupervisor, type FftFrame, type PlaybackStateEvent, type CrashEvent } from './audio-engine-supervisor.js'

export interface DspConfig {
  /** The enabled effect chain serialized as a libavfilter fragment list. */
  af?: string
  replaygain?: string
  replaygainClip?: boolean
  replaygainPreamp?: string
  replaygainFallback?: string
}

export interface AudioHostApi {
  getOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]>
  setOutputDevice(id: string): Promise<void>

  // MPV Audio Engine operations
  mpvLoad(uri: string, options?: AudioRequestOptions): Promise<{
    durationMs: number
    resumed?: boolean
    sampleRate?: number
    channels?: number
    bitDepth?: number
    endedCount?: number
  }>
  mpvAppend(uri: string, playNow?: boolean, options?: { headers?: Record<string, string> }): Promise<void>
  mpvPlay(atMs?: number): Promise<void>
  mpvPause(): Promise<void>
  mpvStop(): Promise<void>
  mpvSeek(positionMs: number): Promise<void>
  mpvSetVolume(volume: number): Promise<void>
  mpvSetMuted(muted: boolean): Promise<void>
  mpvSetAudioExclusive(exclusive: boolean): Promise<void>
  mpvSetDspConfig(config: DspConfig): Promise<void>
  mpvSetVisualizer(enabled: boolean, fftSize?: number): Promise<void>
  mpvGetFftFrame(): Promise<FftFrame | null>
  mpvGetState(): Promise<PlaybackStateEvent>
  mpvGetAudioDevices(): Promise<Array<{ name: string; description: string }>>
  /** Whether the engine process lives and its libmpv actually loaded. */
  mpvEngineStatus(): Promise<{ running: boolean; mpvAvailable: boolean }>
  /** The renderer's media-element playback state, for the engine's visualizer. */
  mpvSetStreamPlayback(playing: boolean): Promise<void>

  readonly supervisor: AudioEngineSupervisor
}

export function createAudioHost(logger?: AudioMainLogger): AudioHostApi {
  const devices = new AudioDeviceEnumerator(logger)
  const supervisor = new AudioEngineSupervisor(logger)

  let endedCount = 0
  let lastState: PlaybackStateEvent = {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
    endedCount: 0,
  }
  let lastFftFrame: FftFrame | null = null

  supervisor.onEnded(() => {
    endedCount++
    lastState = {
      ...lastState,
      endedCount,
    }
  })

  supervisor.onStateChange((state) => {
    lastState = {
      ...state,
      endedCount: state.endedCount ?? endedCount,
    }
  })

  supervisor.onFftFrame((frame) => {
    lastFftFrame = frame
  })

  return {
    getOutputDevices: () => devices.getOutputDevices(),
    setOutputDevice: async (id) => {
      await devices.setOutputDevice(id)
      supervisor.setOutputDevice(id)
    },

    mpvLoad: async (uri, options) => {
      const res = await supervisor.load(uri, options)
      return {
        ...res,
        endedCount: res.endedCount ?? endedCount,
      }
    },
    mpvAppend: async (uri, playNow, options) => {
      return supervisor.append(uri, playNow, options)
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
    mpvSetAudioExclusive: async (exclusive) => {
      supervisor.setAudioExclusive(exclusive)
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
      return {
        ...lastState,
        endedCount: lastState.endedCount ?? endedCount,
      }
    },
    mpvGetAudioDevices: async () => {
      return supervisor.getAudioDevices()
    },
    mpvEngineStatus: async () => {
      return supervisor.getEngineStatus()
    },
    mpvSetStreamPlayback: async (playing) => {
      supervisor.setStreamPlayback(playing)
    },

    supervisor,
  }
}
