/**
 * The main-process host.
 *
 * Runs a headless Cordis context holding the real `core-*-node` services, and
 * exposes their methods over IPC. Reusing those services rather than
 * reimplementing the operations here is what keeps a single home for the
 * behaviour — `main` stays a dispatcher.
 *
 * ⚠️ **The renderer is one security domain.** Anything running there can call
 * this bridge directly (`window.BBeBeeBridge.call(...)`), so the per-plugin
 * capability gate in `FsBridge`/`DbBridge` is *advisory within the renderer*:
 * it constrains a cooperating plugin, not code that chooses to bypass it. The
 * limits enforced here are therefore the ones that do not depend on knowing
 * which plugin is calling — a method allowlist, containment to the app's own
 * directories, and a refusal to let SQL reach other files. See
 * docs/02-architecture.md §2 and docs/03-plugin-system.md §7.
 *
 * Imported only by `apps/desktop/main`, never by the renderer.
 */

import { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import { assertSqlAllowed } from '@BBeBee/kernel'
import { uriContains, type DbService, type FsService, type PathsService } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import {
  CH,
  serializeBridgeError,
  type BridgeEnvelope,
  type BridgeEvent,
  type BridgeHttpHead,
  type BridgeHttpRequest,
  type BridgedService,
} from './protocol.js'

/**
 * The slice of `ipcMain` this host uses.
 *
 * Structural rather than an `electron` import, so the package stays testable
 * without Electron — and so the surface main exposes is visible in one place.
 * `any` matches Electron's own signature; narrowing it would make `ipcMain`
 * fail to satisfy this interface.
 */
export interface IpcHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
  removeHandler(channel: string): void
  /**
   * Push to every renderer. Electron's `webContents.getAllWebContents()` loop,
   * or a single window's `send` — the host decides which, because only it
   * knows how many windows there are.
   */
  broadcast?(channel: string, payload: unknown): void
}

/** What the host can learn about a caller, when Electron provides it. */
interface CallerLike {
  sender?: {
    id?: number
    once?(event: string, listener: () => void): void
  }
}

/**
 * The OS integrations `main` owns and the renderer cannot reach.
 *
 * Supplied by the app rather than imported, for the same reason `IpcHost` is:
 * this package stays testable without Electron, and the surface main exposes
 * stays visible in one place. Every member is optional — a Linux box with no
 * MPRIS daemon, or a build without `globalShortcut`, must cost a feature and
 * not a boot.
 */
export interface SystemHost {
  /** `powerSaveBlocker.start` / `.stop`, keyed by the renderer's lock id. */
  acquireWakeLock?(id: number, reason: string): void
  releaseWakeLock?(id: number): void
  /** Bind or release the OS media keys. */
  watchMediaKeys?(on: boolean): void
  registerHotkey?(accelerator: string): void
  unregisterHotkey?(accelerator: string): void
  /** MPRIS on Linux, SMTC on Windows, Now Playing on macOS. */
  publishNowPlaying?(nowPlaying: unknown): void
  publishPlaybackState?(state: string): void
  setSupportedCommands?(commands: string[]): void
  clearNowPlaying?(): void
}

export interface HostOptions {
  appName?: string
  /** Electron's `app.getPath`, so the OS answers win over XDG guesswork. */
  resolvePath?: (kind: string) => string | undefined
  databaseFileName?: string
  /** Concurrent chunked reads allowed. Bounds file-descriptor use. */
  maxOpenStreams?: number
  /** How long a renderer-driven transaction may stay open before rollback. */
  transactionIdleMs?: number
  /** OS integrations. Absent members are simply unavailable to the renderer. */
  system?: SystemHost
  /**
   * The transport for renderer-issued HTTP.
   *
   * Supplied by the app — Electron's `net.fetch` — rather than imported, for
   * the same reason `IpcHost` is structural: this package stays testable
   * without Electron. Absent means the renderer's own `fetch` keeps being
   * used, which works for same-origin and CORS-friendly hosts and fails for
   * every music server that has never heard of this app.
   */
  httpFetch?: (input: string, init: HttpFetchInit) => Promise<HttpFetchResponse>
  /** Concurrent in-flight bridged requests. Bounds sockets held by one renderer. */
  maxOpenRequests?: number
  /**
   * Ask the user to choose a directory from the OS file dialog.
   * In Electron, this uses `dialog.showOpenDialog`.
   */
  pickDirectory?: (sender?: unknown) => Promise<string | undefined>
  /** Native audio decoding (e.g. FFmpeg) and system device enumeration. */
  audio?: AudioHost
  /** Optional logger for host operations */
  logger?: BridgeLogger
}

