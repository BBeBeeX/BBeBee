/**
 * Writing a provider's answers into the catalogue.
 *
 * docs/06 §1: a provider answers questions and returns plain data; `ctx.sources`
 * is what stores the answers. This is that storing — the write half of the file
 * `catalog.ts` reads back, and the step docs/06 §4's sequence diagram calls
 * "cache rows, index FTS".
 *
 * Two things depend on it, and only one of them is obvious:
 *
 *  - **Offline browsing.** A search result survives the network going away.
 *  - **Playing at all, later.** `tracks.raw_json` holds the provider's own
 *    payload for each track, and `ruleStream` reads it back as `{{track.*}}`
 *    (docs/06 §4). Without this write, a document whose stream URL needs
 *    anything beyond the URN's id resolved during the search that fetched it
 *    and failed after a restart.
 *
 * Deliberately *not* a second copy of `plugin-local-scanner`'s `importTrack`.
 * That one turns file metadata into rows; this one turns `Track` objects — the
 * protocol's own shape — into the same rows. Sharing them would mean one
 * function with two unrelated input types and a flag, which is how the
 * scanner's file-specific columns would start leaking into remote rows.
 */

import { formatUrn, sortKey, tryParseUrn } from '@BBeBee/protocol'
import { linkTracks, writeExternalIds } from './links.js'
import type { Album, ArtworkRef, DbService, Track } from '@BBeBee/protocol'

export interface CacheInput {
  tracks?: readonly Track[]
  albums?: readonly Album[]
  /** Provider payload per track URN. Written verbatim to `raw_json`. */
  payloads?: Readonly<Record<string, unknown>>
}

export interface CacheResult {
  /** URNs written, for `library/changed` and the FTS index. */
  trackUrns: string[]
  albumUrns: string[]
}

/**
 * Cap on one `raw_json` value.
 *
 * A payload is a search-result element, so it is normally a few hundred bytes.
 * A backend that embeds a lyrics blob or a base64 cover in every item would
 * otherwise multiply the catalogue by it — 50 results a search, every search.
 * Over the cap the payload is dropped rather than truncated: half a JSON
 * document is not a JSON document, and storing one would fail to parse later
 * at a point that has no way to explain itself.
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024

/**
 * The write side, holding the handle the way `Catalog` does.
 *
 * ⚠️ A holder, not `sources.ownDb`. `searchAll` is reached through the service
 * proxy from the search screen — a UI package with no db grants — and a method
 * reached that way runs under the *caller's* context. Reading the captured
 * handle there re-shadows it with the caller, so the write is refused,
 * `cache()` catches and warns, and the search "works" while nothing reaches
 * the catalogue: a queue that shows URNs and a player bar with no cover.
 * `Catalog` and `SourceStore` exist for exactly this reason.
 */
export class CacheWriter {
  constructor(private readonly db: DbService) {}

  /** What was written, for `library/changed` and the FTS index. */
  write(sourceId: string, input: CacheInput, now?: number): Promise<CacheResult> {
    return cacheEntities(this.db, sourceId, input, now)
  }

  /** Link what was just written — never the whole library (see `linkTracks`). */
  link(trackUrns: readonly string[]): Promise<number> {
    return linkTracks(this.db, trackUrns)
  }
}

/**
 * Write tracks and albums into the catalogue.
 *
 * One transaction: a half-written track — a row with no artists, an album with
 * no tracks — is worse than no row, because it renders as a real library item
 * that behaves strangely rather than as something absent.
 */
