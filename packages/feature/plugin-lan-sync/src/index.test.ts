/**
 * The listen-together service, against fakes plus one real transport.
 *
 * Three layers of test:
 *
 *  - leader flows against a scripted transport: announce, /info, snapshot
 *    building, stream tokens, long-poll wake, the follower roster, commands;
 *  - a full leader⇄follower loop over **wired fakes** (one fake's `request`
 *    delivered into the other's handlers): the reconcile state machine —
 *    load, play/pause, drift correction, track changes, auto-leave;
 *  - a loopback end-to-end over a **real** `createLanHost` (real HTTP on
 *    127.0.0.1) — because what a fake cannot see is exactly what matters:
 *    the join handshake on the wire, a Range request answered with a file
 *    slice, and the long-poll riding a real socket.
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { createLanHost } from '@bbebee/core-lan-desktop/host'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type {
  AudioSourceHandle,
  Disposable,
  LanDatagram,
  LanReply,
  LanRequestContext,
  LanService,
  NowPlayingMeta,
  QueueItem,
  StoreService,
  StreamHandle,
  SyncCommand,
  SyncLeaderInfo,
  TransportState,
} from '@BBeBee/protocol'
import { apply, LanSyncPlugin } from './index.js'
import {
  artworkPath,
  commandPath,
  decodeAnnounce,
  decodeSnapshot,
  encodeAnnounce,
  encodeCommand,
  encodeJoin,
  infoPath,
  joinPath,
  leavePath,
  randomId,
  statePath,
  streamPath,
} from './protocol.js'

/* ── fakes ──────────────────────────────────────────────────────────────── */

const IDLE_STATE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

class FakePlayer extends Service {
  state: TransportState = { ...IDLE_STATE }
  currentStream: StreamHandle | undefined
  queueItems: QueueItem[] = []
  readonly calls: string[] = []
  private readonly ownCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'player')
    this.ownCtx = ctx
  }

  setState(patch: Partial<TransportState>): void {
    this.state = { ...this.state, ...patch }
    this.ownCtx.emit('player/state-changed', this.state)
  }

  setTrack(urn: string | undefined, nowPlaying?: NowPlayingMeta, stream?: StreamHandle): void {
    this.state = { ...this.state, trackUrn: urn, ...(nowPlaying ? { nowPlaying } : {}) }
    if (stream !== undefined) this.currentStream = stream
    this.ownCtx.emit('player/track-changed', urn)
  }

  async play(): Promise<void> {
    this.calls.push('play')
    this.setState({ status: 'playing' })
  }
  pause(): void {
    this.calls.push('pause')
    this.setState({ status: 'paused' })
  }
  togglePlay(): void {
    this.calls.push('toggle')
    this.setState({ status: this.state.status === 'playing' ? 'paused' : 'playing' })
  }
  stop(): void {
    this.calls.push('stop')
    this.setState({ status: 'idle', trackUrn: undefined, nowPlaying: undefined })
  }
  async seek(positionMs: number): Promise<void> {
    this.calls.push(`seek:${positionMs}`)
    this.setState({ positionMs })
  }
  async next(): Promise<void> {
    this.calls.push('next')
  }
  async previous(): Promise<void> {
    this.calls.push('previous')
  }
  upcoming(): QueueItem[] {
    return this.queueItems
  }
}

class FakeHandle {
  readonly node = { connect: (to: unknown) => void (this.connectedTo = to) }
  connectedTo: unknown
  positionMs = 0
  readonly durationMs = 200_000
  playCalls = 0
  pauseCalls = 0
  disposed = false
  readonly seeks: number[] = []

  play(): void {
    this.playCalls += 1
  }
  pause(): void {
    this.pauseCalls += 1
  }
  stop(): void {
    this.disposed = true
  }
  seek(atMs: number): void {
    this.seeks.push(atMs)
    this.positionMs = atMs
  }
  onEnded(): Disposable {
    return () => undefined
  }
  onStalled(): Disposable {
    return () => undefined
  }
  dispose(): void {
    this.disposed = true
  }
}

class FakeAudio extends Service {
  readonly loads: Array<{ src: string; opts: unknown }> = []
  readonly handles: FakeHandle[] = []
  readonly chainInput = { chain: 'input' }

  constructor(ctx: Context) {
    super(ctx, 'audio')
  }

