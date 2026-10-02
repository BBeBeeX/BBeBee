/**
 * `ctx.ui` — the contribution registry.
 *
 * Plugins register renderer-agnostic **descriptors**; each shell resolves them
 * against its own component set. This is the whole of what makes one headless
 * plugin serve a React Native shell and a React DOM shell.
 *
 * The registry itself is deliberately dumb: it stores, orders, and hands back.
 * Every decision about how a contribution *looks* belongs to a shell.
 *
 * See docs/08-ui-architecture.md §2.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
// Pulls the service augmentations (`ctx.db`, `ctx.ui`, …) into this program.
// Without it a consumer compiling this package in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import type {
  CommandContribution,
  Contribution,
  Disposable,
  MenuContribution,
  RouteContribution,
  SettingsContribution,
  SlotContribution,
  SlotId,
  TrayContribution,
  UiService,
} from '@BBeBee/protocol'

/** Stable ordering: by `order`, then by insertion, never by object identity. */
function byOrder<T extends { order?: number }>(items: readonly [number, T][]): T[] {
  return [...items]
    .sort(([aSeq, a], [bSeq, b]) => (a.order ?? 0) - (b.order ?? 0) || aSeq - bSeq)
    .map(([, item]) => item)
}

export class Ui extends Service implements UiService {
  private seq = 0
  private readonly contributions = new Map<number, Contribution>()
  private readonly views = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  /**
   * Register a contribution.
   *
   * Returns a disposer, so a plugin that unloads takes its contributions with
   * it and the shell simply stops seeing them — no invalidation protocol.
   */
  contribute(contribution: Contribution): Disposable {
    const key = this.seq++
    this.contributions.set(key, contribution)
    this.ctx.logger.debug(`ui: contribute ${contribution.id} (${contribution.kind})`)
    this.ctx.emit('ui/changed')
    return () => {
      if (this.contributions.delete(key)) this.ctx.emit('ui/changed')
    }
  }

  /**
   * Bind a view id to a component.
   *
   * `component` is `unknown` because `@BBeBee/protocol` must not depend on any
   * React flavour; each shell casts once, at its own boundary.
   */
  registerView(id: string, component: unknown): Disposable {
    if (this.views.has(id)) {
      // Two packages claiming one id means the shell would render whichever
      // loaded last — a coin flip, and a miserable thing to debug.
      this.ctx.logger.warn(`ui: view "${id}" is already registered; ignoring the duplicate`)
      return () => {}
    }
    this.views.set(id, component)
    this.ctx.logger.debug(`ui: register view "${id}"`)
    this.ctx.emit('ui/changed')
    return () => {
      if (this.views.delete(id)) this.ctx.emit('ui/changed')
    }
  }

  navigate(id: string, params?: Record<string, unknown>): void {
    this.ctx.logger.info(`ui: navigate to "${id}"`)
    this.ctx.emit('ui/navigate', id, params)
  }

  private of<K extends Contribution['kind'], T extends Contribution>(kind: K): T[] {
    const matches: [number, T][] = []
    for (const [key, c] of this.contributions) {
      if (c.kind === kind) matches.push([key, c as unknown as T])
    }
    return byOrder(matches as readonly [number, T & { order?: number }][]) as T[]
  }

  get routes(): readonly RouteContribution[] {
    return this.of<'route', RouteContribution>('route')
  }

  get commands(): readonly CommandContribution[] {
    return this.of<'command', CommandContribution>('command')
  }

  get menus(): readonly MenuContribution[] {
    return this.of<'menu', MenuContribution>('menu')
  }

  get settings(): readonly SettingsContribution[] {
    return this.of<'settings', SettingsContribution>('settings')
  }

  get tray(): readonly TrayContribution[] {
    const items: [number, TrayContribution][] = []
    const seen = new Set<string>()

    // Explicit tray contributions
    for (const [key, c] of this.contributions) {
      if (c.kind === 'tray') {
        items.push([key, c as TrayContribution])
        seen.add(c.id)
      }
    }

    // Route contributions opting into tray placement
    for (const [key, c] of this.contributions) {
      if (c.kind === 'route' && c.placement?.includes('tray') && !seen.has(c.id)) {
        items.push([
          key,
          {
            kind: 'tray',
            id: c.id,
            title: c.title,
            icon: c.icon,
            targetRoute: c.id,
            order: c.order,
          },
        ])
        seen.add(c.id)
      }
    }

    return byOrder(items)
  }

  slotsFor(slot: SlotId): readonly SlotContribution[] {
    return this.of<'slot', SlotContribution>('slot').filter((s) => s.slot === slot)
  }

  async runCommand(id: string, args?: unknown): Promise<void> {
    this.ctx.logger.info(`ui: run command "${id}"`)
    const command = this.commands.find((c) => c.id === id)
    if (!command) throw new Error(`ui: no such command "${id}"`)
    await command.run(args)
  }

  /**
   * The component bound to an id, or `undefined`.
   *
   * Undefined is a normal state, not an error: a plugin may ship a desktop
   * view and no mobile one. Shells render nothing rather than breaking —
   * a direct, ongoing cost of ADR-2 (docs/08 §3).
   */
  viewFor(id: string): unknown | undefined {
    return this.views.get(id)
  }

  /** Which contributed ids have no view on this target. Drives diagnostics. */
  missingViews(): string[] {
    const needed = new Set<string>()
    for (const c of this.contributions.values()) {
      if (c.kind === 'route' || c.kind === 'slot' || c.kind === 'settings') needed.add(c.id)
    }
    return [...needed].filter((id) => !this.views.has(id)).sort()
  }
}

declare module 'cordis' {
  interface Events {
    /** Any contribution or view registration changed. Shells re-read. */
    'ui/changed'(): void
  }
}

export const name = 'plugin-ui'

/**
 * Awaited deliberately.
 *
 * A wrapper that fires `ctx.plugin()` without awaiting resolves immediately,
 * so `await ctx.plugin(thisPlugin)` tells a caller nothing about whether the
 * service inside is ready — its async `Service.init` may still be running.
 * Awaiting propagates readiness to whoever loaded us.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-ui: loaded')
  const fiber = await ctx.plugin(Ui)
  return () => void fiber.dispose()
}

export default { name, apply }
