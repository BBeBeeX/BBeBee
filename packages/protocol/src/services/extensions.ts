/**
 * `ctx.extensions` — the M5 extension host.
 *
 * A third-party extension is *not* a plugin in the loader sense: its code runs
 * inside a `ctx.js` realm (QuickJS over WebAssembly, the same sandbox the
 * source runtime evaluates `@js:` rules in), and everything it can do is the
 * `ext` bridge the host installs into that realm. There is no ambient
 * `require`, no `fetch`, no filesystem, and no path from the realm to a host
 * object — which is also what keeps the host inside the app-store rules for
 * downloaded interpreted code (the sandbox is an interpreter the app ships,
 * and the interpreter's surface is an API this project defines).
 *
 * The bridge is the capability gate. A plugin loaded from a registry can
 * reach everything `ctx` has and needs the kernel loader's grant check; a
 * realm extension can reach *only* the bridge, so refusing an ungranted
 * operation at the bridge is not a second-best gate — it is the whole gate,
 * and there is nothing to reach around (capabilities.md §7's honesty note
 * does not apply here the way it does to the desktop dynamic loader).
 *
 * What an extension is made of: one manifest (`BBeBee.plugin.json`, the same
 * fifteen-field shape, `entry.main` pointing at a single self-contained
 * script) and that one script. The realm has no module system, so the script
 * must be a bundle — the same deal sources get, one file, no imports.
 *
 * See roadmap M5 and docs/plugins/loading.md.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { PlayRecord, QueueItem, TransportState } from '../entities/playback.js'
import type { PluginManifest } from '../manifest.js'

/**
 * The bridge version an extension sees as `ext.version`.
 *
 * Bump on any breaking change to the `ext` surface. Hosts refuse to activate
 * an extension whose manifest asks for a newer one; an extension written
 * against an older minor keeps working. This is the compatibility promise
 * that makes "publish an extension to the registry" mean something.
 */
export const EXTENSION_API_VERSION = 1

/**
 * The events an extension may subscribe to, and the payload each one
 * delivers into the handler. A *subset* of the canon
 * ([data-model/events.md](../data-model/events.md)) — deliberately small: an
 * extension is a scrobbler, a stats sink, a notifier, not a second player.
 *
 * Adding an event is a bridge-surface addition: it must survive the question
 * "what could a hostile extension do with this?" before it goes in.
 */
export interface ExtensionEventPayloads {
  /** A different track became current (or playback stopped, `undefined`). */
  'player/track-changed': { trackUrn: string | undefined; previous: string | undefined }
  'player/state-changed': { state: TransportState }
  /** The current track played to the end — the scrobbler's event. */
  'player/track-completed': { play: PlayRecord }
  'queue/changed': { items: readonly QueueItem[] }
}

export type ExtensionEventName = keyof ExtensionEventPayloads

/** The fixed allowlist, for hosts to validate against and tests to pin. */
export const EXTENSION_EVENTS: readonly ExtensionEventName[] = [
  'player/track-changed',
  'player/state-changed',
  'player/track-completed',
  'queue/changed',
]

/** What `ext.http.get` / `ext.http.post` resolve with. Body is text, always. */
export interface ExtensionHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/** Options the bridge accepts on an HTTP call. Headers only — no cookies, no jars. */
export interface ExtensionHttpOptions {
  headers?: Record<string, string>
}

/**
 * The `ext` object an extension's code sees — assembled realm-side by the
 * host's prelude out of the host functions the realm exposes. Documented
 * here because this is the author-facing surface; it is a contract, not a
 * host-side object (nothing crosses the boundary as a live reference).
 *
 * Every async member may reject with a `CapabilityError`-shaped error when
 * the extension's declared capabilities do not cover the call.
 */
