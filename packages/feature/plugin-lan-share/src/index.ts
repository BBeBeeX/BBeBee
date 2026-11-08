/**
 * `ctx.lanShare` — LocalSend-style song transfer over the local network.
 *
 * Discovery and transfer between BBeBee devices, speaking the BBeBee-LAN
 * protocol (see `./protocol.js`) over `ctx.lan`. The service owns three
 * pieces of state and one event per piece:
 *
 *   peers      — devices heard via UDP announce, TTL-expired
 *   transfers  — send/receive sessions, tracked to completion
 *   settings   — device name, auto-accept, discovery switch
 *
 * Received files land under this plugin's own data directory, then go
 * through `ctx.scanner.importFiles` — the same door the desktop drop
 * import uses — so `library/changed` refreshes every screen for free.
 *
 * One deliberate simplification: progress is per-file, not per-byte. The
 * transport streams files in the sidecar; the renderer only learns that a
 * file finished. A send screen shows "3 of 10 songs done", which is the
 * honest granularity the bridge provides.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  DbService,
  Disposable,
  FsService,
  LanDatagram,
  LanRequestContext,
  LanShareIncomingRequest,
  LanSharePeer,
  LanShareService,
  LanShareSettings,
  LanShareTransfer,
  LanShareTransferItem,
  LanService,
  PathsService,
  ScannerService,
  StoreService,
  Uri,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import {
  ANNOUNCE_INTERVAL_MS,
  LAN_APP_ID,
  LAN_HTTP_PORT,
  LAN_PROTOCOL_VERSION,
  LAN_UDP_PORT,
  MULTICAST_GROUP,
  PEER_TTL_MS,
  PREPARE_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  cancelPath,
  decodeAnnounce,
  decodePrepare,
  decodePrepareReply,
  encodeAnnounce,
  encodePrepare,
  encodePrepareReply,
  infoPath,
  mimeForFileName,
  parseCancelPath,
  parseUploadPath,
  preparePath,
  randomId,
  uploadPath,
} from './protocol.js'
import { PeerTable } from './discovery.js'
import { LAN_SHARE_VIEWS } from './views.js'

export const PLUGIN_ID = '@bbebee/plugin-lan-share'

const SETTINGS_KEY = 'settings'
const DEVICE_ID_KEY = 'device-id'
const MAX_KEPT_TRANSFERS = 50

interface ResolvedBinding {
  urn: string
  uri: Uri
  fileName: string
  sizeBytes: number
}

/** A receive half in progress. The transfer record mirrors it for the UI. */
interface ReceiveSession {
  id: string
  peer: { id: string; name: string; host: string }
  files: Map<string, { fileName: string; sizeBytes: number; destUri?: Uri }>
  accepted: boolean
  receivedCount: number
}

const DEFAULT_SETTINGS: LanShareSettings = {
  deviceName: '',
  autoAccept: false,
  discovery: true,
}

export interface LanShareConfig {
  /**
   * Ports to bind. Defaults are the well-known LAN ports; a deployment that
   * cannot keep them (another service owns 53318) overrides here. Announce
   * datagrams target *this* node's bound UDP port — on a real LAN every peer
   * binds the same well-known port, which is what makes the default work.
   */
  udpPort?: number
  httpPort?: number
}

export class LanSharePlugin extends Service implements LanShareService {
  static inject = ['lan', 'fs', 'db', 'store', 'paths']

  private readonly ownCtx: Context
  private readonly lan: LanService
  private readonly fs: FsService
  private readonly db: DbService
  private readonly store: StoreService
  private readonly paths: PathsService
  private readonly udpPort: number
  private readonly httpPort: number

  private deviceId = ''
  private settingsState: LanShareSettings = { ...DEFAULT_SETTINGS }
  private readonly peerTable = new PeerTable(PEER_TTL_MS)
  private peerRows: LanSharePeer[] = []
  private readonly transferMap = new Map<string, LanShareTransfer>()
  private readonly receiveSessions = new Map<string, ReceiveSession>()
  private receivedDir: Uri | undefined
  private lanReady = false
  private boundUdpPort = LAN_UDP_PORT
  private boundHttpPort = LAN_HTTP_PORT
  private announceTimer: ReturnType<typeof setInterval> | undefined
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private disposers: Disposable[] = []

