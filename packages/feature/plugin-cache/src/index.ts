/**
 * `plugin-cache` — covers and remote audio streams, served from disk.
 *
 * Two kinds of bytes arrive here, and both are answered locally whenever a
 * copy exists:
 *
 *  - **Covers.** `ctx.cache.artwork(ref)` returns the local file, fetching and
 *    writing it only on a miss. The cache record also fills in
 *    `artworks.local_uri`, so `ctx.mediaSession` and the now-playing screen see
 *    a local `Uri` on the next catalogue read — mobile lock screens drop
 *    remote artwork (docs/04 §7).
 *  - **Remote streams.** The `player/before-resolve` listener answers
 *    `kind: 'local'` when the track is already on disk; on a miss the remote
 *    handle is returned immediately and the bytes are written beside the
 *    cache **while the user listens**, so the second play never opens a
 *    socket. Streaming is never delayed by the cache.
 *
 * This is deliberately not `ctx.downloads`: a download is a file the user
 * asked to keep, and `plugin-download` owns that. Here every entry is
 * evictable, tracked in `cache_entries` (docs/07 §4.11) with an LRU clock per
 * class, and disabling the plugin leaves playback streaming with no branch
 * anywhere in the player.
 *
 * The failure mode is always "the cache did nothing": a refused response, a
 * full disk or a database that will not answer degrades to the network, never
 * to an error at play time.
 *
 * See docs/05 §2 and docs/07 §4.11.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  ArtworkRef,
  CacheClass,
  CacheService,
  CacheStats,
  CodecService,
  StreamHandle,
  StreamPrefs,
  Uri,
} from '@BBeBee/protocol'
import { stableId } from '@BBeBee/toolkit'

export interface CacheConfig {
  /**
   * Fetch and store new bytes.
   *
   * `false` stops writing: a stream streams and a cover stays whatever the
   * catalogue already had. **Hits are still served** — "stop caching" is not
   * "forget what is already here"; `clear()` is that verb.
   */
  enabled?: boolean
  /** Bytes the artwork class may hold before LRU eviction. `0` disables it. */
  maxArtworkBytes?: number
  /** Bytes the stream class may hold before LRU eviction. `0` disables it. */
  maxStreamBytes?: number
  /** Bytes the (reserved) http class may hold. Nothing writes it yet. */
  maxHttpBytes?: number
  /**
   * How often orphaned files and vanished entries are reconciled. `0`
   * disables the timer; the boot sweep always runs.
   */
  sweepIntervalMs?: number
}

const DEFAULTS: Required<CacheConfig> = {
  enabled: true,
  // Desktop defaults; the mobile shell passes smaller budgets (docs/07 §4.11).
  maxArtworkBytes: 512 * 1024 * 1024,
  maxStreamBytes: 1024 * 1024 * 1024,
  maxHttpBytes: 64 * 1024 * 1024,
  sweepIntervalMs: 60 * 60 * 1000,
}

const ARTWORK: CacheClass = 'artwork'
const STREAM: CacheClass = 'stream'

/**
 * How long after serving a file a `player/error` still counts as "this entry
 * is broken". A decode failure arrives in seconds; an unrelated error minutes
 * later is not about the file.
 */
const INVALIDATION_WINDOW_MS = 120_000

/** The columns this plugin reads back out of `cache_entries`. */
interface EntryRow {
  key: string
  uri: Uri
  size_bytes: number
}

export class Cache extends Service implements CacheService {
  static inject = ['fs', 'db', 'paths', 'http']

  private readonly config: Required<CacheConfig>
  /**
   * The plugin's own context, captured at construction.
   *
   * ⚠️ Not `this.ctx` at call time: inside a method reached through the
   * service proxy Cordis shadows `this.ctx` to the *caller's* context, and the
   * capability gate would then run against the caller's grants. See the note
   * in `plugin-player`.
   */
  private readonly ownCtx: Context
  private artworkDir!: Uri
  private streamDir!: Uri
  private sweepTimer?: ReturnType<typeof setInterval>
  private disposed = false
  /** The last stream this cache answered with, for `player/error` invalidation. */
  private lastServed?: { urn: string; at: number }
  /** In-flight transfers, keyed by cache key, so unload can abort them. */
  private readonly controllers = new Map<string, AbortController>()
  /** One fetch per key: two covers on one screen must not be two requests. */
  private readonly inflightArtwork = new Map<string, Promise<Uri | undefined>>()
  private readonly inflightStreams = new Map<string, Promise<void>>()
  /** Targets being written, which a sweep must not treat as orphans. */
  private readonly pending = new Set<Uri>()

