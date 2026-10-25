/**
 * The desktop media session, against a fake `navigator.mediaSession` and a
 * fake bridge.
 *
 * Neither OS surface exists under test, which is exactly why the service
 * keeps its own view of what it published: the contract is about what was
 * *told* to the OS, and that is checkable without one.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { mediaSessionConformance } from '@BBeBee/protocol/conformance'
import type { BridgeEvent } from '@bbebee/core-desktop-bridge'
import plugin, { MediaSessionTauri, type MediaSessionLike } from './index.js'

/** A `navigator.mediaSession` that records what was set on it. */
function fakeSession() {
  const handlers = new Map<string, ((details?: unknown) => void) | null>()
  const session: MediaSessionLike & { positions: unknown[] } = {
    metadata: null,
    playbackState: 'none',
    positions: [],
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler)
      else handlers.delete(action)
    },
    setPositionState(state) {
      session.positions.push(state)
    },
  }
  return { session, handlers }
}

function fakeBridge() {
  const calls: { method: string; args: unknown[] }[] = []
  const subscribers = new Set<(e: BridgeEvent) => void>()
  return {
    calls,
    push(event: BridgeEvent) {
      for (const cb of [...subscribers]) cb(event)
    },
    api: {
      call: async (_service: string, method: string, args: unknown[]) => {
        calls.push({ method, args })
        return undefined
      },
      streamOpen: async () => 0,
      streamPull: async () => null,
      streamClose: async () => undefined,
      txBegin: async () => 't',
      txEnd: async () => undefined,
      on: (handler: (e: BridgeEvent) => void) => {
        subscribers.add(handler)
        return () => void subscribers.delete(handler)
      },
    },
  }
}

async function harness() {
  const { session, handlers } = fakeSession()
  const bridge = fakeBridge()
  const ctx = new Context()
  await ctx.plugin(MediaSessionTauri, {
    session,
    bridge: bridge.api as never,
    metadataFactory: (init) => init,
  })
  return { ctx, session, handlers, bridge, service: ctx.mediaSession as MediaSessionTauri }
}

describe(mediaSessionConformance.service, () => {
  for (const check of mediaSessionConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { service } = await harness()
      await check.run({
        service,
        published: () => service.published(),
        press: (command) => service.press(command),
      })
    })
  }
})

describe('the Chromium surface', () => {
  it('sets metadata the browser can render', async () => {
    const { service, session } = await harness()
    service.update({ title: 'Jóga', artist: 'Björk', album: 'Homogenic' })
    expect(session.metadata).toMatchObject({ title: 'Jóga', artist: 'Björk' })
  })

  it('publishes a position state, which is what moves a scrubber', async () => {
    const { service, session } = await harness()
    service.update({ title: 'x', durationMs: 300_000, positionMs: 30_000 })
    // Seconds, not milliseconds — the browser API's unit, and an easy bug.
    expect(session.positions.at(-1)).toMatchObject({ duration: 300, position: 30 })
  })

  it('drops a local cover, which Chromium would refuse with a warning', async () => {
    // `file:` makes `MediaMetadata` log "src can only be of http/https/data/blob
    // scheme" on every assignment — once per position tick, when the player
    // republished. It is dropped here, not attempted.
    const { service, session } = await harness()
    service.update({ title: 'Jóga', artworkUri: 'file:///C:/artwork/aw.jpg' })
    expect((session.metadata as { artwork?: unknown[] }).artwork).toEqual([])
  })

  it('prefers the network cover URL a browser can actually load', async () => {
    const { service, session } = await harness()
    service.update({
      title: 'Jóga',
      artworkUri: 'file:///C:/artwork/aw.jpg',
      artworkUrl: 'https://cdn.test/joga.jpg',
    })
    expect((session.metadata as { artwork?: unknown[] }).artwork).toEqual([
      { src: 'https://cdn.test/joga.jpg' },
    ])
  })

  it('moves the scrubber without rebuilding the metadata', async () => {
    // The 1 Hz reference tick must not republish the track: a new
    // `MediaMetadata` per second is a re-render of the lock screen, and the
    // art load Chromium retries with it.
    const { service, session } = await harness()
    service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 0 })
    const published = session.metadata
    service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 1000 })

    expect(session.metadata, 'the same metadata object').toBe(published)
    expect(session.positions.at(-1)).toMatchObject({ position: 1 })
  })

  it('does not publish a position without a usable duration', async () => {
    // `setPositionState` throws on NaN or a position past the end, which would
    // take down a track change over a cosmetic feature.
    const { service, session } = await harness()
    service.update({ title: 'live stream' })
    service.update({ title: 'bad', durationMs: Number.NaN, positionMs: 1 })
    expect(session.positions).toHaveLength(0)
  })

  it('clamps a position that overruns its duration', async () => {
    const { service, session } = await harness()
    service.update({ title: 'x', durationMs: 10_000, positionMs: 99_000 })
    expect(session.positions.at(-1)).toMatchObject({ position: 10 })
  })

  it('binds only the actions it declares support for', async () => {
    const { service, handlers } = await harness()
    service.setSupportedCommands(['play', 'pause'])
    expect([...handlers.keys()].sort()).toEqual(['pause', 'play'])

    service.setSupportedCommands(['play', 'next'])
    expect([...handlers.keys()].sort(), 'pause is unbound, next is bound').toEqual([
      'nexttrack',
      'play',
    ])
  })

  it('turns a browser seek action into a command in milliseconds', async () => {
    const { service, handlers } = await harness()
    const seen: unknown[] = []
    service.onCommand((c) => void seen.push(c))
    service.setSupportedCommands(['seek'])

    handlers.get('seekto')!({ seekTime: 42 })
    expect(seen).toEqual([{ type: 'seek', positionMs: 42_000 }])
  })

  it('turns seekbackward into a negative relative seek', async () => {
    const { service, handlers } = await harness()
    const seen: unknown[] = []
    service.onCommand((c) => void seen.push(c))
    service.setSupportedCommands(['seek-relative'])

    handlers.get('seekbackward')!({ seekOffset: 15 })
    handlers.get('seekforward')!({ seekOffset: 15 })
    expect(seen).toEqual([
      { type: 'seek-relative', deltaMs: -15_000 },
      { type: 'seek-relative', deltaMs: 15_000 },
    ])
  })

  it('unbinds every action on clear, so no button reaches a dead player', async () => {
    const { service, handlers } = await harness()
    service.setSupportedCommands(['play', 'pause', 'next'])
    expect(handlers.size).toBeGreaterThan(0)
    service.clear()
    expect(handlers.size).toBe(0)
  })
})

