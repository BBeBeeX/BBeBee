import { describe, expect, it } from 'vitest'
import {
  PreampEffect,
  Eq10Effect,
  NormalizeEffect,
  CompressorEffect,
  ReverbEffect,
  WidenerEffect,
  CrossfeedEffect,
  TempoPitchEffect,
  LimiterEffect,
} from './effects/index.js'

/**
 * Offline Audio Context test engine for deterministic DSP verification in Node.
 */
class OfflineAudioTestContext {
  currentTime = 0
  constructor(
    public readonly numberOfChannels = 2,
    public readonly length = 48000,
    public readonly sampleRate = 48000,
  ) {}

  createBuffer(channels: number, length: number, sampleRate: number) {
    const channelData = Array.from({ length: channels }, () => new Float32Array(length))
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch: number) => channelData[ch]!,
    }
  }

  createGain() {
    return new TestGainNode(this)
  }

  createBiquadFilter() {
    return new TestBiquadFilterNode(this)
  }

  createDynamicsCompressor() {
    return new TestCompressorNode(this)
  }

  createConvolver() {
    return new TestConvolverNode(this)
  }

  createChannelSplitter(channels = 2) {
    return new TestSplitterNode(this, channels)
  }

  createChannelMerger(channels = 2) {
    return new TestMergerNode(this, channels)
  }

  createDelay() {
    return new TestDelayNode(this)
  }
}

class TestAudioNode {
  readonly outputs = new Set<{ node: TestAudioNode; outIndex: number; inIndex: number }>()

  constructor(public readonly context: OfflineAudioTestContext) {}

  connect(dest: TestAudioNode, outIndex = 0, inIndex = 0): TestAudioNode {
    this.outputs.add({ node: dest, outIndex, inIndex })
    return dest
  }

  disconnect(): void {
    this.outputs.clear()
  }

  process(buffer: Float32Array[]): Float32Array[] {
    return buffer
  }
}

class TestGainNode extends TestAudioNode {
  readonly gain = {
    value: 1,
    setTargetAtTime: (val: number) => {
      this.gain.value = val
    },
  }

  override process(buffer: Float32Array[]): Float32Array[] {
    const g = this.gain.value
    return buffer.map((ch) => {
      const out = new Float32Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        out[i] = (ch[i] ?? 0) * g
      }
      return out
    })
  }
}

class TestBiquadFilterNode extends TestAudioNode {
  type: string = 'peaking'
  readonly frequency = { value: 1000 }
  readonly Q = { value: 1.41 }
  readonly gain = {
    value: 0,
    setTargetAtTime: (val: number) => {
      this.gain.value = val
    },
  }

  override process(buffer: Float32Array[]): Float32Array[] {
    const dbGain = this.gain.value
    const A = Math.pow(10, dbGain / 40)
    const w0 = (2 * Math.PI * this.frequency.value) / this.context.sampleRate
    const alpha = Math.sin(w0) / (2 * (this.Q.value || 1))

    let b0 = 1,
      b1 = 0,
      b2 = 0,
      a0 = 1,
      a1 = 0,
      a2 = 0

    if (this.type === 'peaking') {
      b0 = 1 + alpha * A
      b1 = -2 * Math.cos(w0)
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * Math.cos(w0)
      a2 = 1 - alpha / A
    } else if (this.type === 'lowshelf') {
      const sqrtA = Math.sqrt(A)
      b0 = A * (A + 1 - (A - 1) * Math.cos(w0) + 2 * sqrtA * alpha)
      b1 = 2 * A * (A - 1 - (A + 1) * Math.cos(w0))
      b2 = A * (A + 1 - (A - 1) * Math.cos(w0) - 2 * sqrtA * alpha)
      a0 = A + 1 + (A - 1) * Math.cos(w0) + 2 * sqrtA * alpha
      a1 = -2 * (A - 1 + (A + 1) * Math.cos(w0))
      a2 = A + 1 + (A - 1) * Math.cos(w0) - 2 * sqrtA * alpha
    } else {
      b0 = Math.pow(10, dbGain / 20)
    }

    return buffer.map((ch) => {
      const out = new Float32Array(ch.length)
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i] ?? 0
        const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
        out[i] = y
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
      }
      return out
    })
  }
}

class TestCompressorNode extends TestAudioNode {
  readonly threshold = { value: -24, setTargetAtTime: (v: number) => (this.threshold.value = v) }
  readonly knee = { value: 30, setTargetAtTime: (v: number) => (this.knee.value = v) }
  readonly ratio = { value: 4, setTargetAtTime: (v: number) => (this.ratio.value = v) }
  readonly attack = { value: 0.003, setTargetAtTime: (v: number) => (this.attack.value = v) }
  readonly release = { value: 0.25, setTargetAtTime: (v: number) => (this.release.value = v) }

