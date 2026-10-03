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
import { buildFocusedGraph, computeGraphLayout, filterGraph } from './graph-layout.js'
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

  it('renders all 5 architectural layers in hierarchy tree navigation', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    expect(html).toContain('Kernel')
    expect(html).toContain('Core')
    expect(html).toContain('Logs')
    expect(html).toContain('Feature')
    expect(html).toContain('UI')
  })

  it('renders contextual topology controls: mode, focus badge, depth, and toggles', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    expect(html).toContain('OVERVIEW')
    expect(html).toContain('FOCUS')
    expect(html).toContain('DEPTH:')
    expect(html).toContain('Dependencies')
    expect(html).toContain('Services')
    expect(html).toContain('Events')
    expect(html).toContain('FIT')
    expect(html).toContain('RESET')
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

describe('Contextual / Focused Subgraph Generation (buildFocusedGraph)', () => {
  it('focuses on a single plugin and limits scope to 1-hop upstream and downstream', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    // Create chain: pluginUpstream -> pluginTarget -> pluginDownstream
    function pluginUpstream() {}
    function pluginTarget() {}
    ;(pluginTarget as any).dependencies = ['pluginUpstream']
    function pluginDownstream() {}
    ;(pluginDownstream as any).dependencies = ['pluginTarget']
    function pluginIrrelevant() {}

    await ctx.plugin(pluginUpstream)
    await ctx.plugin(pluginTarget)
    await ctx.plugin(pluginDownstream)
    await ctx.plugin(pluginIrrelevant)

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()

    const targetPlugin = graph.plugins.find((p) => p.name === 'pluginTarget')!
    expect(targetPlugin).toBeDefined()

    // Depth 1 focus
    const focused1 = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: targetPlugin.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: false,
    })

    const names1 = focused1.plugins.map((p) => p.name)
    expect(names1).toContain('pluginTarget')
    expect(names1).toContain('pluginUpstream')
    expect(names1).toContain('pluginDownstream')
    expect(names1).not.toContain('pluginIrrelevant')
    expect(focused1.plugins.length).toBeLessThan(graph.plugins.length)
  })

  it('respects depth parameter (depth 1 vs depth 2)', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    // Chain: D -> C -> B -> A
    function chainD() {}
    function chainC() {}
    ;(chainC as any).dependencies = ['chainD']
    function chainB() {}
    ;(chainB as any).dependencies = ['chainC']
    function chainA() {}
    ;(chainA as any).dependencies = ['chainB']

    await ctx.plugin(chainD)
    await ctx.plugin(chainC)
    await ctx.plugin(chainB)
    await ctx.plugin(chainA)

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()
    const targetA = graph.plugins.find((p) => p.name === 'chainA')!

    // Depth 1: includes A and B
    const depth1 = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: targetA.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: false,
      showEvents: false,
    })
    expect(depth1.plugins.some((p) => p.name === 'chainA')).toBe(true)
    expect(depth1.plugins.some((p) => p.name === 'chainB')).toBe(true)
    expect(depth1.plugins.some((p) => p.name === 'chainC')).toBe(false)
    expect(depth1.plugins.some((p) => p.name === 'chainD')).toBe(false)

    // Depth 2: includes A, B, and C
    const depth2 = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: targetA.id,
      depth: 2,
      showDependencies: true,
      showDependents: true,
      showServices: false,
      showEvents: false,
    })
    expect(depth2.plugins.some((p) => p.name === 'chainA')).toBe(true)
    expect(depth2.plugins.some((p) => p.name === 'chainB')).toBe(true)
    expect(depth2.plugins.some((p) => p.name === 'chainC')).toBe(true)
    expect(depth2.plugins.some((p) => p.name === 'chainD')).toBe(false)
  })

  it('includes provided and consumed services and their counterparts', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    class AuthProviderService extends Service {
      constructor(c: Context) {
        super(c, 'auth')
      }
    }
    await ctx.plugin(AuthProviderService)

    await ctx.plugin({
      name: 'plugin-auth-consumer',
      inject: ['auth'],
      apply: () => {},
    })

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()
    const consumer = graph.plugins.find((p) => p.name === 'plugin-auth-consumer')!

    const focused = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: consumer.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: false,
    })

    expect(focused.services.some((s) => s.name === 'auth')).toBe(true)
    // Provider plugin must also be included
    const providerService = focused.services.find((s) => s.name === 'auth')!
    expect(focused.plugins.some((p) => p.id === providerService.provider)).toBe(true)
  })

  it('toggles events on and off (default off)', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)

    await ctx.plugin({
      name: 'plugin-event-emitter',
      apply: (c) => {
        c.on('audio/track-play' as any, () => {})
      },
    })

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()
    const emitter = graph.plugins.find((p) => p.name === 'plugin-event-emitter')!

    // Default: showEvents = false
    const withoutEvents = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: emitter.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: false,
    })
    expect(withoutEvents.events.length).toBe(0)

    // Toggled on: showEvents = true
    const withEvents = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: emitter.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: true,
    })
    expect(withEvents.events.length).toBeGreaterThan(0)
  })

  it('switches between Overview Mode (full graph) and Focus Mode (subgraph)', async () => {
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)
    await ctx.plugin({ name: 'extra-1', apply: () => {} })
    await ctx.plugin({ name: 'extra-2', apply: () => {} })

    const adapter = new CordisGraphAdapter(ctx)
    const graph = adapter.getGraph()

    // Overview mode
    const overview = buildFocusedGraph(graph, {
      mode: 'overview',
      type: 'overview',
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: true,
    })
    expect(overview.plugins.length).toBe(graph.plugins.length)

    // Focus mode on extra-1
    const p1 = graph.plugins.find((p) => p.name === 'extra-1')!
    const focused = buildFocusedGraph(graph, {
      mode: 'focus',
      type: 'plugin',
      id: p1.id,
      depth: 1,
      showDependencies: true,
      showDependents: true,
      showServices: true,
      showEvents: false,
    })
    expect(focused.plugins.length).toBe(1)
    expect(focused.plugins[0].name).toBe('extra-1')
  })
})
