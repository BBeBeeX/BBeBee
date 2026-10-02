/**
 * Everything the player keeps in SQL.
 *
 * Split out because the transport is hard enough to read without SQL in the
 * middle of it, and because the persistence rules are their own contract:
 * `queue_items` and `playback_state` are what "the queue survives a restart"
 * actually means (docs/07 §4.7).
 */

import type {
  ArtworkRef,
  DbService,
  NowPlayingMeta,
  PlayHistoryHeatmapDay,
  PlayHistoryStats,
  PlayRecord,
  QueueItem,
  RepeatMode,
  SqlValue,
} from '@BBeBee/protocol'
import type { QueueEntry } from './queue.js'

export interface PersistedState {
  currentItemId?: string
  positionMs: number
  repeat: RepeatMode
  shuffle: boolean
  shuffleSeed: number
  volume: number
  muted: boolean
}

export type { NowPlayingMeta }

interface QueueRow {
  id: string
  position: string
  track_urn: string
  source_context_json: string | null
  added_by: string
  added_at: number
}

export class PlayerStore {
  constructor(
    private readonly db: DbService,
    private readonly deviceId: string,
  ) {}

  /* ── the queue ─────────────────────────────────────────────────────── */

  async loadQueue(): Promise<QueueEntry[]> {
    const rows = await this.db.query<QueueRow>(
      `SELECT id, position, track_urn, source_context_json, added_by, added_at
         FROM queue_items ORDER BY position ASC`,
    )
    return rows.map((row) => ({
      position: row.position,
      item: {
        id: row.id,
        trackUrn: row.track_urn,
        addedBy: row.added_by as QueueItem['addedBy'],
        addedAt: row.added_at,
        // A malformed `source_context_json` costs its own "playing from" line,
        // not the whole queue: an exception here would fail Player init and
        // leave the user with no player at all.
        ...(parseContext(row.source_context_json)
          ? { sourceContext: parseContext(row.source_context_json) }
          : {}),
      },
    }))
  }

