/**
 * The wire format between the desktop renderer webview and the host sidecar.
 *
 * Deliberately mechanical: a service name, a method name, and JSON-ish
 * arguments. No domain concept crosses this boundary — `main` does not learn
 * what a track is (docs/02 §2).
 */

/** IPC channel names. One per shape of call, not one per method. */
export const CH = {
  /** `(service, method, args) => result` */
  call: 'BBeBee:call',
  /** `(uri, range) => handle` — opens a chunked read. */
  streamOpen: 'BBeBee:stream:open',
  /** `(handle) => Uint8Array | null` — null ends the stream. */
  streamPull: 'BBeBee:stream:pull',
  streamClose: 'BBeBee:stream:close',
  /**
   * `(request) => head` — performs an HTTP request in `main`.
   *
   * The renderer is a browser context: its `fetch` is subject to CORS and
   * cannot set `Cookie`, `User-Agent` or `Range` freely. A music server run by
   * a stranger sends no `Access-Control-Allow-Origin`, so every remote source
   * would fail for a reason that has nothing to do with the source. Main has
   * no such rules, which is why the transport lives there (docs/02 §2).
   */
  httpOpen: 'BBeBee:http:open',
  /** `(handle) => Uint8Array | null` — null ends the body. */
  httpPull: 'BBeBee:http:pull',
  httpClose: 'BBeBee:http:close',
  /** `() => token` — begins a db transaction that later calls join. */
  txBegin: 'BBeBee:tx:begin',
  txEnd: 'BBeBee:tx:end',
  /**
   * `main → renderer`, the only direction that is not request/response.
   *
   * Needed because some things originate in `main` and cannot be polled: a
   * media key was pressed, the OS is about to suspend. Everything else stays
   * a call, so this channel carries a *topic* and a payload and nothing else.
   */
  event: 'BBeBee:event',
} as const

/** Services reachable over the bridge. */
export type BridgedService = 'fs' | 'db' | 'paths' | 'system' | 'audio'

/**
 * Topics `main` may push to the renderer.
 *
 * Enumerated rather than open, so the renderer cannot be made to dispatch on
 * a topic nothing registered — and so the whole main→renderer surface is one
 * list to read.
 */
export type BridgeEvent =
  /** Exactly `MediaKey` from the protocol — main does the OS-name mapping. */
  | { topic: 'media-key'; key: 'play-pause' | 'next' | 'previous' | 'stop' }
  | { topic: 'hotkey'; accelerator: string }
  | { topic: 'will-suspend' }
  | { topic: 'power'; charging: boolean; level: number }
  | { topic: 'transport'; command: string; positionMs?: number }

/** A request as it crosses the bridge. Plain data — no `Request`, no streams. */
export interface BridgeHttpRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Base64, because a `Uint8Array` in a request body is rare and small. */
  body?: string
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
}

/** What `main` answers before any byte of the body is pulled. */
export interface BridgeHttpHead {
  handle: number
  status: number
  statusText: string
  /** Lowercased names. `set-cookie` is joined with `\n`, never dropped. */
  headers: Record<string, string>
  /** The final URL, after redirects. */
  url: string
  /** False when the response carried no body at all — a HEAD, or a 204. */
  hasBody: boolean
}

export interface BridgeApi {
  call(
    service: BridgedService,
    method: string,
    args: unknown[],
    /** Routes a db call into an open transaction. See main.ts. */
    token?: string,
  ): Promise<unknown>
  streamOpen(uri: string, range?: { start: number; end?: number }): Promise<number>
  streamPull(handle: number): Promise<Uint8Array | null>
  streamClose(handle: number): Promise<void>
  /**
   * Perform a request in `main`.
   *
   * Absent on a preload built before the http host existed, which is why every
   * caller goes through `bridgeFetch()` rather than reaching for it directly.
   */
  httpOpen?(request: BridgeHttpRequest): Promise<BridgeHttpHead>
  httpPull?(handle: number): Promise<Uint8Array | null>
  httpClose?(handle: number): Promise<void>
  /** Returns a token; subsequent `call`s pass it to join the transaction. */
  txBegin(): Promise<string>
  txEnd(token: string, commit: boolean): Promise<void>
  /** Subscribe to `main`'s pushes. Returns an unsubscribe. */
  on(handler: (event: BridgeEvent) => void): () => void
}