export interface BridgeLogger {
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
}

/** Request options for a remote decode input, forwarded to ffmpeg verbatim. */
export interface AudioRequestOptions {
  /** Headers to send with the request — a source's `Referer`, `User-Agent`, etc. */
  headers?: Record<string, string>
}

/** Native audio-engine transport and system device enumeration. */
export interface AudioHost {
  getOutputDevices?(): Promise<unknown>
  setOutputDevice?(id: string): Promise<unknown>
  mpvLoad?(uri: string, options?: { headers?: Record<string, string>; strategy?: string }): Promise<unknown>
  mpvAppend?(uri: string, playNow?: boolean): Promise<unknown>
  mpvPlay?(atMs?: number): Promise<unknown>
  mpvPause?(): Promise<unknown>
  mpvStop?(): Promise<unknown>
  mpvSeek?(positionMs: number): Promise<unknown>
  mpvSetVolume?(volume: number): Promise<unknown>
  mpvSetMuted?(muted: boolean): Promise<unknown>
  mpvSetDspConfig?(config: unknown): Promise<unknown>
  mpvSetVisualizer?(enabled: boolean, fftSize?: number): Promise<unknown>
  mpvGetFftFrame?(): Promise<unknown>
  mpvGetState?(): Promise<unknown>
  mpvGetAudioDevices?(): Promise<unknown>
}

/** The referrer policies Electron's `ClientRequest` accepts. */
export type HttpReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'unsafe-url'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'

/** The slice of `RequestInit` the host forwards. Structural, like `IpcHost`. */
export interface HttpFetchInit {
  method: string
  headers: Record<string, string>
  body?: Uint8Array
  redirect?: 'follow' | 'manual' | 'error'
  signal?: AbortSignal
  /** Always `'omit'`: cookies are `ctx.http`'s job, not the session's. */
  credentials?: 'omit'
  /** Electron's non-standard opt-out from the app's own protocol handlers. */
  bypassCustomProtocolHandlers?: boolean
  /**
   * How Chromium treats a `Referer` header on this request.
   *
   * Not cosmetic: `net.fetch` maps the header onto the URLRequest's *referrer*,
   * and Chromium validates it against this policy before sending. The default,
   * `strict-origin-when-cross-origin`, cancels a cross-origin referrer that
   * carries a path with `ERR_BLOCKED_BY_CLIENT` — which is exactly the
   * video-page referrer a streaming CDN checks. See `httpOpen`.
   */
  referrerPolicy?: HttpReferrerPolicy
}

/** The slice of `Response` the host reads. */
export interface HttpFetchResponse {
  status: number
  statusText: string
  url: string
  headers: {
    forEach(cb: (value: string, key: string) => void): void
    getSetCookie?(): string[]
  }
  body?: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null
}

export interface Host {
  ctx: Context
  /**
   * Push an event to every attached renderer.
   *
   * The only main→renderer direction. `main` calls this when a media key is
   * pressed or a suspend is imminent — things that originate here and cannot
   * be polled.
   */
  emit(event: BridgeEvent): void
  dispose(): Promise<void>
}

