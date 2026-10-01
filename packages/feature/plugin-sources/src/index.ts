/**
 * `ctx.sources` — the source registry, the source documents, and the
 * catalogue cache.
 *
 * Three responsibilities, one service, because they are three views of one
 * question — **which music backends exist, and what do they hold?**
 *
 *   the documents  imported strings, stored as rows, exported and diffed
 *   the registry   which of them are live, and lookup by id or URN
 *   the catalogue  what they answered, cached and searchable offline
 *
 * The registry half is deliberately dumb: it stores, resolves, and asks. Every
 * decision about what a source *can* do lives in its derived `capabilities`,
 * and every decision about what to show lives in a shell.
 *
 * Note what is *not* here: interpreting a document. That is
 * `plugin-source-runtime`'s only job, and it reaches this service the same way
 * `plugin-source-local` does — by registering a `MediaProvider`.
 *
 * See docs/06-music-sources.md §1, §4.1, §9 and docs/11-roadmap-M1.md §4.6.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
// Pulls the service and event augmentations (`ctx.sources`, `source/*`) into
// this program. Without it a consumer compiling in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import {
  assertSafeForTrace,
  formatUrn,
  ProviderError,
  SourceError,
  SourceFormatError,
  tryParseUrn,
} from '@BBeBee/protocol'
import type {
  AggregatedSearch,
  AggregatedSearchEntry,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  CatalogCounts,
  CatalogQuery,
  DbService,
  CheckReport,
  DebugStep,
  Disposable,
  ImportOptions,
  ImportReport,
  MediaProvider,
  Paged,
  SearchQuery,
  BrowseEntry,
  BrowseResult,
  PageRequest,
  PlaylistDetail,
  SearchResult,
  TrackLink,
  SourceRecord,
  SourcesService,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { artistKey } from '@BBeBee/toolkit'
import { canSearchProvider } from './capabilities.js'
import { Catalog } from './catalog.js'
import { CacheWriter } from './cache.js'
import { linkManually, linksFor, unlink } from './links.js'
import {
  changedFields,
  docHashOf,
  exportTextFor,
  isShareable,
  parseSourceInput,
  recordFor,
  validateDocument,
} from './identity.js'
import { SourceStore } from './store.js'
import { SOURCES_ROUTES, SOURCES_VIEWS } from './views.js'

export interface SourcesConfig {
  /**
   * How long `searchAll` waits for a source before reporting it as pending.
   *
   * A slow backend must not hold the whole result set: the search returns what
   * it has and says which sources are still running (docs/06 §4.1).
   */
  searchTimeoutMs?: number
}

const DEFAULT_SEARCH_TIMEOUT_MS = 10_000

/** Per-step deadline for a health check. */
const DEFAULT_CHECK_TIMEOUT_MS = 15_000

/**
 * Reject if a promise has not settled in time.
 *
 * The underlying work is not cancelled — there is no channel for that — but
 * the check stops waiting on it, which is what the caller needs.
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${step} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A provider that can explain itself.
 *
 * Implemented by the source runtime, which is the only thing with rules to
 * trace. Structural rather than declared, so `plugin-source-local` — which has
 * no rules — simply is not one, and `debug` says so instead of inventing a
 * trace for a provider that does not have steps.
 */
interface DebuggableProvider extends MediaProvider {
  debug(step: DebugStep): AsyncIterable<TraceEvent>
}

function isDebuggable(p: MediaProvider): p is DebuggableProvider {
  return typeof (p as Partial<DebuggableProvider>).debug === 'function'
}

/**
 * A browse leaf as a `Track`.
 *
 * A `BrowseEntry` is deliberately thinner than a `Track` — it exists to be
 * drawn in a list — so this fills in only what the entry actually knows.
 * `subtitle` becomes the artist because that is what a list rule puts there
 * (docs/06 §2.2), and an entry with no artist gets no credit rather than a
 * credit called "Unknown", which would be a real artist row in the catalogue
 * that nothing could ever clean up.
 */
function browsedTrack(
  entry: BrowseEntry,
  sourceId: string,
  payload: Record<string, unknown> | undefined,
): Track {
  const track: Track = { urn: entry.urn!, title: entry.title, artists: [] }

  /*
   * Fields read off the payload, not off the entry.
   *
   * A `BrowseEntry` is drawn in a list, so it carries what a list row shows
   * and nothing else — no duration, no album. The payload holds the *evaluated
   * list rule*, whose field names are protocol (docs/06 §2.2 `ListRule`)
   * rather than backend-specific, so reading them here is not this package
   * knowing about a particular server. Without it a browsed track cached with
   * no duration, and a scrubber that cannot move is indistinguishable from a
   * broken one.
   */
  const durationMs = Number(payload?.durationMs)
  if (Number.isFinite(durationMs) && durationMs > 0) track.durationMs = durationMs
  if (typeof payload?.album === 'string') track.albumTitle = payload.album
  if (typeof payload?.albumId === 'string') {
    track.albumUrn = formatUrn({ sourceId, kind: 'album', id: payload.albumId })
  }

  if (entry.subtitle) {
    track.artists = [
      {
        urn: formatUrn({ sourceId, kind: 'artist', id: artistKey(entry.subtitle) }),
        name: entry.subtitle,
        role: 'main',
        ordinal: 0,
      },
    ]
  }
  if (entry.artwork) track.artwork = entry.artwork
  return track
}

