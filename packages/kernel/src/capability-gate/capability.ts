/**
 * The capability gate.
 *
 * Each plugin runs in a context where every mediated core service has been
 * `intercept`ed with the plugin's grants. The service reads that config and
 * refuses out-of-scope operations. Because services are reached through
 * Cordis's proxy, a plugin cannot walk the object graph to an unscoped
 * reference.
 *
 * ⚠️ This is defense in depth, NOT a sandbox. Plugins execute in the same JS
 * realm as the app and can reach globals and patch prototypes. The gate makes
 * overreach *auditable and revocable*; it does not contain a hostile plugin.
 * It is not asked to: every plugin is first-party and ships in the build.
 *
 * The code that *is* untrusted — an imported music source's rules — is
 * contained by a different and much stronger mechanism, `ctx.js`, whose realm
 * shares nothing with the app. See docs/03 §7 and docs/06 §8.
 */

import type { Context } from 'cordis'
import { nsPrefix as nsPrefixOf } from '../migrations/runner.js'
import { assertSqlAllowed, sanitizeSql, statementsOf } from './sql.js'
import {
  CapabilityError,
  MEDIATED_SERVICES,
  allowsFs,
  allowsHost,
  hostAllowedBy,
  type Capability,
  type FsScope,
  type MediatedService,
} from '@BBeBee/protocol'

/**
 * What the kernel injects into each mediated service via `ctx.intercept()`.
 * Core service implementations read this off their resolved config.
 */
export interface CapabilityConfig {
  pluginId: string
  /**
   * The storage scope. Core services use it as the namespace for per-scope
   * storage — the `store` prefix, the `secrets` namespace, and the cookie jar
   * name all key on it.
   *
   * Usually the plugin id. The source runtime overrides it per source, which
   * is what gives each imported source its own jar, its own secrets and its
   * own vars without any of them knowing about the others. See docs/03 §5.
   */
  scopeId: string
  granted: readonly string[]
  /**
   * A second, narrower egress list, applied on top of the `net:host/…` grants.
   *
   * `plugin-source-runtime` holds a broad `net:host/*` because the hosts are
   * not known until a document is imported. It then narrows per source: each
   * source's isolated `ctx.http` scope carries that source's own hostnames,
   * and both lists must allow a request. Without this the broad grant would be
   * the whole story, and a rule could compute a URL to anywhere.
   *
   * Absent means "no extra narrowing" — the grants alone decide.
   * See docs/03 §7 and docs/06 §8.
   */
  allowedHosts?: readonly string[]
}

export interface GrantOptions {
  pluginId: string
  /** Defaults to `pluginId`. See `CapabilityConfig.scopeId`. */
  scopeId?: string
  /** See `CapabilityConfig.allowedHosts`. */
  allowedHosts?: readonly string[]
  /** What the manifest asked for. */
  requested: readonly Capability[]
  /**
   * What the user actually granted. When omitted the manifest is trusted,
   * which is correct only for bundled first-party plugins — `loadPlugins`
   * refuses a non-`builtin` plugin that has no grant.
   */
  granted?: readonly string[]
}

/**
 * Derive a plugin's context, with every mediated service capability-scoped.
 *
 * Services not listed in `MEDIATED_SERVICES` pass through untouched — they
 * expose nothing a capability would govern.
 */
export function scopeContext(ctx: Context, opts: GrantOptions): Context {
  const config: CapabilityConfig = {
    pluginId: opts.pluginId,
    scopeId: opts.scopeId ?? opts.pluginId,
    granted: normalizeGrants(opts.granted ?? opts.requested),
    ...(opts.allowedHosts ? { allowedHosts: [...opts.allowedHosts] } : {}),
  }

  let scoped = ctx
  for (const key of MEDIATED_SERVICES) {
    scoped = scoped.intercept(key, config)
  }
  return scoped
}

/** Drop anything that is not a string, so a malformed grant list cannot throw. */
function normalizeGrants(granted: readonly unknown[]): string[] {
  return granted.filter((c): c is string => typeof c === 'string')
}

/* ── Enforcement helpers, called by core service implementations ────────── */

/**
 * Read the gate config a service was intercepted with.
 *
 * Returns `undefined` for an unmediated caller — the kernel itself, a core
 * service calling another, or a test harness. Those are trusted.
 */
