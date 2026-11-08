/**
 * Renderer-side `ctx.lan` for mobile — the gated wrapper over the
 * `BbebeeLanHost` native transport, the exact analogue of the desktop
 * `LanBridge` over its sidecar host.
 *
 * The transport arrives as constructor config: this core package never
 * imports the Expo module under `apps/mobile/modules/` (the composition root
 * probes the native module and hands the adapter in, the same way
 * `MobileAudioService` receives the proxy seams). What this layer adds is
 * what the sidecar's dispatch enforces on desktop:
 *
 *   - the capability gate — a plugin without the `lan` grant is refused
 *     before its call reaches the transport;
 *   - file containment for replies — a `bodyFile` must sit inside the app's
 *     own directories, so the LAN surface cannot serve a file the fs surface
 *     could not read. (The private-address guard lives in the adapter, which
 *     is the single seam to the sockets on this platform.)
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { assertGranted } from '@BBeBee/kernel'
import type {
  Disposable,
  LanDatagram,
  LanReply,
  LanRequest,
  LanRequestContext,
  LanResponse,
  LanService,
  LanStartOptions,
  Uri,
} from '@BBeBee/protocol'

export interface LanMobileConfig {
  /**
   * The native-backed transport. Absent means the native module is missing
   * from this build (Expo Go) — the service then stays inert rather than
   * failing the boot, and `ctx.lan` consumers simply never resolve.
   */
  transport?: LanService
  /** Extra directory roots a reply's `bodyFile` may sit under. */
  allowedFileRoots?: readonly Uri[]
}

export class LanMobile extends Service implements LanService {
  private readonly transport: LanService | undefined
  private readonly extraRoots: readonly string[]
  private resolvedRoots: readonly string[] | undefined

  constructor(ctx: Context, config: LanMobileConfig = {}) {
    super(ctx, 'lan')
    this.transport = config.transport
    this.extraRoots = (config.allowedFileRoots ?? []).map(normalizeRoot)
  }

  async [Service.init](): Promise<Disposable> {
    if (!this.transport) {
      this.ctx.logger?.warn?.('lan: native transport missing in this build — the service is inert')
    }
    return () => undefined
  }

  /** Refuse before the call reaches the transport. */
  private check(): void {
    assertGranted(this[Service.resolveConfig](), 'lan')
  }

  get running(): boolean {
    return this.transport?.running ?? false
  }

  async start(opts: LanStartOptions): Promise<{ udpPort: number; httpPort: number }> {
    this.check()
    if (!this.transport) throw new Error('lan: native transport missing in this build')
    return this.transport.start(opts)
  }

  async stop(): Promise<void> {
    this.check()
    await this.transport?.stop()
  }

  async sendDatagram(
    target: { host: string; port: number },
    data: Uint8Array,
    opts?: { broadcast?: boolean },
  ): Promise<void> {
    this.check()
    if (!this.transport) throw new Error('lan: native transport missing in this build')
    await this.transport.sendDatagram(target, data, opts)
  }

  onDatagram(cb: (d: LanDatagram) => void): Disposable {
    this.check()
    if (!this.transport) return () => undefined
    return this.transport.onDatagram(cb)
  }

  /**
   * The reply path is where this platform's containment lives: a plugin may
   * name any file it likes in a reply; only paths inside the app's own
   * directories reach the sockets.
   */
  onRequest(cb: (req: LanRequestContext) => void): Disposable {
    this.check()
    if (!this.transport) return () => undefined
    return this.transport.onRequest((req) => {
      const guarded: LanRequestContext = {
        ...req,
        reply: (reply: LanReply) => {
          if (reply.bodyFile !== undefined && !this.isContainedFile(reply.bodyFile)) {
            this.ctx.logger?.warn?.(`lan: reply body file outside the app's directories — refused`)
            req.reply({ status: 500, body: new TextEncoder().encode('lan: forbidden reply file') })
            return
          }
          req.reply(reply)
        },
      }
      cb(guarded)
    })
  }

  async request(target: { host: string; port: number }, req: LanRequest): Promise<LanResponse> {
    this.check()
    if (!this.transport) throw new Error('lan: native transport missing in this build')
    return this.transport.request(target, req)
  }

  private isContainedFile(uri: Uri): boolean {
    const roots = this.fileRoots()
    if (roots.length === 0) return false
    const path = uriToPath(uri)
    if (!path) return false
    return roots.some((root) => path === root || path.startsWith(root))
  }

  /**
   * The containment roots: this service's own directories plus whatever the
   * caller added. `ctx.paths` is read lazily — the service mounts beside it
   * in the bootstrap array, and a library file can live under the shared
   * music folder or the app-scoped staging cache, both of which are roots
   * the fs surface already reads through.
   */
  private fileRoots(): readonly string[] {
    if (this.resolvedRoots) return this.resolvedRoots
    const roots: string[] = [...this.extraRoots]
    try {
      const paths = this.ctx.paths
      for (const root of [paths.appData, paths.cache, paths.temp, paths.downloads, paths.music]) {
        if (root) roots.push(normalizeRoot(root))
      }
    } catch {
      // Paths not mounted (a bare test harness) — the caller's extras stand.
    }
    this.resolvedRoots = roots
    return roots
  }
}

/** Fold a `file://` uri (or bare path) to a comparable, decoded path. */
function uriToPath(uri: string): string | undefined {
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(uri).pathname)
    } catch {
      return undefined
    }
  }
  return uri.startsWith('/') ? decodeURIComponent(uri) : undefined
}

/** A root to a comparable, decoded, slash-terminated path. */
function normalizeRoot(root: string): string {
  const path = root.startsWith('file://')
    ? decodeURIComponent(new URL(root).pathname)
    : root
  return path.endsWith('/') ? path : `${path}/`
}
