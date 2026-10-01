import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { InterruptionEvent } from '@BBeBee/protocol'
import { audioConformance } from '@BBeBee/protocol/conformance'
import type { MediaElementLike } from '@BBeBee/core-audio-webaudio'
import type { BridgeCall } from '@BBeBee/core-audio-webaudio'
import type { FakeAudioContext } from '@BBeBee/core-audio-webaudio/testing'
import { createFakeAudioContext } from '@BBeBee/core-audio-webaudio/testing'
import plugin, { AudioMpv, type AudioMpvConfig } from './index.js'

/** Structural `MediaElementLike` for the degradation-path tests. */
class FakeMediaElement implements MediaElementLike {
  src = ''
  crossOrigin: string | null = null
  currentTime = 0
  duration = 120
  paused = true
  seeking = false
  error: { code?: number; message?: string } | null = null

  private readonly listeners = new Map<string, Set<() => void>>()

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

/** Two seconds of stereo at 48 kHz — what a well-behaved bridge returns. */
function twoSecondPcm(): Float32Array[] {
  return [new Float32Array(96_000), new Float32Array(96_000)]
}

/** A bridge that can take anything: probe says finite, decodePcm delivers PCM. */
function workingBridge(calls: string[] = []): BridgeCall {
  return async (_service, method) => {
    calls.push(method)
    if (method === 'probe') {
      return { sampleRate: 48_000, channels: 2, bitDepth: 16, durationMs: 120_000 }
    }
    if (method === 'decodePcm') {
      return { sampleRate: 48_000, channels: 2, bitDepth: 16, durationMs: 2_000, pcm: twoSecondPcm() }
    }
    return undefined
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
    bridgeCall: workingBridge(),
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
    const { audio, engine } = await harness()
    for (const check of audioConformance.checks) {
      await check.run({
        audio,
        sampleSrc: 'file:///music/test.alac',
        advance: (ms) => engine.advance(ms),
      })
    }
  })

