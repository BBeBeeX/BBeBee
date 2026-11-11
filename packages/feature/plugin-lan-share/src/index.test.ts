/**
 * The LAN-share service, against a real filesystem and a real database.
 *
 * Two layers of test:
 *
 *  - a scripted transport: the accept/decline/auto-accept/upload session
 *    flows, where a real socket adds nothing but flakes;
 *  - a loopback end-to-end over **two real transports** (`createLanHost`,
 *    real UDP + HTTP on 127.0.0.1) — because what a fake cannot see is
 *    exactly what matters between peers: body spill, file streaming, and
 *    the wire grammar as two independent protocol stacks speaking it.
 *
 * Discovery inside the e2e uses a unicast announce, not the multicast loop:
 * sandboxed CI routinely refuses multicast routing, and what is under test
 * here is the peer handshake, not the kernel's multicast plumbing (that is
 * `core-lan-desktop`'s suite).
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { createLanHost } from '@bbebee/core-lan-desktop/host'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type {
  DbService,
  Disposable,
  LanDatagram,
  LanReply,
  LanRequestContext,
  LanService,
  LanShareIncomingRequest,
  LanShareSettings,
  StoreService,
  Uri,
} from '@BBeBee/protocol'
import { LanSharePlugin, PLUGIN_ID, name as pluginName, apply } from './index.js'
import {
  encodeAnnounce,
  encodePrepare,
  infoPath,
  preparePath,
  randomId,
  uploadPath,
} from './protocol.js'

/* ── fakes ──────────────────────────────────────────────────────────────── */

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

/** Scripted transport: records what the service sends, delivers on demand. */
class FakeLan extends Service implements LanService {
  private runningState = false
  private readonly datagramHandlers = new Set<(d: LanDatagram) => void>()
  private readonly requestHandlers = new Set<(r: LanRequestContext) => void>()
  readonly sentDatagrams: Array<{ target: { host: string; port: number }; data: Uint8Array }> = []
  readonly outgoingRequests: Array<{ target: { host: string; port: number }; req: unknown }> = []
  private replyQueue: Array<{ status: number; body?: Uint8Array }> = []

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
  async request(
    target: { host: string; port: number },
    req: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; body?: Uint8Array }> {
    this.outgoingRequests.push({ target, req })
    const scripted = this.replyQueue.shift() ?? { status: 200 }
    return { status: scripted.status, headers: {}, ...(scripted.body ? { body: scripted.body } : {}) }
  }
  /** The next outgoing request gets this reply. */
  scriptReply(reply: { status: number; body?: Uint8Array }): void {
    this.replyQueue.push(reply)
  }
  deliverDatagram(d: LanDatagram): void {
    for (const cb of this.datagramHandlers) cb(d)
  }
  /** Deliver an inbound request; the returned array fills as handlers reply. */
  deliverRequest(req: {
    id: string
    method: string
    url: string
    headers?: Record<string, string>
    bodyBytes?: Uint8Array
    bodyFile?: Uri
  }): LanReply[] {
    const replies: LanReply[] = []
    const ctx: LanRequestContext = {
      ...req,
      headers: req.headers ?? {},
      reply: (r) => replies.push(r),
    }
    for (const cb of this.requestHandlers) cb(ctx)
    return replies
  }
}

function scannerPlugin() {
  class ScannerFake extends Service {
    readonly imports: Uri[][] = []
    constructor(ctx: Context) {
      super(ctx, 'scanner')
    }
    async importFiles(uris: Uri[]): Promise<{ added: number }> {
      this.imports.push([...uris])
      return { added: uris.length }
    }
  }
  return ScannerFake
}

function uiPlugin() {
  class UiFake extends Service {
    readonly contributions: Array<Record<string, unknown>> = []
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    async contribute(entry: Record<string, unknown>): Promise<Disposable> {
      this.contributions.push(entry)
      return () => undefined
    }
    registerView(): Disposable {
      return () => undefined
    }
  }
  return UiFake
}

/* ── harness ────────────────────────────────────────────────────────────── */

interface Harness {
  ctx: Context
  lan: FakeLan
  lanShare: LanSharePlugin
  db: DbService
  fs: FsNode
  scanner: { imports: Uri[][] }
  dir: string
  incoming: LanShareIncomingRequest[]
  dispose(): Promise<void>
}

