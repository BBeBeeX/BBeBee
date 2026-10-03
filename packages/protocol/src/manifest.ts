/**
 * `BBeBee.plugin.json` — the manifest, and the capability grammar.
 *
 * One format, one loader: plugins are statically bundled on every target
 * (ADR-1 as amended). What users add at runtime is a music **source string**,
 * which is data interpreted by `plugin-source-runtime`, not code handed to
 * `ctx.plugin()`. See docs/03-plugin-system.md §6–§7.
 */

/* ── Capability grammar ─────────────────────────────────────────────────── */

/**
 * Filesystem scopes a capability can name.
 *
 * `logs` is its own scope rather than part of `own`: the log directory is a
 * shared app resource that several transports write to, and folding it into
 * `own` would mean any plugin granted "its own data" could also read every
 * plugin's log output.
 */
export type FsScope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

/**
 * A capability string.
 *
 *   fs:read:<scope> | fs:write:<scope>   filesystem within a named scope
 *   net:host/<glob>                      outbound HTTP/WS, plus a persisted
 *                                        cookie jar scoped to this instance
 *   db:own                               its own namespaced tables, outright
 *   db:read:<ns>                         SELECT within another namespace
 *   db:write:<ns>                        INSERT / UPDATE / DELETE there
 *   db:*:<ns>                            both, plus schema changes
 *   secrets:own                          own credential namespace (no `all`)
 *   js                                   may evaluate untrusted script
 *   audio | mediaSession | notify | shell | background
 *
 * The `db` verbs are deliberately separate rather than nested: `db:write:core`
 * does not imply `db:read:core`, so a plugin that does both says so, and an
 * install-time prompt can name exactly what it is asking for. `db:*:<ns>` is
 * the only grant that permits `CREATE`, `DROP` or `ALTER` on someone else's
 * tables.
 */
export type Capability =
  | `fs:read:${FsScope}`
  | `fs:write:${FsScope}`
  | `net:host/${string}`
  | 'db:own'
  | `db:read:${string}`
  | `db:write:${string}`
  | `db:*:${string}`
  | 'secrets:own'
  /**
   * May evaluate untrusted script in `ctx.js`. Held by
   * `plugin-source-runtime` and nothing else.
   *
   * The grant does not widen what the evaluated code can reach — that is
   * fixed by the host surface and the per-source egress allowlist. It makes
   * *who is allowed to run it* auditable.
   */
  | 'js'
  | 'audio'
  | 'mediaSession'
  | 'notify'
  | 'shell'
  | 'background'

/**
 * Services the kernel mediates. Anything else is unrestricted.
 *
 * `store` is here not because it needs a capability — it does not — but
 * because the intercept config carries the per-plugin storage namespace that
 * `ctx.store`, `ctx.secrets`, and the cookie jar all key on. See docs/03 §5.
 */
export const MEDIATED_SERVICES = [
  'fs',
  'http',
  'ws',
  'db',
  'store',
  'secrets',
  'js',
  'audio',
  'mediaSession',
  'notify',
  'shell',
  'background',
] as const

export type MediatedService = (typeof MEDIATED_SERVICES)[number]

/* ── Manifest ───────────────────────────────────────────────────────────── */

export interface PluginEntrypoints {
  main: string
  ui?: {
    mobile?: string
    desktop?: string
  }
}

export interface PluginContributes {
  services?: string[]
  settings?: string
  slots?: string[]
}

/** Where a plugin can run. Absent means "anywhere". */
export type PluginPlatform = 'desktop' | 'mobile'

export interface PluginManifest {
  /** Package id, e.g. '@BBeBee/plugin-source-runtime'. */
  id: string
  /** Human-readable plugin name. */
  name?: string
  /** Display name (alias of `name`). */
  displayName?: string
  /** Detailed plugin purpose & role. */
  description?: string
  /** Semantic version string. */
  version: string
  /** Author or team maintaining the plugin. */
  author?: string
  /** Target engine compatibility constraint. */
  engines: { BBeBee: string; [key: string]: string }
  /** Default activation status in app configuration. */
  enabled?: boolean
  /** Required prerequisite plugin IDs. */
  dependencies?: string[]
  /** Layer stratum identifier (子系统/所在层 ID), e.g. 'layer-2', 'layer-4'. */
  systemId?: string
  /** Functional domain module identifier (功能模块 ID), e.g. 'sources', 'playback'. */
  moduleId?: string
  /**
   * Targets this plugin belongs in, when it is not all of them.
   *
   * ⚠️ A **core service implementation is platform-specific by nature** — the
   * whole `core-*-node` / `core-*-expo` split exists for that — and the static
   * registries were emitting every discovered package to both shells. The
   * mobile bundle was importing Electron. Nothing failed at build time,
   * because a bundler resolving `electron` in a React Native app is a runtime
   * problem, not a compile one.
   *
   * Feature plugins omit this and run everywhere, which is the point of the
   * architecture and stays the default.
   */
  platforms?: PluginPlatform[]
  entry: PluginEntrypoints
  capabilities: Capability[]
  contributes?: PluginContributes
}

/* ── Capability matching ────────────────────────────────────────────────── */

