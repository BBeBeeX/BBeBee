/** Catalogue entities. See docs/07-data-model.md §4.3. */

import type { SmartPlaylist } from './library.js'

export interface ArtworkRef {
  id: string
  sourceUrl?: string
  /** Instant placeholder, computed once at cache time rather than per render. */
  blurhash?: string
  /** '#RRGGBB'. Drives adaptive player theming. */
  dominantColor?: string
  width?: number
  height?: number
}

export type ArtistRole = 'main' | 'featured' | 'composer' | 'remixer' | 'conductor'

export interface ArtistCredit {
  urn: string
  name: string
  role: ArtistRole
  ordinal: number
}

export interface Artist {
  urn: string
  name: string
  sortName?: string
  artwork?: ArtworkRef
}

export interface ArtistDetail extends Artist, WithPayloads {
  bio?: string
  albums: Album[]
  topTracks?: Track[]
}

export type AlbumType = 'album' | 'single' | 'ep' | 'compilation' | 'live' | 'soundtrack'

export interface Album {
  urn: string
  title: string
  sortTitle?: string
  artists: ArtistCredit[]
  albumType?: AlbumType
  /** ISO-8601, possibly partial: '1997', '1997-04', '1997-04-22'. */
  releaseDate?: string
  year?: number
  trackCount?: number
  discCount?: number
  artwork?: ArtworkRef
  isVarious?: boolean
}

export interface AlbumDetail extends Album, WithPayloads {
  tracks: Track[]
  cursor?: string
  hasMore?: boolean
}

/**
 * A provider's answer, plus the cache material that came with it.
 *
 * Keyed by URN. `ctx.sources` writes each entry to that row's `raw_json`
 * (07 §4.3); the source runtime reads it back as `{{track.*}}` when a stream
 * is resolved, possibly days later and offline from the call that produced it
 * (06 §4). Resolution never re-runs the query it came from.
 *
 * Deliberately not a member of `Track` or `Album`. It is backend-shaped and
 * means nothing to any screen, and an entity that carried it would carry it
 * only when it came fresh from a provider — a difference no caller can see
 * and every caller would eventually come to depend on.
 */
export interface WithPayloads {
  payloads?: Readonly<Record<string, unknown>>
}

export interface Track {
  urn: string
  title: string
  sortTitle?: string
  artists: ArtistCredit[]
  albumUrn?: string
  albumTitle?: string
  trackNo?: number
  discNo?: number
  durationMs?: number
  year?: number
  genres?: string[]
  explicit?: boolean
  bpm?: number
  /** dB adjustments from the source's tags, applied by the `normalize` effect. */
  replayGainTrack?: number
  replayGainAlbum?: number
  peakTrack?: number
  /** Cleared on NotFoundError; greys the row out rather than hiding it. */
  available?: boolean
  artwork?: ArtworkRef
  externalIds?: ExternalIds
  loved?: boolean
  fetchedAt?: number
}

/** Identifiers that let the same recording be recognised across providers. */
export interface ExternalIds {
  isrc?: string
  mbid?: string
  upc?: string
  acoustid?: string
  discogs?: string
}

export interface Playlist {
  urn: string
  name: string
  description?: string
  artwork?: ArtworkRef
  owner?: string
  isPublic?: boolean
  trackCount?: number
  durationMs?: number
  /**
   * True when the tracks come from a rule tree rather than stored items.
   *
   * A smart playlist's items are read-only: `addTracks`, `removeItems` and
   * `moveItem` refuse, because there is no row a reorder could move. Its
   * definition is editable through `ctx.library.setSmartQuery`.
   */
  isSmart?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface PlaylistItem {
  id: string
  trackUrn: string
  /** Fractional index (LexoRank-style), so a reorder writes exactly one row. */
  position: string
  addedAt?: number
  addedBy?: string
  note?: string
}

export interface PlaylistDetail extends Playlist, WithPayloads {
  /**
   * For a stored playlist, the rows in `position` order. For a smart one,
   * synthetic rows: `id` is the track URN, because nothing was stored.
   */
  items: PlaylistItem[]
  tracks?: Track[]
  cursor?: string
  hasMore: boolean
  /** Present when `isSmart`, so a view can render the rule and hide edit controls. */
  smart?: SmartPlaylist
}

export interface Genre {
  id: string
  name: string
}