  constructor(ctx: Context, config: CacheConfig = {}) {
    super(ctx, 'cache')
    this.ownCtx = ctx
    this.config = {
      enabled: config.enabled ?? DEFAULTS.enabled,
      maxArtworkBytes: config.maxArtworkBytes ?? DEFAULTS.maxArtworkBytes,
      maxStreamBytes: config.maxStreamBytes ?? DEFAULTS.maxStreamBytes,
      maxHttpBytes: config.maxHttpBytes ?? DEFAULTS.maxHttpBytes,
      sweepIntervalMs: config.sweepIntervalMs ?? DEFAULTS.sweepIntervalMs,
    }
  }

  async [Service.init]() {
    this.artworkDir = this.ownCtx.fs.join(this.ownCtx.paths.cache, 'artwork')
    this.streamDir = this.ownCtx.fs.join(this.ownCtx.paths.cache, 'stream')
    try {
      await this.ownCtx.fs.mkdir(this.artworkDir, { recursive: true })
      await this.ownCtx.fs.mkdir(this.streamDir, { recursive: true })
    } catch (error) {
      // A cache with nowhere to land is a cache that does nothing; playback
      // and covers still work, so this is a warning rather than a failure.
      this.ownCtx.logger.warn(`cache: could not prepare the cache directories: ${String(error)}`)
    }

    const offResolve = this.ownCtx.on(
      'player/before-resolve',
      (urn: string, prefs: StreamPrefs, next: () => Promise<StreamHandle>) =>
        this.resolve(urn, prefs, next),
    )
    const offError = this.ownCtx.on('player/error', (_error, urn: string) => this.invalidate(urn))

    // Initial sweep runs deferred in the background so it never blocks app startup.
    const initialSweepTimer = setTimeout(() => {
      if (this.disposed) return
      void this.sweep().catch((error: unknown) => {
        this.ownCtx.logger.warn(`cache: sweep failed: ${String(error)}`)
      })
    }, 5_000)

    if (this.config.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        if (this.disposed) return
        void this.sweep().catch((error: unknown) => {
          this.ownCtx.logger.warn(`cache: sweep failed: ${String(error)}`)
        })
      }, this.config.sweepIntervalMs)
    }

    this.ownCtx.logger.info(
      `cache: ready (artwork ≤ ${this.config.maxArtworkBytes} B, streams ≤ ${this.config.maxStreamBytes} B)`,
    )
    return () => {
      offResolve()
      offError()
      this.disposed = true
      clearTimeout(initialSweepTimer)
      if (this.sweepTimer) clearInterval(this.sweepTimer)
      if (this.artworkBatchTimer) {
        clearTimeout(this.artworkBatchTimer)
        this.artworkBatchTimer = null
        // Resolve pending batch items so their promises don't hang.
        const batch = this.artworkBatch
        this.artworkBatch = null
        if (batch) for (const item of batch) item.resolve(undefined)
      }
      for (const controller of this.controllers.values()) controller.abort()
      this.controllers.clear()
    }
  }

  /* ── covers ────────────────────────────────────────────────────────── */

  async artwork(ref: ArtworkRef, size?: number, priority: 0 | 1 | 2 = 1): Promise<Uri | undefined> {
    if (!ref?.id) return undefined
    const key = artworkKeyOf(ref.id)

    const cached = await this.cachedFile(key)
    if (cached) {
      await this.touch(key)
      await this.rememberLocal(ref.id, cached.uri)
      return cached.uri
    }

    // Lazy embedded artwork: the sourceUrl is an audio file, not an image.
    // Extract the cover via the codec (sidecar on desktop), cache it, and
    // return the local file. This is what keeps scan-time free of artwork
    // I/O — the bytes are only read when something actually displays them.
    // The sourceUrl is never valid artwork itself, so an extraction failure
    // ends here instead of falling through to the fetch path below (which
    // would try to download the audio file as an image).
    //
    // This branch runs BEFORE the localArtwork DB check below: a previous
    // buggy build recorded the audio file itself as local_uri for lazy:
    // refs (the old fall-through path), and the DB check would serve the
    // audio file as the cover. The cachedFile check above already covers
    // a successfully extracted cover, so lazy: refs never need the DB.
    if (ref.id.startsWith('lazy:')) {
      let audioUri = ref.sourceUrl
      if (!audioUri) {
        // The ref came without sourceUrl (UI passed { id } only); look up
        // the audio file from the artworks row.
        try {
          const row = await this.ownCtx.db.get<{ source_url: string | null }>(
            'SELECT source_url FROM artworks WHERE id = ?',
            [ref.id],
          )
          audioUri = row?.source_url ?? undefined
        } catch {
          // DB read failed; extraction will be skipped below.
        }
      }
      if (audioUri) {
        return await this.extractEmbeddedArtwork(key, ref.id, audioUri, priority)
      }
      // No audio source known — cannot extract. Do NOT fall through to the
      // local-file branch below, which would be wrong for a lazy ref.
      return undefined
    }

    // The catalogue may already know a local copy — the scanner writes the
    // embedded cover at scan time, and a previous build's cache may too.
    // Guard: the DB may hold polluted rows from a previous buggy build
    // (audio file recorded as local_uri). Only serve image extensions.
    const local = await this.localArtwork(ref.id)
    if (local && (await this.exists(local))) {
      const lowerLocal = local.toLowerCase().split('?')[0]!
      if (/\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i.test(lowerLocal)) {
        await this.rememberLocal(ref.id, local)
        return local
      }
      this.ownCtx.logger.warn(
        `cache: ignoring non-image local_uri for ${ref.id}: ${local}`,
      )
    }

    // If sourceUrl is an already-local location, it needs no HTTP fetch.
    // But verify it exists first — a stale ref to a cleared cache file must
    // not be returned, or the <img> will fail to load.
    //
    // Guard: only serve files with image extensions as artwork. An audio
    // file must never be returned as a cover (a `lazy:` ref's sourceUrl is
    // the audio file itself; if the lazy branch above was skipped, falling
    // through here would return the audio file and poison local_uri via
    // rememberLocal). Allowlist image extensions rather than blocklisting
    // audio ones — new audio formats appear, image formats don't.
    if (ref.sourceUrl && /^(file|content|data|bbebee-file):/i.test(ref.sourceUrl)) {
      const lower = ref.sourceUrl.toLowerCase().split('?')[0]!
      const isImage = /\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i.test(lower)
      if (!isImage) {
        this.ownCtx.logger.warn(
          `cache: refusing to serve non-image as artwork for ${ref.id}: ${ref.sourceUrl}`,
        )
      } else {
        try {
          // Convert bbebee-file:// to file:// for the existence check.
          let checkUri = ref.sourceUrl
          if (checkUri.startsWith('bbebee-file://localhost/')) {
            checkUri = 'file:///' + checkUri.slice('bbebee-file://localhost/'.length)
          } else if (checkUri.startsWith('bbebee-file:///')) {
            checkUri = 'file:///' + checkUri.slice('bbebee-file:///'.length)
          } else if (checkUri.startsWith('bbebee-file:')) {
            checkUri = 'file:' + checkUri.slice('bbebee-file:'.length)
          }
          if (await this.exists(checkUri)) {
            await this.rememberLocal(ref.id, ref.sourceUrl)
            return ref.sourceUrl
          }
          // File is gone — do NOT return the stale URL. Fall through to
          // re-fetch from the original source below.
          this.ownCtx.logger.info(`cache: stale local artwork ${ref.id}, re-fetching`)
        } catch {
          // Existence check failed; do not return a potentially stale URL.
        }
      }
    }

    if (!this.config.enabled || !ref.sourceUrl) return undefined
    const fetched = await this.fetchArtwork(key, ref.id, ref.sourceUrl)
    return fetched
  }

  /**
   * Extract an embedded cover from a local audio file, on demand.
   *
   * The scanner records `lazy:` refs instead of extracting at import time;
   * the first `artwork()` call for such a ref lands here. The parse runs in
   * the sidecar (via `ctx.codec`, which is `CodecBridge` on desktop), so the
   * file is read over direct fs, not over the IPC bridge.
   */
  private async extractEmbeddedArtwork(
    key: string,
    id: string,
    audioUri: Uri,
    priority: 0 | 1 | 2,
  ): Promise<Uri | undefined> {
    const inflight = this.inflightArtwork.get(key)
    if (inflight) return inflight

    // Micro-batch: collect concurrent extraction requests over a 10ms window
    // into one codec.readArtworkBatch call, amortizing IPC overhead when a
    // list view resolves dozens of covers at once.
    let resolve!: (uri: Uri | undefined) => void
    const promise = new Promise<Uri | undefined>((res) => {
      resolve = res
    })
    this.inflightArtwork.set(key, promise)
    promise.finally(() => {
      if (this.inflightArtwork.get(key) === promise) this.inflightArtwork.delete(key)
    })

    if (!this.artworkBatch) {
      this.artworkBatch = []
      this.artworkBatchTimer = setTimeout(() => {
        this.artworkBatchTimer = null
        void this.flushArtworkBatch()
      }, 10)
    }
    this.artworkBatch.push({ key, id, audioUri, priority, resolve })
    return promise
  }

  private artworkBatch:
    | Array<{
        key: string
        id: string
        audioUri: Uri
        priority: 0 | 1 | 2
        resolve: (uri: Uri | undefined) => void
      }>
    | null = null
  private artworkBatchTimer: ReturnType<typeof setTimeout> | null = null

  private async flushArtworkBatch(): Promise<void> {
    const batch = this.artworkBatch
    this.artworkBatch = null
    if (!batch || batch.length === 0) return

    // If player is loading, abort the batch entirely — covers can be
    // re-requested later via LazyArtwork. Don't let background work
    // delay playback.
    if (await this.isPlayerLoading()) {
      for (const item of batch) item.resolve(undefined)
      return
    }

    // Sort by priority: P0 (visible) first, then P1 (nearby), then P2 (background)
    batch.sort((a, b) => a.priority - b.priority)

    const codec = (
      this.ownCtx as unknown as {
        reflect: { get(key: string, required: boolean): unknown }
      }
    ).reflect.get('codec', false) as CodecService | undefined
    if (!codec) {
      for (const item of batch) item.resolve(undefined)
      return
    }

    // Chunk large batches: the sidecar bridge times out after 30s.
    // SEQUENTIAL, not concurrent: send one chunk, wait for it to complete,
    // yield to the event loop, then send the next. This keeps the bridge
    // free for player calls (readMetadata, audio.load) to interleave.
    // Covers can be slow; playback cannot wait.
    const CHUNK_SIZE = 5
    const chunks: (typeof batch)[] = []
    for (let start = 0; start < batch.length; start += CHUNK_SIZE) {
      chunks.push(batch.slice(start, start + CHUNK_SIZE))
    }
    // Strictly sequential: one chunk at a time, yield between chunks.
    for (let i = 0; i < chunks.length; i++) {
      // Playback priority: if the player is loading, abort the remaining
      // chunks — covers will be re-requested via LazyArtwork when visible.
      // Don't delay playback for background cover work.
      const shouldContinue = await this.waitForPlaybackIdle()
      if (!shouldContinue) {
        // Resolve remaining items with undefined so their promises don't hang
        for (let j = i; j < chunks.length; j++) {
          for (const item of chunks[j]!) item.resolve(undefined)
        }
        return
      }
      await this.processArtworkChunk(codec, chunks[i]!)
      // Yield to the event loop so player bridge calls can interleave.
      // Without this, back-to-back chunks starve the bridge.
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  /**
   * Check if the player is currently loading a track.
   * Used to abort/pause artwork batches so playback isn't delayed.
   */
  private async isPlayerLoading(): Promise<boolean> {
    const player = (
      this.ownCtx as unknown as {
        reflect: { get(key: string, required: boolean): unknown }
      }
    ).reflect.get('player', false) as { state?: { status?: string } } | undefined
    return player?.state?.status === 'loading'
  }

  /**
   * Wait until the player is not in a loading state, so artwork batch work
   * does not starve playback metadata reads. Returns immediately if no
   * player service or not loading.
   */
  private async waitForPlaybackIdle(): Promise<boolean> {
    // Returns false if we should abort (player started loading during wait)
    for (let i = 0; i < 20; i++) {
      if (!(await this.isPlayerLoading())) return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return !(await this.isPlayerLoading())
  }

  private async processArtworkChunk(
    codec: CodecService,
    chunk: Array<{
      key: string
      id: string
      audioUri: Uri
      priority: 0 | 1 | 2
      resolve: (uri: Uri | undefined) => void
    }>,
  ): Promise<void> {
    // Abort before hitting the bridge if player started loading.
    // The readArtworkBatch call cannot be cancelled once sent.
    if (await this.isPlayerLoading()) {
      for (const item of chunk) item.resolve(undefined)
      return
    }
    // Prefer the batch API; fall back to individual calls.
    if (codec.readArtworkBatch) {
      try {
        const results = await codec.readArtworkBatch(chunk.map((i) => i.audioUri))
        for (let i = 0; i < chunk.length; i++) {
          const item = chunk[i]!
          const bytes = results[i]
          try {
            item.resolve(await this.storeArtworkBytes(item.key, item.id, item.audioUri, bytes))
          } catch (error) {
            this.ownCtx.logger.warn(
              `cache: could not store artwork for ${item.audioUri}: ${String(error)}`,
            )
            item.resolve(undefined)
          }
        }
      } catch (error) {
        this.ownCtx.logger.warn(`cache: batch artwork extraction failed: ${String(error)}`)
        for (const item of chunk) item.resolve(undefined)
      }
    } else {
      for (const item of chunk) {
        // Check before each file in fallback mode — more granular abort.
        if (await this.isPlayerLoading()) {
          item.resolve(undefined)
          // Resolve remaining items in chunk
          const idx = chunk.indexOf(item)
          for (let j = idx + 1; j < chunk.length; j++) chunk[j]!.resolve(undefined)
          return
        }
        try {
          item.resolve(await this.doExtractEmbeddedArtwork(item.key, item.id, item.audioUri))
        } catch (error) {
          this.ownCtx.logger.warn(
            `cache: could not extract artwork for ${item.audioUri}: ${String(error)}`,
          )
          item.resolve(undefined)
        }
      }
    }
  }

  /**
   * Write extracted cover bytes to the cache dir. Shared by the batch and
   * single paths.
   */
  private async storeArtworkBytes(
    key: string,
    id: string,
    audioUri: Uri,
    bytes: Uint8Array | string | undefined,
  ): Promise<Uri | undefined> {
    // The cover sidecar returns base64 strings (JSON-safe); the main sidecar
    // returns Uint8Array. Normalize to Uint8Array.
    let data: Uint8Array | undefined
    if (typeof bytes === 'string') {
      try {
        const binary = atob(bytes)
        data = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
      } catch {
        return undefined
      }
    } else {
      data = bytes
    }
    if (!data || data.byteLength === 0) return undefined
    if (data.byteLength > this.config.maxArtworkBytes) {
      this.ownCtx.logger.warn(
        `cache: embedded artwork from ${audioUri} exceeds budget (${data.byteLength} bytes)`,
      )
      return undefined
    }
    const uri = this.ownCtx.fs.join(
      this.artworkDir,
      `aw_${stableId('artwork', key)}.${imageExtensionForBytes(data)}`,
    )
    await this.ownCtx.fs.writeFile(uri, data)
    await this.record(ARTWORK, key, uri, data.byteLength)
    await this.rememberLocal(id, uri)
    await this.enforce(ARTWORK)
    return uri
  }

  private async doExtractEmbeddedArtwork(
    key: string,
    id: string,
    audioUri: Uri,
  ): Promise<Uri | undefined> {
    // `codec` is an optional peer: on a context where it is not loaded the
    // extraction is skipped (no artwork) rather than breaking the plugin.
    // `reflect.get(key, false)` is the read that answers `undefined` instead
    // of throwing on a scoped context — the same mechanism `serviceOf` in
    // toolkit/hooks uses, minus the react import that module carries.
    const codec = (
      this.ownCtx as unknown as {
        reflect: { get(key: string, required: boolean): unknown }
      }
    ).reflect.get('codec', false) as CodecService | undefined
    if (!codec) {
      this.ownCtx.logger.debug(`cache: codec unavailable, skipping embedded artwork for ${audioUri}`)
      return undefined
    }
    let bytes: Uint8Array | undefined
    try {
      bytes = await codec.readArtwork(audioUri)
    } catch (error) {
      this.ownCtx.logger.warn(
        `cache: could not extract embedded artwork from ${audioUri}: ${String(error)}`,
      )
      return undefined
    }
    return this.storeArtworkBytes(key, id, audioUri, bytes)
  }

  private async fetchArtwork(key: string, id: string, sourceUrl: string): Promise<Uri | undefined> {
    const inflight = this.inflightArtwork.get(key)
    if (inflight) return inflight
    const run = this.downloadArtwork(key, id, sourceUrl).finally(() =>
      this.inflightArtwork.delete(key),
    )
    this.inflightArtwork.set(key, run)
    return run
  }

  private async downloadArtwork(
    key: string,
    id: string,
    sourceUrl: string,
  ): Promise<Uri | undefined> {
    const controller = new AbortController()
    this.controllers.set(key, controller)
    try {
      const response = await this.ownCtx.http({ url: sourceUrl, signal: controller.signal })
      if (response.status >= 400) {
        this.ownCtx.logger.warn(`cache: artwork ${sourceUrl} answered ${response.status}`)
        return undefined
      }
      const type = response.headers['content-type']
      if (type && !type.toLowerCase().startsWith('image/')) {
        this.ownCtx.logger.warn(`cache: artwork ${sourceUrl} is ${type}, not an image`)
        return undefined
      }
      // A single cover may not exceed the whole artwork budget, and reading it
      // into memory to find out is the thing this avoids.
      const declared = Number(response.headers['content-length'] ?? Number.NaN)
      if (Number.isFinite(declared) && declared > this.config.maxArtworkBytes) {
        this.ownCtx.logger.warn(`cache: artwork ${sourceUrl} is larger than the artwork budget`)
        return undefined
      }
      const bytes = await response.bytes()
      if (bytes.byteLength === 0 || bytes.byteLength > this.config.maxArtworkBytes) return undefined

      const uri = this.ownCtx.fs.join(
        this.artworkDir,
        `aw_${stableId('artwork', key)}.${imageExtension(type, sourceUrl)}`,
      )
      await this.ownCtx.fs.writeFile(uri, bytes)
      await this.record(ARTWORK, key, uri, bytes.byteLength)
      await this.rememberLocal(id, uri)
      await this.enforce(ARTWORK)
      return uri
    } catch (error) {
      // An aborted fetch is an unload, not a fault; anything else means the
      // cover stays remote, which is the status quo the cache exists to improve.
      if (!controller.signal.aborted) {
        this.ownCtx.logger.warn(`cache: could not fetch artwork ${sourceUrl}: ${String(error)}`)
      }
      return undefined
    } finally {
      this.controllers.delete(key)
    }
  }

  /* ── remote streams ────────────────────────────────────────────────── */

  /**
   * The `player/before-resolve` listener.
   *
   * A hit short-circuits: no provider request, no URL to expire. A miss calls
   * the rest of the chain and starts the cache in the background, so the play
   * it is caching is never delayed by it.
   */
  async resolve(
    urn: string,
    _prefs: StreamPrefs,
    next: () => Promise<StreamHandle>,
  ): Promise<StreamHandle> {
    const hit = await this.cachedStream(urn)
    if (hit) return hit

    const handle = await next()
    if (this.config.enabled && cacheable(handle)) {
      void this.storeStream(urn, handle).catch((error: unknown) => {
        this.ownCtx.logger.warn(`cache: could not cache ${urn}: ${String(error)}`)
      })
    }
    return handle
  }

  private async cachedStream(urn: string): Promise<StreamHandle | undefined> {
    const key = streamKeyOf(urn)
    const hit = await this.cachedFile(key)
    if (!hit) return undefined
    await this.touch(key)
    this.lastServed = { urn, at: Date.now() }
    const handle: StreamHandle = {
      kind: 'local',
      target: await this.ownCtx.fs.toPlayableUri(hit.uri),
      seekable: true,
    }
    if (hit.sizeBytes > 0) handle.byteLength = hit.sizeBytes
    return handle
  }

  /**
   * Fetch a remote stream to disk while it plays.
   *
   * One transfer per track: a second resolve during the first is already
   * streaming, and two writers on one path is worse than a missed cache.
   */
  private async storeStream(urn: string, handle: StreamHandle): Promise<void> {
    const key = streamKeyOf(urn)
    const inflight = this.inflightStreams.get(key)
    if (inflight) return inflight
    const run = this.downloadStream(key, urn, handle).finally(() =>
      this.inflightStreams.delete(key),
    )
    this.inflightStreams.set(key, run)
    return run
  }

  private async downloadStream(key: string, urn: string, handle: StreamHandle): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(key, controller)
    const target = this.ownCtx.fs.join(this.streamDir, `st_${stableId('stream', urn)}`)
    this.pending.add(target)
    let exceedsBudget = false

    try {
      await this.ownCtx.fs.mkdir(this.streamDir, { recursive: true })
      const { bytes } = await this.ownCtx.http.download({
        url: handle.target,
        ...(handle.headers ? { headers: { ...handle.headers } } : {}),
        to: target,
        signal: controller.signal,
        onResponse: (info) => {
          // The headers arrive before a body byte lands, so a stream large
          // enough to blow the whole budget is refused instead of written and
          // immediately evicted.
          if (info.total !== undefined && info.total > this.config.maxStreamBytes) {
            exceedsBudget = true
            controller.abort()
          }
        },
      })
      if (exceedsBudget) {
        await this.ownCtx.fs.remove(target).catch(() => undefined)
        this.ownCtx.logger.info(
          `cache: ${urn} is larger than the stream budget; streaming it uncached`,
        )
        return
      }
      await this.record(STREAM, key, target, bytes)
      await this.enforce(STREAM)
    } catch (error) {
      await this.ownCtx.fs.remove(target).catch(() => undefined)
      if (exceedsBudget) {
        this.ownCtx.logger.info(
          `cache: ${urn} is larger than the stream budget; streaming it uncached`,
        )
        return
      }
      throw error
    } finally {
      this.pending.delete(target)
      this.controllers.delete(key)
    }
  }

  /**
   * Drop a stream this cache served, after the player failed to play it.
   *
   * Only the most recently served track, and only for a short window: a
   * `player/error` for an unrelated track — or the same track hours later —
   * must not evict a good file.
   */
  invalidate(urn: string): void {
    const served = this.lastServed
    if (!served || served.urn !== urn) return
    if (Date.now() - served.at > INVALIDATION_WINDOW_MS) return
    this.lastServed = undefined
    void this.drop(streamKeyOf(urn))
      .then((dropped) => {
        if (dropped) {
          this.ownCtx.logger.warn(`cache: cached copy of ${urn} failed to play; dropping it`)
        }
      })
      .catch((error: unknown) => {
        this.ownCtx.logger.warn(`cache: could not drop ${urn}: ${String(error)}`)
      })
  }

  /* ── inspection and clearing ───────────────────────────────────────── */

  async stats(className?: CacheClass): Promise<CacheStats> {
    const row = className
      ? await this.ownCtx.db.get<{ entries: number; bytes: number | null }>(
          `SELECT COUNT(*) AS entries, COALESCE(SUM(size_bytes), 0) AS bytes
             FROM cache_entries WHERE class = ?`,
          [className],
        )
      : await this.ownCtx.db.get<{ entries: number; bytes: number | null }>(
          `SELECT COUNT(*) AS entries, COALESCE(SUM(size_bytes), 0) AS bytes FROM cache_entries`,
        )
    return { entries: row?.entries ?? 0, bytes: row?.bytes ?? 0 }
  }

  async clear(className?: CacheClass): Promise<number> {
    const rows = className
      ? await this.ownCtx.db.query<{ key: string; uri: Uri }>(
          'SELECT key, uri FROM cache_entries WHERE class = ?',
          [className],
        )
      : await this.ownCtx.db.query<{ key: string; uri: Uri }>(
          'SELECT key, uri FROM cache_entries',
        )
    for (const row of rows) await this.drop(row.key)
    if (rows.length > 0) {
      this.ownCtx.logger.info(`cache: cleared ${rows.length} entr(ies)`)
    }
    return rows.length
  }

  /* ── entries ───────────────────────────────────────────────────────── */

  /** The entry for `key`, when its file is still there. A missing file drops it. */
  private async cachedFile(key: string): Promise<{ uri: Uri; sizeBytes: number } | undefined> {
    let row: EntryRow | undefined
    try {
      row = await this.entry(key)
    } catch (error) {
      // A cache read that fails must not take playback down with it: the
      // caller still gets the remote stream, which is the pre-cache status quo.
      this.ownCtx.logger.warn(`cache: could not read entry ${key}: ${String(error)}`)
      return undefined
    }
    if (!row) return undefined
    if (!(await this.exists(row.uri))) {
      await this.drop(key)
      return undefined
    }
    return { uri: row.uri, sizeBytes: row.size_bytes }
  }

  private async entry(key: string): Promise<EntryRow | undefined> {
    return this.ownCtx.db.get<EntryRow>(
      `SELECT key, uri, size_bytes FROM cache_entries WHERE key = ?`,
      [key],
    )
  }

  private async record(
    className: CacheClass,
    key: string,
    uri: Uri,
    sizeBytes: number,
  ): Promise<void> {
    const existing = await this.entry(key).catch(() => undefined)
    const now = Date.now()
    await this.ownCtx.db.exec(
      `INSERT INTO cache_entries (key, class, uri, size_bytes, last_access_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(key) DO UPDATE SET
         class = excluded.class,
         uri = excluded.uri,
         size_bytes = excluded.size_bytes,
         last_access_at = excluded.last_access_at,
         expires_at = NULL`,
      [key, className, uri, sizeBytes, now, now],
    )
    if (existing && existing.uri !== uri) {
      await this.ownCtx.fs.remove(existing.uri).catch(() => undefined)
    }
  }

  /** The clock LRU eviction reads. A read or a play is the strongest "still wanted". */
  private async touch(key: string): Promise<void> {
    await this.ownCtx.db
      .exec('UPDATE cache_entries SET last_access_at = ? WHERE key = ?', [Date.now(), key])
      .catch((error: unknown) => {
        this.ownCtx.logger.warn(`cache: could not touch ${key}: ${String(error)}`)
      })
  }

  /** Remove an entry and its file. Returns whether one was there. */
  private async drop(key: string): Promise<boolean> {
    const row = await this.entry(key).catch(() => undefined)
    if (!row) return false
    await this.ownCtx.db.exec('DELETE FROM cache_entries WHERE key = ?', [key]).catch(() => undefined)
    await this.ownCtx.fs.remove(row.uri).catch(() => undefined)
    return true
  }

  /** Fill in the catalogue's local file, so every other reader sees it too. */
  private async rememberLocal(id: string, uri: Uri): Promise<void> {
    await this.ownCtx.db
      .exec('UPDATE artworks SET local_uri = ? WHERE id = ?', [uri, id])
      .catch((error: unknown) => {
        this.ownCtx.logger.warn(`cache: could not record a local artwork for ${id}: ${String(error)}`)
      })
  }

  private async localArtwork(id: string): Promise<Uri | undefined> {
    try {
      const row = await this.ownCtx.db.get<{ local_uri: string | null }>(
        'SELECT local_uri FROM artworks WHERE id = ?',
        [id],
      )
      return row?.local_uri ?? undefined
    } catch (error) {
      this.ownCtx.logger.warn(`cache: could not read artwork ${id}: ${String(error)}`)
      return undefined
    }
  }

  private async exists(uri: Uri): Promise<boolean> {
    return this.ownCtx.fs.exists(uri).catch(() => false)
  }

  /* ── eviction ──────────────────────────────────────────────────────── */

  private budgetFor(className: CacheClass): number {
    switch (className) {
      case 'artwork':
        return this.config.maxArtworkBytes
      case 'stream':
        return this.config.maxStreamBytes
      case 'http':
        return this.config.maxHttpBytes
      default:
        return 0
    }
  }

  /**
   * Keep a class inside its budget, least recently used first.
   *
   * Ordered by `last_access_at`, which both `cachedStream` and `artwork`
   * refresh — the file a user keeps returning to is the last one to go. The
   * classes do not share a budget because their losses do not cost the same:
   * evicting artwork is a re-fetch and a flicker, evicting a stream is the
   * user's re-download.
   */
  private async enforce(className: CacheClass): Promise<void> {
    const budget = this.budgetFor(className)
    if (budget <= 0) return
    const rows = await this.ownCtx.db.query<{ key: string; uri: Uri; size_bytes: number }>(
      `SELECT key, uri, size_bytes FROM cache_entries
        WHERE class = ? ORDER BY last_access_at ASC`,
      [className],
    )
    let total = rows.reduce((sum, row) => sum + row.size_bytes, 0)
    let removed = 0
    for (const row of rows) {
      if (total <= budget) break
      await this.drop(row.key)
      total -= row.size_bytes
      removed++
    }
    if (removed > 0) {
      this.ownCtx.logger.info(
        `cache: evicted ${removed} ${className} entr(ies) to stay within ${budget} bytes`,
      )
    }
  }

  /* ── housekeeping ──────────────────────────────────────────────────── */

  /**
   * Sweep = prune rows whose file is gone, then delete files no row names.
   *
   * A file can outlive its row (a crash between the write and the insert) and
   * a row can outlive its file (the OS reclaiming the cache directory), and
   * each leaves the other side lying. Running at boot and hourly keeps both
   * honest.
   *
   * ⚠️ In-flight targets are kept even though no row names them yet. A partial
   * transfer is work, not garbage.
   */
  async sweep(): Promise<void> {
    await this.prune(ARTWORK)
    await this.prune(STREAM)
    for (const [className, dir] of [
      [ARTWORK, this.artworkDir],
      [STREAM, this.streamDir],
    ] as const) {
      const files = await this.ownCtx.fs.list(dir).catch(() => [])
      if (files.length === 0) continue
      const rows = await this.ownCtx.db
        .query<{ uri: Uri }>('SELECT uri FROM cache_entries WHERE class = ?', [className])
        .catch(() => [])
      const named = new Set(rows.map((row) => this.ownCtx.fs.basename(row.uri)))
      for (const file of files) {
        if (file.isDirectory || named.has(file.name) || this.pending.has(file.uri)) continue
        this.ownCtx.logger.info(`cache: removing an orphaned ${className} file (${file.name})`)
        await this.ownCtx.fs.remove(file.uri).catch(() => undefined)
      }
    }
  }

  private async prune(className: CacheClass): Promise<void> {
    const rows = await this.ownCtx.db
      .query<{ key: string; uri: Uri }>('SELECT key, uri FROM cache_entries WHERE class = ?', [
        className,
      ])
      .catch(() => [])
    for (const row of rows) {
      if (this.pending.has(row.uri)) continue
      if (await this.exists(row.uri)) continue
      await this.ownCtx.db.exec('DELETE FROM cache_entries WHERE key = ?', [row.key]).catch(() => undefined)
    }
  }
}

function artworkKeyOf(id: string): string {
  return `artwork:${id}`
}

function streamKeyOf(urn: string): string {
  return `stream:${urn}`
}

/**
 * Whether a resolved handle is worth caching.
 *
 * `kind: 'remote'` alone is not enough: a live stream is `seekable: false`
 * and would be written until the user closes the app, and a blob/data URL
 * has no bytes to fetch. Interrupting either is the cache overreaching.
 */
function cacheable(handle: StreamHandle): boolean {
  return handle.kind === 'remote' && handle.seekable && /^https?:\/\//i.test(handle.target)
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

/**
 * The extension a cover is written under.
 *
 * Unlike audio, the extension is load-bearing here: a React Native `Image`
 * and a desktop `<img>` both infer the decoder from it, and an extensionless
 * cached cover renders as a broken image rather than as an image.
 */
export function imageExtension(contentType: string | undefined, url: string): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  const byType = type ? IMAGE_EXTENSIONS[type] : undefined
  if (byType) return byType
  const path = url.split('?')[0]?.split('#')[0] ?? ''
  const dot = path.lastIndexOf('.')
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  return /^[a-z0-9]{2,4}$/.test(extension) ? extension : 'img'
}

/** Image extension from magic bytes (for extracted embedded artwork). */
function imageExtensionForBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return 'img'
}

export const name = 'plugin-cache'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.cache` is usable.
 */
export async function apply(ctx: Context, config: CacheConfig = {}) {
  ctx.logger.info('plugin-cache: loaded')
  const fiber = await ctx.plugin(Cache, config)
  return () => void fiber.dispose()
}

export default { name, apply }
