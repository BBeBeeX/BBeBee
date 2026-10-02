import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import pluginUi, { Ui } from './index.js'

describe('plugin-ui tray contributions', () => {
  it('aggregates explicit tray contributions and route contributions with tray placement', async () => {
    const ctx = new Context()
    await ctx.plugin(pluginUi)

    expect(ctx.ui.tray).toEqual([])

    // Route with placement: ['tray']
    const d1 = ctx.ui.contribute({
      kind: 'route',
      id: 'dsp.view',
      path: '/dsp',
      title: 'DSP',
      icon: 'tune',
      placement: ['tray'],
      order: 20,
    })

    // Route without tray placement
    const d2 = ctx.ui.contribute({
      kind: 'route',
      id: 'library.home',
      path: '/library',
      title: 'Library',
      placement: ['sidebar'],
      order: 10,
    })

    // Explicit tray contribution
    const d3 = ctx.ui.contribute({
      kind: 'tray',
      id: 'custom.tool',
      title: 'Custom Tool',
      icon: 'tool',
      order: 5,
    })

    expect(ctx.ui.tray).toHaveLength(2)
    expect(ctx.ui.tray[0]).toEqual({
      kind: 'tray',
      id: 'custom.tool',
      title: 'Custom Tool',
      icon: 'tool',
      order: 5,
    })
    expect(ctx.ui.tray[1]).toEqual({
      kind: 'tray',
      id: 'dsp.view',
      title: 'DSP',
      icon: 'tune',
      targetRoute: 'dsp.view',
      order: 20,
    })

    // Disposing removes item
    d1()
    expect(ctx.ui.tray).toHaveLength(1)
    expect(ctx.ui.tray[0]?.id).toBe('custom.tool')

    d2()
    d3()
    expect(ctx.ui.tray).toEqual([])
  })

  it('deduplicates when an explicit tray contribution and a route share the same id', async () => {
    const ctx = new Context()
    await ctx.plugin(Ui)

    ctx.ui.contribute({
      kind: 'tray',
      id: 'plugin.x',
      title: 'Explicit Plugin X',
      icon: 'star',
      order: 1,
    })

    ctx.ui.contribute({
      kind: 'route',
      id: 'plugin.x',
      path: '/plugin-x',
      title: 'Route Plugin X',
      icon: 'route-icon',
      placement: ['tray'],
      order: 2,
    })

    expect(ctx.ui.tray).toHaveLength(1)
    expect(ctx.ui.tray[0]?.title).toBe('Explicit Plugin X')
  })
})
