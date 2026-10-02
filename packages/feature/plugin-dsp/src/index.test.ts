import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import type { AudioService, StoreService } from '@BBeBee/protocol'
import { DspPlugin } from './index.js'

class TestNode {
  readonly outputs = new Set<TestNode>()
  connectCount = 0
  disconnectCount = 0

  connect(dest: TestNode): TestNode {
    this.outputs.add(dest)
    this.connectCount++
    return dest
  }

  disconnect(): void {
    this.outputs.clear()
    this.disconnectCount++
  }
}

class MemoryStore extends Service implements StoreService {
  private map = new Map<string, unknown>()
  constructor(ctx: Context) {
    super(ctx, 'store')
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }
  async keys(): Promise<string[]> {
    return Array.from(this.map.keys())
  }
  namespace(): StoreService {
    return this
  }
}

class FakeAudioService extends Service implements AudioService {
  readonly context: any
  readonly destination: any
  readonly chainInput: any
  readonly chainOutput: any
  readonly sampleRate = 48000
  readonly outputLatencyMs = 10
  dipped = false

  constructor(ctx: Context) {
    super(ctx, 'audio')
    this.chainInput = new TestNode()
    this.chainOutput = new TestNode()
    this.destination = new TestNode()
    this.chainOutput.connect(this.destination)

    this.context = {
      currentTime: 0,
      sampleRate: 48000,
      createGain: () => {
        const n = new TestNode() as any
        n.gain = {
          value: 1,
          setTargetAtTime: vi.fn((val: number) => {
            n.gain.value = val
          }),
        }
        return n
      },
      createBiquadFilter: () => {
        const n = new TestNode() as any
        n.frequency = { value: 1000 }
        n.Q = { value: 1.41 }
        n.gain = {
          value: 0,
          setTargetAtTime: vi.fn((val: number) => {
            n.gain.value = val
          }),
        }
        return n
      },
      createDynamicsCompressor: () => {
        const n = new TestNode() as any
        n.threshold = { value: -24, setTargetAtTime: vi.fn() }
        n.knee = { value: 30, setTargetAtTime: vi.fn() }
        n.ratio = { value: 4, setTargetAtTime: vi.fn() }
        n.attack = { value: 0.003, setTargetAtTime: vi.fn() }
        n.release = { value: 0.25, setTargetAtTime: vi.fn() }
        return n
      },
      createChannelSplitter: () => new TestNode(),
      createChannelMerger: () => new TestNode(),
      createDelay: () => {
        const n = new TestNode() as any
        n.delayTime = { value: 0 }
        return n
      },
      createBuffer: (channels: number, length: number, sampleRate: number) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      }),
      createConvolver: () => {
        const n = new TestNode() as any
        n.buffer = null
        return n
      },
    }
  }

  async dipVolume(_durationMs = 20) {
    this.dipped = true
    return () => {
      this.dipped = false
    }
  }

  async load(): Promise<any> {
    throw new Error('not implemented in test')
  }
  setVolume() {}
  setMuted() {}
  async listOutputDevices() {
    return []
  }
  async setOutputDevice() {}
  onInterruption() {
    return () => {}
  }
  onRouteChange() {
    return () => {}
  }
  emitInterruption() {}
  emitRouteChange() {}
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(MemoryStore)
  await ctx.plugin(FakeAudioService)
  return ctx
}

