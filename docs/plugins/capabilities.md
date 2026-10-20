# Capability Gate & Security Model

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §7 – §9`.

> ⚠️ **`capabilities` (this document) vs `services` (registry entries)** — two
> different concepts that used to share a name. `capabilities` here is the
> **in-package security gate**: the `fs:`/`net:`/`db:`/`audio`/… grants a plugin
> declares in its own `BBeBee.plugin.json`, enforced by the kernel at load
> time. The community registry entry instead uses **`services`**: the string
> array of **cordis service keys the plugin must `inject`** (e.g.
> `["player", "store"]`), used by the installer to check service availability
> *before* downloading anything from npm. The registry schema v2 renamed the
> old `capabilities` field to `services` precisely to end this confusion; the
> in-package gate keeps the name `capabilities` and its semantics are unchanged.

## 7. Capability model

Plugins declare what they intend to touch and the kernel mediates. Most
plugins are first-party; since the npm distribution flow
([loading.md §6.7](./loading.md#67-npm-install-flow-desktop)) third-party
plugins load on desktop too. The gate is therefore a **discipline that keeps
intent auditable** — plus a fail-closed grant check at load time — rather than
a boundary against a stranger's package; for third-party code the control
points sit at install time (integrity verification, anti-spoofing, the
pre-install security scan, an explicit user confirmation). The one class of
stranger's code that is contained by a much stronger mechanism remains the
source string
([sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).

### Capability grammar

see the spec at [rules/plugins.md §5 Capability Grammar](../../rules/plugins.md#5-capability-grammar) (L2); the table below expands
each grant with its semantics and rationale.

| Capability | Grants |
|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | Filesystem access within a named scope: `own`, `media`, `cache`, `downloads`, `logs`, or `all` |
| `net:host/<pattern>` | Outbound HTTP **and WebSocket** to hosts matching a glob — one grant governs both `ctx.http` and `ctx.ws`. `net:host/*` is a broad grant and is labelled as such in the prompt. Includes a **persisted cookie jar scoped to this plugin instance** ([services/contracts.md §2.1](../services/contracts.md#21-cookie-jars)) — the core service owns the storage, so no `db` or `secrets` grant is needed for it. Matching is on hostname only, lowercased; a port cannot be granted separately |
| `db:own` | Its own namespaced tables, outright — read, write, and schema. Indexes, triggers and views count: they are attributed by name, so a plugin's index is `{{ns}}_…` like its tables |
| `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>` | Access to another namespace, by verb: `read` is `SELECT`, `write` is `INSERT`/`UPDATE`/`DELETE`, `*` is both plus `CREATE`/`DROP`/`ALTER`. The verbs do **not** nest — a plugin that reads and writes the catalogue declares `db:read:core` *and* `db:write:core`, so an install-time prompt can name exactly what it is asking for. Statements are classified by the most demanding thing they do, so a `DROP` cannot ride in behind a `SELECT` |
| `secrets:own` | Its own credential namespace. There is no `secrets:all`. A plugin that only needs its login to persist does not need this — the cookie jar under `net:` already covers it |
| `js` | May evaluate untrusted script in `ctx.js` ([services/contracts.md §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator)). Held by `plugin-source-runtime` and nothing else. The grant does not widen what the evaluated code can reach — that is fixed by the host API and the per-evaluation allowlist — it makes *who is allowed to run it* auditable |
| `audio` | May contribute nodes to the audio graph |
| `mediaSession` | May publish now-playing metadata and receive transport commands |
| `notify`, `shell`, `background` | User-visible or OS-level actions |

`store` is also mediated, though it has no capability of its own: the interception config carries
the plugin's **storage namespace**, which `ctx.store`, `ctx.secrets`, and the cookie jar all key
on so a plugin gets the same namespace across the three (`storageNamespace(config)` in the
kernel).

#### SQL Guardrails & Refusals

Three refusals apply whatever was granted, because each was a way past the table above:

- **A change the gate cannot attribute.** The per-table checks *are* the gate, so a statement
  naming no table it can see — `DROP INDEX idx_tracks_album`, `VACUUM`, `ANALYZE` — used to pass
  unexamined. Anything above `read` that cannot be attributed is refused rather than guessed at.
- **Schema-qualified names.** `SELECT * FROM main.plugin_other_secrets` was read as a table called
  `main`, which carries no `plugin_` prefix and so fell through to the `core` fallback — ordinary
  SQL that read and wrote another plugin's rows. Qualified names are refused outright.
- **`PRAGMA`.** A pragma is not scoped to its caller: `foreign_keys = OFF` reconfigures the one
  connection every plugin shares, and on desktop that connection lives in `main`. Only
  `defer_foreign_keys` (which the migration runner needs) and the read-only introspection pragmas
  are permitted; `sqlite_master` remains readable for the rest.

> ⚠️ All of this is regex over the shapes SQLite uses, not a parser. It fails closed — an identifier
> it cannot attribute is treated as foreign — and it is a guard rail against the ordinary mistake
> and the casual overreach, not against an author who is trying, who shares the runtime anyway.

> **`net:host/*` on `plugin-source-runtime` is not what it looks like.** The runtime holds the
> broad grant because the hosts are not known until a source is imported, and it then **narrows**
> it: each source's isolated `ctx.http` scope carries that source's own allowlist — its
> `sourceUrl` host plus its declared `allowedHosts` — and `core-http-*` enforces the narrower of
> the two. A rule that computes a URL to an undeclared host is refused, and the list is shown to
> the user at import ([runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).

### Enforcement

The kernel derives each plugin's context by interception:

```ts
// @BBeBee/kernel — simplified
function scopeContext(ctx: Context, opts: GrantOptions) {
  const config = {
    pluginId: opts.pluginId,
    scopeId: opts.scopeId ?? opts.pluginId,   // a source id, or the plugin id
    granted: opts.granted ?? opts.requested,
  }
  let scoped = ctx
  for (const key of MEDIATED_SERVICES) {
    scoped = scoped.intercept(key, config)
  }
  return scoped
}
```

Each mediated core service reads its interception config and refuses out-of-scope operations with
a `CapabilityError`. Because services are reached through Cordis's proxy, a plugin cannot obtain
an unscoped reference by walking the object graph from the one it was given.

**A grant is only real where a service checks it.** `db:own` was a manifest string with no meaning
until `ctx.db` called the gate, and `net:host/…` was the same until `ctx.http` did. Current state across
core services:

| Capability | Enforced by | Status |
|---|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | `core-fs-node`, `core-fs-expo`, the bridge host | ✅ |
| `db:own`, `db:read:<ns>`, `db:write:<ns>`, `db:*:<ns>` | `core-db-node`, `core-db-expo`, the bridge host | ✅ |
| `net:host/<glob>` | `core-http-node`, `core-http-rn`, before *and* after the `http/request` waterfall | ✅ |
| `audio` | `core-audio-mpv` on `load` and mutators | ✅ |
| `mediaSession`, `background` | `core-media-session-*`, `core-background-*` | ✅ |
| `secrets:own` | `core-secrets-node`, `core-secrets-expo`, kernel `assertOwnNamespace` | ✅ |
| `js`, and the per-source narrowing of `net:host/…` | `core-js-quickjs-node`, `core-http-*`, `plugin-source-runtime` | ✅ |
| `notify`, `shell` | Platform host mediation (`core-device-*`, desktop bridge) | ✅ |

### The gate fails closed

A plugin's manifest is a *request*, never an authorisation. see the spec at
[rules/plugins.md §7 Dual-Mode Plugin Loading](../../rules/plugins.md#7-dual-mode-plugin-loading) (L2): the loader trusts a manifest
only for plugins marked `builtin` — first-party packages bundled with the app; anything else needs
a matching row in `capability_grants`, and without one it is refused and recorded as `ungranted`
rather than loaded. External desktop plugins loaded dynamically through `bbebee-plugin://` are strictly
subject to this check.

**Where grant rows come from.** The rows are written by exactly one component: plugin-manager's
grant ledger (`CapabilityGrantLedger`), at exactly one moment — when a user-confirmed install or
update activates a node, the ledger records the capabilities of the **real downloaded manifest**
(a replace, so an update that drops a capability revokes it), and uninstall revokes the plugin's
rows. There is no other writer, and a plugin with declared capabilities whose ledger is
unavailable is refused (`GRANT_UNAVAILABLE`) rather than silently waved through. The kernel
side is read-only and deliberately unstale: both shells pass `readCapabilityGrants` into
`createApp` as `resolveGrants`, and the table is re-read before every load rather than snapshotted
at boot — a grant written mid-session is honoured by the activation that follows it, a revoked
one stops working at the next load, and a read failure resolves to *no grants* (fail-closed),
never to the plugin's own declarations. Activation outcomes are reported back honestly: an
install whose node ends `ungranted` fails as `ACTIVATION_FAILED`, it does not record success.

**One derived addition, for plugin-manager only.** The manager's download pipeline must reach
hosts no static manifest can enumerate: the npm mirror and GitHub acceleration bases the *user*
configures in network settings, plus those mirrors' known CDN redirect targets (npmmirror
302-redirects tarballs to `cdn.npmmirror.com`). So both shells resolve the manager's grant entry
as a union — ledger rows, its manifest, and the `net:host/…` set derived from the user's current
settings by the pure function `derivePluginManagerDownloadHosts` in `@BBeBee/protocol` (composed
by `createShellGrantResolver` in the kernel). The derivation's inputs are only the built-in
endpoints, a hardcoded companion-host table, and the user's own settings values; remote data (a
packument's `dist.tarball`, a redirect target) can never widen it, and no wildcard is introduced.
The manager's own tarball pre-download allowlist consumes the same derivation, so the gate and
the client cannot drift apart. The merge happens at the composition root — a plugin never grants
itself anything — and it applies to no other plugin. Freshness follows the loader's rule: the
resolver re-derives at every resolution, but a running plugin-manager keeps the grants its fiber
was created with, so a newly configured mirror's gate entry takes effect at the manager's next
load (in practice the next launch); its endpoint selection and tarball pre-check read settings
live and follow immediately.

This matters because the failure mode is silent: a host that simply forgot to pass its grants
would otherwise hand a non-builtin plugin exactly what it declared for itself — including
`net:host/*` — turning approval into a no-op.

### Where the gate actually runs

On mobile the gate and the services it guards are in one process, so a plugin reaches `ctx.fs`
only through its intercepted context.

**On desktop they are not.** ADR-3 puts the kernel in the renderer while the real `fs` and `db`
live in `main`, so the gate runs *renderer-side* and the bridge that carries calls across is
reachable by anything in the renderer — `window.BBeBeeBridge.call('fs', 'writeFile', …)` skips it
in one line. The per-plugin gate therefore constrains a **cooperating** plugin on desktop, not one
that declines to cooperate.

What `main` enforces regardless, because it does not require knowing who is calling:

| Limit | Effect |
|---|---|
| Method allowlist | Only the named service methods are reachable; `constructor` and inherited members are not |
| Path containment | Every `fs` operand must lie inside an application directory — the bridge cannot reach `/etc` or the user's home at large |
| `ATTACH`/`DETACH`/`VACUUM INTO` refused | Otherwise the database handle is an arbitrary-file read/write primitive and the containment above is moot. All three come from one shared `assertSqlAllowed` in the kernel, used by the gated path and by `main`: the bridge previously kept its own list, which had drifted to `ATTACH`/`DETACH` only, so `VACUUM INTO '/any/path'` wrote a file straight past this table |
| One statement per call | A driver compiles the first statement of a string and discards the rest silently, so `SELECT 1; DROP …` neither runs nor half-runs — it is refused ([services/contracts.md §5](../services/contracts.md#5-ctxdb--sql)) |
| Bounded stream handles | A loop of `streamOpen` cannot exhaust `main`'s file descriptors |
| Transaction lifecycle | An abandoned transaction is rolled back on renderer teardown and on an idle timeout, so a reload cannot wedge the database |

Closing the per-plugin gap properly requires plugins to stop sharing the renderer's realm — the
same prerequisite as real sandboxing, below. Third-party plugins **are** now loaded as plugins on
desktop (npm flow, [loading.md §6.7](./loading.md#67-npm-install-flow-desktop)), and they share
that realm, so this gap applies to them exactly as written: the mitigations in force are the
main-side limits above, the fail-closed grant gate, and the install-time checks — not containment.
Real containment of plugin code remains the M5 work
([roadmap/roadmap.md §M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox)).

### What this is not

> ⚠️ **This is defense in depth, not a sandbox.** Plugins execute in the same JS realm as the app.
> A determined plugin can reach globals, patch prototypes, and generally do anything the renderer
> can do. The capability model raises the cost of *accidental* overreach and makes intent auditable
> and revocable — it does not contain a hostile plugin. It is not asked to, even now that
> third-party plugins ship separately through npm: they run in this same realm, which is why the
> install-time gates (integrity, anti-spoofing, security scan, explicit confirmation) carry the
> weight for third-party code.

Real containment needs an isolated realm. **One now exists** — `ctx.js`, a QuickJS realm with an
enumerable host API, built because imported music sources are untrusted code and had to be
contained ([services/contracts.md §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator),
[sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)). Generalising it
from "evaluate source rules" to "host a whole plugin" means giving it the service bridge the
capability grammar above already describes as a protocol. That is the shape of
[M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox), and it is now an extension of
something shipped rather than a subsystem to invent.

---

## 8. Writing a plugin: checklist

- [ ] `name` set, and it matches the package name's suffix — see the spec at
      [rules/plugins.md §1 Shape](../../rules/plugins.md#1-shape) (L2).
- [ ] `inject` lists exactly what is needed — optional deps in object form.
- [ ] No platform SDK imported ([architecture/layers.md §1](../architecture/layers.md#the-invariant)). Core plugins are the
      exception, and are the *only* exception.
- [ ] Nothing imported from the kernel's bootstrap surface — a feature plugin is handed a context,
      it does not build one ([architecture/layers.md §1](../architecture/layers.md#the-invariant)).
- [ ] No import of a `core-*` package. A Layer 2 dependency is spelled `inject: ['fs']`.
- [ ] Every listener, timer, socket, and audio node registered through `ctx.effect()` or returned
      as a disposer.
- [ ] Long async work takes an `AbortSignal` aborted on dispose.
- [ ] No module-level mutable state.
- [ ] `Config` schema present if configurable; defaults supplied.
- [ ] `BBeBee.plugin.json` declares the minimum capabilities that work.
- [ ] It is a plugin at all. A new music backend is a **source string**, not a package
      ([06](../sources/spec.md)); a plugin is for behaviour the runtime cannot express —
      an effect, a scrobbler, a transport, a UI surface.
- [ ] Own DB tables declared through `ctx.db.defineSchema('plugin:<id>', …)`
      ([data-model/migrations.md §6](../data-model/migrations.md#6-migrations)).
- [ ] Disable, re-enable, and confirm via `fiber.getEffects()` that nothing leaked.

---

## 9. Where to go next

[04 — Core Services](../services/contracts.md) specifies the platform abstraction these plugins
depend on.