declare global {
  interface Window {
    BBeBeeBridge?: BridgeApi
  }
}

export function requireBridge(): BridgeApi {
  const bridge = globalThis.window?.BBeBeeBridge
  if (!bridge) {
    throw new Error(
      'BBeBee: the preload bridge is missing. The renderer cannot reach the ' +
        'filesystem or database without it — check that `preload/index.cjs` loaded.',
    )
  }
  return bridge
}

/**
 * The OS keychain, as `ctx.secrets` needs it.
 *
 * `safeStorage` is main-only, so this is three IPC calls — and no key crosses
 * the bridge in either direction, because there is no key to cross: the OS
 * holds it. Without this the desktop store falls back to XOR against a
 * path-derived key, which is obfuscation rather than protection.
 */
export interface SecretsBridge {
  available(): Promise<boolean>
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
}

/**
 * A `SecretCrypto` over the preload bridge, or `undefined` where there is none.
 *
 * Returning `undefined` rather than throwing is deliberate: a build with no
 * keychain — a Linux box with no libsecret, a test — should still start, with
 * `isHardwareBacked` false so the UI can say what it is running on.
 */
export async function safeStorageCodec(): Promise<{
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
  readonly isHardwareBacked: true
} | undefined> {
  /*
   * Read structurally rather than through a `declare global`.
   *
   * The shell's preload owns the shape of `window.BBeBee` and declares it; a
   * second declaration here would conflict with that one rather than extend
   * it, and this package has no business owning a shape it does not build.
   */
  const exposed = (globalThis as { window?: { BBeBee?: { secrets?: SecretsBridge } } }).window
  const bridge = exposed?.BBeBee?.secrets
  if (!bridge) return undefined
  try {
    const isAvailable = await bridge.available()
    if (!isAvailable) return undefined
  } catch {
    return undefined
  }
  return {
    isHardwareBacked: true,
    encrypt: (plain) => bridge.encrypt(plain),
    decrypt: (cipher) => bridge.decrypt(cipher),
  }
}

/** A serialized error traversing the IPC bridge. */
export interface SerializedBridgeError {
  message: string
  name?: string
  code?: string
  errno?: number
  syscall?: string
  path?: string
  stack?: string
}

/**
 * Result envelope over CH.call to prevent IPC transports from
 * logging unhandled rejections to the terminal for expected operational errors.
 */
export interface BridgeEnvelope<T = unknown> {
  __bbebee_bridge__: true
  ok: boolean
  result?: T
  error?: SerializedBridgeError
}

export function serializeBridgeError(error: unknown): SerializedBridgeError {
  if (error instanceof Error) {
    const err = error as NodeJS.ErrnoException
    return {
      message: err.message,
      name: err.name,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
      path: err.path,
      stack: err.stack,
    }
  }
  return { message: String(error) }
}

export function deserializeBridgeError(data: SerializedBridgeError): Error {
  const err = new Error(data.message)
  if (data.name) err.name = data.name
  if (data.code) (err as NodeJS.ErrnoException).code = data.code
  if (data.errno !== undefined) (err as NodeJS.ErrnoException).errno = data.errno
  if (data.syscall) (err as NodeJS.ErrnoException).syscall = data.syscall
  if (data.path) (err as NodeJS.ErrnoException).path = data.path
  if (data.stack) err.stack = data.stack
  return err
}

export function isBridgeEnvelope(val: unknown): val is BridgeEnvelope {
  return typeof val === 'object' && val !== null && '__bbebee_bridge__' in val
}

export function unwrapBridgeResult<T>(response: unknown): T {
  if (isBridgeEnvelope(response)) {
    if (!response.ok) {
      throw deserializeBridgeError(response.error ?? { message: 'bridge call failed' })
    }
    return response.result as T
  }
  return response as T
}

