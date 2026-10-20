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
  uninstallPlugin?: (id: string) => Promise<void>
  /**
   * Writes plugin files and activates the plugin (desktop dynamic loader).
   * Absent on platforms without dynamic plugin installation (mobile): the
   * composition root only wires it where the host supports it.
   */
  installPlugin?: (id: string, files: Record<string, string>, manifest: PluginManifest) => Promise<unknown>
}

/**
 * One plugin entry of the community registry's `plugins/index.json`
 * (schema v2).
 *
 * Deliberately has **no `version`**: the version truth lives on npm (the
 * packument) and inside the plugin package itself (`package.json` /
 * `BBeBee.plugin.json`). `services` names the cordis service keys the plugin
 * must inject — it is unrelated to `PluginManifest.capabilities`, which is
 * the kernel's security-gate grammar (`fs:`/`net:`/`db:`…).
 */
export interface RegistryPluginEntry {
  id: string
  name: string
  repo: string
  /** npm package name to download, e.g. `@alice/bbebee-plugin-x`. */
  npm: string
  author: string
  description: string
  /** Required cordis service keys the plugin injects (non-empty). */
  services: string[]
  /**
   * Cordis service keys this plugin provides to other plugins, as
   * declared in the registry entry (schema v2). The install plan counts
   * a closure member's declared `provides` toward service availability;
   * the downloaded package's own manifest (`contributes.services`) is
   * the ground truth re-verified at install time.
   */
  provides?: string[]
  /** Supported platforms: `'desktop'` / `'mobile'`. */
  platforms: string[]
  category: string
  /**
   * Plugin dependencies, each `"<registry-id>"` or
   * `"<registry-id>@<semver-range>"` (e.g. `"bob-dsp-pack@^2.0.0"`).
   */
  dependencies: string[]
  compositors: string[]
  i18n?: string[]
  minAppVersion?: string
  screenshot?: string
  homepage?: string
  engines?: { BBeBee?: string; [key: string]: string | undefined }
}

/** One npm package pinned to an exact version, ready to download. */
export interface NpmResolvedPackage {
  /** Registry entry id. */
  id: string
  npm: string
  version: string
  tarball: string
  integrity?: string
}

/** The result of `resolveInstallPlan`: everything install needs, pre-download. */
export interface InstallPlan {
  target: NpmResolvedPackage
  /** Transitive dependency closure (excluding the target), in install order. */
  closure: NpmResolvedPackage[]
  /**
   * Required service keys not available on this installation. Non-empty means
   * the install would be refused; installPlugin throws instead of proceeding.
   */
  missingServices: string[]
  /** Non-fatal notes (e.g. missing integrity hash, unknown app version). */
  warnings: string[]
}

export interface PluginUpdateInfo {
  id: string
  installed: string
  latest: string
  /** npm package the update comes from. */
  npm: string
}

/** Local record of one npm-installed plugin (persisted in `ctx.store`). */
export interface InstalledNpmPluginRecord {
  id: string
  npm: string
  version: string
  /** SHA-256 of the whole downloaded tarball. */
  sha256?: string
  /**
   * SHA-256 of the entry main file's content (`manifest.entry.main`),
   * computed at install time. This is the tamper-check basis the boot-time
   * dynamic loader compares against (it hashes the on-disk entry file), so
   * boot merges this value into the loader's lock map — the tarball `sha256`
   * above covers different bytes and cannot serve that check.
   */
  entrySha256?: string
  installedAt: string
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

  /**
   * Reports the host-shared module versions (npm package name → version
   * actually loaded by the shell, e.g. `{ react: '19.2.3' }`), called by
   * the composition root on platforms with host-module sharing (desktop).
   * Install plans check plugin `peerDependencies` against these versions
   * and warn — never block — on a mismatch. Absent/unwired means no peer
   * checks (mobile has no host-module sharing).
   */
  setHostVersions?(versions: Record<string, string>): void

  /** Re-evaluates runtime state from inspector snapshot and returns updated list. */
  refresh(): readonly PluginInfo[]

  /**
   * Uninstalls an external plugin: unloads it, deletes files via bridge, removes manifest and overrides.
   * Refuses (throws, naming the dependents) when other installed plugins depend on it.
   * User data (store namespaces, tables) is kept — data cleanup is a follow-up.
   */
  uninstall?(id: string): Promise<void>

  /**
   * Fetches the community registry plugin index (raw file fetch, 24h store
   * cache), filtered to the current platform. Throws a descriptive error when
   * the index cannot be reached. `force` bypasses the index cache (the
   * market UI's refresh button) so a newly published entry shows up without
   * waiting out the TTL.
   */
  browseRegistry(force?: boolean): Promise<RegistryPluginEntry[]>

  /**
   * Resolves exact npm versions for a plugin and its transitive dependency
   * closure, plus service availability — without downloading anything.
   * `range` is an npm semver range; omitted means the registry's latest.
   */
  resolveInstallPlan(id: string, range?: string): Promise<InstallPlan>

  /**
   * Full install: resolve → download → verify → write via the lifecycle
   * bridge → activate → persist the lock record. Throws on any D8 checklist
   * failure (missing services, unresolvable/conflicting dependencies,
   * version/app/platform mismatch, security block, anti-spoofing mismatch,
   * size/timeout). Requires the composition root to wire
   * `PluginLifecycleBridge.installPlugin` (desktop only).
   */
  installPlugin(id: string, range?: string): Promise<void>

  /**
   * Checks every npm-installed plugin against its registry for a newer
   * version. Packuments are re-fetched (short TTL); also updates the
   * last-check timestamp used by the automatic daily check. `force`
   * bypasses the packument cache for an immediate answer.
   */
  checkUpdates(force?: boolean): Promise<PluginUpdateInfo[]>

  /**
   * Updates one plugin to the newest version satisfying `range`
   * (default `^<installed>`). A major-version bump without an explicit range
   * throws a `MAJOR_UPDATE_NEEDS_CONFIRM` error so the UI can ask first.
   * On activation failure every replaced node of the closure is rolled back
   * to its previous version (files and lock records restored, best-effort).
   */
  updatePlugin(id: string, range?: string): Promise<void>

  /**
   * Stores the npm registry auth token in `ctx.secrets` (never in the store
   * or logs). Used as `Authorization: Bearer` against the configured npm
   * registry host. Called by the settings UI.
   */
  setNpmAuthToken(token: string): Promise<void>

  /** Removes the stored npm registry auth token. */
  clearNpmAuthToken(): Promise<void>

  /**
   * Whether an npm registry auth token is currently stored in `ctx.secrets`.
   * Used by the settings UI to render the token state without ever reading
   * the token value itself.
   */
  hasNpmAuthToken(): Promise<boolean>
}

declare module 'cordis' {
  interface Context {
    'plugin-manager': PluginManagerService
  }
}
