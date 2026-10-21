/**
 * The queue: what plays next, and in what order.
 *
 * Kept apart from the transport because it is pure — no audio, no database,
 * no clock — which is what lets every ordering rule be tested directly instead
 * of through playback.
 *
 * Two decisions from docs/05 §2 live here:
 *
 *  - **Positions are fractional index keys**, so moving one track in a
 *    5,000-track queue writes exactly one row instead of renumbering the tail.
 *  - **Shuffle is a seed plus a permutation**, not a dice roll per advance.
 *    That makes the shuffled order stable across restarts, makes `previous()`
 *    meaningful, and lets the UI show the upcoming queue truthfully.
 */

import { between, sequence } from '@BBeBee/protocol'
import type { QueueItem, RepeatMode } from '@BBeBee/protocol'
import { permute } from '@BBeBee/toolkit'

export interface QueueEntry {
  item: QueueItem
  /** Fractional index. The list is always sorted by this. */
  position: string
}

export class QueueModel {
  /** Always sorted by `position`. */
  private entries: QueueEntry[] = []
  private entryMap = new Map<string, QueueEntry>()
  private itemsCache?: readonly QueueItem[]
  private shuffleOn = false
  private seed = 1
  /** Invalidated on every structural change; recomputed lazily. */
  private orderCache?: string[]

  private shuffleFirstId?: string

  private invalidateCache(): void {
    this.orderCache = undefined
    this.itemsCache = undefined
  }

  private rebuildMap(): void {
    this.entryMap.clear()
    for (const e of this.entries) {
      this.entryMap.set(e.item.id, e)
    }
  }

  get items(): readonly QueueItem[] {
    if (!this.itemsCache) {
      this.itemsCache = this.entries.map((e) => e.item)
    }
    return this.itemsCache
  }

  get all(): readonly QueueEntry[] {
    return this.entries
  }

  get length(): number {
    return this.entries.length
  }

  get shuffle(): boolean {
    return this.shuffleOn
  }

  get shuffleSeed(): number {
    return this.seed
  }

  entry(id: string): QueueEntry | undefined {
    return this.entryMap.get(id)
  }

  /** Restore from persisted rows. They arrive sorted, but sort anyway. */
  load(entries: QueueEntry[], opts: { shuffle?: boolean; seed?: number } = {}): void {
    this.entries = [...entries].sort((a, b) => (a.position < b.position ? -1 : 1))
    this.shuffleOn = opts.shuffle ?? false
    if (opts.seed !== undefined) this.seed = opts.seed
    this.shuffleFirstId = undefined
    this.rebuildMap()
    this.invalidateCache()
  }

  setShuffle(on: boolean, seed?: number): void {
    this.shuffleOn = on
    if (!on) this.shuffleFirstId = undefined
    // A new seed on each enable, so shuffling twice is not the same order —
    // but the seed persists, so *relaunching* is.
    if (on) this.seed = seed ?? Math.floor(Math.random() * 0xffffffff)
    this.orderCache = undefined
  }

  /**
   * Rotates the shuffle permutation so that `firstId` is placed at index 0,
   * with all other items following in the seeded permutation order.
   */
  rotateShuffle(firstId: string): void {
    this.shuffleFirstId = firstId
    this.orderCache = undefined
  }

  /**
   * Ids in play order: the queue's own order, or the seeded permutation.
   *
   * Callers may show this: it is the real upcoming order, not a guess.
   */
  order(): string[] {
    if (!this.orderCache) {
      const ids = this.entries.map((e) => e.item.id)
      let order = this.shuffleOn ? permute(ids, this.seed) : ids
      if (this.shuffleOn && this.shuffleFirstId) {
        const idx = order.indexOf(this.shuffleFirstId)
        if (idx > 0) {
          order = [...order.slice(idx), ...order.slice(0, idx)]
        }
      }
      this.orderCache = order
    }
    return this.orderCache
  }

  indexOf(id: string): number {
    return this.order().indexOf(id)
  }

