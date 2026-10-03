/**
 * `ctx.sources` — the source registry and the catalogue cache.
 *
 * `MediaProvider` is what the rest of the app consumes, and it is now an
 * **internal interface with exactly two implementations**: the source
 * runtime's per-source adapter, and `plugin-source-local`. It is no longer an
 * extension point — nobody outside this repository implements it. A new music
 * backend is a `SourceDocument` (see `source-document.ts`), imported as a
 * string and interpreted by one built-in runtime.
 *
 * Keeping the interface is what stops the catalogue, the player and every
 * screen from growing an "is this a real source or a local file?" branch.
 *
 * See docs/06-music-sources.md.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable, Paged, Uri } from '../common.js'
import type { SourceError } from '../errors.js'
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  ArtworkRef,
  Playlist,
  PlaylistDetail,
  Track,
  WithPayloads,
} from '../entities/catalog.js'
import type { Lyrics } from '../entities/library.js'
import type { StreamHandle, StreamPrefs, StreamQuality } from '../entities/media.js'
import type {
  CheckReport,
  DebugStep,
  ImportOptions,
  ImportReport,
  LoginField,
  SourceRecord,
  TraceEvent,
} from './source-document.js'

/* ── Capabilities ───────────────────────────────────────────────────────── */

/**
 * What a source can actually do.
 *
 * **Derived, never declared.** For a document-backed source the runtime
 * computes this from which rule blocks are present, so the old
 * under-declare/over-declare failure mode cannot occur: a source with no
 * `ruleExplore` has no `browse`, because there is nothing to call.
 *
 * The shells still hide affordances rather than offering buttons that fail —
 * they now read a computed value rather than a promised one. See docs/06 §1.3.
 */
export interface Capabilities {
  search: {
    tracks: boolean
    albums: boolean
    artists: boolean
    playlists: boolean
    fullText: boolean
  }
  browse: boolean
  /** The backend curates a recommendation feed (`ruleRecommend`). */
  recommend: boolean
  lyrics: boolean
  artwork: boolean
  library: {
    read: boolean
    save: boolean
    playlistWrite: boolean
    playlistReorder: boolean
  }
  streaming: {
    /** Tiers this provider can serve, best first. */
    qualities: StreamQuality[]
    transcoding: boolean
    /** Byte-range requests — required for seeking within a stream. */
    seekable: boolean
    /** Whether resolved URLs expire and must be re-resolved. */
    urlExpiry: boolean
  }
  /** From the document's `concurrentRate`. */
  rateLimit?: { requests: number; windowMs: number }
  /** Region-locked; some catalogue may be unavailable. */
  regional: boolean
}

/* ── Queries ────────────────────────────────────────────────────────────── */

export interface PageRequest {
  cursor?: string
  limit?: number
}

export interface SearchQuery {
  text: string
  types?: ('track' | 'album' | 'artist' | 'playlist')[]
  filters?: {
    genre?: string
    yearFrom?: number
    yearTo?: number
    durationMaxMs?: number
  }
}

export interface SearchResult extends WithPayloads {
  tracks?: Paged<Track>
  albums?: Paged<Album>
  artists?: Paged<Artist>
  playlists?: Paged<Playlist>
}

/**
 * A page of browse entries, plus the cache material that came with it.
 *
 * The payloads belong to the *leaves*: descending into an album produces
 * tracks, and those tracks have to still be playable after a restart, by
 * exactly the mechanism a searched track is (see `WithPayloads`). Without
 * this, a source found by browsing worked until the app was closed.
 */
export interface BrowseResult extends Paged<BrowseEntry>, WithPayloads {}

/** How two URNs came to be considered the same recording. See `linksFor`. */
export type LinkMethod = 'isrc' | 'mbid' | 'acoustid' | 'fuzzy' | 'manual'

export interface TrackLink {
  urn: string
  /** 1.00 is exact. Below that it is a hint, never a merge. */
  confidence: number
  method: LinkMethod
}

export interface BrowseEntry {
  /** Pass back as `nodeId` to descend. */
  id: string
  title: string
  subtitle?: string
  artwork?: ArtworkRef
  kind: 'folder' | 'album' | 'artist' | 'playlist' | 'track' | 'genre'
  /**
   * Whether this is something to play rather than somewhere to go.
   *
   * ⚠️ Separate from `urn`, which it used to be conflated with. An album in a
   * browse listing is *both* — it has an identity worth caching and it is
   * somewhere to descend into — and reading "no urn" as "descend" meant an
   * album could never be cached, so `getAlbum` had no document URL to fetch
   * and the whole `childUrl → ruleAlbum → ruleTrackList` half of the pipeline
   * had nowhere to start.
   */
  leaf: boolean
  /** This entry's own identity, where it has one. */
  urn?: string
}

