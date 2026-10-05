/**
 * The external store behind every view hook.
 *
 * Built outside React precisely so this is testable: the rules
 * `useSyncExternalStore` imposes are easy to break and, when broken, present
 * as "the app is slow" rather than as an error.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { createServiceStore, shallowArrayEqual, shallowEqual } from './store.js'

/** A context with one event and a mutable value behind it. */
function harness<T>(initial: T) {
  const ctx = new Context()
  let value = initial
  return {
    ctx,
    set(next: T) {
      value = next
      ;(ctx as unknown as { emit(e: string): void }).emit('thing/changed')
    },
    read: () => value,
  }
}

describe('snapshot stability', () => {
  it('returns the identical value while nothing has changed', () => {
    // The rule that matters: React compares snapshots with Object.is on every
    // render. A selector building a fresh object each call never compares
    // equal, and the component re-renders forever.
    const h = harness({ a: 1 })
    const store = createServiceStore(h.ctx, ['thing/changed'], () => ({ ...h.read() }), {
      isEqual: shallowEqual,
    })
    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)
    expect(store.getSnapshot()).toBe(first)
  })

  it('keeps snapshot reference stable while subscribed even if selector returns fresh objects without isEqual', () => {
    const h = harness({ a: 1 })
    // No isEqual provided; selector always produces a fresh object
    const store = createServiceStore(h.ctx, ['thing/changed'], () => ({ ...h.read() }))
    const off = store.subscribe(() => {})
    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)
    expect(store.getSnapshot()).toBe(first)

    // After change event, updates to a new snapshot and stays stable again
    h.set({ a: 2 })
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(second).toEqual({ a: 2 })
    expect(store.getSnapshot()).toBe(second)
    off()
  })

  it('returns a new value once the selection actually changes', () => {
    const h = harness({ a: 1 })
    const store = createServiceStore(h.ctx, ['thing/changed'], () => ({ ...h.read() }), {
      isEqual: shallowEqual,
    })
    const before = store.getSnapshot()
    h.set({ a: 2 })
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after).toEqual({ a: 2 })
  })

  it('keeps the old snapshot when an event fires but nothing changed', () => {
    // Services emit more often than their state changes; without this, every
    // position tick would re-render a component that shows the track title.
    const h = harness({ a: 1 })
    const store = createServiceStore(h.ctx, ['thing/changed'], () => ({ ...h.read() }), {
      isEqual: shallowEqual,
    })
    const before = store.getSnapshot()
    h.set({ a: 1 })
    expect(store.getSnapshot()).toBe(before)
  })

  it('defaults to Object.is, which suits a primitive selection', () => {
    const h = harness(1)
    const store = createServiceStore(h.ctx, ['thing/changed'], () => h.read())
    expect(store.getSnapshot()).toBe(1)
    h.set(2)
    expect(store.getSnapshot()).toBe(2)
  })
})

describe('subscription', () => {
  it('notifies on the events it was given', () => {
    const h = harness(1)
    const store = createServiceStore(h.ctx, ['thing/changed'], () => h.read())
    const onChange = vi.fn()
    store.subscribe(onChange)

    h.set(2)
    h.set(3)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('has a warm snapshot by the time it notifies', () => {
    // React calls getSnapshot immediately after a notification; a stale read
    // there renders one tick behind reality, which looks like a lost update.
    const h = harness(1)
    const store = createServiceStore(h.ctx, ['thing/changed'], () => h.read())
    let seen: number | undefined
    store.subscribe(() => void (seen = store.getSnapshot()))
    h.set(42)
    expect(seen).toBe(42)
  })

  it('stops notifying once unsubscribed', () => {
    const h = harness(1)
    const store = createServiceStore(h.ctx, ['thing/changed'], () => h.read())
    const onChange = vi.fn()
    store.subscribe(onChange)()
    h.set(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('supports several subscribers independently', () => {
    const h = harness(1)
    const store = createServiceStore(h.ctx, ['thing/changed'], () => h.read())
    const a = vi.fn()
    const b = vi.fn()
    const offA = store.subscribe(a)
    store.subscribe(b)

    h.set(2)
    offA()
    h.set(3)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('listens to every event it was given', () => {
    const ctx = new Context()
    const emit = (e: string) => (ctx as unknown as { emit(x: string): void }).emit(e)
    const store = createServiceStore(ctx, ['a/one', 'a/two'], () => 1)
    const onChange = vi.fn()
    store.subscribe(onChange)

    emit('a/one')
    emit('a/two')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('leaves no listener behind on the context', () => {
    // A leaked listener drives a component that has unmounted.
    const ctx = new Context()
    const store = createServiceStore(ctx, ['a/one'], () => 1)
    const before = ctx.registry.size
    const off = store.subscribe(() => {})
    off()
    expect(ctx.registry.size).toBe(before)
  })
})

describe('comparison helpers', () => {
  it('shallowArrayEqual sees past a fresh wrapper array', () => {
    // `queue/changed` hands out a new array of the same items; re-rendering a
    // 5,000-row list for that is the difference between a scroll and a stutter.
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(shallowArrayEqual(items, [...items])).toBe(true)
    expect(shallowArrayEqual(items, [items[0]!])).toBe(false)
    expect(shallowArrayEqual(items, [items[1]!, items[0]!])).toBe(false)
  })

  it('shallowEqual compares one level', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 } as never)).toBe(false)
    // One level: a nested object is compared by identity, not by value.
    const nested = { x: 1 }
    expect(shallowEqual({ n: nested }, { n: nested })).toBe(true)
    expect(shallowEqual({ n: { x: 1 } }, { n: { x: 1 } })).toBe(false)
  })
})
