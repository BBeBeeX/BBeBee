/**
 * The catalogue cache: reads over the rows providers and the scanner wrote,
 * and the FTS5 index that makes them searchable.
 *
 * Lives beside the registry because docs/06 §1 puts it there — a provider
 * answers questions and returns plain data; `ctx.sources` is what stores the
 * answers. Reads therefore sit next to the writes rather than in a second
 * service that would have to agree with them.
 *
 * Every query pages and sorts in SQL. A library holds 100k tracks and must
 * never be materialised in JS to order it.
 */

import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistCredit,
  ArtistDetail,
  ArtistRole,
  ArtworkRef,
  CatalogCounts,
  CatalogQuery,
  DbService,
  Paged,
  SearchResult,
  SqlValue,
  Track,
  TrackSort,
  UrnKind,
} from '@BBeBee/protocol'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** Rows as SQLite returns them: nullable columns, integers for booleans. */
interface TrackRow {
  urn: string
  title: string
  sort_title: string | null
  album_urn: string | null
  album_title: string | null
  track_no: number | null
  disc_no: number | null
  duration_ms: number | null
  year: number | null
  explicit: number
  bpm: number | null
  replay_gain_track: number | null
  replay_gain_album: number | null
  peak_track: number | null
  available: number
  artwork_id: string | null
  blurhash: string | null
  dominant_color: string | null
  artwork_source_url: string | null
  artwork_local_uri: string | null
  loved?: number | null
  fetched_at?: number | null
}

interface AlbumRow {
  urn: string
  title: string
  sort_title: string | null
  album_type: string | null
  release_date: string | null
  year: number | null
  track_count: number | null
  disc_count: number | null
  is_various: number
  artwork_id: string | null
  blurhash: string | null
  dominant_color: string | null
  artwork_source_url: string | null
  artwork_local_uri: string | null
}

interface ArtistRow {
  urn: string
  name: string
  sort_name: string | null
  bio: string | null
  artwork_id: string | null
  blurhash: string | null
  dominant_color: string | null
  artwork_source_url: string | null
  artwork_local_uri: string | null
}

interface CreditRow {
  track_urn: string
  artist_urn: string
  name: string
  role: string
  ordinal: number
}

function artworkOf(row: {
  artwork_id: string | null
  blurhash: string | null
  dominant_color: string | null
  artwork_source_url: string | null
  artwork_local_uri?: string | null
}): ArtworkRef | undefined {
  if (!row.artwork_id) return undefined
  return {
    id: row.artwork_id,
    sourceUrl: row.artwork_source_url ?? row.artwork_local_uri ?? undefined,
    blurhash: row.blurhash ?? undefined,
    dominantColor: row.dominant_color ?? undefined,
  }
}

/** `artworks` columns every entity query needs, joined the same way each time. */
const ARTWORK_COLUMNS = `
  aw.id AS artwork_id, aw.blurhash, aw.dominant_color, aw.source_url AS artwork_source_url,
  aw.local_uri AS artwork_local_uri`

/** The track projection every catalogue read shares. */
const TRACK_COLUMNS = `
  t.urn, t.title, t.sort_title, t.album_urn, al.title AS album_title,
  t.track_no, t.disc_no, t.duration_ms, t.year, t.explicit, t.bpm,
  t.replay_gain_track, t.replay_gain_album, t.peak_track, t.available, t.fetched_at,
  COALESCE(st.loved, 0) AS loved,
  ${ARTWORK_COLUMNS}`

/** The joins behind that projection: album title, artwork, loved status. */
const TRACK_JOINS = `
  LEFT JOIN albums al ON al.urn = t.album_urn
  LEFT JOIN artworks aw ON aw.id = COALESCE(t.artwork_id, al.artwork_id)
  LEFT JOIN track_stats st ON st.urn = t.urn`

/*
 * Visibility in listings.
 *
 * `tracks.available` is the provider's word that a track belongs in the
 * library right now — today the only thing that withdraws it is the scanner
 * disabling a specified dir (docs/06 §12). Withdrawn tracks keep their rows —
 * queue restores and playlists read by URN, and keep working — but leave
 * every listing: the library pages, search, and their album's track list.
 *
 * An album or artist hides only when every track under it is withdrawn; an
 * album with no tracks at all shows as it always has, so a partially filled
 * catalogue does not go blank.
 */