  /** Replace the queue wholesale. Returns the entries as stored. */
  replace(items: QueueItem[]): QueueEntry[] {
    const positions = sequence(items.length)
    this.entries = items.map((item, i) => ({ item, position: positions[i]! }))
    this.shuffleFirstId = undefined
    this.rebuildMap()
    this.invalidateCache()
    return this.entries
  }

  /** Insert directly after `afterId` (or at the head when it is absent). */
  insertAfter(afterId: string | undefined, items: QueueItem[]): QueueEntry[] {
    const at = afterId ? this.entries.findIndex((e) => e.item.id === afterId) : -1
    const lower = at >= 0 ? this.entries[at]?.position : undefined
    const upper = this.entries[at + 1]?.position
    const positions = sequence(items.length, lower, upper)

    const added = items.map((item, i) => ({ item, position: positions[i]! }))
    this.entries.splice(at + 1, 0, ...added)
    for (const e of added) {
      this.entryMap.set(e.item.id, e)
    }
    this.invalidateCache()
    return added
  }

  append(items: QueueItem[]): QueueEntry[] {
    const last = this.entries[this.entries.length - 1]?.position
    const positions = sequence(items.length, last, undefined)
    const added = items.map((item, i) => ({ item, position: positions[i]! }))
    this.entries.push(...added)
    for (const e of added) {
      this.entryMap.set(e.item.id, e)
    }
    this.invalidateCache()
    return added
  }

  remove(ids: string[]): string[] {
    const doomed = new Set(ids)
    const before = this.entries.length
    this.entries = this.entries.filter((e) => !doomed.has(e.item.id))
    for (const id of doomed) {
      this.entryMap.delete(id)
    }
    if (this.shuffleFirstId && doomed.has(this.shuffleFirstId)) {
      this.shuffleFirstId = undefined
    }
    this.invalidateCache()
    return before === this.entries.length ? [] : [...doomed]
  }

  clear(): void {
    this.entries = []
    this.entryMap.clear()
    this.shuffleFirstId = undefined
    this.invalidateCache()
  }

  /**
   * Move one item, returning only the row that changed.
   *
   * `toIndex` is an index into the *queue*, not into the shuffled order:
   * dragging a row in the UI moves it where it was dropped.
   */
  move(id: string, toIndex: number): QueueEntry | undefined {
    const from = this.entries.findIndex((e) => e.item.id === id)
    if (from < 0) return undefined

    const entry = this.entries[from]!
    const without = this.entries.filter((_, i) => i !== from)
    const target = Math.max(0, Math.min(without.length, toIndex))
    const position = between(without[target - 1]?.position, without[target]?.position)

    const moved: QueueEntry = { item: entry.item, position }
    without.splice(target, 0, moved)
    this.entries = without
    this.entryMap.set(id, moved)
    this.invalidateCache()
    return moved
  }

  /**
   * What follows `id`, honouring repeat. `undefined` means the queue ended.
   *
   * Shuffle never ends: a permutation that runs out wraps to its head, which
   * is what "shuffle" means — the order is random, the music is continuous.
   * A plain sequence without repeat-all is the only way a queue runs out.
   */
  next(id: string | undefined, repeat: RepeatMode): QueueEntry | undefined {
    if (this.entries.length === 0) return undefined
    if (repeat === 'one' && id) return this.entry(id)

    const order = this.order()
    const at = id ? order.indexOf(id) : -1
    const nextId = order[at + 1]
    if (nextId) return this.entry(nextId)
    return repeat === 'all' || this.shuffleOn ? this.entry(order[0]!) : undefined
  }

  /** What precedes `id`. Wraps under repeat-all or shuffle, like `next`. */
  previous(id: string | undefined, repeat: RepeatMode): QueueEntry | undefined {
    if (this.entries.length === 0) return undefined
    const order = this.order()
    const at = id ? order.indexOf(id) : 0
    if (at <= 0) {
      return repeat === 'all' || this.shuffleOn
        ? this.entry(order[order.length - 1]!)
        : undefined
    }
    return this.entry(order[at - 1]!)
  }

  /** The first item in play order, for starting an idle queue. */
  first(): QueueEntry | undefined {
    const id = this.order()[0]
    return id ? this.entry(id) : undefined
  }
}
