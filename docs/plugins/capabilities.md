# Capability Gate & Security Model

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §7 – §9`.

## 7. Capability model

Plugins declare what they intend to touch and the kernel mediates. With
[ADR-1 amended](../architecture/overview.md#adr-1--plugins-are-statically-bundled-on-every-target) every
plugin is first-party, so the gate is now a **discipline that keeps intent auditable** rather than
a boundary against a stranger's package — and the stranger's code that does exist, a source
string, is contained by a different and much stronger mechanism
([06 §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).

### Capability grammar

| Capability | Grants |
|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | Filesystem access within a named scope: `own`, `media`, `cache`, `downloads`, `logs`, or `all` |
| `net:host/<pattern>` | Outbound HTTP **and WebSocket** to hosts matching a glob — one grant governs both `ctx.http` and `ctx.ws`. `net:host/*` is a broad grant and is labelled as such in the prompt. Includes a **persisted cookie jar scoped to this plugin instance** ([services/overview.md §2.1](../services/overview.md#21-cookie-jars)) — the core service owns the storage, so no `db` or `secrets` grant is needed for it. Matching is on hostname only, lowercased; a port cannot be granted separately |
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
| `audio` | `core-audio-webaudio`, `core-audio-mpv` on `load` and mutators | ✅ |
| `mediaSession`, `background` | `core-media-session-*`, `core-background-*` | ✅ |
| `secrets:own` | `core-secrets-node`, `core-secrets-expo`, kernel `assertOwnNamespace` | ✅ |
| `js`, and the per-source narrowing of `net:host/…` | `core-js-quickjs-node`, `core-http-*`, `plugin-source-runtime` | ✅ |
| `notify`, `shell` | Platform host mediation (`core-device-*`, desktop bridge) | ✅ |

### The gate fails closed

A plugin's manifest is a *request*, never an authorisation. The loader trusts a manifest only for
plugins marked `builtin` — first-party packages bundled with the app. Anything else must have a
matching row in `capability_grants`; without one it is refused and recorded as `ungranted` rather
than loaded. External desktop plugins loaded dynamically through `bbebee-plugin://` are strictly
subject to this check.

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
| One statement per call | A driver compiles the first statement of a string and discards the rest silently, so `SELECT 1; DROP …` neither runs nor half-runs — it is refused ([04 §5](../services/contracts.md#5-ctxdb--sql)) |
| Bounded stream handles | A loop of `streamOpen` cannot exhaust `main`'s file descriptors |
| Transaction lifecycle | An abandoned transaction is rolled back on renderer teardown and on an idle timeout, so a reload cannot wedge the database |

Closing the per-plugin gap properly requires plugins to stop sharing the renderer's realm — the
same prerequisite as real sandboxing, below. Nothing outside this repository is loaded as a plugin
any more, so the gate's per-plugin half is a first-party discipline by design rather than by
oversight. **It must be resolved before anything third-party is loaded as a plugin**
([10 §M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox)).

### What this is not

> ⚠️ **This is defense in depth, not a sandbox.** Plugins execute in the same JS realm as the app.
> A determined plugin can reach globals, patch prototypes, and generally do anything the renderer
> can do. The capability model raises the cost of *accidental* overreach and makes intent auditable
> and revocable — it does not contain a hostile plugin. It is not asked to: every plugin is
> first-party and ships in the build.

Real containment needs an isolated realm. **One now exists** — `ctx.js`, a QuickJS realm with an
enumerable host API, built because imported music sources are untrusted code and had to be
contained ([04 §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator),
[06 §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)). Generalising it
from "evaluate source rules" to "host a whole plugin" means giving it the service bridge the
capability grammar above already describes as a protocol. That is the shape of
[M5](../roadmap/roadmap.md#m5--third-party-extensions-on-the-sandbox), and it is now an extension of
something shipped rather than a subsystem to invent.

---

## 8. Writing a plugin: checklist

- [ ] `name` set, and it matches the package name's suffix.
- [ ] `inject` lists exactly what is needed — optional deps in object form.
- [ ] No platform SDK imported ([02 §1](../architecture/layers.md#the-invariant)). Core plugins are the
      exception, and are the *only* exception.
- [ ] Nothing imported from the kernel's bootstrap surface — a feature plugin is handed a context,
      it does not build one ([02 §1](../architecture/layers.md#the-invariant)).
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
      ([07 §6](../data-model/migrations.md#6-migrations)).
- [ ] Disable, re-enable, and confirm via `fiber.getEffects()` that nothing leaked.

---

## 9. Where to go next

[04 — Core Services](../services/contracts.md) specifies the platform abstraction these plugins
depend on.
