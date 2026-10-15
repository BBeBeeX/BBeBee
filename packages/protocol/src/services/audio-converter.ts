/**
 * `ctx.audioConverter` — Audio format conversion, compression, and batch processing service.
 *
 * Provides headless audio transcoding, compression presets, file verification,
 * dynamic encoder capability detection, and queue task management.
 * Consumed by UI workbench, downloads, and other feature modules.
 */

import type {} from 'cordis'
import type { Disposable } from '../common.js'

export type AudioFormat =
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'aac'
  | 'm4a'
  | 'ogg'
  | 'opus'
  | 'wma'
  | 'aiff'
  | 'alac'
  | 'webm'
  | 'pcm'

export type CompressionPreset =
  | 'high_quality'
  | 'balanced'
  | 'small_size'
  | 'speech'
  | 'custom'

export interface AudioConvertOptions {
  targetFormat: AudioFormat
  preset?: CompressionPreset
  bitrateKbps?: number
  sampleRate?: number
  channels?: 1 | 2
  bitDepth?: 16 | 24 | 32
  vbr?: boolean
  vbrQuality?: number
  volumeGainDb?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
  startTimeSeconds?: number
  endTimeSeconds?: number
  outputDir?: string
  outputFileName?: string
  preserveSource?: boolean
  overwrite?: boolean
}

export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskStage =
  | 'idle'
  | 'analyzing'
  | 'encoding'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ConvertTask {
  id: string
  inputUri: string
  outputUri: string
  fileName: string
  sourceFormat: string
  targetFormat: AudioFormat
  status: TaskStatus
  progress: number
  stage: TaskStage
  sourceSize: number
  outputSize?: number
  durationMs?: number
  compressionRatio?: number
  error?: string
  logs?: string[]
  options: AudioConvertOptions
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface EncoderCapabilities {
  supportedInputFormats: string[]
  supportedOutputFormats: string[]
  encoders: Record<string, { name: string; description: string; available: boolean }>
}

export interface CompressionEstimate {
  estimatedSize: number
  estimatedRatio: number
  isLossless: boolean
  warning?: string
  note: string
}

export interface AudioConverterConfig {
  defaultFormat: AudioFormat
  defaultOutputDir?: string
  defaultPreset?: CompressionPreset
  maxConcurrency: number
  taskTimeoutMs: number
  autoCleanTemp: boolean
}

export interface DirectConvertParams {
  inputUri: string
  outputUri: string
  targetFormat: AudioFormat
  options?: Partial<AudioConvertOptions>
  signal?: AbortSignal
  onProgress?: (progress: number, stage: TaskStage) => void
}

export interface DirectConvertResult {
  ok: boolean
  error?: string
  outputSize?: number
  durationMs?: number
}

export interface AudioConverterService {
  /** Check available audio encoders and format support on this system. */
  getCapabilities(): Promise<EncoderCapabilities>

  /** Estimate output size and compression ratio without encoding. */
  estimateCompression(params: {
    durationMs: number
    sourceSize: number
    targetFormat: AudioFormat
    bitrateKbps?: number
    channels?: number
    sampleRate?: number
    sourceFormat?: string
  }): CompressionEstimate

  /** Directly transcode an audio file (called by plugin-download or headless scripts). */
  convertDirect(params: DirectConvertParams): Promise<DirectConvertResult>

  /** Submit one or more files to the conversion queue. */
  enqueue(
    items: Array<{ uri: string; options?: Partial<AudioConvertOptions> }>,
  ): Promise<ConvertTask[]>

  /** Cancel an active or pending task. */
  cancelTask(taskId: string): Promise<boolean>

  /** Retry a failed task. */
  retryTask(taskId: string): Promise<boolean>

  /** Remove a task from the list/history. */
  removeTask(taskId: string): Promise<boolean>

  /** Clear all finished (completed, failed, cancelled) tasks. */
  clearFinished(): Promise<void>

  /** Get snapshot of all tasks. */
  getTasks(): readonly ConvertTask[]

  /** Get current configuration. */
  getConfig(): AudioConverterConfig

  /** Update configuration. */
  updateConfig(patch: Partial<AudioConverterConfig>): Promise<void>

  /** Subscribe to task list changes. */
  onTasksChanged(callback: (tasks: readonly ConvertTask[]) => void): Disposable
}

declare module 'cordis' {
  interface Context {
    audioConverter: AudioConverterService
  }
}
