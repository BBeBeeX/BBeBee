# Core Service Contracts Catalog

> **Legacy Reference:** Formerly `docs/04-core-services.md §2 – §15, §17 – §20`.

## 2. `ctx.http` — outbound HTTP

**Purpose.** A `fetch`-shaped client that is *not* subject to browser rules.

```ts
export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
  /** Named cookie jar. Each music source gets its own via ctx.isolate('http'). */
  jar?: string
  onProgress?: (loaded: number, total?: number) => void
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  url: string                       // after redirects
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  bytes(): Promise<Uint8Array>
  stream(): ReadableStream<Uint8Array>
}

export interface HttpService {
  (req: HttpRequest): Promise<HttpResponse>
  get<T>(url: string, init?: Omit<HttpRequest, 'url' | 'method'>): Promise<T>
  post<T>(url: string, body: unknown, init?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<T>
  /** Download to a Uri with resume support. Used by plugin-download. */
  download(req: DownloadRequest): Promise<{ bytes: number; etag?: string }>
  /**
   * Replace the default `User-Agent` on the next request, no restart.
   * Empty string restores the built-in default; optional — a transport that
   * cannot reconfigure itself may omit it. A source document that declares
   * its own `header` rule still wins.
   */
  setUserAgent?(userAgent: string): void
  /** Persistent per-instance cookie jars. See §2.1. */
  readonly cookies: CookieJarService
  /** In-memory request journal, when this build keeps one. See §2.2. */
  readonly requestLog?: HttpRequestLog
}

export interface DownloadRequest extends HttpRequest {
  to: Uri
  resumeFrom?: number                    // sent as `Range`
  /** Fires once the headers arrive, before any body byte is written. */
  onResponse?: (info: { etag?: string; total?: number }) => void
}
```

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| Backing | Electron `net` module in `main`, streamed to the renderer | React Native `fetch` / `XMLHttpRequest` |
| CORS | Bypassed entirely — this is the reason it routes through `main` | Not applicable on native |
| Arbitrary headers | ✅ `Origin`, `Referer`, `User-Agent`, `Cookie` all settable | ✅ |
| Cookie jar | Chromium `Session` per `persist:` partition | RFC 6265 jar in JS, encrypted at rest |
| Proxy | ✅ System or configured | ⚠️ System proxy only |
| Request journal (§2.2) | ✅ In-memory, capped, detail capture switchable | ❌ not yet implemented |