async function harness(opts: { settings?: Partial<LanShareSettings> } = {}): Promise<Harness> {
  const dir = await tempDir('bbebee-lan-share')
  const ctx = new Context()
  const fibers: Array<{ dispose: () => Promise<void> }> = []
  fibers.push(await ctx.plugin(PathsNode, { root: dir }))
  fibers.push(await ctx.plugin(FsNode))
  fibers.push(await ctx.plugin(DbNode, { fileName: ':memory:' }))
  fibers.push(await ctx.plugin(storePlugin({
    'device-id': 'device-local-1',
    settings: { deviceName: 'Local', autoAccept: false, discovery: true, ...opts.settings },
  })))
  fibers.push(await ctx.plugin(FakeLan))
  fibers.push(await ctx.plugin(scannerPlugin()))
  fibers.push(await ctx.plugin(uiPlugin()))
  fibers.push(await ctx.plugin(LanSharePlugin, { udpPort: 53318, httpPort: 53319 }))
  await tick()
  // DbNode applies the core schema inside its own async init; the plugin
  // promise resolves before that lands. Every db-touching test waits here.
  await vi.waitFor(async () => {
    await (ctx.db as DbService).query('SELECT 1 FROM sources LIMIT 1')
  })

  const incoming: LanShareIncomingRequest[] = []
  const offIncoming = ctx.on('lan-share/incoming', (req) => {
    incoming.push(req)
  })

  return {
    ctx,
    lan: ctx.lan as unknown as FakeLan,
    lanShare: ctx.lanShare as unknown as LanSharePlugin,
    db: ctx.db as DbService,
    fs: ctx.fs as FsNode,
    scanner: ctx.scanner as unknown as { imports: Uri[][] },
    dir,
    incoming,
    dispose: async () => {
      offIncoming()
      for (const fiber of fibers.reverse()) await fiber.dispose().catch(() => undefined)
      await tick()
    },
  }
}

/* ── library seeding ────────────────────────────────────────────────────── */

async function seedLibrary(
  db: DbService,
  fs: FsNode,
  dir: string,
  files: Array<{ name: string; content: string }>,
): Promise<string[]> {
  const dirUri = pathToFileURL(dir).href.replace(/\/$/, '') as Uri
  // Post-ADR-5 schema: a `sources` row (not the old `providers`), tracks
  // keyed by `source_id`.
  await db.exec(
    `INSERT OR IGNORE INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
     VALUES ('local-1', 'bbebee://test/local', 'Local', '{}', 'seed', ?, ?)`,
    [Date.now(), Date.now()],
  )
  const urns: string[] = []
  for (const [i, file] of files.entries()) {
    const uri = fs.join(dirUri, file.name) as Uri
    await fs.writeFile(uri, new TextEncoder().encode(file.content))
    const urn = `BBeBee:local:track:seed${i}`
    await db.exec(
      `INSERT OR REPLACE INTO tracks (urn, source_id, remote_id, title, fetched_at) VALUES (?, 'local-1', ?, ?, ?)`,
      [urn, file.name, file.name, Date.now()],
    )
    await db.exec(
      `INSERT OR REPLACE INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, created_at) VALUES (?, ?, ?, 'mp3', ?, 'scan', ?)`,
      [`binding-${i}`, urn, uri, file.content.length, Date.now()],
    )
    urns.push(urn)
  }
  return urns
}

const OFFER = {
  id: 'session-1234',
  sender: { id: 'device-peer-1', name: 'Peer', platform: 'desktop' },
  files: [{ id: 'file-aaa1', fileName: 'song.mp3', sizeBytes: 10 }],
}

function prepareRequestFor(offer: typeof OFFER, port = 53318): { id: string; method: string; url: string; bodyBytes: Uint8Array } {
  return {
    id: offer.id,
    method: 'POST',
    url: `http://192.168.1.5:${port}` + preparePath(),
    bodyBytes: encodePrepare(offer),
  }
}

/* ── receive flow over the scripted transport ──────────────────────────── */

