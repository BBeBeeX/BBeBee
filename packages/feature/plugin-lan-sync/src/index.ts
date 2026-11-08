/**
 * `ctx.lanSync` — listen-together over the local network.
 *
 * One device (the leader) plays normally; every other device (a follower)
 * mirrors it within a bounded drift window. Both roles live in this one
 * service, and the split is asymmetric on purpose:
 *
 *   Leader — passive. It announces itself, answers the sync API on `ctx.lan`'s
 *   HTTP server, and publishes a snapshot of `ctx.player`'s transport. It
 *   never learns a follower's address beyond what the follower's own requests
 *   reveal; a follower that stops polling simply ages out.
 *
 *   Follower — active. It long-polls the leader's `/state`, drives `ctx.audio`
 *   directly (the local player is stopped for the duration — the mirror and
 *   the player would otherwise fight over the same engine), and corrects its
 *   position whenever drift exceeds the threshold.
 *
 * The two playback answers this feature exists for:
 *   - A local track is registered under an unguessable token and served with
 *     Range/206, so the follower's own engine seeks like it would against any
 *     web server. A token is a capability, not an identity — unknown tokens
 *     answer a flat 404 (the same posture as the sidecar's stream relay).
 *   - A third-party stream travels as the *final resolved URL*: the follower
 *     loads it directly and no audio bytes transit the leader.
 *
 * Delivery is pull-based long-poll, which is what makes the whole thing
 * platform-symmetric: a leader needs no knowledge of its followers'
 * addresses, so any device with a `ctx.lan` implementation can lead.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  AudioSourceHandle,
  DbService,
  DeviceService,
  Disposable,
  LanDatagram,
  LanRequestContext,
  LanService,
  LanSyncService,
  LanSyncSettings,
  NowPlayingMeta,
  PlayerService,
  StoreService,
  SyncCommand,
  SyncFollowerInfo,
  SyncLeaderInfo,
  SyncSessionState,
  SyncStreamDescriptor,
  SyncTrackMeta,
  Uri,
} from '@BBeBee/protocol'
import { LeaderTable } from './discovery.js'
import {
  driftExceeds,
  expectedPosition,
  learnClock,
  snapshotMeansReload,
  type ClockEstimate,
} from './clock.js'
import {
  ANNOUNCE_INTERVAL_MS,
  API_BASE,
  FOLLOWER_TTL_MS,
  LAN_SYNC_APP_ID,
  LAN_SYNC_HTTP_PORT,
  LAN_SYNC_MULTICAST_GROUP,
  LAN_SYNC_PROTOCOL_VERSION,
  LAN_SYNC_UDP_PORT,
  LONG_POLL_MS,
  PEER_TTL_MS,
  POLL_TIMEOUT_MS,
  SESSION_LOST_MS,
  STREAM_TTL_MS,
  artworkPath,
  commandPath,
  decodeAnnounce,
  decodeCommand,
  decodeJoinReply,
  decodeLeave,
  decodeSnapshot,
  encodeAnnounce,
  encodeCommand,
  encodeJoin,
  encodeLeave,
  encodeSnapshot,
  infoPath,
  joinPath,
  leavePath,
  parseArtworkPath,
  parseRange,
  parseStreamPath,
  randomId,
  randomToken,
  statePath,
  streamPath,
} from './protocol.js'
import { LAN_SYNC_VIEWS } from './views.js'

export const PLUGIN_ID = '@bbebee/plugin-lan-sync'

const SETTINGS_KEY = 'settings'
const DEVICE_ID_KEY = 'device-id'
/** Long-poll replies held at once; beyond this, requests answer immediately. */
const MAX_PARKED = 64
/** Re-publish at least this often so re-resolved URLs reach the followers. */
const REFRESH_TICK_MS = 30_000
/** How far into a track a joining follower still seeks (before it, restart). */
const JOIN_SEEK_THRESHOLD_MS = 750

const DEFAULT_SETTINGS: LanSyncSettings = { deviceName: '', discovery: true }

export interface LanSyncConfig {
  /** Ports to bind. Defaults are the well-known LAN ports (see ./protocol.js). */
  udpPort?: number
  httpPort?: number
}

interface StreamRegistration {
  urn: string
  fileUri: Uri
  mime?: string
  size: number
  lastAccess: number
}

interface ArtworkRegistration {
  urn: string
  fileUri: Uri
  mime?: string
  lastAccess: number
}

export class LanSyncPlugin extends Service implements LanSyncService {
  static inject = ['player', 'audio', 'db', 'store', 'device', 'fs']

  private readonly ownCtx: Context
  private readonly player: PlayerService
  private readonly audio: Context['audio']
  private readonly db: DbService
  private readonly store: StoreService
  private readonly device: DeviceService
  private readonly fs: Context['fs']
  private readonly udpPort: number
  private readonly httpPort: number

  private deviceId = ''
  private settingsState: LanSyncSettings = { ...DEFAULT_SETTINGS }

  // `lan` is a soft dependency: the plugin must load (and sit inert) on a
  // platform whose transport is absent — Expo Go — rather than fail boot.
  private lan: LanService | undefined
  private lanReady = false
  private boundUdpPort = LAN_SYNC_UDP_PORT
  private boundHttpPort = LAN_SYNC_HTTP_PORT

