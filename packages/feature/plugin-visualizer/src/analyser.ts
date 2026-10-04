/**
 * `AudioAnalyser` abstraction layer for `plugin-visualizer`.
 *
 * Provides a unified spectrum and waveform analysis API identical in semantics
 * to the Web Audio `AnalyserNode`.
 *
 * Implementations:
 * - `WebAudioImpl`: wraps Web Audio API's AnalyserNode.
 * - `NativeMpvImpl`: wraps libmpv native audio-engine's in-process FFT spectrum frames.
 *
 * This decouples the Renderer from the audio engine: whether audio plays
 * through Web Audio or native libmpv/WASAPI, the UI visualizer components
 * interact with this single unified contract.
 */

export interface FftFrame {
  frequencyData: number[] | Uint8Array
  timeDomainData: number[] | Uint8Array
}

export interface AudioAnalyser {
  readonly fftSize: number
  readonly frequencyBinCount: number
  smoothingTimeConstant: number

  setFftSize(size: number): void
  getByteFrequencyData(array: Uint8Array): void
  getByteTimeDomainData(array: Uint8Array): void
  dispose(): void
}

/**
 * Web Audio implementation: delegates directly to AnalyserNode.
 */
export class WebAudioImpl implements AudioAnalyser {
  constructor(
    private readonly node: AnalyserNode,
    private readonly sourceNode?: AudioNode | null,
  ) {}

  get fftSize(): number {
    return this.node.fftSize
  }

  get frequencyBinCount(): number {
    return this.node.frequencyBinCount
  }

  get smoothingTimeConstant(): number {
    return this.node.smoothingTimeConstant
  }

  set smoothingTimeConstant(val: number) {
    this.node.smoothingTimeConstant = Math.max(0, Math.min(1, val))
  }

  setFftSize(size: number): void {
    try {
      this.node.fftSize = size
    } catch {
      // ignore invalid size
    }
  }

  getByteFrequencyData(array: Uint8Array): void {
    this.node.getByteFrequencyData(array as unknown as Uint8Array<ArrayBuffer>)
  }

  getByteTimeDomainData(array: Uint8Array): void {
    this.node.getByteTimeDomainData(array as unknown as Uint8Array<ArrayBuffer>)
  }

  get rawNode(): AnalyserNode {
    return this.node
  }

  dispose(): void {
    try {
      if (this.sourceNode) {
        this.sourceNode.disconnect(this.node)
      }
      this.node.disconnect()
    } catch {
      // ignore disconnect errors
    }
  }
}

/**
 * Native MPV implementation: consumes FFT frames computed inside native audio-engine.
 */
export class NativeMpvImpl implements AudioAnalyser {
  private _fftSize: number
  private _smoothingTimeConstant: number

  private smoothedFreq: Float32Array
  private latestWave: Uint8Array
  private pollTimer?: ReturnType<typeof setInterval>
  private isDisposed = false

  constructor(
    options: {
      fftSize?: number
      smoothingTimeConstant?: number
      fetchSpectrum?: () => Promise<FftFrame | null>
    } = {},
  ) {
    this._fftSize = options.fftSize ?? 128
    this._smoothingTimeConstant = options.smoothingTimeConstant ?? 0.82

    const binCount = this._fftSize / 2
    this.smoothedFreq = new Float32Array(binCount)
    this.latestWave = new Uint8Array(this._fftSize).fill(128)

    if (options.fetchSpectrum) {
      this.startPolling(options.fetchSpectrum)
    }
  }

  get fftSize(): number {
    return this._fftSize
  }

  get frequencyBinCount(): number {
    return this._fftSize / 2
  }

  get smoothingTimeConstant(): number {
    return this._smoothingTimeConstant
  }

  set smoothingTimeConstant(val: number) {
    this._smoothingTimeConstant = Math.max(0, Math.min(1, val))
  }

  setFftSize(size: number): void {
    if (size === this._fftSize) return
    const valid = Math.max(32, Math.min(2048, 1 << Math.round(Math.log2(size))))
    this._fftSize = valid
    const binCount = valid / 2
    this.smoothedFreq = new Float32Array(binCount)
    this.latestWave = new Uint8Array(valid).fill(128)
  }

  /** Ingests a new spectrum frame from libmpv native audio-engine. */
  feedFrame(frame: FftFrame): void {
    if (this.isDisposed || !frame) return

    const inFreq = frame.frequencyData
    const inFreqLen = inFreq.length
    const binCount = this.frequencyBinCount

    if (inFreqLen > 0) {
      for (let i = 0; i < binCount; i++) {
        // Resample/map to target bin count if sizes differ
        const srcIdx = inFreqLen === binCount ? i : Math.floor((i / binCount) * inFreqLen)
        const sample = inFreq[srcIdx] ?? 0
        this.smoothedFreq[i] =
          this._smoothingTimeConstant * this.smoothedFreq[i]! +
          (1 - this._smoothingTimeConstant) * sample
      }
    }

    const inWave = frame.timeDomainData
    const inWaveLen = inWave.length
    if (inWaveLen > 0) {
      for (let i = 0; i < this._fftSize; i++) {
        const srcIdx = inWaveLen === this._fftSize ? i : Math.floor((i / this._fftSize) * inWaveLen)
        this.latestWave[i] = inWave[srcIdx] ?? 128
      }
    }
  }

  private startPolling(fetchSpectrum: () => Promise<FftFrame | null>): void {
    let inFlight = false
    // Poll at ~60fps
    this.pollTimer = setInterval(async () => {
      if (this.isDisposed || inFlight) return
      inFlight = true
      try {
        const frame = await fetchSpectrum()
        if (frame) {
          this.feedFrame(frame)
        }
      } catch {
        // ignore polling failure
      } finally {
        inFlight = false
      }
    }, 16)
  }

  getByteFrequencyData(array: Uint8Array): void {
    const len = array.length
    const binCount = this.frequencyBinCount
    if (len === binCount) {
      for (let i = 0; i < len; i++) {
        array[i] = Math.round(this.smoothedFreq[i] ?? 0)
      }
    } else {
      // Linear resampling across bins
      for (let i = 0; i < len; i++) {
        const srcIdx = Math.floor((i / len) * binCount)
        array[i] = Math.round(this.smoothedFreq[srcIdx] ?? 0)
      }
    }
  }

  getByteTimeDomainData(array: Uint8Array): void {
    const len = array.length
    const waveLen = this.latestWave.length
    if (len === waveLen) {
      array.set(this.latestWave)
    } else {
      for (let i = 0; i < len; i++) {
        const srcIdx = Math.floor((i / len) * waveLen)
        array[i] = this.latestWave[srcIdx] ?? 128
      }
    }
  }

  dispose(): void {
    this.isDisposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }
}