  constructor(ctx: Context, config: LanShareConfig = {}) {
    super(ctx, 'lanShare')
    this.ownCtx = ctx
    this.lan = ctx.lan
    this.fs = ctx.fs
    this.db = ctx.db
    this.store = ctx.store
    this.paths = ctx.paths
    this.udpPort = config.udpPort ?? LAN_UDP_PORT
    this.httpPort = config.httpPort ?? LAN_HTTP_PORT
  }

  async [Service.init](): Promise<Disposable> {
    this.ownCtx.logger.info('plugin-lan-share: initialized')

    await this.loadIdentity()

    // The transfer surface binds here. A port taken by another process (or a
    // second instance the shell already refused) degrades to a service with
    // an empty peer list rather than a failed boot — the screen can say
    // "offline" and the rest of the app does not care.
    try {
      const ports = await this.lan.start({
        udpPort: this.udpPort,
        httpPort: this.httpPort,
        multicastGroup: MULTICAST_GROUP,
      })
      this.boundUdpPort = ports.udpPort
      this.boundHttpPort = ports.httpPort
      this.lanReady = true
      this.ownCtx.logger.info(
        `plugin-lan-share: transport ready (udp %s, http %s)`,
        String(ports.udpPort),
        String(ports.httpPort),
      )
      this.disposers.push(
        this.lan.onDatagram((d) => this.safeHandleDatagram(d)),
        this.lan.onRequest((req) => this.safeHandleRequest(req)),
      )
    } catch (error) {
      this.ownCtx.logger.error(`plugin-lan-share: transport unavailable: ${String(error)}`)
    }

    const uiFiber = this.ownCtx.inject(['ui'], (scoped) => this.contributeUi(scoped))
    this.disposers.push(() => void uiFiber.dispose())

    if (this.lanReady && this.settingsState.discovery) {
      this.startAnnouncing()
    }

    this.sweepTimer = setInterval(() => this.sweepPeers(), 1_000)
    this.disposers.push(() => clearInterval(this.sweepTimer))

    return () => {
      for (const off of this.disposers) {
        try {
          off()
        } catch {
          /* a half-built init may leave a disposer that double-fires */
        }
      }
      this.disposers = []
      void this.lan.stop().catch(() => undefined)
    }
  }

  /* ── ctx.lanShare surface ─────────────────────────────────────────────── */

  get peers(): readonly LanSharePeer[] {
    return this.peerRows
  }

