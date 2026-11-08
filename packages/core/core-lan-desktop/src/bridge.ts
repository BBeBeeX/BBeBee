/**
 * Renderer-side `ctx.lan` over the IPC bridge.
 *
 * The same thin-IPC-client shape as `FsBridge`: every call forwards, nothing
 * adds behaviour. What it adds locally is the subscription fan-out —
 * `onDatagram`/`onRequest` callbacks against the one `bridge.on` channel —
 * and the capability check, which runs here so an ungranted plugin is refused
 * before the call leaves the renderer (the same "gate in the renderer" shape
 * the fs and db bridges use, for the same reasons).
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { assertGranted } from '@BBeBee/kernel'
import type { Disposable, LanDatagram, LanReply, LanRequest, LanRequestContext, LanResponse, LanService, LanStartOptions, Uri } from '@BBeBee/protocol'
import { unwrapBridgeResult, requireBridge, type BridgeApi } from '@bbebee/core-desktop-bridge'

/** Renderer-side base64 — no `Buffer` in a browser context. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** The wire form of a `LanReply`: large bodies as file references, small as base64. */
interface ReplyWire {
  status: number
  headers?: Record<string, string>
  body?: string
  bodyFile?: Uri
  bodyFileStart?: number
  bodyFileEnd?: number
}

export class LanBridge extends Service implements LanService {
  private readonly bridge: BridgeApi
  private readonly datagramCbs = new Set<(d: LanDatagram) => void>()
  private readonly requestCbs = new Set<(req: LanRequestContext) => void>()
  private unsubscribe: (() => void) | undefined
  private runningState = false

  constructor(ctx: Context) {
    super(ctx, 'lan')
    this.bridge = requireBridge()
  }

  async [Service.init](): Promise<Disposable> {
    return () => {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.datagramCbs.clear()
      this.requestCbs.clear()
    }
  }

  get running(): boolean {
    return this.runningState
  }

  /** Refuse in the renderer, before the call crosses IPC. */
  private check(): void {
    assertGranted(this[Service.resolveConfig](), 'lan')
  }

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    this.check()
    return unwrapBridgeResult<T>(await this.bridge.call('lan', method, args))
  }

  private ensureSubscribed(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.bridge.on((event: unknown) => {
      if (!event || typeof event !== 'object') return
      const topic = (event as { topic?: string }).topic
      if (topic === 'lan-datagram') {
        const wire = event as { host: string; port: number; data: string }
        const datagram: LanDatagram = {
          host: wire.host,
          port: wire.port,
          data: base64ToBytes(wire.data),
        }
        for (const cb of this.datagramCbs) cb(datagram)
        return
      }
      if (topic === 'lan-request') {
        const wire = event as {
          id: string
          method: string
          url: string
          headers: Record<string, string>
          body?: string
          bodyFile?: string
        }
        const request: LanRequestContext = {
          id: wire.id,
          method: wire.method,
          url: wire.url,
          headers: wire.headers,
          ...(wire.body ? { bodyBytes: base64ToBytes(wire.body) } : {}),
          ...(wire.bodyFile ? { bodyFile: wire.bodyFile as Uri } : {}),
          reply: (reply: LanReply) => {
            this.replyRequest(wire.id, reply).catch(() => undefined)
          },
        }
        for (const cb of this.requestCbs) cb(request)
      }
    })
  }

  async start(opts: LanStartOptions): Promise<{ udpPort: number; httpPort: number }> {
    const ports = await this.call<{ udpPort: number; httpPort: number }>('start', [opts])
    this.runningState = true
    return ports
  }

  async stop(): Promise<void> {
    await this.call('stop', [])
    this.runningState = false
  }

  async sendDatagram(
    target: { host: string; port: number },
    data: Uint8Array,
    opts?: { broadcast?: boolean },
  ): Promise<void> {
    this.check()
    await unwrapBridgeResult(
      await this.bridge.call('lan', 'sendDatagram', [
        target,
        bytesToBase64(data),
        opts ?? {},
      ]),
    )
  }

  onDatagram(cb: (d: LanDatagram) => void): Disposable {
    this.ensureSubscribed()
    this.datagramCbs.add(cb)
    return () => this.datagramCbs.delete(cb)
  }

  onRequest(cb: (req: LanRequestContext) => void): Disposable {
    this.ensureSubscribed()
    this.requestCbs.add(cb)
    return () => this.requestCbs.delete(cb)
  }

  async request(
    target: { host: string; port: number },
    req: LanRequest,
  ): Promise<LanResponse> {
    const wire = {
      method: req.method,
      path: req.path,
      headers: req.headers,
      ...(req.body ? { body: bytesToBase64(req.body) } : {}),
      ...(req.bodyFile ? { bodyFile: req.bodyFile } : {}),
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
    }
    const response = await this.call<{
      status: number
      headers: Record<string, string>
      body?: string
    }>('request', [target, wire])
    return {
      status: response.status,
      headers: response.headers,
      ...(response.body ? { body: base64ToBytes(response.body) } : {}),
    }
  }

  private async replyRequest(id: string, reply: LanReply): Promise<void> {
    this.check()
    const wire: ReplyWire = {
      status: reply.status,
      ...(reply.headers ? { headers: reply.headers } : {}),
      ...(reply.body ? { body: bytesToBase64(reply.body) } : {}),
      ...(reply.bodyFile ? { bodyFile: reply.bodyFile } : {}),
      ...(reply.bodyFileStart !== undefined ? { bodyFileStart: reply.bodyFileStart } : {}),
      ...(reply.bodyFileEnd !== undefined ? { bodyFileEnd: reply.bodyFileEnd } : {}),
    }
    await unwrapBridgeResult(await this.bridge.call('lan', 'replyRequest', [id, wire]))
  }
}
