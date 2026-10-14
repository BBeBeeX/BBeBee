/**
 * The download manager, against real SQL and a real filesystem.
 *
 * What is worth pinning is the contract a downloads screen and the player
 * depend on: a file the user downloads is kept and plays locally without
 * asking anything downstream, every verb moves the row and the file together,
 * and a failure degrades to streaming rather than to an error.
 *
 * The automatic media cache is deliberately absent here — a resolve no longer
 * queues anything — because that is `plugin-cache`'s job.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type {
  DownloadRequest,
  MediaProvider,
  NetworkState,
  StreamHandle,
  StreamPrefs,
  Uri,
} from '@BBeBee/protocol'
import plugin, { formatFor, type Downloads } from './index.js'
import cachePlugin from '@BBeBee/plugin-cache'

const URN = 'BBeBee:demo:track:1'
const URN2 = 'BBeBee:demo:track:2'
const PREFS: StreamPrefs = { quality: 'normal', saveData: false, acceptFormats: [] }

const REMOTE: StreamHandle = {
  kind: 'remote',
  target: 'https://cdn.example.test/audio.m4s?token=abc',
  seekable: true,
  headers: { Referer: 'https://example.test/video/1' },
}

interface Call {
  url: string
  to: Uri
  resumeFrom?: number
  headers?: Record<string, string>
}

/** `ctx.http`, with the transfer under the test's control. */
class HttpStub extends Service {
  static inject = ['fs']
  readonly calls: Call[] = []
  readonly requests: any[] = []
  body = new Uint8Array([1, 2, 3, 4])
  etag = '"v1"'
  failure?: Error
  /** Runs after the first half has landed — pause, cancel or hang here. */
  onHalf?: (req: DownloadRequest) => Promise<void> | void

  coverBytes?: Uint8Array

  constructor(ctx: Context) {
    super(ctx, 'http')
  }

  protected [Service.invoke](req: any): Promise<any> {
    return this.request(req)
  }

  async request(req: any) {
    this.requests.push(req)
    const isCover =
      typeof req?.url === 'string' &&
      (req.url.includes('cover') || req.url.includes('artwork') || req.url.includes('image'))
    const bytes = isCover && this.coverBytes ? this.coverBytes : this.body
    const mime = isCover ? 'image/jpeg' : 'application/octet-stream'
    return {
      status: 200,
      headers: { 'content-type': mime },
      url: req?.url ?? '',
      async text() {
        return new TextDecoder().decode(bytes)
      },
      async json() {
        return JSON.parse(new TextDecoder().decode(bytes))
      },
      async bytes() {
        return bytes
      },
      stream() {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        })
      },
    }
  }

  async download(req: DownloadRequest) {
    this.calls.push({
      url: req.url,
      to: req.to,
      ...(req.resumeFrom !== undefined ? { resumeFrom: req.resumeFrom } : {}),
      ...(req.headers ? { headers: req.headers } : {}),
    })
    if (this.failure) throw this.failure

    const total = this.body.byteLength
    // `If-Range` is honoured the way a real server honours it: a matching
    // validator serves the range, a stale one answers with the whole file, and
    // the difference is `append: false` here.
    const conditional = req.headers?.['if-range']
    const honored = (req.resumeFrom ?? 0) > 0 && (!conditional || conditional === this.etag)
    const start = honored ? (req.resumeFrom ?? 0) : 0

    req.onResponse?.({ etag: this.etag, total })
    const half = start + Math.ceil((total - start) / 2)
    await this.ctx.fs.writeFile(req.to, this.body.slice(start, half), { append: start > 0 })
    req.onProgress?.(half, total)
    await this.onHalf?.(req)
    if (req.signal?.aborted) throw new Error('The operation was aborted')
    await this.ctx.fs.writeFile(req.to, this.body.slice(half), { append: true })
    req.onProgress?.(total, total)
    return { bytes: total, etag: this.etag }
  }
}

/** `ctx.sources`, with one provider the worker can resolve explicitly. */
class SourcesStub extends Service {
  provider?: MediaProvider

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  forUrn(): MediaProvider | undefined {
    return this.provider
  }

  get providers(): readonly MediaProvider[] {
    return this.provider ? [this.provider] : []
  }
}

/** `ctx.device`, with the network and charger under the test's control. */
class DeviceStub extends Service {
  metered = false
  charging = true
  private readonly listeners = new Set<(state: NetworkState) => void>()

  constructor(ctx: Context) {
    super(ctx, 'device')
  }

  async network(): Promise<NetworkState> {
    return { online: true, type: this.metered ? 'cellular' : 'wifi', metered: this.metered }
  }

  async battery(): Promise<{ level: number; charging: boolean }> {
    return { level: 50, charging: this.charging }
  }

