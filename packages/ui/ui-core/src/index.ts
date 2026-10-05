/**
 * `@BBeBee/ui-core` - the seam between services and React.
 *
 * The service-binding primitives (`serviceOf`, `useServiceState`,
 * `createServiceStore`, …) now live in `@BBeBee/toolkit/hooks` — the shared
 * headless library — so that a view package never has to import *another*
 * feature's package for a binding two features both need, and so the feature
 * packages exposing view hooks no longer depend on a Layer 5 package to do it.
 * They are re-exported here unchanged: every existing consumer keeps working.
 *
 * What remains native to this package is the view-generic surface —
 * `identicon` and the shared props helpers — which knows no service keys.
 *
 * The rule this layer exists to enforce: **React holds no domain state.**
 * Services own it; components subscribe. Anything here that starts looking
 * like a reducer belongs in a service.
 */

import type {} from '@BBeBee/protocol'

export {
  createServiceStore,
  isReady,
  serviceOf,
  shallowArrayEqual,
  shallowEqual,
  useService,
  useServiceState,
  type AsyncState,
  type ServiceStore,
  type StoreOptions,
} from '@BBeBee/toolkit/hooks'

export * from './props.js'
export * from './identicon.js'
