/**
 * `plugin-history` as a plugin: it contributes the history route, and it unloads
 * the contribution with itself.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'
import { HISTORY_ROUTES } from './views.js'

/** `ctx.ui`, as far as this plugin is concerned: a place to contribute. */
class UiStub extends Service {
  readonly contributed: { id: string; path?: string; kind: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  contribute(c: { kind: string; id: string; path?: string }) {
    this.contributed.push({ kind: c.kind, id: c.id, ...(c.path ? { path: c.path } : {}) })
    return () => {}
  }
}

describe('plugin-history', () => {
  it('contributes the history route once the ui registry is up', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(plugin)
    await tick()

    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributed).toEqual([
      { kind: 'route', id: HISTORY_ROUTES.history, path: '/history' },
      { kind: 'settings', id: HISTORY_ROUTES.history },
    ])
  })

  it('loads with no ui registry at all, contributing nothing', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(plugin)).resolves.toBeDefined()
  })
})

describe('plugin-history lifecycle', () => {
  it('snapshots clean after unload, contribution and all', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('snapshots clean after unload when the ui registry never appeared', async () => {
    const ctx = new Context()
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