  async load(src: string, opts: unknown): Promise<AudioSourceHandle> {
    this.loads.push({ src: String(src), opts })
    const handle = new FakeHandle()
    this.handles.push(handle)
    return handle as unknown as AudioSourceHandle
  }
}

function storePlugin(data: Record<string, unknown>) {
  return class StoreFake extends Service implements StoreService {
    private readonly map = new Map(Object.entries(data))
    constructor(ctx: Context) {
      super(ctx, 'store')
    }
    async get<T>(key: string): Promise<T | undefined> {
      return this.map.get(key) as T | undefined
    }
    async set<T>(key: string, value: T): Promise<void> {
      this.map.set(key, value)
    }
    async delete(key: string): Promise<void> {
      this.map.delete(key)
    }
    async keys(prefix?: string): Promise<string[]> {
      return [...this.map.keys()].filter((k) => !prefix || k.startsWith(prefix))
    }
    namespace(): StoreService {
      return this
    }
  }
}

class DeviceFake extends Service {
  readonly platform = 'linux' as const
  constructor(ctx: Context) {
    super(ctx, 'device')
  }
}

/** Scripted db: queued rows per call, rejecting when the queue runs dry. */
class DbFake extends Service {
  getResults: unknown[][] = []
  queryResults: unknown[][] = []
  constructor(ctx: Context) {
    super(ctx, 'db')
  }
  async get<T>(): Promise<T | undefined> {
    const next = this.getResults.shift()
    if (!next) throw new Error('db fake: no scripted get rows')
    return next as T
  }
  async query<T>(): Promise<T[]> {
    const next = this.queryResults.shift()
    if (!next) throw new Error('db fake: no scripted query rows')
    return next as T[]
  }
}

interface LanRequestSpec {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: Uint8Array
  timeoutMs?: number
}

type LanReplyShape = { status: number; headers: Record<string, string>; body?: Uint8Array }

/**
 * Scripted transport. When `peer` is set, outgoing requests are delivered to
 * the peer's registered handlers — a leader⇄follower loop in one process.
 * When `requestHook` is set, outgoing requests go to a real transport.
 */
class FakeLan extends Service implements LanService {
  peer: FakeLan | undefined
  requestHook: ((target: { host: string; port: number }, req: LanRequestSpec) => Promise<LanReplyShape>) | undefined
  private runningState = false
  private readonly datagramHandlers = new Set<(d: LanDatagram) => void>()
  private readonly requestHandlers = new Set<(r: LanRequestContext) => void>()
  readonly sentDatagrams: Array<{ target: { host: string; port: number }; data: Uint8Array }> = []
  readonly outgoingRequests: Array<{ target: { host: string; port: number }; req: LanRequestSpec }> = []

  constructor(ctx: Context) {
    super(ctx, 'lan')
  }

  get running(): boolean {
    return this.runningState
  }
  async start(opts: { udpPort: number; httpPort: number }): Promise<{ udpPort: number; httpPort: number }> {
    this.runningState = true
    return { udpPort: opts.udpPort, httpPort: opts.httpPort }
  }
  async stop(): Promise<void> {
    this.runningState = false
  }
  async sendDatagram(target: { host: string; port: number }, data: Uint8Array): Promise<void> {
    this.sentDatagrams.push({ target, data })
  }
  onDatagram(cb: (d: LanDatagram) => void): Disposable {
    this.datagramHandlers.add(cb)
    return () => this.datagramHandlers.delete(cb)
  }
  onRequest(cb: (r: LanRequestContext) => void): Disposable {
    this.requestHandlers.add(cb)
    return () => this.requestHandlers.delete(cb)
  }

  async request(target: { host: string; port: number }, req: LanRequestSpec): Promise<LanReplyShape> {
    this.outgoingRequests.push({ target, req })
    if (this.requestHook) return await this.requestHook(target, req)
    if (this.peer) {
      return await this.peer.serve({
        id: randomId(),
        method: req.method ?? 'GET',
        url: `http://${target.host}:${target.port}${req.path}`,
        headers: req.headers,
        bodyBytes: req.body,
      })
    }
    throw new Error('fake lan: no peer and no hook')
  }

  deliverDatagram(d: LanDatagram): void {
    for (const cb of this.datagramHandlers) cb(d)
  }