/** One entry's payload, as an object or nothing. */
function payloadFor(
  result: BrowseResult,
  urn: string,
): Record<string, unknown> | undefined {
  const value = result.payloads?.[urn]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** A browse album as an `Album`. Thin, like the entry it came from. */
function browsedAlbum(entry: BrowseEntry, sourceId: string): Album {
  const album: Album = { urn: entry.urn!, title: entry.title, artists: [] }
  if (entry.subtitle) {
    album.artists = [
      {
        urn: formatUrn({ sourceId, kind: 'artist', id: artistKey(entry.subtitle) }),
        name: entry.subtitle,
        role: 'main',
        ordinal: 0,
      },
    ]
  }
  if (entry.artwork) album.artwork = entry.artwork
  return album
}

/**
 * A check failure, safe to store and to hand to a listener.
 *
 * ⚠️ `statusError` builds its message from the **rendered** URL, and for a
 * Subsonic document that URL carries `u=<username>` and `t=<md5(password +
 * salt)>`. Stored verbatim in `sources.last_error`, that is a credential at
 * rest in a plain SQLite table — greppable in the database and in the WAL —
 * and it went out on `source/checked` to every listener as well.
 *
 * The host and path are what a person needs to recognise which request
 * failed; the query string is where the secrets live and is dropped whole
 * rather than filtered, because a filter has to know every parameter name a
 * backend might choose.
 */
function safeCheckMessage(message: string): string {
  return message.replace(/\bhttps?:\/\/\S+/gi, (url) => {
    try {
      const parsed = new URL(url)
      // Trailing punctuation is part of the sentence, not of the URL.
      return `${parsed.origin}${parsed.pathname}`
    } catch {
      return '<url>'
    }
  })
}

/**
 * Map anything a provider throws onto the taxonomy.
 *
 * The runtime does this itself for rules (docs/06 §7), but the registry is the
 * boundary where a misbehaving provider would otherwise take down a whole
 * fan-out, so it fails soft and attributes the error to its source.
 */
function asSourceError(error: unknown, sourceId: string): SourceError {
  if (error instanceof SourceError) return error
  return new ProviderError(
    error instanceof Error ? error.message : String(error),
    sourceId,
    undefined,
    { cause: error },
  )
}

export class Sources extends Service implements SourcesService {
  // The catalogue cache and the `sources` table are both SQL (docs/11 MD-3).
  static inject = ['db']

  /** Insertion-ordered, which is the order `searchAll` reports in. */
  private readonly registry = new Map<string, MediaProvider>()
  /**
   * This service's *own* database handle, captured at init.
   *
   * ⚠️ Not `this.ctx.db` at call time. Inside a method reached through the
   * service proxy `this.ctx` is the *caller's* context — that is how the
   * capability gate sees the caller's grants — so a query written that way
   * runs under the caller's budget. `plugin-source-runtime` holds
   * `db:read:core` and calls `writeVar`, and the write was refused with the
   * *runtime's* name on it even though the table belongs to this service.
   *
   * ⚠️ And a capture alone is not enough: a captured handle is itself a
   * tracked value, so reading it through the caller's context re-shadows it
   * with the caller again (`import()` once lost exactly this way — requested
   * by the UI package, refused under the UI plugin's grants; `cache()` lost
   * the same way, which left search results in memory and the catalogue
   * empty). New uses go through a plain holder — `Catalog`, `SourceStore`,
   * `CacheWriter` — which Cordis does not re-shadow; the direct uses below
   * (`readVars`, `writeVar`, `linksFor`) survive only because their callers
   * hold the grants themselves.
   */
  private ownDb!: DbService
  private catalog!: Catalog
  private store!: SourceStore
  /** The write half of the catalogue, holder-wrapped for the same reason. */
  private cacheWriter!: CacheWriter
  /** Mirrors the `sources` table, so reads are synchronous for the UI. */
  private records: SourceRecord[] = []

  constructor(
    ctx: Context,
    private readonly config: SourcesConfig = {},
  ) {
    super(ctx, 'sources')
  }

  async [Service.init]() {
    this.ownDb = this.ctx.db
    this.catalog = new Catalog(this.ownDb)
    this.store = new SourceStore(this.ownDb)
    this.cacheWriter = new CacheWriter(this.ownDb)
    this.records = await this.store.all()

    // Descriptors, not components: the headless plugin says what exists and
    // where it belongs; whichever view package was loaded for this target
    // binds a component to the same id (docs/08 §2).
    this.ctx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        yield scoped.ui.contribute({
          kind: 'route',
          id: SOURCES_ROUTES.search,
          path: '/search',
          title: 'Search',
          icon: 'search',
          // A place people go on purpose, so it earns chrome: a sidebar entry
          // on desktop, a tab on mobile, next to the library.
          placement: ['tab-bar', 'sidebar'],
          order: 1,
        })
        yield scoped.ui.contribute({
          kind: 'settings',
          id: SOURCES_VIEWS.sourceList,
          section: 'sources',
          title: 'Music sources',
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: SOURCES_ROUTES.sourceImport,
          path: '/sources/import',
          title: 'Import a source',
          // Reached from the source list, not from the chrome: importing is
          // something you do once and then rarely, and a permanent tab for it
          // would sit unused next to the ones people press every day.
          placement: [],
          order: 0,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: SOURCES_ROUTES.sourceTest,
          path: '/sources/test',
          title: 'Test a source',
          placement: [],
          order: 0,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: SOURCES_ROUTES.recommend,
          path: '/recommend',
          title: 'Recommend',
          icon: 'disc',
          // A place people go on purpose: the source shelf is a browsing
          // surface, so it earns chrome like the library does.
          placement: ['sidebar'],
          order: 2,
        })
        yield scoped.ui.contribute({
          kind: 'route',
          id: SOURCES_ROUTES.recommendAll,
          path: '/recommend/all',
          title: 'All recommendations',
          // Reached from a shelf's "show all", never from the chrome.
          placement: [],
          order: 0,
        })
      }, 'sources-ui-contributions'),
    )

    // Any source's rows get indexed without the writer knowing an index
    // exists — the scanner emits this, and so does the runtime's cache path.
    return this.ctx.on('library/changed', (kind, urns) => {
      if (kind !== 'track') return
      void this.catalog.index(urns).catch((error: unknown) => {
        this.ctx.logger.warn(`sources: could not index ${urns.length} track(s): ${String(error)}`)
      })
    })
  }

  /* ── the registry ──────────────────────────────────────────────────── */

  /**
   * Register a live source.
   *
   * Returns a disposer, so a source whose fiber unloads — or a user who signs
   * out — takes its registration with it and everything downstream simply
   * stops seeing it. No invalidation protocol, no stale rows.
   */
  register(provider: MediaProvider): Disposable {
    const { sourceId } = provider
    if (!sourceId) throw new Error('sources: a provider must have a sourceId')

    if (this.registry.has(sourceId)) {
      // Two providers claiming one source id would make URNs ambiguous — the
      // one thing the URN scheme exists to prevent (docs/07 §1). The `sources`
      // table's UNIQUE(source_url) is the other half of the same guarantee,
      // one layer down.
      this.ctx.logger.warn(
        `sources: source "${sourceId}" is already registered; ignoring the duplicate`,
      )
      return () => {}
    }

    this.registry.set(sourceId, provider)
    this.ctx.logger.info(`sources: registered source "${sourceId}" (${provider.displayName})`)
    // Wrapped: the map is already updated, so a listener that throws must not
    // unwind past `register` and leave the caller believing it failed — the
    // disposer it never received is what unregisters the provider.
    this.safeEmit(() => this.ctx.emit('source/registered', sourceId))

    return () => {
      // Identity-checked so a late disposer cannot unregister its replacement.
      if (this.registry.get(sourceId) !== provider) return
      this.registry.delete(sourceId)
      this.ctx.logger.info(`sources: unregistered source "${sourceId}"`)
      this.safeEmit(() => this.ctx.emit('source/unregistered', sourceId))
    }
  }

  get providers(): readonly MediaProvider[] {
    return [...this.registry.values()]
  }

  get(sourceId: string): MediaProvider | undefined {
    return this.registry.get(sourceId)
  }

  /**
   * Resolve a URN to the source that owns it.
   *
   * Two Navidrome servers are two sources, and a row from one must never
   * resolve to the other.
   */
  forUrn(urn: string): MediaProvider | undefined {
    const parsed = tryParseUrn(urn)
    return parsed && this.registry.get(parsed.sourceId)
  }

  /**
   * Fan out across every source that supports search.
   *
   * Returns per-source results *and* per-source errors. It never rejects and
   * never merges into one list, because a merged list silently drops a failing
   * backend and the UI then cannot say "Navidrome: 12 results · Jellyfin:
   * unreachable" — which is the honest thing to show (docs/06 §4.1).
   */
  async searchAll(
    query: SearchQuery,
    opts: { sourceIds?: string[]; timeoutMs?: number; typesBySource?: Record<string, SearchQuery['types']> } = {},
  ): Promise<AggregatedSearch> {
    this.ctx.logger.info(`sources: searching all sources for "${query.text}"`)
    const timeoutMs = opts.timeoutMs ?? this.config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    const wanted = opts.sourceIds && new Set(opts.sourceIds)

    const asked = this.providers.filter((p) => (!wanted || wanted.has(p.sourceId)) && canSearchProvider(p))

    const bySource = await Promise.all(
      asked.map((provider) =>
        this.searchOne(provider, query, timeoutMs, opts.typesBySource?.[provider.sourceId]),
      ),
    )
    return { bySource }
  }

  private async searchOne(
    provider: MediaProvider,
    query: SearchQuery,
    timeoutMs: number,
    types?: SearchQuery['types'],
  ): Promise<AggregatedSearchEntry> {
    const { sourceId } = provider
    const startedAt = Date.now()

    // `Promise.resolve(provider.search(q))` evaluates the call *first*, so a
    // synchronous throw escapes the handler and rejects the whole fan-out —
    // the one thing searchAll promises never to do.
    const inFlight = Promise.resolve()
      .then(() => provider.search!(types ? { ...query, types } : query))
      .then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error: asSourceError(error, sourceId) }),
    )

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<{ ok: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: 'timeout' }), timeoutMs)
    })

    try {
      const outcome = await Promise.race([inFlight, timedOut])
      const tookMs = Date.now() - startedAt

      // A source that ran long is reported as still running, not cancelled:
      // cancelling would throw away a result the user may still want, and
      // there is no cancellation channel to do it politely.
      if (outcome.ok === 'timeout') return { sourceId, pending: true, tookMs }
      if (outcome.ok) {
        await this.cache(sourceId, outcome.result)
        return { sourceId, result: outcome.result, pending: false, tookMs }
      }
      return { sourceId, error: outcome.error, pending: false, tookMs }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Walk one source's hierarchy.
   *
   * Not a fan-out: browsing is a *place*, and the user is inside one folder on
   * one server. The service owns the call rather than the shell talking to the
   * provider directly, because this is where the leaves and their payloads get
   * cached — a shell that went round it would show tracks that stop being
   * playable the next time the app starts.
   */
  async browse(sourceId: string, nodeId?: string, page?: PageRequest): Promise<BrowseResult> {
    this.ctx.logger.info(`sources: browsing source ${sourceId} (nodeId=${nodeId ?? 'root'})`)
    const provider = this.registry.get(sourceId)
    if (!provider) {
      throw new ProviderError(`no source ${sourceId} is registered`, sourceId)
    }
    if (typeof provider.browse !== 'function' || !provider.capabilities.browse) {
      // Not a thrown "not implemented": the capability is derived and visible,
      // so a caller reaching this ignored it. Saying which source and that it
      // cannot browse is more use than a stack trace.
      throw new ProviderError(`source ${sourceId} cannot browse`, sourceId)
    }

    const result = await provider.browse(nodeId, page)
    await this.cacheBrowsed(sourceId, result)
    return result
  }

  /**
   * One page of a source's curated recommendations, cached like browse.
   *
   * The cards are browse entries — kind `album` with a `childUrl` payload —
   * so a recommendation opened as an album detail goes through the exact
   * cache path a browsed one does, and works after a restart for the same
   * reason.
   */
  async recommend(sourceId: string, page?: PageRequest): Promise<BrowseResult> {
    this.ctx.logger.info(`sources: recommending source ${sourceId} (page=${page?.cursor ?? 1})`)
    const provider = this.registry.get(sourceId)
    if (!provider) {
      throw new ProviderError(`no source ${sourceId} is registered`, sourceId)
    }
    if (typeof provider.recommend !== 'function' || !provider.capabilities.recommend) {
      throw new ProviderError(`source ${sourceId} cannot recommend`, sourceId)
    }

    const result = await provider.recommend(page)
    await this.cacheBrowsed(sourceId, result)
    return result
  }

  /**
   * Cache the playable leaves of a browse page.
   *
   * Entries without a URN are folders — places, not things — and there is
   * nothing to store for them. The tracks go through the same writer a search
   * result does, so a browsed track and a searched one are the same row.
   */
  private async cacheBrowsed(sourceId: string, result: BrowseResult): Promise<void> {
    const tracks: Track[] = []
    const albums: Album[] = []
    for (const entry of result.items) {
      if (!entry.urn) continue
      // Albums are cached too, and for a reason beyond offline browsing: their
      // payload carries the `childUrl` that `getAlbum` fetches. Nothing else
      // in the app knows it, and it cannot be derived from an id.
      if (entry.kind === 'album') albums.push(browsedAlbum(entry, sourceId))
      else if (entry.kind === 'track') {
        tracks.push(browsedTrack(entry, sourceId, payloadFor(result, entry.urn)))
      }
    }
    if (tracks.length === 0 && albums.length === 0) return

    await this.cache(sourceId, {
      ...(tracks.length > 0 ? { tracks: { items: tracks, hasMore: false } } : {}),
      ...(albums.length > 0 ? { albums: { items: albums, hasMore: false } } : {}),
      ...(result.payloads ? { payloads: result.payloads } : {}),
    })
  }

  /* ── sources as data ───────────────────────────────────────────────── */

  get sources(): readonly SourceRecord[] {
    return this.records
  }

  source(id: string): SourceRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  /**
   * Import one document or a set of them.
   *
   * Three properties matter more than the mechanics:
   *
   *  - **Nothing is imported silently.** The report is what the review screen
   *    renders; the caller decides what to keep.
   *  - **A set is partially importable.** One malformed entry in a set of
   *    forty does not reject the other thirty-nine.
   *  - **Update preserves identity.** Matching on `sourceUrl` keeps the id, so
   *    every URN, cached row, jar and playlist reference survives the edit.
   */
  async import(input: string, opts: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = {
      added: [],
      updated: [],
      unchanged: [],
      rejected: [],
      conflicts: [],
    }

    // Parsing the whole input first means a malformed *string* is one error,
    // not a partial import. Individual malformed entries are handled below.
    const entries = parseSourceInput(input)
    const now = Date.now()
    const selected = opts.select && new Set(opts.select)

    // One transaction for the whole set. Without it, a failure on entry k
    // leaves entries 0..k-1 already committed while the call rejects and the
    // report — the only record of what happened — is lost. The protocol
    // promise is "one malformed entry never rejects the rest", and half-
    // applying the rest is not that.
    //
    // The transaction is issued by `SourceStore`, not here — see its note.
    // `import()` is called from the import screen, which runs on the UI
    // package's context (docs/08 §2); even `this.ownDb`, though captured at
    // init, is re-shadowed with the caller's context when read through the
    // service proxy, and the whole import would be refused with the
    // *caller's* name on the error. Only a plain holder — the store, like
    // `Catalog` — reaches the captured handle un-shadowed.
    await this.store.transaction(async (store) => {
      for (const [index, entry] of entries.entries()) {
        try {
          await this.importOne(store, entry, index, { now, selected, opts, report })
        } catch (error) {
          // A write that fails for this entry — a value SQLite will not bind,
          // a constraint — must not take the other thirty-nine with it.
          const cause = error instanceof Error ? error.message : String(error)
          const name = nameOf(entry.value)
          this.ctx.logger.warn(`sources: rejected entry ${index}${name ? ` "${name}"` : ''}: ${cause}`)
          report.rejected.push({
            index,
            ...(name ? { sourceName: name } : {}),
            error:
              error instanceof SourceFormatError
                ? error
                : new SourceFormatError(
                    cause,
                    [{ path: '', message: `could not be stored: ${cause}` }],
                    { cause: error },
                  ),
          })
        }
      }
    })

    await this.refresh()

    // Only one event per source. Emitting `imported` *and* `changed` for an
    // update made the runtime stop and start that source twice, with
    // duplicate registration events on the way through.
    // ⚠️ Wrapped, because `emit` is synchronous: a listener that throws would
    // otherwise propagate out of here and lose the report the caller is
    // waiting for — after the rows were already written. The import is done;
    // a broken listener is that listener's problem.
    const added = report.added.map((r) => r.id)
    if (added.length) this.safeEmit(() => this.ctx.emit('source/imported', added))
    for (const { record, changedFields: fields } of report.updated) {
      this.safeEmit(() => this.ctx.emit('source/changed', record.id, fields))
    }

    return report
  }

  /** One entry of an import. Throws only what the caller turns into `rejected`. */
  private async importOne(
    store: SourceStore,
    entry: { value: unknown; text: string },
    index: number,
    ctx: {
      now: number
      selected: Set<string> | undefined
      opts: ImportOptions
      report: ImportReport
    },
  ): Promise<void> {
    const { now, selected, opts, report } = ctx
    const doc = validateDocument(entry.value, index)
    if (selected && !selected.has(doc.sourceUrl)) return

    // The verbatim slice, not a re-serialisation: export must emit what was
    // imported, down to key order and spacing (docs/07 §4.1).
    const docJson = entry.text
    const existing = await store.byUrl(doc.sourceUrl)

    if (!existing) {
      const record = recordFor(doc, {
        docJson,
        now,
        ...(opts.group ? { group: opts.group } : {}),
        ...(opts.originUri ? { originUri: opts.originUri } : {}),
      })
      await store.put(record)
      this.ctx.logger.info(`sources: imported new source "${record.id}" (${record.sourceUrl})`)
      report.added.push(record)
      return
    }

    if (existing.docHash === docHashOf(docJson)) {
      // Deliberately does not touch `enabled`. A disabled row is either a
      // source the user switched off or one they removed while keeping its
      // library, and nothing distinguishes the two — so re-importing must not
      // guess. It stays off; the source list is where it goes back on.
      report.unchanged.push(existing)
      return
    }

    const changed = changedFields(existing.doc, doc)

    // A source the user fixed themselves must not be silently replaced by a
    // re-import of the version that was broken.
    if (existing.locallyModified && !opts.overwrite) {
      report.conflicts.push({ record: existing, changedFields: changed })
      return
    }

    const record = recordFor(doc, {
      docJson,
      now,
      importedAt: existing.importedAt,
      sortOrder: existing.sortOrder,
      // The user's own switch wins over the document's.
      enabled: existing.enabled,
      ...(opts.group ?? existing.group ? { group: opts.group ?? existing.group! } : {}),
      ...(opts.originUri ? { originUri: opts.originUri } : existing.originUri
        ? { originUri: existing.originUri }
        : {}),
    })
    await store.put(record)
    this.ctx.logger.info(`sources: updated source "${record.id}" (${record.sourceUrl})`)
    report.updated.push({ record, changedFields: changed })
  }

  /**
   * Serialise sources back to a shareable string.
   *
   * Symmetrical with `import`: app-maintained fields are stripped, and no
   * credential can be present because none was ever stored in the document.
   * Export → import round-trips to an identical set.
   *
   * Sources that are not documents anyone could import — the local-files
   * placeholder, a row carried across by the ADR-5 migration — are omitted,
   * because a file that `import()` would then reject is worse than a shorter
   * one.
   */
  async export(ids?: string[]): Promise<string> {
    const wanted = ids && new Set(ids)
    // Each entry keeps its own verbatim text, so an export → import round
    // trip is a no-op rather than a reported update with an empty change list.
    //
    // Entries are deliberately *not* re-indented to sit prettily inside the
    // array: indenting rewrites the very bytes the round trip has to preserve,
    // and — worse — it would indent again on every pass, so the text would
    // never stabilise. A slightly ragged multi-source file is the price of an
    // export a user can re-import without it counting as an edit.
    const entries = this.records
      .filter((r) => (!wanted || wanted.has(r.id)) && isShareable(r))
      .map((r) => exportTextFor(r))
    return Promise.resolve(entries.length ? `[\n${entries.join(',\n')}\n]\n` : '[]\n')
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    this.ctx.logger.info(`sources: set source "${id}" enabled=${on}`)
    await this.store.setEnabled(id, on, Date.now())
    await this.refresh()
    this.safeEmit(() => this.ctx.emit('source/changed', id, ['enabled']))
  }

  async setNeedsLyricSource(id: string, needed: boolean): Promise<void> {
    this.ctx.logger.info(`sources: set source "${id}" needsLyricSource=${needed}`)
    await this.store.setNeedsLyricSource(id, needed, Date.now())
    await this.refresh()
    this.safeEmit(() => this.ctx.emit('source/changed', id, ['needsLyricSource']))
  }

  async remove(id: string, opts: { forgetCatalogue?: boolean } = {}): Promise<void> {
    this.ctx.logger.info(`sources: removing source "${id}" (forgetCatalogue=${opts.forgetCatalogue ?? false})`)
    await this.store.remove(id, opts)
    await this.refresh()
    this.safeEmit(() => this.ctx.emit('source/removed', id, opts.forgetCatalogue === true))
  }

  /**
   * Health run over one or many sources.
   *
   * Reach the source, and — where it can — search and resolve a stream, which
   * is the shortest path that exercises every rule a user depends on. The
   * result updates the row, so the source list can sort by health and the
   * stale badge stays honest.
   */
  async check(
    ids?: string[],
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CheckReport[]> {
    this.ctx.logger.info(`sources: checking health for ${ids ? `${ids.length} specified source(s)` : 'all sources'}`)
    const wanted = ids && new Set(ids)
    const targets = this.providers.filter((p) => !wanted || wanted.has(p.sourceId))
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS
    const reports: CheckReport[] = []

    for (const provider of targets) {
      if (opts.signal?.aborted) break
      reports.push(await this.checkOne(provider, timeoutMs))
    }
    return reports
  }

  private async checkOne(provider: MediaProvider, timeoutMs: number): Promise<CheckReport> {
    const sourceId = provider.sourceId
    const startedAt = Date.now()
    let failedStep: CheckReport['failedStep'] = 'ping'

    try {
      // Every step gets a deadline. A source whose server accepts the
      // connection and then says nothing would otherwise hold the whole run —
      // and "check all my sources" is exactly when one bad source is most
      // likely, and least acceptable, to hang the app.
      const reachable = await withDeadline(provider.ping(), timeoutMs, 'ping')
      const respondTimeMs = Date.now() - startedAt
      if (!reachable) {
        return await this.recordCheck({
          sourceId,
          ok: false,
          respondTimeMs,
          failedStep: 'ping',
          message: 'unreachable',
          checkedAt: Date.now(),
        })
      }

      if (canSearchProvider(provider)) {
        failedStep = 'search'
        await withDeadline(provider.search!({ text: 'a' }), timeoutMs, 'search')
      }

      return await this.recordCheck({
        sourceId,
        ok: true,
        respondTimeMs,
        checkedAt: Date.now(),
      })
    } catch (error) {
      return await this.recordCheck({
        sourceId,
        ok: false,
        respondTimeMs: Date.now() - startedAt,
        failedStep,
        message: safeCheckMessage(asSourceError(error, sourceId).message),
        checkedAt: Date.now(),
      })
    }
  }

  private async recordCheck(report: CheckReport): Promise<CheckReport> {
    await this.store.recordCheck(report.sourceId, {
      ok: report.ok,
      ...(report.respondTimeMs !== undefined ? { respondTimeMs: report.respondTimeMs } : {}),
      ...(report.message ? { message: report.message } : {}),
      at: report.checkedAt,
    })
    await this.refresh()
    // Wrapped like the other post-commit emits: a throwing listener here used
    // to propagate out of `checkOne`, be caught by its own error handler, and
    // rewrite a source that had just passed as failed — then reject `check()`
    // as well.
    this.safeEmit(() => this.ctx.emit('source/checked', report.sourceId, report))
    return report
  }

  /**
   * Stream a trace of one step.
   *
   * Delegated to the source itself, because only the thing that owns the rules
   * can say what each one received and produced. A source with no rules — the
   * local files provider — says so rather than inventing a trace.
   */
  debug(id: string, step: DebugStep): AsyncIterable<TraceEvent> {
    const provider = this.registry.get(id)
    if (!provider) {
      return once({
        at: Date.now(),
        kind: 'error',
        message: assertSafeForTrace(`no source "${id}"`),
      })
    }
    if (!isDebuggable(provider)) {
      return once({
        at: Date.now(),
        kind: 'error',
        message: assertSafeForTrace(`source "${id}" has no rules to trace`),
      })
    }
    return provider.debug(step)
  }

  /**
   * Emit without letting a listener's failure reach the caller.
   *
   * Only for emits on a path that has already committed: the work is done and
   * the caller is owed its answer, so a subscriber throwing is a fault to log,
   * not one to propagate.
   */
  /**
   * Store what a provider answered.
   *
   * The step docs/06 §4's sequence diagram calls "cache rows, index FTS", and
   * the reason a searched track is still playable after a restart: the
   * per-track payload lands in `tracks.raw_json`, which is where `ruleStream`
   * reads `{{track.*}}` from.
   *
   * ⚠️ A cache failure never fails the search. The user asked for results and
   * has them; losing the write costs offline availability, and turning that
   * into a failed search would be a strictly worse trade. It is logged at warn
   * rather than swallowed, because a *persistent* failure here shows up much
   * later as "this source can search but never play".
   */
  private async cache(sourceId: string, result: SearchResult): Promise<void> {
    const tracks = result.tracks?.items
    const albums = result.albums?.items
    if (!tracks?.length && !albums?.length) return

    try {
      // Through the holder, never `this.ownDb`: this path is reached from the
      // search screen, and the captured handle would be re-shadowed with the
      // UI's (empty) grants — the write refused, the results in memory, the
      // catalogue empty.
      const written = await this.cacheWriter.write(sourceId, {
        ...(tracks ? { tracks } : {}),
        ...(albums ? { albums } : {}),
        ...(result.payloads ? { payloads: result.payloads } : {}),
      })
      // The index listens for this; so does anything showing a library count.
      // Emitted only for what was actually written, so a skipped row does not
      // send the indexer looking for a URN that is not there.
      if (written.trackUrns.length > 0) {
        /*
         * Linking runs over what was *just written*, not over the library. A
         * full re-match on every search would be quadratic in a table that
         * reaches six figures, and the answer for rows nobody touched cannot
         * have changed.
         */
        /*
         * ⚠️ Linking is reported separately, and never costs the emit.
         *
         * A link failure is a *relationship* problem; the rows are already
         * written. Letting it share the cache write's catch meant one bad pair
         * swallowed `library/changed` for the whole batch, so fifty perfectly
         * good tracks silently never reached the FTS index and could not be
         * found by search.
         */
        try {
          const links = await this.cacheWriter.link(written.trackUrns)
          if (links > 0) {
            this.ctx.logger.debug(`sources: linked ${links} track(s) across sources`)
          }
        } catch (error) {
          this.ctx.logger.warn(`sources: could not link ${sourceId}'s tracks: ${String(error)}`)
        }
        this.safeEmit(() => this.ctx.emit('library/changed', 'track', written.trackUrns))
      }
      if (written.albumUrns.length > 0) {
        this.safeEmit(() => this.ctx.emit('library/changed', 'album', written.albumUrns))
      }
    } catch (error) {
      this.ctx.logger.warn(
        `sources: could not cache results from ${sourceId}: ${String(error)}`,
      )
    }
  }

  private safeEmit(emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.ctx.logger.warn(`sources: an event listener threw: ${String(error)}`)
    }
  }

  /** Re-read the table after a write. Cheap: the source list is tens of rows. */
  private async refresh(): Promise<void> {
    this.records = await this.store.all()
  }

  /* ── cross-source identity (docs/06 §11) ───────────────────────────── */

  /**
   * Everything known to be the same recording as `urn`, best evidence first.
   *
   * Read rather than merged. A caller offering a fallback wants every link; a
   * caller drawing a library row wants only the certain ones, and the
   * confidence column is what lets each ask its own question.
   */
  linksFor(urn: string): Promise<TrackLink[]> {
    return linksFor(this.ownDb, urn)
  }

  /* ── a source's own variables (docs/06 §3.4) ────────────────────────── */

  async readVars(sourceId: string): Promise<Record<string, string>> {
    const rows = await this.ownDb.query<{ key: string; value: string }>(
      'SELECT key, value FROM source_vars WHERE source_id = ?',
      [sourceId],
    )
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  async writeVar(sourceId: string, key: string, value: string): Promise<void> {
    await this.ownDb.exec(
      `INSERT INTO source_vars (source_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [sourceId, key, value, Date.now()],
    )
  }

  async clearVars(sourceId: string, key?: string): Promise<void> {
    if (key === undefined) {
      await this.ownDb.exec('DELETE FROM source_vars WHERE source_id = ?', [sourceId])
      return
    }
    await this.ownDb.exec('DELETE FROM source_vars WHERE source_id = ? AND key = ?', [
      sourceId,
      key,
    ])
  }

  /** The user says two URNs are the same recording. Never overwritten. */
  link(a: string, b: string): Promise<void> {
    return linkManually(this.ownDb, a, b)
  }

  unlink(a: string, b: string): Promise<void> {
    return unlink(this.ownDb, a, b)
  }

  /* ── the catalogue cache ───────────────────────────────────────────── */

  listTracks(query?: CatalogQuery): Promise<Paged<Track>> {
    return this.catalog.listTracks(query)
  }

  listAlbums(query?: CatalogQuery): Promise<Paged<Album>> {
    return this.catalog.listAlbums(query)
  }

  listArtists(query?: CatalogQuery): Promise<Paged<Artist>> {
    return this.catalog.listArtists(query)
  }

  /**
   * One album, from the catalogue or — on a miss — from its source.
   *
   * The catalogue is what everything reads, but it only knows the albums
   * something cached: a browse/recommend page stores the album row and its
   * payload, and *its tracks* land there only when a descent cached them. An
   * album whose tracks were never walked is a real album the screen would
   * render empty, so a source that can look albums up live is asked, and the
   * answer goes through the same writer a search does. The next read is
   * instant and offline, which is the whole point of the cache.
   */
  async getAlbum(urn: string, page?: PageRequest): Promise<AlbumDetail | undefined> {
    const cached = await this.catalog.getAlbum(urn)

    const parsed = tryParseUrn(urn)
    if (!parsed || parsed.kind !== 'album') return cached

    if (parsed.sourceId === 'local') {
      if (cached && cached.tracks.length > 0) return cached
      return cached
    }

    const provider = this.registry.get(parsed.sourceId)
    if (!provider || typeof provider.getAlbum !== 'function') return cached

    try {
      const pageReq = page ?? { limit: 30 }
      const detail = await provider.getAlbum(parsed.id, pageReq)
      if (detail && detail.tracks.length > 0) {
        await this.cache(
          parsed.sourceId,
          {
            albums: {
              items: [
                {
                  urn: detail.urn,
                  title: detail.title,
                  artists: detail.artists,
                  ...(detail.artwork ? { artwork: detail.artwork } : {}),
                  ...(detail.year !== undefined ? { year: detail.year } : {}),
                  ...(detail.trackCount !== undefined ? { trackCount: detail.trackCount } : {}),
                },
              ],
              hasMore: false,
            },
            tracks: { items: detail.tracks, hasMore: detail.hasMore ?? false },
            payloads: detail.payloads,
          },
        )
      }
      return detail
    } catch (error) {
      // A source that cannot answer live is not a broken album — the payload
      // may be missing because nothing browsed to it yet (docs/06 §4). The
      // catalogue's answer, even an empty one, is still the honest one.
      this.ctx.logger.warn?.(`sources: live album fetch for ${urn} failed: ${String(error)}`)
      return cached
    }
  }

  async getPlaylist(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined> {
    const parsed = tryParseUrn(urn)
    if (!parsed || parsed.kind !== 'playlist') return undefined

    const provider = this.registry.get(parsed.sourceId)
    if (!provider || typeof provider.getPlaylist !== 'function') return undefined

    try {
      const pageReq = page ?? { limit: 30 }
      const detail = await provider.getPlaylist(parsed.id, pageReq)
      if (detail && detail.tracks && detail.tracks.length > 0) {
        await this.cache(
          parsed.sourceId,
          {
            tracks: { items: detail.tracks, hasMore: detail.hasMore ?? false },
            payloads: detail.payloads,
          },
        )
      }
      return detail
    } catch (error) {
      this.ctx.logger.warn?.(`sources: live playlist fetch for ${urn} failed: ${String(error)}`)
      return undefined
    }
  }

  getArtist(urn: string): Promise<ArtistDetail | undefined> {
    return this.catalog.getArtist(urn)
  }

  getTracks(urns: readonly string[]): Promise<Track[]> {
    return this.catalog.getTracks(urns)
  }

  searchLocal(text: string, opts?: { limit?: number; sourceIds?: string[] }): Promise<SearchResult> {
    return this.catalog.searchLocal(text, opts)
  }

  counts(): Promise<CatalogCounts> {
    return this.catalog.counts()
  }

  async setLoved(urn: string, loved: boolean): Promise<void> {
    await this.catalog.setLoved(urn, loved)
    this.ctx.emit('library/changed', 'track', [urn])
  }

  /** Re-index tracks directly. `library/changed` is the usual route. */
  reindex(urns: string[]): Promise<void> {
    return this.catalog.index(urns)
  }
}

function nameOf(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object') return undefined
  const name = (entry as Record<string, unknown>).sourceName
  return typeof name === 'string' ? name : undefined
}

async function* once(event: TraceEvent): AsyncIterable<TraceEvent> {
  yield event
}

export { Catalog } from './catalog.js'
export { CacheWriter, cacheEntities, MAX_PAYLOAD_BYTES } from './cache.js'
export {
  MERGE_CONFIDENCE,
  linkManually,
  linkTracks,
  linksFor,
  unlink,
  writeExternalIds,
} from './links.js'
export type { CacheInput, CacheResult } from './cache.js'
export { SourceStore } from './store.js'
export {
  allowedHostsFor,
  changedFields,
  exportableDocument,
  parseSourceInput,
  sourceIdFor,
  validateDocument,
} from './identity.js'

export const name = 'plugin-sources'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.sources` is usable.
 */
export async function apply(ctx: Context, config: SourcesConfig = {}) {
  ctx.logger.info('plugin-sources: loaded')
  const fiber = await ctx.plugin(Sources, config)
  return () => void fiber.dispose()
}

export default { name, apply }
