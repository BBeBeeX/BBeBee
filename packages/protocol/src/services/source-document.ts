import type { SourceFormatError } from '../errors.js'
import type { StreamQuality } from '../entities/media.js'

/**
 * The **source document** — a music backend, as a string a user can import.
 *
 * A source is data, not a package. The user pastes JSON (one object, or an
 * array of them); the runtime interprets it. Nobody outside this repository
 * implements `MediaProvider`; they write one of these instead. This is the
 * legado book-source model applied to audio.
 *
 * Two properties of the shape are load-bearing and easy to lose:
 *
 *  - **Every rule value is a rule string**, never a plain value, even when it
 *    looks like one. A constant is written `=audio/mpeg`; without the `=` it
 *    is a selector for an element type that does not exist. See docs/06 §3.1.
 *  - **No credential ever appears in a document.** Credentials live in
 *    `ctx.secrets` and `source_vars`, outside `doc_json`, so "share this
 *    source" is safe by construction rather than by the sharer remembering
 *    (docs/06 §5, docs/07 §4.1).
 *
 * See docs/06-music-sources.md §2.
 */

/* ── Rule blocks ────────────────────────────────────────────────────────── */

/**
 * A rule string in the language of docs/06 §3.
 *
 * Aliased rather than left as `string` so a reader of a rule block can tell
 * "this is interpreted" from "this is a literal" without consulting the docs.
 */
export type Rule = string

/**
 * Search results, explore results, and album track listings share one shape.
 *
 * `trackList` selects the repeating element; every other field is evaluated
 * against one of them with `{{item}}` in scope.
 */
export interface ListRule {
  trackList: Rule
  title: Rule
  /** Becomes the URN's last segment, so it must be stable across searches. */
  trackId: Rule
  artist?: Rule
  album?: Rule
  albumId?: Rule
  artwork?: Rule
  durationMs?: Rule
  quality?: Rule
  /** Shortcut: when the list already carries a playable URL, ruleStream is skipped. */
  streamUrl?: Rule
  /** For explore and album lists: non-empty means "descend", not "play". */
  childUrl?: Rule
  /** track|album|artist|playlist|folder|genre */
  kind?: Rule
}

export interface AlbumRule {
  title: Rule
  artist?: Rule
  artwork?: Rule
  year?: Rule
  description?: Rule
  trackCount?: Rule
  /** Where `ruleTrackList` is evaluated. Absent means "the same document". */
  trackListUrl?: Rule
  /** Direct URL template to fetch album document by id if not cached from browse. */
  childUrl?: Rule
}

/** The only required block: a source that cannot produce a URL is not a source. */
export interface StreamRule {
  url: Rule
  /** JSON object; merged over the document's `header`. */
  headers?: Rule
  mimeType?: Rule
  codec?: Rule
  bitrateKbps?: Rule
  sampleRate?: Rule
  byteLength?: Rule
  /** Truthy string. Absent means "probe it with a HEAD". */
  seekable?: Rule
  /** Epoch ms. Its presence is what sets `capabilities.streaming.urlExpiry`. */
  expiresAt?: Rule
  /**
   * The tier **this resolve actually served**, in the app's vocabulary.
   */
  quality?: Rule
  /** Supported stream qualities. Overrides capability deduction. */
  qualities?: StreamQuality[]
}

export interface LyricRule {
  lyric: Rule
  format?: Rule
  offsetMs?: Rule
}

export interface LibraryRule {
  list?: Rule
  setSaved?: Rule
  createPlaylist?: Rule
  addToPlaylist?: Rule
  removeFromPlaylist?: Rule
  deletePlaylist?: Rule
}

export interface ArtistRule {
  artist?: Rule
  name?: Rule
  bio?: Rule
  artwork?: Rule
  albums?: Rule
  topTracks?: Rule
}

export interface PlaylistRule {
  playlist?: Rule
  name?: Rule
  description?: Rule
  artwork?: Rule
  trackList?: Rule
  trackId?: Rule
  title?: Rule
  artist?: Rule
  durationMs?: Rule
}

/* ── Authentication ─────────────────────────────────────────────────────── */

export interface LoginField {
  id: string
  label: string
  type?: 'text' | 'password' | 'checkbox' | 'select'
  options?: string[]
  placeholder?: string
}

/* ── The document ───────────────────────────────────────────────────────── */

export type SourceType = 'music' | 'podcast' | 'radio'

