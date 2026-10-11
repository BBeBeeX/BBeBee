// @vitest-environment jsdom
/**
 * `useToggleFavorite`, the one control two stores share.
 *
 * The heart has to write both `track_stats.loved` (what draws it) and the
 * library shelf (what the Favorites screen lists). A hook that wrote only one
 * would leave the two disagreeing in a way the user sees; a hook that threw
 * because one service was absent would take the other down with it.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type {} from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { useToggleFavorite } from './hooks.js'

afterEach(cleanup)

const TRACK = 'BBeBee:demo:track:one'

class SourcesStub extends Service {
  readonly loved: { urn: string; loved: boolean }[] = []
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async setLoved(urn: string, loved: boolean): Promise<void> {
    this.loved.push({ urn, loved })
  }
}

class LibraryStub extends Service {
  readonly saved: { urn: string; saved: boolean }[] = []
  constructor(ctx: Context) {
    super(ctx, 'library')
  }
  async setSaved(urn: string, saved: boolean): Promise<void> {
    this.saved.push({ urn, saved })
  }
}

describe('useToggleFavorite', () => {
  it('writes the catalogue flag and the shelf together', async () => {
    const ctx = new Context()
    await ctx.plugin(SourcesStub)
    await ctx.plugin(LibraryStub)
    await tick()

    const { result } = renderHook(() => useToggleFavorite(ctx))
    await act(async () => {
      await result.current(TRACK, true)
    })

    expect((ctx.sources as unknown as SourcesStub).loved).toEqual([{ urn: TRACK, loved: true }])
    expect((ctx.library as unknown as LibraryStub).saved).toEqual([{ urn: TRACK, saved: true }])
  })

  it('degrades to whichever half is loaded instead of throwing', async () => {
    const ctx = new Context()
    await ctx.plugin(SourcesStub)
    await tick()

    const { result } = renderHook(() => useToggleFavorite(ctx))
    await act(async () => {
      await result.current(TRACK, false)
    })

    expect((ctx.sources as unknown as SourcesStub).loved).toEqual([{ urn: TRACK, loved: false }])
  })
})
