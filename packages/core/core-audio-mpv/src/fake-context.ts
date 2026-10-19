/**
 * A fake Web Audio engine, for running the audio conformance suite in Node.
 *
 * Not a mock of `ctx.audio` — that would test nothing. This is a fake of the
 * *engine underneath it*: `createGain`, `createBufferSource`, `decodeAudioData`
 * and a clock the test drives. The service under test is the real one, so the
 * graph wiring, the offset arithmetic and the one-shot source lifecycle are
 * all genuinely exercised; only the sound card is absent.
 *
 * Exported from the package (not the test file) because the desktop shell's
 * smoke tests want it too, and because a second copy would drift.
 */

export interface FakeClock {
  /** Advance the audio clock, firing anything scheduled in that window. */
  advance(ms: number): Promise<void>
  now(): number
}

class FakeParam {
  constructor(public value: number) {}
  setTargetAtTime(target: number): void {
    this.value = target
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>()
  connectCount = 0
  disconnectCount = 0

  connect(destination: FakeNode): FakeNode {
    this.outputs.add(destination)
    this.connectCount++
    return destination
  }

  disconnect(): void {
    this.outputs.clear()
    this.disconnectCount++
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1)
}

class FakeBufferSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  startOffset = 0
  startedAt = 0

  constructor(private readonly context: FakeAudioContext) {
    super()
  }

  start(_when = 0, offset = 0): void {
    if (this.started) throw new Error('cannot start a source twice')
    this.started = true
    this.startOffset = offset
    this.startedAt = this.context.currentTime
    if (this.buffer) {
      this.context.schedule(this.buffer.duration - offset, () => {
        if (this.stopped) return
        this.stopped = true
        this.onended?.()
      })
    }
  }

  stop(): void {
    if (!this.started) throw new Error('cannot stop a source that never started')
    if (this.stopped) throw new Error('cannot stop a source twice')
    this.stopped = true
  }
}

class FakeAudioBuffer {
  constructor(
    readonly duration: number,
    readonly sampleRate: number,
    readonly numberOfChannels = 2,
  ) {}
  get length(): number {
    return Math.round(this.duration * this.sampleRate)
  }

  /** Per-channel storage, allocated on first touch so `.set()` can fill it. */
  private readonly channels = new Map<number, Float32Array>()

  getChannelData(channel: number): Float32Array {
    let data = this.channels.get(channel)
    if (!data) {
      data = new Float32Array(this.length)
      this.channels.set(channel, data)
    }
    return data
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
    this.getChannelData(channelNumber).set(source, startInChannel)
  }
}

interface Scheduled {
  at: number
  run(): void
}

/**
 * The fake context.
 *
 * `currentTime` only moves when the test moves it, which is what makes the
 * position assertions deterministic rather than flaky.
 */
export class FakeAudioContext {
  readonly sampleRate: number
  readonly baseLatency = 0.01
  readonly destination = new FakeNode()
  currentTime = 0
  closed = false
  state = 'running'

  /** Duration `decodeAudioData` reports, in seconds. */
  decodedDuration = 2

  /** `sampleRate` is configurable so tests can exercise context reconstruction. */
  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate
  }

  private readonly scheduled: Scheduled[] = []
  private readonly stateListeners = new Set<() => void>()

  /** Every element wrapped by `createMediaElementSource`, in order. */
  readonly mediaSources: { element: unknown; node: FakeNode }[] = []

  createGain(): FakeGain {
    return new FakeGain()
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this)
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length / sampleRate, sampleRate, channels)
  }

  addEventListener(type: 'statechange', listener: () => void): void {
    if (type === 'statechange') this.stateListeners.add(listener)
  }

  removeEventListener(type: 'statechange', listener: () => void): void {
    if (type === 'statechange') this.stateListeners.delete(listener)
  }

  async resume(): Promise<void> {
    this.setState('running')
  }

  /** Test driver: move the state the way the engine would, firing the event. */
  setState(state: string): void {
    if (this.state === state) return
    this.state = state
    for (const listener of [...this.stateListeners]) listener()
  }

  /** Listeners still attached, so a disposed service can be shown to leave none. */
  countStateListeners(): number {
    return this.stateListeners.size
  }

  /**
   * The streamed half of `load()`.
   *
   * Real Web Audio wraps the element; nothing here needs to, because the
   * element itself is what a streamed handle listens to. Returning a plain
   * node is enough to exercise the wiring and the stall mapping without a
   * network or a decoder.
   */
  createMediaElementSource(element: unknown): FakeNode {
    const node = new FakeNode()
    this.mediaSources.push({ element, node })
    return node
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(this.decodedDuration, this.sampleRate)
  }

  async close(): Promise<void> {
    this.closed = true
    this.setState('closed')
  }

  /** Called by fake sources; not part of the Web Audio API. */
  schedule(afterSeconds: number, run: () => void): void {
    this.scheduled.push({ at: this.currentTime + Math.max(0, afterSeconds), run })
  }

  async advance(ms: number): Promise<void> {
    const target = this.currentTime + ms / 1000
    for (;;) {
      const next = this.scheduled
        .filter((s) => s.at <= target)
        .sort((a, b) => a.at - b.at)
        .shift()
      if (!next) break
      this.scheduled.splice(this.scheduled.indexOf(next), 1)
      this.currentTime = next.at
      next.run()
      // Let any promise the callback started settle before the next event.
      await Promise.resolve()
    }
    this.currentTime = target
    await Promise.resolve()
  }
}

export function createFakeAudioContext(sampleRate?: number): FakeAudioContext {
  return new FakeAudioContext(sampleRate)
}