/**
 * Methods reachable over the bridge, per service.
 *
 * An allowlist, not a denylist: without it, `call('fs', 'constructor', …)` and
 * every inherited `Object.prototype` member are reachable, and the surface
 * main exposes silently grows with any method added to a service.
 */
const ALLOWED: Record<BridgedService, ReadonlySet<string>> = {
  fs: new Set([
    'dir', 'exists', 'stat', 'list', 'mkdir', 'remove', 'move', 'copy',
    'readFile', 'readBytes', 'writeFile', 'freeSpace', 'toPlayableUri', 'pickDirectory',
  ]),
  db: new Set(['query', 'get', 'exec', 'defineSchema']),
  paths: new Set([
    'appData', 'cache', 'temp', 'logs', 'downloads', 'music', 'pluginData', 'get',
  ]),
  system: new Set([
    'acquireWakeLock', 'releaseWakeLock',
    'watchMediaKeys', 'registerHotkey', 'unregisterHotkey',
    'publishNowPlaying', 'publishPlaybackState', 'setSupportedCommands', 'clearNowPlaying',
  ]),
  audio: new Set([
    'getOutputDevices', 'setOutputDevice',
    'mpvLoad', 'mpvAppend', 'mpvPlay', 'mpvPause', 'mpvStop', 'mpvSeek',
    'mpvSetVolume', 'mpvSetMuted', 'mpvSetDspConfig', 'mpvSetVisualizer',
    'mpvGetFftFrame', 'mpvGetState', 'mpvGetAudioDevices',
  ]),
}

/** fs methods whose leading arguments are Uris that must stay inside the app. */
const URI_ARGS: Record<string, number[]> = {
  exists: [0], stat: [0], list: [0], mkdir: [0], remove: [0],
  move: [0, 1], copy: [0, 1], readFile: [0], readBytes: [0], writeFile: [0],
  freeSpace: [0], toPlayableUri: [0],
}

/*
 * SQL the bridge refuses outright is defined **once**, in the kernel's
 * `assertSqlAllowed`, and shared with the gated path.
 *
 * It used to be a second regex here listing only ATTACH and DETACH, while the
 * kernel's list also carried `VACUUM INTO` — which writes a database file to
 * any path the process can reach. The renderer could call
 * `call('db', 'exec', ["VACUUM INTO '/tmp/x.db'"])` and get exactly the
 * arbitrary-file write that the containment checks here exist to prevent. Two
 * lists drift; one does not.
 */

/**
 * Args for the audio log line, with header *values* removed.
 *
 * Decode calls now carry the source's request headers, and this line used to
 * embed whole args: a `Cookie` or `Authorization` in there would land in the
 * log file. Names stay (they say what the source sends), values go.
 */
function describeAudioArgs(args: unknown[]): string {
  return JSON.stringify(
    args.map((arg) => {
      const headers = (arg as { headers?: unknown } | null | undefined)?.headers
      if (headers && typeof headers === 'object') {
        return { ...(arg as object), headers: Object.keys(headers as object) }
      }
      return arg
    }),
  )
}

