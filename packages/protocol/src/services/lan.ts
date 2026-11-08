/**
 * `ctx.lan` — LAN transport: UDP multicast/broadcast datagrams plus a bounded
 * HTTP server and client scoped to the local network.
 *
 * The transport is deliberately dumb. It knows about datagrams and requests,
 * not about devices, sessions or songs — anything a peer could talk to is the
 * business of a Layer 4 feature (see `./lan-share.js`), which is why the
 * protocol state machine stays in JavaScript and survives a platform swap
 * (`core-lan-desktop` today, a native module tomorrow) without a rewrite.
 *
 * Two hard containment rules live in the implementations, not here:
 *   - The HTTP server answers only what a registered `onRequest` handler
 *     replies to, and an unanswered request times out (30 s) with a 504 —
 *     a plugin that stops listening cannot leave a peer's socket hanging.
 *   - `request()` dials private-network addresses only (loopback and
 *     RFC 1918). The capability grant is `lan`, and it is one token for both
 *     directions on purpose: a plugin that may serve the LAN may also talk to
 *     it, and neither half alone is more dangerous than the other.
 *
 * Large bodies never cross the bridge in memory: an upload above the spill
 * threshold lands in a temp file and arrives as `bodyFile`; a response may
 * name a `bodyFile` for the host to stream. Handlers therefore move gigabytes
 * without moving them through the renderer.
 *
 * See docs/services/contracts.md §ctx.lan.
 */

import type { Disposable, Uri } from '../common.js'

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'

/* ── datagrams ──────────────────────────────────────────────────────────── */

/** One UDP datagram as it arrived, with the sender's address. */
export interface LanDatagram {
  /** Dotted-quad source address, e.g. `192.168.1.23`. */
  host: string
  /** Source port. */
  port: number
  data: Uint8Array
}

/* ── server ─────────────────────────────────────────────────────────────── */

export interface LanStartOptions {
  /** UDP port to bind for multicast/broadcast receive. */
  udpPort: number
  /** TCP port to bind the HTTP server. */
  httpPort: number
  /** IPv4 multicast group to join, e.g. `239.255.42.98`. */
  multicastGroup: string
}

/** A server response. Exactly one of `body` / `bodyFile`. */
export interface LanReply {
  status: number
  headers?: Record<string, string>
  body?: Uint8Array
  /** The host streams this file as the response body. */
  bodyFile?: Uri
  /**
   * Stream only the `bodyFile` slice `[bodyFileStart, bodyFileEnd]` — both
   * inclusive, `createReadStream({ start, end })` semantics, end clamped to
   * the file's last byte. This is how a Range/206 reply serves audio seeking
   * without shipping the whole file; omit both to stream the entire file.
   */
  bodyFileStart?: number
  bodyFileEnd?: number
}

/**
 * One inbound HTTP request handed to the server's handler.
 *
 * `reply` must be called exactly once; calling it after the request timed
 * out is a no-op. A body above the host's spill threshold (1 MiB) arrives as
 * `bodyFile` instead of `bodyBytes`.
 */
export interface LanRequestContext {
  id: string
  method: string
  /** Full request URL, e.g. `http://192.168.1.23:53318/api/…`. */
  url: string
  /** Lowercased header names; repeated headers joined with `, `. */
  headers: Record<string, string>
  bodyBytes?: Uint8Array
  bodyFile?: Uri
  reply(reply: LanReply): void
}

/* ── client ─────────────────────────────────────────────────────────────── */

/** A request to a LAN peer. Exactly one of `body` / `bodyFile`. */
export interface LanRequest {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: Uint8Array
  /** The host streams this file as the request body. */
  bodyFile?: Uri
  timeoutMs?: number
}

/** A peer's response. Bodies are in memory — LAN replies are small JSON. */
export interface LanResponse {
  status: number
  headers: Record<string, string>
  body?: Uint8Array
}

/* ── ctx.lan ────────────────────────────────────────────────────────────── */

export interface LanService {
  /** Bind the UDP socket and start the HTTP server. Actual ports returned. */
  start(opts: LanStartOptions): Promise<{ udpPort: number; httpPort: number }>
  stop(): Promise<void>
  readonly running: boolean

  /** Send one datagram. `broadcast: true` targets the subnet broadcast address. */
  sendDatagram(
    target: { host: string; port: number },
    data: Uint8Array,
    opts?: { broadcast?: boolean },
  ): Promise<void>

  /** Subscribe to inbound datagrams. The disposer unsubscribes. */
  onDatagram(cb: (d: LanDatagram) => void): Disposable

  /** Subscribe to inbound HTTP requests. The disposer unsubscribes. */
  onRequest(cb: (req: LanRequestContext) => void): Disposable

  /**
   * HTTP request to a LAN peer. Targets outside loopback / RFC 1918 are
   * refused — this service is the LAN's, not the internet's (`ctx.http`
   * remains the egress point for everything else).
   */
  request(target: { host: string; port: number }, req: LanRequest): Promise<LanResponse>
}

declare module 'cordis' {
  interface Context {
    lan: LanService
  }
}
