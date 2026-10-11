/**
 * Favorites: the `library_items` shelf.
 *
 * One row per URN, so "saved" is a primary-key lookup rather than a flag on
 * every entity table — which is what lets an album from a Subsonic server and
 * a track scanned off disk be saved by the same verb. `pinned` sorts a shelf
 * without the user re-applying a sort after every sync (docs/07 §4.6).
 */

import { LibraryError, parseUrn } from '@BBeBee/protocol'
import type { DbService, LibraryEntry, PageRequest, Paged, SavedKind } from '@BBeBee/protocol'
import { limitOf, offsetOf, paged } from './paging.js'

interface SavedRow {
  urn: string
  kind: string
  source_id: string
  added_at: number
  pinned: number
  sort_key: string | null
}

const KINDS: readonly SavedKind[] = ['track', 'album', 'artist', 'playlist']

export class Saved {
  constructor(private readonly db: DbService) {}

  async isSaved(urn: string): Promise<boolean> {
    const row = await this.db.get<{ one: number }>(
      'SELECT 1 AS one FROM library_items WHERE urn = ?',
      [urn],
    )
    return row !== undefined
  }

  /**
   * Save or unsave.
   *
   * `ON CONFLICT DO NOTHING` on purpose: saving an already-saved URN must
   * keep its original `addedAt`, or a second screen re-saving the same track
   * silently reorders the shelf underneath the user.
   */
  async setSaved(urn: string, saved: boolean): Promise<void> {
    const parsed = parseForSave(urn)
    if (!saved) {
      await this.db.exec('DELETE FROM library_items WHERE urn = ?', [urn])
      return
    }
    await this.db.exec(
      `INSERT INTO library_items (urn, kind, source_id, added_at, pinned, sort_key)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(urn) DO NOTHING`,
      [urn, parsed.kind, parsed.sourceId, Date.now()],
    )
  }

  async setPinned(urn: string, pinned: boolean): Promise<void> {
    const result = await this.db.exec('UPDATE library_items SET pinned = ? WHERE urn = ?', [
      pinned ? 1 : 0,
      urn,
    ])
    if (result.changes === 0) {
      throw new LibraryError(`nothing saved as ${urn}`, 'not-found')
    }
  }

  async list(kind?: SavedKind, page?: PageRequest): Promise<Paged<LibraryEntry>> {
    const limit = limitOf(page)
    const offset = offsetOf(page?.cursor)
    const filter = kind ? 'WHERE kind = ?' : ''
    const params: (string | number)[] = kind ? [kind, limit + 1, offset] : [limit + 1, offset]

    const rows = await this.db.query<SavedRow>(
      `SELECT urn, kind, source_id, added_at, pinned, sort_key
         FROM library_items
         ${filter}
        ORDER BY pinned DESC, added_at DESC, urn ASC
        LIMIT ? OFFSET ?`,
      params,
    )
    return paged(rows.map(toEntry), offset, limit)
  }
}

function parseForSave(urn: string): { sourceId: string; kind: SavedKind } {
  let parsed
  try {
    parsed = parseUrn(urn)
  } catch (error) {
    throw new LibraryError(`invalid urn ${JSON.stringify(urn)}`, 'invalid-urn', { cause: error })
  }
  if (!KINDS.includes(parsed.kind as SavedKind)) {
    // `genre` is a facet of the catalogue, not a thing a shelf holds.
    throw new LibraryError(`cannot save a ${parsed.kind}`, 'invalid-urn')
  }
  return { sourceId: parsed.sourceId, kind: parsed.kind as SavedKind }
}

function toEntry(row: SavedRow): LibraryEntry {
  return {
    urn: row.urn,
    kind: row.kind as SavedKind,
    sourceId: row.source_id,
    addedAt: row.added_at,
    pinned: row.pinned === 1,
    ...(row.sort_key ? { sortKey: row.sort_key } : {}),
  }
}