export interface ExtensionBridge {
  /** See {@link EXTENSION_API_VERSION}. */
  readonly version: number
  /** This extension's manifest id. */
  readonly id: string
  log(message: string): void
  http: {
    /**
     * GET `url`. The host checks the URL's hostname against the extension's
     * declared `net:host/<glob>` capabilities before anything is sent.
     */
    get(url: string, options?: ExtensionHttpOptions): Promise<ExtensionHttpResponse>
    post(url: string, body: string, options?: ExtensionHttpOptions): Promise<ExtensionHttpResponse>
  }
  /** Namespaced, string-valued, persistent. `ext:storage:<id>` under `ctx.store`. */
  storage: {
    get(key: string): Promise<string | undefined>
    put(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  /** Subscribe to an allowlisted canon event. Unknown names throw at subscribe time. */
  on<E extends ExtensionEventName>(
    event: E,
    handler: (payload: ExtensionEventPayloads[E]) => void | Promise<void>,
  ): void
}

/** One installed extension, as `ctx.extensions.list()` reports it. */
export interface ExtensionRecord {
  id: string
  version: string
  displayName: string
  /** The capabilities the manifest declared at install. The bridge enforces them. */
  capabilities: readonly string[]
  installedAt: number
  /**
   * Consecutive *load* failures. A handler that throws at runtime does not
   * count — only code that cannot even start does. Reset by a load that
   * succeeds.
   */
  failures: number
  /**
   * True after two consecutive load failures (M5's exit criterion). A
   * quarantined extension is not loaded at boot and `activate` refuses with
   * {@link ExtensionQuarantinedError}; only an explicit reinstall clears it.
   */
  quarantined: boolean
  /** True while the extension has a live realm. */
  active: boolean
}

/** What `install` takes: the manifest plus the extension's whole code. */
export interface ExtensionInstallInput {
  /**
   * The packaged `BBeBee.plugin.json`. `id` must not sit under the `@bbebee/`
   * scope (anti-spoofing — a first-party id would shadow the built-in set in
   * user-facing lists), and `capabilities` is the egress surface the bridge
   * will enforce.
   */
  manifest: PluginManifest
  /** The single self-contained script `entry.main` names. No module system exists. */
  main: string
}

export interface ExtensionsService {
  list(): Promise<ExtensionRecord[]>
  /**
   * Write the extension's files under the host's data directory and activate
   * it. Activation failures here are *reported*, not thrown away: the
   * failure counter increments exactly as a boot-time failure would, so a
   * broken-but-installed extension heads for quarantine on the same path.
   */
  install(input: ExtensionInstallInput): Promise<ExtensionRecord>
  /** Create the realm, evaluate prelude + main, subscribe to the allowlisted events. */
  activate(id: string): Promise<void>
  /**
   * Dispose the realm and unsubscribe. Idempotent. Synchronous on purpose —
   * `JsRealm.dispose()` is sync (the contract's own teardown rule), and
   * uninstall's "dispose before any file is removed" ordering should not
   * depend on a promise settling.
   */
  deactivate(id: string): void
  /**
   * Deactivate (fiber-safe: the realm is disposed before any file is
   * removed), delete the files, delete the record. Storage under
   * `ext:storage:<id>` is dropped too unless `keepData` is set.
   */
  uninstall(id: string, opts?: { keepData?: boolean }): Promise<void>
}

export class ExtensionError extends Error {
  // `name` is deliberately not declared here — a readonly literal on the base
  // would narrow the property's type and forbid the subclasses' own literals
  // (the `SourceError` family does the same).
}

export class ExtensionNotFoundError extends ExtensionError {
  override readonly name = 'ExtensionNotFoundError'
  constructor(readonly id: string) {
    super(`no extension named ${id} is installed`)
  }
}

export class ExtensionQuarantinedError extends ExtensionError {
  override readonly name = 'ExtensionQuarantinedError'
  constructor(readonly id: string) {
    super(`extension ${id} is quarantined after repeated load failures`)
  }
}

declare module 'cordis' {
  interface Context {
    extensions: ExtensionsService
  }
}