export interface SourceDocument {
  /** Identity, and the dedup key on import. The backend's base URL. */
  sourceUrl: string
  sourceName: string
  sourceType?: SourceType
  /** Free text, comma-separated. The only organising concept. */
  sourceGroup?: string
  sourceIcon?: string
  /** The author's notes, shown in the editor. */
  sourceComment?: string
  enabled?: boolean
  sortOrder?: number

  /**
   * Hosts this source may talk to, beyond `sourceUrl`'s own.
   *
   * Shown at import as a plain list of hostnames, because that is a sentence a
   * user can judge. A request to anything else is refused whether the URL was
   * written literally or computed at runtime — the limit that turns the
   * sandbox from a reach boundary into an egress one (docs/06 §8).
   */
  allowedHosts?: string[]

  /** Requests per window. `'3/1000'` is three per second. */
  concurrentRate?: string
  /** Sent on every request. A rule, so it may be computed. */
  header?: Rule
  /** What to type in the variable box, in the format expected. */
  variableComment?: string
  /** Functions shared by every `@js:` block in this document. */
  jsLib?: string

  loginType?: 'form' | 'variable' | 'webview' | 'qrcode'
  loginUrl?: string
  loginUi?: LoginField[]
  loginCheckJs?: string
  loginQrJs?: string
  loginPollJs?: string
  loginRefreshJs?: string

  searchUrl?: Rule
  /**
   * Where to search *artists* (bilibili users, Subsonic a sidebar), when the
   * backend searches them at a different endpoint from tracks. Absent with a
   * present `ruleSearchArtist` means the artist rules run over the same
   * document `searchUrl` fetched.
   */
  searchArtistUrl?: Rule
  /** A JSON array of `{ title, url }`, or a rule producing one. */
  exploreUrl?: Rule
  /**
   * The recommendation feed — a document the `ruleRecommend` list rule runs
   * over, when the backend curates one. Absent with a present `ruleRecommend`
   * means the rule builds its rows itself (`result` is then `null`), which is
   * how a source whose recommendations are a curated list rather than an
   * endpoint declares them.
   */
  recommendUrl?: Rule

  ruleSearch?: ListRule
  ruleSearchArtist?: ListRule
  ruleExplore?: ListRule
  /** The recommendation feed's rows — playlist cards, one page of them. */
  ruleRecommend?: ListRule
  ruleAlbum?: AlbumRule
  ruleTrackList?: ListRule
  ruleStream?: StreamRule
  ruleLyric?: LyricRule
  ruleLibrary?: LibraryRule
  ruleArtist?: ArtistRule
  rulePlaylist?: PlaylistRule
  /** Supported stream qualities. Can also be declared inside `ruleStream.qualities`. */
  qualities?: StreamQuality[]
  /**
   * Whether this audio source requires an external lyric source.
   * If true, lyrics resolution queries active third-party lyric sources.
   */
  needsLyricSource?: boolean

  /*
   * Maintained by the app, not the author. Stripped on export, so sharing a
   * source never leaks how fast *your* network is or when *you* last used it.
   */
  lastUpdated?: number
  respondTime?: number
  weight?: number
}

/* ── The stored row ─────────────────────────────────────────────────────── */

/**
 * A source as the app holds it: the document, plus what the app knows about it.
 *
 * `doc` is the imported string parsed, and `docJson` is that string verbatim.
 * Both are kept because export must emit what was imported — reordered keys or
 * a dropped unknown field would mean a user's document came back changed, and
 * the first time that happens they stop trusting export (docs/07 §4.1).
 */
export interface SourceRecord {
  /** Derived from `sourceUrl`: slugified host + 8 hex of its SHA-256. */
  readonly id: string
  readonly sourceUrl: string
  readonly name: string
  readonly group?: string
  readonly type: SourceType
  readonly doc: SourceDocument
  readonly docJson: string
  readonly docHash: string
  readonly enabled: boolean
  readonly sortOrder: number
  /** Whether this audio source requires an external lyric source. */
  readonly needsLyricSource?: boolean
  /** The egress allowlist, resolved: `sourceUrl`'s host plus `allowedHosts`. */
  readonly allowedHosts: readonly string[]
  /** Edited in the app since import; re-importing over it needs confirmation. */
  readonly locallyModified: boolean
  readonly originUri?: string
  readonly importedAt: number
  readonly updatedAt: number
  readonly lastCheckAt?: number
  readonly lastError?: string
  /** Three consecutive `RuleError`s marks the source stale (docs/06 §7). */
  readonly failCount: number
  readonly respondTimeMs?: number
}

/* ── Import and export ──────────────────────────────────────────────────── */

