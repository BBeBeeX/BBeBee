/**
 * Dev-mode host shim for `react`.
 *
 * Vite's optimized dep file for a CommonJS package (`node_modules/.vite/deps/react.js`)
 * only has a default export — Vite's import analysis rewrites the *app's* named
 * imports into property accesses on that default, so the app never notices, but
 * a plugin loaded through the native import map does: `import { useCallback }`
 * fails with "does not provide an export named 'useCallback'". This shim is a
 * real source file under the vite root, so Vite transforms its bare import to
 * the same dep file the app uses (single instance) and the destructured named
 * exports below become real ESM exports of the served module.
 *
 * The name list is the actual CommonJS export surface of the pinned React
 * version (see HOST_REACT_VERSION in host-modules.manifest.ts); the cast keeps
 * tsc quiet about internals that @types/react does not declare, and
 * host-dev.test.ts pins the list against a live `require('react')` so a React
 * bump that adds an export fails loudly instead of silently dropping it.
 */
import * as def from 'react'

export default def
export const {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  act,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = def as unknown as Record<string, unknown>