/* ── Authentication ─────────────────────────────────────────────────────── */

/**
 * How a source signs in.
 *
 * Declared by the document and driven by the shell, so no source author writes
 * a login screen — the same principle as before, expressed as data. Each
 * variant maps to exactly one thing in a `SourceDocument`:
 *
 *   none      no auth fields at all
 *   variable  `variableComment` only — the `{{source.var}}` box
 *   form      `loginUi` (the fields) + `loginUrl` (where they go)
 *   webview   `loginUrl` + required cookies, opened via `ctx.shell`
 */
export type AuthFlow =
  | { kind: 'none' }
  | { kind: 'variable'; comment?: string }
  | { kind: 'form'; fields: LoginField[]; submitTo: string }
  | { kind: 'webview'; loginUrl: string; requiredCookies: string[] }
  | { kind: 'qrcode'; pollIntervalMs?: number }

export type AuthStatus =
  | { state: 'anonymous' }
  | { state: 'authenticated'; displayName?: string; expiresAt?: number }
  | { state: 'expired' }
  | { state: 'error'; message: string }

export interface QrCodeSession {
  /** The code or URL to display as a QR code */
  code: string
  /** Opaque session or ticket key */
  key: string
  /** Optional expiry epoch ms */
  expiresAt?: number
  /** Poll the status of the QR code */
  poll(): Promise<'pending' | 'scanned' | 'confirmed' | 'expired'>
}

/**
 * Sign-in and sign-out.
 *
 * Present on every provider — including ones needing no credentials, which
 * declare `flow: { kind: 'none' }` and implement both trivially. The runtime
 * synthesises this from the document, so the UI has one place to look and
 * sign-out means the same thing everywhere. See docs/06 §5.
 */
export interface ProviderAuth {
  readonly flow: AuthFlow
  readonly status: AuthStatus

  /** Resolves once `status` is 'authenticated'; throws `AuthError` otherwise. */
  signIn(input: Record<string, string>): Promise<void>

  /** Start a QR code login session when flow.kind === 'qrcode' */
  createQrSession?(): Promise<QrCodeSession>

  /**
   * Must leave nothing behind: clears the source's secrets namespace, its
   * `source_vars`, and empties *and forgets* its persisted cookie jar, then
   * resets status. The most commonly missed step in the whole design.
   */
  signOut(): Promise<void>

  refresh?(): Promise<void>
  onStatusChange(cb: (s: AuthStatus) => void): Disposable
}

/* ── The provider ───────────────────────────────────────────────────────── */

export interface ProviderLibrary {
  list(
    kind: 'track' | 'album' | 'artist' | 'playlist',
    page?: PageRequest,
  ): Promise<Paged<{ urn: string; addedAt?: number }>>
  setSaved(urn: string, saved: boolean): Promise<void>
  createPlaylist(name: string, opts?: { description?: string }): Promise<string>
  addToPlaylist(playlistId: string, trackIds: string[]): Promise<void>
  removeFromPlaylist(playlistId: string, itemIds: string[]): Promise<void>
  reorderPlaylist(playlistId: string, itemId: string, toIndex: number): Promise<void>
  deletePlaylist(playlistId: string): Promise<void>
}

/**
 * A music backend, as the rest of the app sees it.
 *
 * Deliberately split: a small **required core**, and a large **optional
 * surface** present only where the backend supports it. Omit an optional
 * member rather than stubbing one that throws — `capabilities` carries that
 * information truthfully, and for a document-backed source it is derived from
 * exactly which members the runtime could build.
 */
export interface MediaProvider {
  // ══ REQUIRED ═══════════════════════════════════════════════════════════
  readonly sourceId: string
  readonly displayName: string
  readonly capabilities: Capabilities
  readonly auth: ProviderAuth

  getTrack(id: string): Promise<Track>
  resolveStream(id: string, prefs: StreamPrefs): Promise<StreamHandle>
  /** Cheap reachability check. Must not count against a rate limit. */
  ping(): Promise<boolean>

  // ══ OPTIONAL ═══════════════════════════════════════════════════════════
  search?(q: SearchQuery, page?: PageRequest): Promise<SearchResult>
  browse?(nodeId?: string, page?: PageRequest): Promise<BrowseResult>
  /**
   * One page of the backend's curated recommendations.
   *
   * Returns the same shape browse does — the rows are playlist cards
   * (kind `album`/`playlist`, `leaf` where they open a detail, `urn` where
   * they have an identity) — because a card and a browse row answer the same
   * question: "what is this, and what does opening it do". A source that
   * keeps no local playlist store still says album here.
   */
  recommend?(page?: PageRequest): Promise<BrowseResult>

