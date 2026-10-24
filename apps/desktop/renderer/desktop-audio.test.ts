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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context, Service } from 'cordis'
import type { AudioService } from '@BBeBee/protocol'
import { createFakeAudioContext } from '@bbebee/core-audio-mpv/testing'
import { DesktopAudioService, preloadPreferences } from './boot.js'

function service(): DesktopAudioService {
  return new DesktopAudioService(new Context(), {})
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
    // The optionality is the contract: an engine without a preload member
    // leaves the wrapper's member undefined.
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

  it('does not push dsp config before any dsp event', () => {
    const bridgeCall = vi.fn(async () => undefined)
    const svc = new DesktopAudioService(new Context(), {
      bridgeCall,
    })
    const untyped = svc as unknown as Record<string, unknown>

    // No dsp payload seen yet — nothing to push.
    untyped['activeEngineKey'] = 'mpv'
    ;(untyped['pushNativeDsp'] as () => void)()

    expect(bridgeCall, 'no payload means no bridge call').not.toHaveBeenCalled()
  })
})

describe('DesktopAudioService real mount (mpv-only)', () => {
  function mountableService(overrides: Record<string, unknown> = {}): DesktopAudioService {
    return new DesktopAudioService(new Context(), {
      bridgeCall: async () => undefined,
      createContext: () => createFakeAudioContext(48000) as never,
      ...overrides,
    })
  }

  async function init(svc: DesktopAudioService): Promise<void> {
    await (svc as unknown as Record<symbol, () => Promise<unknown>>)[Service.init]?.()
  }

  function fiberOf(svc: DesktopAudioService): unknown {
    return (svc as unknown as Record<string, unknown>)['activeFiber']
  }

  it('mounts the mpv engine and reports it as active', async () => {
    const svc = mountableService()
    await init(svc)

    expect(svc.engine).toBe('mpv')
    expect(svc.activeEngineName).toBe('mpv')
    expect(svc.sampleRate).toBe(48000)
    expect(fiberOf(svc)).toBeDefined()
  })

  it("normalizes the legacy 'wasapi' initial engine to mpv", async () => {
    const svc = mountableService({ initialEngine: 'wasapi' })
    await init(svc)

    expect(svc.engine).toBe('mpv')
    expect(svc.activeEngineName).toBe('mpv')
  })

  it('a mount failure rejects instead of falling back to a removed engine', async () => {
    const svc = mountableService({
      createContext: () => {
        throw new Error('no AudioContext in this environment')
      },
    })

    await expect(init(svc)).rejects.toThrow('no AudioContext')
    expect(fiberOf(svc)).toBeUndefined()
  })

  it("switchEngine('wasapi') is a no-op once mpv is mounted", async () => {
    const ctx = new Context()
    const svc = new DesktopAudioService(ctx, {
      bridgeCall: async () => undefined,
      createContext: () => createFakeAudioContext(48000) as never,
    })
    await init(svc)
    const fiber = fiberOf(svc)

    const changed: unknown[] = []
    ctx.on('audio/engine-changed', (e) => changed.push(e))
    await svc.switchEngine('wasapi')

    expect(fiberOf(svc)).toBe(fiber)
    expect(changed).toEqual([])
    expect(svc.engine).toBe('mpv')
  })
})

describe('preloadPreferences engine migration', () => {
  const w = window as unknown as { BBeBeeBridge?: { call: (...args: unknown[]) => Promise<unknown> } }

  function mockStore(data: unknown): void {
    w.BBeBeeBridge = { call: async () => JSON.stringify(data) }
  }

  afterEach(() => {
    delete w.BBeBeeBridge
  })

  it("maps a legacy 'webaudio' preference to mpv", async () => {
    mockStore({ preferences: { audioOutputEngine: 'webaudio' } })
    const prefs = await preloadPreferences({ appData: '/data' })
    expect(prefs.audioOutputEngine).toBe('mpv')
  })

  it("maps the namespaced 'wasapi' preference to mpv", async () => {
    mockStore({ '@bbebee/plugin-settings:preferences': { audioOutputEngine: 'wasapi' } })
    const prefs = await preloadPreferences({ appData: '/data' })
    expect(prefs.audioOutputEngine).toBe('mpv')
  })

  it('leaves the engine unset when the store has none', async () => {
    mockStore({ preferences: {} })
    const prefs = await preloadPreferences({ appData: '/data' })
    expect(prefs.audioOutputEngine).toBeUndefined()
  })

  it('returns empty prefs when the bridge is unavailable', async () => {
    const prefs = await preloadPreferences({ appData: '/data' })
    expect(prefs).toEqual({})
  })
})
