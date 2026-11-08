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
    /** The URI actually served — a relay rewrite answers with the loopback URL. */
    uri?: string
  }>
  mpvAppend(
    uri: string,
    playNow?: boolean,
    options?: { headers?: Record<string, string>; proxy?: boolean },
  ): Promise<void>
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
  mpvEngineStatus(): Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }>
  /** The renderer's media-element playback state, for the engine's visualizer. */
  mpvSetStreamPlayback(playing: boolean): Promise<void>

  readonly supervisor: AudioEngineSupervisor
}

/**
 * Translates one proxy-marked stream before it reaches the engine.
 *
 * Implemented by the sidecar shell (which holds the proxy config): returns
 * either the original URL plus a per-load `proxyUrl` for engine builds that
 * proxy themselves, or a loopback-relay rewrite whose headers live in the
 * relay's registration (`headers: undefined`). Never throws for "can't" —
 * an unresolvable wish comes back as the original URL, direct.
 */
export interface StreamProxyResolver {
  resolve(req: { url: string; headers?: Record<string, string> }): Promise<{
    url: string
    headers?: Record<string, string>
    proxyUrl?: string
  }>
}

export function createAudioHost(
  logger?: AudioMainLogger,
  streamProxy?: StreamProxyResolver,
): AudioHostApi {
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

  /**
   * One place for the proxy decision, shared by load and append: a marked
   * stream goes through the resolver when there is one; unmarked streams
   * (and the marker itself) pass through untouched. The resolver owns the
   * policy — engine capability, socks5 caveats, the relay fallback — and
   * this side never learns what a proxy URL looks like.
   */
  async function translateStreamProxy(
    uri: string,
    options?: AudioRequestOptions & { proxy?: boolean },
  ): Promise<{ url: string; options?: AudioRequestOptions }> {
    const { proxy, ...rest } = options ?? {}
    if (!proxy || !streamProxy) {
      return { url: uri, options: Object.keys(rest).length > 0 ? (rest as AudioRequestOptions) : undefined }
    }
    try {
      const resolved = await streamProxy.resolve({ url: uri, headers: rest.headers })
      const next: AudioRequestOptions & { proxyUrl?: string } = {
        ...(rest.headers || resolved.headers
          ? { headers: resolved.headers ?? rest.headers }
          : {}),
        ...(resolved.proxyUrl ? { proxyUrl: resolved.proxyUrl } : {}),
      }
      return {
        url: resolved.url,
        options: Object.keys(next).length > 0 ? next : undefined,
      }
    } catch (error) {
      logger?.warn?.('audio-host: stream proxy resolution failed (%s) — playing direct', String(error))
      return { url: uri, options: Object.keys(rest).length > 0 ? (rest as AudioRequestOptions) : undefined }
    }
  }

  return {
    getOutputDevices: () => devices.getOutputDevices(),
    setOutputDevice: async (id) => {
      await devices.setOutputDevice(id)
      supervisor.setOutputDevice(id)
    },

    mpvLoad: async (uri, options) => {
      const effective = await translateStreamProxy(uri, options)
      const res = await supervisor.load(effective.url, effective.options)
      return {
        ...res,
        endedCount: res.endedCount ?? endedCount,
      }
    },
    mpvAppend: async (uri, playNow, options) => {
      const effective = await translateStreamProxy(uri, options)
      return supervisor.append(effective.url, playNow, effective.options)
    },
    mpvPlay: async (atMs) => {
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