  /** Batched lookup. Falls back to N× `getTrack` when absent, which is slower. */
  getTracks?(ids: string[]): Promise<Track[]>
  getAlbum?(id: string, page?: PageRequest): Promise<AlbumDetail>
  getArtist?(id: string): Promise<ArtistDetail>
  getPlaylist?(id: string, page?: PageRequest): Promise<PlaylistDetail>
  getLyrics?(id: string): Promise<Lyrics | undefined>
  getArtwork?(ref: ArtworkRef, size?: number): Promise<Uri>

  library?: ProviderLibrary
}

/* ── The registry ───────────────────────────────────────────────────────── */

export interface AggregatedSearchEntry {
  sourceId: string
  result?: SearchResult
  /** Present on failure. The source is reported, never silently dropped. */
  error?: SourceError
  /** True when the source exceeded `timeoutMs` and is still running. */
  pending: boolean
  tookMs: number
}

export interface AggregatedSearch {
  bySource: AggregatedSearchEntry[]
}

/* ── The catalogue cache ────────────────────────────────────────────────── */

export type TrackSort =
  | 'title'
  | 'artist'
  | 'album'
  | 'addedAt'
  | 'year'
  | 'duration'
  | 'playCount'

export interface CatalogQuery {
  sort?: TrackSort
  desc?: boolean
  /** Restrict to given sources. Absent means every source. */
  sourceIds?: string[]
  /** Restrict to loved/favorited tracks. */
  onlyLoved?: boolean
  page?: PageRequest
}

export interface CatalogCounts {
  tracks: number
  albums: number
  artists: number
}

export interface SourcesService {
  /* ── the registry ──────────────────────────────────────────────────── */

  /**
   * Internal. Called by the source runtime once per enabled source, and by
   * `plugin-source-local`. Not an extension point — see the note at the top
   * of this file.
   */
  register(p: MediaProvider): Disposable
  readonly providers: readonly MediaProvider[]
  get(sourceId: string): MediaProvider | undefined
  /** Resolve a URN to its owning source. */
  forUrn(urn: string): MediaProvider | undefined
  /**
   * Fan out across every source that supports search.
   *
   * Returns per-source results *and* per-source errors — never a merged list
   * that silently drops a failing backend. With a dozen imported sources of
   * uneven quality this is the difference between "search is broken" and
   * "three of your twelve answered, one is rate-limited, one needs updating".
   *
   * `typesBySource` is the per-source form of `SearchQuery.types`: the search
   * screen gives each source's *interfaces* (songs, artists) their own toggle,
   * so one fan-out can ask a source for songs only while asking another for
   * both. A source absent from the map gets `q.types` unchanged.
   */
  searchAll(
    q: SearchQuery,
    opts?: {
      sourceIds?: string[]
      timeoutMs?: number
      typesBySource?: Record<string, SearchQuery['types']>
    },
  ): Promise<AggregatedSearch>

  /**
   * Search a single source with pagination, caching what comes back.
   *
   * Used for per-source "load more" requests where only one source needs to fetch
   * subsequent pages of results without refetching or interrupting the other sources.
   */
  searchSource(
    sourceId: string,
    query: SearchQuery,
    page?: PageRequest,
    opts?: {
      timeoutMs?: number
      types?: SearchQuery['types']
    },
  ): Promise<AggregatedSearchEntry>

  /**
   * Walk one source's hierarchy, caching what comes back.
   *
   * One source rather than a fan-out, because browsing is a *place* — the user
   * is inside a folder on a particular server, not looking at twelve at once.
   *
   * Goes through the service rather than straight to `provider.browse` so that
   * the rows and their payloads are cached on the way past, which is what
   * makes a browsed track still playable after a restart. A shell that calls
   * the provider directly gets the entries and silently loses that.
   */
  browse(sourceId: string, nodeId?: string, page?: PageRequest): Promise<BrowseResult>

  /**
   * One page of a source's curated recommendations, cached the same way browse
   * is: the cards' payloads (a playlist's document URL) go through the same
   * writer, so opening a recommended album works on the first try and keeps
   * working after a restart.
   */
  recommend(sourceId: string, page?: PageRequest): Promise<BrowseResult>

  /* ── sources as data (docs/06 §9, §10) ─────────────────────────────── */

  /** Every imported source, enabled or not, in `sortOrder`. */
  readonly sources: readonly SourceRecord[]
  source(id: string): SourceRecord | undefined