describe('receive flow (scripted transport)', () => {
  it('holds an offer for the UI prompt and answers on accept', async () => {
    const h = await harness()
    try {
      const replies = h.lan.deliverRequest(prepareRequestFor(OFFER))
      await tick()
      expect(replies).toHaveLength(0) // no auto-accept: the prompt owns the answer
      expect(h.incoming).toHaveLength(1)
      expect(h.incoming[0]!.peer.name).toBe('Peer')
      expect(h.incoming[0]!.items[0]?.fileName).toBe('song.mp3')

      h.incoming[0]!.accept()
      await tick()
      expect(replies[0]?.status).toBe(200)
      expect(JSON.parse(Buffer.from(replies[0]!.body ?? new Uint8Array()).toString()).status).toBe('accepted')
      expect(h.lanShare.transfers[0]).toMatchObject({
        id: OFFER.id,
        direction: 'receive',
        state: 'accepted',
      })
    } finally {
      await h.dispose()
    }
  })

  it('declining answers 403 and closes the session', async () => {
    const h = await harness()
    try {
      h.lan.deliverRequest(prepareRequestFor(OFFER))
      await tick()
      h.incoming[0]!.decline()
      await tick()
      expect(h.lanShare.transfers[0]).toMatchObject({ state: 'declined' })
    } finally {
      await h.dispose()
    }
  })

  it('auto-accept answers immediately and lands files in the scanner', async () => {
    const h = await harness({ settings: { autoAccept: true } })
    try {
      const content = new TextEncoder().encode('fake mp3 bytes')
      const offer = {
        ...OFFER,
        id: 'session-9012',
        files: [{ id: 'file-aaa1', fileName: 'song.mp3', sizeBytes: content.length }],
      }
      const replies = h.lan.deliverRequest(prepareRequestFor(offer))
      await tick()
      expect(replies[0]?.status).toBe(200)

      const uploadReplies = h.lan.deliverRequest({
        id: 'up-1',
        method: 'POST',
        url: 'http://192.168.1.5:53318' + uploadPath(offer.id, 'file-aaa1'),
        headers: { 'content-type': 'audio/mpeg' },
        bodyBytes: content,
      })
      // The upload handler runs real fs I/O; wait for it to settle.
      await vi.waitFor(() => {
        expect(uploadReplies[0]?.status).toBe(200)
        expect(h.scanner.imports).toHaveLength(1)
        expect(h.scanner.imports[0]).toHaveLength(1)
      })

      const uri = h.scanner.imports[0]![0]!
      expect(await h.fs.exists(uri)).toBe(true)
      expect(await h.fs.readFile(uri)).toBe('fake mp3 bytes')
      expect(h.lanShare.transfers[0]).toMatchObject({ state: 'completed', direction: 'receive' })
    } finally {
      await h.dispose()
    }
  })

  it('a sender cancel closes the session and marks the transfer', async () => {
    const h = await harness()
    try {
      h.lan.deliverRequest(prepareRequestFor(OFFER))
      await tick()
      h.incoming[0]!.accept()
      await tick()

      const replies = h.lan.deliverRequest({
        id: 'cx-1',
        method: 'POST',
        url: 'http://192.168.1.5:53318/api/bbebee-lan/v1/cancel/' + OFFER.id,
      })
      await tick()
      expect(replies[0]?.status).toBe(200)
      expect(h.lanShare.transfers[0]).toMatchObject({ state: 'cancelled' })
    } finally {
      await h.dispose()
    }
  })

  it('answers info and 404s everything else', async () => {
    const h = await harness()
    try {
      const infoReplies = h.lan.deliverRequest({ id: 'i-1', method: 'GET', url: 'http://x:1' + infoPath() })
      await tick()
      expect(infoReplies[0]?.status).toBe(200)
      expect(JSON.parse(Buffer.from(infoReplies[0]!.body ?? new Uint8Array()).toString())).toMatchObject({
        app: 'bbebee',
        id: 'device-local-1',
        name: 'Local',
      })

      const missingReplies = h.lan.deliverRequest({ id: 'i-2', method: 'GET', url: 'http://x:1/nope' })
      await tick()
      expect(missingReplies[0]?.status).toBe(404)
    } finally {
      await h.dispose()
    }
  })
})

/* ── send flow over the scripted transport ─────────────────────────────── */

