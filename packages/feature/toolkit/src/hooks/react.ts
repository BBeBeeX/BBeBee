/**
 * The seam between services and React, shared by every view package.
 *
 * Depends on `react` and `@BBeBee/protocol` and nothing else, so both kits
 * build on the same hooks and a feature's *state* logic is written once even
 * though its pixels are written twice (docs/08 4).
 *
 * The rule this module exists to enforce: **React holds no domain state.**
 * Services own it; components subscribe. Anything here that starts looking
 * like a reducer belongs in a service.
 *
 * `@BBeBee/ui-core` re-exports this module for compatibility; new code imports
 * these bindings from `@BBeBee/toolkit/hooks` directly.
 */

import { useCallback, useDebugValue, useMemo, useSyncExternalStore } from 'react'
import { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { createServiceStore, type StoreOptions } from './store.js'

// React checks `$$typeof` on objects during rendering, reconciliation,
// and DevTools inspection. On a scoped Cordis Context, accessing an un-injected
// property throws `cannot get property "$$typeof" without inject`.
// Defining `$$typeof: undefined` on `Context.prototype` ensures `Reflect.has(target, '$$typeof')`
// is true, answering `undefined` rather than throwing when React inspects a context.
try {
  Object.defineProperty(Context.prototype, '$$typeof', {
    value: undefined,
    configurable: true,
    writable: true,
  })
} catch {
  // Ignore in environments where prototype is immutable
}

/**
 * Read a service off the context, or `undefined` where it is not loaded.
 *
 * `undefined` is a normal state, not an error: a plugin may be disabled, or a
 * service may not exist on this platform, and a view that renders a
 * placeholder is the behaviour docs/08 §3 asks for.
 *
 * ⚠️ **`ctx[key] is not how to ask.** On a plugin-scoped context — which is
 * the only kind a view ever receives — cordis's proxy *throws* for any
 * property that was not injected, so `ctx.player` and even `ctx.player?.x`
 * raise `cannot get property "player" without inject` rather than answering
 * `undefined`. This function used to be that read, and its own doc comment was
 * false everywhere it mattered: it answered `undefined` in tests, which build
 * a root context, and threw in the app.
 *
 * `reflect.get(key, false)` is the ask that has an answer. The `false` is
 * "not required", and it works the same on a root context and a scoped one.
 */
export function serviceOf<T = unknown>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { reflect: { get(key: string, required: boolean): unknown } }).reflect.get(
    key,
    false,
  ) as T | undefined
}

/** The hook form of {@link serviceOf}, with the absent case named in devtools. */
export function useService<T = unknown>(ctx: Context, key: string): T | undefined {
  const value = serviceOf<T>(ctx, key)
  useDebugValue(value === undefined ? `${key} (absent)` : key)
  return value
}

/**
 * Subscribe to service state.
 *
 * `select` runs on every notification and on every render, so it must be
 * cheap. It does **not** have to be referentially stable - the store caches
 * and compares, which is what keeps a selector that builds an array from
 * looping React forever (see `store.ts`).
 *
 * `events` and `select` are read on first render and whenever `deps` changes.
 * Passing a fresh inline `select` every render is fine and expected.
 */
export function useServiceState<T>(
  ctx: Context,
  events: readonly string[],
  select: () => T,
  options: StoreOptions<T> & { deps?: readonly unknown[] } = {},
): T {
  const { isEqual, deps } = options
  // The store must survive re-renders, or every render resubscribes and the
  // cache - the thing preventing the render loop - is thrown away each time.
  //
  // `select` is deliberately excluded from the dependencies: it is inline at
  // nearly every call site, so including it would rebuild the store on every
  // render and undo the caching. `deps` is how a caller says the selection
  // itself changed.
  const key = events.join(' ')
  const store = useMemo(
    () => createServiceStore(ctx, events, select, isEqual ? { isEqual } : {}),
    [ctx, key, isEqual, ...(deps ?? [])],
  )
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  // The third argument is the server snapshot; the same read is correct
  // because there is no server - but omitting it throws during hydration if a
  // shell ever renders on one.
  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * The state of a service call, for a view that must show a spinner.
 *
 * Deliberately *not* a data-fetching library. It exists so a view can report
 * loading and failure without inventing its own `useEffect`, which docs/08 4
 * forbids for domain work.
 */
export interface AsyncState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data?: T
  error?: Error
}

export function isReady<T>(state: AsyncState<T>): state is AsyncState<T> & { data: T } {
  return state.status === 'ready'
}
