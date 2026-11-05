/**
 * `ctx.visualizer` — real-time audio visualization service.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { VisualizerSettings } from './settings.js'

export interface VisualizerService {
  /** The current visualizer settings. */
  readonly settings: Readonly<VisualizerSettings>

  /** The attached AnalyserNode, if available and active. */
  readonly analyserNode: AnalyserNode | null

  /**
   * Copies current frequency data into the target byte array.
   * Target array length should match frequencyBinCount.
   */
  getFrequencyData(array: Uint8Array): void

  /**
   * Copies current time-domain (waveform) data into the target byte array.
   */
  getTimeDomainData(array: Uint8Array): void

  /** Updates visualizer settings. */
  updateSettings(patch: Partial<VisualizerSettings>): Promise<void>

  /**
   * Registers an active UI consumer (e.g. Spectrum/Waveform canvas).
   * While at least one consumer is attached, the analyser polls for spectrum frames.
   * Returns a disposer to unregister when the consumer unmounts or becomes hidden.
   */
  attachConsumer?(): () => void
}

declare module 'cordis' {
  interface Context {
    visualizer: VisualizerService
  }
}
