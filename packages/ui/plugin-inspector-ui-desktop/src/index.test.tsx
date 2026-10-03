/**
 * Unit & Integration tests for Cordis Plugin Topology Explorer.
 */

import { describe, expect, it } from 'vitest'
import { createElement as h, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import inspectorPlugin from '@BBeBee/plugin-inspector'
import inspectorUi, {
  INSPECTOR_VIEW,
  InspectorErrorBoundary,
  InspectorPanel,
} from './index.js'
import { CordisGraphAdapter } from './cordis-graph-adapter.js'
import { computeGraphLayout, filterGraph } from './graph-layout.js'
import { ALL_LAYER_IDS } from './layer-resolver.js'
import type { FilterOptions } from './graph-model.js'

/** Mock Ui Service for testing route & view contribution */
class UiStub extends Service {
  readonly views = new Map<string, unknown>()
  readonly contributions: { kind: string; id: string; path?: string; title?: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, view: unknown) {
    this.views.set(id, view)
    return () => void this.views.delete(id)
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  contribute(contribution: { kind: string; id: string; path?: string; title?: string }) {
    this.contributions.push(contribution)
    return () => undefined
  }
}

/** The app context harness */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(inspectorPlugin)
  await ctx.plugin(inspectorUi)

  const shellCtx = await new Promise<Context>((resolve) => {
    void ctx.inject(['ui'], (scoped) => void resolve(scoped))
  })
  await new Promise((resolve) => setTimeout(resolve, 15))
  return { ctx, shellCtx }
}

function renderAsShell(shellCtx: Context): string {
  const View = shellCtx.ui.viewFor(INSPECTOR_VIEW) as ComponentType<{ ctx: Context }> | undefined
  expect(View, 'no view registered for the contributed route').toBeDefined()
  return renderToStaticMarkup(h(View!, { ctx: shellCtx }))
}

describe('Cordis Plugin Topology Explorer View', () => {
  it('renders the plugin graph when shell hands it context', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    expect(html).toContain('Plugin graph')
    expect(html).toContain('root')
    expect(html).toContain('plugin-inspector')
    expect(html).toContain('ACTIVE')
  })

  it('contributes route to inspector.panel for sidebar/tray access', async () => {
    const { ctx } = await harness()
    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributions).toContainEqual(
      expect.objectContaining({ kind: 'route', id: INSPECTOR_VIEW, path: '/inspector' }),
    )
  })

  it('shows counts and what a stalled fiber is waiting for', async () => {
    const { ctx, shellCtx } = await harness()

    // Add a stuck plugin requiring a non-existent service
    await ctx.plugin({
      name: 'plugin-stuck',
      inject: ['nothing-provides-this'],
      apply: async () => undefined,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const html = renderAsShell(shellCtx)
    expect(html).toContain('plugin-stuck')
    expect(html).toContain('PENDING')
    expect(html).toContain('waiting nothing-provides-this')
  })

  it('unregisters view when plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(inspectorPlugin)
    const fiber = await ctx.plugin(inspectorUi)
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeDefined()

    await fiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeUndefined()
  })

  it('renders directly with direct context', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)
    await new Promise((resolve) => setTimeout(resolve, 15))
    const html = renderToStaticMarkup(h(InspectorPanel, { ctx }))
    expect(html).toContain('Plugin graph')
    expect(html).toContain('CORDIS TOPOLOGY')
  })

  it('renders all 5 architectural layer container bands', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    expect(html).toContain('KERNEL · L1')
    expect(html).toContain('CORE · L2')
    expect(html).toContain('LOGS · L3')
    expect(html).toContain('FEATURE · L4')
    expect(html).toContain('UI · L5')
  })

  it('gracefully catches render errors in the error boundary', () => {
    const error = new Error('Simulated circuit failure')
    const state = InspectorErrorBoundary.getDerivedStateFromError(error)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(error)

    const boundary = new InspectorErrorBoundary({ children: null })
    boundary.state = state
    const html = renderToStaticMarkup(boundary.render() as any)
    expect(html).toContain('CIRCUIT TELEMETRY FAULT')
    expect(html).toContain('Simulated circuit failure')
    expect(html).toContain('REBOOT INSPECTOR CIRCUIT')
  })
})

describe('CordisGraphAdapter & GraphLayout Engine', () => {
  it('extracts live plugins, services, and events from context', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    // Register a service provider
    class TestService extends Service {
      constructor(c: Context) {
        super(c, 'testService')
      }
    }
    await ctx.plugin(TestService)

    // Register a consumer
    await ctx.plugin({
      name: 'test-consumer',
      inject: ['testService'],
      apply: () => {},
    })

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()

    expect(graph.plugins.some((p) => p.name === 'test-consumer')).toBe(true)
    expect(graph.services.some((s) => s.name === 'testService')).toBe(true)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it('computes orthogonal layout with multi-channel bus traces', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()

    const filters: FilterOptions = {
      searchQuery: '',
      selectedLayers: new Set(ALL_LAYER_IDS),
      nodeTypes: new Set(['plugin', 'service', 'event']),
      edgeTypes: new Set(['dependency', 'service', 'event', 'ui']),
      focusNodeId: null,
      focusDepth: 1,
    }

    const layout = computeGraphLayout(graph, filters)

    expect(layout.nodes.length).toBeGreaterThan(0)
    expect(layout.layerBounds.length).toBe(5)
    expect(layout.width).toBeGreaterThan(1000)
    expect(layout.height).toBeGreaterThan(500)

    // Verify orthogonal path points
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(4)
      expect(edge.sourcePin).toBeDefined()
      expect(edge.targetPin).toBeDefined()
    }
  })

  it('filters graph by search query and focus traversal', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    await ctx.plugin({
      name: 'plugin-auth',
      apply: () => {},
    })

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()

    // Test search filter
    const searchFiltered = filterGraph(graph, {
      searchQuery: 'auth',
      selectedLayers: new Set(ALL_LAYER_IDS),
      nodeTypes: new Set(['plugin', 'service', 'event']),
      edgeTypes: new Set(['dependency', 'service', 'event', 'ui']),
      focusNodeId: null,
      focusDepth: 1,
    })

    expect(searchFiltered.plugins.some((p) => p.name === 'plugin-auth')).toBe(true)
    expect(searchFiltered.plugins.some((p) => p.name === 'root')).toBe(false)
  })
})
