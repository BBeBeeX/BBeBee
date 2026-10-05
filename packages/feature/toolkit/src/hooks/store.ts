/**
 * Service state as an external store.
 *
 * `useSyncExternalStore` needs two things — a `subscribe` and a
 * `getSnapshot` — and both have rules that are easy to get wrong and hard to
 * see when you do. Building them here, outside React, is what makes those
 * rules testable at all: a hook needs a renderer, a store needs nothing.
 *
 * The rule that causes the actual bug: **`getSnapshot` must return a
 * referentially stable value while nothing has changed.** React calls it
 * during render *and* after every store notification, and compares with
 * `Object.is`. A selector returning a fresh object each call therefore never
 * compares equal, and the component re-renders forever — a loop that presents
 * as "the app is slow", not as an error.
 *
 * See docs/08 §4.
 */

import type { Context } from 'cordis'
import type { Disposable } from '@BBeBee/protocol'

export interface ServiceStore<T> {
  subscribe(onChange: () => void): () => void
  getSnapshot(): T
}

export interface StoreOptions<T> {
  /** Compare a fresh selection against the cached one. Defaults to `Object.is`. */
  isEqual?: (a: T, b: T) => boolean
}

/**
 * A store over one service, invalidated by a set of events.
 *
 * The snapshot is **cached and only replaced when the selection actually
 * changes**, so a selector that builds an array or an object is safe here even
 * though it would be unsafe passed straight to `useSyncExternalStore`. That is
 * the whole reason this exists rather than being three inline lines: every
 * feature hook would otherwise have to remember, and most would not.
 */
export function createServiceStore<T>(
  ctx: Context,
  events: readonly string[],
  select: () => T,
  options: StoreOptions<T> = {},
): ServiceStore<T> {
  const isEqual = options.isEqual ?? Object.is
  let cached: { value: T } | undefined
  let isSubscribed = false

  const read = (): T => {
    const next = select()
    if (cached && isEqual(cached.value, next)) return cached.value
    cached = { value: next }
    return next
  }

  return {
    subscribe(onChange) {
      isSubscribed = true
      const offs: Disposable[] = []
      for (const event of events) {
        // Recompute eagerly so the cache is warm before React asks: React
        // calls `getSnapshot` immediately after a notification, and a stale
        // read there is a render one tick behind reality.
        offs.push(
          ctx.on(event as never, (() => {
            read()
            onChange()
          }) as never) as Disposable,
        )
      }
      return () => {
        isSubscribed = false
        for (const off of offs) off()
      }
    },
    getSnapshot() {
      if (isSubscribed && cached) {
        return cached.value
      }
      return read()
    },
  }
}

/**
 * Compare two arrays by identity of their elements.
 *
 * The common case for a list selector: the queue is a new array on every
 * `queue/changed`, but its items are the same objects, and re-rendering a
 * 5,000-row list because the wrapper changed is the difference between a
 * smooth scroll and a stutter.
 */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((item, i) => Object.is(item, b[i]))
}

/** Compare two objects one level deep. For selectors that build a small record. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  const keys = Object.keys(a) as (keyof T)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.is(a[key], b[key]))
}
