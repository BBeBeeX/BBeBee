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
  /** Guards the async mpv attach against a detach or newer attach racing it. */
  private attachSeq = 0

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
    // The mpv branch awaits `getEngineStatus` before committing, so two
    // attach/detach cycles can overlap. A stale answer must not re-attach an
    // analyser the newer cycle (or a detach) has already replaced.
    const seq = ++this.attachSeq
    void this.attachAnalyserAsync(seq).catch((err) => {
      this.ownCtx.logger.warn('visualizer: failed to create or attach AudioAnalyser', err)
    })
  }

  private async attachAnalyserAsync(seq: number): Promise<void> {
    try {
      const activeEngine = this.ownCtx.audio?.activeEngineName
      const audioSvc = this.ownCtx.audio as unknown as {
        getFftSpectrum?: () => Promise<FftFrame | null>
        setVisualizer?: (enabled: boolean, fftSize?: number) => Promise<void>
        getEngineStatus?: () => Promise<{ running: boolean; mpvAvailable: boolean; pcmTapAvailable: boolean }>
      }
      const isMpv = activeEngine === 'mpv' || activeEngine === 'wasapi'

      // If active engine is native MPV/WASAPI and provides in-process FFT frames:
      if (isMpv && typeof audioSvc?.getFftSpectrum === 'function') {
        // The FFT frames ride on the PCM tap inside libmpv
        // (patches/mpv-pcm-tap.patch). On a stock libmpv the engine receives
        // no PCM at all and every frame is silence — the Web Audio analyser
        // is the honest fallback. A missing status (an engine without
        // `getEngineStatus`) defaults to available, so nothing regresses.
        const status = await audioSvc.getEngineStatus?.()
        if (seq !== this.attachSeq) return
        if (status?.pcmTapAvailable !== false) {
          const targetFftSize = this.currentSettings.fftSize || 128
          void audioSvc.setVisualizer?.(true, targetFftSize)
          this.analyser = new NativeMpvImpl({
            fftSize: targetFftSize,
            smoothingTimeConstant: 0.82,
            fetchSpectrum: () => audioSvc.getFftSpectrum!(),
          })
          this.ownCtx.logger.info('visualizer: attached NativeMpvImpl spectrum analyser')
          return
        }
        this.ownCtx.logger.warn(
          'visualizer: native PCM tap unavailable (unpatched libmpv?) — falling back to the Web Audio analyser',
        )
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
    const audioSvc = this.ownCtx.audio as unknown as {
      setVisualizer?: (enabled: boolean, fftSize?: number) => Promise<void>
    }
    void audioSvc?.setVisualizer?.(true, targetFftSize)
  }

  private detachAnalyser(): void {
    this.attachSeq++
    if (this.analyser) {
      this.analyser.dispose()
      this.analyser = null
    }
    const audioSvc = this.ownCtx.audio as unknown as {
      setVisualizer?: (enabled: boolean, fftSize?: number) => Promise<void>
    }
    void audioSvc?.setVisualizer?.(false)
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
