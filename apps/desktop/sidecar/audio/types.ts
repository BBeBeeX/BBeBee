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
   * The proxy URL for this stream, when the settings route its source through
   * one. Passed through to the engine verbatim: the engine release that reads
   * it consumes it; earlier builds ignore the unknown option and play direct.
   * (The session-wide fallback is the `http_proxy` environment the supervisor
   * spawns the engine with — see `proxy:set`.)
   */
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
