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
  /**
   * The capabilities the plugin's REAL manifest declares (audit W5) —
   * the same list the capability-grant ledger judged at activation.
   * Surfaced so the settings detail view can show what the installed
   * code actually asked for, not what a registry entry claims.
   */
  capabilities?: string[]
  /**
   * The plugin's registry entry is gone: a liveness check fetched the
   * registry index successfully and this id was not in it (audit W3).
   * The installed copy is quarantined until the entry returns or the
   * user uninstalls. Absent/false whenever liveness is unconfirmed —
   * an unreachable index never sets this.
   */
  delisted?: boolean
  /**
   * The registry has actively BANNED this id (audit W5): the index's
   * blocked channel carried it, with the registry's reason in this
   * field. Stronger than {@link delisted}: the copy is quarantined as
   * a security measure, installs/updates are refused outright, and
   * the flag lifts only when the id leaves the blocked list. The
   * reason string is registry-supplied and shown verbatim.
   */
  blocked?: string
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
  /**
   * The version the registry last reviewed for this entry (audit W4/W5).
   * When present, install plans default to exactly this version: newer
   * npm versions resolve only through an explicit, user-confirmed
   * unreviewed path. Absent means the entry carries no pin and version
   * resolution behaves as it always has.
   */
  reviewedVersion?: string
  /**
   * `sha512-<base64>` of the reviewed version's tarball, verified by
   * registry CI against npm. When the resolved version IS
   * {@link reviewedVersion}, the downloaded bytes must match this hash
   * in addition to the packument's own `dist.integrity` — the pin is an
   * independent anchor (registry repo) for the content, not a copy of
   * the mirror-served packument value.
   */
  reviewedIntegrity?: string
}

/**
 * One entry of the registry index's `blocked` channel (audit W4/W5):
 * an id the registry has actively banned (malware, impersonation),
 * as opposed to merely delisted (entry removed). Installed copies are
 * quarantined with the ban reason surfaced; the block lifts only when
 * the id leaves the blocked list.
 */
export interface RegistryBlockedEntry {
  id: string
  /** Human-readable reason from the registry (shown to the user). */
  reason: string
}

/** One npm package pinned to an exact version, ready to download. */
export interface NpmResolvedPackage {
  /** Registry entry id. */
  id: string
  npm: string
  version: string
  tarball: string
  integrity?: string
  /**
   * The registry entry's reviewed pin, when it has one (audit W5).
   * Carried on the plan node so the confirm screen can show whether
   * the user is getting the reviewed build or something newer.
   */
  reviewedVersion?: string
  /**
   * True when this node's resolved version is NEWER than the entry's
   * reviewed pin — only reachable when the caller explicitly named the
   * exact version (the UI gates that behind a second confirmation).
   */
  unreviewed?: boolean
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
  /** The registry entry's reviewed pin, when the entry carries one (audit W5). */
  reviewedVersion?: string
  /**
   * The newest REVIEWED version newer than the installed one — what a
   * default (unconfirmed) update installs. Absent when no reviewed
   * update exists (either the entry has no pin, or the pin is not
   * newer than the installed version).
   */
  reviewedUpdate?: string
  /**
   * True when npm's latest is newer than the reviewed pin: an
   * unreviewed newer build exists. Installing it requires the user's
   * explicit confirmation (it bypasses the registry's review).
   */
  unreviewed?: boolean
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
   * computed at install time. Legacy single-file view of {@link fileHashes}
   * (kept for records written before the full-package chain existed).
   */
  entrySha256?: string
  /**
   * Full-package tamper chain: sha256 of EVERY file in the installed
   * package, keyed by package-relative path. The boot-time loader compares
   * the whole on-disk directory against this map — a changed, missing, or
   * extra file in any position quarantines the plugin. A record with
   * neither this nor `entrySha256` has no integrity basis and is treated
   * as unverified (quarantined, visibly), never silently trusted.
   */
  fileHashes?: Record<string, string>
  /**
   * Liveness flag (audit W3): set when a successfully fetched registry
   * index no longer contains this id. Persisted so boot can quarantine
   * the plugin before any code runs; cleared when the id reappears in
   * the index. Never set on index fetch failure (offline stays open).
   */
  delisted?: boolean
  /**
   * Security ban (audit W5): the registry index's blocked channel
   * carried this id; the value is the registry's reason. Persisted so
   * boot quarantines the plugin before any code runs, exactly like
   * {@link delisted} but as a distinct, stronger state (installs and
   * updates are refused with BLOCKED while it stands). Cleared when
   * the id leaves the blocked list.
   */
  blocked?: string
  installedAt: string
}

/**
 * One service key with more than one installed provider (audit W5).
 * Non-critical keys are replaceable: the user picks which provider is
 * active and every other provider of that key is skipped at load
 * (Cordis refuses two registrations of one key in an isolate, so
 * co-providers must be arbitrated, not raced). Critical keys are
 * reported for visibility but their provider can never be switched.
 */
export interface ServiceProviderInfo {
  key: string
  critical: boolean
  /** Manifest ids of every known provider that can actually serve the key. */
  providers: string[]
  /** The provider currently in effect (the user's choice, else the default rule). */
  activeProvider?: string
}

export interface PluginManagerService {
  /** Returns the list of all known plugins with their merged runtime state and dependencies. */
  list(): readonly PluginInfo[]

  /** Updates user enablement preference, persists to store, and triggers lifecycle load/unload. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /**
   * Lists service keys that currently have more than one installed
   * provider, with the provider in effect for each (audit W5).
   * Optional: hosts without provider arbitration omit it.
   */
  listServiceProviders?(): ServiceProviderInfo[]
  /**
   * Chooses the active provider for a non-critical service key
   * (audit W5). The choice is persisted and honoured at boot; the
   * runtime switch is coordinated best-effort. Rejects for critical
   * keys and for ids that do not provide the key.
   */
  setServiceProvider?(key: string, providerId: string): Promise<void>

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
   *
   * When the caller already showed the user an {@link InstallPlan} (the
   * market confirm flow), it passes that plan back as `expectedPlan`:
   * execution re-resolves once and compares every pinned node
   * (id + npm + version + integrity) against it, refusing with a
   * `PLAN_CHANGED` error when upstream moved in between — the user only
   * ever gets what they confirmed. Without a plan the single internal
   * resolution is executed as-is, so no path resolves twice independently.
   */
  installPlugin(id: string, range?: string, expectedPlan?: InstallPlan): Promise<void>

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
