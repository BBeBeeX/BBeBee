import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { CapabilityError } from '@BBeBee/protocol'
import type { InterruptionEvent } from '@BBeBee/protocol'
import { audioConformance } from '@BBeBee/protocol/conformance'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { AudioWebAudio } from './index.js'
import type { AudioWebAudioConfig } from './index.js'
import { type FakeAudioContext, createFakeAudioContext } from './fake-context.js'

/**
 * A media element, as far as a streamed handle is concerned.
 *
 * The real one is an `HTMLAudioElement` whose buffer state arrives as events;
 * this is the same surface with the events under the test's control, which is
 * what makes an underrun something a test can cause rather than wait for.
 */
class FakeMediaElement {
  src = ''
  crossOrigin: string | null = null
  currentTime = 0
  duration = 120
  paused = true
  seeking = false
  error: { code?: number; message?: string } | null = null
  private readonly listeners = new Map<string, Set<() => void>>()

  async play(): Promise<void> {
    this.paused = false
  }

  pause(): void {
    this.paused = true
  }

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** Fire an event the way the platform would. */
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  /** Listeners still attached, so a disposed handle can be shown to leave none. */
  countListeners(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}

/**
 * The service under test is the real one; only the engine below it is fake.
 * The graph wiring, offset arithmetic and one-shot source lifecycle are
 * therefore genuinely exercised.
 */
async function harness(config: Partial<AudioWebAudioConfig> = {}): Promise<{
  ctx: Context
  audio: AudioWebAudio
  engine: FakeAudioContext
  elements: FakeMediaElement[]
}> {
  const engine = createFakeAudioContext()
  const elements: FakeMediaElement[] = []
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => engine as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
    createMediaElement: () => {
      const element = new FakeMediaElement()
      elements.push(element)
      return element
    },
    ...config,
  })
  await tick()
  return { ctx, audio: ctx.audio as AudioWebAudio, engine, elements }
}

/** The one harness with no media element, for the refusal case. */
async function harnessWithoutMediaElement(): Promise<{ audio: AudioWebAudio }> {
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => createFakeAudioContext() as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
    // Explicitly none: `defaultMediaElementFactory()` finds nothing in Node,
    // and saying so here keeps the case honest if that ever changes.
    createMediaElement: undefined,
  })
  await tick()
  return { audio: ctx.audio as AudioWebAudio }
}