  onNetworkChange(cb: (state: NetworkState) => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  /** What the OS would do when Wi-Fi drops or comes back. */
  emitNetwork(): void {
    const state: NetworkState = {
      online: true,
      type: this.metered ? 'cellular' : 'wifi',
      metered: this.metered,
    }
    for (const listener of [...this.listeners]) listener(state)
  }
}

function provider(
  resolveStream: (id?: string, prefs?: StreamPrefs) => Promise<StreamHandle>,
): MediaProvider {
  return {
    sourceId: 'demo',
    displayName: 'Demo',
    capabilities: {
      search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
      browse: false,
      recommend: false,
      lyrics: false,
      artwork: false,
      library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
      streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
      regional: false,
    },
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    getTrack: async () => {
      throw new Error('not needed')
    },
    resolveStream: async (id, prefs) => resolveStream(id, prefs),
    ping: async () => true,
  }
}

async function harness(
  config: { enabled?: boolean; gateRecheckMs?: number } = {},
  options: { device?: boolean; cache?: boolean } = {},
) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-downloads') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(HttpStub)
  await ctx.plugin(SourcesStub)
  if (options.device) await ctx.plugin(DeviceStub)
  // Loaded *before* plugin-download deliberately, so the ordering test proves
  // the prepend rather than the registration order.
  if (options.cache) {
    await ctx.plugin(cachePlugin, {})
    await tick()
  }
  const fiber = await ctx.plugin(plugin, config)
  await tick()

