/**
 * The `sources` table: imported documents, and everything the app knows about
 * them.
 *
 * `doc_json` is the imported string **verbatim**, not the parsed document
 * re-serialised. Export must emit what was imported — reordered keys, a
 * dropped unknown field, or reformatted whitespace would mean a user's
 * document came back changed, and the first time that happens they stop
 * trusting export (docs/07 §4.1).
 */

import type { DbService, SourceDocument, SourceRecord, SourceType, SqlValue } from '@BBeBee/protocol'
import { allowedHostsFor, docHashOf } from './identity.js'

interface SourceRow {
  id: string
  source_url: string
  name: string
  source_group: string | null
  source_type: string
  doc_json: string
  doc_hash: string
  enabled: number
  sort_order: number
  allowed_hosts_json: string | null
  locally_modified: number
  origin_uri: string | null
  imported_at: number
  updated_at: number
  last_check_at: number | null
  last_error: string | null
  fail_count: number
  respond_time_ms: number | null
}

const COLUMNS = `id, source_url, name, source_group, source_type, doc_json, doc_hash,
                 enabled, sort_order, allowed_hosts_json, locally_modified, origin_uri,
                 imported_at, updated_at, last_check_at, last_error, fail_count, respond_time_ms`

export class SourceStore {
  constructor(private readonly db: DbService) {}

  /**
   * Run `fn` atomically against the handle this store was built with.
   *
   * The transaction is issued here rather than by the caller for the same
   * reason the handle is captured at all: a `SourceStore` is a plain object,
   * so the handle it holds is reached un-shadowed and the statements run
   * under the service's own grants. A caller issuing `db.transaction()`
   * through the service proxy would have every statement inside it gated by
   * the *caller's* grants — the exact failure that made an import requested
   * by the UI package refuse with the UI plugin's name on it.
   */
  async transaction<T>(fn: (store: SourceStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(new SourceStore(tx)))
  }

  async all(): Promise<SourceRecord[]> {
    const rows = await this.db.query<SourceRow>(
      `SELECT ${COLUMNS} FROM sources ORDER BY sort_order, name COLLATE NOCASE`,
    )
    return rows.map(toRecord).filter((r): r is SourceRecord => r !== undefined)
  }

  async byUrl(sourceUrl: string): Promise<SourceRecord | undefined> {
    const row = await this.db.get<SourceRow>(
      `SELECT ${COLUMNS} FROM sources WHERE source_url = ?`,
      [sourceUrl],
    )
    return row && toRecord(row)
  }