const AVAILABLE_TRACKS_ONLY = ' AND t.available = 1'
const ALBUMS_WITH_AVAILABLE_TRACKS =
  ' AND (EXISTS (SELECT 1 FROM tracks t WHERE t.album_urn = al.urn AND t.available = 1)' +
  ' OR NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_urn = al.urn))'
const ARTISTS_WITH_AVAILABLE_TRACKS =
  ' AND (EXISTS (SELECT 1 FROM tracks t JOIN track_artists ta ON ta.track_urn = t.urn' +
  ' WHERE ta.artist_urn = ar.urn AND t.available = 1)' +
  ' OR NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_urn = ar.urn))'

/**
 * How each sort maps to SQL.
 *
 * A fixed allowlist, never interpolation of a caller's string: `sort` arrives
 * from a UI and, later, from a smart-playlist rule tree, which is untrusted
 * input (docs/07 §4.6).
 */
const TRACK_ORDER: Record<TrackSort, string> = {
  title: 'COALESCE(t.sort_title, t.title)',
  artist: 'COALESCE(primary_artist.sort_name, primary_artist.name)',
  album: 'COALESCE(al.sort_title, al.title)',
  addedAt: 't.fetched_at',
  year: 't.year',
  duration: 't.duration_ms',
  playCount: 'COALESCE(st.play_count, 0)',
}

/** Offsets are the cursor here; the format is opaque and must stay that way. */
function offsetOf(cursor: string | undefined): number {
  if (!cursor) return 0
  const n = Number.parseInt(cursor, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function limitOf(query: CatalogQuery | undefined): number {
  const requested = query?.page?.limit ?? DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, requested))
}

/** `source_id IN (…)` when sources were named, plus its bound parameters. */
function sourceFilter(
  alias: string,
  sourceIds: string[] | undefined,
): { sql: string; params: SqlValue[] } {
  if (!sourceIds || sourceIds.length === 0) return { sql: '', params: [] }
  const holes = sourceIds.map(() => '?').join(', ')
  return { sql: ` AND ${alias}.source_id IN (${holes})`, params: [...sourceIds] }
}

function paged<T>(items: T[], offset: number, limit: number): Paged<T> {
  // One row beyond the page tells us whether there is a next page without a
  // second COUNT query. `total` stays absent: a count over a large catalogue
  // costs a scan, and a progress bar that lies is worse than none.
  const hasMore = items.length > limit
  return { items: hasMore ? items.slice(0, limit) : items, hasMore, ...(hasMore ? { cursor: String(offset + limit) } : {}) }
}

/**
 * Resolve a sort key to a SQL fragment.
 *
 * `Object.hasOwn`, not a plain lookup: `sort` arrives from a UI and later from
 * a smart-playlist rule tree, so it is untrusted input. A plain
 * `TRACK_ORDER[sort]` finds inherited members — `sort: 'toString'` returns a
 * function, which interpolates into ORDER BY as source code and takes the
 * statement down with a syntax error. The `??` fallback never fires for those,
 * because an inherited member is not nullish.
 */
function trackOrder(sort: string | undefined): string {
  if (sort && Object.hasOwn(TRACK_ORDER, sort)) {
    return TRACK_ORDER[sort as keyof typeof TRACK_ORDER]
  }
  return TRACK_ORDER.title
}

export class Catalog {
  constructor(private readonly db: DbService) {}

  /* ── reads ─────────────────────────────────────────────────────────── */

  async listTracks(query: CatalogQuery = {}): Promise<Paged<Track>> {
    const limit = limitOf(query)
    const offset = offsetOf(query.page?.cursor)
    const order = trackOrder(query.sort)
    const direction = query.desc ? 'DESC' : 'ASC'
    const filter = sourceFilter('t', query.sourceIds)
    const lovedFilter = query.onlyLoved ? ' AND COALESCE(st.loved, 0) = 1' : ''
    const availableFilter = AVAILABLE_TRACKS_ONLY

    const rows = await this.db.query<TrackRow>(
      `SELECT ${TRACK_COLUMNS}
         FROM tracks t
${TRACK_JOINS}
         LEFT JOIN track_artists ta ON ta.track_urn = t.urn AND ta.ordinal = 0
         LEFT JOIN artists primary_artist ON primary_artist.urn = ta.artist_urn
        WHERE 1 = 1${filter.sql}${lovedFilter}${availableFilter}
        ORDER BY ${order} ${direction}, t.urn ASC
        LIMIT ? OFFSET ?`,
      [...filter.params, limit + 1, offset],
    )

    const page = paged(rows, offset, limit)
    return { ...page, items: await this.hydrateTracks(page.items) }
  }

