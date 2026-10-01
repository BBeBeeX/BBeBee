/**
 * `plugin-visualizer` — real-time audio visualization service.
 *
 * Implements `ctx.visualizer`:
 * - Uses unified `AudioAnalyser` abstraction (WebAudioImpl for Web Audio, NativeMpvImpl for libmpv FFT).
 * - Extracts real-time frequency spectrum and waveform buffers.
 * - Persists and synchronizes visualization preferences.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  AppSettings,
  SettingsService,
  VisualizerService,
  VisualizerSettings,
} from '@BBeBee/protocol'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'
import {
  type AudioAnalyser,
  type FftFrame,
  NativeMpvImpl,
  WebAudioImpl,
} from './analyser.js'

export * from './analyser.js'
export * from './views.js'
export * from './hooks.js'
import { VISUALIZER_VIEWS } from './views.js'

export class VisualizerPlugin extends Service implements VisualizerService {
  static override readonly name = 'visualizer'
  static readonly inject = ['audio', 'settings']

  private readonly ownCtx: Context
  private currentSettings: VisualizerSettings = { ...DEFAULT_VISUALIZER_SETTINGS }
  private analyser: AudioAnalyser | null = null

  constructor(ctx: Context) {
    super(ctx, 'visualizer')
    this.ownCtx = ctx
  }

  get settings(): Readonly<VisualizerSettings> {
    return this.currentSettings
  }

  get analyserNode(): AnalyserNode | null {
    if (this.analyser instanceof WebAudioImpl) {
      return this.analyser.rawNode
    }
    return null
  }

  get currentAnalyser(): AudioAnalyser | null {
    return this.analyser
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-visualizer: initialized')

    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'settings',
          id: VISUALIZER_VIEWS.settings,
          section: 'playback',
          title: '音频可视化',
          description: '在播放界面呈现音乐频率跳动与声波流动效果，自定义显示样式与色彩',
          display: 'card',
          order: 80,
        })
      }, 'visualizer-settings-contribution'),
    )

    // 1. Initialize settings from settings service
    const settingsService = (
      this.ownCtx as unknown as { settings?: SettingsService }
    ).settings
    if (settingsService) {
      try {
        const initial = settingsService.getSync()
        if (initial?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...initial.visualizer }
        }
      } catch {
        // ignore synchronous read failure
      }

      void settingsService.get().then((appSettings: AppSettings) => {
        if (appSettings?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...appSettings.visualizer }
          this.updateAnalyserConfig()
        }
      })

      this.ownCtx.on('settings/changed', (appSettings: AppSettings) => {
        if (appSettings?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...appSettings.visualizer }
          this.updateAnalyserConfig()
        }
      })
    }

    // 2. Attach unified audio analyser
    this.attachAnalyser()

    // Re-attach analyser when audio engine changes or AudioContext is dynamically rebuilt
    const offEngine = this.ownCtx.on('audio/engine-changed', () => {
      this.ownCtx.logger.info('plugin-visualizer: audio engine changed, re-attaching analyser')
      this.detachAnalyser()
      this.attachAnalyser()
    })

    const offContextRebuilt = this.ownCtx.on('audio/context-rebuilt', () => {
      this.ownCtx.logger.info('plugin-visualizer: audio context rebuilt, re-attaching analyser')
      this.detachAnalyser()
      this.attachAnalyser()
    })

    // Teardown
    return () => {
      this.ownCtx.logger.info('plugin-visualizer: disposing')
      offEngine()
      offContextRebuilt()
      this.detachAnalyser()
    }
  }

  private attachAnalyser(): void {
    try {
      const activeEngine = this.ownCtx.audio?.activeEngineName
      const getFftSpectrum = (
        this.ownCtx.audio as unknown as {
          getFftSpectrum?: () => Promise<FftFrame | null>
        }
      )?.getFftSpectrum

      // If active engine is native MPV and provides in-process FFT frames:
      if (activeEngine === 'mpv' && typeof getFftSpectrum === 'function') {
        this.analyser = new NativeMpvImpl({
          fftSize: this.currentSettings.fftSize || 128,
          smoothingTimeConstant: 0.82,
          fetchSpectrum: () => getFftSpectrum.call(this.ownCtx.audio),
        })
        this.ownCtx.logger.info('visualizer: attached NativeMpvImpl spectrum analyser')
        return
      }

      // Default: Web Audio AnalyserNode
      const audioCtx = this.ownCtx.audio?.context
      if (audioCtx && typeof audioCtx.createAnalyser === 'function') {
        const node = audioCtx.createAnalyser()
        const source = this.ownCtx.audio.chainOutput ?? this.ownCtx.audio.chainInput
        if (source && typeof source.connect === 'function') {
          source.connect(node)
        }
        this.analyser = new WebAudioImpl(node, source)
        this.updateAnalyserConfig()
        this.ownCtx.logger.info('visualizer: attached WebAudioImpl AnalyserNode')
      } else {
        this.ownCtx.logger.debug('visualizer: AudioContext does not support createAnalyser')
      }
    } catch (err) {
      this.ownCtx.logger.warn('visualizer: failed to create or attach AudioAnalyser', err)
    }
  }

  private updateAnalyserConfig(): void {
    if (!this.analyser) return
    const targetFftSize = this.currentSettings.fftSize || 128
    this.analyser.setFftSize(targetFftSize)
    this.analyser.smoothingTimeConstant = 0.82
  }

  private detachAnalyser(): void {
    if (this.analyser) {
      this.analyser.dispose()
      this.analyser = null
    }
  }

  getFrequencyData(array: Uint8Array): void {
    if (!this.analyser) {
      array.fill(0)
      return
    }
    this.analyser.getByteFrequencyData(array)
    // Apply sensitivity multiplier if needed
    const mult = this.currentSettings.sensitivity ?? 1.0
    if (mult !== 1.0) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.min(255, Math.round((array[i] ?? 0) * mult))
      }
    }
  }

  getTimeDomainData(array: Uint8Array): void {
    if (!this.analyser) {
      array.fill(128)
      return
    }
    this.analyser.getByteTimeDomainData(array)
    const mult = this.currentSettings.sensitivity ?? 1.0
    if (mult !== 1.0) {
      for (let i = 0; i < array.length; i++) {
        const val = (array[i] ?? 128) - 128
        array[i] = Math.min(255, Math.max(0, Math.round(128 + val * mult)))
      }
    }
  }

  async updateSettings(patch: Partial<VisualizerSettings>): Promise<void> {
    this.currentSettings = { ...this.currentSettings, ...patch }
    this.updateAnalyserConfig()

    const settingsService = (
      this.ownCtx as unknown as { settings?: SettingsService }
    ).settings
    if (settingsService) {
      const current = await settingsService.get()
      await settingsService.update({
        visualizer: {
          ...(current.visualizer ?? DEFAULT_VISUALIZER_SETTINGS),
          ...patch,
        },
      })
    }
  }
}

export const name = 'plugin-visualizer'
export const inject = ['audio', 'settings']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-visualizer: loaded')
  const fiber = await ctx.plugin(VisualizerPlugin)
  return () => {
    fiber.dispose()
  }
}

export default { name, inject, apply }