  private readonly leaderTable = new LeaderTable(PEER_TTL_MS)
  private leaderRows: SyncLeaderInfo[] = []
  private readonly followers = new Map<string, SyncFollowerInfo>()
  private version = 1
  private readonly parked = new Map<string, { req: LanRequestContext; since: number; timer: ReturnType<typeof setTimeout> }>()
  private readonly streams = new Map<string, StreamRegistration>()
  private readonly artworks = new Map<string, ArtworkRegistration>()

  // Follower side.
  private sessionRole: SyncSessionState['role'] = 'none'
  private sessionLeader: SyncSessionState['leader'] | undefined
  private lastSnapshot: SyncSessionState['snapshot'] | undefined
  private sessionId: string | undefined
  private clock: ClockEstimate | undefined
  private lastVersion = 0
  private lastGoodAt = 0
  private loaded: { urn?: string; url?: string } | undefined
  private currentHandle: AudioSourceHandle | undefined
  private mirroringPlaying = false
  private pollGeneration = 0
  private pollTimer: ReturnType<typeof setTimeout> | undefined

  private announceTimer: ReturnType<typeof setInterval> | undefined
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private refreshTimer: ReturnType<typeof setInterval> | undefined
  private disposers: Disposable[] = []

  constructor(ctx: Context, config: LanSyncConfig = {}) {
    super(ctx, 'lanSync')
    this.ownCtx = ctx
    this.player = ctx.player
    this.audio = ctx.audio
    this.db = ctx.db
    this.store = ctx.store
    this.device = ctx.device
    this.fs = ctx.fs
    this.udpPort = config.udpPort ?? LAN_SYNC_UDP_PORT
    this.httpPort = config.httpPort ?? LAN_SYNC_HTTP_PORT
  }

  async [Service.init](): Promise<Disposable> {
    this.ownCtx.logger.info('plugin-lan-sync: initialized')

    await this.loadIdentity()

    const lanFiber = this.ownCtx.inject(['lan'], (scoped) => {
      void this.activateLan(scoped.lan as LanService)
    })
    this.disposers.push(() => void lanFiber?.dispose())

    // The route descriptor goes in wherever the ui service exists; the view
    // itself is registered by the platform UI package against the same id.
    const uiFiber = this.ownCtx.inject(['ui'], (uiScoped) =>
      uiScoped.effect(function* () {
        yield uiScoped.ui.contribute({
          kind: 'route',
          id: LAN_SYNC_VIEWS.host,
          path: '/lan-sync',
          title: 'Listen Together',
          icon: 'share',
          placement: ['sidebar'],
          order: 81,
        })
      }, 'lan-sync-ui-contributions'),
    )
    this.disposers.push(() => void uiFiber?.dispose())

    // Any state the snapshot publishes bumps the version, waking long-polls.
    this.disposers.push(
      this.ownCtx.on('player/state-changed', () => this.bumpVersion()),
      this.ownCtx.on('player/track-changed', () => this.bumpVersion()),
      this.ownCtx.on('queue/changed', () => this.bumpVersion()),
    )
    // The engine is exclusive: a follower that sees the local player start
    // playing has lost the mirror — leave rather than fight it for the engine.
    this.disposers.push(
      this.ownCtx.on('player/state-changed', (state) => {
        if (this.sessionRole === 'follower' && (state.status === 'playing' || state.status === 'loading')) {
          this.ownCtx.logger.warn('plugin-lan-sync: local player took the engine — leaving the session')
          void this.leave()
        }
      }),
    )

    this.sweepTimer = setInterval(() => this.sweep(), 1_000)
    this.disposers.push(() => clearInterval(this.sweepTimer))

    this.refreshTimer = setInterval(() => {
      // A cheap periodic republish: the player re-resolves expiring URLs on
      // its own schedule without touching transport state, so without this
      // tick a follower would keep a URL the leader has already rotated.
      if (this.lanReady && this.player.state.status !== 'idle') this.bumpVersion()
    }, REFRESH_TICK_MS)
    this.disposers.push(() => clearInterval(this.refreshTimer))

    return () => {
      this.pollGeneration += 1
      if (this.pollTimer) clearTimeout(this.pollTimer)
      this.pollTimer = undefined
      if (this.announceTimer) clearInterval(this.announceTimer)
      this.announceTimer = undefined
      this.teardownMirror()
      for (const entry of this.parked.values()) clearTimeout(entry.timer)
      this.parked.clear()
      for (const off of this.disposers) {
        try {
          off()
        } catch {
          /* a half-built init may leave a disposer that double-fires */
        }
      }
      this.disposers = []
      if (this.lanReady) void this.lan?.stop().catch(() => undefined)
    }
  }

  /* ── transport activation ─────────────────────────────────────────────── */

  private async activateLan(lan: LanService): Promise<void> {
    if (this.lanReady) return
    this.lan = lan
    try {
      // Idempotent at the transport: when `plugin-lan-share` (or a sibling)
      // already started it with the same well-known ports, this returns the
      // existing binds. A port taken by a foreign process degrades to an
      // inert service — the screen says offline, the rest of the app cares not.
      const ports = await lan.start({
        udpPort: this.udpPort,
        httpPort: this.httpPort,
        multicastGroup: LAN_SYNC_MULTICAST_GROUP,
      })
      this.boundUdpPort = ports.udpPort
      this.boundHttpPort = ports.httpPort
      this.lanReady = true
      this.ownCtx.logger.info(
        `plugin-lan-sync: transport ready (udp %s, http %s)`,
        String(ports.udpPort),
        String(ports.httpPort),
      )
      this.disposers.push(
        lan.onDatagram((d) => this.safeHandleDatagram(d)),
        lan.onRequest((req) => this.safeHandleRequest(req)),
      )
      if (this.settingsState.discovery) this.startAnnouncing()
    } catch (error) {
      this.ownCtx.logger.error(`plugin-lan-sync: transport unavailable: ${String(error)}`)
    }
  }

