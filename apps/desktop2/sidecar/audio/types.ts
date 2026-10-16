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
}

export interface AudioDecodedPcm {
  sampleRate: number
  channels: number
  bitDepth: number
  durationMs: number
  /** Deinterleaved channel PCM data */
  pcm: Float32Array[]
}