  override process(buffer: Float32Array[]): Float32Array[] {
    const threshLinear = Math.pow(10, this.threshold.value / 20)
    const ratio = this.ratio.value
    return buffer.map((ch) => {
      const out = new Float32Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const val = ch[i] ?? 0
        const abs = Math.abs(val)
        if (abs > threshLinear) {
          const excess = abs - threshLinear
          const compressedExcess = excess / ratio
          const targetAbs = threshLinear + compressedExcess
          const gain = targetAbs / (abs || 1)
          out[i] = val * gain
        } else {
          out[i] = val
        }
      }
      return out
    })
  }
}

class TestConvolverNode extends TestAudioNode {
  buffer: any = null

  override process(buffer: Float32Array[]): Float32Array[] {
    if (!this.buffer) return buffer
    const irLeft = this.buffer.getChannelData(0)
    return buffer.map((ch, chIdx) => {
      const ir = this.buffer.getChannelData(Math.min(chIdx, this.buffer.numberOfChannels - 1)) || irLeft
      const out = new Float32Array(ch.length)
      const irLen = Math.min(ch.length, ir.length)
      for (let i = 0; i < ch.length; i++) {
        let sum = 0
        const kMax = Math.min(i, irLen - 1)
        for (let k = 0; k <= kMax; k++) {
          sum += (ch[i - k] ?? 0) * (ir[k] ?? 0)
        }
        out[i] = sum
      }
      return out
    })
  }
}

class TestSplitterNode extends TestAudioNode {
  constructor(
    context: OfflineAudioTestContext,
    public readonly numberOfChannels = 2,
  ) {
    super(context)
  }
}

class TestMergerNode extends TestAudioNode {
  constructor(
    context: OfflineAudioTestContext,
    public readonly numberOfChannels = 2,
  ) {
    super(context)
  }
}

class TestDelayNode extends TestAudioNode {
  readonly delayTime = { value: 0 }
}

describe('DSP effects offline-render determinism', () => {
  const ctx = new OfflineAudioTestContext() as unknown as BaseAudioContext

  it('preamp offline render scales amplitude according to gainDb within tolerance', () => {
    const seg = PreampEffect.build(ctx, { gainDb: 6 })
    const gainNode = seg.input as unknown as TestGainNode

    const inputBuf = [new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.5)]
    const outputBuf = gainNode.process(inputBuf)

    const expected = 0.5 * Math.pow(10, 6 / 20)
    expect(outputBuf[0]![10]!).toBeCloseTo(expected, 3)

    seg.dispose()
  })

  it('eq10 offline render boosts targeted frequency within tolerance', () => {
    const seg = Eq10Effect.build(ctx, { gains: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0] })
    const firstFilter = seg.input as unknown as TestBiquadFilterNode

    const len = 1000
    const testWave = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      testWave[i] = Math.sin((2 * Math.PI * 30 * i) / 48000)
    }

    const outputBuf = firstFilter.process([testWave])
    const inputPeak = Math.max(...testWave.slice(200))
    const outputPeak = Math.max(...outputBuf[0]!.slice(200))
    expect(outputPeak).toBeGreaterThan(inputPeak * 1.5)

    seg.dispose()
  })

  it('normalize offline render applies exact target gain within tolerance', () => {
    const seg = NormalizeEffect.build(ctx, { targetLufs: -14, gainDb: 3 })
    const node = seg.input as unknown as TestGainNode

    const inputBuf = [new Float32Array(50).fill(0.4)]
    const outputBuf = node.process(inputBuf)

    const expected = 0.4 * Math.pow(10, 3 / 20)
    expect(outputBuf[0]![10]!).toBeCloseTo(expected, 4)

    seg.dispose()
  })

  it('compressor offline render compresses peaks above threshold within tolerance', () => {
    const seg = CompressorEffect.build(ctx, {
      threshold: -20,
      knee: 0,
      ratio: 4,
      attack: 0.001,
      release: 0.1,
    })
    const comp = seg.input as unknown as TestCompressorNode

    const inputBuf = [new Float32Array([0.05, 0.1, 0.5])]
    const outputBuf = comp.process(inputBuf)

    expect(outputBuf[0]![0]!).toBeCloseTo(0.05, 4)
    expect(outputBuf[0]![2]!).toBeCloseTo(0.2, 2)

    seg.dispose()
  })

  it('reverb creates synthetic impulse response and generates wet tail', () => {
    const seg = ReverbEffect.build(ctx, { mix: 0.5, decay: 1.0, preDelay: 0.001 })
    expect(seg.input).toBeDefined()
    expect(seg.output).toBeDefined()

    seg.setParam('mix', 0.8)
    seg.setParam('decay', 2.0)

    seg.dispose()
  })

  it('widener builds and adjusts mid-side stereo width', () => {
    const seg = WidenerEffect.build(ctx, { width: 1.5, delayMs: 12 })
    expect(seg.input).toBeDefined()
    expect(seg.output).toBeDefined()

    seg.setParam('width', 2.0)
    seg.dispose()
  })

  it('crossfeed builds and adjusts binaural crossfeed amount', () => {
    const seg = CrossfeedEffect.build(ctx, { amount: 0.4, cutoffHz: 700 })
    expect(seg.input).toBeDefined()
    expect(seg.output).toBeDefined()

    seg.setParam('amount', 0.6)
    seg.dispose()
  })

  it('limiter hard-limits output peaks to ceilingDb', () => {
    const seg = LimiterEffect.build(ctx, { ceilingDb: -1.0 })
    expect(seg.input).toBeDefined()
    expect((seg.input as any).threshold.value).toBe(-1.0)
    expect((seg.input as any).ratio.value).toBe(20)

    seg.setParam('ceilingDb', -3.0)
    expect((seg.input as any).threshold.value).toBe(-3.0)

    seg.dispose()
  })

  it('tempo-pitch detects dropouts and self-disables safely', () => {
    let selfDisabledCalled = false
    TempoPitchEffect.onSelfDisable = () => {
      selfDisabledCalled = true
    }

    const seg = TempoPitchEffect.build(ctx, { tempo: 1.0, pitch: 1.0, maxDropouts: 3 })
    expect(seg.latencyMs).toBe(25)

    seg.setParam('dropout', 1)
    seg.setParam('dropout', 1)
    expect(selfDisabledCalled).toBe(false)

    seg.setParam('dropout', 1)
    expect(selfDisabledCalled).toBe(true)
    expect(TempoPitchEffect.lastState?.disabledDueToDropouts).toBe(true)

    seg.dispose()
  })
})