  /* ── ctx.lanSync surface ──────────────────────────────────────────────── */

  get leaders(): readonly SyncLeaderInfo[] {
    return this.leaderRows
  }

  get session(): SyncSessionState {
    return {
      role: this.sessionRole,
      ...(this.sessionLeader ? { leader: this.sessionLeader } : {}),
      ...(this.lastSnapshot ? { snapshot: this.lastSnapshot } : {}),
      followers: [...this.followers.values()],
    }
  }

  get settings(): LanSyncSettings {
    return this.settingsState
  }

  refresh(): void {
    if (this.lanReady) void this.announce()
  }

  async joinLeader(leaderId: string): Promise<void> {
    const leader = this.leaderTable.get(leaderId)
    if (!leader) throw new Error(`lan-sync: unknown leader ${leaderId}`)
    await this.connectByAddress(leader.host, leader.httpPort)
  }

  async connectByAddress(host: string, port: number): Promise<void> {
    if (!this.lan || !this.lanReady) throw new Error('lan-sync: transport unavailable')
    if (this.sessionRole === 'follower') await this.leave()

    const reply = await this.lan.request(
      { host, port },
      {
        method: 'POST',
        path: joinPath(),
        headers: { 'content-type': 'application/json' },
        body: encodeJoin({ id: this.deviceId, name: this.settingsState.deviceName, platform: this.device.platform }),
        timeoutMs: POLL_TIMEOUT_MS,
      },
    )
    if (reply.status !== 200) throw new Error(`lan-sync: leader answered ${reply.status} the join`)
    const parsed = decodeJoinReply(reply.body ?? new Uint8Array())
    if (!parsed) throw new Error('lan-sync: leader answered with an unreadable snapshot')

    // The engine is exclusive — the mirror owns it for the session. Stopped
    // *before* the role flips so the auto-leave guard does not fire on
    // our own teardown.
    await this.player.stop()
    this.teardownMirror()

    this.sessionId = parsed.sessionId
    this.sessionLeader = {
      id: parsed.snapshot.leaderId,
      name: parsed.snapshot.leaderName,
      host,
      httpPort: port,
    }
    this.clock = learnClock(parsed.snapshot.serverTimeMs, Date.now())
    this.lastVersion = parsed.snapshot.version
    this.lastGoodAt = Date.now()
    this.sessionRole = 'follower'
    this.emitSession()

    await this.applySnapshot(parsed.snapshot)
    this.schedulePoll(0)
  }

  async leave(): Promise<void> {
    if (this.sessionRole !== 'follower') return
    const leader = this.sessionLeader
    const sessionId = this.sessionId
    this.pollGeneration += 1
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
    this.teardownMirror()
    this.sessionRole = 'none'
    this.sessionLeader = undefined
    this.sessionId = undefined
    this.lastSnapshot = undefined
    this.clock = undefined
    this.lastVersion = 0
    this.emitSession()
    // Best-effort goodbye — the leader's TTL would drop us anyway.
    if (leader && sessionId && this.lanReady && this.lan) {
      void this.lan
        .request(
          { host: leader.host, port: leader.httpPort },
          {
            method: 'POST',
            path: leavePath(),
            headers: { 'content-type': 'application/json' },
            body: encodeLeave(sessionId),
            timeoutMs: 5_000,
          },
        )
        .catch(() => undefined)
    }
  }

  async sendCommand(command: SyncCommand): Promise<void> {
    if (this.sessionRole !== 'follower' || !this.sessionLeader || !this.sessionId) {
      throw new Error('lan-sync: not following anyone')
    }
    const reply = await this.lan!.request(
      { host: this.sessionLeader.host, port: this.sessionLeader.httpPort },
      {
        method: 'POST',
        path: commandPath(),
        headers: { 'content-type': 'application/json', 'x-bbebee-sync-session': this.sessionId },
        body: encodeCommand({ sessionId: this.sessionId, ...command }),
        timeoutMs: 10_000,
      },
    )
    if (reply.status !== 200) throw new Error(`lan-sync: leader answered ${reply.status} the command`)
  }

  mirrorPositionNow(): number | undefined {
    const snapshot = this.lastSnapshot
    if (this.sessionRole !== 'follower' || !snapshot) return undefined
    return expectedPosition(snapshot, this.clock, Date.now())
  }