  deliverRequest(req: {
    method: string
    url: string
    headers?: Record<string, string>
    bodyBytes?: Uint8Array
  }): LanReply[] {
    const replies: LanReply[] = []
    const ctx: LanRequestContext = {
      id: randomId(),
      method: req.method,
      url: req.url,
      headers: req.headers ?? {},
      ...(req.bodyBytes ? { bodyBytes: req.bodyBytes } : {}),
      reply: (r) => replies.push(r),
    }
    for (const cb of this.requestHandlers) cb(ctx)
    return replies
  }

  /** Deliver an inbound request and await the (single) reply. */
  serve(req: {
    id: string
    method: string
    url: string
    headers?: Record<string, string>
    bodyBytes?: Uint8Array
  }): Promise<LanReplyShape> {
    if (this.requestHandlers.size === 0) {
      return Promise.resolve({ status: 504, headers: {} })
    }
    return new Promise((resolve) => {
      let settled = false
      const ctx: LanRequestContext = {
        id: req.id,
        method: req.method,
        url: req.url,
        headers: req.headers ?? {},
        ...(req.bodyBytes ? { bodyBytes: req.bodyBytes } : {}),
        reply: (r) => {
          if (settled) return
          settled = true
          resolve({ status: r.status, headers: r.headers ?? {}, ...(r.body ? { body: r.body } : {}) })
        },
      }
      for (const cb of this.requestHandlers) cb(ctx)
    })
  }
}

/* ── harness ────────────────────────────────────────────────────────────── */

interface Side {
  ctx: Context
  lan: FakeLan
  player: FakePlayer
  audio: FakeAudio
  db: DbFake
  plugin: LanSyncPlugin
  fibers: Array<{ dispose: () => Promise<void> }>
}

async function makeSide(dir: string, deviceId: string, deviceName: string): Promise<Side> {
  const ctx = new Context()
  const fibers: Array<{ dispose: () => Promise<void> }> = []
  fibers.push(await ctx.plugin(PathsNode, { root: dir }))
  fibers.push(await ctx.plugin(FsNode))
  fibers.push(await ctx.plugin(storePlugin({ 'device-id': deviceId, settings: { deviceName, discovery: true } })))
  fibers.push(await ctx.plugin(DeviceFake))
  fibers.push(await ctx.plugin(DbFake))
  fibers.push(await ctx.plugin(FakeLan))
  fibers.push(await ctx.plugin(FakePlayer))
  fibers.push(await ctx.plugin(FakeAudio))
  fibers.push(await ctx.plugin(LanSyncPlugin))
  await tick()
  return {
    ctx,
    lan: ctx.lan as unknown as FakeLan,
    player: ctx.player as unknown as FakePlayer,
    audio: ctx.audio as unknown as FakeAudio,
    db: ctx.db as unknown as DbFake,
    plugin: ctx.lanSync as unknown as LanSyncPlugin,
    fibers,
  }
}

async function disposeSide(side: Side): Promise<void> {
  for (const fiber of side.fibers.reverse()) await fiber.dispose().catch(() => undefined)
}

