/**
 * Dev-mode host shim for `react-dom` — same pattern as react.ts: Vite's
 * optimized dep file for this CommonJS package is default-only, so the named
 * surface is re-exported here through a Vite-transformed source file, keeping
 * the single instance the app uses.
 */
import * as def from 'react-dom'

export default def
export const {
  __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} = def as unknown as Record<string, unknown>
