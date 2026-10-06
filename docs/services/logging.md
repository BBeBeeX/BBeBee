# Logging Architecture (Layer 3)

> **Legacy Reference:** Formerly `docs/04-core-services.md §16`.

## 16. `ctx.logger` — logging as transport plugins

Cordis provides `ctx.logger` itself, already scoped per plugin, so BBeBee does not define a logging
service. What it adds is **transports**, each an ordinary plugin — and together they are
**Layer 3** of [architecture/layers.md §1](../architecture/layers.md#1-the-layer-model), `packages/logs/*`:

| Plugin | When it runs | Behaviour |
|---|---|---|
| `plugin-log-buffer` | Always | In-memory ring buffer (default 2000 entries) backing the in-app log viewer. Claims `ctx.logBuffer` |
| `plugin-log-console` | Development only | `console.*` with plugin-scoped prefixes, at debug level. Nobody is watching a terminal in a shipped build |
| `plugin-log-file` | Shipped builds only | Rotating NDJSON under `ctx.paths.logs`, size- and count-capped. The log has to survive the app being closed, which is the case the console cannot cover |
| `plugin-log-crash` | *(not built)* | On an unhandled rejection, bundles recent buffer entries plus device info into a file the user may attach to a report. Never uploads anything on its own |

### Why it is a layer

Three rules follow from putting the transports between the core services and the features, and
each closes a way of getting logging wrong that reads as reasonable at the call site:

- **They load from the shell's `bootstrap:` array, not from the registry.** A transport enabled
  through the config allowlist starts *alongside* the feature plugins, so it misses the first
  lines each of them writes — which are the lines worth having when one of them did not start.
  Bootstrap entries are applied in order and awaited, so after the core services and before the
  first feature plugin is a position that actually exists.
- **Nothing above Layer 3 imports a transport.** `ctx.logger` is the whole interface; which sink
  is behind it is the shell's decision, made once, in `boot.ts`. An import would pin one
  implementation into code whose point is not to know, and would keep it loaded for as long as
  the importer lives.
- **`console.*` is an error above Layer 3.** It is not a smaller version of `ctx.logger`: it skips
  the redactor below, and it reaches neither the ring buffer that the log viewer reads nor the
  file a bug report attaches. The shells are the one exemption, because a boot failure can happen
  before any transport is loaded.

One consequence to be deliberate about: **bootstrap entries are not capability-gated**, so
`plugin-log-file` writes with the shell's own `ctx.fs` rather than through the gate that would
otherwise hold it to the `fs:write:logs` its manifest declares. That is the same bargain the core
services get, and for a related reason — a transport that had to be granted a capability before
it could record anything would have no way to report being refused one. The manifest still
declares the minimum, and it is what an M5 registry-loaded transport would be held to.

`conventions.test.ts` also requires every feature plugin to call `ctx.logger` at all. A plugin
that says nothing is not being tidy — it is the one whose failure arrives as an empty screen with
nothing behind it.

```ts
export interface LogRecord {
  sn: number             // Monotonic sequence number within session
  time: number
  level: 'error' | 'warn' | 'info' | 'debug'
  scope: string          // the plugin's name, supplied by Cordis
  message: string
  meta?: Record<string, unknown>
}

export interface LogTransport {
  write(record: LogRecord): void
  flush?(): Promise<void>
}
```

> ⚠️ **Redaction is mandatory.** Transports run a redactor over `meta` and `message` that strips
> anything keyed `token`, `password`, `authorization`, `cookie`, or `refresh_token`, and rewrites
> query strings on URLs. Source rules put credentials in headers and query strings routinely, and
> the test screen's trace ([sources/authoring.md §10](../sources/authoring.md#10-diagnosing-a-broken-source)) exists
> to be copied into a forum thread — so the same redactor runs over traces, not only over logs.

### In-App Diagnostic Views

The desktop diagnostic center (`@BBeBee/plugin-settings-ui-desktop`) exposes real-time telemetry surfaces:

1. **Discover System Logs (`debug.logs`)**:
   Reads directly from `ctx.logBuffer`. Provides live stream inspection, log level filtering (`ALL`, `DEBUG`, `INFO`, `WARN`, `ERROR`), substring search, clipboard export as NDJSON, and one-click buffer clearing.
2. **HTTP Logs (`debug.http-logs`)**:
   Monitors outgoing HTTP requests emitted by third-party music sources and background tasks. The core HTTP client (`core-http-node`) formats traces as `[HTTP] ${method} ${url} -> ${status} (${durationMs}ms)`, which the view parses into structured records with method badges, HTTP status codes, latency in milliseconds, and destination URLs.

---

