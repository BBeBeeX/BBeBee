/**
 * Application bootstrap.
 *
 * The one place the two shells differ is `bootstrap` — the list of core
 * service plugins for the target. Everything after that is identical on
 * mobile and desktop, which is the whole point.
 *
 * See docs/02-architecture.md §3.
 */

import { Context, type Fiber, type Plugin } from 'cordis'
import { FiberState } from '../fiber-state.js'
import { resolveConfig, type AppConfig, type ResolvedPlugin } from '../config/config.js'
import {
  loadPlugins,
  type LoadOptions,
  type LoadedPlugin,
  type PluginRegistry,
  type RegistryEntry,
} from '../loader/loader.js'

export type Target = 'ios' | 'android' | 'desktop'

export class BootstrapError extends Error {
  override readonly name = 'BootstrapError'
  constructor(
    readonly pluginIndex: number,
    override readonly cause: unknown,
  ) {
    super(`bootstrap entry #${pluginIndex} failed to start: ${String(cause)}`)
  }
}

/**
 * One bootstrap plugin — a core service or a log transport — optionally with
 * its configuration.
 *
 * The tuple form matters: without it a shell has to wrap a configured service
 * in `(ctx) => void ctx.plugin(Svc, config)`, and that wrapper *returns
 * immediately* — so `start()` awaits the wrapper rather than the service, and
 * feature plugins begin loading against services that do not exist yet. They
 * then sit in PENDING forever, with nothing obviously wrong anywhere.
 */
export type BootstrapEntry = Plugin | readonly [plugin: Plugin, config: unknown]

export interface AppOptions {
  target: Target
  /**
   * What comes up before the registry, in order: this target's core services —
   * `core-fs-expo` or `core-fs-node`, and so on — followed by the logs layer.
   *
   * Applied before any feature plugin, and never capability-gated: the core
   * services *are* the thing being gated, and a transport that had to be
   * granted a capability before it could record anything would be unable to
   * report being refused one.
   */
  bootstrap: BootstrapEntry[]
  /** Statically bundled feature plugins, keyed by package id. */
  registry?: PluginRegistry
  /** Already parsed by the shell — the kernel does not depend on a parser. */
  config?: AppConfig
  load?: LoadOptions
  /**
   * How long `start()` waits for in-flight plugin initialisation to finish.
   * 0 skips the wait. See `settleGraph`.
   */
  settleTimeoutMs?: number
  /**
   * How long each disposer gets during `stop()` before teardown moves on.
   * 0 waits indefinitely. See `safeDispose`.
   */
  disposeTimeoutMs?: number
}

/** Every fiber Cordis currently knows about. */
function allFibers(ctx: Context): Fiber[] {
  const out: Fiber[] = []
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) out.push(fiber)
  }
  return out
}

/**
 * Wait until no fiber is mid-initialisation.
 *
 * Only `LOADING` blocks: a fiber resting in `PENDING` is waiting on a service
 * that may never arrive, which is a legitimate steady state the loader already
 * reports. Returns the names of anything still loading when the deadline
 * passes, so a hang is diagnosable rather than silent.
 */