export function capabilityConfigOf(config: unknown): CapabilityConfig | undefined {
  if (!config || typeof config !== 'object') return undefined
  const c = config as Partial<CapabilityConfig>
  if (typeof c.pluginId !== 'string' || !Array.isArray(c.granted)) return undefined
  return {
    pluginId: c.pluginId,
    scopeId: typeof c.scopeId === 'string' ? c.scopeId : c.pluginId,
    granted: normalizeGrants(c.granted),
    ...(Array.isArray(c.allowedHosts)
      ? { allowedHosts: normalizeGrants(c.allowedHosts) }
      : {}),
  }
}

export function assertFs(config: unknown, mode: 'read' | 'write', scope: FsScope): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  if (!allowsFs(gate.granted, mode, scope)) {
    throw new CapabilityError(
      `fs:${mode}:${scope}`,
      `${gate.pluginId} may not ${mode} ${scope} files`,
    )
  }
}

/**
 * Check an outbound URL against the `net:host/<glob>` grants.
 *
 * Governs both `ctx.http` and `ctx.ws` — one grant covers HTTP and WebSocket
 * to the same host, matching docs/03 §7.
 *
 * ⚠️ Matching is on the hostname only: the port is not considered, so a grant
 * cannot be narrowed to `host:8080`. Patterns are compared lowercase; an
 * IDN host must be granted in the same (punycode or unicode) form the URL
 * uses. Unmatched cases deny, so the failure direction is safe.
 */
export function assertHost(config: unknown, url: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return

  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    throw new CapabilityError('net:host', `${gate.pluginId} requested a malformed url: ${url}`)
  }
  // Normalise a trailing-dot FQDN so `example.org.` matches `example.org`.
  if (host.endsWith('.')) host = host.slice(0, -1)

  if (!allowsHost(gate.granted, host)) {
    throw new CapabilityError(`net:host/${host}`, `${gate.pluginId} may not reach ${host}`)
  }

  // The narrower list wins. A source that computes a URL to a host it did not
  // declare is refused whether the URL was written literally or built at
  // runtime — which is what turns the sandbox from a reach boundary into an
  // egress one (docs/06 §8).
  if (gate.allowedHosts && !hostAllowedBy(host, gate.allowedHosts)) {
    throw new CapabilityError(
      `net:host/${host}`,
      `${gate.scopeId} did not declare ${host}; add it to allowedHosts and re-import`,
    )
  }
}

/** WebSocket connections are governed by the same `net:host/` grants. */
export const assertWsHost = assertHost

/** For the flag-shaped capabilities: `audio`, `notify`, `shell`, `background`, … */
export function assertGranted(config: unknown, capability: MediatedService | string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  if (!gate.granted.includes(capability)) {
    throw new CapabilityError(capability, `${gate.pluginId} was not granted ${capability}`)
  }
}

/**
 * The storage namespace a plugin's `store`, `secrets`, and cookie jar use.
 *
 * Core services call this rather than inventing their own scheme, so a plugin
 * gets the same namespace across all three.
 */
export function storageNamespace(config: unknown): string | undefined {
  return capabilityConfigOf(config)?.scopeId
}

/* ── db ─────────────────────────────────────────────────────────────────── */

