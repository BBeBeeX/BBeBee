/**
 * `ITokenizer` over `ctx.fs` range reads.
 *
 * `music-metadata` wants to seek: an ID3v2 header declares its own length, a
 * tail `moov` lives at the end of the file, appending headers (ID3v1, APE)
 * are found by reading backwards from EOF. The old implementation guessed a
 * head window (256 KB → 512 KB → 2 MB → 4 MB) and re-parsed on every miss —
 * re-reading overlapping bytes and re-parsing the tag block each time. This
 * tokenizer lets the parser ask for exactly the bytes it needs, once:
 *
 * - pages of 64 KB are fetched on demand through
 *   `fs.createReadStream(uri, { start, end })` and cached, so a seek back
 *   into an already-read region costs nothing;
 * - sequential access (a duration scan draining the file) gets 1 MB
 *   read-ahead runs, so a full-file pass costs one range read per megabyte
 *   rather than one per page;
 * - the cache is capped (FIFO, 6 MB): a pathological file can re-read, but
 *   never balloons memory.
 *
 * Two bounds keep a confused parser from turning the scan into a file copy.
 * The old head window was not only a guess but a backstop: a parser that
 * cannot find what it is looking for (the MPEG sync loop draining zero
 * padding to EOF, measured, not assumed) drains whatever it is given. So
 * each parse gets a cumulative storage-I/O budget — bytes actually fetched,
 * not cache hits. Reads past the budget report end-of-stream, which parsers
 * already handle gracefully; `CodecNode` retries a failed parse once with
 * the escalated budget, mirroring the old window escalation.
 *
 * It deliberately stays on `ctx.fs` rather than reaching for `node:fs` — the
 * same implementation runs in the desktop webview, where `ctx.fs` crosses
 * the bridge, and in the sidecar host.
 */

import { AbstractTokenizer, EndOfStreamError } from 'strtok3'
import type { IRandomAccessFileInfo, IReadChunkOptions } from 'strtok3'
import type { FsService, Uri } from '@BBeBee/protocol'

/** One cached page; small enough that a tail seek stays cheap. */
const PAGE_BYTES = 64 * 1024
/** Sequential runs are fetched this many pages at a time (1 MB). */
const READ_AHEAD_PAGES = 16
/** Upper bound on cached pages; older pages are evicted FIFO. */
const MAX_CACHED_PAGES = 96

export class FsRangeTokenizer extends AbstractTokenizer {
  readonly fileInfo: IRandomAccessFileInfo

  private readonly pages = new Map<number, Uint8Array>()
  /** Last page index handed out by `ensurePage`, for read-ahead detection. */
  private lastPage = -1
  /** Storage bytes fetched so far; the parse budget is enforced against this. */
  private bytesServed = 0
  private readonly signal?: AbortSignal

  constructor(
    private readonly fs: FsService,
    private readonly uri: Uri,
    size: number,
    signal?: AbortSignal,
    mimeType?: string,
    private readonly budget: number = Number.POSITIVE_INFINITY,
  ) {
    super(signal ? { abortSignal: signal } : undefined)
    this.signal = signal
    this.fileInfo = mimeType ? { size, mimeType } : { size }
  }

  supportsRandomAccess(): boolean {
    return true
  }

  /**
   * Whether the parse consumed the whole I/O budget. An empty parse with an
   * exhausted budget may be the budget's fault (the tag block was cut
   * short), not the file's — the caller escalates instead of giving up.
   */
  get budgetExhausted(): boolean {
    return this.bytesServed >= this.budget
  }

  setPosition(position: number): void {
    this.position = Math.max(0, position)
  }

  override async abort(): Promise<void> {
    this.pages.clear()
    await super.abort()
  }

  override async close(): Promise<void> {
    this.pages.clear()
    await super.close()
  }