  async listAlbums(query: CatalogQuery = {}): Promise<Paged<Album>> {
    const limit = limitOf(query)
    const offset = offsetOf(query.page?.cursor)
    const order = query.sort === 'year' ? 'al.year' : 'COALESCE(al.sort_title, al.title)'
    const direction = query.desc ? 'DESC' : 'ASC'
    const filter = sourceFilter('al', query.sourceIds)
    const lovedFilter = query.onlyLoved
      ? ' AND EXISTS (SELECT 1 FROM tracks t JOIN track_stats st ON st.urn = t.urn WHERE t.album_urn = al.urn AND st.loved = 1)'
      : ''
    const availableFilter = ALBUMS_WITH_AVAILABLE_TRACKS

    const rows = await this.db.query<AlbumRow>(
      `SELECT al.urn, al.title, al.sort_title, al.album_type, al.release_date, al.year,
              al.track_count, al.disc_count, al.is_various, ${ARTWORK_COLUMNS}
         FROM albums al
         LEFT JOIN artworks aw ON aw.id = al.artwork_id
        WHERE 1 = 1${filter.sql}${lovedFilter}${availableFilter}
        ORDER BY ${order} ${direction}, al.urn ASC
        LIMIT ? OFFSET ?`,
      [...filter.params, limit + 1, offset],
    )

    const page = paged(rows, offset, limit)
    return { ...page, items: await this.hydrateAlbums(page.items) }
  }

  async listArtists(query: CatalogQuery = {}): Promise<Paged<Artist>> {
    const limit = limitOf(query)
    const offset = offsetOf(query.page?.cursor)
    const direction = query.desc ? 'DESC' : 'ASC'
    const filter = sourceFilter('ar', query.sourceIds)

    const rows = await this.db.query<ArtistRow>(
      `SELECT ar.urn, ar.name, ar.sort_name, ar.bio, ${ARTWORK_COLUMNS}
         FROM artists ar
         LEFT JOIN artworks aw ON aw.id = ar.artwork_id
        WHERE 1 = 1${filter.sql}${ARTISTS_WITH_AVAILABLE_TRACKS}
        ORDER BY COALESCE(ar.sort_name, ar.name) ${direction}, ar.urn ASC
        LIMIT ? OFFSET ?`,
      [...filter.params, limit + 1, offset],
    )

    const page = paged(rows, offset, limit)
    return { ...page, items: page.items.map((row) => this.toArtist(row)) }
  }

  async getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    const row = await this.db.get<AlbumRow>(
      `SELECT al.urn, al.title, al.sort_title, al.album_type, al.release_date, al.year,
              al.track_count, al.disc_count, al.is_various, ${ARTWORK_COLUMNS}
         FROM albums al
         LEFT JOIN artworks aw ON aw.id = al.artwork_id
        WHERE al.urn = ?`,
      [urn],
    )
    if (!row) return undefined

    const [album] = await this.hydrateAlbums([row])
    const tracks = await this.db.query<TrackRow>(
      `SELECT ${TRACK_COLUMNS}
         FROM tracks t
${TRACK_JOINS}
        WHERE t.album_urn = ?${AVAILABLE_TRACKS_ONLY}
        ORDER BY COALESCE(t.disc_no, 1) ASC, COALESCE(t.track_no, 0) ASC, t.urn ASC`,
      [urn],
    )

