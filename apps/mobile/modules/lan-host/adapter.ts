/**
 * The pure half of the native LAN-host binding: the adapter that shapes the
 * `BbebeeLanHost` Expo module into the `LanService` contract
 * (`@BBeBee/protocol`, services/lan.ts).
 *
 * Split from `index.ts` for the same reason the audio engine's and the
 * http-proxy module's are: this file has no `expo` import, so unit tests can
 * exercise the mapping without a native runtime. `index.ts` is the only file
 * that touches `requireNativeModule`, and `boot.ts` is the only file that
 * loads it.
 *
 * ## Containment
 *
 * The `ctx.lan` contract is enforced here, at the only seam a mobile caller
 * passes through (there is no sidecar on this platform): `sendDatagram` and
 * `request` refuse hosts outside the private ranges — the same grammar as
 * `core-desktop-bridge`'s `isPrivateLanHost`, duplicated because a core
 * package cannot import a module inside `apps/`. File-referencing replies
 * are checked against caller-supplied roots by the core service, not here —
 * this layer is shape-only.
 *
 * ## Bodies
 *
 * Base64 in both directions for small bodies, exactly like the desktop
 * bridge. Large inbound bodies never enter JS: the native side spills them
 * to a temp file and the event names the path (`bodyFile`), and a reply may
 * name a `bodyFile` (with an optional inclusive slice) for the native side
 * to stream — that is what makes Range/206 audio serving work without
 * moving gigabytes through Hermes.
 */

import type { Disposable, LanDatagram, LanReply, LanRequestContext, LanRequest, LanResponse, LanService, LanStartOptions, Uri } from '@BBeBee/protocol'

/* ── the native surface ─────────────────────────────────────────────────── */

export interface NativeLanStartOptions {
  udpPort: number
  httpPort: number
  multicastGroup: string
}

export interface NativeDatagramEvent {
  host: string
  port: number
  dataBase64: string
}

export interface NativeRequestEvent {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  bodyBase64?: string
  bodyFile?: string
}

/** The Kotlin/Swift surface — one method per wire verb, plus event taps. */
export interface NativeLanHost {
  start(options: NativeLanStartOptions): Promise<{ udpPort: number; httpPort: number }>
  stop(): Promise<void>
  sendDatagram(options: { host: string; port: number; dataBase64: string; broadcast?: boolean }): Promise<void>
  request(options: {
    host: string
    port: number
    method: string
    path: string
    headers?: Record<string, string>
    bodyBase64?: string
    timeoutMs?: number
  }): Promise<{ status: number; headers: Record<string, string>; bodyBase64?: string }>
  replyRequest(options: {
    id: string
    status: number
    headers?: Record<string, string>
    bodyBase64?: string
    bodyFile?: string
    bodyFileStart?: number
    bodyFileEnd?: number
  }): Promise<void>
  addListener(eventName: 'onLanDatagram', listener: (event: NativeDatagramEvent) => void): { remove(): void }
  addListener(eventName: 'onLanRequest', listener: (event: NativeRequestEvent) => void): { remove(): void }
}

/* ── base64 ─────────────────────────────────────────────────────────────── */

export function base64ToBytes(base64: string): Uint8Array {
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob
  if (typeof atobFn === 'function') {
    const binary = atobFn(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  // Hermes ships `atob`; this branch only matters under a JS engine without
  // it. Manual decode rather than a dependency: base64 is one algorithm, and
  // this module carrying zero dependencies is part of its point.
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const size = clean.length * 0.75
  const bytes = new Uint8Array(Math.max(0, Math.floor(size) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0)))
  let out = 0
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    if (char === '=') break
    const value = table.indexOf(char)
    if (value === -1) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      if (out < bytes.length) bytes[out++] = (buffer >> bits) & 0xff
    }
  }
  return bytes.subarray(0, out)
}

export function bytesToBase64(bytes: Uint8Array): string {
  const btoaFn = (globalThis as { btoa?: (s: string) => string }).btoa
  if (typeof btoaFn !== 'function') throw new Error('lan-host: btoa is unavailable in this runtime')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoaFn(binary)
}

/* ── the private-host guard ─────────────────────────────────────────────── */

/**
 * Whether a host is a private-network target the LAN service may dial or
 * broadcast to: loopback, RFC 1918, link-local, IPv4 broadcast, and the
 * multicast range discovery uses (plus their IPv6 loopback/link-local/ULA
 * analogues). The same grammar as `core-desktop-bridge`'s `isPrivateLanHost`,
 * duplicated because a core package cannot import a module inside `apps/` —
 * the two copies carry cross-referencing tests in name only and neither may
 * drift without the contract doc disagreeing.
 */
