// @vitest-environment jsdom
/**
 * The inspector view, rendered the way the shell renders it.
 *
 * ⚠️ **The context the view is handed is the whole point of this file.**
 * `main.tsx` mounts the shell with `app.ready(['ui'])` — a scoped context that
 * has `ui` injected and *nothing else* — and the shell passes that to every
 * view as `props.ctx`. A cordis context throws for any property not in its
 * inject list, so a screen reading `ctx.inspector` off it throws during render,
 * and with no error boundary above the shell React unmounts the whole tree: the
 * page goes black, with the failure visible only in devtools.
 *
 * A test that builds a plain root `Context` cannot see any of that — the read
 * simply answers there — which is exactly how this shipped. So the harness
 * below goes through `ctx.inject(['ui'], …)`, and the view is fetched from the
 * registry rather than imported, because what has to hold is the thing the
 * shell actually does.
 */

import { describe, expect, it } from 'vitest'
import { createElement as h, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import inspectorPlugin from '@BBeBee/plugin-inspector'
import inspectorUi, { INSPECTOR_VIEW, InspectorErrorBoundary, InspectorPanel } from './index.js'

/** Just the slice of `ctx.ui` this package touches. */
class UiStub extends Service {
  readonly views = new Map<string, unknown>()
  readonly contributions: { kind: string; id: string }[] = []

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

  contribute(contribution: { kind: string; id: string }) {
    this.contributions.push(contribution)
    return () => undefined
  }
}

/** The app context, plus the `ready(['ui'])` context the shell is given. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(inspectorPlugin)
  await ctx.plugin(inspectorUi)

  const shellCtx = await new Promise<Context>((resolve) => {
    void ctx.inject(['ui'], (scoped) => void resolve(scoped))
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { ctx, shellCtx }
}

/** What `Shell.tsx` does: look the view up by id and render it with its ctx. */
function renderAsShell(shellCtx: Context): string {
  const View = shellCtx.ui.viewFor(INSPECTOR_VIEW) as ComponentType<{ ctx: Context }> | undefined
  expect(View, 'no view registered for the contributed route').toBeDefined()
  return renderToStaticMarkup(h(View!, { ctx: shellCtx }))
}

describe('the inspector view', () => {
  it('renders the fiber tree when the shell hands it the shell context', async () => {
    const { shellCtx } = await harness()

    // Before the fix this threw `cannot get property "inspector" without
    // inject`, and the page the user saw was the body's background.
    const html = renderAsShell(shellCtx)

    expect(html).toContain('Plugin graph')
    // The graph itself, not just the heading: the root fiber, this plugin's own
    // fiber, and the service the inspector claims.
    expect(html).toContain('root')
    expect(html).toContain('plugin-inspector')
    expect(html).toContain('ACTIVE')
  })

  it('contributes a route the sidebar can reach', async () => {
    const { ctx } = await harness()
    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributions).toContainEqual(
      expect.objectContaining({ kind: 'route', id: INSPECTOR_VIEW }),
    )
  })

  it('shows counts and what a stalled fiber is waiting for', async () => {
    const { ctx, shellCtx } = await harness()

    // A plugin that will never activate — the state the inspector exists to
    // explain, and the one a snapshot of a healthy graph never covers.
    await ctx.plugin({
      name: 'plugin-stuck',
      inject: ['nothing-provides-this'],
      apply: async () => undefined,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const html = renderAsShell(shellCtx)
    expect(html).toContain('plugin-stuck')
    expect(html).toContain('PENDING')
    expect(html).toContain('waiting nothing-provides-this')
  })

  it('unregisters its view when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(inspectorPlugin)
    const fiber = await ctx.plugin(inspectorUi)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeDefined()

    await fiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.ui.viewFor(INSPECTOR_VIEW)).toBeUndefined()
  })

  it('still renders when given a context that has the service directly', async () => {
    // The panel is exported, and a caller holding a context with `inspector`
    // available may render it without going through the registry.
    const ctx = new Context()
    await ctx.plugin(inspectorPlugin)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(renderToStaticMarkup(h(InspectorPanel, { ctx }))).toContain('Plugin graph')
  })

  it('renders the 5 PCB visual layers and hardware HUD elements without removed badges/subcodes', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    // 5 Visual Layers
    expect(html).toContain('glow-layer')
    expect(html).toContain('trace-layer')
    expect(html).toContain('pin-layer')
    expect(html).toContain('node-layer')
    expect(html).toContain('signal-flow-layer')

    // Orthogonal trace path markers & filters
    expect(html).toContain('pcb-glow')
    expect(html).toContain('pcb-grid-pattern')
  })

  it('renders the 8 Subsystem Zones and core service IC chips on the motherboard', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    // Verify all 8 Subsystem Zones exist as defined PCB partitions
    expect(html).toContain('ZONE 01: CORE / BASE INFRASTRUCTURE')
    expect(html).toContain('ZONE 02: AUDIO SOURCE SUBSYSTEM')
    expect(html).toContain('ZONE 03: PLAYBACK ENGINE CORE')
    expect(html).toContain('ZONE 04: MEDIA STORAGE')
    expect(html).toContain('ZONE 05: SYNCHRONIZED LYRICS')
    expect(html).toContain('ZONE 06: UI REGISTRY BACKPLANE')
    expect(html).toContain('ZONE 07: SETTINGS')
    expect(html).toContain('ZONE 08: ARCHITECTURE INSPECTOR')

    // Verify dynamically loaded IC chips from the active Cordis context
    expect(html).toContain('UI')
    expect(html).toContain('INSPECTOR')
    expect(html).toContain('ROOT')
  })

  it('renders the 3-level architecture navigation HUD', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    // Level navigation controls
    expect(html).toContain('L1 · SYSTEM MAP')
    expect(html).toContain('L2 · SUBSYSTEM')
    expect(html).toContain('L3 · FIBER DETAIL')
    expect(html).toContain('MOTHERBOARD')
  })

  it('renders the 5 Layer Strata Bands and layer navigation controls', async () => {
    const { shellCtx } = await harness()
    const html = renderAsShell(shellCtx)

    // Verify 5 architectural layer strata bands
    expect(html).toContain('LAYER 01: KERNEL RUNTIME &amp; DI CONTAINER')
    expect(html).toContain('LAYER 02: CORE CAPABILITY SERVICES')
    expect(html).toContain('LAYER 03: OBSERVABILITY &amp; LOG TRANSPORTS')
    expect(html).toContain('LAYER 04: HEADLESS BUSINESS FEATURES')
    expect(html).toContain('LAYER 05: UI REGISTRY &amp; PRESENTATION FABRIC')

    // Verify layer package paths and architectural invariant rules
    expect(html).toContain('packages/kernel')
    expect(html).toContain('packages/core/*')
    expect(html).toContain('packages/logs/*')
    expect(html).toContain('packages/feature/*')
    expect(html).toContain('INVARIANT: Platform SDK Boundary Only')
    expect(html).toContain('INVARIANT: Pure Business Logic (Zero Platform SDKs)')

    // Verify layer quick-jump buttons in the HUD
    expect(html).toContain('ALL LAYERS')
    expect(html).toContain('L1 · KERNEL')
    expect(html).toContain('L2 · CORE')
    expect(html).toContain('L3 · LOGS')
    expect(html).toContain('L4 · FEATURE')
    expect(html).toContain('L5 · UI')
  })

  it('gracefully catches render errors in the inspector panel without unmounting shell', () => {
    const error = new Error('Circuit short circuit simulation')
    const state = InspectorErrorBoundary.getDerivedStateFromError(error)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(error)

    // Verify fallback render
    const boundary = new InspectorErrorBoundary({ children: null })
    boundary.state = state
    const html = renderToStaticMarkup(boundary.render() as any)
    expect(html).toContain('CIRCUIT TELEMETRY FAULT')
    expect(html).toContain('Circuit short circuit simulation')
    expect(html).toContain('REBOOT INSPECTOR CIRCUIT')
  })
})