  async updateSettings(patch: Partial<LanSyncSettings>): Promise<void> {
    if (patch.deviceName !== undefined && !patch.deviceName.trim()) {
      throw new Error('lan-sync: device name may not be empty')
    }
    this.settingsState = { ...this.settingsState, ...patch }
    await this.store.set(SETTINGS_KEY, this.settingsState)
    // The discovery switch restarts the announce loop; a rename or a toggle
    // takes effect on the next announce either way.
    if (this.announceTimer) {
      clearInterval(this.announceTimer)
      this.announceTimer = undefined
    }
    if (this.lanReady && this.settingsState.discovery) this.startAnnouncing()
    if (this.settingsState.discovery) void this.announce()
    try {
      this.ownCtx.emit('lan-sync/settings-changed', this.settingsState)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: settings listener threw: ${String(error)}`)
    }
  }

  /* ── identity ─────────────────────────────────────────────────────────── */

  private async loadIdentity(): Promise<void> {
    const storedId = await this.store.get<string>(DEVICE_ID_KEY)
    if (storedId) {
      this.deviceId = storedId
    } else {
      this.deviceId = randomId()
      await this.store.set(DEVICE_ID_KEY, this.deviceId)
    }
    const stored = await this.store.get<Partial<LanSyncSettings>>(SETTINGS_KEY)
    this.settingsState = {
      ...DEFAULT_SETTINGS,
      ...stored,
      deviceName: stored?.deviceName?.trim() ? stored.deviceName.trim() : defaultDeviceName(this.device.platform),
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
      v: LAN_SYNC_PROTOCOL_VERSION,
      app: LAN_SYNC_APP_ID,
      id: this.deviceId,
      name: this.settingsState.deviceName,
      platform: this.device.platform,
      httpPort: this.boundHttpPort,
      ts: Date.now(),
    })
    try {
      await this.lan!.sendDatagram({ host: LAN_SYNC_MULTICAST_GROUP, port: this.boundUdpPort }, payload)
      await this.lan!.sendDatagram(
        { host: '255.255.255.255', port: this.boundUdpPort },
        payload,
        { broadcast: true },
      )
    } catch (error) {
      // A blocked broadcast (isolated network, AP isolation) must not take
      // the announce loop down — the next tick tries again.
      this.ownCtx.logger.debug?.(`plugin-lan-sync: announce failed: ${String(error)}`)
    }
  }

  private async sendBye(): Promise<void> {
    if (!this.lanReady) return
    const payload = encodeAnnounce({
      v: LAN_SYNC_PROTOCOL_VERSION,
      app: LAN_SYNC_APP_ID,
      id: this.deviceId,
      name: this.settingsState.deviceName,
      platform: this.device.platform,
      httpPort: this.boundHttpPort,
      ts: Date.now(),
      bye: true,
    })
    await this.lan!
      .sendDatagram({ host: LAN_SYNC_MULTICAST_GROUP, port: this.boundUdpPort }, payload)
      .catch(() => undefined)
  }

  private safeHandleDatagram(d: LanDatagram): void {
    try {
      this.handleDatagram(d)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: datagram handling failed: ${String(error)}`)
    }
  }

  private handleDatagram(d: LanDatagram): void {
    const msg = decodeAnnounce(d.data)
    if (!msg) return // someone else's traffic (incl. the transfer feature's), or garbage
    if (msg.id === this.deviceId) return // our own announce echoed back
    if (msg.bye) {
      if (this.leaderTable.remove(msg.id)) {
        this.leaderRows = this.leaderTable.list()
        this.emitLeaders()
      }
      return
    }
    const changed = this.leaderTable.upsert({
      id: msg.id,
      name: msg.name,
      platform: msg.platform,
      host: d.host,
      httpPort: msg.httpPort,
    })
    this.leaderRows = this.leaderTable.list()
    if (changed) this.emitLeaders()
  }

  /* ── the sync server ──────────────────────────────────────────────────── */

  private safeHandleRequest(req: LanRequestContext): void {
    void Promise.resolve()
      .then(() => this.handleRequest(req))
      .catch((error) => {
        this.ownCtx.logger.warn?.(`plugin-lan-sync: request handling failed: ${String(error)}`)
        try {
          req.reply({ status: 500, body: new TextEncoder().encode('internal error') })
        } catch {
          /* already answered */
        }
      })
  }

  private async handleRequest(req: LanRequestContext): Promise<void> {
    const path = pathnameOf(req.url)
    // Not ours — the transfer feature (or a future sibling) may own it. Left
    // unanswered on purpose: an unanswered request 504s at the transport.
    if (!path.startsWith(API_BASE)) return

    if (req.method === 'GET' && path === infoPath()) {
      req.reply({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(
          JSON.stringify({
            app: LAN_SYNC_APP_ID,
            protocol: LAN_SYNC_PROTOCOL_VERSION,
            id: this.deviceId,
            name: this.settingsState.deviceName,
            platform: this.device.platform,
          }),
        ),
      })
      return
    }

    if (req.method === 'GET' && path === statePath()) {
      await this.handleState(req)
      return
    }

    if (req.method === 'POST' && path === joinPath()) {
      this.handleJoin(req)
      return
    }

    if (req.method === 'POST' && path === leavePath()) {
      const sessionId = decodeLeave(req.bodyBytes ?? new Uint8Array())
      if (!sessionId) {
        req.reply({ status: 400, body: new TextEncoder().encode('malformed leave') })
        return
      }
      this.followers.delete(sessionId)
      this.emitSession()
      req.reply({ status: 200, body: new TextEncoder().encode('{}') })
      return
    }

    if (req.method === 'POST' && path === commandPath()) {
      await this.handleCommand(req)
      return
    }

    const streamToken = req.method === 'GET' ? parseStreamPath(path) : undefined
    if (streamToken) {
      await this.handleStream(req, streamToken)
      return
    }

    const artworkUrn = req.method === 'GET' ? parseArtworkPath(path) : undefined
    if (artworkUrn) {
      await this.handleArtwork(req, artworkUrn)
      return
    }

    req.reply({ status: 404, body: new TextEncoder().encode('not found') })
  }

  private touchFollower(req: LanRequestContext): void {
    const sessionId = req.headers['x-bbebee-sync-session']
    const follower = sessionId ? this.followers.get(sessionId) : undefined
    if (follower) follower.lastSeen = Date.now()
  }

  private async handleState(req: LanRequestContext): Promise<void> {
    this.touchFollower(req)
    const url = safeUrl(req.url)
    const rawSince = url?.searchParams.get('since')
    const since = rawSince === null || rawSince === undefined ? undefined : Number(rawSince)

    // A follower at the current version parks until the version moves (or
    // the hold lapses); anything else answers immediately. The hold is what
    // makes play/pause feel instant without a push channel.
    if (since !== undefined && Number.isFinite(since) && this.version <= since) {
      if (this.parked.size >= MAX_PARKED) {
        req.reply(await this.snapshotReply())
        return
      }
      const timer = setTimeout(() => {
        this.parked.delete(req.id)
        void Promise.resolve(this.snapshotReply()).then(
          (reply) => req.reply(reply),
          () => undefined,
        )
      }, LONG_POLL_MS)
      this.parked.set(req.id, { req, since, timer })
      return
    }
    req.reply(await this.snapshotReply())
  }

  private async snapshotReply() {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: encodeSnapshot(await this.buildSnapshot()),
    }
  }

  private bumpVersion(): void {
    this.version += 1
    for (const [id, entry] of this.parked) {
      if (this.version > entry.since) {
        clearTimeout(entry.timer)
        this.parked.delete(id)
        void Promise.resolve(this.snapshotReply()).then(
          (reply) => entry.req.reply(reply),
          () => undefined,
        )
      }
    }
  }

  private handleJoin(req: LanRequestContext): void {
    let parsed: { id?: unknown; name?: unknown; platform?: unknown }
    try {
      parsed = JSON.parse(new TextDecoder().decode(req.bodyBytes ?? new Uint8Array())) as typeof parsed
    } catch {
      req.reply({ status: 400, body: new TextEncoder().encode('malformed join') })
      return
    }
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.name !== 'string' ||
      parsed.name.length === 0 ||
      parsed.name.length > 64 ||
      typeof parsed.platform !== 'string'
    ) {
      req.reply({ status: 400, body: new TextEncoder().encode('malformed join') })
      return
    }
    const sessionId = randomId()
    const follower: SyncFollowerInfo = {
      sessionId,
      name: parsed.name,
      platform: parsed.platform,
      lastSeen: Date.now(),
    }
    this.followers.set(sessionId, follower)
    this.ownCtx.logger.info(`plugin-lan-sync: ${follower.name} joined the session`)
    this.emitSession()
    void Promise.resolve(this.buildSnapshot()).then(
      (snapshot) => {
        req.reply({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode(JSON.stringify({ sessionId, snapshot })),
        })
      },
      (error) => {
        this.ownCtx.logger.warn?.(`plugin-lan-sync: snapshot for join failed: ${String(error)}`)
        try {
          req.reply({ status: 500, body: new TextEncoder().encode('snapshot failed') })
        } catch {
          /* already answered */
        }
      },
    )
  }

  private async handleCommand(req: LanRequestContext): Promise<void> {
    this.touchFollower(req)
    const cmd = decodeCommand(req.bodyBytes ?? new Uint8Array())
    if (!cmd) {
      req.reply({ status: 400, body: new TextEncoder().encode('malformed command') })
      return
    }
    if (!this.followers.has(cmd.sessionId)) {
      req.reply({ status: 403, body: new TextEncoder().encode('unknown session') })
      return
    }
    try {
      switch (cmd.action) {
        case 'play':
          await this.player.play()
          break
        case 'pause':
          this.player.pause()
          break
        case 'toggle':
          this.player.togglePlay()
          break
        case 'next':
          await this.player.next()
          break
        case 'previous':
          await this.player.previous()
          break
        case 'seek':
          await this.player.seek(cmd.positionMs ?? 0)
          break
      }
      req.reply({ status: 200, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{"ok":true}') })
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: command ${cmd.action} failed: ${String(error)}`)
      req.reply({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify({ ok: false, error: String(error) })),
      })
    }
  }

  /* ── stream & artwork serving ─────────────────────────────────────────── */

  private async handleStream(req: LanRequestContext, token: string): Promise<void> {
    const entry = this.streams.get(token)
    if (!entry) {
      // Flat 404: a token is a capability, not an identity — unknown tokens
      // learn nothing (the same posture as the sidecar's stream relay).
      req.reply({ status: 404, body: new TextEncoder().encode('not found') })
      return
    }
    entry.lastAccess = Date.now()

    const size = entry.size
    const range = parseRange(req.headers['range'], size)
    const baseHeaders: Record<string, string> = {
      'accept-ranges': 'bytes',
      ...(entry.mime ? { 'content-type': entry.mime } : {}),
    }

    // Unparsable or absent Range: answer 200 with the whole file. A start
    // past the end is unsatisfiable — 416 with the honest length.
    if (range && range.start >= size) {
      req.reply({
        status: 416,
        headers: { ...baseHeaders, 'content-range': `bytes */${size}` },
        body: new Uint8Array(),
      })
      return
    }
    if (!range) {
      req.reply({ status: 200, headers: baseHeaders, bodyFile: entry.fileUri })
      return
    }
    req.reply({
      status: 206,
      headers: {
        ...baseHeaders,
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'content-length': String(Math.max(0, range.end - range.start + 1)),
      },
      bodyFile: entry.fileUri,
      bodyFileStart: range.start,
      bodyFileEnd: range.end,
    })
  }

  private async handleArtwork(req: LanRequestContext, urn: string): Promise<void> {
    let entry = this.artworks.get(urn)
    if (!entry) {
      const uri = await this.lookupArtworkUri(urn)
      if (!uri) {
        req.reply({ status: 404, body: new TextEncoder().encode('not found') })
        return
      }
      entry = { urn, fileUri: uri, mime: imageMimeForUri(uri), lastAccess: Date.now() }
      this.artworks.set(urn, entry)
    }
    entry.lastAccess = Date.now()
    req.reply({
      status: 200,
      headers: { 'cache-control': 'max-age=3600', ...(entry.mime ? { 'content-type': entry.mime } : {}) },
      bodyFile: entry.fileUri,
    })
  }

  /** The local artwork file behind a track urn, resolved through the library. */
  private async lookupArtworkUri(urn: string): Promise<Uri | undefined> {
    const row = await this.db
      .get<{ uri: string | null }>(
        `SELECT aw.local_uri AS uri
           FROM tracks t
           LEFT JOIN albums al ON al.urn = t.album_urn
           LEFT JOIN artworks aw ON aw.id = COALESCE(t.artwork_id, al.artwork_id)
          WHERE t.urn = ?`,
        [urn],
      )
      .catch(() => undefined)
    const uri = row?.uri
    if (!uri) return undefined
    const serveable = toServeableUri(uri)
    if (!serveable.startsWith('file://')) return undefined
    return serveable
  }

  /* ── snapshot building ────────────────────────────────────────────────── */

  private async buildSnapshot() {
    const state = this.player.state
    const stream = this.player.currentStream
    let track: SyncTrackMeta | undefined
    let descriptor: SyncStreamDescriptor | undefined

    if (state.trackUrn) {
      track = await this.trackMeta(state.trackUrn, state.nowPlaying, state.durationMs)
      if (stream && stream.kind === 'remote') {
        descriptor = {
          mode: 'direct',
          url: stream.target,
          ...(stream.headers ? { headers: stream.headers } : {}),
          ...(stream.mimeType ? { mimeType: stream.mimeType } : {}),
          ...(stream.byteLength !== undefined ? { byteLength: stream.byteLength } : {}),
          ...(stream.expiresAt !== undefined ? { expiresAt: stream.expiresAt } : {}),
          seekable: stream.seekable,
        }
      } else if (stream && stream.kind === 'local') {
        const reg = await this.registerStream(state.trackUrn, stream.target, stream.byteLength)
        if (reg) {
          descriptor = {
            mode: 'serve',
            path: streamPath(reg.token),
            ...(reg.mime ? { mimeType: reg.mime } : {}),
            byteLength: reg.size,
          }
        }
      }
    }

    return {
      v: 1 as const,
      leaderId: this.deviceId,
      leaderName: this.settingsState.deviceName,
      platform: this.device.platform,
      version: this.version,
      serverTimeMs: Date.now(),
      status: state.status,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      ...(track ? { track } : {}),
      ...(descriptor ? { stream: descriptor } : {}),
      queue: await this.queueMeta(),
      repeat: state.repeat,
      shuffle: state.shuffle,
    }
  }

  /** Track metadata for the wire: now-playing first, the library to fill gaps. */
  private async trackMeta(urn: string, nowPlaying: NowPlayingMeta | undefined, durationMs: number): Promise<SyncTrackMeta> {
    let title = nowPlaying?.title ?? ''
    let artist = nowPlaying?.artist
    let album = nowPlaying?.album
    if (!title) {
      const row = await this.db
        .get<{ title: string; artist: string | null; album: string | null }>(
          `SELECT t.title,
                  (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                    WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist,
                  al.title AS album
             FROM tracks t LEFT JOIN albums al ON al.urn = t.album_urn
            WHERE t.urn = ?`,
          [urn],
        )
        .catch(() => undefined)
      if (row) {
        title = row.title
        artist = row.artist ?? undefined
        album = row.album ?? undefined
      }
    }
    const artworkUri = nowPlaying?.artworkUri
    return {
      urn,
      title: title || urn,
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      durationMs,
      ...(this.artworkUrlFor(urn, artworkUri) ? { artworkUrl: this.artworkUrlFor(urn, artworkUri) } : {}),
    }
  }

  /**
   * The follower-facing artwork location: a leader-relative path when the
   * artwork is a local file this leader serves, an absolute URL when it is
   * remote already, nothing when unknown.
   */
  private artworkUrlFor(urn: string, artworkUri: string | undefined): string | undefined {
    if (!artworkUri) return undefined
    if (artworkUri.startsWith('http://') || artworkUri.startsWith('https://')) return artworkUri
    if (artworkUri.startsWith('file://') || artworkUri.startsWith('bbebee-file://')) return artworkPath(urn)
    return undefined
  }

  /** Reuse the registration for an urn, minting a fresh token when none fits. */
  private async registerStream(
    urn: string,
    target: string,
    knownByteLength: number | undefined,
  ): Promise<{ token: string; size: number; mime?: string } | undefined> {
    for (const [token, entry] of this.streams) {
      if (entry.urn === urn) {
        entry.lastAccess = Date.now()
        return { token, size: entry.size, mime: entry.mime }
      }
    }
    const fileUri = toServeableUri(target)
    if (!fileUri.startsWith('file://')) return undefined
    let size = knownByteLength ?? 0
    if (!size) {
      try {
        size = (await this.fs.stat(fileUri)).size
      } catch {
        return undefined
      }
    }
    const token = randomToken()
    this.streams.set(token, { urn, fileUri, size, mime: audioMimeForUri(fileUri), lastAccess: Date.now() })
    return { token, size, mime: audioMimeForUri(fileUri) }
  }

  private async queueMeta(): Promise<SyncTrackMeta[]> {
    const items = this.player.upcoming()
    if (items.length === 0) return []
    const urns = items.map((i) => i.trackUrn)
    const placeholders = urns.map(() => '?').join(', ')
    const rows = await this.db
      .query<{ urn: string; title: string; duration_ms: number | null; artist: string | null; local_uri: string | null; source_url: string | null }>(
        `SELECT t.urn, t.title, t.duration_ms,
                (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                  WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist,
                aw.local_uri AS local_uri, aw.source_url AS source_url
           FROM tracks t
           LEFT JOIN albums al ON al.urn = t.album_urn
           LEFT JOIN artworks aw ON aw.id = COALESCE(t.artwork_id, al.artwork_id)
          WHERE t.urn IN (${placeholders})`,
        [...urns],
      )
      .catch(() => [])
    const byUrn = new Map(rows.map((r) => [r.urn, r]))
    return items.flatMap((item) => {
      const row = byUrn.get(item.trackUrn)
      if (!row) return [{ urn: item.trackUrn, title: item.trackUrn }]
      const artworkUrl = row.local_uri
        ? artworkPath(item.trackUrn)
        : row.source_url && /^https?:\/\//.test(row.source_url)
          ? row.source_url
          : undefined
      return [
        {
          urn: item.trackUrn,
          title: row.title,
          ...(row.artist ? { artist: row.artist } : {}),
          ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
          ...(artworkUrl ? { artworkUrl } : {}),
        },
      ]
    })
  }

  /* ── the follower ─────────────────────────────────────────────────────── */

  private schedulePoll(delayMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    const generation = this.pollGeneration
    this.pollTimer = setTimeout(() => {
      if (generation !== this.pollGeneration) return
      void this.pollOnce()
    }, delayMs)
    this.disposers.push(() => {
      if (this.pollTimer) clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    })
  }

  private async pollOnce(): Promise<void> {
    if (this.sessionRole !== 'follower' || !this.sessionLeader || !this.lan || !this.lanReady) return
    const generation = this.pollGeneration
    try {
      const reply = await this.lan.request(
        { host: this.sessionLeader.host, port: this.sessionLeader.httpPort },
        {
          method: 'GET',
          path: statePath(this.lastVersion),
          headers: this.sessionId ? { 'x-bbebee-sync-session': this.sessionId } : undefined,
          timeoutMs: POLL_TIMEOUT_MS,
        },
      )
      if (generation !== this.pollGeneration) return
      if (reply.status !== 200) throw new Error(`leader answered ${reply.status} the state poll`)
      const snapshot = decodeSnapshot(new TextDecoder().decode(reply.body ?? new Uint8Array()))
      if (!snapshot) throw new Error('leader answered with an unreadable snapshot')
      this.clock = learnClock(snapshot.serverTimeMs, Date.now())
      this.lastVersion = Math.max(this.lastVersion, snapshot.version)
      this.lastGoodAt = Date.now()
      await this.applySnapshot(snapshot)
      this.schedulePoll(0)
    } catch (error) {
      if (generation !== this.pollGeneration) return
      this.ownCtx.logger.debug?.(`plugin-lan-sync: poll failed: ${String(error)}`)
      if (Date.now() - this.lastGoodAt > SESSION_LOST_MS) {
        this.ownCtx.logger.warn(`plugin-lan-sync: leader unreachable for %s ms — session lost`, String(SESSION_LOST_MS))
        await this.leave()
        return
      }
      this.schedulePoll(2_000)
    }
  }

  /** Bring the local engine in line with a snapshot. The whole follower lives here. */
  private async applySnapshot(snapshot: SyncSessionState['snapshot']): Promise<void> {
    if (!snapshot) return
    this.lastSnapshot = snapshot
    try {
      this.ownCtx.emit('lan-sync/mirror-changed', snapshot)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: mirror listener threw: ${String(error)}`)
    }

    const leader = this.sessionLeader
    const desiredUrl = snapshot.track && snapshot.stream && leader
      ? snapshot.stream.mode === 'direct'
        ? snapshot.stream.url
        : `http://${leader.host}:${leader.httpPort}${snapshot.stream.path}`
      : undefined

    if (!snapshot.track || !desiredUrl) {
      // The leader is idle (or its stream is unserveable) — silence is correct.
      this.teardownMirror()
      return
    }

    if (snapshotMeansReload(this.loaded, { trackUrn: snapshot.track.urn, streamUrl: desiredUrl })) {
      await this.loadMirror(snapshot, desiredUrl)
      return
    }

    const handle = this.currentHandle
    if (!handle) return
    const expected = expectedPosition(snapshot, this.clock, Date.now())
    if (snapshot.status === 'playing') {
      if (!this.mirroringPlaying) {
        handle.play()
        this.mirroringPlaying = true
      }
      if (handle.seek && driftExceeds(handle.positionMs, expected)) handle.seek(expected)
    } else if (snapshot.status === 'paused' || snapshot.status === 'stalled') {
      if (this.mirroringPlaying) {
        handle.pause()
        this.mirroringPlaying = false
      }
      if (handle.seek && driftExceeds(handle.positionMs, expected)) handle.seek(expected)
    }
  }

  private async loadMirror(snapshot: NonNullable<SyncSessionState['snapshot']>, url: string): Promise<void> {
    if (!snapshot.track) return
    // mpv is (mostly) a single-source engine: the old handle goes before the
    // new load, the same order the player's own crossfade-less path uses.
    this.currentHandle?.dispose()
    this.currentHandle = undefined
    this.mirroringPlaying = false

    const headers = snapshot.stream?.mode === 'direct' ? snapshot.stream.headers : undefined
    const handle = await this.audio.load(url, {
      strategy: 'stream',
      ...(headers ? { headers } : {}),
    })
    handle.node.connect(this.audio.chainInput)
    // The leader decides when the track is over (it advances and publishes a
    // new snapshot); the mirror's own end-of-track is bookkeeping only.
    handle.onEnded(() => {
      this.mirroringPlaying = false
    })
    this.currentHandle = handle
    this.loaded = { urn: snapshot.track.urn, url }

    const expected = expectedPosition(snapshot, this.clock, Date.now())
    if (expected > JOIN_SEEK_THRESHOLD_MS && handle.seek) handle.seek(expected)
    if (snapshot.status === 'playing' || snapshot.status === 'stalled') {
      handle.play()
      this.mirroringPlaying = true
    }
    this.ownCtx.logger.info(
      `plugin-lan-sync: mirroring "${snapshot.track.title}" from ${this.sessionLeader?.name ?? 'leader'}`,
    )
  }

  private teardownMirror(): void {
    this.currentHandle?.dispose()
    this.currentHandle = undefined
    this.mirroringPlaying = false
    this.loaded = undefined
  }

  /* ── sweeping ─────────────────────────────────────────────────────────── */

  private sweep(): void {
    // Discovery expiry.
    if (this.leaderTable.expire().length > 0) {
      this.leaderRows = this.leaderTable.list()
      this.emitLeaders()
    }
    // Follower roster expiry.
    const cutoff = Date.now() - FOLLOWER_TTL_MS
    let followerLeft = false
    for (const [id, follower] of this.followers) {
      if (follower.lastSeen < cutoff) {
        this.followers.delete(id)
        followerLeft = true
        this.ownCtx.logger.info(`plugin-lan-sync: ${follower.name} left (timeout)`)
      }
    }
    if (followerLeft) this.emitSession()
    // Token expiry — unused registrations die quietly.
    const streamCutoff = Date.now() - STREAM_TTL_MS
    for (const [token, entry] of this.streams) {
      if (entry.lastAccess < streamCutoff) this.streams.delete(token)
    }
    for (const [urn, entry] of this.artworks) {
      if (entry.lastAccess < streamCutoff) this.artworks.delete(urn)
    }
    // Parked long-polls are reaped by their own timers; nothing here.
  }

  /* ── emitting ─────────────────────────────────────────────────────────── */

  private emitLeaders(): void {
    try {
      this.ownCtx.emit('lan-sync/leaders-changed', this.leaderRows)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: leaders listener threw: ${String(error)}`)
    }
  }

  private emitSession(): void {
    try {
      this.ownCtx.emit('lan-sync/session-changed', this.session)
    } catch (error) {
      this.ownCtx.logger.warn?.(`plugin-lan-sync: session listener threw: ${String(error)}`)
    }
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * The LAN host streams real files; the webview-facing `bbebee-file://` scheme
 * (and its `localhost` host form) folds back to `file://` the same way direct
 * fs reads normalize it.
 */
function toServeableUri(uri: string): Uri {
  if (uri.startsWith('bbebee-file://')) {
    return uri.replace(/^bbebee-file:\/\/(localhost)?/, 'file://')
  }
  return uri
}

function audioMimeForUri(uri: string): string | undefined {
  const ext = uri.includes('.') ? uri.slice(uri.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
    case 'm4b':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'wav':
      return 'audio/wav'
    case 'aiff':
    case 'aif':
      return 'audio/aiff'
    case 'wv':
      return 'audio/x-wavpack'
    case 'dsf':
    case 'dff':
      return 'audio/dsd'
    case 'ape':
      return 'audio/x-ape'
    case 'wma':
      return 'audio/x-ms-wma'
    case 'mka':
      return 'audio/x-matroska'
    default:
      return undefined
  }
}

function imageMimeForUri(uri: string): string | undefined {
  const ext = uri.includes('.') ? uri.slice(uri.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    default:
      return undefined
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.startsWith('/') ? url.split('?')[0]! : `/${url.split('?')[0] ?? ''}`
  }
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

function defaultDeviceName(platform: string): string {
  return `BBeBee ${platform.charAt(0).toUpperCase()}${platform.slice(1)}`
}

/* ── entry ──────────────────────────────────────────────────────────────── */

export const name = 'plugin-lan-sync'

export async function apply(ctx: Context, config?: LanSyncConfig) {
  ctx.logger.info('plugin-lan-sync: loaded')
  const fiber = await ctx.plugin(LanSyncPlugin, config)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