describe('core-audio-webaudio', () => {
  it('activates and claims ctx.audio', async () => {
    const { ctx } = await harness()
    expect(ctx.audio).toBeInstanceOf(AudioWebAudio)
  })

  it('wires sources into chainInput, never straight to the destination', async () => {
    // The empty splice point is the whole reason chainInput exists: effects
    // arrive at M4 without touching a playing source (docs/05 §1).
    const { audio, engine } = await harness()
    const chainInput = audio.chainInput as unknown as { outputs: Set<unknown> }
    expect(chainInput.outputs.has(engine.destination)).toBe(false)

    const master = [...chainInput.outputs][0] as { outputs: Set<unknown> }
    expect(master, 'chainInput must feed the master gain').toBeDefined()
    expect(master.outputs.has(engine.destination)).toBe(true)
  })

  it('refuses to stream where the platform has no media element', async () => {
    const { audio } = await harnessWithoutMediaElement()
    await expect(audio.load('https://example.org/a.mp3', { strategy: 'stream' })).rejects.toThrow(
      /media element/,
    )
  })

  it('streams through a media element, wired into chainInput like any source', async () => {
    const { audio, engine, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    expect(elements).toHaveLength(1)
    expect(elements[0]!.src).toBe('https://example.org/a.mp3')
    // CORS mode, or the wrapped element's node outputs silence — see
    // `MediaElementLike.crossOrigin`.
    expect(elements[0]!.crossOrigin).toBe('anonymous')
    expect(engine.mediaSources, 'the element is wrapped, not played on its own').toHaveLength(1)
    expect(source.node).toBe(engine.mediaSources[0]!.node)
  })

  it('reports the element clock when playback starts at zero', async () => {
    /*
     * `attach` starts every streamed track with `play(0)`. The element is
     * already at 0, so no seek happens and no `seeked` event ever fires — and
     * a pending-seek marker recorded there reported 0 as the position for the
     * whole track while the audio played.
     */
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    source.play(0)
    elements[0]!.currentTime = 5
    expect(source.positionMs).toBe(5000)
  })

  it('reports a real seek target until the element lands it', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    elements[0]!.currentTime = 30
    source.play(12_000)
    expect(elements[0]!.currentTime, 'the element was asked to move').toBe(12)
    expect(source.positionMs).toBe(12_000)

    // The element's clock is authoritative once the seek lands.
    elements[0]!.emit('seeked')
    elements[0]!.currentTime = 13
    expect(source.positionMs).toBe(13_000)
  })

  it('does not drop pending seek on stall recovery before seeked fires', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const el = elements[0]!
    el.currentTime = 0
    el.seeking = true
    source.seek!(413_280)
    expect(source.positionMs).toBe(413_280)
    expect(el.currentTime).toBe(413.28)

    // Stall occurs
    el.emit('waiting')
    // Stream recovers before seeked finishes
    el.emit('canplaythrough')
    // positionMs must still hold the seek target
    expect(source.positionMs).toBe(413_280)

    // Now seek lands
    el.seeking = false
    el.emit('seeked')
    el.currentTime = 414
    expect(source.positionMs).toBe(414_000)
  })

  it('supports seek() directly while remaining paused', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const el = elements[0]!
    expect(el.paused).toBe(true)

    source.seek!(60_000)
    expect(el.currentTime).toBe(60)
    expect(el.paused).toBe(true)
    expect(source.positionMs).toBe(60_000)
  })

  it('mute restores the level it replaced', async () => {
    const { audio, engine } = await harness()
    const master = [...(audio.chainInput as unknown as { outputs: Set<unknown> }).outputs][0] as {
      gain: { value: number }
    }
    audio.setVolume(0.4)
    expect(master.gain.value).toBeCloseTo(0.4)

    audio.setMuted(true)
    expect(master.gain.value).toBe(0)

    // A volume change while muted must not un-mute, but must be remembered.
    audio.setVolume(0.7)
    expect(master.gain.value).toBe(0)

    audio.setMuted(false)
    expect(master.gain.value).toBeCloseTo(0.7)
    expect(engine.closed).toBe(false)
  })

  it('clamps volume to the 0..1 the contract promises', async () => {
    const { audio } = await harness()
    const master = [...(audio.chainInput as unknown as { outputs: Set<unknown> }).outputs][0] as {
      gain: { value: number }
    }
    audio.setVolume(5)
    expect(master.gain.value).toBe(1)
    audio.setVolume(-2)
    expect(master.gain.value).toBe(0)
  })

  it('delivers interruption and route events to their listeners', async () => {
    // The shell publishes these; the policy that reacts lives in ctx.player.
    const { audio } = await harness()
    const seen: string[] = []
    const off = audio.onInterruption((e) => void seen.push(`${e.type}:${e.shouldResume}`))
    audio.onRouteChange((e) => void seen.push(e.reason))

    audio.emitInterruption({ type: 'began', shouldResume: false })
    audio.emitRouteChange({ reason: 'device-removed' })
    off()
    audio.emitInterruption({ type: 'ended', shouldResume: true })

    expect(seen).toEqual(['began:false', 'device-removed'])
  })

  it('closes the context and detaches the graph when unloaded', async () => {
    const engine = createFakeAudioContext()
    const ctx = new Context()
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {
      createContext: () => engine as unknown as BaseAudioContext,
      fetchBytes: async () => new ArrayBuffer(8),
    })
    await tick()
    await fiber.dispose()
    await tick()

    expect(engine.closed, 'the audio context must be closed on unload').toBe(true)
    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('stalls', () => {
  it('maps the element\u2019s buffer events onto the contract\u2019s shape', async () => {
    // `waiting` is what a starved element sends; `playing` is the honest
    // recovery, because `canplay` fires while still paused (docs/05 §2).
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    elements[0]!.emit('waiting')
    elements[0]!.emit('playing')

    expect(seen).toEqual([true, false])
  })

  it('publishes a change, not every event', async () => {
    // A slow network sends `waiting` over and over. A player that took each
    // one as a fresh stall would restart its recovery timeout on every one,
    // turning "gives up after 30 seconds" into "never gives up".
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    elements[0]!.emit('waiting')
    elements[0]!.emit('stalled')
    elements[0]!.emit('waiting')

    expect(seen).toEqual([true])
  })

  it('a decoded buffer never stalls, and leaks no listener for saying so', async () => {
    const { audio } = await harness()
    const source = await audio.load('file:///music/a.flac', { strategy: 'buffer' })
    let called = false
    const off = source.onStalled(() => void (called = true))

    off()
    source.play()
    expect(called).toBe(false)
  })

  it('falls back to streamed media element when buffered decodeAudioData fails', async () => {
    const { audio, engine } = await harness()
    engine.decodeAudioData = async () => {
      throw new Error('Unable to decode audio data')
    }
    const source = await audio.load('file:///music/high-res-24bit.flac', { strategy: 'buffer' })
    expect(source).toBeDefined()
    source.play()
    expect(source.positionMs).toBe(0)
  })

  it('a disposed streamed source stops listening', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    source.dispose()
    elements[0]!.emit('waiting')

    expect(seen).toEqual([])
    expect(elements[0]!.countListeners(), 'every handler is removed, not just muted').toBe(0)
  })

  it('clears stall and triggers ended on element error', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/bad.m4a', { strategy: 'stream' })
    const seenStalls: boolean[] = []
    let ended = false
    source.onStalled((stalled) => void seenStalls.push(stalled))
    source.onEnded(() => void (ended = true))

    // Element emits waiting first, then encounters fatal error
    elements[0]!.emit('waiting')
    expect(seenStalls).toEqual([true])

    elements[0]!.error = { code: 4, message: 'Format not supported' }
    elements[0]!.emit('error')

    expect(seenStalls).toEqual([true, false])
    expect(ended).toBe(true)

    // Subsequent stall events should be ignored while in error
    elements[0]!.emit('waiting')
    expect(seenStalls).toEqual([true, false])
  })

  it('a fatal error mid-play reports an underrun, not a natural end', async () => {
    // An element that dies after it has begun sounding is a network failure
    // mid-track. Reporting `ended` made the player skip to the next track —
    // which, on the same broken network, sat silent at 0:00 — instead of
    // letting the stall watchdog retry the same track.
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/stream.mp3', { strategy: 'stream' })
    const seenStalls: boolean[] = []
    let ended = false
    source.onStalled((stalled) => void seenStalls.push(stalled))
    source.onEnded(() => void (ended = true))

    source.play()
    elements[0]!.emit('playing')
    expect(seenStalls, 'the recover event is not a stall').toEqual([])

    elements[0]!.error = { code: 2, message: 'Network error' }
    elements[0]!.emit('error')

    expect(ended, 'the track is not over').toBe(false)
    expect(seenStalls).toEqual([true])
  })

  it('handles play() rejection without throwing unhandled rejection', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/bad.m4a', { strategy: 'stream' })
    let ended = false
    source.onEnded(() => void (ended = true))

    const notSupportedError = new Error('Failed to load because no supported source was found.')
    notSupportedError.name = 'NotSupportedError'
    elements[0]!.play = async () => {
      throw notSupportedError
    }

    source.play()
    await tick()

    expect(ended).toBe(true)
  })
})