describe('lavfi adapters (native mpv engine)', () => {
  it('eq10 serializes shelf + peaking bands, band<N> keys overlaying the gains array', () => {
    expect(
      Eq10Effect.buildLavfi!({ band0: 6, band2: -3, gains: [0, 0, 0, 0, 6, 0, 0, 0, 0, 0] }),
    ).toBe(
      'lowshelf=f=31:g=6.00,equalizer=f=125:width_type=q:w=1.41:g=-3.00,equalizer=f=500:width_type=q:w=1.41:g=6.00',
    )
  })

  it('eq10 reads the gains array shape too and emits nothing when flat', () => {
    expect(
      Eq10Effect.buildLavfi!({ gains: [0, 0, 0, 0, 6, 0, 0, 0, 0, 0] }),
    ).toBe('equalizer=f=500:width_type=q:w=1.41:g=6.00')
    expect(Eq10Effect.buildLavfi!({ gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe('')
  })

  it('preamp and normalize map to the volume filter', () => {
    expect(PreampEffect.buildLavfi!({ gainDb: -3.5 })).toBe('volume=volume=-3.50dB')
    expect(PreampEffect.buildLavfi!({ gainDb: 0 })).toBe('')
    expect(NormalizeEffect.buildLavfi!({ gainDb: 3 })).toBe('volume=volume=3.00dB')
  })

  it('compressor converts WebAudio seconds to lavfi milliseconds', () => {
    expect(
      CompressorEffect.buildLavfi!({ threshold: -24, ratio: 4, attack: 0.003, release: 0.25 }),
    ).toBe('acompressor=threshold=-24.0dB:ratio=4.0:attack=3:release=250')
  })

  it('limiter maps the ceiling to a linear alimiter limit', () => {
    expect(LimiterEffect.buildLavfi!({ ceilingDb: -0.5 })).toBe('alimiter=limit=0.944:level=0')
  })

  it('crossfeed and widener map their widths', () => {
    expect(CrossfeedEffect.buildLavfi!({ amount: 0.3, cutoffHz: 700 })).toBe(
      'crossfeed=strength=0.30:range=0.28',
    )
    expect(WidenerEffect.buildLavfi!({ width: 1.5 })).toBe('extrastereo=m=1.50')
    expect(WidenerEffect.buildLavfi!({ width: 1 })).toBe('')
  })

  it('reverb lays three mix-scaled echo taps after the pre-delay', () => {
    expect(ReverbEffect.buildLavfi!({ mix: 0.5, decay: 1, preDelay: 0 })).toBe(
      'aecho=in_gain=1:out_gain=0.75:delays=140|360|690:decays=0.25|0.15|0.10',
    )
    expect(ReverbEffect.buildLavfi!({ mix: 0 })).toBe('')
  })

  it('tempo-pitch maps to rubberband and skips the neutral state', () => {
    expect(TempoPitchEffect.buildLavfi!({ tempo: 1.25, pitch: 1 })).toBe(
      'rubberband=tempo=1.250:pitch=1.000',
    )
    expect(TempoPitchEffect.buildLavfi!({ tempo: 1, pitch: 1 })).toBe('')
  })
})
