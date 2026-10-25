/**
 * `plugin-cache`, against real SQL and a real filesystem.
 *
 * What is worth pinning is the contract the player and the covers depend on:
 * a cover is fetched once and every later render reads a file; a remote stream
 * plays from the network once and every later resolve answers `kind: 'local'`
 * without asking anything downstream; and a cache that cannot do its job —
 * refused, disabled, broken bytes — degrades to the network rather than to an
 * error.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type {
  DownloadRequest,
  HttpRequest,
  HttpResponse,
  StreamHandle,
  StreamPrefs,
  Uri,
} from '@BBeBee/protocol'
import plugin, { imageExtension, type Cache, type CacheConfig } from './index.js'

const URN = 'BBeBee:demo:track:1'
const URN2 = 'BBeBee:demo:track:2'
const PREFS: StreamPrefs = { quality: 'normal', saveData: false, acceptFormats: [] }

const REMOTE: StreamHandle = {
  kind: 'remote',
  target: 'https://cdn.example.test/audio.m4s?token=abc',
  seekable: true,
  headers: { Referer: 'https://example.test/video/1' },
}

const COVER_ID = 'https://img.example.test/cover.jpg'

/** `ctx.http`, with both the callable fetch (artwork) and download under test control. */
class HttpStub extends Service {
  static inject = ['fs']
  readonly requests: HttpRequest[] = []
  readonly downloads: DownloadRequest[] = []
  art = new Uint8Array([9, 8, 7])
  artType = 'image/jpeg'
  artFailure?: Error
  streamBody = new Uint8Array([1, 2, 3, 4])
  streamFailure?: Error

  constructor(ctx: Context) {
    super(ctx, 'http')
  }

  protected [Service.invoke](req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req)
    if (this.artFailure) return Promise.reject(this.artFailure)
    const body = this.art
    return Promise.resolve({
      status: 200,
      headers: { 'content-type': this.artType },
      url: req.url,
      text: async () => new TextDecoder().decode(body),
      json: async <T>() => JSON.parse(new TextDecoder().decode(body)) as T,
      bytes: async () => body,
      stream: () => new ReadableStream<Uint8Array>(),
    })
  }

  async download(req: DownloadRequest): Promise<{ bytes: number; etag?: string }> {
    this.downloads.push(req)
    if (this.streamFailure) throw this.streamFailure
    req.onResponse?.({ total: this.streamBody.byteLength })
    if (req.signal?.aborted) throw new Error('The operation was aborted')
    await this.ctx.fs.writeFile(req.to, this.streamBody)
    req.onProgress?.(this.streamBody.byteLength, this.streamBody.byteLength)
    return { bytes: this.streamBody.byteLength }
  }
}

async function harness(config: CacheConfig = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-cache') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(HttpStub)
  const fiber = await ctx.plugin(plugin, config)
  await tick()

  const http = ctx.http as unknown as HttpStub
  const cache = ctx.cache as unknown as Cache

  return {
    ctx,
    fiber,
    http,
    cache,
    entries: (className?: string) =>
      ctx.db.query<{ key: string; class: string; uri: Uri; size_bytes: number }>(
        className
          ? 'SELECT key, class, uri, size_bytes FROM cache_entries WHERE class = ?'
          : 'SELECT key, class, uri, size_bytes FROM cache_entries',
        className ? [className] : undefined,
      ),
  }
}