describe('context state', () => {
  it('publishes an interruption when a running context is suspended, and ends it on recovery', async () => {
    // The desktop case: the OS (sleep, device loss) suspends the context out
    // from under a playing source. Without this translation the transport
    // keeps saying `playing` over silence, with nothing logged anywhere.
    const { audio, engine } = await harness({ emitContextInterruptions: true })
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))

    engine.setState('suspended')
    engine.setState('running')

    expect(seen).toEqual([
      { type: 'began', shouldResume: false },
      { type: 'ended', shouldResume: false },
    ])
  })

  it('does not call a context born suspended an interruption', async () => {
    // Chromium's autoplay policy creates the context suspended, before any
    // gesture. It was never running, so there is nothing being interrupted —
    // and an event here would pause a player that is about to start.
    const engine = createFakeAudioContext()
    engine.state = 'suspended'
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: () => engine as unknown as BaseAudioContext,
      fetchBytes: async () => new ArrayBuffer(8),
      emitContextInterruptions: true,
    })
    await tick()
    const audio = ctx.audio as AudioWebAudio
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))

    engine.setState('running')

    expect(seen).toEqual([])
  })

  it('stays silent on context state when the shell owns interruptions (mobile)', async () => {
    // On mobile `AudioManager`'s events are the informed source — they carry
    // the OS's `shouldResume`. Raw state transitions would double-publish.
    const { audio, engine } = await harness()
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))

    engine.setState('interrupted')
    engine.setState('running')

    expect(seen).toEqual([])
  })

  it('kicks a suspended context when play is requested on a buffered source', async () => {
    // The recovery half: the user pressing play is the gesture, so the
    // resume happens on the way in rather than leaving a play that sounds.
    const { audio, engine } = await harness()
    engine.setState('suspended')
    const source = await audio.load('file:///music/a.flac', { strategy: 'buffer' })

    source.play()

    expect(engine.state).toBe('running')
  })

  it('does the same for a streamed source', async () => {
    const { audio, engine } = await harness()
    engine.setState('interrupted')
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    source.play(0)

    expect(engine.state).toBe('running')
  })

  it('unbinds its statechange listener when unloaded', async () => {
    const engine = createFakeAudioContext()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      createContext: () => engine as unknown as BaseAudioContext,
      fetchBytes: async () => new ArrayBuffer(8),
    })
    await tick()
    expect(engine.countStateListeners()).toBe(1)

    await fiber.dispose()
    await tick()

    expect(engine.countStateListeners(), 'no listener outlives the service').toBe(0)
  })
})