  /**
   * Import one document or a set of them.
   *
   * Accepts a JSON object, a JSON array, or either wrapped in whitespace or a
   * code fence. Deduplicates on `sourceUrl`, so re-importing is an *update*
   * that keeps the id — and therefore every URN, cached row, cookie jar and
   * playlist reference — rather than a duplicate.
   *
   * Never rejects a whole set for one bad entry: malformed documents land in
   * `rejected` with their position and the schema issue.
   */
  import(input: string, opts?: ImportOptions): Promise<ImportReport>

  /**
   * Serialise sources back to a shareable string.
   *
   * Symmetrical with `import`: app-maintained fields and **every credential**
   * are stripped, so export → import round-trips to an identical set and
   * sharing a source never shares an account.
   */
  export(ids?: string[]): Promise<string>

  /* ── cross-source identity (06 §11) ─────────────────────────────────── */

  /**
   * Everything known to be the same recording as `urn`, best evidence first.
   *
   * Returned rather than merged, and each entry carries its confidence: a
   * caller offering a fallback wants every link, a caller drawing one library
   * row wants only the certain ones. Anything below 1.00 is a *hint* — live
   * versions, remasters and radio edits share titles, artists and durations,
   * and merging on a bad guess makes a library wrong in a way nobody can see.
   */
  linksFor(urn: string): Promise<TrackLink[]>
  /* ── a source's own variables (06 §3.4) ─────────────────────────────── */

  /**
   * Read, write and clear a source's non-credential variables.
   *
   * On `ctx.sources` because this service owns the table — the SQL lives in
   * one place, and a caller does not have to know the schema.
   *
   * ⚠️ Going through here does not narrow a caller's capability: the gate is
   * resolved from the *calling* context, so a plugin writing a variable needs
   * `db:write:core` of its own and its manifest must say so.
   *
   * ⚠️ Credentials do not live here. The source variable and every login
   * field go to `ctx.secrets` (06 §5); this is for what a document stores
   * itself through `src.vars.put` — a cache key, a region, a page token.
   */
  readVars(sourceId: string): Promise<Record<string, string>>
  writeVar(sourceId: string, key: string, value: string): Promise<void>
  clearVars(sourceId: string, key?: string): Promise<void>

  /** The user says two URNs are one recording. Never overwritten by automation. */
  link(a: string, b: string): Promise<void>
  unlink(a: string, b: string): Promise<void>

  setEnabled(id: string, on: boolean): Promise<void>
  /** Toggle whether an audio source requires an external lyric source. */
  setNeedsLyricSource(id: string, needed: boolean): Promise<void>
  /** `forgetCatalogue` also drops the rows this source produced. */
  remove(id: string, opts?: { forgetCatalogue?: boolean }): Promise<void>

  /**
   * Health run: reach the base URL, search, resolve a stream, HEAD it.
   *
   * The first thing to do when "search stopped working", and what keeps the
   * stale badge honest. Absent `ids` means every enabled source.
   */
  check(ids?: string[], opts?: { signal?: AbortSignal }): Promise<CheckReport[]>

  /**
   * Run one step and stream a trace of every rule it evaluated.
   *
   * This is the maintenance story for the whole model: it is how a user — not
   * a developer — finds out which rule stopped matching. Credentials never
   * appear in a trace, because a trace is the thing people paste into forum
   * threads.
   */
  debug(id: string, step: DebugStep): AsyncIterable<TraceEvent>

  /*
   * Reads over rows already stored, from any provider.
   *
   * The catalogue lives here because this is where it is written: a provider
   * answers questions and returns plain data, and `ctx.sources` caches those
   * answers into the catalogue tables (§1). Reads belong beside the writes
   * rather than in a second service that would have to agree with them.
   * Playlists, favourites and collections are `ctx.library`'s, not these.
   */
  listTracks(q?: CatalogQuery): Promise<Paged<Track>>
  listAlbums(q?: CatalogQuery): Promise<Paged<Album>>
  listArtists(q?: CatalogQuery): Promise<Paged<Artist>>
  getAlbum(urn: string, page?: PageRequest): Promise<AlbumDetail | undefined>
  getPlaylist(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined>
  getArtist(urn: string): Promise<ArtistDetail | undefined>
  getTracks(urns: readonly string[]): Promise<Track[]>

  /**
   * FTS5 over the stored catalogue. Instant and available offline — the
   * opposite of `searchAll`, which asks the backends and may be slow, partial
   * or unreachable. Both exist; they answer different questions.
   */
  searchLocal(text: string, opts?: { limit?: number; sourceIds?: string[] }): Promise<SearchResult>

  counts(): Promise<CatalogCounts>

  /** Set or clear the loved status of a track. */
  setLoved(urn: string, loved: boolean): Promise<void>
}

declare module 'cordis' {
  interface Context {
    sources: SourcesService
  }
}
