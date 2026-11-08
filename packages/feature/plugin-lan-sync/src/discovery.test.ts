import { describe, expect, it } from 'vitest'
import { LeaderTable } from './discovery.js'

describe('LeaderTable', () => {
  it('records announces and lists most-recent-first', async () => {
    const table = new LeaderTable(10_000)
    table.upsert({ id: 'a', name: 'A', platform: 'linux', host: '192.168.1.2', httpPort: 53318 })
    // Distinct timestamps — same-millisecond announces tie and keep insertion order.
    await new Promise((resolve) => setTimeout(resolve, 2))
    table.upsert({ id: 'b', name: 'B', platform: 'android', host: '192.168.1.3', httpPort: 53318 })
    expect(table.list().map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('reports visible changes, not lastSeen refreshes', () => {
    const table = new LeaderTable(10_000)
    expect(table.upsert({ id: 'a', name: 'A', platform: 'linux', host: 'h', httpPort: 1 })).toBe(true)
    // Same shape — a bare refresh is not a re-render.
    expect(table.upsert({ id: 'a', name: 'A', platform: 'linux', host: 'h', httpPort: 1 })).toBe(false)
    expect(table.upsert({ id: 'a', name: 'A2', platform: 'linux', host: 'h', httpPort: 1 })).toBe(true)
    expect(table.upsert({ id: 'a', name: 'A2', platform: 'linux', host: 'h2', httpPort: 1 })).toBe(true)
  })

  it('expires stale peers and honours goodbye', async () => {
    const table = new LeaderTable(0) // everything is instantly stale
    table.upsert({ id: 'a', name: 'A', platform: 'linux', host: 'h', httpPort: 1 })
    await new Promise((resolve) => setTimeout(resolve, 2))
    expect(table.expire()).toEqual(['a'])
    expect(table.list()).toEqual([])

    table.upsert({ id: 'b', name: 'B', platform: 'linux', host: 'h', httpPort: 1 })
    expect(table.remove('b')).toBe(true)
    expect(table.remove('b')).toBe(false)
    expect(table.get('b')).toBeUndefined()
  })
})
