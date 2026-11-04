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

  /**
   * Channel count of the frame source: 2 only when the attached
   * analyser is actually fed per-channel frames (the desktop engine's
   * stereo fft-frame). Absent — or 1 — means the mono pair above is
   * the whole truth; callers must not read the stereo methods in
   * that case, and must never copy the mono pair into both channels
   * themselves. Optional so older implementations keep compiling.
   */
  readonly channels?: 1 | 2

  /**
   * Sample rate in Hz of the frame source, when the engine reports
   * one. Absent means unknown — callers label it assumed, never a
   * hard-coded 44100 or 48000.
   */
  readonly sampleRateHz?: number

  /**
   * Copies left-channel frequency data into the target byte array.
   * Only meaningful when `channels === 2`; otherwise fills silence
   * (all zeros). The mono `getFrequencyData` stays the mix.
   */
  getLeftFrequencyData?(array: Uint8Array): void

  /** Right-channel counterpart of `getLeftFrequencyData`. */
  getRightFrequencyData?(array: Uint8Array): void

  /**
   * Copies left-channel time-domain data into the target byte array.
   * Only meaningful when `channels === 2`; otherwise fills silence
   * (all 128s, the byte value of a zero sample).
   */
  getLeftTimeDomainData?(array: Uint8Array): void

  /** Right-channel counterpart of `getLeftTimeDomainData`. */
  getRightTimeDomainData?(array: Uint8Array): void

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