`ctx.http` is the canonical `waterfall` interception point. Auth injection, retry, rate limiting,
and response caching are all plugins hooking `http/request` rather than features baked into the
client ([architecture/layers.md §5](../architecture/layers.md#5-composition-how-features-reach-each-other)).

**A `Referer` header is Chromium's referrer, not an ordinary header.** Electron's `net.fetch` maps
it onto the URLRequest's referrer and validates it against the request's referrer policy before
sending. A main-process request has no document to take that policy from, so the default
`strict-origin-when-cross-origin` computes the origin alone for a cross-origin destination — and
cancels the request outright (`ERR_BLOCKED_BY_CLIENT`, *"with invalid referrer"*) when the header
says more, which is exactly the video-page URL a streaming CDN's hotlink check wants. The desktop
bridge therefore sets `referrerPolicy: 'unsafe-url'` on every bridged request that carries an
explicit `Referer`, so a source sends what it wrote
(`core-desktop-bridge/src/main.ts`).

### 2.1 Cookie jars

A signed-in music source must stay signed in across restarts
([sources/runtime.md §5.1](../sources/runtime.md#51-session-persistence--cookies-survive-the-app)). Cookie
persistence is therefore part of the platform contract rather than something a source document has
to express in rules.

**A jar belongs to one source.** `ctx.http` reads the scope id from the intercept config the
runtime sets per source ([sources/runtime.md §4.1](../sources/runtime.md#41-a-sources-lifetime)), so two Navidrome
servers get two jars and a cookie set by one is never sent to the other. An ungated caller — the
kernel, a core service, a test — has no scope and therefore no jar, which is correct: there is no
session to keep.

**It is envelope-encrypted, and the platform forces that.** `expo-secure-store` caps a value at
2048 bytes and a jar is routinely larger, so a random key goes to `ctx.secrets` and the jar itself
to a file encrypted under it. Losing the key makes the file bytes — which is exactly what
`signOut()` relies on. `ctx.http` adopts `ctx.secrets` on its own when one exists; a shell that had
to wire that by hand is a shell that can forget to, and forgetting produces an app where signing in
appears to work and never sticks. Without a credential store the jars stay in memory and are honest
about forgetting.

```ts
export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms. Absent means a session cookie — dropped when the jar is cleared. */
  expiresAt?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

export interface CookieJar {
  readonly name: string
  /** Resolves once the persisted jar has been loaded. Await before the first request. */
  readonly ready: Promise<void>
  get(url: string): Promise<Cookie[]>
  set(cookies: Cookie[]): Promise<void>
  /** All cookies, for export or inspection. Never logged. */
  all(): Promise<Cookie[]>
  remove(name: string, domain?: string): Promise<void>
  /** Empties the jar AND deletes its persisted copy. Called by signOut(). */
  clear(): Promise<void>
  /** Resolve once every queued save has landed. */
  flush(): Promise<void>
}

export interface CookieJarService {
  /** Returns the named jar, creating and rehydrating it on first access. */
  jar(name: string): CookieJar
  /** Forget a jar entirely, including its stored bytes. */
  destroy(name: string): Promise<void>
  list(): Promise<string[]>
}
```

Semantics both implementations must satisfy — the shared conformance suite (§18) tests each one:

- A jar is **automatically applied**. Requests made through an `ctx.isolate('http')` scope send
  that scope's cookies and store `Set-Cookie` responses without the caller doing anything.
- `ready` resolves after rehydration. Requests issued before it are queued, never sent bare.
- **Expired cookies are dropped at load**, not replayed.
- `clear()` removes the persisted copy, not just the in-memory one.
- Jars are isolated: writes in one are invisible to another.

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| Storage | `session.fromPartition('persist:BBeBee-<name>')` — Chromium's own cookie store, on disk, with correct expiry/`Secure`/`SameSite` handling for free | RFC 6265 jar in JS, serialised to JSON |
| At rest | Chromium encrypts the store with the OS keychain where one exists | **Envelope encryption**: a random AES key in `ctx.secrets`, ciphertext in the `cookie_jars` table ([data-model/schema.md §4.1](../data-model/schema.md#41-sources-accounts-and-sessions)) |
| Clearing | `session.clearStorageData({ storages: ['cookies'] })` + partition removal | Row deleted, key deleted from `ctx.secrets` |

> ⚠️ **Why mobile does not simply put the jar in `ctx.secrets`.** `expo-secure-store` caps a value
> at **2048 bytes**, and a real session jar — several cookies with long signed values — exceeds
> that routinely. Chunking across keys is fragile under partial writes. Envelope encryption keeps
> the secret small (one key) and the payload unbounded, while preserving the invariant that the
> database never holds a readable credential.

> ⚠️ React Native's `fetch` uses a **shared, app-global** native cookie store on both platforms.
> That is the opposite of what per-instance isolation needs, so `core-http-rn` disables it and
> manages `Cookie` / `Set-Cookie` headers itself. Verify this per RN upgrade: a change in the
> default here silently leaks cookies between sources, which the conformance suite's
> isolation test is there to catch.

### 2.2 The request journal

`ctx.http.requestLog` (optional — a transport with nothing interesting to record should not have
to pretend) is an in-memory journal of the exchanges this service has made, for the HTTP log viewer
in the settings' debug area. One `HttpLogEntry` per exchange:

```ts
export interface HttpLogEntry {
  sn: number                        // monotonic within one app run
  time: number                      // epoch ms, when the request started
  method: string
  url: string
  status?: number                   // absent when the request itself threw
  durationMs?: number
  requestHeaders: Record<string, string>
  requestBody?: string
  responseHeaders: Record<string, string>
  responseBody?: string
  error?: string                    // the failure message on a transport throw
  detailed: boolean                 // whether headers/bodies were recorded at all
}

export interface HttpRequestLog {
  all(): readonly HttpLogEntry[]
  clear(): void
  /** Whether entries *from now on* record headers and bodies. Default on. */
  setCapture(enabled: boolean): void
  captureEnabled(): boolean
}
```

Three properties are load-bearing:

- **Credentials never appear.** `cookie` values are reduced to their names (`buvid3=<redacted>`),
  `authorization`/`proxy-authorization` and `set-cookie` are `<redacted>`. A log the user can
  expand is a log that gets pasted into threads, and the rule that governs traces and exports
  governs it too.
- **The body is captured through a tee**, never by reading the caller's copy — the request the
  caller sees behaves exactly as before, and the journal drains its own branch in the background.
  Only text-shaped bodies (JSON, HTML, plain text, XML) are taken; audio, video, images,
  `octet-stream` and ranged requests are transfers, not documents, and are recorded as summary
  lines. Bodies are capped (200 KB, with a truncation marker).
- **The capture switch is temporal.** `setCapture(false)` means entries *from now on* are summary
  lines (`detailed: false`, no headers, no bodies) and their rows render without an expand
  affordance; entries already recorded keep what they captured. Nothing is persisted — the journal
  is capped (400 entries) and dies with the process.

---

## 3. `ctx.ws` — WebSocket

```ts
export interface WsConnection {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  readonly readyState: 0 | 1 | 2 | 3
}

export interface WsService {
  connect(url: string, opts?: {
    protocols?: string[]
    headers?: Record<string, string>
    onMessage?: (data: string | Uint8Array) => void
    onClose?: (code: number, reason: string) => void
    onError?: (err: Error) => void
  }): WsConnection
}
```

Electron uses `ws` in `main` (which, unlike the renderer's `WebSocket`, can set headers — required
by several music backends). React Native uses its built-in `WebSocket`, which also supports
headers. Reconnection with backoff is a *consumer* concern, not built in.

---

## 4. `ctx.store` — namespaced key/value

For small, frequently read settings. Not for anything you would want to query.

```ts
export interface StoreService {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  /** A view confined to a prefix. Plugins receive a pre-namespaced store. */
  namespace(ns: string): StoreService
}
```

**One implementation serves both platforms** — `core-store-fs`, a JSON document written through
`ctx.fs` with a temp-then-rename so a crash mid-write leaves the previous store intact rather than
a truncated one.

This revises the original plan (a JSON file on desktop, a `kv` table in the app database on
mobile), for two reasons found while building it:

- **Boot order.** `ctx.store` comes up *before* `ctx.db` — the kernel reads configuration through
  `fs` and `store` before a database exists ([architecture/layers.md §3](../architecture/layers.md#3-boot-sequence)).
  A mobile store backed by `db` would invert that.
- **Nothing platform-specific was left.** Once it goes through `ctx.fs`, the two implementations
  were the same code twice, which is drift surface for no benefit.

The size ceiling that ruled out `AsyncStorage` does not apply to a plain file. `await store.set()`
resolves only once the write has landed when `flushDelayMs` is 0; with a batch window it returns
immediately and the pending batch is flushed by the plugin's disposer.

A corrupt store is quarantined (renamed aside) and the app starts with an empty one: settings are
recoverable, an unbootable app is not.

To eliminate redundant startup reads, `StoreConfig` supports optional `initialData: Record<string, unknown>`.
When the host composition root pre-reads `store.json` at boot (for example, to inspect persisted audio
engine preferences before creating services), passing `initialData` seeds the document in memory and
marks it loaded, completely skipping secondary disk I/O.

---

## 5. `ctx.db` — SQL

The workhorse. Everything in [07](../data-model/schema.md) lives here.

```ts
export type SqlValue = string | number | null | Uint8Array

export interface DbService {
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T>

  /**
   * Register a plugin-owned schema. Tables are prefixed with the namespace,
   * migrations are versioned per namespace, and everything is dropped if the
   * plugin is uninstalled with "remove data" selected. See [data-model/migrations.md §6](../data-model/migrations.md#6-plugin-schema-lifecycle).
   */
  defineSchema(namespace: string, migrations: Migration[]): Promise<void>
}

export interface Migration {
  version: number
  up: string | string[]
  /** Optional; the project is forward-only, so this exists only for dev. */
  down?: string | string[]
}
```

| | Electron (`core-db-node`) | Expo (`core-db-expo`) |
|---|---|---|
| Backing | **`node:sqlite`** — ships with Node 22+, which Electron 44 bundles. No native rebuild, no `@electron/rebuild` on every upgrade | `expo-sqlite` |
| WAL | ✅ Enabled | ✅ Enabled |
| Concurrency | Serialized through the `main` host | Serialized in the native module |
| FTS5 | ✅ Available | ✅ Available |
| Capability gate | ✅ | ✅ |

> ⚠️ **One statement per call.** `query`, `get` and `exec` take a single statement and refuse a
> string holding more than one. This is a contract, not a limitation of one driver: `prepare()`
> compiles the *first* statement and discards the rest **silently**, so
> `exec('CREATE TABLE a; CREATE TABLE b')` used to create `a`, resolve successfully, and leave no
> trace that `b` never happened — and a migration written that way recorded its version as applied
> and drifted the schema permanently, with no error to investigate. Pass statements separately, or
> use `up: string[]` in a migration. Semicolons inside string literals are not boundaries.
>
> The gate is on **both** implementations. `core-db-expo` had none at all for a while — `db:own`
> was enforced on desktop and unenforced on mobile — which is precisely the drift the conformance
> suites in §18 exist to catch, and why the `db-scope` suite must run on device and not only in
> Node.

Choosing `node:sqlite` removes the single most annoying maintenance burden in Electron projects —
recompiling `better-sqlite3` against Electron headers on every version bump. Both platforms expose
FTS5, so local library search is one implementation
([data-model/schema.md §4.3](../data-model/schema.md#43-catalogue)).

---

## 6. `ctx.secrets` — credential storage

```ts
export interface SecretsService {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** Remove every secret in this namespace. Used by signOut(). */
  clear(): Promise<void>
  namespace(ns: string): SecretsService
  /** False when no OS keychain is available; callers may warn the user. */
  readonly isHardwareBacked: boolean
  /** Largest value this backend accepts, in bytes. */
  readonly maxValueBytes: number
}
```

Electron: `safeStorage.encryptString` (Keychain / DPAPI / libsecret) with ciphertext in a file
under `userData`. Expo: `expo-secure-store` (Keychain / EncryptedSharedPreferences).

> ⚠️ On Linux without a running secret service, `safeStorage` falls back to plaintext.
> `isHardwareBacked` reports `false` and the UI says so rather than implying safety it lacks.

**Tokens live here and nowhere else.** Never in `ctx.db`, never in the config file, never in a log
line. Each source gets `ctx.secrets.namespace(sourceId)`, and the capability grammar
has no `secrets:all` ([plugins/capabilities.md §7](../plugins/capabilities.md#7-capability-model)).

---

## 7. `ctx.mediaSession` — now playing & transport controls

```ts
export interface NowPlaying {
  title: string
  artist?: string
  album?: string
  /** A local Uri — what an Android notification can render; remote covers are cached first. */
  artworkUri?: Uri
  /** http(s)/data/blob — what Chromium's `MediaMetadata` accepts. `file:` is refused. */
  artworkUrl?: string
  durationMs?: number
  positionMs?: number
  playbackRate?: number
}

export type TransportCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'stop' }
  | { type: 'next' } | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'seek-relative'; deltaMs: number }
  | { type: 'rate'; loved: boolean }

export interface MediaSessionService {
  update(np: NowPlaying): void
  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void
  onCommand(cb: (cmd: TransportCommand) => void): Disposable
  /** Which commands the OS surface will actually display. */
  setSupportedCommands(types: TransportCommand['type'][]): void
  clear(): void
}
```

| | Electron (`core-media-session-electron`) | Expo (`core-media-session-rn`) |
|---|---|---|
| Backing | Chromium's `navigator.mediaSession`, plus MPRIS (Linux), SMTC (Windows), and the macOS Now Playing centre via `main` | `react-native-audio-api`'s notification/lock-screen controls |
| Lock screen artwork | `artworkUrl` only | `artworkUri` only — remote artwork is cached first |

**Artwork is two fields because the two surfaces can render different things.** Chromium's
`MediaMetadata` accepts `http(s)`, `data:` and `blob:` and refuses `file:` outright — with a
warning on every assignment, so a cached local cover republished by the 1 Hz position tick is a
warning a second, forever. An Android notification is the reverse: it can read a local file and
cannot reach a URL that only the renderer holds. A caller publishes whichever it has, each
implementation renders the one it can and ignores the other, and the protocol keeps `artworkUri`
documented as "must be local" so neither side starts guessing.

The service also **republishes metadata only when it changed**: `plugin-player` calls
`update()` on the position tick, and rebuilding `MediaMetadata` per second is a lock-screen
re-render plus an artwork retry. Position moves through `setPositionState`, which is separate in
the browser API for exactly this reason.

---

## 8. `ctx.notify` — user notifications

```ts
export interface NotifyService {
  show(n: { id?: string; title: string; body?: string; iconUri?: Uri; silent?: boolean }): Promise<string>
  dismiss(id: string): Promise<void>
  onActivated(cb: (id: string) => void): Disposable
  requestPermission(): Promise<'granted' | 'denied'>
}
```

Electron `Notification` (no permission prompt) versus `expo-notifications` (permission required on
both platforms; callers must handle `denied` without breaking).

---

## 9. `ctx.background` — long work and wake locks

The service that makes [architecture/layers.md §4](../architecture/layers.md#4-what-background-means) actionable.

```ts
export interface BackgroundService {
  /** True when work may continue with the app not in the foreground. */
  canRunInBackground(): boolean
  /** Keep the process alive for foreground-ish work. Release promptly. */
  acquireWakeLock(reason: string): Promise<Disposable>
  /**
   * Register deferrable periodic work. On mobile this is the OS scheduler:
   * `intervalMinutes` is a *hint*, and a run may be hours late or skipped.
   */
  schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable>
  /** Fires before the host suspends. Checkpoint here. */
  onWillSuspend(cb: () => void | Promise<void>): Disposable
}
```

Electron: `powerSaveBlocker` plus plain intervals; `canRunInBackground()` is `true`.
Expo: `expo-background-task` plus the audio session; `canRunInBackground()` is `true` only while
audio holds the process.

---

## 10. `ctx.paths` — well-known locations

```ts
export interface PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  /** Undefined where the platform has no shared music folder (iOS). */
  readonly music?: Uri
  pluginData(pluginId: string): Uri
  get(kind: WellKnownDir): Uri | undefined
}
```

Trivial, but having it as a service is what lets `ctx.fs` stay path-agnostic.

---

## 11. `ctx.device` — environment and input

```ts
export interface DeviceService {
  readonly platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux'
  readonly formFactor: 'phone' | 'tablet' | 'desktop'
  readonly appVersion: string
  readonly locale: string

  network(): Promise<{ online: boolean; type: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'; metered: boolean }>
  onNetworkChange(cb: (s: { online: boolean; type: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'; metered: boolean }) => void): Disposable

  battery(): Promise<{ level: number; charging: boolean } | undefined>

  /** Desktop only; resolves to a no-op disposer on mobile. */
  onMediaKey(cb: (key: 'play-pause' | 'next' | 'previous' | 'stop') => void): Disposable
  registerHotkey(accelerator: string, cb: () => void): Disposable
}
```

`network().metered` is load-bearing: the download policy engine
([data-model/schema.md §4.8](../data-model/schema.md#48-downloads)) uses it to hold cellular transfers.

---

## 12. `ctx.crypto`

```ts
export interface CryptoService {
  randomBytes(n: number): Uint8Array
  randomUUID(): string
  digest(algo: 'sha1' | 'sha256' | 'md5', data: Uint8Array | string): Promise<Uint8Array>
  hmac(algo: 'sha1' | 'sha256', key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array>
  /** Streaming digest for verifying large downloads without buffering. */
  digestStream(algo: 'sha256', stream: ReadableStream<Uint8Array>): Promise<Uint8Array>
  /** AES-GCM, used for envelope-encrypted cookie jars on mobile. */
  encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>
  decrypt(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>
}
```

`node:crypto` versus `expo-crypto`. `md5` is present only because the Subsonic API's auth scheme
requires it; it is not used for anything security-bearing.

---

## 13. `ctx.codec` — decoding and metadata

The bridge between bytes on disk and something the audio engine can use.

```ts
export interface AudioMetadata {
  title?: string; artist?: string; albumArtist?: string; album?: string
  trackNo?: number; discNo?: number; year?: number; genre?: string[]
  durationMs?: number; bitrateKbps?: number; sampleRate?: number
  channels?: number; bitDepth?: number; codec?: string
  replayGainTrack?: number; replayGainAlbum?: number
  isrc?: string; musicbrainzTrackId?: string
  lyrics?: string
  hasArtwork: boolean
  tagTypes?: string[]
}

export interface CodecService {
  /** Read tags without decoding audio. Must not read the whole file. */
  readMetadata(uri: Uri): Promise<AudioMetadata>
  readArtwork(uri: Uri): Promise<Uint8Array | undefined>
  /** Decode to PCM for waveform rendering, gain analysis, or short samples. */
  decode(data: Uint8Array | Uri): Promise<{ sampleRate: number; channels: number; pcm: Float32Array[] }>
  probeDuration(uri: Uri): Promise<number>
  supportedFormats(): string[]
}
```

Electron: `music-metadata` in `main` for tags; Web Audio `decodeAudioData` for PCM, with an FFmpeg decode bridge (`audio.decodePcm`) for ALAC, 24/32-bit Hi-Res, and audiophile formats (APE, WavPack, DSF, DFF). Remote `http(s)` inputs carry the source's request headers (e.g. `Referer`) through `probe`/`decodePcm`; ffmpeg receives them as `-user_agent`/`-headers`.
Expo: `react-native-audio-api`'s `AudioDecoder` for PCM plus a native tag reader.

> ⚠️ `supportedFormats()` differs by platform and OS version. On desktop, FFmpeg integration covers ALAC, APE, WavPack, DSF, DFF, WMA alongside standard formats. The scanner records what it could not decode instead of silently skipping, so the user can see why a file did not import.

---

## 14. `ctx.shell` — leaving the app

```ts
export interface ShellService {
  openExternal(url: string): Promise<void>
  revealInFileManager(uri: Uri): Promise<void>   // no-op on mobile
  share(content: { uri?: Uri; text?: string; title?: string }): Promise<void>
  /** OAuth: opens a browser and resolves on redirect to the registered scheme. */
  openAuthSession(url: string, redirectUri: string): Promise<{ url: string } | { cancelled: true }>
}
```

`openAuthSession` is what makes the `webview` login flow of
[sources/runtime.md §5](../sources/runtime.md#5-authentication-and-session) work identically: `expo-web-browser`'s
auth session on mobile, a `BrowserWindow` with a navigation listener on desktop. The cookies it
collects land in that source's jar (§2.1), which is the whole point.

---

## 15. `ctx.i18n`

```ts
export interface I18nService {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>): string
  /** Plugins ship their own catalogues; disposed with the plugin. */
  register(namespace: string, catalogues: Record<string, Record<string, string>>): Disposable
  onLocaleChange(cb: (locale: string) => void): Disposable
}
```

One implementation, shared. Locale detection comes from `ctx.device.locale`.

---


---

## 17. Runtime compatibility checklist

Concrete things that must be configured for Cordis and these services to run on Hermes and in a
sandboxed renderer. Each has bitten real projects.

| Concern | Requirement |
|---|---|
| **ESM + `exports` maps** | `cordis` is `"type": "module"` with an `exports` map. Metro needs `unstable_enablePackageExports: true` in `metro.config.js`. Vite handles it natively |
| **`Proxy` and `Symbol.for`** | Cordis's DI is built on them. Hermes supports both; do not enable any Proxy-stripping transform |
| **Standard decorators** | `@Inject` is a **2023-11 standard decorator**, not the legacy form. TS: `"target": "ES2022"` with no `experimentalDecorators`. Babel: `@babel/plugin-proposal-decorators` with `{ version: '2023-11' }` |
| **`AggregateError`** | Thrown by `ctx.parallel()` when listeners reject. Present in current Hermes; keep a polyfill in the mobile entry if the RN version is bumped downward |
| **`Symbol.asyncIterator`** | Used by async effect cleanup. Ensure the Babel preset does not downlevel it away |
| **Node builtins** | `cordis` imports none. If a dependency of a *core* plugin does, it belongs in `main`, not the renderer, and never in the mobile bundle |
| **`ReadableStream` / `WritableStream`** | Used by `ctx.fs` and `ctx.http`. Available in the renderer; on RN 0.86 verify presence and polyfill with `web-streams-polyfill` in the mobile entry if absent |
| **`structuredClone`** | Used by the desktop IPC bridge. Available in Electron; not needed on mobile |
| **A second JS engine** | `ctx.js` (§19) embeds QuickJS: a WASM build in the renderer, a native module on mobile. It is a native dependency, so mobile needs a dev-client rebuild when it lands, and the WASM asset must be bundled rather than fetched — the CSP forbids fetching it |

---

## 18. Contract tests

Every core service ships with a **shared conformance suite** in
`packages/protocol/src/conformance/`, exported as a function taking a service factory. Each
implementation runs it — `core-fs-node` under Vitest in Node, `core-fs-expo` under a Detox/device
test on a real simulator.

```ts
// packages/core/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

This is how the abstraction stays honest. Without it, the two implementations of `ctx.fs` drift
within a month, and every drift becomes a platform-specific bug in a feature plugin that did
nothing wrong. The suite is the executable form of this document.

---

## 19. `ctx.js` — the sandboxed evaluator

**Purpose.** Evaluate a snippet of untrusted JavaScript and get a value back, in a realm that
shares nothing with the app.

It exists for exactly one caller today: `plugin-source-runtime`, whose rules are written by
strangers ([sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)). It
is a core service rather than part of that plugin because embedding an interpreter means shipping
native code, which only `core-*` may do ([architecture/layers.md §1](../architecture/layers.md#the-invariant)).

**Implemented by `core-js-quickjs-node`** (desktop and Node) on QuickJS compiled to WebAssembly.
Not `node:vm`, and the difference is the whole point: `vm` shares an object graph with the host,
so a script reaching `this.constructor.constructor` is out, and every published mitigation for
that is a blocklist someone eventually walks around. QuickJS is a separate interpreter — there is
no host object graph to reach, because there are no host objects in it.

⚠️ **`js` is an optional injection.** A build without a sandbox still runs every document that
needs no scripting, and derives the affected capabilities as *absent* for the rest rather than
offering a button that cannot work. Cordis treats every key in a plugin's own `inject` as
required, so this is expressed as a nested `ctx.inject(['js'], …)` — listing it at the top level
would mean one missing core service takes the whole source runtime down with it.

```ts
export interface JsRealm {
  /**
   * Evaluate `code` with `scope` bound as globals. Resolves with the completion
   * value, structured-cloned out of the realm — never a live reference into it.
   */
  eval<T = unknown>(code: string, scope?: Record<string, unknown>): Promise<T>
  /** Install a host function callable from inside. Arguments arrive cloned. */
  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable
  /** Evaluate once at realm creation — the source document's `jsLib`. */
  preload(code: string): Promise<void>
  dispose(): void
  readonly disposed: boolean
}

export interface JsLimits {
  /**
   * Wall clock for one uninterrupted stretch of engine execution.
   *
   * ⚠️ Not the whole call. A script that awaits hands control back, and each
   * continuation is a fresh stretch — so this bounds *loops*, which is what it
   * is for. An implementation that armed it only around the initial evaluation
   * leaves every continuation unbounded, which is a freeze rather than a
   * timeout.
   */
  timeoutMs: number
  /** Wall clock for one eval including everything it awaits — [sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)'s "10s with network". */
  budgetMs: number
  /** Heap ceiling. Exceeding it throws JsMemoryError. */
  memoryBytes: number
  /** Cap on the size of a returned value, before cloning. */
  maxResultBytes: number
}

export interface JsService {
  /** A fresh realm with nothing in it but ECMAScript builtins. */
  createRealm(limits?: Partial<JsLimits>): Promise<JsRealm>
  readonly engine: { name: string; version: string }
}

export class JsTimeoutError extends Error {}
export class JsMemoryError extends Error {}
```

| | Electron (`core-js-quickjs-node`) | Expo (QuickJS JSI via shell) |
|---|---|---|
| Backing | `quickjs-emscripten-core` with a single-file WASM variant, embedded in the renderer bundle | A QuickJS JSI module (`react-native-quick-js`) |
| Isolation | A separate WASM instance per realm | A separate `JSRuntime` per realm |
| Interrupts | QuickJS interrupt handler, checked on backward jumps | Same |
| Async | Host functions may return promises; the realm's job queue is driven by the host | Same |

Rules the contract is built around, each of which a naive embedding gets wrong:

- **No ambient globals.** A realm starts with ECMAScript builtins and nothing else — no `fetch`,
  no timers, no `console`, no module loader. Everything a caller wants available must be
  `expose`d by name, which is what makes the host surface in
  [sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do) an exhaustive
  list rather than a summary.
- **Lazy WASM compilation.** In `core-js-quickjs-node`, `[Service.init]()` returns immediately;
  the QuickJS WASM module is compiled and cached on demand on the first `createRealm()` call,
  preventing WebAssembly compilation from adding 100~300ms to initial app startup.
- **Values cross by cloning, never by reference.** Nothing inside the realm can retain a live
  object from the host, so it cannot walk the object graph to reach a service — the failure that
  makes same-realm "sandboxes" worthless.
- **Limits are enforced by the engine, not by convention.** A `while (true)` is interrupted, not
  waited on. This is the reason for a second engine rather than a `Worker`: a worker cannot be
  memory-capped and can only be killed, losing the diagnostic.
- **A realm is disposable and cheap.** One per source, disposed with that source's fiber. A leaked
  realm is a leaked native handle, so it is registered through `ctx.effect()` like any other.
- **`engine` is reported** so a rule can branch on it and a trace can record it. Two QuickJS
  builds are not identical, and a source that works on desktop and not on mobile must be
  debuggable rather than mysterious.

> ⚠️ **The sandbox bounds reach, not intent.** Code in a realm still sees everything the host
> passes in and can send it wherever the host's exposed functions allow — which is why the source
> runtime pairs this with a per-source **host allowlist** on `ctx.http`
> ([plugins/capabilities.md §7](../plugins/capabilities.md#capability-grammar)). An evaluator without an egress limit is a
> containment story with a hole in the middle.

---

## 20. `ctx.theme` — color management & theme service

**Purpose.** Manage application visual themes, runtime theme registration, token-to-CSS variable injection, and custom theme persistence.

```ts
export interface ColorTokens {
  bg: { app: string; primary: string; secondary: string; tertiary: string }
  surface: { s1: string; s2: string; s3: string; hover: string; active: string; selected: string }
  brand: { primary: string; primaryActive: string; primaryHover: string; accent: string; accentHover: string }
  gradient: { brand: string; progress: string; blueViolet?: string; ice?: string; spectrum?: string }
  text: { primary: string; secondary: string; tertiary: string; muted: string; disabled: string; placeholder: string }
  border: { subtle: string; default: string; hover: string; active: string; focus: string }
  semantic: { success: string; warning: string; error: string; info: string }
  music: { playing: string; lyrics: string; lyricsActive?: string; lyricsHighlight?: string; waveform: string; waveformActive: string }
  glow: { xs: string; sm: string; md: string; lg: string; [k: string]: string | undefined }
}

export interface ThemeDefinition {
  id: string
  name: string
  description?: string
  isDark: boolean
  tokens: ColorTokens
  lightTokens?: ColorTokens
  cssVariables?: Record<string, string>
  lightCssVariables?: Record<string, string>
}

export interface ThemeService {
  /** Returns all available themes (built-in and runtime registered). */
  getThemes(): readonly ThemeDefinition[]
  /** Returns the active theme snapshot. */
  getCurrentTheme(): ThemeDefinition
  /** Returns the currently active effective color scheme ('dark' or 'light'). */
  getEffectiveScheme(): 'dark' | 'light'
  /** Switches the active theme by id and persists the preference. */
  setTheme(themeId: string): Promise<void>
  /** Registers a new theme at runtime. Returns a disposer. */
  registerTheme(theme: ThemeDefinition): Disposable
  /** Removes a custom theme. Built-in themes cannot be removed. */
  removeTheme(themeId: string): boolean
  /** Subscribes to theme changes. */
  onThemeChange(listener: (theme: ThemeDefinition, scheme?: 'dark' | 'light') => void): Disposable
}
```

| | Electron (Desktop DOM) | Expo (Mobile / Native) |
|---|---|---|
| Backing | `@BBeBee/plugin-theme` with `applyThemeToDom` injecting CSS custom properties on `document.documentElement` | `@BBeBee/plugin-theme` emitting reactive theme snapshot for `StyleSheet` consumption |
| Persistence | `ctx.store` key `theme_active_id` + custom themes under `theme_custom_themes` | `ctx.store` |
| Built-in Themes | `midnight-purple` (`Bee Music · Cyber Neon`), `spotify` (`Spotify Classic`) | Same |
| Custom Themes | Dynamic JSON import (file / text) with fallback token hydration; deletable with fallback protection | Same |

- **DOM Synchronization**: `plugin-theme` evaluates `themeToCssVariables(theme)` and injects them onto the root document element, alongside `data-theme="{id}"`.
- **Protection of Built-In Themes**: `removeTheme(themeId)` rejects removal of built-in themes. If an active custom theme is deleted, it immediately falls back to the default theme (`midnight-purple`).
- **Event Bus Integration**: Emits `theme/changed` when active theme changes, and `theme/registry-changed` whenever themes are added or removed.

---

## 21. `ctx.nowPlaying` — now playing presentation & sandboxed styles

**Purpose.** Manage full-screen Now Playing player layout styles (`classic`, `cinematic`, `full-cover`, `vinyl`, `compact`), dynamic plugin registration, store/settings synchronization, and secure sandboxed execution of external player themes.

```ts
export type BuiltinNowPlayingStyleId = 'classic' | 'full-cover' | 'vinyl' | 'compact' | 'cinematic'
export type NowPlayingStyleId = BuiltinNowPlayingStyleId | (string & {})
export type NowPlayingStyleType = 'builtin' | 'sandboxed'

export interface NowPlayingStyleMeta {
  id: NowPlayingStyleId
  name: string
  description: string
  icon: string
  type?: NowPlayingStyleType
  author?: string
  version?: string
  htmlContent?: string
  entryUrl?: string
  config?: Record<string, unknown>
}

export interface SandboxPlayerLyricLine {
  timeMs?: number
  text: string
  translation?: string
}

export interface SandboxPlayerSnapshot {
  cover: string | null
  coverThemeColor: string | null
  title: string
  artist: string
  album?: string
  lyrics: {
    lines: SandboxPlayerLyricLine[]
    activeIndex: number
  }
  positionMs: number
  durationMs: number
  isPlaying: boolean
  isLoved: boolean
}

export type SandboxPlayerAction =
  | { type: 'action:play' }
  | { type: 'action:pause' }
  | { type: 'action:togglePlay' }
  | { type: 'action:previous' }
  | { type: 'action:next' }
  | { type: 'action:seek'; positionMs: number }
  | { type: 'action:toggleFavorite' }

export interface NowPlayingService {
  getStyle(): NowPlayingStyleId
  getStyles(): readonly NowPlayingStyleMeta[]
  setStyle(id: NowPlayingStyleId): void
  registerStyle(meta: NowPlayingStyleMeta): Disposable
  removeStyle(id: string): boolean
}
```

| | Electron (Desktop DOM) | Expo (Mobile / Native) |
|---|---|---|
| Backing | `@BBeBee/plugin-now-playing` + `SandboxedLayout` (iframe `sandbox="allow-scripts"`, `origin: null`) | `@BBeBee/plugin-now-playing` (native layout switching) |
| Persistence | `ctx.store` keys `now-playing.style` & `now-playing.custom-styles`, bi-directionally synced with `settings.nowPlayingStyle` | Same |
| Built-in Styles | `classic`, `cinematic`, `full-cover`, `vinyl`, `compact` | `classic`, `cinematic`, `full-cover`, `vinyl`, `compact` |
| Sandboxed Plugins | Third-party HTML/CSS/JS executed inside isolated iframe; communicates exclusively via postMessage with strict whitelist validation | Fallback to built-in styles |

- **Security Sandbox Guarantee**: Sandboxed external plugins have zero access to the host DOM, parent window, cookies, storage, Cordis context, or platform SDKs.
- **Strict Data Whitelist (`SandboxPlayerSnapshot`)**: Only 8 core playback fields are projected (`cover`, `coverThemeColor`, `title`, `artist`, `lyrics`, `positionMs`/`durationMs`, `isPlaying`, `isLoved`).
- **Strict Action Whitelist (`SandboxPlayerAction`)**: Only whitelisted transport/playback commands are honored (`play`, `pause`, `togglePlay`, `previous`, `next`, `seek`, `toggleFavorite`).
- **Active Fallback Protection**: Removing a custom plugin currently in use automatically resets active layout to `'classic'`.

---

## 22. `ctx.share` — sharing & steganography service

**Purpose.** Cross-platform sharing of tracks, playlists, albums, and lyrics via structured metadata serialization, Base64 envelopes, and visual image steganography (LSB encoding).

```ts
export type ShareType = 'track' | 'playlist' | 'lyrics' | 'album'

export interface PixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray | Uint8Array
}

export interface ShareMetadataEnvelope<T = unknown> {
  version: 1
  app: 'BBeBee'
  type: ShareType
  createdAt: number
  data: T
}

export interface ShareTrackData {
  urn: string
  title: string
  artist: string
  albumTitle?: string
  artwork?: string
  duration?: number
  source?: string
  sourceUrn?: string
  extra?: Record<string, unknown>
}

export interface SharePlaylistData {
  urn: string
  name: string
  description?: string
  artwork?: string
  trackCount: number
  tracks?: Array<{
    urn: string
    title: string
    artist: string
    albumTitle?: string
    artwork?: string
    duration?: number
  }>
  source?: string
  extra?: Record<string, unknown>
}

export interface ShareAlbumData {
  urn: string
  title: string
  artist?: string
  artwork?: string
  year?: number
  trackCount: number
  tracks?: Array<{
    urn: string
    title: string
    artist: string
    albumTitle?: string
    artwork?: string
    duration?: number
  }>
  source?: string
  extra?: Record<string, unknown>
}

export interface ShareLyricsData {
  trackUrn: string
  title: string
  artist: string
  albumTitle?: string
  artwork?: string
  lines: string[]
}

export interface ShareService {
  encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData>(
    type: ShareType,
    data: T,
  ): string
  decodeMetadata(base64: string): ShareMetadataEnvelope | null
  encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer
  decodeSteganography(buffer: PixelBuffer): string | null
  shareTrack(track: ShareableTrack): void
  sharePlaylist(
    playlist: { urn: string; name: string; description?: string; artwork?: string },
    tracks?: readonly ShareableTrack[],
  ): void
  shareAlbum(
    album: { urn: string; title: string; artist?: string; artwork?: string; year?: number; trackCount?: number },
    tracks?: readonly ShareableTrack[],
  ): void
  shareLyrics(track: ShareableTrack, lines: string[]): void
  openImport(): void
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| Headless service | `@BBeBee/plugin-share` | `@BBeBee/plugin-share` |
| UI implementation | `@BBeBee/plugin-share-ui-desktop` | Planned (`plugin-share-ui-mobile`) |
| Steganography algorithm | Universal LSB (Least Significant Bit) RGBA encoder/decoder | Same |
| Artwork fidelity | Preserves original remote HTTP/HTTPS artwork URL in steganography payload, with automatic local canvas fallback extraction on import | Same |
| Card layout | Pure Canvas rendering with 100% live preview synchronization, non-distorting 1:1 center-cropped artwork, 3-line text wrapping, adaptive height | Planned mobile parity |

- **LSB Steganography Payload**: Metadata is JSON-serialized, Base64-encoded, and embedded across the lowest bits of the image pixels, remaining completely invisible to the human eye while fully recoverable.
- **Remote Artwork Preservation**: When sharing items with cached or local file paths, `plugin-share` preserves the original HTTP/HTTPS artwork URL in the steganography payload so recipients can fetch high-resolution artwork across devices.
- **Local Fallback Extraction**: If an imported share card contains an unreachable or offline artwork URL, `ImportShareModal` extracts the cover directly from the uploaded share image canvas via bounding box coordinates.
- **Local Source Restrictions**: Tracks, playlists, and albums with local-only URN schemes are protected with warning banners and disabled actions, preventing unplayable local files from being shared to other machines.

---

## 23. `ctx.settings` — application settings & contribution registry

**Purpose.** Persistent user preferences, audio output configuration (backend selection, WASAPI exclusive mode, device routing), theme preferences, and an open contribution registry allowing headless and UI plugins to register settings sections, cards, and links dynamically without hardcoding them into the settings screens.

```ts
export interface SettingsContribution {
  kind?: 'settings'
  id: string
  section: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'about' | (string & {})
  title: string
  description?: string
  order?: number
  icon?: string
  actionText?: string
  display?: 'card' | 'link' | 'auto'
  action?: () => void | Promise<void>
  schema?: ParamSchema
}

export interface SettingsService {
  get(): Promise<AppSettings>
  getSync(): AppSettings
  update(partial: Partial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
  onSettingsChange(listener: (settings: AppSettings) => void): Disposable
  contribute(contribution: SettingsContribution): Disposable
  getContributions(): readonly SettingsContribution[]
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| Headless service | `@BBeBee/plugin-settings` | `@BBeBee/plugin-settings` |
| UI implementation | `@BBeBee/plugin-settings-ui-desktop` | `@BBeBee/plugin-settings-ui-mobile` |
| Persistence | `ctx.store` namespace `settings` with schema migrations | Same |
| Reactive Events | `'settings/changed'`, `'settings/contributions-changed'` | Same |

- **Decoupled Contribution Model**: Plugins (`plugin-dsp`, `plugin-sources`, `plugin-download`, `plugin-history`, `plugin-visualizer`) declare their settings views or navigation rows via `ctx.ui.contribute({ kind: 'settings', ... })` or `ctx.settings.contribute(...)`.
- **Dynamic Category Grouping**: The settings screen groups contributions by `section`, sorting by `order`. Unloaded plugins clean up their contributions automatically via Cordis disposers.

---

## 24. `ctx['plugin-manager']` — plugin inspection, dependencies & lifecycle manager

**Purpose.** Headless plugin inspection and lifecycle manager for BBeBee plugins. Provides real-time aggregation of plugin manifests and runtime fiber states from `ctx.inspector`, dynamic bi-directional dependency calculation (declared dependencies + runtime inject edges, reverse dependent scanning), configuration status evaluation, and persistent enable/disable control via `ctx.store` bridging to composition root lifecycle hooks.

```ts
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
}

export type PluginRuntimeState =
  | 'PENDING'
  | 'LOADING'
  | 'ACTIVE'
  | 'FAILED'
  | 'DISPOSED'
  | 'UNLOADING'
  | 'UNLOADED'
  | 'UNKNOWN'

export type ConfigStatus = 'none' | 'customized' | 'default'

export interface PluginLifecycleBridge {
  loadPlugin: (id: string) => Promise<unknown>
  unloadPlugin: (id: string) => Promise<void>
}

export interface PluginManagerService {
  list(): readonly PluginInfo[]
  setEnabled(id: string, enabled: boolean): Promise<void>
  registerManifests(manifests: Record<string, PluginManifest>): void
  setLifecycleBridge(bridge: PluginLifecycleBridge): void
  refresh(): readonly PluginInfo[]
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| Headless service | `@BBeBee/plugin-manager` | `@BBeBee/plugin-manager` |
| UI implementation | `@BBeBee/plugin-settings-ui-desktop` | Planned (`plugin-settings-ui-mobile`) |
| Persistence | `ctx.store` namespace `plugin-manager` (`Record<string, boolean>`) | Same |
| Reactive Events | `'plugin-manager/enabled-changed'`, `'plugin-manager/changed'` | Same |

- **Layer Invariants & Bridge**: Headless Layer 4 plugins are strictly forbidden from importing the bootstrap kernel surface (`createApp`, `app.loadPlugin`). Dynamic loading and unloading is bridged at the composition root (`apps/desktop/renderer/boot.ts`) via `registerBridge` and the `'plugin-manager/enabled-changed'` event.
- **L4/L5 Manifest Decoupling**: Manifest records generated during build time are injected into `plugin-manager` at boot via config or `setManifests`, ensuring Layer 4 never imports UI or code-generation packages.
- **Reverse Dependency Resolution**: Dependents are dynamically computed across all known manifests and live fiber inject edges in real time. Disabling plugins with active dependents triggers confirmation guards in the settings UI.

---

## 25. `ctx.contentRegistry` — third-party content registry

**Purpose.** The in-app index of third-party content and its updates. The community registry ([B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry), discovered dynamically as a DMS-style metadata index — [sources/registry.md](../sources/registry.md)) indexes four kinds of installable content: music sources, lyric sources, themes and desktop plugins. Music sources, lyric sources, and plugins are pointers to their respective author repositories, while themes live directly in the registry. This service fetches the registry index via GitHub Contents API (with offline cache fallback), compares it against what the user already has, and installs through the services that own each kind — `ctx.sources.import`, `ctx.lyricSources.registerSource`, `ctx.theme.registerTheme`, and the desktop dynamic loader. It is deliberately a thin coordinator: it validates nothing a downstream service already validates and hides nothing a user must see before confirming.

> ⚠️ **The service key is `contentRegistry`, not `registry`.** On cordis 4 the `registry` key belongs to the kernel itself — its plugin-registry service, whose methods surface as `ctx.plugin` / `ctx.inject`.

```ts
export type RegistryEntryKind = 'music-source' | 'lyric-source' | 'theme' | 'plugin'

export interface RegistryEntry {
  readonly id: string
  readonly kind: RegistryEntryKind
  readonly name: string
  /** Latest published semver. Absent = "not versioned"; update checks skip such entries. */
  readonly version?: string
  readonly author?: string
  readonly description?: string
  readonly updatedAt?: string
  readonly downloadUrl?: string
  /** Optional; enforced in UI via minAppVersionBlock. */
  readonly minAppVersion?: string
  /** music-source only: the document's backend URL (installed-source matching key). */
  readonly sourceUrl?: string
  /** theme/plugin only */
  readonly previewUrl?: string
  /** plugin only */
  readonly repoUrl?: string
  readonly sha256?: string
  readonly capabilities?: readonly string[]
}

export interface RegistryUpdate {
  readonly kind: RegistryEntryKind
  readonly id: string
  readonly name: string
  readonly installedVersion: string
  readonly availableVersion: string
  readonly downloadUrl?: string
  /** True when the installed copy is a built-in (today: the builtin- lrclib lyric source). */
  readonly builtin?: boolean
}

export interface RegistryService {
  /** Fetches the registry index (endpoint configurable via store), caching the last good copy for offline use. */
  getIndex(force?: boolean): Promise<RegistryIndex>
  /** Compares installed content against the index; fires 'registry/updates-available' with the result. */
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  /** The previous checkUpdates() result (for badges without re-fetching). */
  updates(): readonly RegistryUpdate[]
  /** Fetches the distribution document for an entry and returns what the confirm dialog must show. */
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  /** Installs/updates one entry. The caller must already have shown the user the details (hosts / plugin risk). */
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
  /** Composition root sets this so plugin-kind installs can reach the desktop dynamic host. */
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
}
```

| | Electron (Desktop) | Expo (Mobile) |
|---|---|---|
| Headless service | `@BBeBee/plugin-registry` | `@BBeBee/plugin-registry` |
| Persistence | `ctx.store` keys `registry.index-cache` (last good index, offline use) and `registry.prefs` (endpoint override, `lastCheckAt`) | Same |
| Reactive Events | `'registry/updates-available'` — fired after **every** completed check (automatic or manual) with the full update list, **including the empty list** (which clears badges) | Same |
| Plugin-kind installs | Desktop dynamic host, wired via `setPluginInstaller` at the composition root | Not supported (desktop-only distribution) |

- **Matching semantics**: music sources match installed records by `sourceUrl` (the `SourceRecord` identity), lyric sources / themes / plugins by their `id`. An installed copy older than the entry's `version` produces a `RegistryUpdate`.
- **Install flows per kind**: music source → `ctx.sources.import` (full import pipeline, `originUri` = `downloadUrl`); lyric source → shape-check then `ctx.lyricSources.registerSource`; theme → the same dark/light contrast gate a user-drafted theme goes through, then `ctx.theme.registerTheme`; plugin → refuse if the entry publishes no `sha256`, verify the downloaded bundle against the digest, then hand to the dynamic host.
- **Security red lines**: `fetchEntryDetails()` exists so the confirm dialog can name a music document's `allowedHosts` before import; plugin installs verify `sha256` and require an explicit risk confirmation; downloaded plugins undergo security audits via `@BBeBee/plugin-security-audit` checking 7 threat patterns, and integrity is locked in `registry.lock.json` to detect tampering.
- **Automatic checks**: `AppSettings.registryAutoCheck` (default `true`) — first check ~45 s after boot, then every 24 h; manual checks run regardless.

---

## 26. Where to go next

[05 — Audio & Playback](../audio/playback.md) builds the playback engine and DSP chain on top of
these services.