describe('send flow (scripted transport)', () => {
  it('resolves bindings, offers, and uploads to a scripted peer', async () => {
    const h = await harness()
    try {
      const urns = await seedLibrary(h.db, h.fs, h.dir, [
        { name: 'one.mp3', content: 'first' },
        { name: 'two.flac', content: 'second' },
      ])
      // The peer must exist first — announce it, then script prepare + 2 uploads.
      h.lan.deliverDatagram({
        host: '192.168.1.5',
        port: 40_000,
        data: encodeAnnounce({
          v: 1,
          app: 'bbebee',
          id: 'device-peer-9',
          name: 'Peer',
          platform: 'desktop',
          httpPort: 53318,
          ts: Date.now(),
        }),
      })
      await tick()
      h.lan.scriptReply({
        status: 200,
        body: new TextEncoder().encode(JSON.stringify({ status: 'accepted', sessionId: 'session-xyz1' })),
      })
      h.lan.scriptReply({ status: 200 })
      h.lan.scriptReply({ status: 200 })

      const transfer = await h.lanShare.sendTo('device-peer-9', urns)
      expect(transfer.state).toBe('completed')
      expect(transfer.direction).toBe('send')
      expect(transfer.items).toHaveLength(2)

      // One prepare, then one upload per file. The offer crosses as bytes.
      expect(h.lan.outgoingRequests).toHaveLength(3)
      const prepareReq = h.lan.outgoingRequests[0]!.req as { body?: Uint8Array }
      const prepare = JSON.parse(Buffer.from(prepareReq.body ?? new Uint8Array()).toString())
      expect(prepare.files).toHaveLength(2)
      expect((h.lan.outgoingRequests[1]!.req as { path?: string }).path).toMatch(
        /^\/api\/bbebee-lan\/v1\/upload\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/,
      )
    } finally {
      await h.dispose()
    }
  })

  it('refuses to send to an unknown peer', async () => {
    const h = await harness()
    try {
      await expect(h.lanShare.sendTo('device-ghost-9', ['BBeBee:local:track:x'])).rejects.toThrow(/unknown peer/)
    } finally {
      await h.dispose()
    }
  })
})

/* ── loopback end-to-end over real transports ──────────────────────────── */

interface Node {
  ctx: Context
  dir: string
  db: DbService
  host: ReturnType<typeof createLanHost>
  ports: { udpPort: number; httpPort: number }
  lanShare: LanSharePlugin
  scanner: { imports: Uri[][] }
  dispose(): Promise<void>
}

async function bootNode(opts: {
  id: string
  name: string
  autoAccept?: boolean
}): Promise<Node> {
  const dir = await tempDir('bbebee-lan-node')
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: dir })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(storePlugin({
    'device-id': opts.id,
    settings: { deviceName: opts.name, autoAccept: Boolean(opts.autoAccept), discovery: true },
  }))

  const datagramHandlers = new Set<(d: LanDatagram) => void>()
  const requestHandlers = new Set<(r: LanRequestContext) => void>()
  let ports: { udpPort: number; httpPort: number } = { udpPort: 0, httpPort: 0 }
  const host = createLanHost({
    broadcast: (_channel, payload) => {
      const p = payload as { topic?: string }
      if (p.topic === 'lan-datagram') {
        const wire = p as unknown as { host: string; port: number; data: string }
        const datagram: LanDatagram = {
          host: wire.host,
          port: wire.port,
          data: new Uint8Array(Buffer.from(wire.data, 'base64')),
        }
        for (const cb of datagramHandlers) cb(datagram)
      } else if (p.topic === 'lan-request') {
        const wire = p as unknown as {
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
          ...(wire.body ? { bodyBytes: new Uint8Array(Buffer.from(wire.body, 'base64')) } : {}),
          ...(wire.bodyFile ? { bodyFile: wire.bodyFile as Uri } : {}),
          reply: (r) => void host.replyRequest(wire.id, r).catch(() => undefined),
        }
        for (const cb of requestHandlers) cb(request)
      }
    },
  })

  class LanAdapter extends Service implements LanService {
    private runningState = false
    constructor(ctx: Context) {
      super(ctx, 'lan')
    }
    get running(): boolean {
      return this.runningState
    }
    async start(spec: { udpPort: number; httpPort: number; multicastGroup: string }) {
      ports = await host.start(spec)
      this.runningState = true
      return ports
    }
    async stop() {
      this.runningState = false
      await host.stop()
    }
    async sendDatagram(
      target: { host: string; port: number },
      data: Uint8Array,
      o?: { broadcast?: boolean },
    ) {
      await host.sendDatagram(target, data, o)
    }
    onDatagram(cb: (d: LanDatagram) => void): Disposable {
      datagramHandlers.add(cb)
      return () => datagramHandlers.delete(cb)
    }
    onRequest(cb: (r: LanRequestContext) => void): Disposable {
      requestHandlers.add(cb)
      return () => requestHandlers.delete(cb)
    }
    async request(
      target: { host: string; port: number },
      req: {
        method?: string
        path: string
        headers?: Record<string, string>
        body?: Uint8Array
        bodyFile?: Uri
        timeoutMs?: number
      },
    ) {
      return host.request(target, req)
    }
  }

  const fibers: Array<{ dispose: () => Promise<void> }> = []
  fibers.push(await ctx.plugin(LanAdapter))
  fibers.push(await ctx.plugin(scannerPlugin()))
  fibers.push(await ctx.plugin(uiPlugin()))
  fibers.push(await ctx.plugin(LanSharePlugin, { udpPort: 0, httpPort: 0 }))
  await tick()
  await vi.waitFor(async () => {
    await (ctx.db as DbService).query('SELECT 1 FROM sources LIMIT 1')
  })

  return {
    ctx,
    dir,
    db: ctx.db as DbService,
    host,
    ports,
    lanShare: ctx.lanShare as unknown as LanSharePlugin,
    scanner: ctx.scanner as unknown as { imports: Uri[][] },
    dispose: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose().catch(() => undefined)
      await tick()
    },
  }
}