/** Point a side's player at a playing local file. */
function playLocalTrack(
  side: Side,
  fileUri: string,
  byteLength: number,
  positionMs = 10_000,
  urn = 'BBeBee:local:track:abc',
): void {
  side.player.setTrack(
    urn,
    { title: urn.endsWith('abc') ? 'Song' : 'Next Song', artist: 'Artist', artworkUri: fileUri.replace(/\.flac$/, '.png') },
    { kind: 'local', target: fileUri, seekable: true, byteLength, quality: 'lossless' },
  )
  side.player.setState({ status: 'playing', positionMs, durationMs: 200_000 })
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Deliver an inbound request and let the service's async handler run —
 * `handleRequest` replies a microtask later, so the collected replies need
 * one `tick` before they are asserted on.
 */
async function deliver(lan: FakeLan, req: { method: string; url: string; headers?: Record<string, string>; bodyBytes?: Uint8Array }): Promise<LanReply[]> {
  const replies = lan.deliverRequest(req)
  await tick()
  return replies
}

/* ── leader: scripted transport ─────────────────────────────────────────── */

describe('lan-sync leader', () => {
  it('announces itself with the sync app id, distinct from the transfer feature', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      expect(side.lan.sentDatagrams.length).toBeGreaterThan(0)
      const decoded = decodeAnnounce(side.lan.sentDatagrams[0]!.data)
      expect(decoded?.app).toBe('bbebee-sync')
      expect(decoded?.id).toBe('device-leader-1')
      expect(decoded?.name).toBe('Leader')
    } finally {
      await disposeSide(side)
    }
  })

  it('answers /info with its identity and ignores foreign paths', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      const replies = await deliver(side.lan, { method: 'GET', url: `http://192.168.1.9:53318${infoPath()}` })
      expect(replies).toHaveLength(1)
      expect(replies[0]!.status).toBe(200)
      expect(JSON.parse(new TextDecoder().decode(replies[0]!.body))).toMatchObject({
        app: 'bbebee-sync',
        id: 'device-leader-1',
        name: 'Leader',
        platform: 'linux',
      })

      // Another plugin's path is left unanswered — the transport 504s it.
      expect(await deliver(side.lan, { method: 'GET', url: 'http://h:1/api/bbebee-lan/v1/info' })).toHaveLength(0)
      // Unknown sync path answers 404.
      expect((await deliver(side.lan, { method: 'GET', url: 'http://h:1/api/bbebee-lan-sync/v1/nope' }))[0]!.status).toBe(404)
    } finally {
      await disposeSide(side)
    }
  })

  it('registers a local track as a tokenized stream and serves Range slices', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      playLocalTrack(side, 'file:///music/song.flac', 1000)

      const replies = await deliver(side.lan, { method: 'GET', url: `http://h:1${statePath()}` })
      expect(replies).toHaveLength(1)
      const snapshot = decodeSnapshot(new TextDecoder().decode(replies[0]!.body))
      expect(snapshot?.status).toBe('playing')
      expect(snapshot?.track?.title).toBe('Song')
      expect(snapshot?.track?.artworkUrl).toBe(artworkPath('BBeBee:local:track:abc'))
      expect(snapshot?.stream?.mode).toBe('serve')
      const token = snapshot?.stream?.mode === 'serve' ? parseToken(snapshot.stream.path) : undefined
      expect(token).toBeDefined()

      const ranged = await deliver(side.lan, {
        method: 'GET',
        url: `http://h:1${streamPath(token!)}`,
        headers: { range: 'bytes=100-199' },
      })
      expect(ranged[0]!.status).toBe(206)
      expect(ranged[0]!.headers!['content-range']).toBe('bytes 100-199/1000')
      expect(ranged[0]!.bodyFile).toBe('file:///music/song.flac')
      expect(ranged[0]!.bodyFileStart).toBe(100)
      expect(ranged[0]!.bodyFileEnd).toBe(199)

      // No Range → the whole file.
      const full = await deliver(side.lan, { method: 'GET', url: `http://h:1${streamPath(token!)}` })
      expect(full[0]!.status).toBe(200)
      expect(full[0]!.bodyFile).toBe('file:///music/song.flac')

      // Unknown token → flat 404, learning nothing.
      const missing = await deliver(side.lan, {
        method: 'GET',
        url: `http://h:1${streamPath('ffff0000aaaa')}`,
      })
      expect(missing[0]!.status).toBe(404)
      expect(missing[0]!.bodyFile).toBeUndefined()
    } finally {
      await disposeSide(side)
    }
  })

  it('passes third-party streams through as direct urls with their headers', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      side.player.setTrack(
        'BBeBee:example-org-35be9fe2:track:42',
        { title: 'Remote Song' },
        {
          kind: 'remote',
          target: 'https://cdn.example/stream.m3u8',
          headers: { referer: 'https://example.com' },
          seekable: true,
          expiresAt: 9_000,
        },
      )
      side.player.setState({ status: 'playing', positionMs: 1_000, durationMs: 180_000 })

      const replies = await deliver(side.lan, { method: 'GET', url: `http://h:1${statePath()}` })
      const snapshot = decodeSnapshot(new TextDecoder().decode(replies[0]!.body!))
      expect(snapshot?.stream).toEqual({
        mode: 'direct',
        url: 'https://cdn.example/stream.m3u8',
        headers: { referer: 'https://example.com' },
        seekable: true,
        expiresAt: 9_000,
      })
    } finally {
      await disposeSide(side)
    }
  })

  it('wakes a parked long-poll when the version bumps', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      // A poll at the current version parks: no reply yet.
      const replies = side.lan.deliverRequest({ method: 'GET', url: `http://h:1${statePath(1)}` })
      expect(replies).toHaveLength(0)

      side.player.setState({ status: 'paused' })
      await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 2_000 })
      const snapshot = decodeSnapshot(new TextDecoder().decode(replies[0]!.body))
      expect(snapshot?.status).toBe('paused')
    } finally {
      await disposeSide(side)
    }
  })

  it('tracks the follower roster and maps commands onto the player', async () => {
    const side = await makeSide(await tempDir('bbebee-lan-sync'), 'device-leader-1', 'Leader')
    try {
      const joinReplies = await deliver(side.lan, {
        method: 'POST',
        url: `http://h:1${joinPath()}`,
        headers: { 'content-type': 'application/json' },
        bodyBytes: encodeJoin({ id: 'device-follower-1', name: 'Follower', platform: 'linux' }),
      })
      expect(joinReplies[0]!.status).toBe(200)
      const joined = JSON.parse(new TextDecoder().decode(joinReplies[0]!.body)) as { sessionId: string }
      expect(joined.sessionId).toBeDefined()
      expect(side.plugin.session.followers).toHaveLength(1)
      expect(side.plugin.session.followers[0]!.name).toBe('Follower')

      const commandReplies = await deliver(side.lan, {
        method: 'POST',
        url: `http://h:1${commandPath()}`,
        headers: { 'x-bbebee-sync-session': joined.sessionId },
        bodyBytes: encodeCommand({ sessionId: joined.sessionId, action: 'seek', positionMs: 4_321 }),
      })
      expect(commandReplies[0]!.status).toBe(200)
      expect(side.player.calls).toContain('seek:4321')

      // A command from an unregistered session is refused.
      const stranger = await deliver(side.lan, {
        method: 'POST',
        url: `http://h:1${commandPath()}`,
        bodyBytes: encodeCommand({ sessionId: 'device-stranger', action: 'pause' }),
      })
      expect(stranger[0]!.status).toBe(403)
      expect(side.player.calls).not.toContain('pause')

      const leaveReplies = await deliver(side.lan, {
        method: 'POST',
        url: `http://h:1${leavePath()}`,
        bodyBytes: new TextEncoder().encode(JSON.stringify({ sessionId: joined.sessionId })),
      })
      expect(leaveReplies[0]!.status).toBe(200)
      expect(side.plugin.session.followers).toHaveLength(0)
    } finally {
      await disposeSide(side)
    }
  })
})