describe('the audio gate', () => {
  it('refuses a plugin that was not granted `audio`', async () => {
    // The flag capability means "may contribute nodes to the audio graph".
    // Without a check it was a manifest string with no meaning.
    const { ctx } = await harness()
    const ungranted = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['db:own'] as never,
    })
    await expect(ungranted.audio.load('file:///x.flac', { strategy: 'buffer' })).rejects.toThrow(
      CapabilityError,
    )
    expect(() => ungranted.audio.setVolume(0.5)).toThrow(/was not granted audio/)

    const granted = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-player',
      requested: ['audio'] as never,
    })
    await expect(
      granted.audio.load('file:///x.flac', { strategy: 'buffer' }),
    ).resolves.toBeDefined()
    expect(() => granted.audio.setVolume(0.5)).not.toThrow()
  })
})

describe('output devices and routing', () => {
  it('enumerates devices using Chromium deviceIds and marks virtual cards', async () => {
    const { audio } = await harness()
    const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window')

    const mockEnumerate = async () => [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 扬声器 (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'dev-realtek-123', label: '扬声器 (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'dev-vm-456', label: 'VoiceMeeter Input' },
      { kind: 'audioinput', deviceId: 'mic-1', label: '麦克风' },
    ]

    const mockBridgeCall = async (service: string, method: string) => {
      if (service === 'audio' && method === 'getOutputDevices') {
        return [
          { id: '{0.0.0.00000000}.{realtek-guid}', label: '扬声器 (Realtek Audio)', isDefault: true, isVirtual: false },
          { id: '{0.0.0.00000000}.{vm-guid}', label: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', isDefault: false, isVirtual: true },
        ]
      }
      return undefined
    }

    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { mediaDevices: { enumerateDevices: mockEnumerate } },
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: { BBeBeeBridge: { call: mockBridgeCall } },
        configurable: true,
        writable: true,
      })

      const devices = await audio.listOutputDevices()
      expect(devices).toHaveLength(3)

      // Ensure every device id is strictly a Chromium deviceId
      expect(devices[0]!.id).toBe('default')
      expect(devices[0]!.label).toBe('扬声器 (Realtek Audio)')
      expect(devices[0]!.isVirtual).toBe(false)

      expect(devices[1]!.id).toBe('dev-realtek-123')
      expect(devices[1]!.label).toBe('扬声器 (Realtek Audio)')
      expect(devices[1]!.isVirtual).toBe(false)

      expect(devices[2]!.id).toBe('dev-vm-456')
      expect(devices[2]!.label).toContain('VoiceMeeter Input')
      expect(devices[2]!.label).toContain('(虚拟)')
      expect(devices[2]!.isVirtual).toBe(true)

      // Ensure native OS IDs are NEVER injected
      expect(devices.some((d) => d.id.includes('{'))).toBe(false)
    } finally {
      if (origNavDesc) {
        Object.defineProperty(globalThis, 'navigator', origNavDesc)
      } else {
        delete (globalThis as Record<string, unknown>)['navigator']
      }
      if (origWindowDesc) {
        Object.defineProperty(globalThis, 'window', origWindowDesc)
      } else {
        delete (globalThis as Record<string, unknown>)['window']
      }
    }
  })

  it('sanitizes OS IDs in setOutputDevice so setSinkId is never passed a raw OS ID', async () => {
    const { audio, engine } = await harness()
    let sinkCalledWith: string | undefined
    ;(engine as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId = async (id: string) => {
      sinkCalledWith = id
    }

    // Pass an OS ID (e.g. Windows MMDevice ID or PnP InstanceId)
    await audio.setOutputDevice('{0.0.0.00000000}.{test-guid}')
    // Must be sanitized to '' so Chromium setSinkId does not reject
    expect(sinkCalledWith).toBe('')

    // Pass valid deviceId
    await audio.setOutputDevice('valid-device-id')
    expect(sinkCalledWith).toBe('valid-device-id')

    // Pass 'default'
    await audio.setOutputDevice('default')
    expect(sinkCalledWith).toBe('')
  })
})

