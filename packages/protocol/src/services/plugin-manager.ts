/**
 * `ctx['plugin-manager']` — plugin discovery, inspection, and lifecycle management.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PluginManifest } from '../manifest.js'

export type ConfigStatus = 'none' | 'customized' | 'default'

export type PluginRuntimeState =
  | 'PENDING'
  | 'LOADING'
  | 'ACTIVE'
  | 'FAILED'
  | 'DISPOSED'
  | 'UNLOADING'
  | 'UNLOADED'
  | 'UNKNOWN'

export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description?: string
  version: string
  author?: string
  systemId: 'layer-2' | 'layer-3' | 'layer-4' | 'layer-5' | string
  moduleId?: string
  enabled: boolean
  state: PluginRuntimeState
  error?: string
  waitingFor: string[]
  dependencies: string[]
  dependents: string[]
  configStatus?: ConfigStatus
}

export interface PluginLifecycleBridge {
  loadPlugin: (id: string) => Promise<unknown>
  unloadPlugin: (id: string) => Promise<void>
}

export interface PluginManagerService {
  /** Returns the list of all known plugins with their merged runtime state and dependencies. */
  list(): readonly PluginInfo[]

  /** Updates user enablement preference, persists to store, and triggers lifecycle load/unload. */
  setEnabled(id: string, enabled: boolean): Promise<void>

  /** Registers plugin manifests into the service. */
  registerManifests(manifests: Record<string, PluginManifest>): void

  /** Sets the bridge callbacks for loading and unloading plugins (called by composition root). */
  setLifecycleBridge(bridge: PluginLifecycleBridge): void

  /** Re-evaluates runtime state from inspector snapshot and returns updated list. */
  refresh(): readonly PluginInfo[]
}

declare module 'cordis' {
  interface Context {
    'plugin-manager': PluginManagerService
  }
}