    return { ...album!, tracks: await this.hydrateTracks(tracks) }
  }

  /**
   * Tracks by URN, for views that show what the catalogue already knows —
   * the queue screen, a playlist. Chunked `IN (...)` reads, so a 5,000-track
   * queue is ten queries rather than five thousand round-trips.
   *
   * No visibility filter here, unlike the listings: a withdrawn track keeps
   * its row and stays resolvable from a restored queue (docs/06 §12). It comes
   * back with `available: false`, and the view greys it out rather than
   * losing it. URNs nothing answers for are simply absent.
   */
  async getTracks(urns: readonly string[]): Promise<Track[]> {
    const unique = [...new Set(urns)]
    const out: Track[] = []
    // A chunk's worth of host parameters stays far below SQLite's ceiling.
    for (let at = 0; at < unique.length; at += 500) {
      const chunk = unique.slice(at, at + 500)
      const rows = await this.db.query<TrackRow>(
        `SELECT ${TRACK_COLUMNS}
           FROM tracks t
${TRACK_JOINS}
          WHERE t.urn IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      )
      out.push(...(await this.hydrateTracks(rows)))
    }
    return out
  }

  async getArtist(urn: string): Promise<ArtistDetail | undefined> {
    const row = await this.db.get<ArtistRow>(
      `SELECT ar.urn, ar.name, ar.sort_name, ar.bio, ${ARTWORK_COLUMNS}
         FROM artists ar
         LEFT JOIN artworks aw ON aw.id = ar.artwork_id
        WHERE ar.urn = ?`,
      [urn],
    )
    if (!row) return undefined

    const albums = await this.db.query<AlbumRow>(
      `SELECT al.urn, al.title, al.sort_title, al.album_type, al.release_date, al.year,
              al.track_count, al.disc_count, al.is_various, ${ARTWORK_COLUMNS}
         FROM albums al
         JOIN album_artists aa ON aa.album_urn = al.urn
         LEFT JOIN artworks aw ON aw.id = al.artwork_id
        WHERE aa.artist_urn = ?${ALBUMS_WITH_AVAILABLE_TRACKS}
        ORDER BY al.year DESC, COALESCE(al.sort_title, al.title) ASC`,
      [urn],
    )

    return { ...this.toArtist(row), albums: await this.hydrateAlbums(albums) }
  }

  async counts(): Promise<CatalogCounts> {
    const row = await this.db.get<{ tracks: number; albums: number; artists: number }>(
      `SELECT (SELECT COUNT(*) FROM tracks)  AS tracks,
              (SELECT COUNT(*) FROM albums)  AS albums,
              (SELECT COUNT(*) FROM artists) AS artists`,
    )
    return { tracks: row?.tracks ?? 0, albums: row?.albums ?? 0, artists: row?.artists ?? 0 }
  }

  async setLoved(urn: string, loved: boolean): Promise<void> {
    await this.db.exec(
      `INSERT INTO track_stats (urn, loved)
       VALUES (?, ?)
       ON CONFLICT(urn) DO UPDATE SET loved = excluded.loved`,
      [urn, loved ? 1 : 0],
    )
  }

  /* ── search ────────────────────────────────────────────────────────── */

  /**
   * FTS5 over the stored catalogue.
   *
   * The query is bound, never interpolated, and the user's text is quoted as
   * an FTS5 phrase so that `AND`, `*`, `"` and friends are searched for rather
   * than executed as query syntax.
   */
  async searchLocal(
    text: string,
    opts: { limit?: number; sourceIds?: string[] } = {},
  ): Promise<SearchResult> {
    const query = ftsQuery(text)
    if (!query) return {}

    const limit = Math.max(1, Math.min(MAX_LIMIT, opts.limit ?? 50))
    const filter = sourceFilter('t', opts.sourceIds)

    const rows = await this.db.query<TrackRow>(
      `SELECT ${TRACK_COLUMNS}
         FROM tracks_fts f
         JOIN tracks_fts_map m ON m.rowid = f.rowid
         JOIN tracks t ON t.urn = m.urn
${TRACK_JOINS}
        WHERE tracks_fts MATCH ?${filter.sql}${AVAILABLE_TRACKS_ONLY}
        ORDER BY rank
        LIMIT ?`,
      [query, ...filter.params, limit],
    )

    const tracks = await this.hydrateTracks(rows)
    return { tracks: { items: tracks, hasMore: tracks.length === limit } }
  }

  /* ── the FTS index ─────────────────────────────────────────────────── */

  /**
   * Re-index the named tracks.
   *
   * Driven by `library/changed`, so any provider's rows are indexed without
   * the scanner or a source knowing an index exists.
   *
   * ⚠️ A contentless FTS5 table refuses a partial `UPDATE`, so a re-index is
   * `DELETE` + `INSERT` on the same rowid (docs/07 §4.3). The mapping table
   * hands out that rowid and keeps it stable across re-indexing, so a rename
   * updates a row rather than accumulating stale hits.
   */
  async index(urns: string[]): Promise<void> {
    if (urns.length === 0) return
    // One transaction for the batch: four statements per track, and a crash
    // between them would leave the index disagreeing with the catalogue.
    await this.db.transaction(async (tx) => this.indexWithin(tx, urns))
  }

  private async indexWithin(tx: DbService, urns: string[]): Promise<void> {
    // Dedupe: the per-urn version tolerated repeats (second pass found the
    // map row); the batched INSERTs below would hit UNIQUE(urn) instead.
    const unique = [...new Set(urns)]
    // Chunk to stay under SQLite's bound-variable limit for large batches.
    const CHUNK = 500
    for (let i = 0; i < unique.length; i += CHUNK) {
      await this.indexChunk(tx, unique.slice(i, i + CHUNK))
    }
  }

  /**
   * Batched FTS re-index: a constant ~7 statements per chunk instead of four
   * per track. Semantics match the old per-urn loop — rowids stay stable
   * across re-indexing, gone tracks drop their map rows.
   */
  private async indexChunk(tx: DbService, urns: string[]): Promise<void> {
    if (urns.length === 0) return
    const holes = urns.map(() => '?').join(',')

    // 1. All tracks in one query (was: one per urn, each with its own
    // GROUP_CONCAT subquery).
    const tracks = await tx.query<{
      urn: string
      title: string
      album_title: string | null
      artist_names: string | null
    }>(
      `SELECT t.urn, t.title, al.title AS album_title,
              (SELECT GROUP_CONCAT(a.name, ' ')
                 FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                WHERE ta.track_urn = t.urn) AS artist_names
         FROM tracks t
         LEFT JOIN albums al ON al.urn = t.album_urn
        WHERE t.urn IN (${holes})`,
      urns,
    )
    const byUrn = new Map(tracks.map((t) => [t.urn, t]))

    // 2. Existing index mappings in one query (was: one per urn).
    const mapped = await tx.query<{ urn: string; rowid: number }>(
      `SELECT urn, rowid FROM tracks_fts_map WHERE urn IN (${holes})`,
      urns,
    )
    const rowidByUrn = new Map(mapped.map((m) => [m.urn, m.rowid]))

    // 3. Drop stale FTS rows for re-indexed urns (was: one DELETE per urn).
    // A contentless FTS5 table refuses partial UPDATE, so re-index is
    // DELETE + INSERT on the same rowid.
    const reindexed = [...rowidByUrn.values()]
    if (reindexed.length > 0) {
      const rh = reindexed.map(() => '?').join(',')
      await tx.exec(`DELETE FROM tracks_fts WHERE rowid IN (${rh})`, reindexed)
    }

    // 4. Hand out rowids for new urns: one bulk INSERT + one re-read
    // (was: one INSERT per urn, each returning lastInsertRowid).
    const fresh = urns.filter((u) => byUrn.has(u) && !rowidByUrn.has(u))
    if (fresh.length > 0) {
      const fh = fresh.map(() => '?').join(',')
      await tx.exec(
        `INSERT INTO tracks_fts_map (urn) VALUES ${fresh.map(() => '(?)').join(',')}`,
        fresh,
      )
      const got = await tx.query<{ urn: string; rowid: number }>(
        `SELECT urn, rowid FROM tracks_fts_map WHERE urn IN (${fh})`,
        fresh,
      )
      for (const g of got) rowidByUrn.set(g.urn, g.rowid)
    }

    // 5. Drop map rows for urns whose track row is gone (was: per urn).
    const gone = urns.filter((u) => !byUrn.has(u) && rowidByUrn.has(u))
    if (gone.length > 0) {
      const gh = gone.map(() => '?').join(',')
      await tx.exec(`DELETE FROM tracks_fts_map WHERE urn IN (${gh})`, gone)
    }

    // 6. Insert the new FTS rows in one statement (was: one per urn).
    const present = urns.filter((u) => byUrn.has(u))
    if (present.length > 0) {
      const values: SqlValue[] = []
      const placeholders = present.map((u) => {
        const t = byUrn.get(u)!
        values.push(rowidByUrn.get(u)!, t.title, t.artist_names ?? '', t.album_title ?? '')
        return '(?, ?, ?, ?)'
      })
      await tx.exec(
        `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES ${placeholders.join(',')}`,
        values,
      )
    }
  }

  /* ── row → entity ──────────────────────────────────────────────────── */

  private toArtist(row: ArtistRow): ArtistDetail {
    return {
      urn: row.urn,
      name: row.name,
      sortName: row.sort_name ?? undefined,
      bio: row.bio ?? undefined,
      artwork: artworkOf(row),
      albums: [],
    }
  }

  /** One credits query for the whole page, never one per row. */
  private async creditsFor(urns: string[]): Promise<Map<string, ArtistCredit[]>> {
    const byTrack = new Map<string, ArtistCredit[]>()
    if (urns.length === 0) return byTrack

    const holes = urns.map(() => '?').join(', ')
    const rows = await this.db.query<CreditRow>(
      `SELECT ta.track_urn, ta.artist_urn, a.name, ta.role, ta.ordinal
         FROM track_artists ta
         JOIN artists a ON a.urn = ta.artist_urn
        WHERE ta.track_urn IN (${holes})
        ORDER BY ta.ordinal ASC`,
      urns,
    )

    for (const row of rows) {
      const credits = byTrack.get(row.track_urn) ?? []
      credits.push({
        urn: row.artist_urn,
        name: row.name,
        role: row.role as ArtistRole,
        ordinal: row.ordinal,
      })
      byTrack.set(row.track_urn, credits)
    }
    return byTrack
  }

  private async hydrateTracks(rows: TrackRow[]): Promise<Track[]> {
    const credits = await this.creditsFor(rows.map((r) => r.urn))
    return rows.map((row) => ({
      urn: row.urn,
      title: row.title,
      sortTitle: row.sort_title ?? undefined,
      artists: credits.get(row.urn) ?? [],
      albumUrn: row.album_urn ?? undefined,
      albumTitle: row.album_title ?? undefined,
      trackNo: row.track_no ?? undefined,
      discNo: row.disc_no ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      year: row.year ?? undefined,
      explicit: row.explicit === 1,
      bpm: row.bpm ?? undefined,
      replayGainTrack: row.replay_gain_track ?? undefined,
      replayGainAlbum: row.replay_gain_album ?? undefined,
      peakTrack: row.peak_track ?? undefined,
      available: row.available === 1,
      artwork: artworkOf(row),
      loved: row.loved !== undefined && row.loved !== null ? row.loved === 1 : undefined,
      fetchedAt: row.fetched_at ?? undefined,
    }))
  }

  private async hydrateAlbums(rows: AlbumRow[]): Promise<Album[]> {
    const byAlbum = new Map<string, ArtistCredit[]>()
    if (rows.length > 0) {
      const holes = rows.map(() => '?').join(', ')
      const credits = await this.db.query<{
        album_urn: string
        artist_urn: string
        name: string
        ordinal: number
      }>(
        `SELECT aa.album_urn, aa.artist_urn, a.name, aa.ordinal
           FROM album_artists aa
           JOIN artists a ON a.urn = aa.artist_urn
          WHERE aa.album_urn IN (${holes})
          ORDER BY aa.ordinal ASC`,
        rows.map((r) => r.urn),
      )
      for (const row of credits) {
        const list = byAlbum.get(row.album_urn) ?? []
        list.push({ urn: row.artist_urn, name: row.name, role: 'main', ordinal: row.ordinal })
        byAlbum.set(row.album_urn, list)
      }
    }

    return rows.map((row) => ({
      urn: row.urn,
      title: row.title,
      sortTitle: row.sort_title ?? undefined,
      artists: byAlbum.get(row.urn) ?? [],
      albumType: (row.album_type ?? undefined) as Album['albumType'],
      releaseDate: row.release_date ?? undefined,
      year: row.year ?? undefined,
      trackCount: row.track_count ?? undefined,
      discCount: row.disc_count ?? undefined,
      isVarious: row.is_various === 1,
      artwork: artworkOf(row),
    }))
  }
}

/**
 * Turn user text into an FTS5 MATCH expression.
 *
 * Each word becomes a quoted prefix term, so `bjork ho` matches "Björk" and
 * "Homogenic" as-you-type. Quoting is what keeps `AND`, `NEAR`, `*` and a
 * stray `"` searchable text rather than query syntax — an unquoted FTS5 query
 * from a search box throws on the first apostrophe someone types.
 */
export function ftsQuery(text: string): string | undefined {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/"/g, '').trim())
    .filter(Boolean)
  if (words.length === 0) return undefined
  return words.map((w) => `"${w}"*`).join(' AND ')
}

/** Kinds `searchLocal` can return. M1 indexes tracks; albums and artists follow. */
export const SEARCHABLE_KINDS: readonly UrnKind[] = ['track']
