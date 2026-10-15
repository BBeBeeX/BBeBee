/**
 * AudioConverter service implementation.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  AudioConvertOptions,
  AudioConverterConfig,
  AudioConverterService,
  AudioFormat,
  CompressionEstimate,
  ConvertTask,
  DirectConvertParams,
  DirectConvertResult,
  Disposable,
  EncoderCapabilities,
} from '@BBeBee/protocol'
import { TaskQueue } from './queue.js'
import { estimateCompression } from './compression.js'
import { computeTempPath, ensureSafeTarget, validateAndNormalizePath, validateFormat } from './security.js'

const DEFAULT_CONFIG: AudioConverterConfig = {
  defaultFormat: 'mp3',
  maxConcurrency: 2,
  taskTimeoutMs: 300_000, // 5 minutes
  autoCleanTemp: true,
}

export class AudioConverter extends Service implements AudioConverterService {
  static inject = ['codec', 'fs', 'paths']

  private config: AudioConverterConfig
  private queue: TaskQueue

  constructor(ctx: Context, initialConfig: Partial<AudioConverterConfig> = {}) {
    super(ctx, 'audioConverter')
    this.config = { ...DEFAULT_CONFIG, ...initialConfig }
    this.queue = new TaskQueue(ctx, () => this.config)
  }

  async getCapabilities(): Promise<EncoderCapabilities> {
    if (this.ctx.codec.getEncoderCapabilities) {
      return this.ctx.codec.getEncoderCapabilities()
    }

    // Default static capabilities if not probed dynamically
    return {
      supportedInputFormats: [
        'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'alac', 'webm', 'pcm',
      ],
      supportedOutputFormats: [
        'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'alac', 'webm', 'pcm',
      ],
      encoders: {
        libmp3lame: { name: 'MP3 (LAME)', description: 'MP3 audio encoder', available: true },
        flac: { name: 'FLAC', description: 'Free Lossless Audio Codec', available: true },
        aac: { name: 'AAC', description: 'Advanced Audio Coding', available: true },
        libopus: { name: 'Opus', description: 'Opus audio codec', available: true },
        libvorbis: { name: 'Vorbis', description: 'Ogg Vorbis audio codec', available: true },
        pcm_s16le: { name: 'PCM 16-bit LE', description: 'WAV 16-bit PCM', available: true },
      },
    }
  }

  estimateCompression(params: {
    durationMs: number
    sourceSize: number
    targetFormat: AudioFormat
    bitrateKbps?: number
    channels?: number
    sampleRate?: number
    sourceFormat?: string
  }): CompressionEstimate {
    return estimateCompression(params)
  }

  async convertDirect(params: DirectConvertParams): Promise<DirectConvertResult> {
    const normInput = validateAndNormalizePath(params.inputUri)
    const normOutput = validateAndNormalizePath(params.outputUri)
    const targetFmt = validateFormat(params.targetFormat)

    ensureSafeTarget(normInput, normOutput, params.options?.overwrite ?? false)

    const targetParent = normOutput.lastIndexOf('/') >= 0 ? normOutput.slice(0, normOutput.lastIndexOf('/')) : ''
    const tempDir = (targetParent && targetParent !== '.') ? targetParent : (this.ctx.paths?.temp || '/tmp')
    await this.ctx.fs.mkdir(tempDir, { recursive: true }).catch(() => undefined)
    const tempPath = computeTempPath(normOutput, tempDir)
    params.onProgress?.(5, 'analyzing')

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined

    try {
      const controller = new AbortController()

      if (params.signal) {
        params.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      const timeoutMs = this.config.taskTimeoutMs || 300_000
      timeoutTimer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)

      params.onProgress?.(15, 'encoding')

      const res = await this.ctx.codec.transcode?.({
        inputUri: normInput,
        outputUri: tempPath,
        targetFormat: targetFmt,
        bitrate: params.options?.bitrateKbps ? `${params.options.bitrateKbps}k` : undefined,
        sampleRate: params.options?.sampleRate,
        channels: params.options?.channels,
        bitDepth: params.options?.bitDepth,
        vbr: params.options?.vbr,
        vbrQuality: params.options?.vbrQuality,
        volumeGainDb: params.options?.volumeGainDb,
        fadeInSeconds: params.options?.fadeInSeconds,
        fadeOutSeconds: params.options?.fadeOutSeconds,
        startTimeSeconds: params.options?.startTimeSeconds,
        endTimeSeconds: params.options?.endTimeSeconds,
        signal: controller.signal,
        onProgress: (pct: number) => {
          params.onProgress?.(Math.min(95, Math.round(15 + pct * 0.8)), 'encoding')
        },
      })

      if (controller.signal.aborted) {
        await this.ctx.fs.remove(tempPath).catch(() => undefined)
        return { ok: false, error: 'Conversion cancelled or timed out' }
      }

      if (!res?.ok) {
        await this.ctx.fs.remove(tempPath).catch(() => undefined)
        return { ok: false, error: res?.error || 'Codec engine failure' }
      }

      params.onProgress?.(96, 'verifying')

      const st = await this.ctx.fs.stat(tempPath)
      if (st.size === 0) {
        await this.ctx.fs.remove(tempPath).catch(() => undefined)
        return { ok: false, error: 'Transcoded file is empty' }
      }

      await this.ctx.fs.move(tempPath, normOutput)
      params.onProgress?.(100, 'completed')

      return {
        ok: true,
        outputSize: st.size,
        durationMs: res.durationMs,
      }
    } catch (err: unknown) {
      await this.ctx.fs.remove(tempPath).catch(() => undefined)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }

  async enqueue(
    items: Array<{ uri: string; options?: Partial<AudioConvertOptions> }>,
  ): Promise<ConvertTask[]> {
    return this.queue.enqueue(items)
  }

  async cancelTask(taskId: string): Promise<boolean> {
    return this.queue.cancelTask(taskId)
  }

  async retryTask(taskId: string): Promise<boolean> {
    return this.queue.retryTask(taskId)
  }

  async removeTask(taskId: string): Promise<boolean> {
    return this.queue.removeTask(taskId)
  }

  async clearFinished(): Promise<void> {
    this.queue.clearFinished()
  }

  getTasks(): readonly ConvertTask[] {
    return this.queue.getTasks()
  }

  getConfig(): AudioConverterConfig {
    return { ...this.config }
  }

  async updateConfig(patch: Partial<AudioConverterConfig>): Promise<void> {
    this.config = { ...this.config, ...patch }
  }

  onTasksChanged(callback: (tasks: readonly ConvertTask[]) => void): Disposable {
    const off = this.ctx.on('audio-converter/tasks-changed', callback)
    return () => off()
  }
}