export interface ImportOptions {
  /** Import only these `sourceUrl`s out of a set. Absent means all of them. */
  select?: string[]
  /** Overwrite a source whose document was edited locally. */
  overwrite?: boolean
  group?: string
  /** Where this came from, when it was fetched rather than pasted. */
  originUri?: string
}

export interface ImportReport {
  added: SourceRecord[]
  updated: { record: SourceRecord; changedFields: string[] }[]
  unchanged: SourceRecord[]
  /**
   * One malformed entry never rejects the rest of a set.
   *
   * Carries the `SourceFormatError` itself, not a flattened string: the import
   * screen lists issues per path, and fixing a document one message at a time
   * is exactly the misery the multi-issue error exists to avoid.
   */
  rejected: { index: number; sourceName?: string; error: SourceFormatError }[]
  /**
   * Would overwrite a document the user edited in the app. Needs `overwrite`.
   *
   * Separate from `rejected` because nothing is wrong with these documents —
   * the user is being asked a question, not shown a failure.
   */
  conflicts: { record: SourceRecord; changedFields: string[] }[]
}

/* ── Health and diagnosis ───────────────────────────────────────────────── */

export interface CheckReport {
  sourceId: string
  ok: boolean
  /** Round-trip to the base URL, in ms. Sorts the source list. */
  respondTimeMs?: number
  /** Which step failed, if one did. */
  failedStep?: 'ping' | 'search' | 'stream'
  message?: string
  checkedAt: number
}

/**
 * One run of one of a source's features, on the test screen.
 *
 * Each kind maps onto a `MediaProvider` operation, so the screen can offer a
 * test area per feature the source actually implements — plus two that are
 * not features of the document at all: a raw request through the source's own
 * scoped HTTP, and arbitrary script in its sandbox.
 */
export type DebugStep =
  | { kind: 'search'; text: string; page?: number }
  | { kind: 'browse'; nodeId?: string; page?: number }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'playlist'; id: string; page?: number }
  | { kind: 'lyrics'; id: string }
  | { kind: 'library'; list: 'track' | 'album' | 'artist' | 'playlist'; page?: number }
  | { kind: 'stream'; id: string; quality?: StreamQuality }
  /**
   * One raw request through the source's own scoped HTTP — the same
   * allowlist, cookies and rate limits a rule's request would get, with the
   * body handed back for reading rather than parsed by a rule.
   */
  | {
      kind: 'http'
      method: 'GET' | 'POST'
      url: string
      headers?: Record<string, string>
      body?: string
    }
  /**
   * Arbitrary JavaScript in the source's sandbox: `src.*` is installed and
   * the document's `jsLib` is loaded, so a document's own functions can be
   * called with hand-picked arguments and the return value read whole.
   */
  | { kind: 'js'; code: string; /** JSON object whose keys become scope variables. */ argsJson?: string }

/**
 * Text that has been through the trace redactor.
 *
 * A distinct type rather than a comment, because "remember to redact" is the
 * kind of obligation that survives exactly one refactor. Assigning to one of
 * these fields requires a value from `redactForTrace` or
 * `assertSafeForTrace`, so a `url` carrying `{{source.var}}` — the common
 * case, not the exotic one — is unlikely to reach a trace by being forgotten
 * about.
 *
 * ⚠️ It is a **convention the compiler helps with, not a proof**: a `as
 * Redacted` cast forges one, and `assertSafeForTrace` exists precisely so
 * that vouching for a string is a deliberate, greppable act. Treat an
 * unexplained cast to `Redacted` in review the way you would treat `any`.
 */
export type Redacted = string & { readonly __redacted: unique symbol }

/**
 * One line of a rule trace.
 *
 * Every field that can carry user data is `Redacted` and truncated before it
 * leaves the runtime: a trace is the thing users paste into a forum thread
 * asking for help, so a credential in one is a leak with a helpful UI on top.
 */
export type TraceEvent =
  | {
      at: number
      kind: 'http'
      method: string
      url: Redacted
      status: number
      ms: number
      bytes: number
    }
  | { at: number; kind: 'error'; message: Redacted; block?: string; field?: string }
  | { at: number; kind: 'result'; summary: Redacted }
  /** A line the document itself printed — `src.log(...)`. */
  | { at: number; kind: 'log'; message: Redacted }
  /**
   * A whole value worth reading, not previewing: an HTTP response body, a
   * feature's full output, a debug script's return value. Still redacted and
   * capped — the cap is generous where a rule preview's was not.
   */
  | { at: number; kind: 'value'; label: string; value: Redacted }