/**
 * Whether a hostname is covered by an entry in a source's `allowedHosts`.
 *
 * Distinct from `hostMatches` (declared further down), which matches a
 * `net:host/<glob>` grant.
 * This one governs the *second*, narrower list a source declares about itself
 * (docs/06 §8), and its rules differ deliberately:
 *
 *  - **An exact match always wins.** `nas`, `[::1]` and `music.lan` are real
 *    hosts on real networks — a LAN NAS, a docker service, an `/etc/hosts`
 *    entry — and import happily accepts `http://nas:4533` as a `sourceUrl`.
 *    Refusing the very host the source is served from would strand it with an
 *    error whose advice ("add it to allowedHosts") the same matcher refuses.
 *  - An entry also covers its subdomains, so `example.org` admits
 *    `cdn.example.org` — but never `notexample.org`, which a bare suffix
 *    comparison would wave through.
 *  - `*.example.org` is accepted as a synonym for subdomains only, because an
 *    author who writes it should not silently get a fail-closed source.
 *  - A single-label entry constrains only the **suffix** arm: `allowedHosts:
 *    ["org"]` must not quietly mean "anywhere in .org". It still matches the
 *    host `org` exactly, which is the harmless reading.
 */
export function declaredHostMatches(host: string, declared: string): boolean {
  const h = normaliseHost(host)
  const entry = normaliseHost(declared)
  if (!entry || !h) return false

  if (entry.startsWith('*.')) {
    const base = entry.slice(2)
    // The single-label rule applies here too. `*.org` is a wildcard over a
    // whole TLD wearing a small word, and it was allowed for one round after
    // the exact-match fix moved the check to the wrong arm.
    if (!base.includes('.') && base !== 'localhost') return false
    return h.endsWith(`.${base}`)
  }

  // Exact first, and unconditionally: whatever the host is, the source that
  // declared it meant it.
  if (h === entry) return true

  // Suffix matching is where a too-broad entry does damage, so it is the only
  // arm the single-label rule constrains. An IPv6 literal has no subdomains.
  if (!entry.includes('.') || entry.startsWith('[')) return false
  return h.endsWith(`.${entry}`)
}

/**
 * Compare hosts the way a URL parser produces them.
 *
 * Lowercased, trailing FQDN dot dropped, IPv6 brackets stripped — `new
 * URL('http://[::1]').hostname` keeps the brackets, so an author copying the
 * host out of their own URL writes them too, and the two spellings must not
 * disagree about the same address.
 */
function normaliseHost(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, '')
  const bare =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  if (!bare) return ''

  /*
   * Round-trip through the URL parser, so a declaration is normalised the way
   * the host it will be compared against already is.
   *
   * `new URL(…).hostname` always punycodes, so an author who writes their own
   * host in unicode — `müsik.example` — declared something that could never
   * match `xn--msik-0ra.example`, and `allowedHostsFor` stored a mixed-script
   * list nobody could reconcile. The same pass canonicalises an IPv6 literal,
   * so `[::1]`, `[0:0:0:0:0:0:0:1]` and `::1` agree.
   */
  try {
    /*
     * Two or more colons means an IPv6 literal, dots or no dots.
     *
     * The earlier test was `has ':' and no '.'`, which excluded exactly the
     * IPv4-mapped spellings — `::ffff:127.0.0.1` went through unbracketed,
     * failed to parse, and fell back to its literal text. A URL carrying the
     * same address normalises to `::ffff:7f00:1`, so the two spellings of one
     * address could never match each other.
     */
    const literal = (bare.match(/:/g)?.length ?? 0) >= 2
    const parsed = new URL(`http://${literal ? `[${bare}]` : bare}`)
    const host = parsed.hostname.toLowerCase()
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  } catch {
    // Not parseable as a host — a wildcard base, or something malformed. The
    // trimmed form is still the honest answer, and an unmatchable entry is
    // safer than a crash.
    return bare
  }
}

/** Whether any entry in a source's `allowedHosts` covers this host. */
export function hostAllowedBy(host: string, declared: readonly string[]): boolean {
  return declared.some((entry) => declaredHostMatches(host, entry))
}

/**
 * Which services a capability governs, or an empty array if it governs none.
 *
 * `net:host/…` governs both `http` and `ws` — one grant covers HTTP and
 * WebSocket to the same host, per docs/03 §7.
 */
export function servicesForCapability(cap: string): MediatedService[] {
  if (cap.startsWith('fs:')) return ['fs']
  if (cap.startsWith('net:')) return ['http', 'ws']
  if (cap.startsWith('db:')) return ['db']
  if (cap.startsWith('secrets:')) return ['secrets']
  if ((MEDIATED_SERVICES as readonly string[]).includes(cap)) return [cap as MediatedService]
  return []
}

/** The primary service a capability governs. See `servicesForCapability`. */
export function serviceForCapability(cap: string): MediatedService | undefined {
  return servicesForCapability(cap)[0]
}

/**
 * Match a host against a `net:host/<glob>` pattern.
 *
 * Supports a leading `*.` wildcard and a bare `*`. Deliberately narrow: a
 * general glob implementation here would be a security-relevant surface with
 * no corresponding benefit.
 */
export function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.example.com'
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return pattern === host
}

/** Whether a granted capability set permits an `fs` operation. */
export function allowsFs(
  granted: readonly string[],
  mode: 'read' | 'write',
  scope: FsScope,
): boolean {
  return granted.some((c) => {
    if (c === `fs:${mode}:all`) return true
    if (c === `fs:${mode}:${scope}`) return true
    // `write` implies `read` on the same scope.
    if (mode === 'read' && (c === `fs:write:${scope}` || c === 'fs:write:all')) return true
    return false
  })
}

/** Whether a granted capability set permits a request to `host`. */
export function allowsHost(granted: readonly string[], host: string): boolean {
  return granted.some(
    (c) => c.startsWith('net:host/') && hostMatches(c.slice('net:host/'.length), host),
  )
}