/** Wait for a background transition to land, rather than guessing at ticks. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await check()) return
    await tick()
  }
  throw new Error('timed out waiting for the cache state')
}

function resolve(ctx: Context, urn = URN, terminal: () => Promise<StreamHandle> = async () => REMOTE) {
  return ctx.waterfall('player/before-resolve', urn, PREFS, terminal)
}

describe('plugin-cache artwork', () => {
  it('fetches a cover once, then serves the local file', async () => {
    const h = await harness()
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, 0)`,
      [COVER_ID, COVER_ID],
    )

    const first = await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })
    expect(first).toBeTruthy()
    expect(await h.ctx.fs.readBytes(first!)).toEqual(h.http.art)
    expect(h.http.requests).toHaveLength(1)

    // The catalogue now knows the local file, so the lock screen and any
    // later catalogue read get a local Uri without asking this plugin again.
    const row = await h.ctx.db.get<{ local_uri: Uri }>(
      'SELECT local_uri FROM artworks WHERE id = ?',
      [COVER_ID],
    )
    expect(row?.local_uri).toBe(first)

    const second = await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })
    expect(second).toBe(first)
    expect(h.http.requests, 'the second read never reaches the network').toHaveLength(1)

    const entries = await h.entries('artwork')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.size_bytes).toBe(h.http.art.byteLength)
  })

  it('serves the catalogue’s local copy without the network', async () => {
    const h = await harness()
    const uri = h.ctx.fs.join(h.ctx.paths.cache, 'artworks', 'existing.jpg')
    await h.ctx.fs.mkdir(h.ctx.fs.join(h.ctx.paths.cache, 'artworks'), { recursive: true })
    await h.ctx.fs.writeFile(uri, new Uint8Array([5, 5]))
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url, local_uri, fetched_at) VALUES (?, ?, ?, 0)`,
      [COVER_ID, COVER_ID, uri],
    )

    expect(await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })).toBe(uri)
    expect(h.http.requests).toHaveLength(0)
  })

  it('does not cache a non-image response', async () => {
    const h = await harness()
    h.http.artType = 'text/html'
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, 0)`,
      [COVER_ID, COVER_ID],
    )

    expect(await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })).toBeUndefined()
    expect(await h.entries('artwork')).toHaveLength(0)
  })

  it('degrades to undefined when the fetch fails', async () => {
    const h = await harness()
    h.http.artFailure = new Error('connection reset')
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, 0)`,
      [COVER_ID, COVER_ID],
    )

    expect(await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })).toBeUndefined()
  })

  it('writes nothing when disabled, but serves what is already cached', async () => {
    const h = await harness({ enabled: false })
    await h.ctx.db.exec(
      `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, 0)`,
      [COVER_ID, COVER_ID],
    )
    expect(await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })).toBeUndefined()
    expect(h.http.requests).toHaveLength(0)

    // A row written by an earlier session is still a hit.
    const uri = h.ctx.fs.join(h.ctx.paths.cache, 'artwork', 'aw_old.jpg')
    await h.ctx.fs.mkdir(h.ctx.fs.join(h.ctx.paths.cache, 'artwork'), { recursive: true })
    await h.ctx.fs.writeFile(uri, new Uint8Array([7]))
    await h.ctx.db.exec(
      `INSERT INTO cache_entries (key, class, uri, size_bytes, last_access_at, created_at)
       VALUES (?, 'artwork', ?, 1, 0, 0)`,
      [`artwork:${COVER_ID}`, uri],
    )
    expect(await h.ctx.cache.artwork({ id: COVER_ID, sourceUrl: COVER_ID })).toBe(uri)
    expect(h.http.requests).toHaveLength(0)
  })
})

/** `ctx.codec`, returning a canned cover (or none) for lazy-extraction tests. */
class CodecStub extends Service {
  art?: Uint8Array
  constructor(ctx: Context) {
    super(ctx, 'codec')
  }
  async readArtwork(_uri: Uri): Promise<Uint8Array | undefined> {
    return this.art
  }
}