  async readBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    return this.readInto(buffer, options, false)
  }

  async peekBuffer(buffer: Uint8Array, options?: IReadChunkOptions): Promise<number> {
    return this.readInto(buffer, options, true)
  }

  private async readInto(
    target: Uint8Array,
    options: IReadChunkOptions | undefined,
    peek: boolean,
  ): Promise<number> {
    // `offset` is honoured at runtime by `normalizeOptions` but not part of
    // the public `IReadChunkOptions` type in strtok3 v10.
    const { length, position, mayBeLess, offset } = this.normalizeOptions(target, options) as {
      length: number
      position: number
      mayBeLess?: boolean
      offset?: number
    }
    this.signal?.throwIfAborted()
    if (length === 0) return 0
    const size = this.fileInfo.size
    if (position >= size) {
      if (mayBeLess) return 0
      throw new EndOfStreamError()
    }
    const want = Math.min(length, size - position)
    let read = 0
    while (read < want) {
      this.signal?.throwIfAborted()
      const at = position + read
      const page = await this.ensurePage(Math.floor(at / PAGE_BYTES))
      const pageOffset = at % PAGE_BYTES
      const chunk = Math.min(page.length - pageOffset, want - read)
      if (chunk <= 0) break // page shorter than expected: EOF (possibly budget-cut)
      target.set(page.subarray(pageOffset, pageOffset + chunk), (offset ?? 0) + read)
      read += chunk
    }
    if (read < length && !mayBeLess) throw new EndOfStreamError()
    if (!peek) this.position = position + read
    return read
  }

  private async ensurePage(index: number): Promise<Uint8Array> {
    const hit = this.pages.get(index)
    if (hit) {
      // Refresh recency: a page the parser keeps revisiting must not be the
      // eviction victim of a later sequential run.
      this.pages.delete(index)
      this.pages.set(index, hit)
      return hit
    }
    this.signal?.throwIfAborted()
    const size = this.fileInfo.size
    const start = index * PAGE_BYTES
    if (start >= size) return new Uint8Array(0)
    // A parser draining the file forward (duration estimation) gets a run;
    // a seek lands a single page, so a tail `moov` does not drag a megabyte.
    // Already-cached pages are skipped: the tail pages fetched by the
    // appending-header scan must not be re-read by a later head run.
    const sequential = index === this.lastPage + 1
    const maxRun = index + (sequential ? READ_AHEAD_PAGES : 1)
    let runEnd = index
    while (runEnd + 1 < maxRun && !this.pages.has(runEnd + 1) && (runEnd + 1) * PAGE_BYTES < size) {
      runEnd++
    }
    let end = Math.min(size, (runEnd + 1) * PAGE_BYTES)
    // The budget backstop: shrink the run to what remains. A fully spent
    // budget reports end-of-stream rather than reading on.
    const remaining = this.budget - this.bytesServed
    if (remaining <= 0) throw new EndOfStreamError()
    end = Math.max(start + 1, Math.min(end, start + remaining))
    const bytes = await this.readRange(start, end)
    this.bytesServed += bytes.length
    let at = 0
    for (let i = index; start + at < end; i++) {
      const pageBytes = bytes.subarray(at, at + PAGE_BYTES)
      at += pageBytes.length
      this.lastPage = i
      this.pages.set(i, pageBytes)
      while (this.pages.size > MAX_CACHED_PAGES) {
        const oldest = this.pages.keys().next()
        if (oldest.done) break
        this.pages.delete(oldest.value)
      }
      if (pageBytes.length < PAGE_BYTES) break
    }
    return this.pages.get(index) ?? new Uint8Array(0)
  }

  /**
   * One bounded range read through `ctx.fs`, with true cancellation: aborting
   * closes the stream so a hung read does not linger after the caller gave
   * up.
   */
  private async readRange(start: number, end: number): Promise<Uint8Array> {
    this.signal?.throwIfAborted()
    const reader = this.fs.createReadStream(this.uri, { start, end: end - 1 }).getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    const want = end - start
    const onAbort = () => reader.cancel().catch(() => undefined)
    this.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        this.signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done || !value) break
        const normalized = value instanceof Uint8Array ? value : new Uint8Array(value)
        chunks.push(normalized)
        total += normalized.byteLength
        if (total >= want) break
      }
    } finally {
      this.signal?.removeEventListener('abort', onAbort)
      await reader.cancel().catch(() => undefined)
    }

    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.byteLength
    }
    // A chunk may overshoot the range end; never serve (or bill the budget
    // for) bytes past what was asked.
    return total > want ? out.subarray(0, want) : out
  }
}
