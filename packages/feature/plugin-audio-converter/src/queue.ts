/**
 * Audio Conversion Task Queue & Concurrency Scheduler.
 */

import type { Context } from 'cordis'
import type {
  AudioConvertOptions,
  AudioConverterConfig,
  AudioFormat,
  ConvertTask,
} from '@BBeBee/protocol'
import { computeTempPath, ensureSafeTarget, extractExtension, validateAndNormalizePath } from './security.js'

export class TaskQueue {
  private readonly tasks = new Map<string, ConvertTask>()
  private readonly abortControllers = new Map<string, AbortController>()
  private runningCount = 0

  constructor(
    private readonly ctx: Context,
    private readonly getConfig: () => AudioConverterConfig,
  ) {}

  getTasks(): readonly ConvertTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getTask(id: string): ConvertTask | undefined {
    return this.tasks.get(id)
  }

  enqueue(items: Array<{ uri: string; options?: Partial<AudioConvertOptions> }>): ConvertTask[] {
    const config = this.getConfig()
    const added: ConvertTask[] = []

    for (const item of items) {
      const normInput = validateAndNormalizePath(item.uri)
      const sourceExt = extractExtension(normInput)
      const targetFmt = (item.options?.targetFormat || config.defaultFormat) as AudioFormat

      const lastSlash = normInput.lastIndexOf('/')
      const fullFileName = lastSlash >= 0 ? normInput.slice(lastSlash + 1) : normInput
      const lastDot = fullFileName.lastIndexOf('.')
      const stem = lastDot > 0 ? fullFileName.slice(0, lastDot) : fullFileName

      // Output directory: item option -> config default -> same directory as input
      const parentDir = lastSlash >= 0 ? normInput.slice(0, lastSlash) : '.'
      const outDir = item.options?.outputDir || config.defaultOutputDir || parentDir
      const customName = item.options?.outputFileName || `${stem}.${targetFmt}`
      const outUri = `${outDir}/${customName}`

      ensureSafeTarget(normInput, outUri, item.options?.overwrite ?? false)

      const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      const task: ConvertTask = {
        id,
        inputUri: normInput,
        outputUri: outUri,
        fileName: fullFileName,
        sourceFormat: sourceExt,
        targetFormat: targetFmt,
        status: 'pending',
        progress: 0,
        stage: 'idle',
        sourceSize: 0,
        options: {
          targetFormat: targetFmt,
          ...item.options,
        },
        createdAt: Date.now(),
        logs: [],
      }

      this.tasks.set(id, task)
      added.push(task)
    }

    this.emitChange()
    this.scheduleNext()
    return added
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'processing') {
      const ctrl = this.abortControllers.get(taskId)
      if (ctrl) {
        ctrl.abort()
        this.abortControllers.delete(taskId)
      }
      this.updateTask(taskId, {
        status: 'cancelled',
        stage: 'cancelled',
        error: 'Task was cancelled by user',
      })
      this.ctx.emit('audio-converter/task-cancelled', taskId)
      this.runningCount = Math.max(0, this.runningCount - 1)
      this.scheduleNext()
      return true
    }

    if (task.status === 'pending') {
      this.updateTask(taskId, {
        status: 'cancelled',
        stage: 'cancelled',
        error: 'Task was cancelled before processing',
      })
      this.ctx.emit('audio-converter/task-cancelled', taskId)
      this.emitChange()
      return true
    }

