/**
 * The discovery table: leaders heard via UDP announce, TTL-expired.
 *
 * The same shape as `plugin-lan-share`'s `PeerTable` — announce in, expiry
 * sweep out, and a `changed` flag so the service only emits when something a
 * UI renders actually moved.
 */

import type { SyncLeaderInfo } from '@BBeBee/protocol'

export interface PeerUpsert {
  id: string
  name: string
  platform: string
  host: string
  httpPort: number
}

export class LeaderTable {
  private readonly rows = new Map<string, { info: SyncLeaderInfo; bye: boolean }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxRows: number = 256,
  ) {}

  /**
   * Record an announce. Returns true when the *visible* row changed — a bare
   `lastSeen` refresh is not a change a peer list needs to re-render.
   */
  upsert(peer: PeerUpsert): boolean {
    const existing = this.rows.get(peer.id)
    const info: SyncLeaderInfo = {
      id: peer.id,
      name: peer.name,
      platform: peer.platform,
      host: peer.host,
      httpPort: peer.httpPort,
      lastSeen: Date.now(),
    }
    const changed =
      !existing ||
      existing.bye ||
      existing.info.name !== info.name ||
      existing.info.platform !== info.platform ||
      existing.info.host !== info.host ||
      existing.info.httpPort !== info.httpPort
    // A flood of announces with random ids would grow the table without
    // bound — the TTL sweep only removes rows it already knows. Evict the
    // least-recently-heard row at the cap.
    while (this.rows.size >= this.maxRows && !this.rows.has(peer.id)) {
      this.evictOldest()
    }
    this.rows.set(peer.id, { info, bye: false })
    return changed
  }

  private evictOldest(): void {
    let oldestId: string | undefined
    let oldestSeen = Infinity
    for (const [id, row] of this.rows) {
      if (row.info.lastSeen < oldestSeen) {
        oldestSeen = row.info.lastSeen
        oldestId = id
      }
    }
    if (oldestId !== undefined) this.rows.delete(oldestId)
  }

  /** Record a goodbye. Returns true when the peer was present. */
  remove(id: string): boolean {
    if (!this.rows.has(id)) return false
    this.rows.delete(id)
    return true
  }

  get(id: string): SyncLeaderInfo | undefined {
    return this.rows.get(id)?.info
  }

  /** Drop expired entries. Returns the ids removed. */
  expire(): string[] {
    const cutoff = Date.now() - this.ttlMs
    const removed: string[] = []
    for (const [id, row] of this.rows) {
      if (row.info.lastSeen < cutoff) {
        this.rows.delete(id)
        removed.push(id)
      }
    }
    return removed
  }

  /** Most recently heard first. */
  list(): SyncLeaderInfo[] {
    return [...this.rows.values()].map((r) => r.info).sort((a, b) => b.lastSeen - a.lastSeen)
  }
}
