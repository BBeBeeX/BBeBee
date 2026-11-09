import { describe, expect, it } from 'vitest'
import { PeerTable } from './discovery.js'

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return {
    now: () => t,
    advance: (ms) => {
      t += ms
    },
  }
}

const peer = {
  id: 'device-node-a',
  name: 'Node A',
  platform: 'desktop',
  host: '192.168.1.10',
  httpPort: 53318,
}

describe('PeerTable', () => {
  it('reports a change when a peer is new, moves, or renames', () => {
    const c = clock()
    const table = new PeerTable(10_000, c.now)
    expect(table.upsert(peer)).toBe(true)
    expect(table.upsert(peer)).toBe(false) // same announce, only lastSeen moved
    expect(table.upsert({ ...peer, name: 'Renamed' })).toBe(true)
    expect(table.upsert({ ...peer, host: '192.168.1.11' })).toBe(true)
    expect(table.upsert({ ...peer, httpPort: 53319 })).toBe(true)
  })

  it('expires silent peers past the TTL', () => {
    const c = clock()
    const table = new PeerTable(10_000, c.now)
    table.upsert(peer)
    c.advance(9_999)
    expect(table.expire()).toEqual([])
    c.advance(1)
    expect(table.expire()).toEqual([peer.id])
    expect(table.list()).toEqual([])
    expect(table.get(peer.id)).toBeUndefined()
  })

  it('a re-announce after expiry revives the peer', () => {
    const c = clock()
    const table = new PeerTable(10_000, c.now)
    table.upsert(peer)
    c.advance(20_000)
    table.expire()
    expect(table.upsert(peer)).toBe(true)
    expect(table.get(peer.id)?.name).toBe(peer.name)
  })

  it('removal reports whether anything was removed', () => {
    const table = new PeerTable(10_000, clock().now)
    expect(table.remove(peer.id)).toBe(false)
    table.upsert(peer)
    expect(table.remove(peer.id)).toBe(true)
  })

  it('evicts the least-recently-heard peer at the row cap', () => {
    const c = clock()
    const table = new PeerTable(10_000, c.now, 3)
    table.upsert({ ...peer, id: 'p1' })
    c.advance(1)
    table.upsert({ ...peer, id: 'p2' })
    c.advance(1)
    table.upsert({ ...peer, id: 'p3' })
    c.advance(1)
    // A flood of random announce ids must not grow the table without bound.
    table.upsert({ ...peer, id: 'flood-a' })
    table.upsert({ ...peer, id: 'flood-b' })
    expect(table.list()).toHaveLength(3)
    // p1 was the least-recently-heard, so it is the one evicted.
    expect(table.get('p1')).toBeUndefined()
    expect(table.get('p3')).toBeDefined()
    // Refreshing an existing id must not evict anything.
    table.upsert({ ...peer, id: 'p2' })
    expect(table.list()).toHaveLength(3)
  })

  it('lists alphabetically so the UI order is stable', () => {
    const table = new PeerTable(10_000, clock().now)
    table.upsert({ ...peer, id: 'device-zeta', name: 'Zeta' })
    table.upsert({ ...peer, id: 'device-alpha', name: 'Alpha' })
    expect(table.list().map((p) => p.name)).toEqual(['Alpha', 'Zeta'])
  })
})
