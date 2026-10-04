/**
 * @BBeBee/sdk/testing — Testing utilities for BBeBee plugins.
 *
 * Provides a lightweight Cordis context and snapshot leak detector for writing
 * unit tests with Vitest or Jest without launching the full application.
 */

export {
  createTestContext,
  expectNoLeak,
  snapshotContext,
  diffSnapshots,
  tick,
  describeFiber,
} from '@BBeBee/kernel/testing'

export type { ContextSnapshot } from '@BBeBee/kernel/testing'
