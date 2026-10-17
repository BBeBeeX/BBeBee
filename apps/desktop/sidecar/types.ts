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

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: unknown[] | Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown[] | Record<string, unknown>
}
