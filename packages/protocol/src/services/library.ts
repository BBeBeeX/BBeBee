/**
 * `ctx.library` — the user's curation: playlists, favorites, collections.
 *
 * Deliberately *not* the catalogue. `ctx.sources` owns which backends exist and
 * what they hold; this service owns what the user did with it. The split is
 * MD-3 in docs/11 §1.3, and it is what keeps the same SQL out of both view
 * packages: a screen calls `ctx.library` and never touches `ctx.db`.
 *
 * Three shapes of curation, one service:
 *
 *   favorites   `library_items` — "this URN is saved", toggleable, one row
 *   playlists    `playlists` + `playlist_items` — an ordered list of tracks,
 *                or a **smart** playlist, which stores a rule tree and
 *                resolves it to tracks at read time
 *   collections  `collections` + `collection_items` — nested folders holding
 *                any entity, ordered by a fractional index
 *
 * Playlists store their order as a fractional index (docs/07 §4.6), so moving
 * one track writes exactly one row. Smart playlists compile their rule tree to
 * **parameterised SQL only** — the compiler lives in `plugin-library/src/smart.ts`
 * and the field allowlist there is the security boundary, not a hint.
 *
 * See docs/07 §4.6.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Paged } from '../common.js'
import type {
  Collection,
  CollectionItem,
  LibraryEntry,
  SavedKind,
  SmartPlaylist,
} from '../entities/library.js'
import type { Playlist, PlaylistDetail } from '../entities/catalog.js'
import type { PageRequest } from './sources.js'

/**
 * The local user.
 *
 * One row, created on first run: `id` is a UUID that never changes, `name`
 * defaults to "Mine" and is editable in Settings. It is what created
 * playlists show as their creator — a single-user player has no other
 * creator concept, and remote playlists that carry their own `owner`
 * display that instead.
 */
export interface UserProfile {
  id: string
  name: string
}

/* ── Errors ─────────────────────────────────────────────────────────────── */

export type LibraryErrorCode = 'not-found' | 'smart-playlist' | 'invalid-urn' | 'invalid-name'

/**
 * A curation operation that could not be performed.
 *
 * Typed because the three cases want different UI: `not-found` means the row
 * vanished underneath the screen, `smart-playlist` means the control should
 * not have been offered, and `invalid-*` is a programming error.
 */
export class LibraryError extends Error {
  override readonly name = 'LibraryError'

  constructor(
    message: string,
    readonly code: LibraryErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** A smart-playlist rule tree that cannot compile. Never interpolated into SQL. */
export class SmartQueryError extends Error {
  override readonly name = 'SmartQueryError'

  constructor(
    message: string,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/* ── Options ────────────────────────────────────────────────────────────── */

export interface PlaylistCreateOptions {
  description?: string
  /**
   * Create a **smart** playlist instead of an empty stored one.
   *
   * The rule tree is compiled at read time, so the playlist reflects the
   * catalogue as it changes rather than a snapshot taken at creation.
   */
  smart?: SmartPlaylist
}

export interface PlaylistPatch {
  name?: string
  description?: string | null
  artworkUrl?: string | null
}

export interface AddTracksOptions {
  /** Insert before the track at this index. Absent appends to the end. */
  at?: number
}

/* ── The service ────────────────────────────────────────────────────────── */

export interface LibraryService {
  /* ── favorites ────────────────────────────────────────────────────── */

  /** Whether the URN is on a shelf. Invalid URNs answer `false`, never throw. */
  isSaved(urn: string): Promise<boolean>

  /**
   * Save or unsave one URN.
   *
   * Saving an already-saved URN is a no-op that keeps its original
   * `addedAt` — re-saving from a second screen must not reorder a shelf.
   * Emits `library/changed` with the URN's own kind.
   */
  setSaved(urn: string, saved: boolean): Promise<void>

  /** Saved rows, newest first, pinned first. `kind` absent means every kind. */
  listSaved(kind?: SavedKind, page?: PageRequest): Promise<Paged<LibraryEntry>>

  /**
   * Pin or unpin a saved row.
   *
   * Pins are what keep a favorite at the top of a 500-row shelf without a
   * separate "sort" the user has to re-apply after every sync.
   */
  setPinned(urn: string, pinned: boolean): Promise<void>

  /* ── playlists ─────────────────────────────────────────────────────── */

  /** Every playlist, most recently updated first. */
  listPlaylists(page?: PageRequest): Promise<Paged<Playlist>>

  /**
   * One playlist with its items.
   *
   * For a smart playlist the items are resolved from the rule tree at this
   * call; they carry the track URN as `id`, since nothing was stored.
   * `undefined` means no such playlist — the UI distinguishes that from an
   * empty one.
   */
  getPlaylist(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined>

  createPlaylist(name: string, opts?: PlaylistCreateOptions): Promise<Playlist>

  updatePlaylist(urn: string, patch: PlaylistPatch): Promise<void>

  deletePlaylist(urn: string): Promise<void>

  /**
   * Append tracks, or insert them at `at`.
   *
   * Duplicates are allowed on purpose: a playlist may deliberately contain the
   * same recording twice. Returns how many rows were written.
   */
  addTracks(urn: string, trackUrns: readonly string[], opts?: AddTracksOptions): Promise<number>

  removeItems(urn: string, itemIds: readonly string[]): Promise<void>

  /**
   * Move one item to `toIndex` in the visible order.
   *
   * Writes a single fractional-index key between the destination neighbours,
   * so a 5,000-track playlist reorders in one row rather than renumbering the
   * tail. `toIndex` is clamped to the list, so a drop past the end appends
   * instead of failing.
   */
  moveItem(urn: string, itemId: string, toIndex: number): Promise<void>

  /**
   * Replace a playlist's smart rule tree.
   *
   * Irreversible in the UI sense: stored items are kept in the table but stop
   * being shown. `isSmart` flips to true.
   */
  setSmartQuery(urn: string, query: SmartPlaylist): Promise<void>

  /* ── collections ───────────────────────────────────────────────────── */

  /** Every collection, parents before children, siblings in `position` order. */
  listCollections(): Promise<readonly Collection[]>

  createCollection(name: string, opts?: { parentId?: string }): Promise<Collection>

  renameCollection(id: string, name: string): Promise<void>

  moveCollection?(id: string, parentId: string | null): Promise<void>

  /** Deletes the collection **and everything nested under it** (FK cascade). */
  deleteCollection(id: string): Promise<void>

  listCollectionItems(id: string, page?: PageRequest): Promise<Paged<CollectionItem>>

  /**
   * Add entities to a collection. Membership is by URN, so the same URN twice
   * in one collection is one row. Returns how many were added.
   *
   * Folders only contain collection-level entities (playlists, albums, artists,
   * child folders). Individual tracks cannot be added directly to a folder and
   * will be rejected with an `invalid-urn` LibraryError.
   */
  addToCollection(id: string, urns: readonly string[]): Promise<number>

  removeFromCollection(id: string, urns: readonly string[]): Promise<void>

  /* ── profile ───────────────────────────────────────────────────────── */

  /**
   * The local user, created on first run (UUID id, name "Mine").
   *
   * The name is what created playlists display as their creator; remote
   * playlists that carry their own `owner` keep showing that instead.
   */
  getProfile(): Promise<UserProfile>

  /**
   * Rename the local user. An empty or whitespace-only name is refused with
   * an `invalid-name` LibraryError. Emits `library/profile-changed`.
   */
  updateProfile(patch: { name?: string }): Promise<UserProfile>
}

declare module 'cordis' {
  interface Context {
    library: LibraryService
  }
}
