/**
 * The sidecar-side LAN transport — `createLanHost`.
 *
 * Runs in the Node sidecar, where `node:dgram` and `node:http` actually
 * exist. The renderer never sees a socket: inbound datagrams and HTTP
 * requests are pushed to it as `BBeBee:event` broadcasts, replies and
 * outbound requests come back as bridge calls (see `main.ts`'s `lan`
 * dispatch, which is the only path from a renderer to this object).
 *
 * Containment this host enforces on its own behalf, beyond the dispatch's:
 *
 *   - `request()` dials private addresses only, honouring the `ctx.lan`
 *     contract even when driven in-process (tests, future callers).
 *   - An inbound request body above `bodySpillBytes` spills to a temp file —
 *     a multi-gigabyte upload never materialises in memory — and a total
 *     size cap answers 413 rather than filling the disk.
 *   - An inbound request nobody replies to within `replyTimeoutMs` answers
 *     504, so a crashed handler cannot hold a peer's socket open forever.
 *
 * Large bodies live in files end to end: an upload arrives as `bodyFile`, a
 * response may name a `bodyFile` to stream, and outbound uploads stream the
 * file off disk. Bytes cross the bridge only when they are small.
 */

import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CH, isPrivateLanHost } from '@bbebee/core-desktop-bridge/protocol'
import type { BridgeLogger, LanHost } from '@bbebee/core-desktop-bridge/main'

export interface LanStartSpec {
  udpPort: number
  httpPort: number
  multicastGroup: string
}

export interface LanHostOptions {
  logger?: BridgeLogger
  /**
   * The push channel for datagrams and inbound requests. The sidecar passes
   * its NDJSON `broadcast`; tests may collect the payloads instead.
   */
  broadcast?: (channel: string, payload: unknown) => void
  /** Inbound request bodies above this spill to a temp file. Default 1 MiB. */
  bodySpillBytes?: number
  /** Total inbound request body ceiling — over it, the request gets a 413. Default 8 GiB. */
  maxBodyBytes?: number
  /** How long an unanswered request is held before it answers 504. Default 30 s. */
  replyTimeoutMs?: number
  /** Outbound request timeout when the caller names none. Default 30 s. */
  requestTimeoutMs?: number
  /** Where spill files land. Default the OS temp directory. */
  tempDir?: string
  /**
   * Inbound datagrams admitted per second before rate limiting sheds them.
   * Announce/control traffic sits well under this even with a floor full of
   * peers. Default 40.
   */
  datagramRatePerSec?: number
  /** Token-bucket burst allowed above the steady datagram rate. Default 80. */
  datagramBurst?: number
  /** Datagrams larger than this are dropped unread. Default 8 KiB. */
  maxDatagramBytes?: number
  /**
   * In-flight inbound requests held before new ones answer 503. Every entry
   * pins a socket and a timer, and each one becomes a renderer event, so the
   * table — and with it the renderer event storm — must be capped. Default 128.
   */
  maxPendingRequests?: number
}

interface PendingReply {
  res: ServerResponse
  timer: ReturnType<typeof setTimeout>
}

/** Inverse of the fs-side uri conversion: a `file://` uri back to a path. */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri)
    } catch {
      // Unencoded characters the URL parser refuses — decode by hand.
      return decodeURIComponent(uri.slice('file://'.length))
    }
  }
  // The host may hand a bare path (tests, platform-specific callers).
  if (/^[a-zA-Z]:[\\/]/.test(uri) || uri.startsWith('/')) {
    return uri.includes('%') ? decodeURIComponent(uri) : uri
  }
  throw new TypeError(`lan: not a file uri: ${uri}`)
}