async function settleGraph(ctx: Context, timeoutMs: number): Promise<string[]> {
  if (timeoutMs <= 0) return []
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const loading = allFibers(ctx).filter((f) => f.state === FiberState.LOADING)
    if (loading.length === 0) return []
    if (Date.now() >= deadline) return loading.map((f) => f.name)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export interface App {
  readonly ctx: Context
  readonly target: Target
  /** Populated once `start()` resolves. A copy; mutating it does nothing. */
  readonly plugins: readonly LoadedPlugin[]
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Wait until every named service exists. Shells mount their UI on this.
   * Never settles if a service never arrives — pass `timeoutMs` to surface
   * that as an error instead of a hang.
   */
  ready(services: string[], opts?: { timeoutMs?: number }): Promise<Context>
  /**
   * Dynamically register a plugin into the app's registry.
   */
  registerPlugin(pluginId: string, entry: RegistryEntry): void
  /**
   * Dynamically load and activate a plugin after start.
   */
  loadPlugin(pluginId: string, config?: unknown): Promise<LoadedPlugin>
  /**
   * Dynamically unload an active plugin and dispose its fiber.
   */
  unloadPlugin(pluginId: string): Promise<void>
}

export function createApp(options: AppOptions): App {
  const ctx = new Context()
  const registry: PluginRegistry = { ...(options.registry ?? {}) }
  const loaded: LoadedPlugin[] = []
  const bootstrapDisposers: (() => Promise<void>)[] = []
  let started = false

  /**
   * Run a disposer without letting one plugin hold up the rest of teardown.
   *
   * Bounded as well as guarded: Cordis's dispose awaits the fiber's in-flight
   * work, so a plugin whose `Service.init` never resolves can never be
   * disposed — and an unbounded await there hangs shutdown forever on one bad
   * plugin. Both failures are reported and stepped over.
   */
  async function safeDispose(dispose: () => Promise<void>, label: string): Promise<void> {
    const timeoutMs = options.disposeTimeoutMs ?? 5_000
    try {
      if (timeoutMs <= 0) {
        await dispose()
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = Symbol('timeout')
      const result = await Promise.race([
        dispose().then(() => undefined),
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), timeoutMs)
        }),
      ])
      if (timer) clearTimeout(timer)
      if (result === timedOut) {
        ctx.logger.warn(
          `dispose of ${label} did not finish within ${timeoutMs}ms; continuing teardown`,
        )
      }
    } catch (error) {
      ctx.logger.error(`failed to dispose ${label}: ${String(error)}`)
    }
  }

  async function unwindBootstrap(): Promise<void> {
    for (const dispose of bootstrapDisposers.reverse()) {
      await safeDispose(dispose, 'core service')
    }
    bootstrapDisposers.length = 0
  }

  return {
    ctx,
    target: options.target,
    get plugins() {
      // A copy: `stop()` clears the internal array, and an external holder
      // should not observe that mutation.
      return [...loaded]
    },

    async start() {
      if (started) throw new Error('app already started')
      started = true

      // Core services first, ungated, and awaited: a feature plugin whose
      // `inject` names a service that never arrives sits in PENDING forever,
      // which is a much worse symptom than a failure here.
      //
      // Unlike feature plugins, a failing core service IS fatal — nothing
      // works without `fs` or `db`. But it must fail cleanly: unwind whatever
      // did start, reset `started` so the shell can retry, and log before
      // rethrowing so the error scene is not lost.
      for (const [index, entry] of options.bootstrap.entries()) {
        const [plugin, config] = Array.isArray(entry)
          ? (entry as readonly [Plugin, unknown])
          : ([entry as Plugin, undefined] as const)
        try {
          // Awaited, so the next core service — and every feature plugin —
          // starts against one that is genuinely ACTIVE.
          const fiber = await ctx.plugin(plugin, config as never)
          bootstrapDisposers.push(() => fiber.dispose())
        } catch (cause) {
          const error = new BootstrapError(index, cause)
          ctx.logger.error(error.message)
          await unwindBootstrap()
          started = false
          throw error
        }
      }

      const plugins: ResolvedPlugin[] = options.config ? resolveConfig(options.config) : []

      const results = await loadPlugins(
        ctx,
        registry,
        plugins,
        options.load ?? {},
      )
      loaded.push(...results)

      // Wait for the graph to stop moving before declaring the app started.
      //
      // `await ctx.plugin(p)` resolves when *that* fiber's apply returns — not
      // when work it spawned has finished. A plugin whose `apply` starts a
      // child (`ctx.plugin(Service)`) without awaiting therefore reports ready
      // while its service is still initialising, and whatever loads next races
      // it. Settling here makes that authoring mistake harmless instead of an
      // intermittent, order-dependent failure.
      const stillLoading = await settleGraph(ctx, options.settleTimeoutMs ?? 10_000)
      if (stillLoading.length) {
        ctx.logger.warn(
          `app: still initialising after start: ${stillLoading.join(', ')} — ` +
            'a plugin is probably awaiting something that never arrives',
        )
      }
    },

    async stop() {
      // Reverse order: feature plugins release their handles on core services
      // before those services go away.
      for (const p of [...loaded].reverse()) {
        if (p.dispose) await safeDispose(p.dispose, p.pluginId)
      }
      loaded.length = 0
      await unwindBootstrap()
      started = false
    },

    ready(services, opts) {
      return new Promise<Context>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        if (opts?.timeoutMs !== undefined) {
          timer = setTimeout(() => {
            const missing = services.filter(
              (s) => (ctx as unknown as Record<string, unknown>)[s] === undefined,
            )
            reject(
              new Error(
                `ready() timed out after ${opts.timeoutMs}ms waiting for: ${missing.join(', ')}`,
              ),
            )
          }, opts.timeoutMs)
        }

        // `ctx.inject` returns a Fiber & PromiseLike — PromiseLike has `then`
        // but no `catch`, so the rejection handler goes in the second slot.
        ctx
          .inject(services, (scoped) => {
            if (timer) clearTimeout(timer)
            resolve(scoped)
          })
          .then(undefined, (error: unknown) => {
            if (timer) clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })
    },

    registerPlugin(pluginId, entry) {
      registry[pluginId] = entry
    },

    async loadPlugin(pluginId, config) {
      if (!started) throw new Error('cannot load plugin before app is started')
      const existing = loaded.find((p) => p.pluginId === pluginId)
      if (existing && existing.state === 'active') {
        return existing
      }
      const inst: ResolvedPlugin = {
        pluginId,
        config: (config as Record<string, unknown> | undefined) ?? {},
      }
      const [result] = await loadPlugins(
        ctx,
        registry,
        [inst],
        options.load ?? {},
      )
      if (result) {
        const idx = loaded.findIndex((p) => p.pluginId === pluginId)
        if (idx >= 0) {
          loaded[idx] = result
        } else {
          loaded.push(result)
        }
        if (result.state === 'active') {
          await settleGraph(ctx, options.settleTimeoutMs ?? 5_000)
        }
        return result
      }
      throw new Error(`failed to load plugin ${pluginId}`)
    },

    async unloadPlugin(pluginId) {
      if (!started) throw new Error('cannot unload plugin before app is started')
      const idx = loaded.findIndex((p) => p.pluginId === pluginId)
      if (idx >= 0) {
        const p = loaded[idx]!
        if (p.dispose) {
          await safeDispose(p.dispose, p.pluginId)
        }
        loaded.splice(idx, 1)
      }
    },
  }
}
