/**
 * Peer discovery state: the table of BBeBee devices heard on the network.
 *
 * Pure bookkeeping — announce loops and datagram plumbing live in the service
 * (`index.ts`). `now` is injected so the TTL sweep is testable without a fake
 * timer.
 */

import { PEER_TTL_MS } from './protocol.js'
import type { LanSharePeer } from '@BBeBee/protocol'

export class PeerTable {
  private readonly peers = new Map<string, LanSharePeer>()

  constructor(
    private readonly ttlMs: number = PEER_TTL_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly maxRows: number = 256,
  ) {}

  /**
   * Record an announce. Returns whether the *visible* row changed — a fresh
   * `lastSeen` alone is not worth an event, but a new peer, a new address, a
   * new port or a rename is.
   */
  upsert(peer: Omit<LanSharePeer, 'lastSeen'>): boolean {
    const existing = this.peers.get(peer.id)
    const lastSeen = this.now()
    const changed =
      !existing ||
      existing.name !== peer.name ||
      existing.host !== peer.host ||
      existing.httpPort !== peer.httpPort ||
      existing.platform !== peer.platform
    // A UDP flood with random ids would grow the table without bound — the
    // TTL sweep only removes rows it already knows. Evict the
    // least-recently-heard peer at the cap.
    while (this.peers.size >= this.maxRows && !this.peers.has(peer.id)) {
      this.evictOldest()
    }
    this.peers.set(peer.id, { ...peer, lastSeen })
    return changed
  }

  private evictOldest(): void {
    let oldestId: string | undefined
    let oldestSeen = Infinity
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < oldestSeen) {
        oldestSeen = peer.lastSeen
        oldestId = id
      }
    }
    if (oldestId !== undefined) this.peers.delete(oldestId)
  }

  remove(id: string): boolean {
    return this.peers.delete(id)
  }

  /** Drop peers whose last announce is older than the TTL. Returns the removed ids. */
  expire(): string[] {
    const now = this.now()
    const removed: string[] = []
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen + this.ttlMs <= now) {
        this.peers.delete(id)
        removed.push(id)
      }
    }
    return removed
  }

  list(): LanSharePeer[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): LanSharePeer | undefined {
    return this.peers.get(id)
  }
}