/** Clamp a wire-supplied index into `[min, max]`, falling back when absent or malformed. */
function clampIndex(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** Token-bucket state for inbound datagram rate limiting. */
export interface DatagramGate {
  tokens: number
  lastMs: number
  droppedTotal: number
}

/**
 * Decide whether one inbound datagram may be forwarded to the renderer.
 *
 * UDP is unauthenticated: any host on the segment can spray packets, and
 * every forwarded datagram costs a base64 encode, a bridge line, and a
 * renderer-side decode. The gate refills `ratePerSec` tokens each second up
 * to `burst`; anything above that — or above `maxDatagramBytes` — is dropped
 * and counted. Pure apart from mutating `gate`: inject `nowMs` so tests can
 * drive time without sleeping.
 */
export function admitDatagram(
  gate: DatagramGate,
  byteLength: number,
  nowMs: number,
  ratePerSec: number,
  burst: number,
  maxDatagramBytes: number,
): boolean {
  if (byteLength > maxDatagramBytes) {
    gate.droppedTotal++
    return false
  }
  if (gate.lastMs === 0) {
    gate.tokens = burst
  } else {
    const elapsedSec = Math.max(0, nowMs - gate.lastMs) / 1000
    gate.tokens = Math.min(burst, gate.tokens + elapsedSec * ratePerSec)
  }
  gate.lastMs = nowMs
  if (gate.tokens < 1) {
    gate.droppedTotal++
    return false
  }
  gate.tokens -= 1
  return true
}

/** Live transport counters, for the metrics system. */
export interface LanHostStats {
  datagramsDropped: number
  requestsRejectedBusy: number
  pendingRequests: number
}

export function createLanHost(options: LanHostOptions = {}): LanHost & { dispose(): Promise<void>; stats(): LanHostStats } {
  const spillBytes = options.bodySpillBytes ?? 1024 * 1024
  const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024 * 1024
  const replyTimeoutMs = options.replyTimeoutMs ?? 30_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  const datagramRatePerSec = options.datagramRatePerSec ?? 40
  const datagramBurst = options.datagramBurst ?? 80
  const maxDatagramBytes = options.maxDatagramBytes ?? 8 * 1024
  const maxPendingRequests = options.maxPendingRequests ?? 128

  const datagramGate: DatagramGate = { tokens: 0, lastMs: 0, droppedTotal: 0 }
  let requestsRejectedBusy = 0

  const log = options.logger
  const push = (payload: unknown): void => {
    options.broadcast?.(CH.event, payload)
  }

  let udp: UdpSocket | undefined
  let server: Server | undefined
  let boundUdpPort = 0
  let boundHttpPort = 0
  let spillDir: string | undefined
  const pending = new Map<string, PendingReply>()

  function nextSpillPath(): string {
    if (!spillDir) throw new Error('lan: no spill directory — start() first')
    return join(spillDir, `req-${randomUUID()}.body`)
  }

  /** Read the request body, spilling past `spillBytes` into a temp file. */
  function readBody(req: IncomingMessage): Promise<{ bytes?: Buffer; file?: string }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      let spilled: { path: string; stream: Writable } | undefined
      let settled = false
      const done = (result: { bytes?: Buffer; file?: string }) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      req.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > maxBodyBytes) {
          const tooLarge = new Error(`lan: request body exceeds ${maxBodyBytes} bytes`)
          ;(tooLarge as { statusCode?: number }).statusCode = 413
          if (spilled) spilled.stream.destroy()
          req.destroy(tooLarge)
          reject(tooLarge)
          return
        }
        if (spilled) {
          spilled.stream.write(chunk)
          return
        }
        if (total > spillBytes) {
          const path = nextSpillPath()
          const stream = createWriteStream(path)
          stream.on('error', (err) => reject(err))
          for (const earlier of chunks) stream.write(earlier)
          chunks.length = 0
          stream.write(chunk)
          spilled = { path, stream }
          return
        }
        chunks.push(chunk)
      })
      req.on('error', (err) => {
        if (spilled) spilled.stream.destroy()
        reject(err)
      })
      req.on('end', () => {
        const finish = () => {
          done(
            spilled
              ? { file: spilled.path }
              : total > 0
                ? { bytes: Buffer.concat(chunks) }
                : {},
          )
        }
        if (spilled) spilled.stream.end(finish)
        else finish()
      })
    })
  }

  function handleIncoming(req: IncomingMessage, res: ServerResponse): void {
    // Every held request pins a socket, a timer, and one renderer event. The
    // 30 s timeout bounds each entry's lifetime, but a flood within the
    // window would still accumulate without bound — reject at the cap.
    if (pending.size >= maxPendingRequests) {
      requestsRejectedBusy++
      if (requestsRejectedBusy === 1 || requestsRejectedBusy % 100 === 0) {
        log?.warn?.(`lan: rejected ${requestsRejectedBusy} requests — ${maxPendingRequests} already pending`)
      }
      try {
        res.writeHead(503, { 'content-type': 'text/plain' })
        res.end('lan: too many pending requests')
      } catch {
        /* the peer hung up first — nothing left to answer */
      }
      return
    }
    void readBody(req)
      .then((body) => {
        const id = randomUUID()
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(req.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : (value ?? '')
        }
        const url = `http://${req.headers.host ?? 'unknown'}${req.url ?? '/'}`

        const entry: PendingReply = {
          res,
          timer: setTimeout(() => {
            // Nobody answered: answer for them, so the peer's socket closes.
            if (pending.delete(id)) {
              try {
                res.writeHead(504, { 'content-type': 'text/plain' })
                res.end('lan: handler did not reply in time')
              } catch {
                /* the peer hung up first — nothing left to answer */
              }
            }
          }, replyTimeoutMs),
        }
        pending.set(id, entry)
        // A peer that walks away mid-transfer must not keep the entry alive.
        res.on('close', () => {
          clearTimeout(entry.timer)
          pending.delete(id)
        })

        push({
          topic: 'lan-request',
          id,
          method: req.method ?? 'GET',
          url,
          headers,
          ...(body.file ? { bodyFile: pathToFileURL(body.file).href } : {}),
          ...(!body.file && body.bytes && body.bytes.length > 0
            ? { body: body.bytes.toString('base64') }
            : {}),
        })
      })
      .catch((err) => {
        const status = (err as { statusCode?: number }).statusCode ?? 400
        log?.warn?.(`lan: inbound request failed: ${String(err)}`)
        try {
          res.writeHead(status, { 'content-type': 'text/plain' })
          res.end(String(err))
        } catch {
          /* socket already gone */
        }
      })
  }

  async function start(spec: LanStartSpec): Promise<{ udpPort: number; httpPort: number }> {
    if (server || udp) return { udpPort: boundUdpPort, httpPort: boundHttpPort }
    spillDir = await mkdtemp(join(options.tempDir ?? tmpdir(), 'bbebee-lan-'))

    const socket = createSocket('udp4')
    socket.on('message', (msg, rinfo) => {
      // Rate/size gate before the payload can cost a base64 encode and a
      // renderer event. Announce traffic from a realistic floor is dozens of
      // packets per second; anything above that is noise or an attack.
      if (!admitDatagram(datagramGate, msg.length, Date.now(), datagramRatePerSec, datagramBurst, maxDatagramBytes)) {
        if (datagramGate.droppedTotal === 1 || datagramGate.droppedTotal % 500 === 0) {
          log?.warn?.(`lan: datagram gate dropped ${datagramGate.droppedTotal} packets total`)
        }
        return
      }
      push({
        topic: 'lan-datagram',
        host: rinfo.address,
        port: rinfo.port,
        data: msg.toString('base64'),
      })
    })
    socket.on('error', (err) => {
      log?.warn?.(`lan: udp socket error: ${String(err)}`)
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(spec.udpPort, () => {
        socket.removeListener('error', reject)
        resolve()
      })
    })
    socket.setBroadcast(true)
    try {
      socket.addMembership(spec.multicastGroup)
    } catch (err) {
      // Some interfaces refuse group membership (isolated containers, missing
      // multicast routes). Broadcast announce still works; say so rather than
      // fail the boot.
      log?.warn?.(`lan: multicast membership for ${spec.multicastGroup} failed: ${String(err)}`)
    }
    udp = socket
    boundUdpPort = socket.address().port

    const http = createServer((req, res) => handleIncoming(req, res))
    http.keepAliveTimeout = 0
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(spec.httpPort, () => {
        http.removeListener('error', reject)
        resolve()
      })
    })
    server = http
    boundHttpPort = (http.address() as AddressInfo).port
    log?.info?.(`lan: listening (udp ${boundUdpPort}, http ${boundHttpPort}, group ${spec.multicastGroup})`)
    return { udpPort: boundUdpPort, httpPort: boundHttpPort }
  }

  async function stop(): Promise<void> {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      try {
        entry.res.destroy()
      } catch {
        /* already gone */
      }
    }
    pending.clear()

    const socket = udp
    udp = undefined
    boundUdpPort = 0
    if (socket) socket.close()

    const http = server
    server = undefined
    boundHttpPort = 0
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve())
      })
    }
    if (spillDir) {
      await rm(spillDir, { recursive: true, force: true }).catch(() => undefined)
      spillDir = undefined
    }
    log?.info?.('lan: stopped')
  }

  async function sendDatagram(
    target: { host: string; port: number },
    data: Uint8Array,
    opts?: { broadcast?: boolean },
  ): Promise<void> {
    if (!isPrivateLanHost(target.host)) {
      throw new Error(`lan: refusing to send a datagram to ${target.host} — outside the local network`)
    }
    void opts
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const socket =
      udp ??
      createSocket('udp4').on('error', (err) => {
        log?.warn?.(`lan: datagram socket error: ${String(err)}`)
      })
    const owned = socket !== udp
    await new Promise<void>((resolve, reject) => {
      socket.send(buffer, target.port, target.host, (err) => (err ? reject(err) : resolve()))
    })
    if (owned) socket.close()
  }

  async function request(
    target: { host: string; port: number },
    req: {
      method?: string
      path: string
      headers?: Record<string, string>
      body?: Uint8Array
      bodyFile?: string
      timeoutMs?: number
    },
  ): Promise<{ status: number; headers: Record<string, string>; body?: Uint8Array }> {
    if (!isPrivateLanHost(target.host)) {
      throw new Error(`lan: refusing to dial ${target.host} — outside the local network`)
    }
    const path = req.path.startsWith('/') ? req.path : `/${req.path}`
    const url = `http://${target.host}:${target.port}${path}`

    const headers: Record<string, string> = { ...req.headers }
    let body: ReadableStream<Uint8Array> | Uint8Array | undefined
    if (req.bodyFile) {
      const filePath = uriToPath(req.bodyFile)
      const size = (await stat(filePath)).size
      headers['content-length'] = String(size)
      body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    } else if (req.body && req.body.byteLength > 0) {
      body = req.body
    }

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), req.timeoutMs ?? requestTimeoutMs)
    try {
      const response = await fetch(url, {
        method: req.method ?? 'GET',
        headers,
        // `Uint8Array` is a valid `BodyInit` at runtime; the DOM lib's union
        // is narrower than what undici accepts.
        ...(body ? { body: body as unknown as BodyInit, duplex: 'half' as const } : {}),
        signal: abort.signal,
      })
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value
      })
      // LAN replies are small JSON. A peer claiming more than this in
      // `content-length` is refused before a byte is read; the buffer below
      // is the honest cost of a well-behaved peer.
      const maxResponseBytes = 16 * 1024 * 1024
      const declared = Number(responseHeaders['content-length'] ?? '0')
      if (declared > maxResponseBytes) {
        throw new Error(`lan: peer response body of ${declared} bytes exceeds the ${maxResponseBytes} byte cap`)
      }
      const buffer = await response.arrayBuffer()
      return {
        status: response.status,
        headers: responseHeaders,
        ...(buffer.byteLength > 0 ? { body: new Uint8Array(buffer) } : {}),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function replyRequest(
    id: string,
    reply: {
      status: number
      headers?: Record<string, string>
      body?: Uint8Array
      bodyFile?: string
      bodyFileStart?: number
      bodyFileEnd?: number
    },
  ): Promise<void> {
    const entry = pending.get(id)
    if (!entry) return // timed out or the peer walked away — a documented no-op
    pending.delete(id)
    clearTimeout(entry.timer)
    const { res } = entry
    const headers = { ...reply.headers }
    try {
      if (reply.bodyFile) {
        const filePath = uriToPath(reply.bodyFile)
        const size = (await stat(filePath)).size
        // An optional slice serves Range/206 replies — audio seeking — without
        // the whole file crossing the wire. Everything is clamped: the values
        // crossed the bridge, so they are peer data, not trusted constants.
        const start = clampIndex(reply.bodyFileStart, 0, 0, Math.max(size - 1, 0))
        const end = clampIndex(reply.bodyFileEnd, size - 1, start, Math.max(size - 1, 0))
        const length = Math.max(0, end - start + 1)
        if (!headers['content-length']) headers['content-length'] = String(length)
        res.writeHead(reply.status, headers)
        if (length <= 0) {
          res.end()
          return
        }
        // No callback: `stream/promises.pipeline` takes none — a rejection
        // lands in the catch below, which destroys the socket.
        await pipeline(createReadStream(filePath, { start, end }), res)
        return
      }
      const bytes = reply.body ?? new Uint8Array(0)
      if (!headers['content-length']) headers['content-length'] = String(bytes.byteLength)
      res.writeHead(reply.status, headers)
      res.end(bytes)
    } catch (err) {
      log?.warn?.(`lan: failed to answer request ${id}: ${String(err)}`)
      try {
        res.destroy()
      } catch {
        /* already gone */
      }
    }
  }

  return {
    start,
    stop,
    sendDatagram,
    request,
    replyRequest,
    dispose: () => stop(),
    stats: (): LanHostStats => ({
      datagramsDropped: datagramGate.droppedTotal,
      requestsRejectedBusy,
      pendingRequests: pending.size,
    }),
  }
}