/** Table names a plugin may reach with `db:own`, given its namespace prefix. */
function ownTablePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_`, 'i')
}

/**
 * `PRAGMA`s a gated caller may issue.
 *
 * Everything else is refused, because a pragma is not scoped to the caller:
 * `foreign_keys = OFF` or `journal_mode` reconfigures the one connection every
 * plugin shares, and on desktop that connection lives in `main`. The
 * exceptions are the per-transaction one the migration runner needs, and
 * read-only introspection — for which `sqlite_master` is available anyway.
 */
const PRAGMA_ALLOWED = new Set([
  'defer_foreign_keys',
  'table_info',
  'table_xinfo',
  'index_info',
  'index_xinfo',
  'index_list',
  'foreign_key_list',
])

const PRAGMA_STATEMENT = /^PRAGMA\s+(?:\w+\s*\.\s*)?(\w+)/i

/**
 * Identifiers a SQL statement touches — tables, and the indexes, triggers and
 * views that live in the same namespace.
 *
 * Deliberately crude: a regex over the shapes SQLite actually uses, not a
 * parser. It exists to make `db:own` mean something rather than nothing, and
 * it fails *closed* — anything it cannot confidently attribute is treated as
 * foreign and refused, including a schema-qualified `main.x`, which is
 * returned with its qualifier attached precisely so that nothing can match it.
 */
export function tablesReferenced(sql: string): string[] {
  // `name`, `"name"`, `[name]`, or a qualified `main.name`.
  const IDENT = String.raw`["'\`\[]?(?:(\w+)\s*\.\s*)?["'\`\[]?([A-Za-z_][\w$]*)`
  const clauses = [
    // The row-level statements.
    String.raw`(?:FROM|JOIN|INTO|UPDATE(?:\s+OR\s+\w+)?)`,
    // CREATE / ALTER / DROP TABLE.
    String.raw`TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?`,
    // The *named object* of CREATE/DROP INDEX|TRIGGER|VIEW. Without this, a
    // bare `DROP INDEX idx_tracks_album` names no table and sails through.
    String.raw`(?:INDEX|TRIGGER|VIEW)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?`,
    String.raw`(?:REINDEX|ANALYZE)`,
    // The table an index is built on. Restricted to the INDEX form because a
    // bare `ON` is also a join predicate, where the next token is a column.
    String.raw`INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON`,
  ]

  const names = new Set<string>()
  const sanitized = sanitizeSql(sql)
  for (const clause of clauses) {
    for (const match of sanitized.matchAll(new RegExp(String.raw`\b${clause}\s+${IDENT}`, 'gi'))) {
      const [, qualifier, name] = match
      if (name) names.add(qualifier ? `${qualifier}.${name}` : name)
    }
  }
  return [...names]
}

/**
 * Bookkeeping the kernel touches *on a plugin's behalf*.
 *
 * `defineSchema` records applied versions and prefix ownership, and reads
 * `sqlite_master` to enumerate a namespace's tables. Gating these would break
 * the very mechanism that gives a plugin its own schema. A plugin can only
 * corrupt its own migration record this way, which harms nobody else.
 */
const KERNEL_TABLES = new Set([
  'schema_migrations',
  'schema_namespaces',
  'sqlite_master',
  'sqlite_sequence',
])

/**
 * Kernel bookkeeping that belongs to the CORE namespace despite its names.
 *
 * `plugin_records` and `capability_grants` are created by the kernel's own
 * migrations (migrations/core.ts) and written by exactly one gated caller —
 * plugin-manager's grants ledger — under that plugin's `db:read:core` /
 * `db:write:core` grants. A plugin-owned table always carries its owner's
 * prefix segment (`plugin_<scope>_…`), so these bare names can only ever be
 * the kernel's; the `plugin_` prefix heuristic in {@link grantFor} would
 * otherwise attribute `plugin_records` to a plugin namespace and refuse
 * the ledger outright (the real-machine install failure of 2026-10-22).
 *
 * These tables are deliberately NOT in {@link KERNEL_TABLES}: that set
 * skips the gate unconditionally, and no caller may reach the grants
 * ledger without holding core grants.
 */
const KERNEL_BOOKKEEPING_TABLES = new Set(['plugin_records', 'capability_grants'])

/**
 * How much a statement asks of a table.
 *
 *   read    SELECT and friends
 *   write   INSERT / UPDATE / DELETE / REPLACE — the rows change
 *   schema  CREATE / DROP / ALTER — the table itself changes
 *
 * `schema` is its own class rather than a kind of `write` because dropping the
 * catalogue and updating a row in it are not the same request, and a grant
 * that cannot tell them apart cannot be prompted for honestly at install time.
 */
export type DbAccess = 'read' | 'write' | 'schema'

const ACCESS_BY_KEYWORD: Record<string, DbAccess> = {
  select: 'read',
  explain: 'read',
  values: 'read',
  // Transaction control touches no data. It is classified rather than left
  // unrecognised because an unrecognised statement fails closed, and the
  // migration runner's own `BEGIN` would then be refused.
  begin: 'read',
  commit: 'read',
  end: 'read',
  rollback: 'read',
  savepoint: 'read',
  release: 'read',
  insert: 'write',
  replace: 'write',
  update: 'write',
  delete: 'write',
  create: 'schema',
  drop: 'schema',
  alter: 'schema',
  reindex: 'schema',
  analyze: 'schema',
  vacuum: 'schema',
  pragma: 'schema',
}

const ACCESS_RANK: Record<DbAccess, number> = { read: 0, write: 1, schema: 2 }