  /**
   * Replace the queue.
   *
   * `playback_state.current_item_id` has `ON DELETE SET NULL`, so clearing the
   * rows also clears the pointer — which is why the caller saves state after
   * this, never before.
   */
  async replaceQueue(entries: readonly QueueEntry[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM queue_items')
      await insertEntries(tx, entries)
    })
  }

  async insertQueue(entries: readonly QueueEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.db.transaction(async (tx) => {
      await insertEntries(tx, entries)
    })
  }

  async removeQueue(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.transaction(async (tx) => {
      const BATCH_SIZE = 50
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE)
        const placeholders = chunk.map(() => '?').join(', ')
        await tx.exec(`DELETE FROM queue_items WHERE id IN (${placeholders})`, chunk)
      }
    })
  }

  /** One row — the point of a fractional index (docs/07 §4.6). */
  async moveQueueItem(entry: QueueEntry): Promise<void> {
    await this.db.exec('UPDATE queue_items SET position = ? WHERE id = ?', [
      entry.position,
      entry.item.id,
    ])
  }

  /* ── transport state ───────────────────────────────────────────────── */

  async loadState(): Promise<PersistedState | undefined> {
    const row = await this.db.get<{
      current_item_id: string | null
      position_ms: number
      repeat_mode: string
      shuffle: number
      shuffle_seed: number | null
      volume: number
      muted: number
    }>('SELECT * FROM playback_state WHERE id = 1')
    if (!row) return undefined

    return {
      ...(row.current_item_id ? { currentItemId: row.current_item_id } : {}),
      positionMs: row.position_ms,
      repeat: row.repeat_mode as RepeatMode,
      shuffle: row.shuffle === 1,
      shuffleSeed: row.shuffle_seed ?? 1,
      volume: row.volume,
      muted: row.muted === 1,
    }
  }

  async saveState(state: PersistedState): Promise<void> {
    try {
      await this.db.exec(
        `INSERT INTO playback_state
           (id, current_item_id, position_ms, repeat_mode, shuffle, shuffle_seed,
            volume, muted, device_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           current_item_id = excluded.current_item_id,
           position_ms     = excluded.position_ms,
           repeat_mode     = excluded.repeat_mode,
           shuffle         = excluded.shuffle,
           shuffle_seed    = excluded.shuffle_seed,
           volume          = excluded.volume,
           muted           = excluded.muted,
           device_id       = excluded.device_id,
           updated_at      = excluded.updated_at`,
        [
          state.currentItemId ?? null,
          Math.round(state.positionMs),
          state.repeat,
          state.shuffle ? 1 : 0,
          state.shuffleSeed,
          state.volume,
          state.muted ? 1 : 0,
          this.deviceId,
          Date.now(),
        ],
      )
    } catch (error) {
      if (state.currentItemId && String(error).includes('FOREIGN KEY')) {
        // When currentItemId is not yet written to queue_items (e.g. async queue persistence in flight),
        // gracefully fall back to saving without current_item_id so position, volume, and modes are preserved.
        await this.db.exec(
          `INSERT INTO playback_state
             (id, current_item_id, position_ms, repeat_mode, shuffle, shuffle_seed,
              volume, muted, device_id, updated_at)
           VALUES (1, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             current_item_id = excluded.current_item_id,
             position_ms     = excluded.position_ms,
             repeat_mode     = excluded.repeat_mode,
             shuffle         = excluded.shuffle,
             shuffle_seed    = excluded.shuffle_seed,
             volume          = excluded.volume,
             muted           = excluded.muted,
             device_id       = excluded.device_id,
             updated_at      = excluded.updated_at`,
          [
            Math.round(state.positionMs),
            state.repeat,
            state.shuffle ? 1 : 0,
            state.shuffleSeed,
            state.volume,
            state.muted ? 1 : 0,
            this.deviceId,
            Date.now(),
          ],
        )
        return
      }
      throw error
    }
  }

  /* ── history ───────────────────────────────────────────────────────── */

  /**
   * Append the play and update the derived stats in one transaction.
   *
   * `play_history` is the truth and `track_stats` is a cache of it; writing
   * them together is what keeps "most played" a single indexed read that can
   * never disagree with the record it came from (docs/07 §4.7).
   */
  async recordPlay(record: PlayRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO play_history
           (id, track_urn, started_at, ended_at, ms_played, completed, skipped,
            source_json, device_id, scrobble_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          record.id,
          record.trackUrn,
          record.startedAt,
          record.endedAt ?? null,
          Math.round(record.msPlayed),
          record.completed ? 1 : 0,
          record.skipped ? 1 : 0,
          record.source ? JSON.stringify(record.source) : null,
          record.deviceId ?? this.deviceId,
        ],
      )
      await tx.exec(
        `INSERT INTO track_stats (urn, play_count, skip_count, last_played_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(urn) DO UPDATE SET
           play_count     = play_count + excluded.play_count,
           skip_count     = skip_count + excluded.skip_count,
           last_played_at = excluded.last_played_at`,
        [
          record.trackUrn,
          record.completed ? 1 : 0,
          record.skipped ? 1 : 0,
          record.endedAt ?? record.startedAt,
        ],
      )
    })
  }

  async listHistory(opts: { limit?: number; offset?: number; date?: string } = {}): Promise<PlayRecord[]> {
    const limit = opts.limit ?? 100
    const offset = opts.offset ?? 0
    let query = `SELECT id, track_urn, started_at, ended_at, ms_played, completed, skipped, source_json, device_id
                 FROM play_history`
    const params: SqlValue[] = []

    if (opts.date) {
      const parts = opts.date.split('-').map(Number)
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        const startOfDay = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime()
        const endOfDay = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999).getTime()
        query += ` WHERE started_at >= ? AND started_at <= ?`
        params.push(startOfDay, endOfDay)
      }
    }

    query += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const rows = await this.db.query<{
      id: string
      track_urn: string
      started_at: number
      ended_at: number | null
      ms_played: number
      completed: number
      skipped: number
      source_json: string | null
      device_id: string | null
    }>(query, params)

    return rows.map((row) => ({
      id: row.id,
      trackUrn: row.track_urn,
      startedAt: row.started_at,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      msPlayed: row.ms_played,
      completed: row.completed === 1,
      skipped: row.skipped === 1,
      ...(parseContext(row.source_json) ? { source: parseContext(row.source_json) } : {}),
      ...(row.device_id ? { deviceId: row.device_id } : {}),
    }))
  }

  async getHistoryStats(): Promise<PlayHistoryStats> {
    const overall = await this.db.get<{
      total_plays: number
      total_ms_played: number | null
      completed_plays: number | null
    }>(
      `SELECT count(*) AS total_plays,
              coalesce(sum(ms_played), 0) AS total_ms_played,
              coalesce(sum(completed), 0) AS completed_plays
         FROM play_history`,
    )

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStartMs = today.getTime()

    const todayRow = await this.db.get<{ today_plays: number }>(
      `SELECT count(*) AS today_plays FROM play_history WHERE started_at >= ?`,
      [todayStartMs],
    )

    return {
      totalPlays: overall?.total_plays ?? 0,
      totalMsPlayed: overall?.total_ms_played ?? 0,
      todayPlays: todayRow?.today_plays ?? 0,
      completedPlays: overall?.completed_plays ?? 0,
    }
  }

  async getHistoryHeatmap(days = 365): Promise<PlayHistoryHeatmapDay[]> {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0)
    const startMs = start.getTime()

    const rows = await this.db.query<{ started_at: number; ms_played: number }>(
      `SELECT started_at, ms_played FROM play_history WHERE started_at >= ? ORDER BY started_at ASC`,
      [startMs],
    )

    const dayMap = new Map<string, { count: number; msPlayed: number }>()
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const dateStr = formatDateIso(d)
      dayMap.set(dateStr, { count: 0, msPlayed: 0 })
    }

    for (const row of rows) {
      const dateStr = formatDateIso(new Date(row.started_at))
      const entry = dayMap.get(dateStr)
      if (entry) {
        entry.count += 1
        entry.msPlayed += row.ms_played
      }
    }

    return Array.from(dayMap.entries()).map(([date, data]) => ({
      date,
      count: data.count,
      msPlayed: data.msPlayed,
    }))
  }

  async clearHistory(): Promise<void> {
    await this.db.exec('DELETE FROM play_history')
  }

  async removeHistory(idOrUrn: string): Promise<void> {
    await this.db.exec('DELETE FROM play_history WHERE id = ? OR track_urn = ?', [idOrUrn, idOrUrn])
  }

  /** A track the provider says is gone: greyed out in lists, not hidden. */
  async markUnavailable(urn: string): Promise<void> {
    await this.db.exec('UPDATE tracks SET available = 0 WHERE urn = ?', [urn])
  }

  /* ── now playing ───────────────────────────────────────────────────── */

  async nowPlaying(urn: string): Promise<NowPlayingMeta | undefined> {
    const row = await this.db.get<{
      title: string
      album: string | null
      artwork_id: string | null
      artwork_uri: string | null
      source_url: string | null
      blurhash: string | null
      dominant_color: string | null
      artist: string | null
    }>(
      `SELECT t.title,
              al.title AS album,
              aw.id AS artwork_id,
              aw.local_uri AS artwork_uri,
              aw.source_url,
              aw.blurhash,
              aw.dominant_color,
              (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist
         FROM tracks t
         LEFT JOIN albums al ON al.urn = t.album_urn
         LEFT JOIN artworks aw ON aw.id = COALESCE(t.artwork_id, al.artwork_id)
        WHERE t.urn = ?`,
      [urn],
    )
    if (!row) return undefined
    const artwork: ArtworkRef | undefined = row.artwork_id
      ? {
          id: row.artwork_id,
          sourceUrl: row.source_url ?? row.artwork_uri ?? undefined,
          blurhash: row.blurhash ?? undefined,
          dominantColor: row.dominant_color ?? undefined,
        }
      : undefined
    return {
      title: row.title,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.album ? { album: row.album } : {}),
      // Must be a local Uri on mobile, so a remote-only artwork is omitted
      // rather than handed over to fail silently (docs/04 §7).
      ...(row.artwork_uri ? { artworkUri: row.artwork_uri } : {}),
      ...(artwork ? { artwork } : {}),
    }
  }
}

function parseContext(raw: string | null): QueueItem['sourceContext'] | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as QueueItem['sourceContext']
  } catch {
    return undefined
  }
}

async function insertEntries(
  tx: { exec(sql: string, params?: SqlValue[]): Promise<unknown> },
  entries: readonly QueueEntry[],
): Promise<void> {
  const BATCH_SIZE = 50
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
    const sql = `INSERT INTO queue_items (id, position, track_urn, source_context_json, added_by, added_at) VALUES ${placeholders}`
    const params: SqlValue[] = []
    for (const entry of chunk) {
      params.push(
        entry.item.id,
        entry.position,
        entry.item.trackUrn,
        entry.item.sourceContext ? JSON.stringify(entry.item.sourceContext) : null,
        entry.item.addedBy,
        entry.item.addedAt ?? Date.now(),
      )
    }
    await tx.exec(sql, params)
  }
}

function formatDateIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