/* ── follower: wired fakes ──────────────────────────────────────────────── */

describe('lan-sync follower', () => {
  it('joins, mirrors the leader track, and seeks to the leader position', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    leader.lan.peer = follower.lan
    follower.lan.peer = leader.lan
    try {
      playLocalTrack(leader, 'file:///music/song.flac', 1000, 10_000)
      await follower.plugin.connectByAddress('192.168.1.9', 53318)

      expect(follower.plugin.session.role).toBe('follower')
      expect(follower.plugin.session.leader?.name).toBe('Leader')
      expect(follower.audio.loads).toHaveLength(1)
      expect(follower.audio.loads[0]!.src.startsWith('http://192.168.1.9:53318/api/bbebee-lan-sync/v1/stream/')).toBe(true)
      const handle = follower.audio.handles[0]!
      expect(handle.connectedTo).toBe(follower.audio.chainInput)
      expect(handle.playCalls).toBe(1)
      // The leader sits 10 s in — the mirror seeks to catch up.
      expect(handle.seeks[0]).toBeGreaterThan(9_000)
      expect(handle.seeks[0]).toBeLessThan(11_000)
      expect(follower.plugin.session.snapshot?.track?.title).toBe('Song')
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })

  it('follows pause and play, and reloads on a track change', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    leader.lan.peer = follower.lan
    follower.lan.peer = leader.lan
    try {
      playLocalTrack(leader, 'file:///music/song.flac', 1000, 10_000)
      await follower.plugin.connectByAddress('192.168.1.9', 53318)

      leader.player.pause()
      await vi.waitFor(() => expect(follower.audio.handles[0]!.pauseCalls).toBe(1), { timeout: 2_000 })

      leader.player.play()
      await vi.waitFor(() => expect(follower.audio.handles[0]!.playCalls).toBe(2), { timeout: 2_000 })

      // A new track (a fresh token) is a reload, not a drift correction.
      playLocalTrack(leader, 'file:///music/next.flac', 2000, 1_000, 'BBeBee:local:track:next')
      await vi.waitFor(() => expect(follower.audio.loads).toHaveLength(2), { timeout: 2_000 })
      expect(follower.audio.loads[1]!.src).not.toBe(follower.audio.loads[0]!.src)
      expect(follower.audio.handles[0]!.disposed).toBe(true)
      expect(follower.plugin.session.snapshot?.track?.title).toBe('Next Song')
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })

  it('corrects drift beyond the threshold and tolerates jitter inside it', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    leader.lan.peer = follower.lan
    follower.lan.peer = leader.lan
    try {
      playLocalTrack(leader, 'file:///music/song.flac', 1000, 10_000)
      await follower.plugin.connectByAddress('192.168.1.9', 53318)
      const handle = follower.audio.handles[0]!
      const joinsSeeks = handle.seeks.length

      // Small jitter: no correction.
      handle.positionMs = 10_100
      leader.player.setState({ positionMs: 10_000 })
      await tick()
      expect(handle.seeks).toHaveLength(joinsSeeks)

      // Large drift: corrected back to the leader's position.
      handle.positionMs = 12_000
      leader.player.setState({ positionMs: 10_000 })
      await vi.waitFor(() => expect(handle.seeks.length).toBeGreaterThan(joinsSeeks), { timeout: 2_000 })
      expect(handle.seeks.at(-1)!).toBeGreaterThan(9_000)
      expect(handle.seeks.at(-1)!).toBeLessThan(11_000)
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })

  it('sends commands to the leader', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    leader.lan.peer = follower.lan
    follower.lan.peer = leader.lan
    try {
      playLocalTrack(leader, 'file:///music/song.flac', 1000, 10_000)
      await follower.plugin.connectByAddress('192.168.1.9', 53318)

      await follower.plugin.sendCommand({ action: 'toggle' } satisfies SyncCommand)
      expect(leader.player.calls).toContain('toggle')
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })

  it('leaves the session when the local player starts playing', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    leader.lan.peer = follower.lan
    follower.lan.peer = leader.lan
    try {
      playLocalTrack(leader, 'file:///music/song.flac', 1000, 10_000)
      await follower.plugin.connectByAddress('192.168.1.9', 53318)
      expect(follower.plugin.session.role).toBe('follower')

      follower.player.setState({ status: 'playing' })
      await vi.waitFor(() => expect(follower.plugin.session.role).toBe('none'), { timeout: 2_000 })
      expect(follower.audio.handles[0]!.disposed).toBe(true)
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })

  it('sees leaders through announce datagrams and ignores the transfer feature', async () => {
    const dir = await tempDir('bbebee-lan-sync')
    const leader = await makeSide(dir, 'device-leader-1', 'Leader')
    const follower = await makeSide(dir, 'device-follower-1', 'Follower')
    try {
      const events: SyncLeaderInfo[][] = []
      follower.ctx.on('lan-sync/leaders-changed', (rows) => events.push([...rows]))
      follower.lan.deliverDatagram({
        host: '192.168.1.9',
        port: 53318,
        data: encodeAnnounce({
          v: 1,
          app: 'bbebee-sync',
          id: 'device-leader-1',
          name: 'Leader',
          platform: 'linux',
          httpPort: 53318,
          ts: Date.now(),
        }),
      })
      expect(follower.plugin.leaders).toHaveLength(1)
      expect(follower.plugin.leaders[0]!.name).toBe('Leader')
      expect(events.length).toBeGreaterThan(0)

      // The transfer feature's announce does not leak in.
      follower.lan.deliverDatagram({
        host: '192.168.1.10',
        port: 53318,
        data: encodeAnnounce({
          v: 1,
          app: 'bbebee',
          id: 'device-other-1',
          name: 'Transfer',
          platform: 'linux',
          httpPort: 53318,
          ts: Date.now(),
        }),
      })
      expect(follower.plugin.leaders).toHaveLength(1)
    } finally {
      await disposeSide(leader)
      await disposeSide(follower)
    }
  })
})