export async function cacheEntities(
  db: DbService,
  sourceId: string,
  input: CacheInput,
  now = Date.now(),
): Promise<CacheResult> {
  const trackUrns: string[] = []
  const albumUrns: string[] = []
  if (!input.tracks?.length && !input.albums?.length) return { trackUrns, albumUrns }

  await db.transaction(async (tx) => {
    for (const album of input.albums ?? []) {
      if (!ownedBy(album.urn, sourceId)) continue
      await writeAlbum(tx, sourceId, album, input.payloads?.[album.urn], now)
      albumUrns.push(album.urn)
    }

    for (const track of input.tracks ?? []) {
      /*
       * A provider may only write rows under its own source id.
       *
       * It cannot forge one — the runtime builds every URN from the record's
       * id — but this is the layer that would let a bug in one source
       * overwrite another's catalogue rows, and silently. Skipping is right
       * rather than throwing: one malformed URN in fifty results should not
       * cost the other forty-nine.
       */
      if (!ownedBy(track.urn, sourceId)) continue
      await writeTrack(tx, sourceId, track, input.payloads?.[track.urn], now)
      trackUrns.push(track.urn)
    }
  })

  return { trackUrns, albumUrns }
}

function ownedBy(urn: string, sourceId: string): boolean {
  return tryParseUrn(urn)?.sourceId === sourceId
}

async function writeAlbum(
  tx: DbService,
  sourceId: string,
  album: Album,
  payload: unknown,
  now: number,
): Promise<void> {
  const remoteId = tryParseUrn(album.urn)?.id ?? album.urn
  await ensureArtwork(tx, album.artwork, now)
  await tx.exec(
    `INSERT INTO albums (urn, source_id, remote_id, title, sort_title, year, track_count,
                         disc_count, artwork_id, is_various, fetched_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)
     ON CONFLICT(urn) DO UPDATE SET
       title       = excluded.title,
       sort_title  = excluded.sort_title,
       -- COALESCE, not excluded: a search result carries less than an album
       -- screen did, and overwriting a known year with NULL makes the
       -- catalogue get worse the more it is used.
       year        = COALESCE(excluded.year, albums.year),
       track_count = COALESCE(excluded.track_count, albums.track_count),
       artwork_id  = COALESCE(excluded.artwork_id, albums.artwork_id),
       fetched_at  = excluded.fetched_at,
       -- An album's payload holds its childUrl: the URL of its own document,
       -- which is the only thing getAlbum has to go on. A write that arrived
       -- without one must not erase it, or browsing to an album twice would
       -- make it unopenable.
       raw_json    = COALESCE(excluded.raw_json, albums.raw_json)`,
    [
      album.urn,
      sourceId,
      remoteId,
      album.title,
      sortKey(album.title) ?? null,
      album.year ?? null,
      album.trackCount ?? null,
      album.artwork?.id ?? null,
      now,
      serialisePayload(payload),
    ],
  )
}

/**
 * Ensure the row an `artwork_id` points at exists.
 *
 * ⚠️ `tracks.artwork_id` and `albums.artwork_id` are foreign keys, so writing
 * one for artwork nobody registered fails the *whole* transaction — and the
 * catch above turns that into "could not cache", so a source whose listings
 * carry cover URLs silently cached nothing at all. Found by the first fixture
 * that had artwork in its list rule.
 *
 * The remote URL is the id here, which is what the runtime mints: there is no
 * fetched image yet to hash, and `local_uri` fills in when one is downloaded.
 */
async function ensureArtwork(tx: DbService, ref: ArtworkRef | undefined, now: number): Promise<void> {
  if (!ref?.id) return
  await tx.exec(
    `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_url = COALESCE(artworks.source_url, excluded.source_url)`,
    [ref.id, ref.sourceUrl ?? null, now],
  )
}

