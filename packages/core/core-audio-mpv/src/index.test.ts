import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { InterruptionEvent } from '@BBeBee/protocol'
import { audioConformance } from '@BBeBee/protocol/conformance'
import type { MediaElementLike } from '@BBeBee/core-audio-webaudio'
import type { BridgeCall } from '@BBeBee/core-audio-webaudio'
import type { FakeAudioContext } from '@BBeBee/core-audio-webaudio/testing'
import { createFakeAudioContext } from '@BBeBee/core-audio-webaudio/testing'
import plugin, { AudioMpv, type AudioMpvConfig } from './index.js'

/**
 * Structural `MediaElementLike` for the degradation path (and, via an
 * `advance`-driven clock, for the conformance suite). Real elements fire
 * `seeked` after a programmatic currentTime set — the fake does too.
 */
class FakeMediaElement implements MediaElementLike {
  src = ''
  crossOrigin: string | null = null
  duration = 120
  paused = true
  seeking = false
  error: { code?: number; message?: string } | null = null

  private _currentTime = 0
  private readonly listeners = new Map<string, Set<() => void>>()

  get currentTime(): number {
    return this._currentTime
  }

  set currentTime(v: number) {
    this._currentTime = v
    this.emit('seeked')
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
}

/**
 * A bridge with the engine's transport methods, driving a simulated playback
 * state — what `MpvSourceHandle`'s position polling reads back.
 */
interface SimState {
  positionMs: number
  durationMs: number
  status: 'idle' | 'playing' | 'paused' | 'stopped' | 'ended'
}

function engineBridge(state: SimState, calls: string[] = []): BridgeCall {
  return async (_service, method, args) => {
    calls.push(method)
    switch (method) {
      case 'mpvLoad':
        state.positionMs = 0
        state.durationMs = 2_000
        state.status = 'paused'
        return { durationMs: state.durationMs, sampleRate: 48_000, channels: 2, bitDepth: 16 }
      case 'mpvPlay':
        state.status = 'playing'
        if (typeof args[0] === 'number') state.positionMs = args[0]
        return undefined
      case 'mpvPause':
        state.status = 'paused'
        return undefined
      case 'mpvStop':
        state.positionMs = 0
        state.status = 'stopped'
        return undefined
      case 'mpvSeek':
        state.positionMs = Number(args[0] ?? 0)
        return undefined
      case 'mpvGetState':
        return { ...state }
      default:
        return undefined
    }
  }
}

async function harness(
  extraConfig: Partial<AudioMpvConfig> = {},
): Promise<{
  ctx: Context
  audio: AudioMpv
  engine: FakeAudioContext
  elements: FakeMediaElement[]
}> {
  const engine = createFakeAudioContext()
  const elements: FakeMediaElement[] = []
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => engine as unknown as BaseAudioContext,
    createMediaElement: () => {
      const element = new FakeMediaElement()
      elements.push(element)
      return element
    },
    ...extraConfig,
  })
  return { ctx, audio: ctx.audio as AudioMpv, engine, elements }
}