/* ── loopback e2e over a real transport ─────────────────────────────────── */

/**
 * `ctx.lan` over a real `createLanHost` — the same wiring the renderer bridge
 * does, minus the IPC hop: host events fan out to handlers, replies and
 * requests go straight back into the host.
 */
function hostBackedLan(): LanService & { dispose(): Promise<void> } {
  const datagramCbs = new Set<(d: LanDatagram) => void>()
  const requestCbs = new Set<(r: LanRequestContext) => void>()
  const b64ToBytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'))
  const host = createLanHost({
    broadcast: (_channel, payload) => {
      const p = payload as { topic?: string }
      if (p.topic === 'lan-datagram') {
        const d = payload as { host: string; port: number; data: string }
        for (const cb of datagramCbs) cb({ host: d.host, port: d.port, data: b64ToBytes(d.data) })
        return
      }
      if (p.topic === 'lan-request') {
        const r = payload as {
          id: string
          method: string
          url: string
          headers: Record<string, string>
          body?: string
          bodyFile?: string
        }
        const ctx: LanRequestContext = {
          id: r.id,
          method: r.method,
          url: r.url,
          headers: r.headers,
          ...(r.body ? { bodyBytes: b64ToBytes(r.body) } : {}),
          ...(r.bodyFile ? { bodyFile: r.bodyFile as never } : {}),
          reply: (reply) => {
            void host.replyRequest(r.id, {
              status: reply.status,
              ...(reply.headers ? { headers: reply.headers } : {}),
              ...(reply.body ? { body: reply.body } : {}),
              ...(reply.bodyFile ? { bodyFile: reply.bodyFile } : {}),
              ...(reply.bodyFileStart !== undefined ? { bodyFileStart: reply.bodyFileStart } : {}),
              ...(reply.bodyFileEnd !== undefined ? { bodyFileEnd: reply.bodyFileEnd } : {}),
            })
          },
        }
        for (const cb of requestCbs) cb(ctx)
      }
    },
  })
  return {
    async start(opts) {
      return host.start(opts)
    },
    async stop() {
      await host.stop()
    },
    get running() {
      return true
    },
    async sendDatagram(target, data, opts) {
      await host.sendDatagram(target, data, opts)
    },
    onDatagram(cb) {
      datagramCbs.add(cb)
      return () => datagramCbs.delete(cb)
    },
    onRequest(cb) {
      requestCbs.add(cb)
      return () => requestCbs.delete(cb)
    },
    async request(target, req) {
      return host.request(target, req)
    },
    async dispose() {
      await host.dispose()
    },
  }
}

