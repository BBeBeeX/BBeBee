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
  /**
   * Channel count the engine reports for this frame. Absent means
   * the mono pair is all there is. The per-channel arrays below are
   * only trusted when this is 2.
   */
  channels?: number
  /** Sample rate in Hz the engine reports for this frame, if any. */
  sampleRateHz?: number
  /** Per-channel pairs, present only on stereo frames. */
  leftFrequencyData?: number[] | Uint8Array
  leftTimeDomainData?: number[] | Uint8Array
  rightFrequencyData?: number[] | Uint8Array
  rightTimeDomainData?: number[] | Uint8Array
}

export interface AudioAnalyser {
  readonly fftSize: number
  readonly frequencyBinCount: number
  smoothingTimeConstant: number

  /** 2 only when the analyser is fed per-channel frames; absent means 1. */
  readonly channels?: 1 | 2
  /** Sample rate in Hz of the frame source, when the engine reports one. */
  readonly sampleRateHz?: number

  setFftSize(size: number): void
  getByteFrequencyData(array: Uint8Array): void
  getByteTimeDomainData(array: Uint8Array): void
  pause?(): void
  resume?(): void
  attachConsumer?(): () => void
  /** Left-channel frequency data; fills silence unless channels === 2. */
  getLeftByteFrequencyData?(array: Uint8Array): void
  /** Right-channel frequency data; fills silence unless channels === 2. */
  getRightByteFrequencyData?(array: Uint8Array): void
  /** Left-channel time-domain data; fills silence unless channels === 2. */
  getLeftByteTimeDomainData?(array: Uint8Array): void
  /** Right-channel time-domain data; fills silence unless channels === 2. */
  getRightByteTimeDomainData?(array: Uint8Array): void
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

