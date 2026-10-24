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
  /**
   * The installed version carries an npm provenance attestation whose
   * source repository matches the registry entry's `repo` (audit W6).
   * Verified at install time against the registry's attestation record
   * and persisted on the install record; absent whenever the version
   * has no attestation (the pilot does not require one) or the check
   * could not run. A MISMATCHED attestation never reaches this field —
   * it refuses the install as spoofing.
   */
  provenanceVerified?: boolean
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
  /**
   * Canonical npm package address derived from `npm`
   * (`https://registry.npmjs.org/<encoded name>`). Neither versioned
   * nor hashed — it addresses the package, not a release. Normally
   * downloads resolve through the effective registry; when that
   * download proves ineffective, the client falls back to this
   * address for the plan's exact version.
   */
  npmUrl?: string
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
  /**
   * How this copy arrived: `'npm'` (the registry pipeline — also the
   * implicit value of records written before this field existed) or
   * `'local'` (a package file the user imported from disk via
   * `installLocalPlugin`). Local records are exempt from the registry
   * liveness (delisted) check — a sideloaded plugin is not expected in
   * the index — and from npm update checks; the registry's blocked
   * (ban) channel still applies to them.
   */
  source?: 'npm' | 'local'
  /** SHA-256 of the whole downloaded tarball. */
  sha256?: string
  /**
   * @deprecated The boot-time tamper chain was removed 2026-10-24.
   * Kept only so records written before the removal still parse; the
   * loader ignores both fields. New records carry neither.
   *
   * Was: SHA-256 of the entry main file's content, the legacy
   * single-file view of {@link fileHashes}.
   */
  entrySha256?: string
  /**
   * @deprecated See {@link entrySha256}. Was the full-package tamper
   * chain: sha256 of EVERY file in the installed package, compared by
   * the boot-time loader against the on-disk directory.
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
  /**
   * npm provenance (audit W6): the installed version's provenance
   * attestation named this entry's `repo` as its source repository.
   * Set only on a positive match at install/update time; an install
   * whose attestation names a DIFFERENT repository is refused, and a
   * version without any attestation simply leaves this unset.
   */
  provenanceVerified?: boolean
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

/**
 * What `previewLocalPlugin` reports about a plugin package file the user
 * picked on disk, before anything is installed: the identity the package
 * claims for itself (its own `package.json` + `BBeBee.plugin.json` — a
 * local package has no registry entry to vouch for it), the capabilities
 * its real manifest declares (what the confirm screen must show, since
 * confirming is what grants them), and the checks that already ran to
 * produce this preview (bounded extraction, full security scan, manifest
 * re-checks). A package that fails any of those never reaches a preview —
 * the call throws instead.
 */
export interface LocalPluginPreview {
  /** Plugin id from the package's own manifest. */
  id: string
  /** npm package name from the package's own `package.json`. */
  npm: string
  displayName?: string
  description?: string
  version: string
  author?: string
  /** Capability grants the manifest declares; confirming the install records them. */
  capabilities: string[]
  /** Number of files in the package. */
  fileCount: number
  /** SHA-256 of the raw package file, as it will be pinned in the install record. */
  sha256: string
  /** Version of this id already installed, when the import would replace it. */
  installedVersion?: string
  /** Non-fatal notes (unreviewed origin, unknown manifest dependencies, peer mismatches). */
  warnings: string[]
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
   * Inspects a local plugin package file (an npm `.tgz`, base64-encoded)
   * without installing it: bounded extraction, full security scan and
   * the packaged-manifest re-checks, with the package's own documents as
   * the identity anchor. Throws a descriptive error on any failure, so a
   * returned preview is a package that WOULD pass the install checklist.
   */
  previewLocalPlugin?(packageBase64: string): Promise<LocalPluginPreview>

  /**
   * Installs a local plugin package file (an npm `.tgz`, base64-encoded)
   * through the same non-bypassable pipeline as an npm install —
   * bounded extraction → full security scan → real-manifest re-check →
   * capability grant → atomic write/activation → full-file tamper chain.
   * The identity anchor is the package itself, so the registry-only
   * anchors (reviewed pin, provenance, index liveness) do not apply; the
   * registry's ban channel still refuses a banned id. Requires
   * `confirmed: true` — the caller must first show the user the
   * {@link LocalPluginPreview} (identity, capabilities, unreviewed
   * origin). Re-importing an installed id replaces it in place.
   * The install record is persisted with `source: 'local'`.
   */
  installLocalPlugin?(packageBase64: string, opts?: { confirmed?: boolean }): Promise<LocalPluginPreview>

  /**
   * Checks every npm-installed plugin against its registry for a newer
   * version. Packuments are re-fetched (short TTL); also updates the
   * last-check timestamp used by the automatic daily check. `force`
   * bypasses the packument cache for an immediate answer.
   */
  checkUpdates(force?: boolean): Promise<PluginUpdateInfo[]>

  /**
   * The npm `dist-tags.latest` version of one package, for display on the
   * Discover page (a plugin card's title version, and the "latest version"
   * badge of an installed plugin with an update). Packuments are cached by
   * the npm client, so repeated calls for the visible cards are cheap.
   * Never throws: a failed lookup degrades to `undefined` and the caller
   * renders without a version rather than breaking the page.
   */
  getNpmLatest?(npmName: string): Promise<string | undefined>

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