/**
 * Classify what a statement asks for, taking the most demanding class in the
 * string when several statements are separated by `;`.
 *
 * Like `tablesReferenced`, this is a regex over the shapes SQLite uses rather
 * than a parser, and it fails *closed*:
 *
 *  - `SELECT 1; DROP TABLE tracks` is classified `schema`, not `read`, so a
 *    second statement cannot ride in on the first one's grant.
 *  - Statement boundaries inside a literal are not boundaries, because
 *    `sanitizeSql` has already blanked the literal out.
 *  - Nothing recognisable at all is `schema`, the most demanding class.
 */
export function classifyDbAccess(sql: string): DbAccess {
  let rank = -1
  for (const fragment of statementsOf(sql)) {
    const keyword = /^([A-Za-z]+)/.exec(fragment)?.[1]?.toLowerCase()
    if (!keyword) continue
    // A CTE may front any of SELECT / INSERT / UPDATE / DELETE.
    const access =
      keyword === 'with'
        ? /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(fragment)
          ? 'write'
          : 'read'
        : ACCESS_BY_KEYWORD[keyword]
    if (!access) continue
    rank = Math.max(rank, ACCESS_RANK[access])
  }
  if (rank < 0) return 'schema'
  return (['read', 'write', 'schema'] as const)[rank]!
}

/**
 * The namespaces a grant set opens, and what may be done in each.
 *
 *   db:read:<ns>    SELECT
 *   db:write:<ns>   INSERT / UPDATE / DELETE
 *   db:*:<ns>       everything, schema changes included
 *
 * `write` deliberately does **not** imply `read`: a plugin that both reads and
 * writes the catalogue declares both, which keeps `db:*:<ns>` meaningful and
 * keeps the install-time prompt specific. `db:own` is separate and total —
 * a plugin owns its own tables outright.
 */
function parseDbGrants(granted: readonly string[]): Map<string, Set<DbAccess>> {
  const namespaces = new Map<string, Set<DbAccess>>()
  for (const grant of granted) {
    if (!grant.startsWith('db:') || grant === 'db:own') continue
    const rest = grant.slice('db:'.length)
    const sep = rest.indexOf(':')
    if (sep <= 0) continue
    const verb = rest.slice(0, sep).toLowerCase()
    const ns = rest.slice(sep + 1).toLowerCase()
    if (!ns) continue

    const allowed = namespaces.get(ns) ?? new Set<DbAccess>()
    if (verb === 'read') allowed.add('read')
    else if (verb === 'write') allowed.add('write')
    else if (verb === '*') {
      allowed.add('read')
      allowed.add('write')
      allowed.add('schema')
    } else continue // an unknown verb grants nothing
    namespaces.set(ns, allowed)
  }
  return namespaces
}

/**
 * Schema names, which are never table names.
 *
 * `SELECT * FROM main.plugin_other_secrets` used to be attributed to the table
 * `main` — which, carrying no `plugin_` prefix, fell through to the `core`
 * fallback and was permitted by `db:read:core`. That is ordinary-looking SQL,
 * not a determined bypass, so both halves are closed: the qualifier is
 * returned attached to the name (and a dotted name matches nothing), and a
 * bare qualifier is refused here.
 */
const SCHEMA_QUALIFIERS = new Set(['main', 'temp', 'sqlite_temp_master'])

/**
 * Which grant, if any, covers a table.
 *
 * `core` is the fallback rather than a prefix match: the catalogue's tables
 * carry no prefix, so anything that is not a `plugin_` table belongs to it.
 * The fallback therefore applies only to bare, unqualified names — plus
 * the kernel's own bookkeeping tables ({@link KERNEL_BOOKKEEPING_TABLES}),
 * whose `plugin_` names predate the prefix convention.
 */
function grantFor(
  table: string,
  grants: Map<string, Set<DbAccess>>,
): { ns: string; allowed: Set<DbAccess> } | undefined {
  const lower = table.toLowerCase()
  // A qualified name is attributable only by trusting the qualifier, and no
  // plugin needs the form. A bare qualifier is not a table at all.
  if (lower.includes('.') || SCHEMA_QUALIFIERS.has(lower)) return undefined
  for (const [ns, allowed] of grants) {
    if (ns === 'core') continue
    if (lower === ns || lower.startsWith(`${ns}_`)) return { ns, allowed }
  }
  const core = grants.get('core')
  if (core && (!lower.startsWith('plugin_') || KERNEL_BOOKKEEPING_TABLES.has(lower))) {
    return { ns: 'core', allowed: core }
  }
  return undefined
}