async function writeTrack(
  tx: DbService,
  sourceId: string,
  track: Track,
  payload: unknown,
  now: number,
): Promise<void> {
  const remoteId = tryParseUrn(track.urn)?.id ?? track.urn
  await ensureArtwork(tx, track.artwork, now)

  // The album row has to exist before the track can reference it: `album_urn`
  // is a foreign key, and a search returns tracks that name an album it did
  // not also return.
  if (track.albumUrn && ownedBy(track.albumUrn, sourceId)) {
    await tx.exec(
      `INSERT INTO albums (urn, source_id, remote_id, title, sort_title, is_various, fetched_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(urn) DO UPDATE SET
         -- Only fill in a title that is missing. A stub written here must
         -- never overwrite the real one a later album fetch stored.
         title      = COALESCE(NULLIF(albums.title, ''), excluded.title),
         fetched_at = excluded.fetched_at`,
      [
        track.albumUrn,
        sourceId,
        tryParseUrn(track.albumUrn)?.id ?? track.albumUrn,
        track.albumTitle ?? '',
        sortKey(track.albumTitle) ?? null,
        now,
      ],
    )
  }

  await tx.exec(
    `INSERT INTO tracks (urn, source_id, remote_id, title, sort_title, album_urn, track_no,
                         disc_no, duration_ms, year, explicit, bpm, replay_gain_track,
                         replay_gain_album, peak_track, available, artwork_id, fetched_at,
                         raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(urn) DO UPDATE SET
       title             = excluded.title,
       sort_title        = excluded.sort_title,
       album_urn         = COALESCE(excluded.album_urn, tracks.album_urn),
       track_no          = COALESCE(excluded.track_no, tracks.track_no),
       disc_no           = COALESCE(excluded.disc_no, tracks.disc_no),
       duration_ms       = COALESCE(excluded.duration_ms, tracks.duration_ms),
       year              = COALESCE(excluded.year, tracks.year),
       explicit          = excluded.explicit,
       available         = excluded.available,
       artwork_id        = COALESCE(excluded.artwork_id, tracks.artwork_id),
       fetched_at        = excluded.fetched_at,
       -- The payload is the whole point of re-caching: a fresher search
       -- carries a fresher stream token. But a result that came without one
       -- must not erase the payload an earlier search stored, or the track
       -- becomes unplayable by being looked at.
       raw_json          = COALESCE(excluded.raw_json, tracks.raw_json)`,
    [
      track.urn,
      sourceId,
      remoteId,
      track.title,
      track.sortTitle ?? sortKey(track.title) ?? null,
      track.albumUrn ?? null,
      track.trackNo ?? null,
      track.discNo ?? null,
      track.durationMs ?? null,
      track.year ?? null,
      track.explicit ? 1 : 0,
      track.bpm ?? null,
      track.replayGainTrack ?? null,
      track.replayGainAlbum ?? null,
      track.peakTrack ?? null,
      track.available === false ? 0 : 1,
      track.artwork?.id ?? null,
      now,
      serialisePayload(payload),
    ],
  )

  await writeArtists(tx, sourceId, track, now)
  // Stored on the way past, so linking is a query rather than a re-fetch of
  // the whole catalogue later (docs/06 §11).
  await writeExternalIds(tx, track.urn, track.externalIds)
}

/**
 * The artist credits, as a join rather than a string.
 *
 * Replaced wholesale rather than merged: a backend that dropped a featured
 * artist means the credit is gone, and a merge would keep it for ever with no
 * way for anything to remove it.
 */
async function writeArtists(
  tx: DbService,
  sourceId: string,
  track: Track,
  now: number,
): Promise<void> {
  await tx.exec('DELETE FROM track_artists WHERE track_urn = ?', [track.urn])

  for (const credit of track.artists ?? []) {
    if (!ownedBy(credit.urn, sourceId)) continue
    await tx.exec(
      `INSERT INTO artists (urn, source_id, remote_id, name, sort_name, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(urn) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
      [
        credit.urn,
        sourceId,
        tryParseUrn(credit.urn)?.id ?? credit.urn,
        credit.name,
        sortKey(credit.name) ?? null,
        now,
      ],
    )
    await tx.exec(
      `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_urn, artist_urn, role) DO UPDATE SET ordinal = excluded.ordinal`,
      [track.urn, credit.urn, credit.role ?? 'main', credit.ordinal ?? 0],
    )
  }
}

/** `undefined` when there is nothing worth storing — never a partial document. */
function serialisePayload(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null
  let json: string
  try {
    json = JSON.stringify(payload)
  } catch {
    // Circular, or a BigInt. Neither can have come from a rule evaluation, so
    // this is a provider bug rather than a document one — and dropping the
    // payload degrades playback rather than failing the whole search.
    return null
  }
  if (json === undefined) return null
  return json.length > MAX_PAYLOAD_BYTES ? null : json
}

/** Re-exported so callers building URNs do not import the protocol twice. */
export { formatUrn }
