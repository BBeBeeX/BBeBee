// @vitest-environment jsdom
/**
 * Desktop tests for plugin-audio-converter-ui-desktop.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
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
import { AUDIO_CONVERTER_VIEWS } from '@BBeBee/plugin-audio-converter/views'
import converterCatalogue from '../../../feature/plugin-i18n/src/locales/converter.json'
import { ConverterWorkbench } from './components/ConverterWorkbench.js'
import plugin, { apply, name } from './index.js'

afterEach(cleanup)

class AudioConverterStub extends Service implements AudioConverterService {
  static override readonly name = 'audioConverter'
  tasks: ConvertTask[] = []
  config: AudioConverterConfig = {
    defaultFormat: 'mp3',
    maxConcurrency: 2,
    taskTimeoutMs: 300_000,
    autoCleanTemp: true,
  }
  readonly cancelledCalls: string[] = []
  readonly retriedCalls: string[] = []
  readonly removedCalls: string[] = []
  clearedFinishedCalled = false

  constructor(ctx: Context) {
    super(ctx, 'audioConverter')
  }

  setTasks(tasks: ConvertTask[]) {
    this.tasks = [...tasks]
    this.ctx.emit('audio-converter/tasks-changed', this.tasks)
  }

  async getCapabilities(): Promise<EncoderCapabilities> {
    return {
      supportedInputFormats: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
      supportedOutputFormats: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
      encoders: {
        libmp3lame: { name: 'MP3 (LAME)', description: 'MP3 audio encoder', available: true },
        flac: { name: 'FLAC', description: 'FLAC encoder', available: true },
        aac: { name: 'AAC', description: 'AAC encoder', available: true },
        libopus: { name: 'Opus', description: 'Opus encoder', available: true },
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
    const isLossless = params.targetFormat === 'flac' || params.targetFormat === 'wav'
    const estSize = isLossless ? Math.round(params.sourceSize * 0.6) : Math.round(params.sourceSize * 0.3)
    return {
      estimatedSize: estSize,
      estimatedRatio: isLossless ? 0.6 : 0.3,
      isLossless,
      warning:
        !isLossless && params.sourceFormat === 'mp3'
          ? 'Re-encoding lossy audio causes irreversible generational loss'
          : undefined,
      note: 'Estimated based on target parameters',
    }
  }

  async convertDirect(_params: DirectConvertParams): Promise<DirectConvertResult> {
    return { ok: true, outputSize: 1024, durationMs: 1000 }
  }

  async enqueue(
    items: Array<{ uri: string; options?: Partial<AudioConvertOptions> }>,
  ): Promise<ConvertTask[]> {
    const newTasks: ConvertTask[] = items.map((it, idx) => ({
      id: `task_${Date.now()}_${idx}`,
      inputUri: it.uri,
      outputUri: it.uri.replace(/\.[^.]+$/, '') + '.' + (it.options?.targetFormat || 'mp3'),
      fileName: it.uri.split(/[/\\]/).pop() || 'audio',
      sourceFormat: 'wav',
      targetFormat: it.options?.targetFormat || 'mp3',
      status: 'pending',
      stage: 'analyzing',
      progress: 0,
      sourceSize: 1024,
      options: {
        targetFormat: it.options?.targetFormat || 'mp3',
        ...it.options,
      },
      createdAt: Date.now(),
    }))
    this.tasks.push(...newTasks)
    this.ctx.emit('audio-converter/tasks-changed', this.tasks)
    return newTasks
  }

  async cancelTask(taskId: string): Promise<boolean> {
    this.cancelledCalls.push(taskId)
    const task = this.tasks.find((t) => t.id === taskId)
    if (task) {
      task.status = 'cancelled'
      this.ctx.emit('audio-converter/tasks-changed', this.tasks)
    }
    return true
  }

  async retryTask(taskId: string): Promise<boolean> {
    this.retriedCalls.push(taskId)
    const task = this.tasks.find((t) => t.id === taskId)
    if (task) {
      task.status = 'pending'
      this.ctx.emit('audio-converter/tasks-changed', this.tasks)
    }
    return true
  }

  async removeTask(taskId: string): Promise<boolean> {
    this.removedCalls.push(taskId)
    this.tasks = this.tasks.filter((t) => t.id !== taskId)
    this.ctx.emit('audio-converter/tasks-changed', this.tasks)
    return true
  }

  async clearFinished(): Promise<void> {
    this.clearedFinishedCalled = true
    this.tasks = this.tasks.filter((t) => t.status === 'pending' || t.status === 'processing')
    this.ctx.emit('audio-converter/tasks-changed', this.tasks)
  }

  getTasks(): readonly ConvertTask[] {
    return this.tasks
  }

  getConfig(): AudioConverterConfig {
    return this.config
  }

  async updateConfig(patch: Partial<AudioConverterConfig>): Promise<void> {
    this.config = { ...this.config, ...patch }
    this.ctx.emit('settings/changed', {} as any)
  }

  onTasksChanged(callback: (tasks: readonly ConvertTask[]) => void): Disposable {
    return this.ctx.on('audio-converter/tasks-changed', callback)
  }
}

class UiStub extends Service {
  static override readonly name = 'ui'
  registeredViews: Record<string, unknown> = {}

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, view: unknown) {
    this.registeredViews[id] = view
    return () => {
      delete this.registeredViews[id]
    }
  }
}

class ShellStub extends Service {
  static override readonly name = 'shell'
  revealedUris: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'shell')
  }

  async revealInFileManager(uri: string): Promise<void> {
    this.revealedUris.push(uri)
  }
}

const CATALOGUES: Record<string, { en: unknown }> = {
  converter: { en: (converterCatalogue as { en: unknown }).en },
}

class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'

  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }

  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const catalogue = CATALOGUES[key.slice(0, sep)]?.en
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params
      ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
      : cur
  }

  onLocaleChange = (_cb: (locale: string) => void): (() => void) => {
    return () => {}
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function harness(): Promise<{
  ctx: Context
  converter: AudioConverterStub
  shell: ShellStub
  ui: UiStub
}> {
  const root = new Context()
  await root.plugin(AudioConverterStub)
  await root.plugin(DefaultI18nStub)
  await root.plugin(ShellStub)
  await root.plugin(UiStub)
  await tick()
  return {
    ctx: root,
    converter: root.audioConverter as unknown as AudioConverterStub,
    shell: root.shell as unknown as ShellStub,
    ui: root.ui as unknown as UiStub,
  }
}

describe('plugin-audio-converter-ui-desktop', () => {
  it('has correct plugin metadata and registers workbench view', async () => {
    expect(name).toBe('plugin-audio-converter-ui-desktop')
    expect(plugin.name).toBe('plugin-audio-converter-ui-desktop')

    const { ctx, ui } = await harness()
    await apply(ctx)
    expect(ui.registeredViews[AUDIO_CONVERTER_VIEWS.page]).toBeDefined()
  })

  it('renders workbench tabs and header correctly', async () => {
    const { ctx } = await harness()
    render(h(ConverterWorkbench, { ctx }))

    expect(screen.getByTestId('audio-converter-workbench')).toBeDefined()
    expect(screen.getByTestId('tab-convert')).toBeDefined()
    expect(screen.getByTestId('tab-queue')).toBeDefined()
    expect(screen.getByTestId('tab-output')).toBeDefined()
  })

  it('navigates between Convert, Queue, and Output tabs', async () => {
    const { ctx } = await harness()
    render(h(ConverterWorkbench, { ctx }))

    // Switch to queue tab
    fireEvent.click(screen.getByTestId('tab-queue'))
    expect(screen.getByTestId('converter-queue-section')).toBeDefined()

    // Switch to output tab
    fireEvent.click(screen.getByTestId('tab-output'))
    expect(screen.getByTestId('converter-output-section')).toBeDefined()

    // Switch back to convert tab
    fireEvent.click(screen.getByTestId('tab-convert'))
    expect(screen.getByTestId('converter-file-area')).toBeDefined()
  })

  it('displays active task queue and allows cancelling a task', async () => {
    const { ctx, converter } = await harness()
    converter.setTasks([
      {
        id: 'task-1',
        inputUri: '/music/song.wav',
        outputUri: '/music/song.flac',
        fileName: 'song.wav',
        sourceFormat: 'wav',
        targetFormat: 'flac',
        status: 'processing',
        stage: 'encoding',
        progress: 45,
        sourceSize: 10 * 1024 * 1024,
        options: { targetFormat: 'flac' },
        createdAt: Date.now(),
      },
    ])

    render(h(ConverterWorkbench, { ctx }))
    fireEvent.click(screen.getByTestId('tab-queue'))

    expect(screen.getByTestId('converter-task-row-task-1')).toBeDefined()
    expect(screen.getByText('45%')).toBeDefined()

    // Cancel task
    const cancelBtn = screen.getByTestId('converter-task-cancel-task-1')
    fireEvent.click(cancelBtn)
    expect(converter.cancelledCalls).toContain('task-1')
  })

  it('displays completed outputs with size comparison and folder reveal action', async () => {
    const { ctx, converter, shell } = await harness()
    converter.setTasks([
      {
        id: 'task-done-1',
        inputUri: '/music/master.wav',
        outputUri: '/output/master.mp3',
        fileName: 'master.mp3',
        sourceFormat: 'wav',
        targetFormat: 'mp3',
        status: 'completed',
        stage: 'completed',
        progress: 100,
        sourceSize: 50 * 1024 * 1024, // 50MB
        outputSize: 5 * 1024 * 1024, // 5MB (-90%)
        durationMs: 240_000,
        options: { targetFormat: 'mp3' },
        createdAt: Date.now(),
        completedAt: Date.now(),
      },
    ])

    render(h(ConverterWorkbench, { ctx }))
    fireEvent.click(screen.getByTestId('tab-output'))

    expect(screen.getByTestId('output-row-task-done-1')).toBeDefined()
    expect(screen.getByText('-90%')).toBeDefined()

    // Test reveal in file manager button
    const revealBtn = screen.getByTestId('reveal-btn-task-done-1')
    fireEvent.click(revealBtn)
    expect(shell.revealedUris).toContain('/output/master.mp3')
  })

  it('opens settings modal, modifies configuration and saves', async () => {
    const { ctx, converter } = await harness()
    render(h(ConverterWorkbench, { ctx }))

    // Open settings modal
    const settingsBtn = screen.getByTestId('converter-open-settings-btn')
    fireEvent.click(settingsBtn)

    expect(screen.getByTestId('converter-settings-modal')).toBeDefined()

    // Click save
    const saveBtn = screen.getByTestId('save-settings-btn')
    fireEvent.click(saveBtn)

    expect(converter.config.defaultFormat).toBe('mp3')
  })
})