describe('sample-rate matching', () => {
  it('rebuilds the context to a decoded buffer’s rate when the realm does not resample', async () => {
    // decodeAudioData resamples to the context rate in Chromium, so this
    // branch is dead there; realms that do not resample get the context moved
    // to the buffer's rate instead of in-graph resampling on playback.
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      fetchBytes: async () => new ArrayBuffer(8),
    })
    const audio = ctx.audio as AudioWebAudio
    ;(contexts[0] as unknown as { decodeAudioData: () => Promise<unknown> }).decodeAudioData =
      async () => ({
        duration: 2,
        sampleRate: 96_000,
        numberOfChannels: 2,
        getChannelData: () => new Float32Array(),
      })

    const source = await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect((audio.context as unknown as FakeAudioContext).sampleRate).toBe(96_000)
    expect(contexts).toHaveLength(2)
    expect(source.durationMs).toBe(2_000)
    source.dispose()
  })
})

describe('native output-device resolution', () => {
  it('resolves Chromium deviceIds to native devices for the bridge, never for setSinkId', async () => {
    let bridgeDeviceSet: string | undefined
    let sinkCalledWith: string | undefined
    const { audio, engine } = await harness({
      bridgeCall: async (service, method, args) => {
        if (service === 'audio' && method === 'getOutputDevices') {
          return [
            { id: '{0.0.0.00000000}.{realtek}', label: '扬声器 (Realtek Audio)', isDefault: true, isVirtual: false },
            { id: '{0.0.0.00000000}.{vm}', label: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', isDefault: false, isVirtual: true },
          ]
        }
        if (service === 'audio' && method === 'setOutputDevice') {
          bridgeDeviceSet = args[0] as string
          return undefined
        }
        return undefined
      },
    })
    ;(engine as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId = async (id: string) => {
      sinkCalledWith = id
    }

    const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const mockEnumerate = async () => [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 扬声器 (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'dev-vm-456', label: 'VoiceMeeter Input' },
    ]

    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { mediaDevices: { enumerateDevices: mockEnumerate } },
        configurable: true,
        writable: true,
      })

      // VoiceMeeter by Chromium deviceId: the bridge gets the matched native
      // IMMDevice id, setSinkId gets exactly the id Chromium handed out.
      await audio.setOutputDevice('dev-vm-456')
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{vm}')
      expect(sinkCalledWith).toBe('dev-vm-456')
      expect(audio.currentDeviceLabel).toContain('VoiceMeeter')

      await audio.setOutputDevice('default')
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{realtek}')
      expect(sinkCalledWith).toBe('')
      expect(audio.currentDeviceLabel).toBe('扬声器 (Realtek Audio)')
    } finally {
      if (origNavDesc) {
        Object.defineProperty(globalThis, 'navigator', origNavDesc)
      } else {
        delete (globalThis as Record<string, unknown>)['navigator']
      }
    }
  })
})

describe(audioConformance.service, () => {
  for (const check of audioConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { audio, engine } = await harness()
      await check.run({
        audio,
        sampleSrc: 'file:///fixtures/two-seconds.flac',
        advance: (ms) => engine.advance(ms),
      })
    })
  }
})