  // The catalogue's foreign keys need a source and tracks before a binding or
  // a task can name one, exactly as in the app.
  await ctx.db.exec(
    `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
     VALUES ('demo', 'https://demo.test', 'Demo', '{}', 'h', 0, 0)`,
  )
  for (const [urn, title] of [
    [URN, 'First'],
    [URN2, 'Second'],
  ] as const) {
    await ctx.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at)
       VALUES (?, 'demo', '1', ?, 0)`,
      [urn, title],
    )
  }

  const http = ctx.http as unknown as HttpStub
  const sources = ctx.sources as unknown as SourcesStub
  sources.provider = provider(async () => REMOTE)
  const downloads = ctx.downloads as unknown as Downloads
  const device = options.device ? (ctx.device as unknown as DeviceStub) : undefined
  const keptDir = ctx.fs.join(ctx.paths.downloads, 'BBeBee')

  return {
    ctx,
    fiber,
    http,
    downloads,
    device,
    keptDir,
    bindings: () =>
      ctx.db.query<{ uri: Uri; format: string | null; size_bytes: number | null }>(
        'SELECT uri, format, size_bytes FROM media_bindings',
      ),
    cacheEntries: () =>
      ctx.db.query<{ key: string; uri: Uri }>('SELECT key, uri FROM cache_entries'),
  }
}

/** Wait for a background transition to land, rather than guessing at ticks. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (await check()) return
    await tick()
  }
  throw new Error('timed out waiting for the download state')
}

function resolve(ctx: Context, urn = URN, terminal: () => Promise<StreamHandle> = async () => REMOTE) {
  return ctx.waterfall('player/before-resolve', urn, PREFS, terminal)
}

/** Enqueue one download and wait until it is done. */
async function downloadOnce(h: Awaited<ReturnType<typeof harness>>, urn = URN): Promise<string> {
  const task = (await h.ctx.downloads.enqueue([urn]))[0]!
  await until(() => h.downloads.task(task.id)?.state === 'done')
  return task.id
}

describe('plugin-download', () => {
  it('downloads a track queued without a play, resolving it on the way', async () => {
    const h = await harness()
    const task = (await h.ctx.downloads.enqueue([URN2]))[0]!
    expect(task.state).toBe('queued')

    await until(() => h.downloads.task(task.id)?.state === 'done')
    const done = h.downloads.task(task.id)!
    expect(done.title).toBe('Second')
    expect(done.bytesDone).toBe(4)
    expect(done.bindingId).toBeTruthy()
    expect(done.kept).toBe(true)
    const rows = await h.bindings()
    expect(rows[0]!.uri.startsWith(h.ctx.paths.downloads)).toBe(true)
    expect(h.http.calls[0], 'fetched with the stream’s own headers').toMatchObject({
      url: REMOTE.target,
    })
  })

  it('plays a kept download back without touching the provider', async () => {
    const h = await harness()
    await downloadOnce(h)
    const written = await h.bindings()
    expect(written).toHaveLength(1)
    expect(written[0]!.format).toBe('m4a')
    expect(written[0]!.size_bytes).toBe(4)
    expect(await h.ctx.fs.exists(written[0]!.uri)).toBe(true)

    // A resolve short-circuits on the binding: nothing downstream is asked.
    let asked = false
    const handle = await resolve(h.ctx, URN, async () => {
      asked = true
      return REMOTE
    })
    expect(handle.kind).toBe('local')
    expect(handle.target).toBe(written[0]!.uri)
    expect(asked, 'a download hit must not reach the provider').toBe(false)
  })

  it('never queues anything on resolve, and still answers with a kept file', async () => {
    const h = await harness({ enabled: false })
    const remote = await resolve(h.ctx)
    expect(remote).toEqual(REMOTE)

    await tick()
    await tick()
    expect(h.downloads.tasks, 'resolve does not download').toHaveLength(0)
    expect(h.http.calls).toHaveLength(0)

    // A binding written by an earlier session is still a hit.
    await h.ctx.fs.mkdir(h.keptDir, { recursive: true })
    const uri = h.ctx.fs.join(h.keptDir, 'bd_old')
    await h.ctx.fs.writeFile(uri, new Uint8Array([9, 9]))
    await h.ctx.db.exec(
      `INSERT INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, verified_at, created_at)
       VALUES ('bd_old', ?, ?, 'm4a', 2, 'download', 0, 0)`,
      [URN, uri],
    )

    const hit = await resolve(h.ctx)
    expect(hit.kind).toBe('local')
    expect(hit.target).toBe(uri)
  })

  it('pauses mid-transfer and resumes from the bytes that landed', async () => {
    const h = await harness()
    let paused = false
    h.http.onHalf = async () => {
      if (paused) return
      paused = true
      await h.ctx.downloads.pause(h.downloads.tasks[0]!.id)
    }

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'paused')

    const atPause = h.downloads.task(task.id)!
    expect(atPause.bytesDone, 'the bytes on disk are the checkpoint').toBeGreaterThan(0)
    expect(atPause.bytesDone).toBeLessThan(4)

    await h.ctx.downloads.resume(task.id)
    await until(() => h.downloads.task(task.id)?.state === 'done')

    // The second attempt asked for the rest, not the whole file — and it
    // told the server which version the partial bytes belong to.
    expect(h.http.calls[1]!.resumeFrom).toBe(atPause.bytesDone)
    expect(h.http.calls[1]!.headers?.['if-range']).toBe('"v1"')
  })

  it('restarts instead of splicing when the remote file changed', async () => {
    const h = await harness()
    let paused = false
    h.http.onHalf = async () => {
      if (paused) return
      paused = true
      await h.ctx.downloads.pause(h.downloads.tasks[0]!.id)
    }

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'paused')
    const partial = h.downloads.task(task.id)!.bytesDone
    expect(partial).toBeGreaterThan(0)

    // The remote was re-encoded between attempts. `If-Range` with the stored
    // validator makes a conforming server answer with the whole file, and the
    // plugin rewrites from zero rather than appending new bytes to old ones.
    h.http.etag = '"v2"'
    await h.ctx.downloads.resume(task.id)
    await until(() => h.downloads.task(task.id)?.state === 'done')

    expect(h.http.calls[1]!.headers?.['if-range']).toBe('"v1"')
    expect(h.downloads.task(task.id)!.bytesDone).toBe(h.http.body.byteLength)
    expect(await h.ctx.fs.readBytes(h.http.calls[0]!.to)).toEqual(h.http.body)
  })

  it('cancels a running download and removes its partial file', async () => {
    const h = await harness()
    let canceled = false
    h.http.onHalf = async () => {
      if (canceled) return
      canceled = true
      await h.ctx.downloads.cancel(h.downloads.tasks[0]!.id)
    }

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'canceled')
    await until(async () => (await h.ctx.fs.exists(h.http.calls[0]!.to)) === false)
    expect(await h.bindings()).toHaveLength(0)
  })

  it('records a failure, and retries it into a finished download', async () => {
    const h = await harness()
    h.http.failure = new Error('connection reset')

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'failed')
    expect(h.downloads.task(task.id)!.error).toContain('connection reset')

    h.http.failure = undefined
    await h.ctx.downloads.retry(task.id)
    await until(() => h.downloads.task(task.id)?.state === 'done')
  })

  it('removes a finished download, binding and file together', async () => {
    const h = await harness()
    const id = await downloadOnce(h)
    const uri = (await h.bindings())[0]!.uri

    await h.ctx.downloads.remove(id)

    expect(h.downloads.task(id)).toBeUndefined()
    expect(await h.bindings()).toHaveLength(0)
    expect(await h.ctx.fs.exists(uri)).toBe(false)
  })

  it('never clears a finished download', async () => {
    const h = await harness()
    await downloadOnce(h)

    await h.ctx.downloads.clearFinished()

    expect(h.downloads.tasks).toHaveLength(1)
    const rows = await h.bindings()
    expect(rows).toHaveLength(1)
    expect(await h.ctx.fs.exists(rows[0]!.uri)).toBe(true)
  })

  it('replaces an older binding when the same track is downloaded again', async () => {
    const h = await harness()
    await downloadOnce(h)
    const kept = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(kept.id)?.state === 'done')

    const rows = await h.bindings()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.uri.startsWith(h.ctx.paths.downloads)).toBe(true)
  })

  it('drops a binding whose file is gone and streams instead', async () => {
    const h = await harness({ enabled: false })
    await h.ctx.fs.mkdir(h.keptDir, { recursive: true })
    const uri = h.ctx.fs.join(h.keptDir, 'bd_gone')
    await h.ctx.fs.writeFile(uri, new Uint8Array([9]))
    await h.ctx.db.exec(
      `INSERT INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, verified_at, created_at)
       VALUES ('bd_gone', ?, ?, null, 1, 'download', 0, 0)`,
      [URN, uri],
    )
    await h.ctx.fs.remove(uri)

    let asked = false
    const handle = await resolve(h.ctx, URN, async () => {
      asked = true
      return REMOTE
    })

    expect(handle.kind).toBe('remote')
    expect(asked).toBe(true)
    await until(async () => (await h.bindings()).length === 0)
  })

  it('forgets a download the player could not play', async () => {
    const h = await harness()
    const id = await downloadOnce(h)
    const uri = (await h.bindings())[0]!.uri
    await resolve(h.ctx) // marks it as served

    h.ctx.emit('player/error', { code: 'provider', message: 'corrupt' } as never, URN)

    await until(() => h.downloads.task(id) === undefined)
    expect(await h.ctx.fs.exists(uri)).toBe(false)
  })

  it('drops the playback cache an older build wrote, but not a kept file', async () => {
    const h = await harness({ enabled: false })
    const legacyDir = h.ctx.fs.join(h.ctx.paths.cache, 'media')
    await h.ctx.fs.mkdir(legacyDir, { recursive: true })
    const legacy = h.ctx.fs.join(legacyDir, 'bd_legacy')
    await h.ctx.fs.writeFile(legacy, new Uint8Array([1, 2]))
    await h.ctx.db.exec(
      `INSERT INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, verified_at, created_at)
       VALUES ('bd_legacy', ?, ?, 'm4a', 2, 'download', 0, 0)`,
      [URN, legacy],
    )
    await h.ctx.fs.mkdir(h.keptDir, { recursive: true })
    const keptUri = h.ctx.fs.join(h.keptDir, 'bd_kept')
    await h.ctx.fs.writeFile(keptUri, new Uint8Array([3, 4]))
    await h.ctx.db.exec(
      `INSERT INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, verified_at, created_at)
       VALUES ('bd_kept', ?, ?, 'm4a', 2, 'download', 0, 0)`,
      [URN2, keptUri],
    )

    // Reload over the same database and filesystem, which is the upgrade.
    await h.fiber.dispose()
    await tick()
    await h.ctx.plugin(plugin, { enabled: false })
    await tick()

    expect(await h.ctx.fs.exists(legacy), 'the old playback copy is gone').toBe(false)
    expect(await h.ctx.fs.exists(keptUri), 'the kept download survives').toBe(true)
    const rows = await h.bindings()
    expect(rows.map((row) => row.uri)).toEqual([keptUri])
  })

  it('resets what a kill left behind, and keeps real partial bytes', async () => {
    const h = await harness({ enabled: false })
    const withBytes = h.ctx.fs.join(h.keptDir, 'bd_partial')
    await h.ctx.fs.mkdir(h.keptDir, { recursive: true })
    await h.ctx.fs.writeFile(withBytes, new Uint8Array(2))
    const withoutBytes = h.ctx.fs.join(h.keptDir, 'bd_vanished')

    // A `running` row is a queued one after a restart (docs/07 §4.8), and a
    // counter whose file is gone must be zeroed: resuming from it would append
    // a ranged response to an empty file.
    await h.ctx.db.exec(
      `INSERT INTO download_tasks (id, track_urn, target_uri, state, bytes_done, priority, attempts, created_at, updated_at)
       VALUES ('dl_part', ?, ?, 'running', 2, 0, 0, 0, 0)`,
      [URN, withBytes],
    )
    await h.ctx.db.exec(
      `INSERT INTO download_tasks (id, track_urn, target_uri, state, bytes_done, priority, attempts, created_at, updated_at)
       VALUES ('dl_vanished', ?, ?, 'running', 900, 0, 0, 0, 0)`,
      [URN2, withoutBytes],
    )

    // Reload the plugin over the same database, which is the restart.
    await h.fiber.dispose()
    await tick()
    await h.ctx.plugin(plugin, { enabled: false })
    await tick()

    expect(h.ctx.downloads.task('dl_part')!.state).toBe('queued')
    expect(h.ctx.downloads.task('dl_part')!.bytesDone).toBe(2)
    expect(h.ctx.downloads.task('dl_vanished')!.bytesDone).toBe(0)
  })

  it('holds the queue on a metered connection with wifi-only', async () => {
    const h = await harness({ gateRecheckMs: 10 }, { device: true })
    h.device!.metered = true
    await h.ctx.downloads.setPolicy({ wifiOnly: true })

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await tick()
    expect(h.downloads.task(task.id)!.state).toBe('queued')
    expect(h.downloads.task(task.id)!.blocked).toBe('wifi')
    expect(h.http.calls, 'nothing left the device').toHaveLength(0)

    // The network changing is what releases it — no timer needed for this one.
    h.device!.metered = false
    h.device!.emitNetwork()
    await until(() => h.downloads.task(task.id)?.state === 'done')
    expect(h.downloads.task(task.id)!.blocked).toBeUndefined()
  })

  it('holds on battery with charging-only, and re-checks the charger', async () => {
    const h = await harness({ gateRecheckMs: 10 }, { device: true })
    h.device!.charging = false
    await h.ctx.downloads.setPolicy({ chargingOnly: true })
    await h.ctx.downloads.enqueue([URN2])

    await until(() => h.downloads.tasks[0]?.blocked === 'charging')
    expect(h.http.calls).toHaveLength(0)

    // The charger has no change event on this contract: the gate timer is what
    // notices it went in.
    h.device!.charging = true
    await until(() => h.downloads.tasks[0]?.state === 'done')
  })

  it('pauses a running transfer when the policy stops allowing it', async () => {
    const h = await harness({ gateRecheckMs: 60_000 }, { device: true })
    await h.ctx.downloads.setPolicy({ wifiOnly: true })
    let dropped = false
    h.http.onHalf = async () => {
      if (dropped) return
      dropped = true
      // Wi-Fi drops mid-transfer, and the pause has to land before the stub
      // writes the second half or the test is racing the abort.
      h.device!.metered = true
      h.device!.emitNetwork()
      await until(() => h.downloads.tasks[0]?.state === 'paused')
    }

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'paused')
    expect(h.downloads.task(task.id)!.blocked).toBe('wifi')
    const atPause = h.downloads.task(task.id)!.bytesDone

    // And Wi-Fi coming back resumes what the *policy* paused — without the
    // user pressing anything.
    h.device!.metered = false
    h.device!.emitNetwork()
    await until(() => h.downloads.task(task.id)?.state === 'done')
    expect(h.http.calls[1]!.resumeFrom).toBe(atPause)
  })

  it('persists the policy across a restart', async () => {
    const h = await harness({ gateRecheckMs: 10 }, { device: true })
    h.device!.metered = true
    await h.ctx.downloads.setPolicy({ wifiOnly: true, chargingOnly: true })

    const row = await h.ctx.db.get<{ wifi_only: number; charging_only: number }>(
      'SELECT wifi_only, charging_only FROM download_policies WHERE id = ?',
      ['dp_default'],
    )
    expect(row).toEqual({ wifi_only: 1, charging_only: 1 })

    await h.fiber.dispose()
    await tick()
    await h.ctx.plugin(plugin, { gateRecheckMs: 10 })
    await tick()
    expect(h.ctx.downloads.policy.wifiOnly).toBe(true)
    expect(h.ctx.downloads.policy.chargingOnly).toBe(true)
  })

  it('keeps a downloaded file ahead of a cached stream for the same track', async () => {
    const h = await harness({}, { cache: true })

    // Both plugins are loaded, and the cache is allowed to hold the track
    // first — plugin-cache is registered before plugin-download, so only the
    // prepend makes the download the answer.
    const streamed = await resolve(h.ctx, URN, async () => REMOTE)
    expect(streamed.kind).toBe('remote')
    await until(async () => (await h.cacheEntries()).length === 1)

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')
    const kept = (await h.bindings())[0]!.uri
    expect(kept.startsWith(h.ctx.paths.downloads)).toBe(true)

    const handle = await resolve(h.ctx, URN, async () => REMOTE)
    expect(handle.kind).toBe('local')
    expect(handle.target, 'the kept download outranks the cache').toBe(kept)
  })

  it('says which container a stream is, and nothing when it cannot', () => {
    expect(formatFor({ kind: 'remote', target: 'https://x/a.m4s?t=1', seekable: true })).toBe('m4a')
    expect(formatFor({ kind: 'remote', target: 'https://x/a.flac', seekable: true })).toBe('flac')
    expect(
      formatFor({ kind: 'remote', target: 'https://x/stream', mimeType: 'audio/mpeg', seekable: true }),
    ).toBe('mp3')
    expect(
      formatFor({ kind: 'remote', target: 'https://x/s', codec: 'mp4a.40.2', seekable: true }),
    ).toBe('m4a')
    expect(formatFor({ kind: 'remote', target: 'https://x/s', seekable: true })).toBeUndefined()
  })

  it('emits download/started and ui/toast and names file as song title', async () => {
    const h = await harness()
    await h.ctx.db.exec(
      `UPDATE tracks SET title = '晴天' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))

    const toasts: { message: string; tone?: string }[] = []
    const started: { id: string; title: string }[] = []
    h.ctx.on('ui/toast', (t) => void toasts.push(t))
    h.ctx.on('download/started', (id, title) => void started.push({ id, title }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    expect(started.length).toBeGreaterThan(0)
    expect(toasts.length).toBeGreaterThan(0)
    expect(toasts[0]?.message).toContain('晴天')

    const binding = (await h.bindings())[0]!
    // File name is song title + format extension
    expect(decodeURIComponent(binding.uri).endsWith('晴天.mp3')).toBe(true)
  })

  it('embeds cover art into downloaded mp3 file', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0])
    const coverUri = `${h.keptDir}/cover.png` as Uri
    await h.ctx.fs.writeFile(coverUri, coverBytes)
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, local_uri, bytes) VALUES ('art-1', ?, ?)`,
      [coverUri, coverBytes.byteLength],
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = '晴天', artwork_id = 'art-1' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('APIC')).toBe(true)
  })

  it('embeds cover art from remote HTTP url into MP3 file', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0]) // mock mp3 audio

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-remote', 'https://img.example.test/cover.jpg')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'RemoteSong', artwork_id = 'art-remote' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('APIC')).toBe(true)
  })

  it('embeds cover art from protocol-relative URL into MP3 file', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-proto', '//img.example.test/cover.jpg')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'ProtoSong', artwork_id = 'art-proto' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('APIC')).toBe(true)
  })

  it('fetches track metadata and cover from provider.getTrack when track not in DB', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    const NEW_URN = 'BBeBee:demo:track:online_only'
    const prov = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))
    prov.getTrack = async (id: string) => ({
      urn: `BBeBee:demo:track:${id}`,
      title: 'Online Song',
      artists: [{ urn: 'BBeBee:demo:artist:1', name: 'Online Artist', role: 'main', ordinal: 0 }],
      albumTitle: 'Online Album',
      artwork: { id: 'https://cdn.example.test/cover.png', sourceUrl: 'https://cdn.example.test/cover.png' },
    })
    ;(h.ctx.sources as unknown as SourcesStub).provider = prov

    const task = (await h.ctx.downloads.enqueue([NEW_URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    expect(decodeURIComponent(binding.uri).endsWith('Online Song.mp3')).toBe(true)
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('APIC')).toBe(true)
  })

  it('embeds cover art into downloaded FLAC file', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes

    // Mock FLAC: 'fLaC' + STREAMINFO (34 bytes) + mock frames
    const mockFlac = new Uint8Array(4 + 4 + 34 + 10)
    mockFlac.set([0x66, 0x4c, 0x61, 0x43], 0) // 'fLaC'
    mockFlac[4] = 0x80 // isLast = 1, type = 0
    mockFlac[7] = 34
    h.http.body = mockFlac

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-flac', 'https://img.example.test/cover.png')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'FlacSong', artwork_id = 'art-flac' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.flac',
      seekable: true,
      codec: 'flac',
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    expect(fileBytes[0]).toBe(0x66)
    expect(fileBytes[1]).toBe(0x4c)
    expect(fileBytes[2]).toBe(0x61)
    expect(fileBytes[3]).toBe(0x43)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.includes('image/png')).toBe(true)
  })

  it('embeds cover art into downloaded M4A file', async () => {
    const h = await harness()
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes

    // Mock MP4: ftyp (16 bytes) + moov (16 bytes) + mdat (16 bytes)
    const ftyp = new Uint8Array(16)
    new DataView(ftyp.buffer).setUint32(0, 16)
    ftyp.set([0x66, 0x74, 0x79, 0x70], 4) // 'ftyp'
    const moov = new Uint8Array(16)
    new DataView(moov.buffer).setUint32(0, 16)
    moov.set([0x6d, 0x6f, 0x6f, 0x76], 4) // 'moov'
    const mdat = new Uint8Array(16)
    new DataView(mdat.buffer).setUint32(0, 16)
    mdat.set([0x6d, 0x64, 0x61, 0x74], 4) // 'mdat'

    const mockM4a = new Uint8Array(ftyp.length + moov.length + mdat.length)
    mockM4a.set(ftyp, 0)
    mockM4a.set(moov, ftyp.length)
    mockM4a.set(mdat, ftyp.length + moov.length)
    h.http.body = mockM4a

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-m4a', 'https://img.example.test/cover.jpg')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'M4aSong', artwork_id = 'art-m4a' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.m4a',
      seekable: true,
      codec: 'mp4a',
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.includes('covr')).toBe(true)
  })

  it('leverages plugin-cache to fetch and cache cover artwork', async () => {
    const h = await harness({}, { cache: true })
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    h.http.coverBytes = coverBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-cached', 'https://img.example.test/cached_cover.jpg')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'CachedSong', artwork_id = 'art-cached' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      seekable: true,
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('APIC')).toBe(true)

    // Verify artwork was saved in cache
    const cacheEntries = await h.cacheEntries()
    expect(cacheEntries.length).toBeGreaterThan(0)
  })

  it('synchronizes wifiOnly policy with settings service', async () => {
    const h = await harness()
    let settingsWifiOnly = false
    class SettingsStub extends Service {
      constructor(c: Context) {
        super(c, 'settings')
      }
      getSync() {
        return { downloadWifiOnly: settingsWifiOnly } as never
      }
      async update(patch: { downloadWifiOnly?: boolean }) {
        if (patch.downloadWifiOnly !== undefined) settingsWifiOnly = patch.downloadWifiOnly
        return {} as never
      }
      onSettingsChange() {
        return () => {}
      }
    }
    await h.ctx.plugin(SettingsStub)
    await tick()

    await h.ctx.downloads.setPolicy({ wifiOnly: true })
    expect(settingsWifiOnly).toBe(true)
  })

  it('extracts artist from raw_json, embeds into audio tags, and populates track_artists table', async () => {
    const h = await harness()
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])
    const rawJson = JSON.stringify({ ar: [{ name: '周杰伦' }] })
    await h.ctx.db.exec(
      `UPDATE tracks SET title = '青花瓷', raw_json = ? WHERE urn = ?`,
      [rawJson, URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/qinghuaci.mp3',
      seekable: true,
      codec: 'mpeg',
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    // Task object in memory has artist
    const doneTask = h.downloads.task(task.id)
    expect(doneTask?.artist).toBe('周杰伦')

    // track_artists junction table populated
    const rows = await h.ctx.db.query<{ name: string }>(
      `SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn WHERE ta.track_urn = ?`,
      [URN],
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.name).toBe('周杰伦')

    // Embedded tag has TPE1 (ID3 artist frame)
    const binding = (await h.bindings())[0]!
    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    const text = new TextDecoder('latin1').decode(fileBytes)
    expect(text.startsWith('ID3')).toBe(true)
    expect(text.includes('TPE1')).toBe(true)
  })

  it('follows settings.downloadFormat mp4 and saves file as .mp4', async () => {
    const h = await harness()
    class SettingsStub extends Service {
      constructor(c: Context) {
        super(c, 'settings')
      }
      getSync() {
        return { downloadFormat: 'mp4' } as never
      }
      async update() {
        return {} as never
      }
      onSettingsChange() {
        return () => {}
      }
    }
    await h.ctx.plugin(SettingsStub)
    await tick()

    // Mock an M4A file container
    const ftyp = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0])
    const moov = new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76])
    const mdat = new Uint8Array([0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74])
    const mockM4a = new Uint8Array(ftyp.length + moov.length + mdat.length)
    mockM4a.set(ftyp, 0)
    mockM4a.set(moov, ftyp.length)
    mockM4a.set(mdat, ftyp.length + moov.length)
    h.http.body = mockM4a

    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async (_id, prefs) => {
      expect(prefs?.acceptFormats).toContain('mp4')
      return {
        kind: 'remote',
        target: 'https://cdn.example.test/song.m4a',
        seekable: true,
        codec: 'mp4a',
      }
    })

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    expect(binding.uri.endsWith('.mp4')).toBe(true)
    expect(binding.format).toBe('mp4')
  })

  it('follows settings.downloadFormat mp3 and saves file as .mp3', async () => {
    const h = await harness()
    class SettingsStub extends Service {
      constructor(c: Context) {
        super(c, 'settings')
      }
      getSync() {
        return { downloadFormat: 'mp3' } as never
      }
      async update() {
        return {} as never
      }
      onSettingsChange() {
        return () => {}
      }
    }
    await h.ctx.plugin(SettingsStub)
    await tick()

    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])
    let resolvedQuality: string | undefined
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async (_id, prefs) => {
      resolvedQuality = prefs?.quality
      return {
        kind: 'remote',
        target: 'https://cdn.example.test/song.mp3',
        seekable: true,
        codec: 'mpeg',
      }
    })

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    expect(resolvedQuality).toBe('high')
    const binding = (await h.bindings())[0]!
    expect(binding.uri.endsWith('.mp3')).toBe(true)
    expect(binding.format).toBe('mp3')
  })

  it('transcodes downloaded stream when actual format differs from settings.downloadFormat', async () => {
    const h = await harness()
    class SettingsStub extends Service {
      constructor(c: Context) {
        super(c, 'settings')
      }
      getSync() {
        return { downloadFormat: 'flac' } as never
      }
      async update() {
        return {} as never
      }
      onSettingsChange() {
        return () => {}
      }
    }
    await h.ctx.plugin(SettingsStub)

    function minimalFlac(): Uint8Array {
      const bytes = new Uint8Array(42)
      bytes[0] = 0x66
      bytes[1] = 0x4c
      bytes[2] = 0x61
      bytes[3] = 0x43
      bytes[4] = 0x80
      bytes[5] = 0x00
      bytes[6] = 0x00
      bytes[7] = 0x22
      return bytes
    }

    class CodecStub extends Service {
      static inject = ['fs']
      readonly transcodeCalls: Array<{ inputUri: string; outputUri: string; targetFormat: string }> = []
      constructor(c: Context) {
        super(c, 'codec')
      }
      async transcode(options: { inputUri: string; outputUri: string; targetFormat: string }) {
        this.transcodeCalls.push(options)
        await this.ctx.fs.writeFile(options.outputUri, minimalFlac())
        return { ok: true }
      }
    }
    await h.ctx.plugin(CodecStub)
    await tick()

    // Remote server provides MP3 stream instead of FLAC
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => {
      return {
        kind: 'remote',
        target: 'https://cdn.example.test/stream.mp3',
        seekable: true,
      }
    })

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const codec = h.ctx.get('codec') as unknown as CodecStub
    expect(codec.transcodeCalls).toHaveLength(1)
    expect(codec.transcodeCalls[0]!.targetFormat).toBe('flac')
    expect(codec.transcodeCalls[0]!.outputUri.endsWith('.flac')).toBe(true)

    const binding = (await h.bindings())[0]!
    expect(binding.uri.endsWith('.flac')).toBe(true)
    expect(binding.format).toBe('flac')

    const fileBytes = await h.ctx.fs.readBytes(binding.uri)
    // Starts with fLaC
    expect(fileBytes[0]).toBe(0x66)
    expect(fileBytes[1]).toBe(0x4c)
    expect(fileBytes[2]).toBe(0x61)
    expect(fileBytes[3]).toBe(0x43)
  })

  it('falls back to detected stream container if codec is not available', async () => {
    const h = await harness()
    class SettingsStub extends Service {
      constructor(c: Context) {
        super(c, 'settings')
      }
      getSync() {
        return { downloadFormat: 'flac' } as never
      }
      async update() {
        return {} as never
      }
      onSettingsChange() {
        return () => {}
      }
    }
    await h.ctx.plugin(SettingsStub)
    await tick()

    // Remote server provides MP3 stream instead of FLAC
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => {
      return {
        kind: 'remote',
        target: 'https://cdn.example.test/stream.mp3',
        seekable: true,
      }
    })

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const binding = (await h.bindings())[0]!
    expect(binding.uri.endsWith('.mp3')).toBe(true)
    expect(binding.format).toBe('mp3')
  })

  it('sends User-Agent and Referer headers when fetching cover image', async () => {
    const h = await harness()
    h.http.coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url) VALUES ('art-cdn', 'https://cdn.example.test/cover.jpg')`,
    )
    await h.ctx.db.exec(
      `UPDATE tracks SET title = 'CdnSong', artwork_id = 'art-cdn' WHERE urn = ?`,
      [URN],
    )
    ;(h.ctx.sources as unknown as SourcesStub).provider = provider(async () => ({
      kind: 'remote',
      target: 'https://cdn.example.test/audio.mp3',
      headers: { Referer: 'https://example.test/stream' },
      seekable: true,
    }))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const coverReq = h.http.requests.find((r) => r.url === 'https://cdn.example.test/cover.jpg')
    expect(coverReq).toBeDefined()
    expect(coverReq.headers?.['User-Agent']).toContain('Mozilla/5.0')
    expect(coverReq.headers?.['Referer']).toBe('https://example.test/stream')
  })

  it('emits ui/toast with ok tone on download completion', async () => {
    const h = await harness()
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])
    const toasts: any[] = []
    h.ctx.on('ui/toast', (t) => void toasts.push(t))

    const task = (await h.ctx.downloads.enqueue([URN]))[0]!
    await until(() => h.downloads.task(task.id)?.state === 'done')

    const successToast = toasts.find((t) => t.tone === 'ok')
    expect(successToast).toBeDefined()
    expect(successToast.message).toContain(task.title)
  })

  it('accepts Track object in enqueue and embeds provided metadata and cover', async () => {
    const h = await harness()
    const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
    h.http.coverBytes = jpgBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    const trackObj = {
      urn: 'BBeBee:demo:track:rich-meta',
      title: 'Custom Title',
      artists: [{ name: 'Custom Singer', role: 'main' as const, ordinal: 0, urn: 'BBeBee:demo:artist:singer' }],
      albumTitle: 'Custom Album',
      year: 2024,
      trackNo: 3,
      artwork: { id: 'art-custom', sourceUrl: 'https://img.test/cover.jpg' },
      raw: { custom_prop: 123 },
    }

    const task = (await h.ctx.downloads.enqueue([trackObj as any]))[0]!
    expect(task.title).toBe('Custom Title')
    expect(task.artist).toBe('Custom Singer')

    await until(() => h.downloads.task(task.id)?.state === 'done')

    // Verify database rows created
    const trRow = await h.ctx.db.get<{ title: string; track_no: number; year: number }>(
      'SELECT title, track_no, year FROM tracks WHERE urn = ?',
      [trackObj.urn],
    )
    expect(trRow?.title).toBe('Custom Title')
    expect(trRow?.track_no).toBe(3)
    expect(trRow?.year).toBe(2024)

    const artistRow = await h.ctx.db.get<{ name: string }>(
      `SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn WHERE ta.track_urn = ?`,
      [trackObj.urn],
    )
    expect(artistRow?.name).toBe('Custom Singer')

    const coverReq = h.http.requests.find((r) => r.url === 'https://img.test/cover.jpg')
    expect(coverReq).toBeDefined()
  })

  it('accepts raw object with non-standard fields in enqueue', async () => {
    const h = await harness()
    const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
    h.http.coverBytes = jpgBytes
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    const nonStandardTrack = {
      urn: 'BBeBee:demo:track:raw-meta',
      title: 'Raw Song Title',
      raw: {
        singer: 'Raw Singer',
        pic_url: 'https://cdn.raw.test/raw-cover.jpg',
      },
    }

    const task = (await h.ctx.downloads.enqueue([nonStandardTrack as any]))[0]!
    expect(task.title).toBe('Raw Song Title')
    expect(task.artist).toBe('Raw Singer')

    await until(() => h.downloads.task(task.id)?.state === 'done')

    const coverReq = h.http.requests.find((r) => r.url === 'https://cdn.raw.test/raw-cover.jpg')
    expect(coverReq).toBeDefined()
  })

  it('accepts object URN, wrapped tracks, and tracks without URN in enqueue', async () => {
    const h = await harness()
    h.http.body = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0])

    // Case 1: urn is an object
    const objUrnItem = {
      urn: { sourceId: 'demo', kind: 'track', id: 'obj-urn-track' },
      title: 'Object Urn Track',
      artist: 'Demo Singer',
    }
    const task1 = (await h.ctx.downloads.enqueue([objUrnItem as any]))[0]!
    expect(task1).toBeDefined()
    expect(task1.trackUrn).toBe('BBeBee:demo:track:obj-urn-track')
    expect(task1.title).toBe('Object Urn Track')

    // Case 2: wrapped track { track: Track }
    const wrappedItem = {
      track: {
        urn: 'BBeBee:demo:track:wrapped-track',
        title: 'Wrapped Song',
        artist: 'Wrapped Singer',
      },
    }
    const task2 = (await h.ctx.downloads.enqueue([wrappedItem as any]))[0]!
    expect(task2).toBeDefined()
    expect(task2.trackUrn).toBe('BBeBee:demo:track:wrapped-track')
    expect(task2.title).toBe('Wrapped Song')

    // Case 3: no urn, has id and sourceId
    const noUrnItem = {
      sourceId: 'demo',
      id: 'constructed-id',
      name: 'Constructed Song',
      singer: 'Constructed Singer',
    }
    const task3 = (await h.ctx.downloads.enqueue([noUrnItem as any]))[0]!
    expect(task3).toBeDefined()
    expect(task3.trackUrn).toBe('BBeBee:demo:track:constructed-id')
    expect(task3.title).toBe('Constructed Song')
    expect(task3.artist).toBe('Constructed Singer')

    // Case 4: skips undefined/null safely
    const tasks = await h.ctx.downloads.enqueue([null as any, undefined as any])
    expect(tasks).toEqual([])
  })
})

describe('plugin-download lifecycle', () => {
  it('snapshots clean after unload', async () => {
    const root = await tempDir('bbebee-downloads-leak')
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(HttpStub)
    await ctx.plugin(SourcesStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