  /**
   * Insert or replace one source.
   *
   * `capabilities_json` is deliberately not written here.
   *
   * It exists so the source list can render before a source connects, and it
   * is a *cache* of something derived — so the only honest writer is whatever
   * did the deriving. Nothing does yet: the runtime computes capabilities live
   * from the document on every read (docs/06 §1.3), which is cheap and cannot
   * go stale. A setter with no caller would be a column that looks maintained
   * and is not.
   */
  async put(record: SourceRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO sources (${COLUMNS})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         source_url = excluded.source_url,
         name = excluded.name,
         source_group = excluded.source_group,
         source_type = excluded.source_type,
         doc_json = excluded.doc_json,
         doc_hash = excluded.doc_hash,
         -- NOTE: enabled is deliberately absent. It is the user's switch, not
         -- the document's: an author publishing an update must not turn a
         -- source back on that the user switched off. setEnabled owns it.
         sort_order = excluded.sort_order,
         allowed_hosts_json = excluded.allowed_hosts_json,
         locally_modified = excluded.locally_modified,
         origin_uri = excluded.origin_uri,
         updated_at = excluded.updated_at`,
      [
        record.id,
        record.sourceUrl,
        record.name,
        record.group ?? null,
        record.type,
        record.docJson,
        record.docHash,
        record.enabled ? 1 : 0,
        record.sortOrder,
        JSON.stringify(record.allowedHosts),
        record.locallyModified ? 1 : 0,
        record.originUri ?? null,
        record.importedAt,
        record.updatedAt,
        record.lastCheckAt ?? null,
        record.lastError ?? null,
        record.failCount,
        record.respondTimeMs ?? null,
      ] satisfies SqlValue[],
    )
  }

  async setEnabled(id: string, on: boolean, now: number): Promise<void> {
    await this.db.exec(`UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?`, [
      on ? 1 : 0,
      now,
      id,
    ])
  }

  async setNeedsLyricSource(id: string, needed: boolean, now: number): Promise<void> {
    const row = await this.db.get<{ doc_json: string }>(
      `SELECT doc_json FROM sources WHERE id = ?`,
      [id],
    )
    if (!row) return
    let doc: Record<string, unknown> = {}
    try {
      doc = JSON.parse(row.doc_json) as Record<string, unknown>
    } catch {
      // ignore
    }
    doc.needsLyricSource = needed
    const updatedDocJson = JSON.stringify(doc)
    await this.db.exec(
      `UPDATE sources SET doc_json = ?, locally_modified = 1, updated_at = ? WHERE id = ?`,
      [updatedDocJson, now, id],
    )
  }

  async updateSourceUrl(id: string, newUrl: string, now: number): Promise<void> {
    const row = await this.db.get<{ doc_json: string }>(
      `SELECT doc_json FROM sources WHERE id = ?`,
      [id],
    )
    if (!row) return
    let doc: Record<string, unknown> = {}
    try {
      doc = JSON.parse(row.doc_json) as Record<string, unknown>
    } catch {
      // ignore
    }
    doc.sourceUrl = newUrl
    const updatedDocJson = JSON.stringify(doc)
    const allowedHosts = allowedHostsFor(doc as unknown as SourceDocument)
    const docHash = docHashOf(updatedDocJson)
    await this.db.exec(
      `UPDATE sources
         SET source_url = ?, doc_json = ?, doc_hash = ?, allowed_hosts_json = ?, locally_modified = 1, updated_at = ?
       WHERE id = ?`,
      [newUrl, updatedDocJson, docHash, JSON.stringify(allowedHosts), now, id],
    )
  }

  /**
   * Remove a source.
   *
   * ⚠️ The two modes differ in what survives, and the difference is forced by
   * the schema rather than chosen: catalogue rows are `REFERENCES sources(id)
   * ON DELETE CASCADE`, so deleting the row *necessarily* takes the library
   * with it. There is no third option where the row is gone and the tracks
   * remain — that would be orphaned rows with unresolvable URNs.
   *
   *   forgetCatalogue: true   delete the row; the cascade drops its tracks,
   *                           albums, artists, account and vars
   *   forgetCatalogue: false  keep the row, disabled, so the library stays
   *                           browsable and the switch in the source list
   *                           brings the source back
   *
   * The default is `false`, because losing a library to a mis-tapped button is
   * far worse than a stale row nothing reads. Re-importing the document does
   * *not* re-enable it: a disabled row is either "removed, kept the library"
   * or "switched off", nothing distinguishes them, and guessing wrong turns a
   * source the user silenced back on.
   */
  async remove(id: string, opts: { forgetCatalogue?: boolean } = {}, now = Date.now()): Promise<void> {
    if (opts.forgetCatalogue) {
      await this.db.transaction(async (tx) => {
        // The FK cascade reaches tracks, albums, artists, accounts and vars.
        // It does *not* reach these three, which key on the source or the
        // track by value rather than by reference — so without this they
        // accumulate forever: stale FTS hits for tracks that no longer exist,
        // lyrics nothing can display, library rows pointing at dead URNs.
        // Order matters and is not obvious: the FTS index is addressed by
        // rowid, and the map is the only thing that can turn this source's
        // URNs into rowids. Deleting the map first would strand every indexed
        // row permanently — searches returning tracks that no longer exist,
        // with no code path left that could ever find them again.
        await tx.exec(
          `DELETE FROM tracks_fts WHERE rowid IN (
             SELECT m.rowid FROM tracks_fts_map m
             JOIN tracks t ON t.urn = m.urn
             WHERE t.source_id = ?
           )`,
          [id],
        )
        await tx.exec(
          `DELETE FROM tracks_fts_map WHERE urn IN (SELECT urn FROM tracks WHERE source_id = ?)`,
          [id],
        )
        await tx.exec(`DELETE FROM lyrics WHERE source_id = ?`, [id])
        await tx.exec(`DELETE FROM library_items WHERE source_id = ?`, [id])

        /*
         * ⚠️ And the two identity tables, for the same reason and with worse
         * consequences than stale rows.
         *
         * `external_ids` and `track_links` key on a URN by value, so the FK
         * cascade never reaches them. Left behind, a removed source's ISRCs
         * keep matching — so the *next* source imported gets linked to tracks
         * that do not exist, and "also available on…" offers a failover to
         * nothing. Deleting rows the user asked to forget has to include what
         * those rows were related to.
         */
        await tx.exec(
          `DELETE FROM track_links WHERE urn_a IN (SELECT urn FROM tracks WHERE source_id = ?)
              OR urn_b IN (SELECT urn FROM tracks WHERE source_id = ?)`,
          [id, id],
        )
        await tx.exec(
          `DELETE FROM external_ids WHERE urn IN (SELECT urn FROM tracks WHERE source_id = ?)
              OR urn IN (SELECT urn FROM albums WHERE source_id = ?)`,
          [id, id],
        )
        await tx.exec(`DELETE FROM sources WHERE id = ?`, [id])
      })
      return
    }
    await this.db.exec(
      `UPDATE sources SET enabled = 0, updated_at = ? WHERE id = ?`,
      [now, id],
    )
  }

  async recordCheck(
    id: string,
    result: { ok: boolean; respondTimeMs?: number; message?: string; at: number },
  ): Promise<void> {
    await this.db.exec(
      `UPDATE sources
         SET last_check_at = ?, last_error = ?, respond_time_ms = ?,
             fail_count = CASE WHEN ? THEN 0 ELSE fail_count + 1 END
       WHERE id = ?`,
      [result.at, result.message ?? null, result.respondTimeMs ?? null, result.ok ? 1 : 0, id],
    )
  }

}

function toRecord(row: SourceRow): SourceRecord | undefined {
  let doc: SourceDocument
  try {
    doc = JSON.parse(row.doc_json) as SourceDocument
  } catch {
    // A row whose document will not parse is unusable but must not take the
    // rest of the list with it — the source list is how a user would notice.
    return undefined
  }
  return {
    id: row.id,
    sourceUrl: row.source_url,
    name: row.name,
    ...(row.source_group ? { group: row.source_group } : {}),
    type: (row.source_type as SourceType) ?? 'music',
    doc,
    docJson: row.doc_json,
    docHash: row.doc_hash || docHashOf(row.doc_json),
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    allowedHosts: parseHosts(row.allowed_hosts_json),
    locallyModified: row.locally_modified === 1,
    ...(row.origin_uri ? { originUri: row.origin_uri } : {}),
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    ...(row.last_check_at ? { lastCheckAt: row.last_check_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    failCount: row.fail_count,
    ...(row.respond_time_ms ? { respondTimeMs: row.respond_time_ms } : {}),
    needsLyricSource: doc.needsLyricSource ?? !doc.ruleLyric,
  }
}

function parseHosts(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