export async function createHost(ipc: IpcHost, options: HostOptions = {}): Promise<Host> {
  let markReady!: () => void
  const isReady = new Promise<void>((resolve) => {
    markReady = resolve
  })

  const maxOpenStreams = options.maxOpenStreams ?? 64
  const maxOpenRequests = options.maxOpenRequests ?? 32
  const transactionIdleMs = options.transactionIdleMs ?? 30_000

  const ctx = new Context()
  await ctx.plugin(PathsNode, {
    appName: options.appName ?? 'BBeBee',
    ...(options.resolvePath ? { resolve: options.resolvePath as never } : {}),
  })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: options.databaseFileName ?? 'BBeBee.db' })

  /**
   * The OS surface, with every absent member a no-op.
   *
   * Filled in rather than checked at the call site, so "this build has no
   * MPRIS" reaches the renderer as a call that did nothing rather than as an
   * exception it has to interpret.
   */
  const system: Required<SystemHost> = {
    acquireWakeLock: options.system?.acquireWakeLock ?? (() => {}),
    releaseWakeLock: options.system?.releaseWakeLock ?? (() => {}),
    watchMediaKeys: options.system?.watchMediaKeys ?? (() => {}),
    registerHotkey: options.system?.registerHotkey ?? (() => {}),
    unregisterHotkey: options.system?.unregisterHotkey ?? (() => {}),
    publishNowPlaying: options.system?.publishNowPlaying ?? (() => {}),
    publishPlaybackState: options.system?.publishPlaybackState ?? (() => {}),
    setSupportedCommands: options.system?.setSupportedCommands ?? (() => {}),
    clearNowPlaying: options.system?.clearNowPlaying ?? (() => {}),
  }

  const audio: Required<AudioHost> = {
    getOutputDevices: options.audio?.getOutputDevices ?? (async () => []),
    setOutputDevice: options.audio?.setOutputDevice ?? (async () => {}),
    mpvLoad: options.audio?.mpvLoad ?? (async () => ({ durationMs: 0 })),
    mpvAppend: options.audio?.mpvAppend ?? (async () => {}),
    mpvPlay: options.audio?.mpvPlay ?? (async () => {}),
    mpvPause: options.audio?.mpvPause ?? (async () => {}),
    mpvStop: options.audio?.mpvStop ?? (async () => {}),
    mpvSeek: options.audio?.mpvSeek ?? (async () => {}),
    mpvSetVolume: options.audio?.mpvSetVolume ?? (async () => {}),
    mpvSetMuted: options.audio?.mpvSetMuted ?? (async () => {}),
    mpvSetDspConfig: options.audio?.mpvSetDspConfig ?? (async () => {}),
    mpvSetVisualizer: options.audio?.mpvSetVisualizer ?? (async () => {}),
    mpvGetFftFrame: options.audio?.mpvGetFftFrame ?? (async () => null),
    mpvGetState: options.audio?.mpvGetState ?? (async () => ({ status: 'idle', positionMs: 0, durationMs: 0 })),
    mpvGetAudioDevices: options.audio?.mpvGetAudioDevices ?? (async () => []),
  }

  const services: Record<
    BridgedService,
    () => FsService | DbService | PathsService | Required<SystemHost> | Required<AudioHost>
  > = {
    fs: () => ctx.fs,
    db: () => ctx.db,
    paths: () => ctx.paths,
    system: () => system,
    audio: () => audio,
  }

  function toFileUri(pathOrUri: string): string {
    if (pathOrUri.startsWith('file://')) return pathOrUri.replace(/\/$/, '')
    if (process.platform === 'win32') {
      const clean = pathOrUri.replace(/^\/([a-zA-Z]:)/, '$1')
      const decoded = clean.includes('%') ? decodeURI(clean) : clean
      return pathToFileURL(decoded).href.replace(/\/$/, '')
    }
    if (/^\/?[a-zA-Z]:[\\/]/.test(pathOrUri)) {
      const clean = pathOrUri.replace(/\\/g, '/').replace(/^\//, '')
      const decoded = clean.includes('%') ? decodeURI(clean) : clean
      const drive = decoded[0]!.toUpperCase() + decoded.slice(1)
      return ('file:///' + encodeURI(drive)).replace(/\/$/, '')
    }
    return pathToFileURL(pathOrUri).href.replace(/\/$/, '')
  }

  const extraRoots = new Set<string>()

  try {
    const rows = await ctx.db.query<{ uri: string }>('SELECT uri FROM scan_specified_dirs')
    for (const row of rows) {
      if (row.uri) extraRoots.add(toFileUri(row.uri))
    }
  } catch {
    /* Table may not exist yet in test harnesses without migrations */
  }

  /*
   * Files imported individually — dragged onto the window — are whitelisted by
   * their own uri, and only that: their folders are deliberately *not* scan
   * dirs, so the table above does not cover them and the row the importer
   * wrote is the only record. Without it a dropped track would play until the
   * next restart and then fail containment below.
   */
  try {
    const dropped = await ctx.db.query<{ uri: string }>('SELECT uri FROM scan_dropped_files')
    for (const row of dropped) {
      if (row.uri) extraRoots.add(toFileUri(row.uri))
    }
  } catch {
    /* Same: a database without the migration has no rows to add */
  }

  /**
   * Every location the app is allowed to touch.
   *
   * Not a per-plugin gate — main cannot tell one renderer caller from another —
   * but it does bound the blast radius to the app's own storage, so a bridge
   * call cannot reach `/etc/passwd` or the user's home directory at large.
   */
  const roots = (): string[] =>
    [
      ctx.paths.appData,
      ctx.paths.cache,
      ctx.paths.temp,
      ctx.paths.logs,
      ctx.paths.downloads,
      ctx.paths.music,
    ].filter((r): r is string => typeof r === 'string' && r.length > 0)

  function assertContained(uri: unknown): void {
    if (typeof uri !== 'string') throw new TypeError('bridge: expected a uri')
    // SAF content:// uris are opaque and are granted by the user picking them.
    if (uri.startsWith('content://')) return
    const normalizedUri = uri.startsWith('bbebee-file:')
      ? uri.replace(/^bbebee-file:\/*/, 'file:///')
      : uri
    const allRoots = [...roots(), ...extraRoots]
    if (!allRoots.some((root) => uriContains(root, normalizedUri))) {
      throw new Error(`bridge: ${uri} is outside every application directory`)
    }
  }

  /* ── Generic method dispatch ──────────────────────────────────────── */

  ipc.handle(CH.call, async (event: CallerLike, ...rest): Promise<BridgeEnvelope> => {
    await isReady
    try {
      const [service, method, args, token] = rest as unknown as [
        BridgedService,
        string,
        unknown[],
        string | undefined,
      ]
      // The mpv handle polls state at high frequency — logging each poll
      // floods the console at 40 lines/s.
      const noisyPoll = service === 'audio' && (method === 'mpvGetState' || method === 'mpvGetFftFrame')
      if (service === 'audio' && !noisyPoll) {
        options.logger?.info?.(
          `bridge: audio.${method}(${
            Array.isArray(args) && args.length > 0 ? describeAudioArgs(args) : ''
          }) called`,
        )
      }
      const target = services[service]?.()
      if (!target) throw new Error(`bridge: unknown service "${service}"`)
      if (!ALLOWED[service].has(method)) {
        throw new Error(`bridge: ${service}.${method} is not callable over the bridge`)
      }

      const callArgs = Array.isArray(args) ? args : []
      if (service === 'fs' && method === 'pickDirectory') {
        if (options.pickDirectory) {
          const picked = await options.pickDirectory(event?.sender)
          if (!picked) return { __bbebee_bridge__: true, ok: true, result: undefined }
          const uri = toFileUri(picked)
          extraRoots.add(uri)
          return { __bbebee_bridge__: true, ok: true, result: uri }
        }
      }

      if (service === 'fs') {
        for (const index of URI_ARGS[method] ?? []) assertContained(callArgs[index])
      }
      if (service === 'db' && typeof callArgs[0] === 'string') {
        assertSqlAllowed(callArgs[0], 'the bridge')
        /*
         * Writing a file location through the scanner's tables is what puts it
         * inside the whitelist — the same flow a picked directory follows. It
         * is not a loophole so much as the design: only the scanner's importer
         * and the dialog branch write here, and both record what they let the
         * renderer see.
         */
        if (/scan_(?:specified_dir|dropped_file)/i.test(callArgs[0]) && Array.isArray(callArgs[1])) {
          for (const arg of callArgs[1]) {
            if (
              typeof arg === 'string' &&
              (arg.startsWith('file://') || arg.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(arg))
            ) {
              const uri = toFileUri(arg)
              extraRoots.add(uri)
            }
          }
        }
      }

      // A call carrying a transaction token is routed into that transaction's
      // view rather than the shared service, so it participates in the
      // transaction rather than queuing behind it (see core-db-node).
      if (token) {
        const open = transactions.get(token)
        if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
        open.touch()
        const fn = (open.tx as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
        if (typeof fn !== 'function') throw new Error(`bridge: db has no method "${method}"`)
        const result = await fn.apply(open.tx, callArgs)
        return { __bbebee_bridge__: true, ok: true, result }
      }

      // `paths` is a bag of getters, not methods: a bare property read is the
      // only sensible call shape for it.
      if (service === 'paths' && callArgs.length === 0) {
        const value = (target as unknown as Record<string, unknown>)[method]
        if (typeof value !== 'function') return { __bbebee_bridge__: true, ok: true, result: value }
      }

      const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`bridge: ${service} has no method "${method}"`)
      void event
      const result = await fn.apply(target, callArgs)
      if (service === 'fs' && method === 'pickDirectory' && typeof result === 'string') {
        extraRoots.add(toFileUri(result))
      }
      if (service === 'audio' && !noisyPoll) {
        options.logger?.info?.(
          `bridge: audio.${method} succeeded` +
            (method === 'getOutputDevices' && Array.isArray(result)
              ? ` (${result.length} devices)`
              : ''),
        )
      }
      return { __bbebee_bridge__: true, ok: true, result }
    } catch (error) {
      options.logger?.error?.(`bridge call failed: ${String(error)}`)
      return {
        __bbebee_bridge__: true,
        ok: false,
        error: serializeBridgeError(error),
      }
    }
  })

  /* ── Chunked reads ────────────────────────────────────────────────── */

  let nextHandle = 1
  const readers = new Map<number, ReadableStreamDefaultReader<Uint8Array>>()

  ipc.handle(CH.streamOpen, async (_event, ...rest) => {
    const [uri, range] = rest as unknown as [string, { start: number; end?: number } | undefined]
    assertContained(uri)
    if (readers.size >= maxOpenStreams) {
      // Each open reader holds a file descriptor. A renderer looping
      // streamOpen would otherwise exhaust main's descriptors.
      throw new Error(`bridge: too many open streams (${maxOpenStreams}); close some first`)
    }
    const handle = nextHandle++
    readers.set(handle, ctx.fs.createReadStream(uri, range).getReader())
    return handle
  })

  ipc.handle(CH.streamPull, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    const reader = readers.get(handle)
    if (!reader) throw new Error(`bridge: unknown stream ${handle}`)
    const { done, value } = await reader.read()
    if (done) {
      readers.delete(handle)
      return null
    }
    return value
  })

  ipc.handle(CH.streamClose, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    await readers.get(handle)?.cancel().catch(() => undefined)
    readers.delete(handle)
  })

  /* ── HTTP, performed here rather than in the renderer ─────────────── */

  /**
   * ⚠️ **This is an un-gated egress point.** Anything in the renderer can call
   * it, so it is *not* where a source's `net:host/<glob>` allowlist is
   * enforced — that gate lives in `ctx.http`, which knows which source is
   * asking, and this host cannot (see the security note at the top of this
   * file). What is enforced here is the part that does not need a caller
   * identity: the scheme, and a bound on how many sockets one renderer holds.
   */
  interface OpenRequest {
    reader?: ReadableStreamDefaultReader<Uint8Array>
    abort: AbortController
  }
  const requests = new Map<number, OpenRequest>()

  function closeRequest(handle: number): void {
    const open = requests.get(handle)
    if (!open) return
    requests.delete(handle)
    open.abort.abort()
    void open.reader?.cancel().catch(() => undefined)
  }

  ipc.handle(CH.httpOpen, async (_event, ...rest): Promise<BridgeHttpHead> => {
    const [request] = rest as unknown as [BridgeHttpRequest]
    const httpFetch = options.httpFetch
    if (!httpFetch) throw new Error('bridge: no http transport was configured')
    if (!request || typeof request.url !== 'string') {
      throw new TypeError('bridge: expected an http request')
    }

    // `file:` would turn this into an unbounded file read that skips every
    // containment check above it; custom schemes reach OS protocol handlers.
    const scheme = new URL(request.url).protocol
    if (scheme !== 'http:' && scheme !== 'https:') {
      throw new Error(`bridge: refusing to fetch ${scheme}//`)
    }
    if (requests.size >= maxOpenRequests) {
      throw new Error(`bridge: too many open requests (${maxOpenRequests}); close some first`)
    }

    const abort = new AbortController()
    const timer =
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? setTimeout(() => abort.abort(), request.timeoutMs)
        : undefined

    let response: HttpFetchResponse
    try {
      response = await httpFetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers ?? {},
        ...(request.body ? { body: base64ToBytes(request.body) } : {}),
        ...(request.redirect ? { redirect: request.redirect } : {}),
        signal: abort.signal,
        /*
         * A source that writes `Referer` means it — and Chromium otherwise
         * refuses to send it.
         *
         * Electron's `net.fetch` turns that header into the URLRequest's
         * *referrer*, then validates it against the request's referrer policy
         * before sending. A main-process request has no document to take a
         * policy from, so it defaults to `strict-origin-when-cross-origin`,
         * which for a cross-origin destination computes the origin alone — and
         * when that differs from the header the request is cancelled outright
         * (`ERR_BLOCKED_BY_CLIENT`, "with invalid referrer"). Bilibili's CDN
         * checks the video-page referrer, so the download of a stream URL died
         * there while playback, whose referrer comes from the renderer's own
         * policy, worked.
         *
         * `unsafe-url` is the policy that allows exactly what was written; it
         * is set only when there is a referrer to send, so nothing else changes.
         */
        ...(hasHeader(request.headers, 'referer') ? { referrerPolicy: 'unsafe-url' as const } : {}),
        /*
         * Defence in depth for an un-gated egress point.
         *
         * Electron's `net.fetch` reaches `file:` and any registered custom
         * protocol by default. The scheme check above stops a *direct* attempt;
         * this stops one arriving through a protocol handler the app registered
         * for its own purposes — which the check cannot see, because by then the
         * URL is `https:`.
         */
        bypassCustomProtocolHandlers: true,
        // Cookies belong to `ctx.http`'s per-source jars. Letting the session
        // hold them too would send one source's cookies to another, which is
        // precisely the isolation docs/06 §5.1 promises.
        credentials: 'omit',
      })
    } finally {
      if (timer) clearTimeout(timer)
    }

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    // `Headers.forEach` folds repeated `set-cookie` into one comma-joined
    // string, which is unparseable — an `Expires=Mon, 01 Jan…` contains the
    // separator. `getSetCookie` is the only faithful reading.
    const setCookies = response.headers.getSetCookie?.() ?? []
    if (setCookies.length > 0) headers['set-cookie'] = setCookies.join('\n')

    const handle = nextHandle++
    const reader = response.body?.getReader()
    requests.set(handle, { ...(reader ? { reader } : {}), abort })

    return {
      handle,
      status: response.status,
      statusText: response.statusText,
      headers,
      /*
       * The requested URL, not the transport's idea of it.
       *
       * Electron documents `net.fetch`'s returned `Response.url` as *incorrect*
       * — in as many words — so trusting it would put a wrong base under every
       * relative link a source document resolves. `ctx.http` follows redirects
       * itself, one hop at a time under `redirect: 'manual'`, so the URL that
       * was asked for *is* the URL that answered. A caller that opts into
       * `redirect: 'follow'` gives that up and gets the first hop back, which
       * is the honest answer available here.
       */
      url: request.url,
      hasBody: Boolean(reader),
    }
  })

  ipc.handle(CH.httpPull, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    const open = requests.get(handle)
    if (!open) throw new Error(`bridge: unknown request ${handle}`)
    if (!open.reader) {
      requests.delete(handle)
      return null
    }
    const { done, value } = await open.reader.read()
    if (done) {
      requests.delete(handle)
      return null
    }
    return value
  })

  ipc.handle(CH.httpClose, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    closeRequest(handle)
  })

  /* ── Transactions ─────────────────────────────────────────────────── */

  interface OpenTx {
    tx: DbService
    sessionId: number | undefined
    finish(commit: boolean): void
    touch(): void
  }
  const transactions = new Map<string, OpenTx>()

  /** Roll back and forget every transaction belonging to one renderer. */
  function abortSession(sessionId: number | undefined): void {
    for (const [token, open] of transactions) {
      if (open.sessionId === sessionId) {
        open.finish(false)
        transactions.delete(token)
      }
    }
  }

  ipc.handle(CH.txBegin, async (event: CallerLike) => {
    const sessionId = event?.sender?.id

    // Fail fast rather than deadlock: a second concurrent transaction would
    // queue behind the first, so `started` would never resolve and the
    // renderer would await forever.
    for (const open of transactions.values()) {
      if (open.sessionId === sessionId) {
        throw new Error('bridge: a transaction is already open for this session')
      }
    }

    const token = `tx${nextHandle++}`
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })

    void ctx.db
      .transaction(
        (tx) =>
          new Promise<void>((resolve, reject) => {
            const finish = (commit: boolean) => {
              clearTimeout(idle)
              if (commit) resolve()
              else reject(new Error('rollback'))
            }
            // ⚠️ The transaction is held open by the *renderer*, which may
            // reload, crash, or simply never call txEnd. Main's db queue would
            // then be blocked forever and the app would be unusable until
            // restart — so an unfinished transaction is rolled back.
            let idle = setTimeout(() => {
              transactions.delete(token)
              finish(false)
            }, transactionIdleMs)

            transactions.set(token, {
              tx,
              sessionId,
              finish,
              touch: () => {
                clearTimeout(idle)
                idle = setTimeout(() => {
                  transactions.delete(token)
                  finish(false)
                }, transactionIdleMs)
              },
            })
            started()
          }),
      )
      .catch(() => undefined)
      .finally(() => transactions.delete(token))

    // A renderer reload destroys its WebContents without ever sending txEnd.
    event?.sender?.once?.('destroyed', () => abortSession(sessionId))

    await ready
    return token
  })

  ipc.handle(CH.txEnd, async (_event, ...rest) => {
    const [token, commit] = rest as unknown as [string, boolean]
    const open = transactions.get(token)
    if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
    transactions.delete(token)
    open.finish(commit)
  })

  markReady()

  return {
    ctx,
    emit(event: BridgeEvent) {
      // No-op where the host gave us no way to broadcast, which is what a
      // headless test harness looks like.
      ipc.broadcast?.(CH.event, event)
    },
    async dispose() {
      for (const channel of Object.values(CH)) ipc.removeHandler(channel)
      for (const reader of readers.values()) await reader.cancel().catch(() => undefined)
      readers.clear()
      // Each open request holds a socket and an abort controller. Left behind,
      // they keep `main` alive after the window that opened them is gone.
      for (const handle of [...requests.keys()]) closeRequest(handle)
      for (const open of transactions.values()) open.finish(false)
      transactions.clear()
    },
  }
}

/**
 * Whether a header is present, whatever its casing.
 *
 * `Headers` would normalise this, but the bridge carries plain records on
 * purpose (see `bridgeFetch`) and a source document may spell `Referer` any
 * way it likes.
 */
function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (!headers) return false
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

/**
 * Decode a request body.
 *
 * `Buffer` is not assumed: this module is imported by `main`, where it exists,
 * but the package is also unit-tested in environments that do not guarantee
 * it, and a transport helper is the wrong place to acquire a Node dependency.
 */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
