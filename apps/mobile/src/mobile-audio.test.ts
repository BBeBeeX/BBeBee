import { describe, expect, it } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import { AudioMpv } from '@BBeBee/core-audio-mpv'
import { createFakeAudioContext } from '@BBeBee/core-audio-mpv/testing'
import { MobileAudioService, createMobileMpvBridge } from './mobile-audio.js'
import type { InterruptionEvent } from '@BBeBee/protocol'

describe('MobileAudioService (MPV engine)', () => {
  async function harness() {
    const ctx = new Context()
    // AudioMpv declares inject: ['dsp'] — provide a stub so mounts resolve.
    ctx.provide('dsp', { chain: [], definitions: [], getParams: () => ({}) })
    const fakeContext = createFakeAudioContext(48000)
    const bridge = createMobileMpvBridge()

    const service = new MobileAudioService(ctx, {
      mpvPlugin: AudioMpv,
      createContext: () => fakeContext as never,
      bridgeCall: bridge,
    })

    await (service as unknown as Record<symbol, () => Promise<unknown>>)[Service.init]?.()
    return { ctx, service, fakeContext }
  }

  it('boots with the MPV engine', async () => {
    const { service } = await harness()
    expect(service.activeEngineName).toBe('mpv')
    expect(service.sampleRate).toBe(48000)
  })

  it('switchEngine is a no-op on the single engine', async () => {
    const { service } = await harness()
    await service.switchEngine('mpv')
    expect(service.activeEngineName).toBe('mpv')
  })

  it('streams FFT spectrum frames under MPV', async () => {
    const { service } = await harness()
    const handle = await service.load('file:///music/mobile_track.flac', { strategy: 'stream' })

    handle.play(0)
    const spectrum = await service.getFftSpectrum()

    expect(spectrum).toBeDefined()
    expect(spectrum?.frequencyData.length).toBe(64)
    expect(spectrum?.timeDomainData.length).toBe(64)
  })

  it('forwards interruption events to listeners', async () => {
    const { service } = await harness()
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
