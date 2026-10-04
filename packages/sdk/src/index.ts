/**
 * @BBeBee/sdk — The official Plugin Development Kit for BBeBee.
 *
 * This SDK provides the complete surface for authoring third-party BBeBee plugins:
 * - Cordis plugin lifecycle primitives (Context, Service, Inject, FiberState).
 * - Protocol contracts (all services, entities, typed events, manifest types).
 * - Pure toolkit helpers for common tasks.
 * - Plugin definition and typing utilities.
 *
 * Per docs/02-architecture.md:
 * - Plugins interact with the system strictly through `ctx.*` services.
 * - Plugins never import platform SDKs directly.
 * - Plugins never drive the kernel bootstrap (createApp, migrations, gate).
 */

import type { Context } from '@BBeBee/kernel'

// ── 1. The Pinned Cordis Plugin Surface (Layer 1) ───────────────────────────
export {
  Context,
  Service,
  Inject,
  FiberState,
  fiberStateName,
  isActive,
  isSettled,
} from '@BBeBee/kernel'

export type {
  Plugin,
  Fiber,
  Effect,
  EffectMeta,
  InjectSpec,
  FiberStateName,
  FiberStateValue,
} from '@BBeBee/kernel'

// ── 2. Protocol Contracts, Entities, Events & Manifests (Layer 0) ───────────
export * from '@BBeBee/protocol'

// ── 3. Toolkit Pure Helpers ─────────────────────────────────────────────────
export * as toolkit from '@BBeBee/toolkit'

// ── 4. Plugin Authoring Helpers ──────────────────────────────────────────────

/**
 * Standard Disposer signature returned by plugin entry points.
 * When a plugin unloads or reloads, this cleanup function is called.
 */
export type PluginDisposer = () => unknown

/**
 * Standard function-style plugin signature for BBeBee plugins.
 */
export type PluginApply<Config = void> = (
  ctx: Context,
  config: Config,
) => void | PluginDisposer | Promise<void | PluginDisposer>

/**
 * Shape of a function-based BBeBee plugin module.
 */
export interface PluginModule<Config = void> {
  name: string
  inject?: readonly string[]
  apply: PluginApply<Config>
}

/**
 * Type helper for authoring a function-based BBeBee plugin with full autocompletion.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@BBeBee/sdk'
 *
 * export default definePlugin({
 *   name: 'my-plugin',
 *   inject: ['player'],
 *   async apply(ctx) {
 *     const off = ctx.on('player/track-changed', (track) => {
 *       ctx.logger?.info(`Now playing: ${track?.title}`)
 *     })
 *     return () => off()
 *   },
 * })
 * ```
 */
export function definePlugin<Config = void>(plugin: PluginModule<Config>): PluginModule<Config> {
  return plugin
}