describe('plugin-cache lazy artwork', () => {
  const AUDIO = 'file:///music/album/track.flac' as Uri
  const LAZY_ID = 'lazy:deadbeef'

  async function lazyHarness(cover: Uint8Array | undefined | 'absent') {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-cache-lazy') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(HttpStub)
    if (cover !== 'absent') {
      await ctx.plugin(CodecStub)
      ;(ctx.codec as unknown as CodecStub).art = cover
    }
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    // A scanner-written lazy row: the cover has never been read.
    await ctx.db.exec(
      `INSERT INTO artworks (id, source_url, local_uri, fetched_at) VALUES (?, ?, NULL, 0)`,
      [LAZY_ID, AUDIO],
    )
    return { ctx, fiber, http: ctx.http as unknown as HttpStub }
  }

  it('extracts the embedded cover on first render, then serves the local file', async () => {
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
    const h = await lazyHarness(cover)

    const first = await h.ctx.cache.artwork({ id: LAZY_ID, sourceUrl: AUDIO })
    expect(first).toBeTruthy()
    expect(String(first)).toMatch(/\.jpg$/)
    expect(await h.ctx.fs.readBytes(first!)).toEqual(cover)
    // Never fetched: the sourceUrl is the audio file, not an image.
    expect(h.http.requests).toHaveLength(0)

    // The catalogue now knows the local file.
    const row = await h.ctx.db.get<{ local_uri: Uri }>(
      'SELECT local_uri FROM artworks WHERE id = ?',
      [LAZY_ID],
    )
    expect(row?.local_uri).toBe(first)

    // Second render is a cache hit — no second extraction.
    const second = await h.ctx.cache.artwork({ id: LAZY_ID, sourceUrl: AUDIO })
    expect(second).toBe(first)
    expect(h.http.requests).toHaveLength(0)
  })

  it('returns undefined without fetching when the audio has no embedded cover', async () => {
    const h = await lazyHarness(undefined)
    expect(await h.ctx.cache.artwork({ id: LAZY_ID, sourceUrl: AUDIO })).toBeUndefined()
    expect(h.http.requests).toHaveLength(0)
  })

  it('returns undefined without codec, and never tries to fetch the audio file', async () => {
    const h = await lazyHarness('absent')
    expect(await h.ctx.cache.artwork({ id: LAZY_ID, sourceUrl: AUDIO })).toBeUndefined()
    expect(h.http.requests).toHaveLength(0)
  })
})

describe('plugin-cache streams', () => {
  it('caches a stream while it plays, and serves the file next time', async () => {
    const h = await harness()

    const first = await resolve(h.ctx)
    expect(first).toEqual(REMOTE)

    await until(async () => (await h.entries('stream')).length === 1)
    const [entry] = await h.entries('stream')
    expect(entry!.key).toBe(`stream:${URN}`)
    expect(entry!.size_bytes).toBe(h.http.streamBody.byteLength)
    expect(await h.ctx.fs.readBytes(entry!.uri)).toEqual(h.http.streamBody)
    // The stream's own headers are what fetch it: signed URLs are not open.
    expect(h.http.downloads[0]!.headers).toEqual(REMOTE.headers)

    // The second resolve short-circuits: nothing downstream is asked.
    let asked = false
    const second = await resolve(h.ctx, URN, async () => {
      asked = true
      return REMOTE
    })
    expect(second.kind).toBe('local')
    expect(second.target).not.toBe(REMOTE.target)
    expect(asked, 'a cache hit must not reach the provider').toBe(false)
    expect(second.byteLength).toBe(h.http.streamBody.byteLength)
  })

  it('does not fetch a stream when disabled, and still serves a cached copy', async () => {
    const h = await harness({ enabled: false })
    const first = await resolve(h.ctx)
    expect(first).toEqual(REMOTE)

    await tick()
    await tick()
    expect(h.http.downloads).toHaveLength(0)
    expect(await h.entries('stream')).toHaveLength(0)

    const uri = h.ctx.fs.join(h.ctx.paths.cache, 'stream', 'st_old')
    await h.ctx.fs.mkdir(h.ctx.fs.join(h.ctx.paths.cache, 'stream'), { recursive: true })
    await h.ctx.fs.writeFile(uri, new Uint8Array([1, 1]))
    await h.ctx.db.exec(
      `INSERT INTO cache_entries (key, class, uri, size_bytes, last_access_at, created_at)
       VALUES (?, 'stream', ?, 2, 0, 0)`,
      [`stream:${URN}`, uri],
    )
    const hit = await resolve(h.ctx)
    expect(hit.kind).toBe('local')
  })

  it('never caches a live stream or a non-http target', async () => {
    const h = await harness()
    await resolve(h.ctx, URN, async () => ({ ...REMOTE, seekable: false }))
    await resolve(h.ctx, URN2, async () => ({ ...REMOTE, target: 'blob:1234' }))
    await tick()
    await tick()
    expect(h.http.downloads).toHaveLength(0)
    expect(await h.entries('stream')).toHaveLength(0)
  })

  it('refuses a stream larger than the budget', async () => {
    const h = await harness({ maxStreamBytes: 2 })
    await resolve(h.ctx)
    await until(async () => h.http.downloads.length === 1)

    // The transfer is aborted on the headers, before a byte is kept.
    await until(async () => (await h.entries('stream')).length === 0 && h.http.downloads.length === 1)
    const dir = h.ctx.fs.join(h.ctx.paths.cache, 'stream')
    const files = await h.ctx.fs.list(dir)
    expect(files, 'no partial file is left behind').toHaveLength(0)
  })

  it('evicts the least recently used stream once the budget is exceeded', async () => {
    const h = await harness({ maxStreamBytes: 6 })
    await resolve(h.ctx)
    await until(async () => (await h.entries('stream')).length === 1)

    // Older than the one about to land, so the LRU order is deterministic.
    await h.ctx.db.exec(`UPDATE cache_entries SET last_access_at = 1 WHERE key = ?`, [`stream:${URN}`])

    await resolve(h.ctx, URN2)
    await until(async () => {
      const rows = await h.entries('stream')
      return rows.length === 1 && rows[0]!.key === `stream:${URN2}`
    })
    expect(h.http.downloads).toHaveLength(2)
  })

  it('forgets a cached stream the player could not play', async () => {
    const h = await harness()
    await resolve(h.ctx)
    await until(async () => (await h.entries('stream')).length === 1)
    const [entry] = await h.entries('stream')
    await resolve(h.ctx) // marks it as served

    h.ctx.emit('player/error', new Error('corrupt') as never, URN)

    await until(async () => (await h.entries('stream')).length === 0)
    await until(async () => (await h.ctx.fs.exists(entry!.uri)) === false)
  })
})

