import { describe, expect, it } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import { AudioMpv } from '@BBeBee/core-audio-mpv'
import { AudioWebAudio } from '@BBeBee/core-audio-webaudio'
import { createFakeAudioContext } from '@BBeBee/core-audio-webaudio/testing'
import { MobileAudioService, createMobileMpvBridge } from './mobile-audio.js'
import type { AudioOutputEngine, InterruptionEvent } from '@BBeBee/protocol'

describe('MobileAudioService (Route A WebAudio & Route B MPV)', () => {
  async function harness(options: { initialEngine?: 'webaudio' | 'mpv' } = {}) {
    const ctx = new Context()
    // AudioMpv declares inject: ['dsp'] — provide a stub so mounts resolve.
    ctx.provide('dsp', { chain: [], definitions: [], getParams: () => ({}) })
    const fakeContext = createFakeAudioContext(48000)
    const bridge = createMobileMpvBridge()

    const service = new MobileAudioService(ctx, {
      initialEngine: options.initialEngine ?? 'webaudio',
      mpvPlugin: AudioMpv,
      webAudioPlugin: AudioWebAudio,
      createContext: () => fakeContext as never,
      fallbackLatencyMs: 50,
      fetchBytes: async () => new ArrayBuffer(1024),
      bridgeCall: bridge,
    })

    await (service as unknown as Record<symbol, () => Promise<unknown>>)[Service.init]?.()
    return { ctx, service, fakeContext }
  }

  it('boots with Route A (WebAudio) by default', async () => {
    const { service } = await harness()
    expect(service.activeEngineName).toBe('webaudio')
    expect(service.sampleRate).toBe(48000)
  })

  it('boots with Route B (MPV) when specified', async () => {
    const { service } = await harness({ initialEngine: 'mpv' })
    expect(service.activeEngineName).toBe('mpv')
  })

  it('dynamically switches between WebAudio and MPV engines', async () => {
    const { ctx, service } = await harness({ initialEngine: 'webaudio' })
    expect(service.activeEngineName).toBe('webaudio')

    const engineChangedEvents: { engine: AudioOutputEngine }[] = []
    ctx.on('audio/engine-changed', (e) => engineChangedEvents.push(e))

    await service.switchEngine('mpv')
    expect(service.activeEngineName).toBe('mpv')
    expect(engineChangedEvents).toEqual([{ engine: 'mpv' }])

    // State preservation across switch
    service.setVolume(0.65)
    service.setMuted(true)

    await service.switchEngine('webaudio')
    expect(service.activeEngineName).toBe('webaudio')
    expect(engineChangedEvents).toEqual([{ engine: 'mpv' }, { engine: 'webaudio' }])
  })

  it('streams FFT spectrum frames under Route B MPV', async () => {
    const { service } = await harness({ initialEngine: 'mpv' })
    const handle = await service.load('file:///music/mobile_track.flac', { strategy: 'stream' })

    handle.play(0)
    const spectrum = await service.getFftSpectrum()

    expect(spectrum).toBeDefined()
    expect(spectrum?.frequencyData.length).toBe(64)
    expect(spectrum?.timeDomainData.length).toBe(64)
  })

  it('forwards interruption events to listeners', async () => {
    const { service } = await harness({ initialEngine: 'webaudio' })
    const interruptions: InterruptionEvent[] = []

    service.onInterruption((e) => interruptions.push(e))

    service.emitInterruption({ type: 'began', shouldResume: false })
    expect(interruptions).toEqual([{ type: 'began', shouldResume: false }])

    service.emitInterruption({ type: 'ended', shouldResume: true })
    expect(interruptions).toEqual([
      { type: 'began', shouldResume: false },
      { type: 'ended', shouldResume: true },
    ])
  })
})