  get transfers(): readonly LanShareTransfer[] {
    return [...this.transferMap.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  get settings(): LanShareSettings {
    return this.settingsState
  }

  refresh(): void {
    if (this.lanReady) void this.announce()
  }

  async sendTo(peerId: string, trackUrns: readonly string[]): Promise<LanShareTransfer> {
    if (!this.lanReady) throw new Error('lan-share: transport unavailable — cannot send')
    const peer = this.peerTable.get(peerId)
    if (!peer) throw new Error(`lan-share: unknown peer ${peerId}`)
    if (trackUrns.length === 0) throw new Error('lan-share: nothing selected to send')

    const files = await this.resolveBindings(trackUrns)
    const sessionId = randomId()
    const transfer: LanShareTransfer = {
      id: sessionId,
      direction: 'send',
      peer: { id: peer.id, name: peer.name },
      state: 'pending',
      items: files.map((f) => ({
        id: randomId(),
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
      })),
      startedAt: Date.now(),
    }
    // item ids are minted here and carried beside the resolved bindings.
    const offers = files.map((f, i) => ({
      ...f,
      offerId: transfer.items[i]!.id,
    }))
    this.transferMap.set(sessionId, transfer)
    this.emitTransfers()

    // The offer. Declined and unanswered both end here; only an accepted
    // session moves files.
    let reply
    try {
      reply = await this.lan.request(
        { host: peer.host, port: peer.httpPort },
        {
          method: 'POST',
          path: preparePath(),
          headers: { 'content-type': 'application/json' },
          body: encodePrepare({
            id: sessionId,
            sender: {
              id: this.deviceId,
              name: this.settingsState.deviceName,
              platform: 'desktop',
            },
            files: transfer.items.map((item) => ({
              id: item.id,
              fileName: item.fileName,
              sizeBytes: item.sizeBytes,
              mime: mimeForFileName(item.fileName),
            })),
          }),
          timeoutMs: PREPARE_TIMEOUT_MS,
        },
      )
    } catch (error) {
      this.failTransfer(sessionId, String(error))
      throw error
    }
    if (reply.status !== 200) {
      const declined = reply.status === 403
      this.patchTransfer(sessionId, { state: declined ? 'declined' : 'failed' })
      throw new Error(`lan-share: peer ${declined ? 'declined' : `answered ${reply.status}`} the offer`)
    }
    const parsed = decodePrepareReply(reply.body ?? new Uint8Array())
    if (!parsed || parsed.status !== 'accepted') {
      this.patchTransfer(sessionId, { state: 'failed' })
      throw new Error('lan-share: peer answered with an unreadable reply')
    }

    this.patchTransfer(sessionId, { state: 'transferring' })

    let sent = 0
    try {
      for (const offer of offers) {
        const response = await this.lan.request(
          { host: peer.host, port: peer.httpPort },
          {
            method: 'POST',
            path: uploadPath(sessionId, offer.offerId),
            headers: {
              'content-type': mimeForFileName(offer.fileName),
              'content-length': String(offer.sizeBytes),
            },
            bodyFile: offer.uri,
            timeoutMs: UPLOAD_TIMEOUT_MS,
          },
        )
        if (response.status !== 200) {
          throw new Error(`lan-share: peer refused ${offer.fileName} (${response.status})`)
        }
        sent += 1
        this.patchItem(sessionId, offer.offerId, { transferredBytes: offer.sizeBytes })
        this.ownCtx.logger.info(`lan-share: sent ${sent}/${offers.length} to ${peer.name}`)
      }
    } catch (error) {
      // Best-effort cancel so the receiver does not wait for the rest.
      void this.lan
        .request(
          { host: peer.host, port: peer.httpPort },
          { method: 'POST', path: cancelPath(sessionId), timeoutMs: 5_000 },
        )
        .catch(() => undefined)
      this.failTransfer(sessionId, String(error))
      throw error
    }

    this.patchTransfer(sessionId, { state: 'completed' })
    return this.transferMap.get(sessionId)!
  }

  async cancelTransfer(transferId: string): Promise<void> {
    const transfer = this.transferMap.get(transferId)
    if (!transfer || isFinal(transfer.state)) return
    this.patchTransfer(transferId, { state: 'cancelled' })
    if (transfer.direction === 'receive') {
      this.receiveSessions.delete(transferId)
      this.emitTransfers()
      return
    }
    // Tell the receiver to stop keeping the session open. The file in flight
    // finishes — the transport has no mid-request abort — and the rest are
    // dropped when the cancel arrives first.
    const peer = this.peerTable.get(transfer.peer.id)
    if (peer && this.lanReady) {
      void this.lan
        .request({ host: peer.host, port: peer.httpPort }, { method: 'POST', path: cancelPath(transferId), timeoutMs: 5_000 })
        .catch(() => undefined)
    }
    this.emitTransfers()
  }

  async updateSettings(patch: Partial<LanShareSettings>): Promise<void> {
    const next: LanShareSettings = { ...this.settingsState, ...patch }
    if (patch.deviceName !== undefined && !patch.deviceName.trim()) {
      throw new Error('lan-share: device name may not be empty')
    }
    this.settingsState = next
    await this.store.set(SETTINGS_KEY, next)
    // The discovery switch restarts the announce loop; a rename or a toggle
    // takes effect on the next announce either way.
    if (this.announceTimer) {
      clearInterval(this.announceTimer)
      this.announceTimer = undefined
    }
    if (this.lanReady && next.discovery) this.startAnnouncing()
    if (next.discovery) void this.announce()
    try {
      this.ownCtx.emit('lan-share/settings-changed', next)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-share: settings listener threw: ${String(error)}`)
    }
  }

  /* ── identity & settings ──────────────────────────────────────────────── */

  private async loadIdentity(): Promise<void> {
    const storedId = await this.store.get<string>(DEVICE_ID_KEY)
    if (storedId) {
      this.deviceId = storedId
    } else {
      this.deviceId = randomId()
      await this.store.set(DEVICE_ID_KEY, this.deviceId)
    }
    const stored = await this.store.get<Partial<LanShareSettings>>(SETTINGS_KEY)
    this.settingsState = {
      ...DEFAULT_SETTINGS,
      ...stored,
      deviceName: stored?.deviceName?.trim() ? stored.deviceName.trim() : defaultDeviceName(),
    }
    if (!stored?.deviceName) await this.store.set(SETTINGS_KEY, this.settingsState)
  }

  /* ── discovery ────────────────────────────────────────────────────────── */

  private startAnnouncing(): void {
    void this.announce()
    this.announceTimer = setInterval(() => void this.announce(), ANNOUNCE_INTERVAL_MS)
    this.disposers.push(() => {
      if (this.announceTimer) {
        clearInterval(this.announceTimer)
        this.announceTimer = undefined
      }
      void this.sendBye()
    })
  }

  private async announce(): Promise<void> {
    if (!this.lanReady || !this.settingsState.discovery) return
    const payload = encodeAnnounce({
      v: LAN_PROTOCOL_VERSION,
      app: LAN_APP_ID,
      id: this.deviceId,
      name: this.settingsState.deviceName,
      platform: 'desktop',
      httpPort: this.boundHttpPort,
      ts: Date.now(),
    })
    try {
      await this.lan.sendDatagram({ host: MULTICAST_GROUP, port: this.boundUdpPort }, payload)
      await this.lan.sendDatagram(
        { host: '255.255.255.255', port: this.boundUdpPort },
        payload,
        { broadcast: true },
      )
    } catch (error) {
      // A blocked broadcast (isolated network, AP isolation) must not take
      // the announce loop down — the next tick tries again.
      this.ownCtx.logger.debug?.(`plugin-lan-share: announce failed: ${String(error)}`)
    }
  }

  private async sendBye(): Promise<void> {
    if (!this.lanReady) return
    const payload = encodeAnnounce({
      v: LAN_PROTOCOL_VERSION,
      app: LAN_APP_ID,
      id: this.deviceId,
      name: this.settingsState.deviceName,
      platform: 'desktop',
      httpPort: this.boundHttpPort,
      ts: Date.now(),
      bye: true,
    })
    await this.lan
      .sendDatagram({ host: MULTICAST_GROUP, port: this.boundUdpPort }, payload)
      .catch(() => undefined)
  }

  private safeHandleDatagram(d: LanDatagram): void {
    try {
      this.handleDatagram(d)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-share: datagram handling failed: ${String(error)}`)
    }
  }

  private handleDatagram(d: LanDatagram): void {
    const msg = decodeAnnounce(d.data)
    if (!msg) return // someone else's traffic, or garbage
    if (msg.id === this.deviceId) return // our own announce echoed back
    if (msg.bye) {
      if (this.peerTable.remove(msg.id)) this.emitPeers()
      return
    }
    const changed = this.peerTable.upsert({
      id: msg.id,
      name: msg.name,
      platform: msg.platform,
      host: d.host,
      httpPort: msg.httpPort,
    })
    this.peerRows = this.peerTable.list()
    if (changed) this.emitPeers()
  }

  private sweepPeers(): void {
    const removed = this.peerTable.expire()
    if (removed.length > 0) {
      this.peerRows = this.peerTable.list()
      this.emitPeers()
    }
  }

  /* ── receive ──────────────────────────────────────────────────────────── */

  private safeHandleRequest(req: LanRequestContext): void {
    void Promise.resolve()
      .then(() => this.handleRequest(req))
      .catch((error) => {
        this.ownCtx.logger.warn?.(`plugin-lan-share: request handling failed: ${String(error)}`)
        try {
          req.reply({ status: 500, body: new TextEncoder().encode('internal error') })
        } catch {
          /* already answered */
        }
      })
  }

  private async handleRequest(req: LanRequestContext): Promise<void> {
    const path = pathnameOf(req.url)

    if (req.method === 'GET' && path === infoPath()) {
      req.reply({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(
          JSON.stringify({
            app: LAN_APP_ID,
            protocol: LAN_PROTOCOL_VERSION,
            id: this.deviceId,
            name: this.settingsState.deviceName,
            platform: 'desktop',
          }),
        ),
      })
      return
    }

    if (req.method === 'POST' && path === preparePath()) {
      this.handlePrepare(req)
      return
    }

    const upload = req.method === 'POST' ? parseUploadPath(path) : undefined
    if (upload) {
      await this.handleUpload(req, upload.sessionId, upload.fileId)
      return
    }

    const cancelled = req.method === 'POST' ? parseCancelPath(path) : undefined
    if (cancelled) {
      const session = this.receiveSessions.get(cancelled)
      this.receiveSessions.delete(cancelled)
      this.patchTransfer(cancelled, { state: 'cancelled' })
      if (session) this.ownCtx.logger.info(`lan-share: sender cancelled session ${cancelled}`)
      req.reply({ status: 200, body: new TextEncoder().encode('{}') })
      return
    }

    req.reply({ status: 404, body: new TextEncoder().encode('not found') })
  }

  /**
   * An offer from a peer. The user answers through the incoming-request
   * prompt (or auto-accept); until then the sender's own prepare timeout
   * bounds the wait, so this handler never blocks on the UI.
   */
  private handlePrepare(req: LanRequestContext): void {
    const bytes = req.bodyBytes ?? new Uint8Array()
    const offer = decodePrepare(bytes)
    if (!offer) {
      req.reply({ status: 400, body: new TextEncoder().encode('malformed offer') })
      return
    }
    if (this.receiveSessions.has(offer.id)) {
      req.reply({ status: 409, body: new TextEncoder().encode('duplicate session') })
      return
    }

    const session: ReceiveSession = {
      id: offer.id,
      peer: { id: offer.sender.id, name: offer.sender.name, host: hostOf(req.url) },
      files: new Map(offer.files.map((f) => [f.id, { fileName: f.fileName, sizeBytes: f.sizeBytes }])),
      accepted: false,
      receivedCount: 0,
    }
    this.receiveSessions.set(offer.id, session)
    const transfer: LanShareTransfer = {
      id: offer.id,
      direction: 'receive',
      peer: { id: offer.sender.id, name: offer.sender.name },
      state: 'pending',
      items: offer.files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
      })),
      startedAt: Date.now(),
    }
    this.transferMap.set(offer.id, transfer)
    this.emitTransfers()

    const accept = (): void => {
      if (session.accepted) return
      session.accepted = true
      this.patchTransfer(offer.id, { state: 'accepted' })
      this.ownCtx.logger.info(`lan-share: accepting ${offer.files.length} file(s) from ${session.peer.name}`)
      req.reply({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: encodePrepareReply({ status: 'accepted', sessionId: offer.id }),
      })
    }
    const decline = (): void => {
      this.receiveSessions.delete(offer.id)
      this.patchTransfer(offer.id, { state: 'declined' })
      this.ownCtx.logger.info(`lan-share: declined offer from ${session.peer.name}`)
      req.reply({
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: encodePrepareReply({ status: 'declined' }),
      })
    }

    if (this.settingsState.autoAccept) {
      accept()
      return
    }
    const incoming: LanShareIncomingRequest = {
      id: offer.id,
      peer: session.peer,
      items: offer.files.map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes })),
      accept,
      decline,
    }
    // A throwing prompt listener must not fail the transport reply path.
    try {
      this.ownCtx.emit('lan-share/incoming', incoming)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-share: incoming listener threw: ${String(error)}`)
    }
  }

  private async handleUpload(req: LanRequestContext, sessionId: string, fileId: string): Promise<void> {
    const session = this.receiveSessions.get(sessionId)
    if (!session || !session.accepted) {
      req.reply({ status: 404, body: new TextEncoder().encode('unknown session') })
      return
    }
    const file = session.files.get(fileId)
    if (!file) {
      req.reply({ status: 404, body: new TextEncoder().encode('unknown file') })
      return
    }

    const dir = this.ensureReceivedDir()
    if (!dir) {
      req.reply({ status: 500, body: new TextEncoder().encode('no receive directory') })
      return
    }
    const sessionDir = this.fs.join(dir, sessionId)
    await this.fs.mkdir(sessionDir, { recursive: true })
    const dest = this.fs.join(sessionDir, file.fileName)

    // The transport spilled the body to a temp file (or kept it in memory for
    // small ones); either way it lands here as bytes under our own scope.
    if (req.bodyFile) {
      await this.fs.copy(req.bodyFile, dest)
    } else if (req.bodyBytes) {
      await this.fs.writeFile(dest, req.bodyBytes)
    } else {
      req.reply({ status: 400, body: new TextEncoder().encode('empty body') })
      return
    }

    file.destUri = dest
    session.receivedCount += 1
    this.patchItem(sessionId, fileId, { transferredBytes: file.sizeBytes })

    if (session.receivedCount < session.files.size) {
      req.reply({ status: 200, body: new TextEncoder().encode('{}') })
      return
    }

    // Last file: hand everything to the scanner and close the session.
    const uris = [...session.files.values()]
      .map((f) => f.destUri)
      .filter((uri): uri is Uri => Boolean(uri))
    this.receiveSessions.delete(sessionId)
    req.reply({ status: 200, body: new TextEncoder().encode('{}') })
    const scanner = await this.resolveScanner()
    if (scanner) {
      try {
        await scanner.importFiles(uris)
        this.patchTransfer(sessionId, { state: 'completed' })
        this.ownCtx.logger.info(`lan-share: imported ${uris.length} file(s) from ${session.peer.name}`)
      } catch (error) {
        this.failTransfer(sessionId, `import failed: ${String(error)}`)
      }
    } else {
      // Files are on disk either way; without the scanner they are found by
      // the next directory scan instead of now.
      this.patchTransfer(sessionId, { state: 'completed' })
      this.ownCtx.logger.warn?.('lan-share: scanner unavailable — received files were not imported')
    }
  }

  private ensureReceivedDir(): Uri | undefined {
    if (this.receivedDir) return this.receivedDir
    this.receivedDir = this.fs.join(this.paths.pluginData(PLUGIN_ID), 'received')
    return this.receivedDir
  }

  /** Bounded resolve for the deferred scanner — the drop-import pattern. */
  private resolveScanner(timeoutMs = 10_000): Promise<ScannerService | undefined> {
    // A read for a service outside the plugin's inject list answers
    // undefined (or throws, on some cordis contexts) — both mean "resolve
    // through inject", which is the path that actually loads a deferred
    // provider.
    let existing: ScannerService | undefined
    try {
      existing = serviceOf<ScannerService>(this.ownCtx, 'scanner')
    } catch {
      existing = undefined
    }
    if (existing) return Promise.resolve(existing)
    return new Promise<ScannerService | undefined>((resolve) => {
      let done = false
      const finish = (svc: ScannerService | undefined): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(svc)
      }
      const timer = setTimeout(() => finish(undefined), timeoutMs)
      try {
        const fiber = this.ownCtx.inject(['scanner'], (scoped) => {
          finish(scoped.scanner as ScannerService)
        })
        if (fiber) this.disposers.push(() => fiber.dispose())
      } catch {
        finish(undefined)
      }
    })
  }

  /* ── sending helpers ──────────────────────────────────────────────────── */

  private async resolveBindings(trackUrns: readonly string[]): Promise<ResolvedBinding[]> {
    const files: ResolvedBinding[] = []
    for (const urn of trackUrns) {
      const row = await this.db.get<{ uri: string; size_bytes: number | null }>(
        'SELECT uri, size_bytes FROM media_bindings WHERE track_urn = ? ORDER BY created_at DESC LIMIT 1',
        [urn],
      )
      if (!row) throw new Error(`lan-share: no local file for ${urn}`)
      if (!(await this.fs.exists(row.uri))) throw new Error(`lan-share: file missing for ${urn}`)
      let size = row.size_bytes ?? 0
      if (!size) {
        try {
          size = (await this.fs.stat(row.uri)).size
        } catch {
          size = 0
        }
      }
      files.push({
        urn,
        uri: row.uri,
        fileName: this.fs.basename(row.uri) || 'audio.bin',
        sizeBytes: size,
      })
    }
    return files
  }

  /* ── transfer bookkeeping ─────────────────────────────────────────────── */

  private patchTransfer(id: string, patch: Partial<Pick<LanShareTransfer, 'state' | 'error'>>): void {
    const transfer = this.transferMap.get(id)
    if (!transfer) return
    Object.assign(transfer, patch)
    this.emitTransfers()
  }

  private patchItem(transferId: string, itemId: string, patch: Partial<LanShareTransferItem>): void {
    const transfer = this.transferMap.get(transferId)
    const item = transfer?.items.find((i) => i.id === itemId)
    if (!transfer || !item) return
    Object.assign(item, patch)
    this.emitTransfers()
  }

  private failTransfer(id: string, error: string): void {
    const transfer = this.transferMap.get(id)
    if (!transfer) return
    if (isFinal(transfer.state)) return
    this.patchTransfer(id, { state: 'failed', error })
  }

  private emitTransfers(): void {
    this.pruneTransfers()
    // A throwing listener (a dead screen) must not take the mutation down.
    try {
      this.ownCtx.emit('lan-share/transfers-changed', [...this.transferMap.values()])
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-share: transfers listener threw: ${String(error)}`)
    }
  }

  private pruneTransfers(): void {
    const finished = [...this.transferMap.values()]
      .filter((t) => isFinal(t.state))
      .sort((a, b) => b.startedAt - a.startedAt)
    for (const t of finished.slice(MAX_KEPT_TRANSFERS)) {
      this.transferMap.delete(t.id)
    }
  }

  private emitPeers(): void {
    try {
      this.ownCtx.emit('lan-share/peers-changed', this.peerRows)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-share: peers listener threw: ${String(error)}`)
    }
  }

  /* ── ui contribution ──────────────────────────────────────────────────── */

  private contributeUi(scoped: Context): Disposable {
    const fiber = scoped.inject(['ui'], (uiScoped) =>
      uiScoped.effect(function* () {
        yield uiScoped.ui.contribute({
          kind: 'route',
          id: LAN_SHARE_VIEWS.host,
          path: '/lan-share',
          title: 'LAN Transfer',
          icon: 'share',
          placement: ['sidebar'],
          order: 80,
        })
      }, 'lan-share-ui-contributions'),
    )
    return () => fiber?.dispose()
  }
}

function isFinal(state: LanShareTransfer['state']): boolean {
  return (
    state === 'completed' || state === 'failed' || state === 'declined' || state === 'cancelled'
  )
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.startsWith('/') ? url.split('?')[0]! : `/${url.split('?')[0] ?? ''}`
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** A name for the device before the user picks one. */
function defaultDeviceName(): string {
  return 'BBeBee Desktop'
}

export const name = 'plugin-lan-share'

export async function apply(ctx: Context, config?: LanShareConfig) {
  ctx.logger.info('plugin-lan-share: loaded')
  const fiber = await ctx.plugin(LanSharePlugin, config)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