/** The capability a refused statement would have needed. */
function capabilityFor(access: DbAccess, ns: string): string {
  return access === 'schema' ? `db:*:${ns}` : `db:${access}:${ns}`
}

const ACCESS_VERB: Record<DbAccess, string> = {
  read: 'read',
  write: 'write to',
  schema: 'change the schema of',
}

/**
 * The table prefix a caller owns, derived from its scope id.
 *
 * Every `ctx.db` implementation must derive it the same way, or the gate means
 * different things on different platforms — which is exactly how the desktop
 * path ended up with no gate at all while the in-process one had one.
 */
export function ownNamespaceOf(gate: CapabilityConfig): string {
  return `plugin:${gate.scopeId}`
}

/**
 * Gate a statement for whoever is calling. The entry point every `DbService`
 * implementation uses, so none of them has to re-derive the prefix.
 */
export function assertDbForCaller(config: unknown, sql: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  assertDb(config, sql, nsPrefixOf(ownNamespaceOf(gate)))
}

/**
 * A plugin may only define schema for its own namespace — otherwise it could
 * claim `core` and own the catalogue.
 */
export function assertOwnNamespace(config: unknown, namespace: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  const mine = ownNamespaceOf(gate)
  if (namespace !== mine) {
    throw new CapabilityError(
      'db:own',
      `${gate.pluginId} may only define schema for ${JSON.stringify(mine)}, not ` +
        JSON.stringify(namespace),
    )
  }
}

/**
 * Enforce the `db:` grants against one statement.
 *
 * A plugin may always use its own namespaced tables (`db:own`). Every other
 * table needs a grant naming its namespace *and* covering what the statement
 * does — `db:read:core` no longer carries an `INSERT`, which is the whole
 * point of separating the verbs.
 *
 * ⚠️ Regex-based, so this is a guard rail rather than a parser: it stops the
 * ordinary mistake and the casual overreach, not a determined author who
 * shares the runtime anyway (docs/03 §7).
 */
export function assertDb(config: unknown, sql: string, ownPrefix: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return

  assertSqlAllowed(sql, gate.pluginId)

  const statements = statementsOf(sql)
  let pragmasOnly = statements.length > 0
  for (const statement of statements) {
    const pragma = PRAGMA_STATEMENT.exec(statement)?.[1]?.toLowerCase()
    if (!pragma) {
      pragmasOnly = false
      continue
    }
    if (!PRAGMA_ALLOWED.has(pragma)) {
      throw new CapabilityError(
        'db',
        `${gate.pluginId} may not issue PRAGMA ${pragma} — a pragma reconfigures the one ` +
          'connection every plugin shares',
      )
    }
  }
  // An allow-listed pragma names no table by design, so it is exempt from the
  // attribution rule below rather than tripped up by it — the migration runner
  // issues `PRAGMA defer_foreign_keys` on this very path.
  if (pragmasOnly) return

  const grants = parseDbGrants(gate.granted)
  const access = classifyDbAccess(sql)
  const hasOwn = gate.granted.includes('db:own')
  const own = ownTablePattern(ownPrefix)
  const referenced = tablesReferenced(sql)

  // The per-table checks below are the whole gate, so a statement naming no
  // table the matcher can see would otherwise pass unexamined — which is how
  // `DROP INDEX idx_tracks_album`, `VACUUM` and `ANALYZE` used to sail
  // through. Reads are exempt: `SELECT 1` and transaction control name nothing
  // and change nothing.
  if (access !== 'read' && referenced.length === 0) {
    throw new CapabilityError(
      `db:${access}`,
      `${gate.pluginId} may not issue this statement — the gate cannot attribute what it ` +
        `changes, and an unattributable ${access} change is refused rather than guessed at`,
    )
  }

  for (const table of referenced) {
    if (KERNEL_TABLES.has(table.toLowerCase())) continue
    if (hasOwn && own.test(table)) continue

    const grant = grantFor(table, grants)
    if (!grant) {
      throw new CapabilityError(
        'db:own',
        `${gate.pluginId} may not touch table "${table}" — it is outside its own namespace`,
      )
    }
    if (!grant.allowed.has(access)) {
      throw new CapabilityError(
        capabilityFor(access, grant.ns),
        `${gate.pluginId} may not ${ACCESS_VERB[access]} table "${table}" — ` +
          `${capabilityFor(access, grant.ns)} is not granted`,
      )
    }
  }
}