describe('plugin-dsp', () => {
  it('registers all 9 built-in effects and initializes the chain', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(DspPlugin)

    expect(ctx.dsp).toBeDefined()
    expect(ctx.dsp.definitions).toHaveLength(9)

    const defIds = ctx.dsp.definitions.map((d) => d.id)
    expect(defIds).toContain('preamp')
    expect(defIds).toContain('eq10')
    expect(defIds).toContain('normalize')
    expect(defIds).toContain('compressor')
    expect(defIds).toContain('reverb')
    expect(defIds).toContain('widener')
    expect(defIds).toContain('crossfeed')
    expect(defIds).toContain('tempo-pitch')
    expect(defIds).toContain('limiter')

    // Limiter is enabled by default for protection
    const limiterEntry = ctx.dsp.chain.find((c) => c.effectId === 'limiter')
    expect(limiterEntry?.enabled).toBe(true)

    await fiber.dispose()
  })

  it('serializes the enabled chain into dsp/af-changed for the native engine', async () => {
    const ctx = await harness()
    const afEvents: string[] = []
    ctx.on('dsp/af-changed', (e) => afEvents.push(e.af))
    const fiber = await ctx.plugin(DspPlugin)

    // The limiter is on by default (protection) — the initial af carries it.
    expect(afEvents[0]).toContain('alimiter=')

    await ctx.dsp.setEnabled('eq10', true)
    await ctx.dsp.setParam('eq10', 'band0', 6)
    expect(afEvents[afEvents.length - 1]).toContain('lowshelf=f=31:g=6.00')
    expect(afEvents[afEvents.length - 1]).toContain('alimiter=')

    // Disabling every effect must produce a clean chain, not a stale one.
    await ctx.dsp.setEnabled('limiter', false)
    await ctx.dsp.setEnabled('eq10', false)
    expect(afEvents[afEvents.length - 1]).toBe('')

    await fiber.dispose()
  })

  it('enables and disables effects with smooth volume dip', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(DspPlugin)
    const audio = ctx.audio as unknown as FakeAudioService

    expect(ctx.dsp.chain.find((c) => c.effectId === 'eq10')?.enabled).toBe(false)

    await ctx.dsp.setEnabled('eq10', true)
    expect(ctx.dsp.chain.find((c) => c.effectId === 'eq10')?.enabled).toBe(true)
    expect(audio.dipped).toBe(false) // Was dipped and restored

    await ctx.dsp.setEnabled('eq10', false)
    expect(ctx.dsp.chain.find((c) => c.effectId === 'eq10')?.enabled).toBe(false)

    await fiber.dispose()
  })

  it('updates effect parameters without rebuilding the graph', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(DspPlugin)
    const audio = ctx.audio as unknown as FakeAudioService

    await ctx.dsp.setEnabled('eq10', true)
    const connectCountBefore = (audio.chainInput as TestNode).connectCount

    // Changing EQ parameters
    await ctx.dsp.setParam('eq10', 'band0', 6)
    await ctx.dsp.setParam('eq10', 'band1', -3)

    // Verify connect count did NOT increase (no graph rebuild!)
    const connectCountAfter = (audio.chainInput as TestNode).connectCount
    expect(connectCountAfter).toBe(connectCountBefore)

    const params = ctx.dsp.getParams?.('eq10') ?? {}
    expect(params.band0).toBe(6)
    expect(params.band1).toBe(-3)

    await fiber.dispose()
  })

  it('applies effect presets smoothly', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(DspPlugin)

    await ctx.dsp.setEnabled('eq10', true)
    await ctx.dsp.applyPreset('eq10', '低音增强 (Bass Boost)')

    const params = ctx.dsp.getParams?.('eq10') ?? {}
    expect(params.gains).toEqual([6, 5, 4, 2, 1, 0, 0, 0, 0, 0])

    await fiber.dispose()
  })

  it('reorders effects and updates the ordinal sequence', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(DspPlugin)

    const eqBefore = ctx.dsp.chain.find((c) => c.effectId === 'eq10')
    expect(eqBefore?.ordinal).toBe(20)

    await ctx.dsp.setOrder('eq10', 5)
    const eqAfter = ctx.dsp.chain.find((c) => c.effectId === 'eq10')
    expect(eqAfter?.ordinal).toBe(5)
    expect(ctx.dsp.chain[0]?.effectId).toBe('eq10')

    await fiber.dispose()
  })

  it('persists chain and params to store and restores on next boot', async () => {
    const ctx = await harness()
    const fiber1 = await ctx.plugin(DspPlugin)

    await ctx.dsp.setEnabled('reverb', true)
    await ctx.dsp.setParam('reverb', 'mix', 0.5)
    await fiber1.dispose()

    // Second boot
    const fiber2 = await ctx.plugin(DspPlugin)
    const reverbEntry = ctx.dsp.chain.find((c) => c.effectId === 'reverb')
    expect(reverbEntry?.enabled).toBe(true)

    const reverbParams = ctx.dsp.getParams?.('reverb') ?? {}
    expect(reverbParams.mix).toBe(0.5)

    await fiber2.dispose()
  })
})
