// @vitest-environment jsdom
/**
 * The desktop audio wrapper's engine forwarding.
 *
 * The wrapper is what `ctx.audio` resolves to above the composition root, so
 * an optional engine member it fails to forward silently changes the contract
 * every feature reads. `preloadNext` is the case in point: the player uses
 * the member's *presence* to decide who owns the gapless playlist boundary,
 * and before the forwarding existed the mpv append never ran while the handle
 * prefetch did — a `loadfile replace` that killed the playing track.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { AudioService } from '@BBeBee/protocol'
import { DesktopAudioService } from './boot.js'

function service(): DesktopAudioService {
  return new DesktopAudioService(new Context(), {
    fetchBytes: async () => new ArrayBuffer(0),
  })
}

function mount(svc: DesktopAudioService, engine: AudioService): void {
  ;(svc as unknown as { activeEngine: AudioService }).activeEngine = engine
}

describe('DesktopAudioService engine forwarding', () => {
  it('exposes the active engine preloadNext as its own, bound', async () => {
    const svc = service()
    const preloadNext = vi.fn(async () => undefined)
    mount(svc, { preloadNext } as unknown as AudioService)

    expect(typeof svc.preloadNext, 'the member is a function when the engine has one').toBe(
      'function',
    )
    await svc.preloadNext!('file:///music/next.flac')
    expect(preloadNext).toHaveBeenCalledWith('file:///music/next.flac')
  })

  it('an engine without preloadNext leaves the member undefined on the wrapper', () => {
    // The optionality is the contract: on the webaudio engine the player must
    // still see "no preload member" and prefetch a handle the old way.
    const svc = service()
    mount(svc, {} as AudioService)

    expect(svc.preloadNext).toBeUndefined()
    expect(svc.lastPreloadStatus).toBeUndefined()
  })

  it('forwards lastPreloadStatus for gapless diagnostics', () => {
    const svc = service()
    const status = { uri: 'file:///music/next.flac', ok: true, at: 1 }
    mount(svc, { lastPreloadStatus: status } as unknown as AudioService)

    expect(svc.lastPreloadStatus).toBe(status)
  })

  it('reads as undefined before any engine is mounted', () => {
    const svc = service()

    expect(svc.preloadNext).toBeUndefined()
    expect(svc.lastPreloadStatus).toBeUndefined()
  })

  it('pushes the remembered dsp payload whole (replaygain included) for the mpv engine', () => {
    // An engine (re)mount restores the last dsp payload as-is. Dropping the
    // replaygain fields here used to kill loudness normalization on every
    // engine switch while the EQ survived — the two halves of one payload
    // must travel together.
    const bridgeCall = vi.fn(async () => undefined)
    const svc = new DesktopAudioService(new Context(), {
      fetchBytes: async () => new ArrayBuffer(0),
      bridgeCall,
    })
    const untyped = svc as unknown as Record<string, unknown>
    untyped['activeEngineKey'] = 'mpv'
    const dsp = {
      af: 'volume=volume=-3.00dB,equalizer=f=1000:width_type=q:w=1.41:g=6',
      replaygain: 'track',
      replaygainClip: true,
      replaygainPreamp: '4',
      replaygainFallback: '0',
    }
    untyped['lastNativeDsp'] = dsp

    ;(untyped['pushNativeDsp'] as () => void)()

    expect(bridgeCall).toHaveBeenCalledTimes(1)
    expect(bridgeCall).toHaveBeenCalledWith('audio', 'mpvSetDspConfig', [dsp])
  })

  it('does not push dsp config for the webaudio engine or before any dsp event', () => {
    const bridgeCall = vi.fn(async () => undefined)
    const svc = new DesktopAudioService(new Context(), {
      fetchBytes: async () => new ArrayBuffer(0),
      bridgeCall,
    })
    const untyped = svc as unknown as Record<string, unknown>

    // No dsp payload seen yet.
    untyped['activeEngineKey'] = 'mpv'
    ;(untyped['pushNativeDsp'] as () => void)()
    // A payload, but the webaudio engine has no native filter chain.
    untyped['activeEngineKey'] = 'webaudio'
    untyped['lastNativeDsp'] = { af: 'volume=volume=-3.00dB' }
    ;(untyped['pushNativeDsp'] as () => void)()

    expect(bridgeCall, 'neither case reaches the bridge').not.toHaveBeenCalled()
  })
})