  attachConsumer(): () => void {
    return () => {}
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
  private smoothedLeftFreq: Float32Array
  private smoothedRightFreq: Float32Array
  private latestWaveLeft: Uint8Array
  private latestWaveRight: Uint8Array
  private _channels: 1 | 2 = 1
  private _sampleRateHz?: number
  private pollTimer?: ReturnType<typeof setInterval>
  private isDisposed = false
  private isPaused = false
  private consumerCount = 0
  private readonly lazy: boolean
  private readonly fetchSpectrum?: () => Promise<FftFrame | null>
  private onVisibilityChange?: () => void

  constructor(
    options: {
      fftSize?: number
      smoothingTimeConstant?: number
      fetchSpectrum?: () => Promise<FftFrame | null>
      lazy?: boolean
    } = {},
  ) {
    this._fftSize = options.fftSize ?? 128
    this._smoothingTimeConstant = options.smoothingTimeConstant ?? 0.82
    this.fetchSpectrum = options.fetchSpectrum
    this.lazy = options.lazy ?? false

    const binCount = this._fftSize / 2
    this.smoothedFreq = new Float32Array(binCount)
    this.latestWave = new Uint8Array(this._fftSize).fill(128)
    this.smoothedLeftFreq = new Float32Array(binCount)
    this.smoothedRightFreq = new Float32Array(binCount)
    this.latestWaveLeft = new Uint8Array(this._fftSize).fill(128)
    this.latestWaveRight = new Uint8Array(this._fftSize).fill(128)

    if (typeof document !== 'undefined') {
      this.onVisibilityChange = () => {
        if (document.hidden) {
          this.pausePolling()
        } else if (!this.isPaused) {
          this.resumePolling()
        }
      }
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }

    if (this.fetchSpectrum && !this.lazy) {
      if (typeof document === 'undefined' || !document.hidden) {
        this.startPolling()
      }
    }
  }

  attachConsumer(): () => void {
    this.consumerCount++
    if (this.consumerCount === 1 && !this.isPaused) {
      this.resumePolling()
    }
    return () => {
      this.consumerCount = Math.max(0, this.consumerCount - 1)
      if (this.consumerCount === 0 && this.lazy) {
        this.pausePolling()
      }
    }
  }

  get channels(): 1 | 2 {
    return this._channels
  }

  get sampleRateHz(): number | undefined {
    return this._sampleRateHz
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
    this.smoothedLeftFreq = new Float32Array(binCount)
    this.smoothedRightFreq = new Float32Array(binCount)
    this.latestWaveLeft = new Uint8Array(valid).fill(128)
    this.latestWaveRight = new Uint8Array(valid).fill(128)
  }

  private smoothInto(target: Float32Array, input: number[] | Uint8Array): void {
    const inLen = input.length
    const binCount = this.frequencyBinCount
    if (inLen === 0) return
    for (let i = 0; i < binCount; i++) {
      // Resample/map to target bin count if sizes differ
      const srcIdx = inLen === binCount ? i : Math.floor((i / binCount) * inLen)
      const sample = input[srcIdx] ?? 0
      target[i] =
        this._smoothingTimeConstant * target[i]! + (1 - this._smoothingTimeConstant) * sample
    }
  }

  private copyWaveInto(target: Uint8Array, input: number[] | Uint8Array): void {
    const inLen = input.length
    if (inLen === 0) return
    for (let i = 0; i < this._fftSize; i++) {
      const srcIdx = inLen === this._fftSize ? i : Math.floor((i / this._fftSize) * inLen)
      target[i] = input[srcIdx] ?? 128
    }
  }

  /** Ingests a new spectrum frame from libmpv native audio-engine. */
  feedFrame(frame: FftFrame): void {
    if (this.isDisposed || !frame) return

    this.smoothInto(this.smoothedFreq, frame.frequencyData)
    this.copyWaveInto(this.latestWave, frame.timeDomainData)

    // Stereo is accepted only as a package: channels === 2 and all
    // four arrays present. Anything less is a mono frame, and the
    // previous stereo state is cleared to silence rather than left
    // stale — a mono frame following a stereo one must not keep
    // serving the old stereo picture.
    const stereo =
      frame.channels === 2 &&
      frame.leftFrequencyData &&
      frame.leftTimeDomainData &&
      frame.rightFrequencyData &&
      frame.rightTimeDomainData
    if (stereo) {
      this._channels = 2
      this._sampleRateHz = frame.sampleRateHz
      this.smoothInto(this.smoothedLeftFreq, frame.leftFrequencyData!)
      this.smoothInto(this.smoothedRightFreq, frame.rightFrequencyData!)
      this.copyWaveInto(this.latestWaveLeft, frame.leftTimeDomainData!)
      this.copyWaveInto(this.latestWaveRight, frame.rightTimeDomainData!)
    } else {
      this._channels = 1
      this._sampleRateHz = frame.sampleRateHz
      this.smoothedLeftFreq.fill(0)
      this.smoothedRightFreq.fill(0)
      this.latestWaveLeft.fill(128)
      this.latestWaveRight.fill(128)
    }
  }

  pause(): void {
    this.isPaused = true
    this.pausePolling()
  }

  resume(): void {
    this.isPaused = false
    if (this.lazy && this.consumerCount <= 0) return
    if (typeof document === 'undefined' || !document.hidden) {
      this.resumePolling()
    }
  }

  private pausePolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  private resumePolling(): void {
    if (this.isDisposed || this.isPaused || this.pollTimer || !this.fetchSpectrum) return
    if (this.lazy && this.consumerCount <= 0) return
    this.startPolling()
  }

  private startPolling(): void {
    if (this.pollTimer || !this.fetchSpectrum || this.isDisposed || this.isPaused) return
    if (this.lazy && this.consumerCount <= 0) return
    let inFlight = false
    // Poll at ~60fps
    this.pollTimer = setInterval(async () => {
      if (this.isDisposed || this.isPaused || inFlight) return
      if (this.lazy && this.consumerCount <= 0) {
        this.pausePolling()
        return
      }
      if (typeof document !== 'undefined' && document.hidden) {
        this.pausePolling()
        return
      }
      inFlight = true
      try {
        const frame = await this.fetchSpectrum!()
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

  private fillFromSmoothed(array: Uint8Array, source: Float32Array): void {
    const len = array.length
    const binCount = this.frequencyBinCount
    if (len === binCount) {
      for (let i = 0; i < len; i++) {
        array[i] = Math.round(source[i] ?? 0)
      }
    } else {
      // Linear resampling across bins
      for (let i = 0; i < len; i++) {
        const srcIdx = Math.floor((i / len) * binCount)
        array[i] = Math.round(source[srcIdx] ?? 0)
      }
    }
  }

  private fillFromWave(array: Uint8Array, source: Uint8Array): void {
    const len = array.length
    const waveLen = source.length
    if (len === waveLen) {
      array.set(source)
    } else {
      for (let i = 0; i < len; i++) {
        const srcIdx = Math.floor((i / len) * waveLen)
        array[i] = source[srcIdx] ?? 128
      }
    }
  }

  getByteFrequencyData(array: Uint8Array): void {
    this.fillFromSmoothed(array, this.smoothedFreq)
  }

  getByteTimeDomainData(array: Uint8Array): void {
    this.fillFromWave(array, this.latestWave)
  }

  getLeftByteFrequencyData(array: Uint8Array): void {
    this.fillFromSmoothed(array, this.smoothedLeftFreq)
  }

  getRightByteFrequencyData(array: Uint8Array): void {
    this.fillFromSmoothed(array, this.smoothedRightFreq)
  }

  getLeftByteTimeDomainData(array: Uint8Array): void {
    this.fillFromWave(array, this.latestWaveLeft)
  }

  getRightByteTimeDomainData(array: Uint8Array): void {
    this.fillFromWave(array, this.latestWaveRight)
  }

  dispose(): void {
    this.isDisposed = true
    this.pausePolling()
    if (this.onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.onVisibilityChange = undefined
    }
  }
}