  it('decodes ALAC audio via FFmpeg bridge and plays', async () => {
    const fakePcmLeft = new Float32Array([0, 0.1, 0.2, 0.3, 0.4])
    const fakePcmRight = new Float32Array([0, 0.1, 0.2, 0.3, 0.4])
    const bridgeCall = async (service: string, method: string, _args: unknown[]) => {
      if (service === 'audio' && method === 'probe') {
        return { sampleRate: 96_000, channels: 2, bitDepth: 24, durationMs: 120_000 }
      }
      if (service === 'audio' && method === 'decodePcm') {
        return {
          sampleRate: 96_000,
          channels: 2,
          bitDepth: 24,
          durationMs: 2500,
          pcm: [fakePcmLeft, fakePcmRight],
        }
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const handle = await audio.load('file:///music/song.m4a', { strategy: 'buffer' })

    expect(handle).toBeDefined()
    expect(handle.durationMs).toBeGreaterThan(0)

    handle.node.connect(audio.chainInput)
    handle.play()
    expect(handle.positionMs).toBe(0)
    handle.dispose()
  })

  it('forwards source headers to the bridge probe and decodePcm calls', async () => {
    const fakePcm = new Float32Array([0, 0.1, 0.2])
    let probeArgs: unknown[] | undefined
    let seenArgs: unknown[] | undefined
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      if (method === 'probe') {
        probeArgs = args
        return { sampleRate: 48_000, channels: 1, bitDepth: 16, durationMs: 120_000 }
      }
      if (method === 'decodePcm') {
        seenArgs = args
        return { sampleRate: 48_000, channels: 1, bitDepth: 16, durationMs: 100, pcm: [fakePcm] }
      }
      return undefined
    }

    const { audio } = await harness({ bridgeCall })
    const headers = { Referer: 'https://www.bilibili.com', 'User-Agent': 'BBeBee/1.0' }
    await audio.load('https://cdn.example.com/song.m4s', { strategy: 'buffer', headers })

    // The remote URL rides with the source's headers: a CDN that checks
    // `Referer` answers a header-less ffmpeg request with 403.
    expect(probeArgs?.[0]).toBe('https://cdn.example.com/song.m4s')
    expect(probeArgs?.[1]).toEqual({ headers })
    expect(seenArgs?.[0]).toBe('https://cdn.example.com/song.m4s')
    expect(seenArgs?.[1]).toEqual({ headers })
  })

  it('routes every strategy through the bridge — the element path is degradation only', async () => {
    // The engine's whole point: nothing is decoded by Chromium, including the
    // tracks the player asks to stream. The bridge decodes the whole track;
    // memory is the engine's problem, silence on Hi-Res is not.
    const calls: string[] = []
    const { audio, engine, elements } = await harness({ bridgeCall: workingBridge(calls) })
    const handle = await audio.load('https://cdn.example.com/song.m4s', { strategy: 'stream' })

    expect(calls).toContain('decodePcm')
    expect(elements, 'the media element must not be involved').toHaveLength(0)
    expect(handle.durationMs).toBe(2_000)

    handle.play()
    await engine.advance(100)
    expect(handle.positionMs).toBe(100)
    handle.dispose()
  })

  it('degrades to the media element when the bridge cannot decode the track', async () => {
    const bridgeCall = async (_service: string, method: string) => {
      if (method === 'probe') {
        return { sampleRate: 48_000, channels: 2, bitDepth: 16, durationMs: 120_000 }
      }
      if (method === 'decodePcm') {
        throw new Error('ffmpeg exited 1')
      }
      return undefined
    }

    const { audio, elements } = await harness({ bridgeCall })
    const handle = await audio.load('file:///music/song.flac', { strategy: 'buffer' })

    // The element — not `decodeAudioData`, which is the Chromium decoder this
    // engine exists to bypass — is the only degradation there is.
    expect(elements).toHaveLength(1)
    expect(handle.durationMs).toBe(120_000)
    handle.dispose()
  })

  it('never decodes a track with unknown length (a live stream) into PCM', async () => {
    const calls: string[] = []
    const bridgeCall = async (_service: string, method: string) => {
      calls.push(method)
      if (method === 'probe') {
        // No `Duration:` line — ffmpeg cannot bound the decode.
        return { sampleRate: 44_100, channels: 2, bitDepth: 16, durationMs: 0 }
      }
      return undefined
    }

    const { audio, elements } = await harness({ bridgeCall })
    const handle = await audio.load('https://radio.example.org/live', { strategy: 'stream' })

    expect(calls, 'a whole-track decode of a live stream never finishes').not.toContain('decodePcm')
    expect(elements).toHaveLength(1)
    handle.dispose()
  })

  it('degrades instead of decoding tracks beyond the decode budget into resident PCM', async () => {
    const calls: string[] = []
    const bridgeCall = async (_service: string, method: string) => {
      calls.push(method)
      if (method === 'probe') {
        return { sampleRate: 48_000, channels: 2, bitDepth: 16, durationMs: 3 * 60_000 }
      }
      return undefined
    }

    // PCM is roughly ten times the file: a three-hour audiobook is an OOM.
    const { audio, elements } = await harness({
      bridgeCall: bridgeCall,
      maxDecodeDurationMs: 60_000,
    })
    const handle = await audio.load('file:///music/audiobook.m4b', { strategy: 'buffer' })

    expect(calls).not.toContain('decodePcm')
    expect(elements).toHaveLength(1)
    handle.dispose()
  })

  it('refuses a load when there is no bridge and no element, rather than use Chromium’s decoder', async () => {
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
        method === 'probe'
          ? { sampleRate: 48_000, channels: 2, bitDepth: 24, durationMs: 120_000 }
          : method === 'decodePcm'
            ? {
                sampleRate: 96_000,
                channels: 2,
                bitDepth: 24,
                durationMs: 2500,
                pcm: [new Float32Array(480), new Float32Array(480)],
              }
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

  it('reports the decoded source’s hardware specs for the track info modal', async () => {
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      bridgeCall: async (_service, method) => {
        if (method === 'probe') {
          return { sampleRate: 48_000, channels: 2, bitDepth: 16, durationMs: 120_000 }
        }
        if (method === 'decodePcm') {
          return { sampleRate: 96_000, channels: 2, bitDepth: 24, durationMs: 2_500, pcm: twoSecondPcm() }
        }
        return undefined
      },
    })
    const audio = ctx.audio as AudioMpv
    await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect(audio.sampleRate).toBe(96_000)
    expect(audio.hardwareBitDepth).toBe(24)
    expect(audio.hardwareChannels).toBe(2)
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
      bridgeCall: workingBridge(),
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

  it('kicks a suspended context when play is requested on a decoded source', async () => {
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
      bridgeCall: workingBridge(),
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
        method === 'probe'
          ? { sampleRate: 48_000, channels: 2, bitDepth: 24, durationMs: 120_000 }
          : method === 'decodePcm'
            ? {
                sampleRate: 96_000,
                channels: 2,
                bitDepth: 24,
                durationMs: 2500,
                pcm: [new Float32Array(480), new Float32Array(480)],
              }
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
        method === 'probe'
          ? { sampleRate: 48_000, channels: 2, bitDepth: 24, durationMs: 120_000 }
          : method === 'decodePcm'
            ? {
                sampleRate: 96_000,
                channels: 2,
                bitDepth: 24,
                durationMs: 2500,
                pcm: [new Float32Array(480), new Float32Array(480)],
              }
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

  it('synchronizes native DSP/EQ parameters on dsp/chain-changed', async () => {
    let capturedDspConfig: unknown = null
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      if (method === 'mpvSetDspConfig') {
        capturedDspConfig = args[0]
      }
      return undefined
    }

    const { ctx } = await harness({ bridgeCall })
    ;(ctx as unknown as { dsp: unknown }).dsp = {
      getParams: (id: string) => {
        if (id === 'eq10') return { gains: [3, 2, 1, 0, -1, -2, -1, 0, 1, 2] }
        if (id === 'preamp') return { gainDb: 4 }
        return undefined
      },
    }

    ctx.emit('dsp/chain-changed', [])
    // Wait for event handler microtask
    await new Promise((r) => setTimeout(r, 10))

    expect(capturedDspConfig).toEqual({
      eq: { enabled: true, gains: [3, 2, 1, 0, -1, -2, -1, 0, 1, 2] },
      preamp: { enabled: true, gainDb: 4 },
      compressor: undefined,
    })
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
})

