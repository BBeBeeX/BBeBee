# Service Isolation & Interception

> **Legacy Reference:** Formerly `docs/03-plugin-system.md §4 – §5`.

## 4. Services

A service is a capability behind a stable key. Its **interface** is declared once in
`@BBeBee/protocol` via module augmentation, and any number of plugins may implement it.

```ts
// packages/protocol/src/services/fs.ts
export interface FsService { /* … see services/contracts.md … */ }

declare module 'cordis' {
  interface Context {
    fs: FsService
  }
}
```

Consumers write `ctx.fs.readFile(uri)` with full type safety and no knowledge of which
implementation is mounted. Swapping `core-fs-expo` for `core-fs-node` is a bootstrap-list change
([02 §3](../architecture/layers.md#bootstrap-plugin-sets)) and nothing else.

Cordis hands out services through a tracing proxy, which is how it knows that a value your plugin
holds came from a service and must be invalidated when that service is replaced. Two consequences:

- **Do not cache a service reference across an await boundary** in a long-lived variable.
  Read `this.ctx.fs` each time; it is a property access, not a lookup.
- Identity comparisons on service objects are unreliable. Compare by `name`.

### The one exception: capturing for teardown

A plugin's disposer runs while its own fiber is already `UNLOADING`, and reaching through the
context there throws `cannot get required service in inactive context`. So a plugin that must do
final work on shutdown — flushing a log buffer, checkpointing a download — **must capture what it
needs at load time**:

```ts
export async function apply(ctx: Context) {
  const fs = ctx.fs                     // captured deliberately, see below
  return async () => {
    try { await fs.writeFile(uri, tail) } catch { /* teardown is best-effort */ }
  }
}
```

This is permitted only under all three conditions, and a comment must say so at the capture site:

1. The captured service is a **core service**, whose fiber outlives every feature plugin because
   teardown runs in reverse order ([02 §3](../architecture/layers.md#3-boot-sequence)).
2. The reference is used **only in the disposer**, never on the hot path — where interception or
   isolation could legitimately have swapped the service since load.
3. Failure is swallowed. A disposer that throws aborts the rest of teardown
   ([09 §6](../workflow/testing.md#6-testing-strategy)), and losing the last log line is a far
   better outcome than leaking every listener registered after it.

Anywhere else, read through `ctx` — otherwise a plugin running in an isolated scope silently keeps
talking to the unisolated service.

---

## 5. Isolation and interception

Two mechanisms let one service key mean different things in different parts of the plugin tree.
BBeBee leans on both.

### `ctx.isolate(key)` — a private instance of a service

```ts
// Each imported source gets its own HTTP stack: its own cookie jar, its own
// rate limiter, its own host allowlist. They cannot see each other's.
const scoped = ctx.isolate('http')
scoped.plugin(HttpWithCookieJar, { jar: sourceId, rateLimit, allowedHosts })
scoped.plugin(SourceInstance, { record })
```

Inside `scoped`, `ctx.http` is the source-specific stack. Everywhere else it is the shared one.
Every other service — `fs`, `db`, `logger` — is still shared, because only the named key is
isolated. This is exactly the semantics wanted: one slow source's rate limiting cannot stall
another's requests, and cookies never cross a source boundary
([06 §4.1](../sources/runtime.md#41-a-sources-lifetime)).

### `ctx.intercept(key, config)` — same instance, different configuration

```ts
// Same fs service, but this subtree is confined to the plugin's own data directory.
const confined = ctx.intercept('fs', { root: `plugins/${pluginId}`, mode: 'rw' })
```

Interception is how [the capability gate](./capabilities.md#7-capability-model) is implemented, and how per-plugin `store` and `fs`
namespaces are applied without every plugin having to remember to prefix its keys.

---