    return false
  }

  retryTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'failed' || task.status === 'cancelled') {
      this.updateTask(taskId, {
        status: 'pending',
        stage: 'idle',
        progress: 0,
        error: undefined,
        outputSize: undefined,
        compressionRatio: undefined,
        startedAt: undefined,
        completedAt: undefined,
      })
      this.scheduleNext()
      return true
    }

    return false
  }

  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'processing') {
      this.cancelTask(taskId)
    }

    this.tasks.delete(taskId)
    this.abortControllers.delete(taskId)
    this.emitChange()
    return true
  }

  clearFinished(): void {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id)
        this.abortControllers.delete(id)
      }
    }
    this.emitChange()
  }

  private scheduleNext(): void {
    const config = this.getConfig()
    const maxConcurrency = Math.max(1, config.maxConcurrency || 2)

    while (this.runningCount < maxConcurrency) {
      const next = Array.from(this.tasks.values()).find((t) => t.status === 'pending')
      if (!next) break

      this.runningCount++
      this.processTask(next)
    }
  }

  private async processTask(task: ConvertTask): Promise<void> {
    const taskId = task.id
    const controller = new AbortController()
    this.abortControllers.set(taskId, controller)

    const tempPath = computeTempPath(task.outputUri)

    this.updateTask(taskId, {
      status: 'processing',
      stage: 'analyzing',
      startedAt: Date.now(),
      progress: 5,
    })

    try {
      // 1. Stat input file size and probe duration
      let sourceSize = 0
      try {
        const st = await this.ctx.fs.stat(task.inputUri)
        sourceSize = st.size
      } catch {
        // Fallback or ignore if native fs probe needed
      }

      let durationMs = 0
      try {
        durationMs = await this.ctx.codec.probeDuration(task.inputUri)
      } catch {
        // Ignore probe error if metadata parsing couldn't read duration
      }

      this.updateTask(taskId, {
        sourceSize: sourceSize || task.sourceSize,
        durationMs: durationMs || task.durationMs,
        stage: 'encoding',
        progress: 10,
      })

      // 2. Perform transcoding via ctx.codec
      const res = await this.ctx.codec.transcode?.({
        inputUri: task.inputUri,
        outputUri: tempPath,
        targetFormat: task.targetFormat,
        bitrate: task.options.bitrateKbps ? `${task.options.bitrateKbps}k` : undefined,
        sampleRate: task.options.sampleRate,
        channels: task.options.channels,
        bitDepth: task.options.bitDepth,
        vbr: task.options.vbr,
        vbrQuality: task.options.vbrQuality,
        volumeGainDb: task.options.volumeGainDb,
        fadeInSeconds: task.options.fadeInSeconds,
        fadeOutSeconds: task.options.fadeOutSeconds,
        startTimeSeconds: task.options.startTimeSeconds,
        endTimeSeconds: task.options.endTimeSeconds,
        signal: controller.signal,
        onProgress: (pct: number) => {
          // Map encoding progress from 10% to 90%
          const overall = Math.min(90, Math.round(10 + (pct * 0.8)))
          this.updateTask(taskId, {
            progress: overall,
            stage: 'encoding',
          })
          this.ctx.emit('audio-converter/task-progress', taskId, overall, 'encoding')
        },
      })

      if (controller.signal.aborted) {
        await this.ctx.fs.remove(tempPath).catch(() => undefined)
        return
      }

      if (!res?.ok) {
        throw new Error(res?.error || 'Audio transcoding engine failed')
      }

      // 3. Verifying output file
      this.updateTask(taskId, { stage: 'verifying', progress: 95 })

      const outStat = await this.ctx.fs.stat(tempPath)
      if (outStat.size === 0) {
        throw new Error('Transcoded output file is empty')
      }

      // 4. Move temp file to final targetUri safely
      await this.ctx.fs.move(tempPath, task.outputUri)

      const outputSize = outStat.size
      const compRatio = sourceSize > 0 ? Math.round((outputSize / sourceSize) * 1000) / 10 : 100

      const completedTask = this.updateTask(taskId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        outputSize,
        compressionRatio: compRatio,
        completedAt: Date.now(),
      })

      if (completedTask) {
        this.ctx.emit('audio-converter/task-completed', completedTask)
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return

      await this.ctx.fs.remove(tempPath).catch(() => undefined)
      const errorMsg = err instanceof Error ? err.message : String(err)

      this.updateTask(taskId, {
        status: 'failed',
        stage: 'failed',
        error: errorMsg,
        completedAt: Date.now(),
      })
      this.ctx.emit('audio-converter/task-failed', taskId, errorMsg)
    } finally {
      this.abortControllers.delete(taskId)
      this.runningCount = Math.max(0, this.runningCount - 1)
      this.scheduleNext()
    }
  }

  private updateTask(taskId: string, patch: Partial<ConvertTask>): ConvertTask | undefined {
    const existing = this.tasks.get(taskId)
    if (!existing) return undefined

    const updated: ConvertTask = {
      ...existing,
      ...patch,
      logs: patch.error ? [...(existing.logs || []), `[${new Date().toLocaleTimeString()}] ${patch.error}`] : existing.logs,
    }

    this.tasks.set(taskId, updated)
    this.emitChange()
    return updated
  }

  private emitChange(): void {
    const list = this.getTasks()
    this.ctx.emit('audio-converter/tasks-changed', list)
  }
}
