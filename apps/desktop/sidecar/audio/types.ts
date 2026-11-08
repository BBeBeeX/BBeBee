export interface AudioProbeResult {
  sampleRate: number
  channels: number
  bitDepth?: number
  durationMs?: number
  format?: string
  codec?: string
}

/** Request options for remote (http/https) decode inputs. */
export interface AudioRequestOptions {
  /** Headers sent with the request — a source's `Referer`, `User-Agent`, etc. */
  headers?: Record<string, string>
  /**
   * The proxy *wish* crossing from the renderer (`LoadOptions.proxy`) — a
   * boolean, never a config. The audio host translates it through its
   * `StreamProxyResolver` before the engine sees the request.
   */
  proxy?: boolean
  /** Resolved by the audio host for engines that proxy themselves. */
  proxyUrl?: string
}

export interface AudioDecodedPcm {
  sampleRate: number
  channels: number
  bitDepth: number
  durationMs: number
  /** Deinterleaved channel PCM data */
  pcm: Float32Array[]
}