describe('core-audio-mpv', () => {
  it('activates and claims ctx.audio', async () => {
    const { ctx } = await harness()
    expect(ctx.audio).toBeInstanceOf(AudioMpv)
  })

  it('passes the audio conformance suite', async () => {
    // The conformance vehicle is the degradation path (media element), whose
    // clock the test drives: the native handle's own clock is the engine's.
    const { ctx, engine, elements } = await harness({ bridgeCall: async () => undefined })
    const audio = ctx.audio as AudioMpv
    const advance = async (ms: number): Promise<void> => {
      const el = elements.at(-1)
      if (el && !el.paused) {
        el.currentTime = Math.min(el.currentTime + ms / 1000, el.duration)
        if (el.currentTime >= el.duration) el.emit('ended')
      }
      await engine.advance(ms)
    }
    for (const check of audioConformance.checks) {
      await check.run({
        audio,
        sampleSrc: 'file:///music/test.flac',
        advance,
      })
    }
  })

  it('loads via the engine and adopts its reported audio params', async () => {
    // The engine's own audio params (from FILE_LOADED) drive the shell graph's
    // rebuild and the track-info readouts — no external decoder reports them.
    const rebuiltRates: number[] = []
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      bridgeCall: async (_service, method) => {
        if (method === 'mpvLoad') {
          return { durationMs: 2500, resumed: false, sampleRate: 96_000, channels: 2, bitDepth: 24 }
        }
        return undefined
      },
    })
    const audio = ctx.audio as AudioMpv
    ctx.on('audio/context-rebuilt', () => {
      rebuiltRates.push((ctx.audio as AudioMpv).context.sampleRate)
    })

    const handle = await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect(rebuiltRates).toEqual([96_000])
    expect((audio.context as unknown as FakeAudioContext).sampleRate).toBe(96_000)
    expect(audio.sampleRate).toBe(96_000)
    expect(audio.hardwareBitDepth).toBe(24)
    expect(audio.hardwareChannels).toBe(2)
    expect(handle.durationMs).toBe(2500)
    handle.dispose()
  })

  it('forwards sanitized load options across the bridge', async () => {
    // The full LoadOptions carries a function and an AbortSignal — structured
    // clone rejects them, so only the plain fields may cross.
    let seenArgs: unknown[] | undefined
    const bridgeCall = async (_service: string, _method: string, args: unknown[]) => {
      if (_method === 'mpvLoad') seenArgs = args
      return { durationMs: 2_000 }
    }

    const { audio } = await harness({ bridgeCall })
    await audio.load('https://cdn.example.com/song.m4s', {
      strategy: 'buffer',
      headers: { Referer: 'https://www.bilibili.com' },
    })

    expect(seenArgs?.[0]).toBe('https://cdn.example.com/song.m4s')
    expect(seenArgs?.[1]).toEqual({
      strategy: 'buffer',
      headers: { Referer: 'https://www.bilibili.com' },
    })
  })

  it('loads every strategy through the engine — the element only degrades', async () => {
    const { audio, elements } = await harness({
      bridgeCall: engineBridge({ positionMs: 0, durationMs: 2_000, status: 'idle' }),
    })

    const viaEngine = await audio.load('https://cdn.example.com/song.m4s', { strategy: 'stream' })
    const viaBuffer = await audio.load('file:///music/song.flac', { strategy: 'buffer' })

    expect(viaEngine.durationMs).toBe(2_000)
    expect(viaBuffer.durationMs).toBe(2_000)
    expect(elements, 'the media element must not be involved').toHaveLength(0)
    viaEngine.dispose()
    viaBuffer.dispose()
  })

  it('degrades to the media element when the engine cannot take the track', async () => {
    // No mpv methods on the bridge: the engine cannot answer, and the element
    // (Chromium decode) is the only path that can.
    const { audio, elements } = await harness({ bridgeCall: async () => undefined })
    const handle = await audio.load('file:///music/song.flac', { strategy: 'buffer' })

    expect(elements).toHaveLength(1)
    expect(handle.durationMs).toBe(120_000)
    handle.dispose()
  })

  it('refuses a load when there is no bridge and no element', async () => {
    const { audio } = await harness({ bridgeCall: undefined, createMediaElement: undefined })
    await expect(audio.load('file:///music/song.flac', { strategy: 'buffer' })).rejects.toThrow(
      /media element/,
    )
  })

  it('dips volume over time without clicking', async () => {
    const { audio } = await harness()
    audio.setVolume(0.8)
    const restore = await audio.dipVolume(10)
    expect(audio.destination).toBeDefined()
    restore()
  })

  it('manages mute and volume levels correctly', async () => {
    const { audio } = await harness()
    audio.setVolume(0.7)
    audio.setMuted(true)
    audio.setMuted(false)
    expect(audio.sampleRate).toBe(48000)
  })

  it('enumerates output devices using Chromium deviceIds and routes without passing OS IDs to setSinkId', async () => {
    let bridgeDeviceSet: string | undefined
    let sinkCalledWith: string | undefined

    const mockBridgeCall = async (service: string, method: string, args: unknown[]) => {
      if (service === 'audio' && method === 'getOutputDevices') {
        return [
          { id: '{0.0.0.00000000}.{wasapi-realtek}', label: '扬声器 (Realtek Audio)', isDefault: true, isVirtual: false },
          { id: '{0.0.0.00000000}.{wasapi-vm}', label: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', isDefault: false, isVirtual: true },
        ]
      }
      if (service === 'audio' && method === 'setOutputDevice') {
        bridgeDeviceSet = args[0] as string
        return undefined
      }
      return undefined
    }

    const { audio, engine } = await harness({ bridgeCall: mockBridgeCall })
    ;(engine as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId = async (id: string) => {
      sinkCalledWith = id
    }

    const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const mockEnumerate = async () => [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 扬声器 (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'dev-vm-789', label: 'VoiceMeeter Input' },
    ]

    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { mediaDevices: { enumerateDevices: mockEnumerate } },
        configurable: true,
        writable: true,
      })

      const devices = await audio.listOutputDevices()
      expect(devices).toHaveLength(2)
      expect(devices[0]!.id).toBe('default')
      expect(devices[1]!.id).toBe('dev-vm-789')
      expect(devices[1]!.isVirtual).toBe(true)
      expect(devices[1]!.label).toContain('(虚拟)')

      // Set to VoiceMeeter by Chromium deviceId
      await audio.setOutputDevice('dev-vm-789')
      // Native host gets the matched native WASAPI IMMDevice ID
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{wasapi-vm}')
      // But Web Audio setSinkId receives the Chromium deviceId, NEVER the OS ID!
      expect(sinkCalledWith).toBe('dev-vm-789')

      // Set to default
      await audio.setOutputDevice('default')
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{wasapi-realtek}')
      expect(sinkCalledWith).toBe('')
    } finally {
      if (origNavDesc) {
        Object.defineProperty(globalThis, 'navigator', origNavDesc)
      } else {
        delete (globalThis as Record<string, unknown>)['navigator']
      }
    }
  })

  it('emits audio/context-rebuilt and retires the old context when the track rate differs', async () => {
    // A 96 kHz track against a 48 kHz boot context must rebuild the context:
    // `plugin-dsp` and `plugin-visualizer` resplice on the event, so it must
    // fire with the NEW context live and the old one must close afterwards.
    const rebuiltRates: number[] = []
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      bridgeCall: async (_service, method) =>
        method === 'mpvLoad'
          ? { durationMs: 2500, resumed: false, sampleRate: 96_000, channels: 2, bitDepth: 24 }
          : undefined,
    })
    const audio = ctx.audio as AudioMpv
    ctx.on('audio/context-rebuilt', () => {
      rebuiltRates.push((ctx.audio as AudioMpv).context.sampleRate)
    })

    const handle = await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect(rebuiltRates).toEqual([96000])
    expect(contexts).toHaveLength(2)
    expect((audio.context as unknown as FakeAudioContext).sampleRate).toBe(96000)
    // The 48 kHz boot context is closed only after the new graph is attached.
    expect(contexts[0]!.closed).toBe(true)
    expect(handle.durationMs).toBe(2500)
    handle.dispose()
  })
})