describe('lan-sync loopback e2e', () => {
  it('joins over a real socket and serves a real file slice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bbebee-lan-sync-e2e-'))
    const song = Buffer.alloc(1000)
    for (let i = 0; i < song.length; i++) song[i] = i % 251
    const songPath = join(dir, 'song.flac')
    await writeFile(songPath, song)

    // Leader: real transport, real fs, real db, fake player/audio.
    class HostLan extends Service implements LanService {
      private readonly inner: LanService & { dispose(): Promise<void> }
      constructor(ctx: Context) {
        super(ctx, 'lan')
        this.inner = hostBackedLan()
      }
      start = (opts: { udpPort: number; httpPort: number; multicastGroup: string }) => this.inner.start(opts)
      stop = () => this.inner.stop()
      get running() {
        return this.inner.running
      }
      sendDatagram = (t: { host: string; port: number }, d: Uint8Array, o?: { broadcast?: boolean }) =>
        this.inner.sendDatagram(t, d, o)
      onDatagram = (cb: (d: LanDatagram) => void) => this.inner.onDatagram(cb)
      onRequest = (cb: (r: LanRequestContext) => void) => this.inner.onRequest(cb)
      request = (
        t: { host: string; port: number },
        r: { method?: string; path: string; headers?: Record<string, string>; body?: Uint8Array; timeoutMs?: number },
      ) => this.inner.request(t, r)
    }

    const leaderCtx = new Context()
    const leaderFibers: Array<{ dispose: () => Promise<void> }> = []
    leaderFibers.push(await leaderCtx.plugin(PathsNode, { root: dir }))
    leaderFibers.push(await leaderCtx.plugin(FsNode))
    leaderFibers.push(await leaderCtx.plugin(DbNode, { fileName: ':memory:' }))
    leaderFibers.push(await leaderCtx.plugin(storePlugin({ 'device-id': 'device-leader-1', settings: { deviceName: 'Leader', discovery: true } })))
    leaderFibers.push(await leaderCtx.plugin(DeviceFake))
    leaderFibers.push(await leaderCtx.plugin(HostLan))
    leaderFibers.push(await leaderCtx.plugin(FakePlayer))
    leaderFibers.push(await leaderCtx.plugin(FakeAudio))
    leaderFibers.push(await leaderCtx.plugin(LanSyncPlugin, { udpPort: 0, httpPort: 0 }))
    await tick()

    const leaderPlugin = leaderCtx.lanSync as unknown as LanSyncPlugin
    // The transport comes up asynchronously (a real bind on an ephemeral
    // port); joining before it answers would dial the default port.
    await vi.waitFor(
      () => expect((leaderPlugin as unknown as { lanReady: boolean }).lanReady).toBe(true),
      { timeout: 5_000 },
    )
    const httpPort = (leaderPlugin as unknown as { boundHttpPort: number }).boundHttpPort
    expect(httpPort).toBeGreaterThan(0)

    playLocalTrack(
      { player: leaderCtx.player as unknown as FakePlayer } as Side,
      pathToFileURL(songPath).href,
      song.length,
      5_000,
    )

    // Follower: fakes throughout, but its requests dial the leader's real host.
    const followerCtx = new Context()
    const followerFibers: Array<{ dispose: () => Promise<void> }> = []
    followerFibers.push(await followerCtx.plugin(PathsNode, { root: dir }))
    followerFibers.push(await followerCtx.plugin(FsNode))
    followerFibers.push(await followerCtx.plugin(storePlugin({ 'device-id': 'device-follower-1', settings: { deviceName: 'Follower', discovery: true } })))
    followerFibers.push(await followerCtx.plugin(DeviceFake))
    followerFibers.push(await followerCtx.plugin(DbFake))
    followerFibers.push(await followerCtx.plugin(FakeLan))
    followerFibers.push(await followerCtx.plugin(FakePlayer))
    followerFibers.push(await followerCtx.plugin(FakeAudio))
    followerFibers.push(await followerCtx.plugin(LanSyncPlugin))
    await tick()

    const followerLan = followerCtx.lan as unknown as FakeLan

    // The follower's transport forwards to a real host of its own — requests
    // to the leader ride real HTTP through the OS loopback.
    const followerHost = hostBackedLan()
    followerLan.requestHook = (target, req) =>
      followerHost.request(target, {
        method: req.method,
        path: req.path,
        headers: req.headers,
        ...(req.body ? { body: req.body } : {}),
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      })

    const followerPlugin = followerCtx.lanSync as unknown as LanSyncPlugin
    await followerPlugin.connectByAddress('127.0.0.1', httpPort)

    expect(followerPlugin.session.role).toBe('follower')
    expect(followerPlugin.session.snapshot?.track?.title).toBe('Song')
    const mirror = followerCtx.audio as unknown as FakeAudio
    expect(mirror.loads).toHaveLength(1)
    const streamUrl = mirror.loads[0]!.src
    expect(streamUrl.startsWith(`http://127.0.0.1:${httpPort}/api/bbebee-lan-sync/v1/stream/`)).toBe(true)

    // The stream URL the follower loaded answers real HTTP with real bytes.
    const response = await fetch(streamUrl, { headers: { range: 'bytes=100-199' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 100-199/${song.length}`)
    const body = Buffer.from(await response.arrayBuffer())
    expect(body.length).toBe(100)
    expect(body[0]).toBe(100 % 251)

    for (const fiber of followerFibers.reverse()) await fiber.dispose().catch(() => undefined)
    for (const fiber of leaderFibers.reverse()) await fiber.dispose().catch(() => undefined)
    await followerHost.dispose()
  })
})

/* ── leak test ──────────────────────────────────────────────────────────── */

describe('lan-sync lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const dir = await tempDir('bbebee-lan-sync-leak')
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: dir })
    await ctx.plugin(FsNode)
    await ctx.plugin(storePlugin({}))
    await ctx.plugin(DeviceFake)
    await ctx.plugin(DbFake)
    await ctx.plugin(FakeLan)
    await ctx.plugin(FakePlayer)
    await ctx.plugin(FakeAudio)
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(apply)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

function parseToken(path: string): string | undefined {
  const m = /\/stream\/([A-Za-z0-9-]+)$/.exec(path)
  return m?.[1]
}