describe('the main-process surface', () => {
  it('mirrors metadata and state to MPRIS/SMTC', async () => {
    const { service, bridge } = await harness()
    service.update({ title: 'Jóga' })
    service.setPlaybackState('playing')

    const methods = bridge.calls.map((c) => c.method)
    expect(methods).toContain('publishNowPlaying')
    expect(methods).toContain('publishPlaybackState')
  })

  it('publishes once per track, not once per position tick', async () => {
    const { service, bridge } = await harness()
    service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 0 })
    service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 1000 })
    service.update({ title: 'Jóga', durationMs: 300_000, positionMs: 2000 })

    const publishes = bridge.calls.filter((c) => c.method === 'publishNowPlaying')
    expect(publishes).toHaveLength(1)
  })

  it('re-publishes after a clear, which dropped the surface', async () => {
    const { service, bridge } = await harness()
    service.update({ title: 'Jóga' })
    service.clear()
    service.update({ title: 'Jóga' })

    const publishes = bridge.calls.filter((c) => c.method === 'publishNowPlaying')
    expect(publishes).toHaveLength(2)
  })

  it('accepts a press from MPRIS as if it were a lock-screen press', async () => {
    // A listener must not be able to tell which surface was pressed.
    const { service, bridge } = await harness()
    const seen: unknown[] = []
    service.onCommand((c) => void seen.push(c))

    bridge.push({ topic: 'transport', command: 'next' })
    bridge.push({ topic: 'transport', command: 'seek', positionMs: 5000 })
    expect(seen).toEqual([{ type: 'next' }, { type: 'seek', positionMs: 5000 }])
  })

  it('ignores a transport topic it does not understand', async () => {
    const { service, bridge } = await harness()
    const seen: unknown[] = []
    service.onCommand((c) => void seen.push(c))
    bridge.push({ topic: 'transport', command: 'teleport' })
    expect(seen).toEqual([])
  })

  it('survives a host with no MPRIS at all', async () => {
    // A Linux box with no daemon must cost the OS surface, not the player.
    const ctx = new Context()
    await ctx.plugin(MediaSessionTauri, { metadataFactory: (i) => i })
    expect(() => {
      ctx.mediaSession.update({ title: 'x' })
      ctx.mediaSession.setPlaybackState('playing')
      ctx.mediaSession.clear()
    }).not.toThrow()
  })
})

describe('robustness', () => {
  it('keeps dispatching when one listener throws', async () => {
    const { service } = await harness()
    const good = vi.fn()
    service.onCommand(() => {
      throw new Error('boom')
    })
    service.onCommand(good)
    service.press({ type: 'play' })
    expect(good).toHaveBeenCalledOnce()
  })

  it('lets a listener dispose itself mid-dispatch', async () => {
    const { service } = await harness()
    const seen: string[] = []
    const off = service.onCommand(() => {
      seen.push('first')
      off()
    })
    service.onCommand(() => void seen.push('second'))
    service.press({ type: 'play' })
    expect(seen, 'the second listener still ran').toEqual(['first', 'second'])
  })

  it('leaves no OS surface behind when unloaded', async () => {
    // A disabled player must not leave a ghost lock screen whose buttons
    // reach a service that no longer exists (docs/11 §4.4).
    const fake = fakeSession()
    const bridge = fakeBridge()
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      session: fake.session,
      bridge: bridge.api as never,
      metadataFactory: (init: Record<string, unknown>) => init,
    })
    ctx.mediaSession.update({ title: 'x' })
    ctx.mediaSession.setSupportedCommands(['play'])
    expect(fake.handlers.size).toBeGreaterThan(0)

    await fiber.dispose()
    expect(fake.session.metadata, 'metadata cleared').toBeNull()
    expect(fake.handlers.size, 'actions unbound').toBe(0)
    expect(bridge.calls.map((c) => c.method)).toContain('clearNowPlaying')
  })
})