export function isPrivateLanHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  // Broadcast (255.255.255.255 et al) and the multicast range discovery uses.
  if (a === 255 || (a >= 224 && a <= 239)) return true
  return false
}

/* ── the service ────────────────────────────────────────────────────────── */

export interface LanServiceOptions {
  /**
   * Extra containment for file-referencing replies: only a `bodyFile` under
   * one of these roots may reach the native side. The core service supplies
   * the app's own directories — the same containment fs reads answer to, so
   * the LAN surface cannot serve a file the fs surface could not read.
   */
  isAllowedFile?: (uri: Uri) => boolean
}

export function createLanService(native: NativeLanHost, opts: LanServiceOptions = {}): LanService & { dispose(): void } {
  const datagramCbs = new Set<(d: LanDatagram) => void>()
  const requestCbs = new Set<(r: LanRequestContext) => void>()
  let runningState = false

  const sub1 = native.addListener('onLanDatagram', (event) => {
    const datagram: LanDatagram = { host: event.host, port: event.port, data: base64ToBytes(event.dataBase64) }
    for (const cb of datagramCbs) cb(datagram)
  })
  const sub2 = native.addListener('onLanRequest', (event) => {
    const request: LanRequestContext = {
      id: event.id,
      method: event.method,
      url: event.url,
      headers: event.headers,
      ...(event.bodyBase64 ? { bodyBytes: base64ToBytes(event.bodyBase64) } : {}),
      ...(event.bodyFile ? { bodyFile: event.bodyFile as Uri } : {}),
      reply: (reply: LanReply) => {
        void sendReply(event.id, reply).catch(() => undefined)
      },
    }
    for (const cb of requestCbs) cb(request)
  })

  function checkFile(uri: Uri): string {
    if (opts.isAllowedFile && !opts.isAllowedFile(uri)) {
      throw new Error(`lan: reply body file outside the app's directories — refused: ${uri}`)
    }
    return uri
  }

  async function sendReply(id: string, reply: LanReply): Promise<void> {
    await native.replyRequest({
      id,
      status: reply.status,
      ...(reply.headers ? { headers: reply.headers } : {}),
      ...(reply.body ? { bodyBase64: bytesToBase64(reply.body) } : {}),
      ...(reply.bodyFile ? { bodyFile: checkFile(reply.bodyFile) } : {}),
      ...(reply.bodyFileStart !== undefined ? { bodyFileStart: reply.bodyFileStart } : {}),
      ...(reply.bodyFileEnd !== undefined ? { bodyFileEnd: reply.bodyFileEnd } : {}),
    })
  }

  return {
    async start(startOpts: LanStartOptions): Promise<{ udpPort: number; httpPort: number }> {
      const ports = await native.start(startOpts)
      runningState = true
      return ports
    },
    async stop(): Promise<void> {
      await native.stop()
      runningState = false
    },
    get running(): boolean {
      return runningState
    },
    async sendDatagram(target: { host: string; port: number }, data: Uint8Array, sendOpts?: { broadcast?: boolean }): Promise<void> {
      if (!isPrivateLanHost(target.host)) {
        throw new Error(`lan: refusing to send a datagram to ${target.host} — outside the local network`)
      }
      await native.sendDatagram({ host: target.host, port: target.port, dataBase64: bytesToBase64(data), ...(sendOpts?.broadcast ? { broadcast: true } : {}) })
    },
    onDatagram(cb: (d: LanDatagram) => void): Disposable {
      datagramCbs.add(cb)
      return () => datagramCbs.delete(cb)
    },
    onRequest(cb: (r: LanRequestContext) => void): Disposable {
      requestCbs.add(cb)
      return () => requestCbs.delete(cb)
    },
    async request(target: { host: string; port: number }, req: LanRequest): Promise<LanResponse> {
      if (!isPrivateLanHost(target.host)) {
        throw new Error(`lan: refusing to dial ${target.host} — outside the local network`)
      }
      const response = await native.request({
        host: target.host,
        port: target.port,
        method: req.method ?? 'GET',
        path: req.path,
        ...(req.headers ? { headers: req.headers } : {}),
        ...(req.body ? { bodyBase64: bytesToBase64(req.body) } : {}),
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      })
      return {
        status: response.status,
        headers: response.headers,
        ...(response.bodyBase64 ? { body: base64ToBytes(response.bodyBase64) } : {}),
      }
    },
    dispose(): void {
      sub1.remove()
      sub2.remove()
      datagramCbs.clear()
      requestCbs.clear()
    },
  }
}
