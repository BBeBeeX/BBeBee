import { describe, expect, it } from 'vitest'
import { driftExceeds, expectedPosition, learnClock, leaderNow, snapshotMeansReload } from './clock.js'

describe('clock', () => {
  it('learns the offset from a snapshot receipt', () => {
    // Leader clock 120 ms ahead of the local clock at receipt.
    expect(learnClock(1_120, 1_000)).toEqual({ offsetMs: 120, learnedAt: 1_000 })
  })

  it('projects the leader clock forward', () => {
    const clock = { offsetMs: 120, learnedAt: 1_000 }
    expect(leaderNow(clock, 1_050)).toBe(1_170)
    expect(leaderNow(undefined, 1_050)).toBe(1_050)
  })
})

describe('expectedPosition', () => {
  const playing = { status: 'playing', positionMs: 10_000, serverTimeMs: 1_000 }

  it('advances the position in real time while the leader plays', () => {
    // No clock knowledge: elapsed measured against the local receipt time.
    expect(expectedPosition(playing, undefined, 3_000)).toBe(12_000)
  })

  it('uses the learned offset so leader-ahead clocks do not double count', () => {
    const clock = learnClock(1_100, 1_000) // leader 100 ms ahead
    // At local 2_000 the leader's clock reads 2_100 → elapsed 1_100.
    expect(expectedPosition(playing, clock, 2_000)).toBe(11_100)
  })

  it('freezes the position while the leader is paused', () => {
    expect(expectedPosition({ ...playing, status: 'paused' }, undefined, 9_000)).toBe(10_000)
  })

  it('subtracts the caller-supplied transport lag', () => {
    expect(expectedPosition(playing, undefined, 3_000, 150)).toBe(11_850)
  })

  it('never goes negative', () => {
    expect(expectedPosition({ ...playing, positionMs: 0, serverTimeMs: 5_000 }, undefined, 1_000)).toBe(0)
  })
})

describe('driftExceeds', () => {
  it('tolerates jitter inside the threshold', () => {
    expect(driftExceeds(10_000, 10_300)).toBe(false)
    expect(driftExceeds(10_000, 10_351)).toBe(true)
    expect(driftExceeds(10_000, 9_650)).toBe(false)
    expect(driftExceeds(10_000, 9_640)).toBe(true)
  })
})

describe('snapshotMeansReload', () => {
  it('reloads when the track changes', () => {
    expect(
      snapshotMeansReload({ urn: 'a', url: 'http://x' }, { trackUrn: 'b', streamUrl: 'http://x' }),
    ).toBe(true)
  })

  it('reloads when the url for the same track changes', () => {
    expect(
      snapshotMeansReload({ urn: 'a', url: 'http://x/1' }, { trackUrn: 'a', streamUrl: 'http://x/2' }),
    ).toBe(true)
  })

  it('does not reload the same track and url', () => {
    expect(
      snapshotMeansReload({ urn: 'a', url: 'http://x/1' }, { trackUrn: 'a', streamUrl: 'http://x/1' }),
    ).toBe(false)
  })

  it('reloads from nothing', () => {
    expect(snapshotMeansReload(undefined, { trackUrn: 'a', streamUrl: 'http://x' })).toBe(true)
    expect(snapshotMeansReload(undefined, {})).toBe(false)
  })
})