describe('plugin-cache housekeeping', () => {
  it('reports and clears what it holds', async () => {
    const h = await harness()
    await resolve(h.ctx)
    await until(async () => (await h.entries('stream')).length === 1)

    expect(await h.ctx.cache.stats('stream')).toEqual({ entries: 1, bytes: 4 })
    expect((await h.ctx.cache.stats()).entries).toBe(1)

    expect(await h.ctx.cache.clear('stream')).toBe(1)
    expect(await h.entries('stream')).toHaveLength(0)
    expect((await h.ctx.cache.stats()).entries).toBe(0)
  })

  it('sweeps orphaned files and vanished rows when it loads', async () => {
    const h = await harness()
    const streamDir = h.ctx.fs.join(h.ctx.paths.cache, 'stream')
    await h.ctx.fs.mkdir(streamDir, { recursive: true })
    const orphan = h.ctx.fs.join(streamDir, 'st_orphan')
    await h.ctx.fs.writeFile(orphan, new Uint8Array([1]))
    const vanished = h.ctx.fs.join(streamDir, 'st_vanished')
    await h.ctx.db.exec(
      `INSERT INTO cache_entries (key, class, uri, size_bytes, last_access_at, created_at)
       VALUES ('stream:old', 'stream', ?, 3, 0, 0)`,
      [vanished],
    )

    // Reload over the same directories and database, which is the restart.
    await h.fiber.dispose()
    await tick()
    await h.ctx.plugin(plugin, {})
    await tick()
    await (h.ctx.cache as Cache).sweep()

    expect(await h.ctx.fs.exists(orphan), 'an unrecorded file is garbage').toBe(false)
    expect(await h.entries('stream'), 'a row whose file is gone is garbage').toHaveLength(0)
  })

  it('says which extension a cover is written under', () => {
    expect(imageExtension('image/jpeg', 'https://x/cover')).toBe('jpg')
    expect(imageExtension('image/png; charset=binary', 'https://x/cover')).toBe('png')
    expect(imageExtension(undefined, 'https://x/cover.webp?token=1')).toBe('webp')
    expect(imageExtension(undefined, 'https://x/cover')).toBe('img')
  })
})

describe('plugin-cache lifecycle', () => {
  it('snapshots clean after unload', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-cache-leak') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(HttpStub)
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
