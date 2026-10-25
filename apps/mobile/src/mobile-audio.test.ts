import { describe, expect, it } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import { AudioMpv } from '@bbebee/core-audio-mpv'
import { createFakeAudioContext } from '@bbebee/core-audio-mpv/testing'
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

  it('advances position through mpvGetState, so progress and natural end work', async () => {
    const { service } = await harness()
    const handle = await service.load('file:///music/mobile_track.flac', { strategy: 'stream' })
    handle.play(0)

    // The handle polls the bridge every 200ms; give it a poll or two.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(handle.positionMs, 'position advances via the simulated engine clock').toBeGreaterThan(
      0,
    )
  })

  it('rolls over to the preloaded track at the boundary — gapless', async () => {
    const { service } = await harness()
    const handle = await service.load('file:///music/a.flac', { strategy: 'stream' })
    handle.play(0)

    // The engine owns the playlist boundary once handed the next uri.
    await service.preloadNext?.('file:///music/b.flac')
    // Jump to just before the (simulated) 180s end and let the clock run out.
    handle.seek?.(179_500)

    const ended = new Promise<void>((resolve) => handle.onEnded(() => resolve()))
    await ended
    // The rollover already happened in the engine: the next load of the same
    // file re-binds to it instead of restarting the clock.
    const rebound = await service.load('file:///music/b.flac', { strategy: 'stream' })
    expect(rebound.durationMs).toBe(180_000)
  })

  it('reports engine status honestly under the simulation bridge', async () => {
    const { service } = await harness()
    const status = await service.getEngineStatus()
    expect(status.running).toBe(false)
    expect(status.mpvAvailable).toBe(false)
    // Must not throw even though the simulated bridge ignores it.
    await service.setVisualizer(true, 2048)
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