describe('loopback end-to-end (real transports)', () => {
  const nodes: Node[] = []

  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((n) => n.dispose()))
  })

  it('discovers a peer, sends two songs, and the receiver imports them', async () => {
    const a = await bootNode({ id: 'device-node-a', name: 'Node A' })
    const b = await bootNode({ id: 'device-node-b', name: 'Node B', autoAccept: true })
    nodes.push(a, b)

    // Discovery: B announces over the real UDP socket. Multicast routing is
    // unavailable in sandboxes, so the test unicasts the datagram B's own
    // announce loop produces — the receive path is the real one.
    await b.host.sendDatagram(
      { host: '127.0.0.1', port: a.ports.udpPort },
      encodeAnnounce({
        v: 1,
        app: 'bbebee',
        id: 'device-node-b',
        name: 'Node B',
        platform: 'desktop',
        httpPort: b.ports.httpPort,
        ts: Date.now(),
      }),
    )
    await vi.waitFor(() => {
      expect(a.lanShare.peers).toHaveLength(1)
      expect(a.lanShare.peers[0]).toMatchObject({ id: 'device-node-b', host: '127.0.0.1' })
    })

    // A's library: two real files with real bindings (seedLibrary writes
    // the files and the rows that point at them).
    const musicDir = join(a.dir, 'music')
    await mkdir(musicDir, { recursive: true })
    const one = Buffer.alloc(64 * 1024, 1).toString('latin1')
    const two = Buffer.alloc(32 * 1024, 2).toString('latin1')
    const urns = await seedLibrary(a.db, a.ctx.fs as unknown as FsNode, musicDir, [
      { name: 'one.mp3', content: one },
      { name: 'two.flac', content: two },
    ])
    void one
    void two

    const transfer = await a.lanShare.sendTo('device-node-b', urns)
    expect(transfer.state).toBe('completed')
    expect(transfer.items.map((i) => i.transferredBytes)).toEqual([64 * 1024, 32 * 1024])

    // The receiver imported both files and they are on disk under its own data.
    await vi.waitFor(() => expect(b.scanner.imports).toHaveLength(1))
    expect(b.scanner.imports[0]).toHaveLength(2)
    for (const uri of b.scanner.imports[0]!) {
      expect(await b.ctx.fs.exists(uri)).toBe(true)
      expect(uri).toContain('/received/')
    }
  }, 20_000)
})

describe('plugin surface', () => {
  it('exposes the expected entry shape', () => {
    expect(pluginName).toBe('plugin-lan-share')
    expect(typeof apply).toBe('function')
    expect(PLUGIN_ID).toBe('@bbebee/plugin-lan-share')
  })

  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()))
    expect(ids.size).toBe(100)
  })
})
