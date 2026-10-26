/**
 * `core-haptics-mobile` against the recorded-call stub.
 *
 * `expo-haptics` is aliased to `test/stubs/expo-haptics.ts` under Vitest,
 * which records every call with its resolved kind — so these tests assert
 * not just "feedback happened" but *which* cue, in the SDK's own vocabulary
 * (a favorite that lands as `heavy` where the design says `light` is a
 * reviewable defect, not a passing test). The one thing the stub cannot do
 * on its own is fail, and half this service's contract is about failure —
 * so the degradation test scripts a rejection with `vi.spyOn`, because a
 * stub that cannot fail cannot prove the player survives a failing engine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { TransportState } from '@BBeBee/protocol'
import { HapticsExpo, type HapticsExpoConfig } from './index.js'

/** One recorded cue, as the stub shapes it. */
interface RecordedCall {
  method: 'impact' | 'notification' | 'selection'
  kind: string
}

async function calls(): Promise<readonly RecordedCall[]> {
  // The levers live on the stub, not on the real SDK, so they are reached
  // through the package name rather than a path crossing this package's root.
  const mod = (await import('expo-haptics')) as unknown as {
    __calls?: () => readonly RecordedCall[]
  }
  return mod.__calls?.() ?? []
}

function transport(over: Partial<TransportState> = {}): TransportState {
  return {
    status: 'playing',
    positionMs: 0,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
    ...over,
  }
}

async function harness(config: HapticsExpoConfig = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(HapticsExpo, config)
  return { ctx, fiber, haptics: ctx.haptics }
}

/** Let a fire-and-forget cue's rejection reach its `.catch`. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  const mod = (await import('expo-haptics')) as unknown as {
    __resetForTests?: () => void
  }
  mod.__resetForTests?.()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('core-haptics-mobile', () => {
  it('maps each cue onto the SDK kind it names', async () => {
    const { ctx, haptics } = await harness()
    expect(ctx.haptics.enabled, 'on by default').toBe(true)

    haptics.impact('medium')
    haptics.impact('heavy')
    haptics.notification('warning')
    haptics.notification('error')
    haptics.selection()
    haptics.tap()

    expect(await calls()).toEqual([
      { method: 'impact', kind: 'medium' },
      { method: 'impact', kind: 'heavy' },
      { method: 'notification', kind: 'warning' },
      { method: 'notification', kind: 'error' },
      { method: 'selection', kind: 'selection' },
      // `tap` is the contract's own word for a light impact.
      { method: 'impact', kind: 'light' },
    ])
  })

  it('defaults the styles the contract defaults', async () => {
    const { haptics } = await harness()
    haptics.impact()
    haptics.notification()
    expect(await calls()).toEqual([
      // The SDK's own default impact is medium; the contract's is light —
      // which is why the argument is always passed, never left to the
      // platform to decide.
      { method: 'impact', kind: 'light' },
      { method: 'notification', kind: 'success' },
    ])
  })

  it('silences every cue while disabled, and setEnabled revives them', async () => {
    const { ctx, haptics } = await harness({ enabled: false })
    expect(haptics.enabled).toBe(false)

    haptics.impact()
    haptics.notification()
    haptics.selection()
    haptics.tap()
    ctx.emit('player/track-changed', 'BBeBee:local:track:t1')
    expect(await calls()).toEqual([])

    haptics.setEnabled(true)
    expect(haptics.enabled).toBe(true)
    haptics.tap()
    expect(await calls()).toEqual([{ method: 'impact', kind: 'light' }])
  })
})

describe('the default triggers', () => {
  it('ticks selection when the track changes, not when the queue empties', async () => {
    const { ctx } = await harness()
    ctx.emit('player/track-changed', 'BBeBee:local:track:t1')
    ctx.emit('player/track-changed', 'BBeBee:local:track:t2', 'BBeBee:local:track:t1')
    expect(await calls()).toEqual([
      { method: 'selection', kind: 'selection' },
      { method: 'selection', kind: 'selection' },
    ])

    // `undefined` is "nothing now playing" — the queue ran out, and a tick
    // for the absence of a track is noise.
    ctx.emit('player/track-changed', undefined)
    expect(await calls()).toHaveLength(2)
  })

  it('taps when a play mode flipped, not on every state event', async () => {
    const { ctx } = await harness()
    // The first event baselines; booting must not buzz.
    ctx.emit('player/state-changed', transport())
    // A seek is the same modes with a new position.
    ctx.emit('player/state-changed', transport({ positionMs: 60_000 }))
    expect(await calls()).toEqual([])

    ctx.emit('player/state-changed', transport({ playMode: 'shuffle' }))
    ctx.emit('player/state-changed', transport({ playMode: 'shuffle', shuffle: true }))
    ctx.emit('player/state-changed', transport({ repeat: 'all', shuffle: true }))
    expect(await calls()).toEqual([
      { method: 'impact', kind: 'light' },
      { method: 'impact', kind: 'light' },
      { method: 'impact', kind: 'light' },
    ])
  })

  it('wires nothing when triggers is false', async () => {
    const { ctx, haptics } = await harness({ triggers: false })
    ctx.emit('player/track-changed', 'BBeBee:local:track:t1')
    ctx.emit('player/state-changed', transport())
    ctx.emit('player/state-changed', transport({ playMode: 'list-loop' }))
    expect(await calls()).toEqual([])
    // Direct cues still answer — the flag gates the wiring, not the service.
    haptics.selection()
    expect(await calls()).toEqual([{ method: 'selection', kind: 'selection' }])
  })

  it('does not buzz on library/changed — a favorite is not distinguishable there', async () => {
    /*
     * `library/changed` carries `(kind, urns)` with no direction, and the
     * same `('track', urns)` shape arrives from un-favoriting, pin toggles
     * and the local scanner's bulk batches — wiring it would buzz the phone
     * for every file a walk imports. This pins the deliberate skip; see the
     * header of ./index.ts.
     */
    const { ctx } = await harness()
    ctx.emit('library/changed', 'track', ['BBeBee:local:track:t9'])
    expect(await calls()).toEqual([])
  })
})

describe('a device without an engine', () => {
  it('warns once on the first rejection, then no-ops silently', async () => {
    const { ctx, haptics } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const impactAsync = vi
      .spyOn(await import('expo-haptics'), 'impactAsync')
      .mockRejectedValueOnce(new Error('haptics unavailable'))

    haptics.impact('light')
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)

    // Every later cue is a no-op: no native call, no second warning — a
    // user on a device without an engine must not also own a log full of it.
    haptics.impact('medium')
    haptics.notification()
    haptics.selection()
    haptics.tap()
    ctx.emit('player/track-changed', 'BBeBee:local:track:t1')
    await flush()
    expect(impactAsync).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(await calls()).toEqual([])
  })
})

describe('teardown', () => {
  it('removes its listeners when the service stops', async () => {
    const { ctx, fiber } = await harness()
    await fiber.dispose()

    // The events keep firing, as a still-loaded player would: the disposed
    // service must not react to any of them.
    ctx.emit('player/track-changed', 'BBeBee:local:track:t1')
    ctx.emit('player/state-changed', transport())
    ctx.emit('player/state-changed', transport({ playMode: 'shuffle' }))
    expect(await calls()).toEqual([])
  })
})
