# @bbebee/plugin-source-runtime

Layer 4 (feature) — **the only source-document interpreter in the entire repository**: it turns the "music source string" the user imports as text (a declarative JSON rule document) into a playable `MediaProvider`.

## Overview

A music source **is not a plugin** — it is a row in the `sources` table. This package is the only thing that turns a row into a playable entity, and there is no second interpreter to keep in sync ("Sources are rows; this is the only thing that turns one into something playable").

It **owns no service key** (it is not a `Service` subclass): it reads `ctx.sources.sources` and registers one `MediaProvider` for each enabled, interpretable row; each source runs in its own fiber and its own `ctx.isolate('http')`.

- Required injections: `['http', 'db', 'sources']`.
- Optional injections (nested `ctx.inject`, Cordis's way of expressing optional dependencies): `['js']` (the QuickJS sandbox — a build without it still runs every document that needs no `@js:`), `['secrets']` (credential storage). The two are independent: a build may have the sandbox but no keychain, or the reverse.
- Capabilities: `net:host/*` (hosts are unknowable before document import; the per-source narrowing happens on the `startOne` intercept), `db:read:core`, `db:write:core`; contributes the `settings.sources` slot.
- Rule evaluation is entirely delegated to `@BBeBee/source-rules` (pure logic); **all network fetching lives in this package**.

## Source files

### `src/index.ts` — plugin entry and "live source" management

**`SourceRuntime`**:

- `live: Map<sourceId, LiveSource>` — changing one source tears down only that one source.
- **`start()`** — after `sync()`, attaches listeners: `source/imported → sync`, `source/changed → reload(id)`, `source/removed → stop(id)`. Callbacks are wrapped in `safely()` (an uncaught rejection in a fire-and-forget event would take down the import flow that triggered it). ⚠️ `start()` must be called **after** the two nested injections — starting sources loads credentials; starting earlier would read them without a keychain and report signed-in sources as anonymous.
- **`sync()`** — `wanted = sources.filter(r => r.enabled && isInterpretable(r.doc))`. ⚠️ `isInterpretable` is the critical guard: the scanner writes a **rule-less row** for `local`; without the guard a second provider would be registered to compete with the real one. Rows whose document did not change **keep their fiber** (preserving the warm cookie jar); only a changed `docHash` triggers a replace; a single source failing to start only warns, never cascades.
- **`startOne(record)`** — the per-source lifecycle core:
  1. `ctx.isolate('http')` — **one fiber and one isolated HTTP stack per source**: two identically shaped backends cannot see each other's cookies, and one slow source cannot hold up another;
  2. `intercept('http', { scopeId, allowedHosts })` — narrows the wildcard `net:host/*` down to the hosts the document declares;
  3. constructs a `DocumentSource` and attaches `auth.onStatusChange` (expired → emit `source/auth-expired`: expiry is an **event, not an error** — the source stays registered and the cached catalog remains browsable);
  4. `sources.register(this.reporting(provider))` — the disposer is wrapped in a local closure (what crosses the service proxy is not the function the fiber collects); `source.dispose()` releases the realm (a WASM allocation nobody else can reclaim).
- **`reporting(provider)`** — wraps `getTrack`/`resolveStream`, catching `RuleError`, reporting it, then rethrowing. Deduplicated within a 60s window keyed by `sourceId\0block.field` (one bad rule in a 100-track queue = one fact, not one hundred events).
- **Where credentials land is decided by the key** — `secretKeysFor(sourceId)` = `{'var'} ∪ doc.loginUi[].id`, written to `ctx.secrets` (the OS keychain); a build without `ctx.secrets` **refuses to store credentials** rather than degrading into plaintext `source_vars`. Non-credential values go through `ctx.sources.writeVar`, with an in-memory mirror keeping `src.vars.get` synchronously available.
- **`forget(sourceId, scoped)`** — the real implementation of sign-out: **all three storages are attempted** (cookie jar, secrets namespace, source_vars); any failure is collected and a summary error is thrown at the end — the latter two storages hold the passwords themselves, and stopping at the first failure would leave the user stuck in an invisible signed-in state.
- **`trackPayload`/`albumPayload`** — read-only SQL fetching `tracks.raw_json`/`albums.raw_json` (table names are literals at the call site, never derived from input).

### `src/source.ts` — one document → one MediaProvider (1851 lines)

**`DocumentSource`** (exported) and the internal `DocumentAuth`:

- **`DocumentAuth`** — the flow is derived from the document, in priority order: non-empty `loginUi` → `form` (**form takes precedence over variableComment** — presenting a single-line variable box for a two-field login is a screen nobody can complete); otherwise `variableComment` → `variable`; otherwise `none`. `status` is **derived, not snapshotted** (each declared field is checked for existence) — snapshotting at construction would read before the persisted variables load, reporting signed-in sources as anonymous on every restart. `refresh()` single-flights concurrent 401 storms, and once expired never retries (`signIn` is the only clearer) — retrying everything against a backend that returns 401 is credential-stuffing aimed at the user's own server.
- **`DocumentSource`** — the constructor **evaluates no rules** (evaluating during construction once FAILED the whole plugin, leaving every source unusable on every startup).
  - **Realm management**: the `js` adapter wraps `@js:` bodies into async arrows (accepting both expressions and multi-statement bodies with `return`). **One realm per source, lifecycle = the source's lifecycle** (`jsLib` and `src.cache` are state the document accumulates); **a poisoned realm is replaced, not reused** — `ctx.js` retires a realm that exceeds its limits; reusing a dead realm would permanently brick that source after one timeout.
  - **Capability-derived getters** (`searchable`/`browsable`/`albumable`/`lyricable`): two-stage — the document describes it **and** this build can run its rules (`rulesRunnable`; a malformed URL template does not parse as a rule, and `{{source.url}}/x` would be inferred as a CSS selector).
  - **`search(query, page)`** — `searchUrl` goes through `evaluateUrlTemplate` (a URL template is not a selector; `=` may be omitted) → `parseUrlObject` splits URL + options → `assertAllowed` → `withReauth(fetchChecked)` → `evaluateListRule` → `rowToTrack`. The payload (the backend's raw element ∪ the rule-evaluated fields, rules winning) is returned with the results and written into `raw_json` by `ctx.sources`. `hasMore = tracks.length > 0` (backends rarely state a total; inventing one produces a progress bar that lies).
  - **`browse(nodeId?, page?)`** — three stages (explore → ruleExplore → ruleTrackList): the stage is carried by the node id rather than inferred; node ids are self-contained (base64url, still usable after the navigation stack is restored on restart); having a `childUrl` means there is somewhere to go, not having one means it is playable.
  - **`getAlbum(id)`** — `childUrl` comes from the payload stored by browse (without one, the answer is "browse to it once", not "this album does not exist"); when `ruleAlbum.trackListUrl` exists, the songs live in another document.
  - **`getLyrics(id)`** — evaluated against the **track's stored payload** (re-running the search just for lyrics would be absurd); if the rule yields a URL, the lyrics are fetched, otherwise the payload is the lyrics; format `lrc|ttml|plain` or sniffed from `[mm:ss.xx]`.
  - **`resolveStream(id, prefs)`** — the moment a URN becomes bytes. The scope's `track.id` is **spread last** from the caller's value (the id in the stored payload must not override the track being resolved). `ruleStream.url` is evaluated → **`assertAllowed(target)`** — this is the only artifact that leaves this package, fetched directly by `ctx.audio` outside the scoped http; without this check the egress allowlist cannot govern the request that actually carries the bytes. When `seekable` is undeclared, `probe()`: HEAD looks at `Accept-Ranges`, with fine-grained status mapping (405/501=playable, 404/410=NotFound, 401/403=Auth, 429=RateLimit, ≥500=Network) — collapsing all statuses into NotFound once told three lies. The remaining optional fields (`mimeType`/`byteLength`/`expiresAt`/`bitrateKbps`/`quality`/`headers`) go through `renderOptional` one by one, where **`quality` must be one of `STREAM_QUALITIES`** — a document reporting a value that is not a tier would leave downstream unable to compare, so it throws `RuleError` rather than dropping it.
  - **`login()`** — the document writes its own request body (form/JSON); the session lands in the source's own cookie jar; every failure is normalized to `AuthError` (the only question for the caller is "do the credentials work").
  - **`withReauth`** — on `AuthError` with the form flow → refresh once and retry, **retrying only once**; `fetchChecked` runs `doc.loginCheckJs` — no HTTP status can reliably express "the server started serving the login page again".
  - **`debug(step)`** — the tracer entry point; `secrets()` returns the strong redaction list (`var` plus its two `:`-split halves, plus every loginUi field value — a trace is the thing that gets pasted into forums asking for help).

### `src/fetch.ts` — fetching the documents the rules need

- **`parseUrlObject(rendered)`** — the "URL object" syntax `URL,{"method":"POST","body":"q={{key}}"}`; it splits at **the first comma followed by a parseable JSON object** (both the URL and the body may contain commas); a broken options blob leaves the whole string as the URL.
- **`fetchDocument(...)`** — assembles the request → `withRetries` → parses by content type: a payload claiming to be JSON but failing to parse falls back to text ("an HTML error page claiming to be JSON" is common). Returns `{ value, text, baseUrl (after redirects), status }`.
- **`withRetries`** — retries only `isRetryable` failures; backoff `100·2^(i-1)` capped at 2000ms; **the server's own `Retry-After` enjoys a higher ceiling (60s)** — clamping a 4-second wait to 2 seconds guarantees another rejection.
- **`statusError(status, …)`** — status code → error class, sharing one mapping with the probe: **a status code is not a diagnosis** (reading 401 as not-found skips the re-login path; reading 500 as non-retryable turns a blip into a stalled queue).
- **`decode(response, charset)`** — when a charset is present, uses `TextDecoder(charset)`: many audio source sites serve GBK/Big5; unconditionally decoding as UTF-8 produces silently mojibake pages.
- Cookies are not handled in this file — the jar belongs to `ctx.http` (a per-plugin persistent jar); sign-out clears it via the runtime's `forget`.

### `src/capabilities.ts` — deriving capabilities from the document

**Core principle: "Nothing is declared."** What a source can do follows from which rule blocks it contains; **a block that exists but is empty counts as absent** (an empty block is a half-written document).

- **`hasRules(block)`** — the block exists and at least one value is non-blank.
- **`isInterpretable(doc)`** — any rule block has rules, or `searchUrl`/`exploreUrl` exists (guarding the rule-less `local` row written by the scanner).
- **`capabilitiesFor(doc, opts)`** — `opts` is computed by `DocumentSource`'s getters (capability true = the document describes it and the build can run it). Mapping: `search.albums/artists/playlists` are always false (the honest answer is not to guess); **there is no `albums` capability flag** — the existence of `getAlbum` is the signal; `streaming.seekable` comes from the document or the server's `Accept-Ranges` (a stream that cannot range cannot seek; the UI hides the scrub bar); `urlExpiry` = the presence of `ruleStream.expiresAt` is the signal; `rateLimit = parseRate(doc.concurrentRate)` (`'3/1000'` → `{ requests: 3, windowMs: 1000 }`).

### `src/host.ts` — `src`: the entire host surface a source document can see

The docs/06 §8 list is the contract: **no `fetch`, no `require`, no timer that outlives the call, no file system**. The answer to "what can a pasted string do" can be given by reading one file.

- **`createSourceHost(deps)`** — returns `{ cache, functions }`; `functions` are flat functions named `__src_*`, `realm.expose`d one by one — what crosses the boundary is "one call + one cloned value", never a host object graph.
- Two load-bearing properties:
  1. **`src.get`/`src.post` go through the source's own scoped HTTP**, with `assertAllowed` first — the egress allowlist treats **script-computed URLs** the same as template-rendered URLs; bypassing it would make the sandbox a story of isolation with a hole in the middle;
  2. **`src.vars` is credential-grade**: per-source, never exported, cleared on sign-out.
- **`SourceCache`** — in-memory, TTL-bounded, capped at 256 entries + evicts the oldest — "a cache without a ceiling is a leak wearing a friendly name".
- **`SRC_SHIM`** — the realm-side script (preloaded before any `jsLib`): assembles the frozen `globalThis.src`: `get/post`, `parse.json` (`html`/`xml` are **deliberately absent** and throw a clear error when called), `crypto` (md5/sha1/sha256/hmac/base64/randomHex), `cache.get/put`, `vars.get/put`, `url.encode/decode/resolve`, `time.now`, `log`.

### `src/list-rule.ts` — list rule evaluation

- **Two-stage**: `trackList` selects the repeating elements (objects are kept); every other field is evaluated against one of those elements, with `{{item}}` naming it in scope.
- Field rules are parsed by `parseRule` **once per page**, not once per field per row (50 rows × 8 fields used to parse 400 times).
- **Three kinds of "did not get it" are counted separately and never swallowed** (`ListRowsResult`): `dropped` (rows missing a required field or whose evaluation threw — dropped rather than half-finished into the catalog), `duplicates` (a duplicate trackId on the same page would become one URN silently overriding the former), `incomplete` (**optional** field failed — the row is kept, the field is absent; failure ≠ an empty match, but the answer for an optional field is the same: leave it out). Blank means absent (`"  "` would produce an unrecoverable URN).
- **`rowToTrack`** — explicit type narrowing; `coerceDuration` accepts `213`/`"3:33"`/`"213.4s"`, anything else throws `RuleError` — writing a NaN into the catalog only surfaces much later as "the scrub bar does not move". Returns a plain record rather than a `Track` — URN namespacing is the caller's business.
- `RuleSyntaxError` must be wrapped into a `RuleError` (with block/field/sourceId) at this boundary, otherwise it slips past every handler that branches on `code`.

### `src/trace.ts` — the rule tracer

Why a broken source is "fixable" rather than "just broken" (source debug and diagnostic screen, docs/06 §10). Three load-bearing properties:

1. **Streaming, not collecting** — the step that most needs explaining is the one **still running** (a request to a server that stopped answering shows as an `http` line with no status; that is the entire diagnosis);
2. **All steps appear, including successful ones** — failures usually happen two steps before the empty result;
3. **Redacted by default** — Subsonic URLs conventionally carry a password hash and salt.

- **`TraceCollector`** — a hand-written async queue: push never blocks (a slow reader cannot slow down the run being traced); close drains the buffer before ending the iteration (the last events are not lost). The `rule`/`error`/`result` entries all pass through `redactForTrace`; previews are truncated to 400 characters.
- **`tracedHttp(http, collector)`** — wraps an `HttpService`, one line per request (status/ms/bytes; the body can only be consumed once by the caller, so bytes come from the `content-length` header); **on failure it also emits a line with `status: 0`** before rethrowing.

## Trust model and where the allowlist is enforced

A source is a **pasted string**, not first-party code. The sandbox (`ctx.js` QuickJS) **constrains reach, not intent** — no ambient globals, values clone across the boundary, limits enforced by the engine. The allowlist is three layers of defense in depth:

| Enforcement point | Location | Governs |
|---|---|---|
| `assertAllowed` | inside `DocumentSource`, before every fetch (including the stream URL in `resolveStream`) | every URL a template renders |
| `allowedHosts` intercept | inside the isolated `ctx.http` (validated before and after the waterfall) | every HTTP request actually sent |
| `assertAllowed` inside `src.get`/`src.post` | `host.ts` | **script-computed URLs** |

**Credentials never enter the document**: `var` and `loginUi` fields go into `ctx.secrets`, so an exported document is naturally shareable.

## Configuration

```ts
export interface SourceRuntimeConfig {
  defaultRate?: string  // declared, not yet consumed — applied to sources whose document omits concurrentRate (M2 wiring)
}
```

## Events

| Direction | Events |
|---|---|
| Consumes | `source/imported` (→ sync), `source/changed` (→ reload), `source/removed` (→ stop) |
| Emits | `source/rule-failed` (60s dedupe window), `source/auth-expired` (serial) |

## Exports

```ts
export const name = 'plugin-source-runtime'
export const inject = ['http', 'db', 'sources']
export interface SourceRuntimeConfig { defaultRate?: string }
export class SourceRuntime              // start / useJs / useSecrets
export class DocumentSource             // provider() / search / browse / getAlbum / getLyrics / resolveStream / ping / debug / dispose
export { capabilitiesFor, isInterpretable, parseRate }
export async function apply(ctx, config?)
export default { name, inject, apply }
```

## Related docs

- `docs/06-music-sources.md`: source documents, the rule language, trust, debugging
- `packages/feature/source-rules/README.md`: the pure-logic rule engine
- `packages/core/core-js-quickjs-*`: the `ctx.js` sandbox