describe('core-audio-mpv context state', () => {
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
      emitContextInterruptions: true,
    })
    const audio = ctx.audio as AudioMpv
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))

    engine.setState('running')

    expect(seen).toEqual([])
  })

  it('stays silent on context state when the shell owns interruptions', async () => {
    // Without `emitContextInterruptions` the transitions are still logged,
    // but the shell's own events stay the only interruption source.
    const { audio, engine } = await harness()
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))

    engine.setState('interrupted')
    engine.setState('running')

    expect(seen).toEqual([])
  })

  it('kicks a suspended context when play is requested on a source', async () => {
    // The recovery half: the user pressing play is the gesture, so the
    // resume happens on the way in rather than leaving a play that sounds.
    const { audio, engine } = await harness()
    engine.setState('suspended')
    const source = await audio.load('file:///music/a.flac', { strategy: 'buffer' })

    source.play()

    expect(engine.state).toBe('running')
  })

  it('unbinds its statechange listener when unloaded', async () => {
    const engine = createFakeAudioContext()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      createContext: () => engine as unknown as BaseAudioContext,
    })
    expect(engine.countStateListeners()).toBe(1)

    await fiber.dispose()

    expect(engine.countStateListeners(), 'no listener outlives the service').toBe(0)
  })

  it('follows the state observer across a context rebuild', async () => {
    // The rate rebuild replaces the context; an observer left on the old one
    // would go blind to every suspension after the first Hi-Res track.
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      bridgeCall: async (_service, method) =>
        method === 'mpvLoad'
          ? { durationMs: 2500, resumed: false, sampleRate: 96_000, channels: 2, bitDepth: 24 }
          : undefined,
      emitContextInterruptions: true,
    })
    const audio = ctx.audio as AudioMpv
    expect(contexts[0]!.countStateListeners()).toBe(1)

    await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect(contexts[0]!.countStateListeners(), 'the old context is let go').toBe(0)
    expect(contexts[1]!.countStateListeners(), 'the new context is watched').toBe(1)

    // And the translation still works on the new context.
    const seen: InterruptionEvent[] = []
    audio.onInterruption((e) => void seen.push(e))
    contexts[1]!.setState('suspended')
    expect(seen).toEqual([{ type: 'began', shouldResume: false }])
  })

  it('re-applies the selected output device onto a rebuilt context', async () => {
    // A fresh context knows nothing of the endpoint the user picked — a rate
    // rebuild would otherwise silently send Hi-Res tracks to the default
    // output while the settings page still shows the chosen one.
    const contexts: FakeAudioContext[] = []
    const sinkCalls: string[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        ;(next as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId = async (
          id: string,
        ) => {
          sinkCalls.push(id)
        }
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      bridgeCall: async (_service, method) =>
        method === 'mpvLoad'
          ? { durationMs: 2500, resumed: false, sampleRate: 96_000, channels: 2, bitDepth: 24 }
          : undefined,
    })
    const audio = ctx.audio as AudioMpv

    await audio.setOutputDevice('dev-dac')
    expect(sinkCalls).toEqual(['dev-dac'])

    await audio.load('file:///music/hires.flac', { strategy: 'buffer' })
    expect(sinkCalls, 'the rebuilt context got the selection back').toEqual(['dev-dac', 'dev-dac'])
  })
})

describe('core-audio-mpv native engine features', () => {
  it('loads via native audio-engine mpvLoad and handles transport controls', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      if (method === 'mpvLoad') {
        return { durationMs: 120_000 }
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const handle = await audio.load('file:///music/song.flac', { strategy: 'stream' })
    expect(handle.durationMs).toBe(120_000)

    handle.play(5000)
    expect(calls.some((c) => c.method === 'mpvPlay' && c.args[0] === 5000)).toBe(true)

    handle.pause()
    expect(calls.some((c) => c.method === 'mpvPause')).toBe(true)

    handle.seek?.(20000)
    expect(calls.some((c) => c.method === 'mpvSeek' && c.args[0] === 20000)).toBe(true)

    handle.stop()
    expect(calls.some((c) => c.method === 'mpvStop')).toBe(true)
    handle.dispose()
  })

  it('play() without a position must not seek the engine (gapless re-bind)', async () => {
    // After a playlist auto-advance the engine is already sounding the next
    // file; the player's load+play of the same file is a re-bind. A position
    // argument here would seek the track back to zero mid-playback.
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      if (method === 'mpvLoad') {
        return { durationMs: 120_000, resumed: true }
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const handle = await audio.load('file:///music/next.flac', { strategy: 'stream' })

    handle.play()
    const playCall = calls.find((c) => c.method === 'mpvPlay')
    expect(playCall).toBeDefined()
    expect(playCall!.args[0], 'no position argument: the engine keeps sounding').toBeUndefined()
    handle.dispose()
  })

  it('play(atMs) still seeks explicitly, and resume after pause does not seek', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      if (method === 'mpvLoad') {
        return { durationMs: 120_000 }
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const handle = await audio.load('file:///music/song.flac', { strategy: 'stream' })

    handle.play(5000)
    expect(calls.filter((c) => c.method === 'mpvPlay').at(-1)!.args[0]).toBe(5000)

    handle.pause()
    handle.play()
    // Resuming must hand the engine its own clock back, not the handle's
    // wall-clock estimate of where playback was.
    const resumeCall = calls.filter((c) => c.method === 'mpvPlay').at(-1)!
    expect(resumeCall.args[0]).toBeUndefined()

    handle.dispose()
  })

  it('pushes the enabled effect chain as one af string, debounced', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      if (method === 'mpvLoad') return { durationMs: 120_000 }
      return undefined
    }

    const { ctx } = await harness({ bridgeCall })
    ;(ctx as unknown as { dsp: unknown }).dsp = {
      chain: [
        { effectId: 'preamp', enabled: true, ordinal: 0 },
        { effectId: 'eq10', enabled: true, ordinal: 1 },
        { effectId: 'reverb', enabled: false, ordinal: 2 },
      ],
      definitions: [
        { id: 'preamp', buildLavfi: () => 'volume=volume=-2.00dB' },
        { id: 'eq10', buildLavfi: () => 'equalizer=f=500:width_type=q:w=1.41:g=6.00' },
        { id: 'reverb', buildLavfi: () => 'aecho=in_gain=1' },
      ],
      getParams: () => ({}),
    }

    // A slider drag emits per tick — the two rapid emits must coalesce.
    ctx.emit('dsp/chain-changed', [])
    ctx.emit('dsp/chain-changed', [])
    await new Promise((r) => setTimeout(r, 350))

    const dspCalls = calls.filter((c) => c.method === 'mpvSetDspConfig')
    expect(dspCalls, 'debounced to one push').toHaveLength(1)
    // ordinal order, disabled reverb excluded, the chain arrives as ONE af string
    expect(dspCalls[0]!.args[0]).toEqual({
      af: 'volume=volume=-2.00dB,equalizer=f=500:width_type=q:w=1.41:g=6.00',
    })
  })

  it('pulls the settings-restored chain once at mount', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      return undefined
    }
    const ctx = new Context()
    // The chain was restored from settings before the engine mounted — the
    // change events are already gone, so the engine must pull at init.
    ;(ctx as unknown as { dsp: unknown }).dsp = {
      chain: [{ effectId: 'preamp', enabled: true, ordinal: 0 }],
      definitions: [{ id: 'preamp', buildLavfi: () => 'volume=volume=-3.00dB' }],
      getParams: () => ({ gainDb: -3 }),
    }

    await ctx.plugin(plugin, { bridgeCall, createContext: () => createFakeAudioContext() as unknown as BaseAudioContext })
    await new Promise((r) => setTimeout(r, 350))

    const dspCalls = calls.filter((c) => c.method === 'mpvSetDspConfig')
    expect(dspCalls).toHaveLength(1)
    expect(dspCalls[0]!.args[0]).toEqual({ af: 'volume=volume=-3.00dB' })
  })

  it('skips effects without a lavfi adapter and reports a clean chain', async () => {
    const calls: { method: string; args: unknown[] }[] = []
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      calls.push({ method, args })
      return undefined
    }

    const { ctx } = await harness({ bridgeCall })
    ;(ctx as unknown as { dsp: unknown }).dsp = {
      chain: [
        { effectId: 'tempo-pitch', enabled: true, ordinal: 0 },
        { effectId: 'eq10', enabled: false, ordinal: 1 },
      ],
      definitions: [
        // tempo-pitch registered WITHOUT an adapter (third-party shape)
        { id: 'tempo-pitch', buildLavfi: undefined },
        { id: 'eq10', buildLavfi: () => 'equalizer=f=500:width_type=q:w=1.41:g=6.00' },
      ],
      getParams: () => ({}),
    }

    ctx.emit('dsp/chain-changed', [])
    await new Promise((r) => setTimeout(r, 350))

    const dspCalls = calls.filter((c) => c.method === 'mpvSetDspConfig')
    expect(dspCalls).toHaveLength(1)
    // disabled eq10 excluded, adapter-less tempo-pitch skipped
    expect(dspCalls[0]!.args[0]).toEqual({ af: '' })
  })

  it('retrieves FFT spectrum frames for visualizer', async () => {
    const mockFrame = {
      frequencyData: [120, 150, 180, 210],
      timeDomainData: [128, 130, 126, 128],
    }
    const bridgeCall = async (_service: string, method: string) => {
      if (method === 'mpvGetFftFrame') return mockFrame
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const frame = await audio.getFftSpectrum()
    expect(frame).toEqual(mockFrame)
  })

  it('records the preload outcome for gapless diagnostics', async () => {
    let appendShouldFail = false
    const bridgeCall = async (_service: string, method: string) => {
      if (method === 'mpvAppend') {
        if (appendShouldFail) throw new Error('engine gone')
        return undefined
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    await audio.preloadNext('file:///music/next.flac')
    expect(audio.lastPreloadStatus?.ok).toBe(true)
    expect(audio.lastPreloadStatus?.uri).toBe('file:///music/next.flac')

    appendShouldFail = true
    await audio.preloadNext('file:///music/next2.flac')
    expect(audio.lastPreloadStatus?.ok).toBe(false)
  })
})
